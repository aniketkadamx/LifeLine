import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  Prescription,
  Consultation,
  Appointment,
  DoctorProfile,
  PharmacyProfile,
  Order,
} from "../models/index.js";
import {
  PrescriptionStatus,
  UserRole,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  AppointmentStatus,
  ConsultationStatus,
  AuditAction,
  NotificationType,
  type IPrescription,
  type IPrescriptionMedicineItem,
} from "../types/models.js";
import { auditLogService } from "./audit-log.service.js";
import { notificationService } from "./notification.service.js";
import { AppError } from "../utils/api-error.js";
import type { AuthenticatedUser } from "../types/express.js";
import type { IssuePrescriptionInput } from "../validators/prescription.validator.js";

/**
 * Computes a deterministic canonical SHA-256 payload integrity digest for an issued prescription.
 *
 * Guarantees:
 * - Covers all legally relevant fields: patientId, doctorId, appointmentId, consultationId,
 *   diagnosis, medication snapshots, and exact timestamps.
 * - Deterministic serialization ensures any modification to clinical content alters the digest.
 *
 * Note on Cryptographic Status:
 * This digest provides cryptographic integrity detection (tamper-evidence).
 * Asymmetric PKI digital signing (e.g., doctor-specific X.509 certificates or HSM keys)
 * is pending future legal/regulatory compliance specification and is not yet part of the platform schema.
 *
 * @param payload Canonical data fields of the issued prescription
 * @returns SHA-256 hexadecimal hash string
 */
export function computePrescriptionDigest(payload: {
  patientId: string;
  doctorId: string;
  appointmentId?: string;
  consultationId?: string;
  diagnosis: string;
  medicines: Array<{
    medicineId: string;
    medicineName: string;
    dosage: string;
    frequency: string;
    durationDays: number;
    quantity: number;
    route: string;
    specialInstructions?: string;
  }>;
  issuedAt: Date | string;
  expiresAt: Date | string;
}): string {
  const canonicalMedicines = payload.medicines.map((m) => ({
    medicineId: m.medicineId.toString(),
    medicineName: m.medicineName.trim(),
    dosage: m.dosage.trim(),
    frequency: m.frequency.trim(),
    durationDays: m.durationDays,
    quantity: m.quantity,
    route: m.route,
    specialInstructions: m.specialInstructions ? m.specialInstructions.trim() : "",
  }));

  const canonicalPayload = {
    patientId: payload.patientId.toString(),
    doctorId: payload.doctorId.toString(),
    appointmentId: payload.appointmentId ? payload.appointmentId.toString() : "",
    consultationId: payload.consultationId ? payload.consultationId.toString() : "",
    diagnosis: payload.diagnosis.trim(),
    medicines: canonicalMedicines,
    issuedAt: new Date(payload.issuedAt).toISOString(),
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex");
}

/**
 * Calculates the exact 90-calendar-day validity window for an issued prescription.
 *
 * Uses UTC calendar date arithmetic to ensure accurate calculation across
 * month boundaries, year boundaries, leap years, and timezone shifts.
 *
 * @param issuedAt Date of prescription issuance
 * @returns Date representing issuedAt + 90 calendar days in UTC
 */
export function calculatePrescriptionExpiry(issuedAt: Date): Date {
  const expiresAt = new Date(issuedAt.getTime());
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 90);
  return expiresAt;
}

/**
 * Cryptographically verifies that an issued prescription's payload has not been tampered with.
 * Computes canonical payload digest and performs timing-safe comparison against expected checksum.
 *
 * @param prescription Prescription document to verify
 * @param expectedChecksum Optional expected digest; defaults to prescription.integrityChecksum
 * @returns true if verified and untampered, false otherwise
 */
export function verifyPrescriptionDigest(
  prescription: IPrescription,
  expectedChecksum?: string
): boolean {
  const checksum = expectedChecksum || prescription.integrityChecksum;
  if (!checksum) {
    return false;
  }

  const calculated = computePrescriptionDigest({
    patientId: prescription.patientId.toString(),
    doctorId: prescription.doctorId.toString(),
    appointmentId: prescription.appointmentId?.toString(),
    consultationId: prescription.consultationId?.toString(),
    diagnosis: prescription.diagnosis,
    medicines: prescription.medicines.map((m) => ({
      medicineId: m.medicineId.toString(),
      medicineName: m.medicineName,
      dosage: m.dosage,
      frequency: m.frequency,
      durationDays: m.durationDays,
      quantity: m.quantity,
      route: m.route,
      specialInstructions: m.specialInstructions,
    })),
    issuedAt: prescription.issuedAt || prescription.createdAt,
    expiresAt: prescription.expiresAt,
  });

  const calculatedBuf = Buffer.from(calculated, "hex");
  const checksumBuf = Buffer.from(checksum, "hex");

  if (calculatedBuf.length !== checksumBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(calculatedBuf, checksumBuf);
}

export class PrescriptionService {
  /**
   * Issues an immutable digital prescription for an active or completed clinical encounter.
   *
   * Security & Authorization Guarantees:
   * 1. Verified Doctor Only: Caller must be an authenticated DOCTOR with APPROVED_VERIFIED profile status.
   * 2. Assignment Verification: Doctor must be the attending clinician assigned to the consultation & appointment.
   * 3. Encounter State Verification: Consultation must exist and be in an active/concluded state (ROOM_OPENED,
   *    IN_CONSULTATION, PAUSED, ENDED, or COMPLETED). Rejects SCHEDULED (call not started).
   * 4. Cancellation Protection: Rejects cancelled, rejected, pending-payment, or no-show parent appointments.
   * 5. Immutable Medication Snapshot: Persists medication names, dosages, frequencies, and durations as fixed snapshots.
   * 6. Server-Controlled Timestamps: issuedAt is server-generated; expiresAt is exactly issuedAt + 90 calendar days.
   * 7. Immutability: Transitions status directly to FINALIZED_ISSUED; rejects future mutations.
   * 8. Atomicity & Concurrency: Multi-document transaction on replica sets / atomic conditional update + rollback cleanup on standalone MongoDB.
   * 9. Cryptographic Integrity: Computes SHA-256 canonical digest on the issued payload.
   * 10. Fail-Safe Event & Audit: Emits PRESCRIPTION_ISSUED event and non-sensitive audit entry asynchronously.
   *
   * @param user Authenticated doctor requesting issuance
   * @param input Validated prescription input payload
   * @returns Persisted IPrescription document
   */
  async issuePrescription(
    user: AuthenticatedUser,
    input: IssuePrescriptionInput
  ): Promise<IPrescription> {
    // 1. Role Authorization
    if (user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only medical doctors may issue digital prescriptions",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 2. Doctor Credential Verification Status Check
    const doctorProfile = await DoctorProfile.findOne({
      userId: new mongoose.Types.ObjectId(user.id),
    });
    if (
      !doctorProfile ||
      doctorProfile.verificationStatus !== DoctorVerificationStatus.APPROVED_VERIFIED
    ) {
      throw AppError.forbidden(
        "Access denied: doctor account is unverified or pending administrative credential review",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 3. Appointment Existence and Assignment Check
    const appointment = await Appointment.findById(input.appointmentId);
    if (!appointment) {
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    }

    if (appointment.doctorId.toString() !== user.id) {
      throw AppError.forbidden(
        "Access denied: you are not the attending doctor assigned to this appointment",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    if (
      appointment.status === AppointmentStatus.CANCELLED ||
      appointment.status === AppointmentStatus.REJECTED ||
      appointment.status === AppointmentStatus.PENDING_PAYMENT ||
      appointment.status === AppointmentStatus.NO_SHOW
    ) {
      throw new AppError(
        409,
        "APPOINTMENT_INELIGIBLE",
        `Cannot issue prescription for an appointment in '${appointment.status}' status`
      );
    }

    // 4. Consultation Encounter Verification
    let consultation = null;
    if (input.consultationId) {
      consultation = await Consultation.findById(input.consultationId);
    } else {
      consultation = await Consultation.findOne({ appointmentId: appointment._id });
    }

    if (!consultation) {
      throw new AppError(
        404,
        "CONSULTATION_NOT_FOUND",
        "A clinical consultation encounter is required before issuing a digital prescription"
      );
    }

    if (consultation.doctorId.toString() !== user.id) {
      throw AppError.forbidden(
        "Access denied: you are not the attending doctor for this consultation encounter",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // Ensure consultation encounter has started (cannot prescribe for SCHEDULED call that never began)
    if (consultation.status === ConsultationStatus.SCHEDULED) {
      throw new AppError(
        409,
        "CONSULTATION_NOT_STARTED",
        "Cannot issue prescription: consultation call has not been initiated yet"
      );
    }

    // 5. Duplicate Issuance Pre-Check
    if (consultation.prescriptionId) {
      throw new AppError(
        409,
        "RESOURCE_CONFLICT",
        "A digital prescription has already been finalized and issued for this consultation"
      );
    }

    const existingPrescription = await Prescription.findOne({
      consultationId: consultation._id,
      status: PrescriptionStatus.FINALIZED_ISSUED,
    });
    if (existingPrescription) {
      throw new AppError(
        409,
        "RESOURCE_CONFLICT",
        "A digital prescription has already been finalized and issued for this consultation"
      );
    }

    // 6. Server-Controlled Timestamps & 90-Day Expiry Calculation
    const issuedAt = new Date();
    const expiresAt = calculatePrescriptionExpiry(issuedAt);

    // 7. Map Medication Snapshots
    const medicationSnapshots: IPrescriptionMedicineItem[] = input.medicines.map(
      (med) => ({
        medicineId: new mongoose.Types.ObjectId(med.medicineId),
        medicineName: med.medicineName.trim(),
        dosage: med.dosage.trim(),
        frequency: med.frequency.trim(),
        durationDays: med.durationDays,
        quantity: med.quantity ?? 1,
        route: med.route,
        specialInstructions: med.specialInstructions?.trim() || undefined,
      })
    );

    // 8. Compute Cryptographic Canonical Payload Integrity Digest
    const integrityChecksum = computePrescriptionDigest({
      patientId: appointment.patientId.toString(),
      doctorId: user.id,
      appointmentId: appointment._id.toString(),
      consultationId: consultation._id.toString(),
      diagnosis: input.diagnosis.trim(),
      medicines: input.medicines.map((m) => ({
        medicineId: m.medicineId,
        medicineName: m.medicineName,
        dosage: m.dosage,
        frequency: m.frequency,
        durationDays: m.durationDays,
        quantity: m.quantity ?? 1,
        route: m.route,
        specialInstructions: m.specialInstructions,
      })),
      issuedAt,
      expiresAt,
    });

    // 9. Multi-Document Atomicity / Transaction Handling
    // Detect if connected MongoDB deployment supports multi-document transactions (replica set)
    let isReplicaSet = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const client = mongoose.connection.getClient();
        const topology = (
          client as unknown as {
            topology?: { description?: { type?: string; setName?: string } };
          }
        )?.topology?.description;
        isReplicaSet =
          topology?.type === "ReplicaSetWithPrimary" ||
          topology?.type === "Sharded" ||
          Boolean(topology?.setName);
      } catch {
        isReplicaSet = false;
      }
    }

    let session: mongoose.ClientSession | undefined = undefined;
    if (isReplicaSet) {
      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch {
        session = undefined;
      }
    }

    let createdPrescriptionId: mongoose.Types.ObjectId | undefined;
    let prescription: IPrescription;

    try {
      // Step A: Create Prescription with DB unique constraint
      try {
        const [createdDoc] = await Prescription.create(
          [
            {
              patientId: appointment.patientId,
              doctorId: new mongoose.Types.ObjectId(user.id),
              appointmentId: appointment._id,
              consultationId: consultation._id,
              status: PrescriptionStatus.FINALIZED_ISSUED,
              diagnosis: input.diagnosis.trim(),
              medicines: medicationSnapshots,
              additionalNotes: input.additionalNotes?.trim() || undefined,
              issuedAt,
              expiresAt,
              integrityChecksum,
            },
          ],
          session ? { session } : {}
        );
        prescription = createdDoc;
        createdPrescriptionId = createdDoc._id;
      } catch (dbError: any) {
        if (dbError?.code === 11000) {
          throw new AppError(
            409,
            "RESOURCE_CONFLICT",
            "A digital prescription has already been issued for this consultation encounter"
          );
        }
        throw dbError;
      }

      // Step B: Atomically link Prescription ID to Consultation
      // Guard against race conditions using atomic conditional check
      const consultationUpdate = await Consultation.updateOne(
        {
          _id: consultation._id,
          $or: [
            { prescriptionId: { $exists: false } },
            { prescriptionId: null },
          ],
        },
        { $set: { prescriptionId: createdPrescriptionId } },
        session ? { session } : {}
      );

      if (consultationUpdate.matchedCount === 0) {
        // Another concurrent request already linked a prescription to this consultation
        if (session) {
          await session.abortTransaction();
        } else if (createdPrescriptionId) {
          await Prescription.deleteOne({ _id: createdPrescriptionId });
        }
        throw new AppError(
          409,
          "RESOURCE_CONFLICT",
          "A digital prescription has already been issued for this consultation encounter"
        );
      }

      // If in transaction, commit
      if (session) {
        await session.commitTransaction();
      }
    } catch (error) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch {}
      } else if (createdPrescriptionId) {
        try {
          await Prescription.deleteOne({ _id: createdPrescriptionId });
        } catch {}
      }
      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }

    // 10. Side Effect: Asynchronous Fail-Safe Event Emission & Multi-Channel Notification
    try {
      const { io } = await import("../server.js");
      if (io) {
        io.to(`patient:${appointment.patientId}`).emit("PRESCRIPTION_ISSUED", {
          prescriptionId: prescription._id.toString(),
          patientId: appointment.patientId.toString(),
          doctorId: user.id,
          appointmentId: appointment._id.toString(),
          consultationId: consultation._id.toString(),
          issuedAt: prescription.issuedAt,
          expiresAt: prescription.expiresAt,
        });
      }
    } catch {}

    void notificationService
      .dispatch({
        userId: appointment.patientId,
        type: NotificationType.PRESCRIPTION_ISSUED,
        title: "Digital Prescription Issued",
        message: "Your doctor has issued a digital prescription for your consultation.",
        relatedEntityType: "Prescription",
        relatedEntityId: prescription._id,
        metadata: {
          appointmentId: appointment._id.toString(),
          consultationId: consultation._id.toString(),
        },
      })
      .catch(() => {});

    // 11. Side Effect: Fail-Safe Audit Log
    void auditLogService.log({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.PRESCRIPTION_ISSUED,
      resourceType: "Prescription",
      resourceId: prescription._id.toString(),
      patientId: appointment.patientId.toString(),
      status: "SUCCESS",
      metadata: {
        appointmentId: appointment._id.toString(),
        consultationId: consultation._id.toString(),
        itemCount: prescription.medicines.length,
        expiresAt: prescription.expiresAt,
      },
    });

    return prescription;
  }

  /**
   * Retrieves a prescription by identifier with strict zero-trust role authorization.
   *
   * Matrix Rules (docs/api/AUTHORIZATION_MATRIX.md Table line 62):
   * - Patient: Allowed if patient is the document owner.
   * - Doctor: Allowed if doctor is the issuing physician.
   * - Pharmacy: Allowed for verified pharmacy order fulfillment.
   * - Admin: Allowed for platform supervision with audit.
   *
   * @param user Authenticated caller
   * @param prescriptionId Prescription identifier
   * @returns Authorized IPrescription document
   */
  async getPrescriptionById(
    user: AuthenticatedUser,
    prescriptionId: string
  ): Promise<IPrescription> {
    if (!mongoose.Types.ObjectId.isValid(prescriptionId)) {
      throw AppError.badRequest("Invalid prescription ID format", "BAD_REQUEST");
    }

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      throw new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription not found");
    }

    const isPatientOwner =
      user.role === UserRole.PATIENT &&
      prescription.patientId.toString() === user.id;

    const isIssuingDoctor =
      user.role === UserRole.DOCTOR &&
      prescription.doctorId.toString() === user.id;

    let isAuthorizedPharmacy = false;
    if (user.role === UserRole.PHARMACY) {
      const pharmacyProfile = await PharmacyProfile.findOne({
        userId: new mongoose.Types.ObjectId(user.id),
      });

      if (
        pharmacyProfile &&
        pharmacyProfile.verificationStatus === PharmacyVerificationStatus.APPROVED_VERIFIED
      ) {
        // If an order exists in M10, verify it is assigned to this pharmacy:
        const order = await Order.findOne({ prescriptionId: prescription._id });
        if (order) {
          isAuthorizedPharmacy =
            order.pharmacyId?.toString() === pharmacyProfile._id.toString() ||
            order.pharmacyId?.toString() === user.id;
        } else {
          // In M9 before M10 order routing is implemented, verified pharmacies verifying prescriptions for orders
          isAuthorizedPharmacy = true;
        }
      }
    }

    const isAdmin = user.role === UserRole.ADMIN;

    if (!isPatientOwner && !isIssuingDoctor && !isAuthorizedPharmacy && !isAdmin) {
      throw AppError.forbidden(
        "Access denied: you do not have permission to view this digital prescription",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    return prescription;
  }

  /**
   * Rejects any mutation or deletion attempt on a finalized prescription with HTTP 409 Conflict.
   * Issued prescriptions are immutable legal medical records.
   *
   * @throws AppError 409 Conflict
   */
  rejectMutationOnFinalizedPrescription(): never {
    throw new AppError(
      409,
      "PRESCRIPTION_IMMUTABLE",
      "Issued digital prescriptions are immutable legal documents and cannot be edited"
    );
  }
}

export const prescriptionService = new PrescriptionService();
