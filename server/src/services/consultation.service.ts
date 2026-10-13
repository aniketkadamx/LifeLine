import mongoose from "mongoose";
import {
  Appointment,
  Consultation,
  DoctorProfile,
  Notification,
  User,
} from "../models/index.js";
import {
  AppointmentStatus,
  ConsultationStatus,
  ConsultationType,
  DoctorVerificationStatus,
  NotificationType,
  AuditAction,
  UserRole,
  type IConsultation,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { auditLogService } from "./audit-log.service.js";
import {
  generateLiveKitToken,
  getLiveKitUrl,
} from "../integrations/video/livekit.client.js";
import type { AuthenticatedUser } from "../types/express.js";
import type { SubmitClinicalNotesInput } from "../validators/consultation.validator.js";

/**
 * Result returned upon initializing or entering a consultation room session.
 */
export interface InitiateSessionResult {
  consultationId: string;
  appointmentId: string;
  roomId: string;
  roomUrl: string;
  status: ConsultationStatus;
  token: string;
  expiresInSeconds: number;
  livekitUrl?: string;
}

/**
 * Result returned upon participant token generation.
 */
export interface ParticipantTokenResult {
  consultationId: string;
  roomId: string;
  token: string;
  expiresInSeconds: number;
  status: ConsultationStatus;
  livekitUrl?: string;
}

/**
 * Result returned by the prescription unlock integration point.
 */
export interface PrescriptionUnlockStatus {
  unlocked: boolean;
  consultationId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  diagnosis?: string;
  status: ConsultationStatus;
}

export class ConsultationService {
  /**
   * Initializes or re-enters a virtual consultation room session for an eligible appointment.
   *
   * Enforces:
   * - Assigned doctor authentication and ownership
   * - Verified doctor profile status (DoctorVerificationStatus.APPROVED)
   * - Appointment eligibility (CONFIRMED / IN_PROGRESS; not CANCELLED, REJECTED, or COMPLETED)
   * - Payment settlement verification (paymentStatus === 'PAID')
   * - Permitted time window: room cannot be opened > 1 hour before scheduledStart, nor after scheduledEnd
   * - Idempotency and concurrency safety: repeated or parallel requests return the active room
   * - Socket.IO real-time notification to patient and audit logging
   *
   * Source: docs/api/STATE_MACHINES.md Section 1.2 & 2.2, docs/api/API_CONTRACT.md Group 7.1.
   */
  async initiateSession(
    user: AuthenticatedUser,
    appointmentId: string
  ): Promise<InitiateSessionResult> {
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      throw AppError.badRequest("Invalid appointment identifier format", "BAD_REQUEST");
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    }

    // 1. Authorization: Only assigned doctor
    if (user.role !== UserRole.DOCTOR || appointment.doctorId.toString() !== user.id) {
      throw AppError.forbidden(
        "Access denied: you are not the assigned doctor for this appointment",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 2. Doctor verification check: Must be APPROVED per STATE_MACHINES.md Section 6.2
    const doctorProfile = await DoctorProfile.findOne({ userId: appointment.doctorId });
    if (
      doctorProfile &&
      doctorProfile.verificationStatus !== DoctorVerificationStatus.APPROVED_VERIFIED
    ) {
      throw new AppError(
        403,
        "DOCTOR_NOT_VERIFIED",
        "Doctor profile is not verified to conduct virtual consultations"
      );
    }

    // 3. Appointment status eligibility
    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        "Cannot initialize consultation for a cancelled appointment"
      );
    }

    if (appointment.status === AppointmentStatus.REJECTED) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        "Cannot initialize consultation for a rejected appointment"
      );
    }

    if (appointment.status === AppointmentStatus.COMPLETED) {
      throw new AppError(
        409,
        "APPOINTMENT_ALREADY_COMPLETED",
        "Cannot initialize consultation for an appointment that has already been completed"
      );
    }

    if (appointment.status === AppointmentStatus.PENDING_PAYMENT) {
      throw new AppError(
        409,
        "APPOINTMENT_PAYMENT_REQUIRED",
        "Cannot initialize consultation for an appointment awaiting payment confirmation"
      );
    }

    if (
      appointment.status !== AppointmentStatus.CONFIRMED &&
      appointment.status !== AppointmentStatus.IN_PROGRESS
    ) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        `Cannot initialize consultation for appointment with status '${appointment.status}'`
      );
    }

    // 4. Payment settlement guard
    if (appointment.paymentStatus !== "PAID") {
      throw new AppError(
        402,
        "PAYMENT_REQUIRED",
        "Consultation room cannot be initialized for unpaid appointments"
      );
    }

    // 5. Authoritative Scheduled Time Window Check
    const nowMs = Date.now();
    const scheduledStartMs = appointment.scheduledStart.getTime();
    const scheduledEndMs = appointment.scheduledEnd.getTime();
    const ONE_HOUR_MS = 60 * 60 * 1000;

    // Doctor cannot open room more than 1 hour before scheduledStart
    if (nowMs < scheduledStartMs - ONE_HOUR_MS) {
      throw new AppError(
        422,
        "CONSULTATION_WINDOW_NOT_REACHED",
        "Cannot initialize consultation room more than one hour prior to scheduled appointment start"
      );
    }

    // Doctor cannot open room after scheduledEnd has passed
    if (nowMs > scheduledEndMs) {
      throw new AppError(
        422,
        "CONSULTATION_WINDOW_EXPIRED",
        "Scheduled appointment window has expired"
      );
    }

    // 6. Concurrency & Idempotency: Retrieve existing or create new Consultation
    const callerUser = await User.findById(user.id).select("fullName");
    const participantName = callerUser?.fullName;

    let consultation = await Consultation.findOne({ appointmentId: appointment._id });

    if (consultation) {
      // Terminal state guard
      if (consultation.status === ConsultationStatus.COMPLETED) {
        throw new AppError(
          409,
          "CONSULTATION_SESSION_CLOSED",
          "Consultation has already been completed"
        );
      }

      if (consultation.status === ConsultationStatus.ENDED) {
        throw new AppError(
          409,
          "CONSULTATION_SESSION_CLOSED",
          "Consultation session has ended; clinical documentation must be submitted"
        );
      }

      // Re-entering active room: return existing room metadata and mint a fresh signed LiveKit token
      const token = await generateLiveKitToken({
        roomName: consultation.roomId,
        participantIdentity: user.id,
        participantName,
        canPublish: true,
        canSubscribe: true,
        ttlSeconds: 3600,
      });

      return {
        consultationId: consultation._id.toString(),
        appointmentId: appointment._id.toString(),
        roomId: consultation.roomId,
        roomUrl: `/consultations/room/${consultation.roomId}`,
        status: consultation.status,
        token,
        expiresInSeconds: 3600,
        livekitUrl: getLiveKitUrl(),
      };
    }

    // 7. Initialize new consultation entity with canonical room name: consultation-<consultationId>
    const consultationId = new mongoose.Types.ObjectId();
    const roomId = `consultation-${consultationId.toString()}`;

    try {
      consultation = await Consultation.create({
        _id: consultationId,
        appointmentId: appointment._id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        consultationType: appointment.appointmentType || ConsultationType.VIDEO,
        status: ConsultationStatus.ROOM_OPENED,
        roomId,
        startedAt: new Date(),
      });
    } catch (err: any) {
      // Handle race condition on unique index (appointmentId: 1)
      if (err.code === 11000) {
        const raceConsultation = await Consultation.findOne({
          appointmentId: appointment._id,
        });
        if (raceConsultation) {
          const raceToken = await generateLiveKitToken({
            roomName: raceConsultation.roomId,
            participantIdentity: user.id,
            participantName,
            canPublish: true,
            canSubscribe: true,
            ttlSeconds: 3600,
          });
          return {
            consultationId: raceConsultation._id.toString(),
            appointmentId: appointment._id.toString(),
            roomId: raceConsultation.roomId,
            roomUrl: `/consultations/room/${raceConsultation.roomId}`,
            status: raceConsultation.status,
            token: raceToken,
            expiresInSeconds: 3600,
            livekitUrl: getLiveKitUrl(),
          };
        }
      }
      throw err;
    }

    // 8. Atomic transition of appointment to IN_PROGRESS & link consultationId
    await Appointment.updateOne(
      { _id: appointment._id },
      {
        $set: {
          status: AppointmentStatus.IN_PROGRESS,
          consultationId: consultation._id,
        },
      }
    );

    // 9. Side Effect: In-app notification for patient
    try {
      await Notification.create({
        userId: appointment.patientId,
        type: NotificationType.CONSULTATION_ROOM_OPENED,
        title: "Consultation Room Ready",
        message: "Your doctor has opened the virtual consultation room. You may now join.",
        relatedEntityType: "Consultation",
        relatedEntityId: consultation._id,
        metadata: {
          appointmentId: appointment._id.toString(),
          roomId: consultation.roomId,
        },
      });
    } catch {}

    // 10. Side Effect: Socket.IO event emission
    try {
      const { io } = await import("../server.js");
      if (io) {
        io.to(`patient:${appointment.patientId}`).emit("ROOM_READY", {
          consultationId: consultation._id.toString(),
          roomId: consultation.roomId,
          appointmentId: appointment._id.toString(),
        });
        io.to(`appointment:${appointment._id}`).emit("CONSULTATION_ROOM_OPENED", {
          consultationId: consultation._id.toString(),
          roomId: consultation.roomId,
        });
      }
    } catch {}

    // 11. Side Effect: Audit log
    void auditLogService.log({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.OTHER,
      resourceType: "Consultation",
      resourceId: consultation._id.toString(),
      patientId: appointment.patientId.toString(),
      status: "SUCCESS",
      metadata: {
        event: "CONSULTATION_ROOM_OPENED",
        appointmentId: appointment._id.toString(),
        doctorId: appointment.doctorId.toString(),
        roomId: consultation.roomId,
      },
    });

    // 12. Mint signed LiveKit token for the doctor
    const token = await generateLiveKitToken({
      roomName: consultation.roomId,
      participantIdentity: user.id,
      participantName,
      canPublish: true,
      canSubscribe: true,
      ttlSeconds: 3600,
    });

    return {
      consultationId: consultation._id.toString(),
      appointmentId: appointment._id.toString(),
      roomId: consultation.roomId,
      roomUrl: `/consultations/room/${consultation.roomId}`,
      status: consultation.status,
      token,
      expiresInSeconds: 3600,
      livekitUrl: getLiveKitUrl(),
    };
  }

  /**
   * Retrieves consultation record by identifier with strict participant authorization.
   *
   * Enforces:
   * - Only attending Doctor, attending Patient, or Admin may view consultation details.
   * - Non-attending doctor or patient receives 403 AUTH_RESOURCE_ACCESS_DENIED.
   */
  async getConsultation(
    user: AuthenticatedUser,
    consultationId: string
  ): Promise<IConsultation> {
    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      throw AppError.badRequest("Invalid consultation identifier format", "BAD_REQUEST");
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      throw new AppError(404, "CONSULTATION_NOT_FOUND", "Consultation not found");
    }

    // Authorization: Admin, attending Doctor, or attending Patient
    const isDoctor =
      user.role === UserRole.DOCTOR &&
      consultation.doctorId.toString() === user.id;
    const isPatient =
      user.role === UserRole.PATIENT &&
      consultation.patientId.toString() === user.id;
    const isAdmin = user.role === UserRole.ADMIN;

    if (!isDoctor && !isPatient && !isAdmin) {
      throw AppError.forbidden(
        "Access denied: you are not authorized to view this consultation",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    return consultation;
  }

  /**
   * Retrieves participant authorization token to join the active video room.
   *
   * Enforces:
   * - Only attending Doctor or Patient may retrieve token
   * - Rejects if room has not been initiated by doctor (CONSULTATION_NOT_STARTED)
   * - Rejects if consultation session is already ended or completed (CONSULTATION_SESSION_CLOSED)
   * - Transitions consultation state to IN_CONSULTATION when patient joins
   *
   * Source: docs/api/API_CONTRACT.md Group 7.2 & STATE_MACHINES.md Section 2.2.
   */
  async getParticipantToken(
    user: AuthenticatedUser,
    consultationId: string
  ): Promise<ParticipantTokenResult> {
    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      throw AppError.badRequest("Invalid consultation identifier format", "BAD_REQUEST");
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      throw new AppError(404, "CONSULTATION_NOT_FOUND", "Consultation not found");
    }

    // Participant verification: Attending Doctor or Attending Patient
    const isDoctor =
      user.role === UserRole.DOCTOR &&
      consultation.doctorId.toString() === user.id;
    const isPatient =
      user.role === UserRole.PATIENT &&
      consultation.patientId.toString() === user.id;

    if (!isDoctor && !isPatient) {
      throw AppError.forbidden(
        "Access denied: only the attending doctor and patient may access consultation room tokens",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // Appointment verification: ensure appointment was not cancelled or rejected
    const appointment = await Appointment.findById(consultation.appointmentId);
    if (
      appointment &&
      (appointment.status === AppointmentStatus.CANCELLED ||
        appointment.status === AppointmentStatus.REJECTED)
    ) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        `Cannot join consultation for an appointment with status '${appointment.status}'`
      );
    }

    // State guards
    if (consultation.status === ConsultationStatus.SCHEDULED) {
      throw new AppError(
        409,
        "CONSULTATION_NOT_STARTED",
        "Consultation room has not been initiated by the doctor"
      );
    }

    if (
      consultation.status === ConsultationStatus.COMPLETED ||
      consultation.status === ConsultationStatus.ENDED
    ) {
      throw new AppError(
        409,
        "CONSULTATION_SESSION_CLOSED",
        "Consultation video session has closed"
      );
    }

    // Patient join transition: ROOM_OPENED -> IN_CONSULTATION
    if (
      user.role === UserRole.PATIENT &&
      consultation.status === ConsultationStatus.ROOM_OPENED
    ) {
      consultation.status = ConsultationStatus.IN_CONSULTATION;
      await consultation.save();

      try {
        const { io } = await import("../server.js");
        if (io) {
          io.to(`consultation:${consultation._id}`).emit("PARTICIPANT_JOINED", {
            participantId: user.id,
            role: user.role,
          });
        }
      } catch {}
    }

    // Generate signed LiveKit participant token
    const callerUser = await User.findById(user.id).select("fullName");
    const participantName = callerUser?.fullName;

    const token = await generateLiveKitToken({
      roomName: consultation.roomId,
      participantIdentity: user.id,
      participantName,
      canPublish: true,
      canSubscribe: true,
      ttlSeconds: 3600,
    });

    return {
      consultationId: consultation._id.toString(),
      roomId: consultation.roomId,
      token,
      expiresInSeconds: 3600,
      status: consultation.status,
      livekitUrl: getLiveKitUrl(),
    };
  }

  /**
   * Concludes live call interaction and transitions consultation to ENDED.
   *
   * Enforces:
   * - Authorized participants only (attending Doctor or Patient)
   * - Valid state transition: IN_CONSULTATION / ROOM_OPENED -> ENDED
   * - Records total duration and endedAt timestamp
   * - Idempotent if already ENDED
   */
  async endSession(
    user: AuthenticatedUser,
    consultationId: string
  ): Promise<IConsultation> {
    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      throw AppError.badRequest("Invalid consultation identifier format", "BAD_REQUEST");
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      throw new AppError(404, "CONSULTATION_NOT_FOUND", "Consultation not found");
    }

    const isDoctor =
      user.role === UserRole.DOCTOR &&
      consultation.doctorId.toString() === user.id;
    const isPatient =
      user.role === UserRole.PATIENT &&
      consultation.patientId.toString() === user.id;
    const isAdmin = user.role === UserRole.ADMIN;

    if (!isDoctor && !isPatient && !isAdmin) {
      throw AppError.forbidden(
        "Access denied: you are not authorized to end this consultation",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    if (consultation.status === ConsultationStatus.COMPLETED) {
      throw new AppError(
        409,
        "CONSULTATION_ALREADY_COMPLETED",
        "Consultation has already been completed"
      );
    }

    if (consultation.status === ConsultationStatus.ENDED) {
      return consultation; // Idempotent
    }

    if (consultation.status === ConsultationStatus.SCHEDULED) {
      throw new AppError(
        409,
        "CONSULTATION_NOT_STARTED",
        "Consultation room has not been initiated yet"
      );
    }

    consultation.status = ConsultationStatus.ENDED;
    consultation.endedAt = new Date();
    if (consultation.startedAt) {
      consultation.durationSeconds = Math.max(
        0,
        Math.floor((consultation.endedAt.getTime() - consultation.startedAt.getTime()) / 1000)
      );
    }

    await consultation.save();

    try {
      const { io } = await import("../server.js");
      if (io) {
        io.to(`consultation:${consultation._id}`).emit("ROOM_CLOSED", {
          consultationId: consultation._id.toString(),
          durationSeconds: consultation.durationSeconds,
        });
      }
    } catch {}

    return consultation;
  }

  /**
   * Submits clinical notes and diagnosis to conclude consultation.
   *
   * Enforces:
   * - Role: Attending DOCTOR only
   * - Strict lifecycle state: Allowed ONLY from ENDED state per STATE_MACHINES.md Section 2.2
   * - Rejects if consultation is already COMPLETED (immutable post-completion)
   * - Rejects if consultation call has not yet ended
   * - Transitions consultation to COMPLETED
   * - Atomically transitions parent Appointment to COMPLETED
   * - Unlocks prescription generation integration point
   * - Logs clinical audit trail without exposing sensitive clinical text
   *
   * Source: docs/api/STATE_MACHINES.md Section 2.2 & API_CONTRACT.md Group 7.3.
   */
  async submitClinicalNotes(
    user: AuthenticatedUser,
    consultationId: string,
    input: SubmitClinicalNotesInput
  ): Promise<IConsultation & { prescriptionUnlocked: boolean }> {
    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      throw AppError.badRequest("Invalid consultation identifier format", "BAD_REQUEST");
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      throw new AppError(404, "CONSULTATION_NOT_FOUND", "Consultation not found");
    }

    // Authorization: Only attending doctor or Admin
    if (consultation.doctorId.toString() !== user.id && user.role !== UserRole.ADMIN) {
      throw AppError.forbidden(
        "Access denied: only the attending doctor may submit clinical documentation",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // Lifecycle state guard: Must be in ENDED state per STATE_MACHINES.md Section 2.2
    if (consultation.status === ConsultationStatus.COMPLETED) {
      throw new AppError(
        409,
        "CONSULTATION_ALREADY_COMPLETED",
        "Consultation is already completed; clinical documentation is finalized and immutable"
      );
    }

    if (consultation.status !== ConsultationStatus.ENDED) {
      throw new AppError(
        409,
        "CONSULTATION_INVALID_TRANSITION",
        `Cannot submit clinical documentation for consultation in '${consultation.status}' state. Consultation call must be ended first.`
      );
    }

    // Persist clinical documentation and finalize status
    consultation.diagnosis = input.diagnosis;
    consultation.clinicalNotes = input.clinicalNotes;
    if (input.recommendedFollowUpDays !== undefined) {
      consultation.recommendedFollowUpDays = input.recommendedFollowUpDays;
    }
    consultation.status = ConsultationStatus.COMPLETED;
    if (!consultation.endedAt) {
      consultation.endedAt = new Date();
    }

    await consultation.save();

    // Atomically transition parent appointment to COMPLETED
    await Appointment.updateOne(
      { _id: consultation.appointmentId },
      { $set: { status: AppointmentStatus.COMPLETED } }
    );

    // Side Effect: Real-time event emission
    try {
      const { io } = await import("../server.js");
      if (io) {
        io.to(`appointment:${consultation.appointmentId}`).emit("APPOINTMENT_COMPLETED", {
          appointmentId: consultation.appointmentId.toString(),
          consultationId: consultation._id.toString(),
        });
        io.to(`patient:${consultation.patientId}`).emit("CONSULTATION_COMPLETED", {
          consultationId: consultation._id.toString(),
          appointmentId: consultation.appointmentId.toString(),
        });
      }
    } catch {}

    // Side Effect: Audit trail (do NOT expose raw clinical notes/diagnosis text in audit payload)
    void auditLogService.log({
      actorId: user.id,
      actorRole: user.role,
      action: AuditAction.CLINICAL_NOTE_MODIFIED,
      resourceType: "Consultation",
      resourceId: consultation._id.toString(),
      patientId: consultation.patientId.toString(),
      status: "SUCCESS",
      metadata: {
        event: "CONSULTATION_COMPLETED",
        appointmentId: consultation.appointmentId.toString(),
        doctorId: consultation.doctorId.toString(),
        hasDiagnosis: Boolean(input.diagnosis),
        followUpDays: input.recommendedFollowUpDays,
      },
    });

    const resObj = consultation.toObject ? consultation.toObject() : consultation;
    return {
      ...resObj,
      prescriptionUnlocked: true,
    };
  }

  /**
   * Verifies whether prescription generation is unlocked for a given consultation.
   * Integration point for Milestone 9 (Prescriptions per docs/api/STATE_MACHINES.md Section 3.2).
   */
  async isPrescriptionUnlocked(
    consultationId: string
  ): Promise<PrescriptionUnlockStatus> {
    if (!mongoose.Types.ObjectId.isValid(consultationId)) {
      throw AppError.badRequest("Invalid consultation identifier format", "BAD_REQUEST");
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      throw new AppError(404, "CONSULTATION_NOT_FOUND", "Consultation not found");
    }

    return {
      unlocked: consultation.status === ConsultationStatus.COMPLETED,
      consultationId: consultation._id.toString(),
      appointmentId: consultation.appointmentId.toString(),
      patientId: consultation.patientId.toString(),
      doctorId: consultation.doctorId.toString(),
      diagnosis: consultation.diagnosis,
      status: consultation.status,
    };
  }
}

export const consultationService = new ConsultationService();
