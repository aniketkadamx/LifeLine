import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  MedicalRecord,
  Appointment,
  Consultation,
} from "../models/index.js";
import {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  getObjectMetadata,
  type PresignedUploadUrlResult,
} from "../integrations/storage/s3.client.js";
import {
  MIME_TO_EXTENSION_MAP,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
  type UploadUrlInput,
  type CreateMedicalRecordInput,
} from "../validators/medical-record.validator.js";
import { auditLogService } from "./audit-log.service.js";
import { patientService } from "./patient.service.js";
import {
  AuditAction,
  UserRole,
  AppointmentStatus,
  ConsultationStatus,
  type IMedicalRecord,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type { AuthenticatedUser } from "../types/express.js";

/**
 * Result returned upon generating a pre-signed upload URL.
 */
export interface GenerateUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
  method: "PUT";
  headers: {
    "Content-Type": string;
  };
}

/**
 * Result returned upon generating a pre-signed download URL.
 */
export interface GenerateDownloadUrlResult {
  downloadUrl: string;
  expiresInSeconds: number;
  recordId: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
}

export class MedicalRecordService {
  /**
   * Generates a 10-minute pre-signed PUT URL for uploading medical files directly to cloud storage.
   *
   * Security and Governance Guarantees:
   * 1. Patient Authorization: Enforces that caller holds the PATIENT role.
   * 2. Key Isolation: Generates server-owned random UUID storage key (`records/<uuid>.<ext>`),
   *    strictly rejecting client-supplied storage paths and avoiding path enumeration.
   * 3. Zero PHI in Storage Keys: Storage key contains no names, contact info, or clinical terms.
   * 4. 10-Minute Expiration: Upload URL is cryptographically bound to 600 seconds.
   * 5. Content-Type Binding: Signs exact Content-Type to prevent arbitrary payload MIME spoofing.
   * 6. Audit Trail: Emits non-sensitive audit entry without exposing signed URLs, credentials, or file bytes.
   * 7. No Premature DB Document: Does not persist unverified MedicalRecord database record until upload completes.
   *
   * @param user Authenticated user initiating the request
   * @param input Validated upload request parameters
   * @returns Pre-signed upload URL and upload metadata
   */
  async generateUploadUrl(
    user: AuthenticatedUser,
    input: UploadUrlInput
  ): Promise<GenerateUploadUrlResult> {
    // 1. Role Authorization: Only authenticated Patients can request medical record upload URLs
    if (user.role !== UserRole.PATIENT) {
      throw AppError.forbidden(
        "Access denied: only patients may request medical record upload URLs",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 2. Server-owned Object Key Generation:
    // Generate a cryptographically random UUID prefix.
    // Safe extension is derived exclusively from server-validated MIME type, NOT user's filename.
    const fileUuid = crypto.randomUUID();
    const safeExtension =
      MIME_TO_EXTENSION_MAP[input.fileType as AllowedMimeType] || "";
    const storageKey = `records/${fileUuid}${safeExtension}`;

    // 3. Request 10-minute pre-signed PUT URL from object storage provider
    const presignedResult: PresignedUploadUrlResult =
      await generatePresignedUploadUrl({
        objectKey: storageKey,
        contentType: input.fileType,
        expiresInSeconds: 600, // 10 minutes
      });

    // 4. Audit Log: Record operation with strictly sanitized, non-sensitive metadata
    void auditLogService.log({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.MEDICAL_RECORD_UPLOADED,
      resourceType: "MedicalRecord",
      resourceId: storageKey,
      patientId: user.id,
      status: "SUCCESS",
      metadata: {
        event: "MEDICAL_RECORD_UPLOAD_URL_GENERATED",
        fileType: input.fileType,
        sizeBytes: input.sizeBytes,
        expiresInSeconds: 600,
      },
    });

    // 5. Return standardized response contract
    return {
      uploadUrl: presignedResult.uploadUrl,
      storageKey: presignedResult.storageKey,
      expiresInSeconds: presignedResult.expiresInSeconds,
      method: presignedResult.method,
      headers: presignedResult.headers,
    };
  }

  /**
   * Registers medical record metadata in MongoDB after client completes direct-to-cloud upload.
   *
   * Security & Verification Guarantees:
   * 1. Patient Authorization: Enforces caller is authenticated with PATIENT role.
   * 2. Server-Controlled Ownership: Persists authenticated patient identity (`user.id`) as `patientId`
   *    and `uploadedBy`; never trusts client-supplied ownership fields.
   * 3. Storage Key Verification: Enforces storageKey matches server-generated `records/<uuid>.<ext>` namespace.
   * 4. S3 Object Verification: Calls HeadObject on cloud storage to verify the object exists in the private bucket.
   * 5. Actual Size & MIME Enforcement: Verifies actual S3 ContentLength is > 0 and <= 15 MiB;
   *    verifies actual ContentType is an allowed clinical MIME type matching the extension.
   * 6. Duplicate Prevention: Prevents duplicate registration of the same storageKey.
   * 7. Fail-safe: Rejects with 422 if object is missing, empty, oversized, or MIME-mismatched.
   *
   * @param user Authenticated user initiating registration
   * @param input Validated metadata input
   * @returns Persisted MedicalRecord document
   */
  async createMedicalRecord(
    user: AuthenticatedUser,
    input: CreateMedicalRecordInput
  ): Promise<IMedicalRecord> {
    // 1. Role Authorization
    if (user.role !== UserRole.PATIENT) {
      throw AppError.forbidden(
        "Access denied: only patients may register medical records",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 2. Duplicate Registration Prevention
    const existingRecord = await MedicalRecord.findOne({
      storageKey: input.storageKey,
    });
    if (existingRecord) {
      throw new AppError(
        409,
        "RESOURCE_CONFLICT",
        "A medical record has already been registered for this storage object"
      );
    }

    // 3. Verify Actual Uploaded Object via S3 HeadObject
    const objectMetadata = await getObjectMetadata(input.storageKey);

    // Verify ContentLength > 0 (Reject empty files)
    if (objectMetadata.contentLength <= 0) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Uploaded object is empty (0 bytes)"
      );
    }

    // Verify ContentLength <= 15 MiB (Reject oversized files)
    if (objectMetadata.contentLength > MAX_FILE_SIZE_BYTES) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        `Uploaded object exceeds maximum permitted size of 15 MiB (${objectMetadata.contentLength} bytes)`
      );
    }

    // Verify ContentType is one of the allowed MIME types
    if (
      !ALLOWED_MIME_TYPES.includes(objectMetadata.contentType as AllowedMimeType)
    ) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        `Uploaded object has an unsupported MIME type '${objectMetadata.contentType}'. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`
      );
    }

    // Verify file extension consistency between storageKey and verified MIME type
    const expectedExtension =
      MIME_TO_EXTENSION_MAP[objectMetadata.contentType as AllowedMimeType];
    const matchesExtension =
      (expectedExtension && input.storageKey.endsWith(expectedExtension)) ||
      (objectMetadata.contentType === "image/jpeg" && input.storageKey.endsWith(".jpeg"));

    if (!matchesExtension) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        `Storage key extension does not match verified MIME type '${objectMetadata.contentType}'`
      );
    }

    // 4. Persist MedicalRecord with Authoritative Verified Properties
    let record: IMedicalRecord;
    try {
      record = await MedicalRecord.create({
        patientId: new mongoose.Types.ObjectId(user.id),
        uploadedBy: new mongoose.Types.ObjectId(user.id),
        title: input.title.trim(),
        description: input.description?.trim(),
        recordType: input.recordType,
        recordDate: input.recordDate ? new Date(input.recordDate) : new Date(),
        storageKey: input.storageKey,
        fileName: input.fileName?.trim() || input.title.trim(),
        fileType: objectMetadata.contentType, // Authoritative from S3
        sizeBytes: objectMetadata.contentLength, // Authoritative from S3
        relatedAppointmentId: input.relatedAppointmentId
          ? new mongoose.Types.ObjectId(input.relatedAppointmentId)
          : undefined,
      });
    } catch (dbError: any) {
      if (dbError?.code === 11000) {
        throw new AppError(
          409,
          "RESOURCE_CONFLICT",
          "A medical record has already been registered for this storage object"
        );
      }
      throw dbError;
    }

    // 5. Audit Log Entry
    void auditLogService.log({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.MEDICAL_RECORD_UPLOADED,
      resourceType: "MedicalRecord",
      resourceId: record._id.toString(),
      patientId: user.id,
      status: "SUCCESS",
      metadata: {
        recordId: record._id.toString(),
        recordType: record.recordType,
        fileType: record.fileType,
        sizeBytes: record.sizeBytes,
      },
    });

    return record;
  }

  /**
   * Generates a 15-minute (900 seconds) pre-signed GET URL for authorized participants to view/download medical records.
   *
   * Zero-Trust Authorization (AUTHORIZATION_MATRIX.md Section 4):
   * 1. Patient Owner: Permitted only if `user.id === record.patientId`.
   * 2. Attending Doctor: Permitted only if doctor has an active clinical relationship
   *    (CONFIRMED, IN_PROGRESS, or COMPLETED appointment or active consultation with this patient).
   * 3. Administrator: Permitted for compliance/supervision with audit logging.
   * 4. Unassigned doctors, unrelated patients, or pharmacy roles: Rejected with HTTP 403 Forbidden.
   * 5. Record state check: Archived records rejected with HTTP 404 Not Found.
   * 6. Storage verification: Confirms object exists in cloud storage before issuing download capability.
   * 7. Audit log: Records `ACTION: MEDICAL_RECORD_ACCESSED` on success, strictly omitting signed URLs or secrets.
   *
   * @param user Authenticated user requesting download access
   * @param recordId Medical record identifier
   * @returns Pre-signed download URL and metadata
   */
  async getDownloadUrl(
    user: AuthenticatedUser,
    recordId: string
  ): Promise<GenerateDownloadUrlResult> {
    if (!mongoose.Types.ObjectId.isValid(recordId)) {
      throw AppError.badRequest("Invalid medical record ID format", "BAD_REQUEST");
    }

    const record = await MedicalRecord.findById(recordId);
    if (!record || record.isArchived) {
      throw AppError.notFound("Medical record not found", "NOT_FOUND");
    }

    // Zero-Trust Authorization Policy Enforcement
    const isPatientOwner =
      user.role === UserRole.PATIENT &&
      record.patientId.toString() === user.id;

    let isAuthorizedDoctor = false;
    if (user.role === UserRole.DOCTOR) {
      // Check active clinical relationship per AUTHORIZATION_MATRIX.md Section 4
      const hasRelationship =
        await patientService.hasDoctorPatientRelationship(
          user.id,
          record.patientId.toString()
        );

      if (hasRelationship) {
        isAuthorizedDoctor = true;
      } else {
        // Also verify any active appointment directly
        const activeAppointment = await Appointment.exists({
          doctorId: new mongoose.Types.ObjectId(user.id),
          patientId: record.patientId,
          status: {
            $in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS,
              AppointmentStatus.COMPLETED,
            ],
          },
        });

        if (activeAppointment) {
          isAuthorizedDoctor = true;
        } else {
          // If checking via consultation, ensure consultation status is active/completed
          // and parent appointment is not cancelled or rejected
          const consultations = await Consultation.find({
            doctorId: new mongoose.Types.ObjectId(user.id),
            patientId: record.patientId,
            status: {
              $in: [
                ConsultationStatus.ROOM_OPENED,
                ConsultationStatus.IN_CONSULTATION,
                ConsultationStatus.COMPLETED,
              ],
            },
          }).select("appointmentId");

          if (consultations.length > 0) {
            const appointmentIds = consultations.map((c) => c.appointmentId);
            const validParentAppointment = await Appointment.exists({
              _id: { $in: appointmentIds },
              status: {
                $nin: [AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED],
              },
            });
            isAuthorizedDoctor = Boolean(validParentAppointment);
          }
        }
      }
    }

    const isAdmin = user.role === UserRole.ADMIN;

    if (!isPatientOwner && !isAuthorizedDoctor && !isAdmin) {
      // Strict negative authorization
      if (user.role === UserRole.DOCTOR) {
        throw AppError.forbidden(
          "Access denied: doctor does not have an active clinical relationship with this patient",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }
      throw AppError.forbidden(
        "Access denied: you do not have permission to view this medical record",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // Verify object still exists in cloud storage
    await getObjectMetadata(record.storageKey);

    // Generate Pre-signed GET URL with exactly 900 seconds TTL (15 minutes)
    const { downloadUrl, expiresInSeconds } =
      await generatePresignedDownloadUrl({
        objectKey: record.storageKey,
        expiresInSeconds: 900, // 15 minutes
      });

    // Record Audit Log: ACTION: MEDICAL_RECORD_ACCESSED
    void auditLogService.log({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.MEDICAL_RECORD_ACCESSED,
      resourceType: "MedicalRecord",
      resourceId: record._id.toString(),
      patientId: record.patientId.toString(),
      status: "SUCCESS",
      metadata: {
        recordId: record._id.toString(),
        recordType: record.recordType,
        fileType: record.fileType,
        sizeBytes: record.sizeBytes,
        expiresInSeconds: 900,
      },
    });

    return {
      downloadUrl,
      expiresInSeconds,
      recordId: record._id.toString(),
      fileName: record.fileName,
      fileType: record.fileType,
      sizeBytes: record.sizeBytes,
    };
  }
}

export const medicalRecordService = new MedicalRecordService();
