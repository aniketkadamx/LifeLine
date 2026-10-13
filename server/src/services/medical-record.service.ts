import crypto from "node:crypto";
import {
  generatePresignedUploadUrl,
  type PresignedUploadUrlResult,
} from "../integrations/storage/s3.client.js";
import {
  MIME_TO_EXTENSION_MAP,
  type AllowedMimeType,
  type UploadUrlInput,
} from "../validators/medical-record.validator.js";
import { auditLogService } from "./audit-log.service.js";
import { AuditAction, UserRole } from "../types/models.js";
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
}

export const medicalRecordService = new MedicalRecordService();
