import crypto from "node:crypto";
import mongoose from "mongoose";
import { Appointment } from "../models/appointment.model.js";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import {
  IdempotencyRecord,
  IdempotencyStatus,
} from "../models/idempotency.model.js";
import {
  AppointmentStatus,
  DoctorVerificationStatus,
  UserStatus,
  UserRole,
  AuditAction,
  type IAppointment,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { auditLogService } from "./audit-log.service.js";
import { availabilityService } from "./availability.service.js";
import type {
  CreateAppointmentInput,
  ListAppointmentsQuery,
  RescheduleAppointmentInput,
} from "../validators/appointment.validator.js";
import type { AuthenticatedUser } from "../types/express.js";

export const IDEMPOTENCY_LEASE_MS = 60_000; // 60 seconds lease for active reservation processing

export interface AppointmentReservationResult {
  appointmentId: string;
  status: AppointmentStatus;
  expiresAt: string;
  fee: number;
  currency: string;
  isReplayed?: boolean;
}

/**
 * Service managing appointment slot reservation, concurrency locks,
 * and idempotency guarantees.
 */
export class AppointmentService {
  /**
   * Helper: checks if a MongoDB error is a duplicate key error specifically
   * on the appointment slot compound unique index (doctorId + scheduledStart).
   */
  private isSlotDuplicateKeyError(err: unknown): boolean {
    if (
      typeof err === "object" &&
      err !== null &&
      ("code" in err || "name" in err)
    ) {
      const code = (err as { code?: number }).code;
      const name = (err as { name?: string }).name;
      if (code === 11000 || (name === "MongoServerError" && code === 11000)) {
        const mongoErr = err as {
          keyPattern?: Record<string, unknown>;
          keyValue?: Record<string, unknown>;
          message?: string;
        };
        const keyPattern = mongoErr.keyPattern || mongoErr.keyValue;
        if (keyPattern && "doctorId" in keyPattern && "scheduledStart" in keyPattern) {
          return true;
        }
        if (
          typeof mongoErr.message === "string" &&
          mongoErr.message.includes("doctorId_1_scheduledStart_1")
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Helper: checks if a MongoDB error is a duplicate key error specifically
   * on the patientId + idempotencyKey unique constraint.
   */
  private isIdempotencyDuplicateKeyError(err: unknown): boolean {
    if (
      typeof err === "object" &&
      err !== null &&
      ("code" in err || "name" in err)
    ) {
      const code = (err as { code?: number }).code;
      const name = (err as { name?: string }).name;
      if (code === 11000 || (name === "MongoServerError" && code === 11000)) {
        const mongoErr = err as {
          keyPattern?: Record<string, unknown>;
          keyValue?: Record<string, unknown>;
          message?: string;
        };
        const keyPattern = mongoErr.keyPattern || mongoErr.keyValue;
        if (keyPattern && "idempotencyKey" in keyPattern) {
          return true;
        }
        if (
          typeof mongoErr.message === "string" &&
          (mongoErr.message.includes("idempotencyKey") ||
            mongoErr.message.includes("patientId_1_idempotencyKey_1"))
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Helper: reconstructs the standard appointment reservation result
   * from an existing appointment document.
   */
  private buildReplayResponse(
    appointment: any,
    isReplayed = true
  ): AppointmentReservationResult {
    const createdAtMs = appointment.createdAt
      ? new Date(appointment.createdAt).getTime()
      : Date.now();
    const expiresAtIso = appointment.lockExpiresAt
      ? new Date(appointment.lockExpiresAt).toISOString()
      : new Date(createdAtMs + 15 * 60 * 1000).toISOString();

    return {
      appointmentId: appointment._id.toString(),
      status: appointment.status,
      expiresAt: expiresAtIso,
      fee: appointment.fee,
      currency: appointment.currency,
      isReplayed,
    };
  }

  /**
   * Internal worker: executes the atomic reservation insert into MongoDB.
   */
  private async executeSlotReservation(
    patientUserId: string,
    doctorProfile: any,
    input: CreateAppointmentInput,
    scheduledStart: Date,
    scheduledEnd: Date,
    idempotencyKey?: string
  ): Promise<AppointmentReservationResult> {
    const doctorTargetId =
      doctorProfile.userId._id || doctorProfile.userId;

    // Concurrency preparation: release any previously expired PENDING_PAYMENT lock
    // on this exact slot so expired reservations do not block new bookings.
    // Conservative: only cancel if lockExpiresAt is explicitly set and in the past.
    await Appointment.updateMany(
      {
        doctorId: doctorTargetId,
        scheduledStart,
        status: AppointmentStatus.PENDING_PAYMENT,
        lockExpiresAt: { $lte: new Date(), $exists: true, $ne: null },
      },
      {
        $set: {
          status: AppointmentStatus.CANCELLED,
          "cancellation.reason": "15-minute reservation lock expired without payment",
          "cancellation.cancelledAt": new Date(),
        },
      }
    );

    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60 * 1000); // Exactly 15 minutes TTL

    const fee = doctorProfile.consultationFee;
    const currency = "INR";

    const appointment = new Appointment({
      patientId: new mongoose.Types.ObjectId(patientUserId),
      doctorId: doctorTargetId,
      appointmentType: input.appointmentType,
      scheduledStart,
      scheduledEnd,
      status: AppointmentStatus.PENDING_PAYMENT,
      reason: input.reason.trim(),
      fee,
      currency,
      lockExpiresAt: expiresAt,
      idempotencyKey,
    });

    try {
      await appointment.save();
    } catch (saveError: unknown) {
      if (this.isSlotDuplicateKeyError(saveError)) {
        throw new AppError(
          409,
          "APPOINTMENT_SLOT_UNAVAILABLE",
          "Slot is already reserved or booked by another patient"
        );
      }
      if (this.isIdempotencyDuplicateKeyError(saveError)) {
        throw new AppError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "An appointment for this idempotency key was already created"
        );
      }
      throw saveError;
    }

    return {
      appointmentId: appointment._id.toString(),
      status: AppointmentStatus.PENDING_PAYMENT,
      expiresAt: expiresAt.toISOString(),
      fee,
      currency,
    };
  }

  /**
   * Reserves an appointment slot with atomic double-booking concurrency locking
   * and 24-hour idempotency protection.
   *
   * Endpoint: POST /api/v1/appointments
   * Source: docs/api/API_CONTRACT.md Section 6.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.1.
   */
  public async createReservation(
    patientUserId: string,
    input: CreateAppointmentInput,
    idempotencyKey?: string,
    clientContext?: { ipAddress?: string; userAgent?: string }
  ): Promise<AppointmentReservationResult> {
    if (!mongoose.Types.ObjectId.isValid(patientUserId)) {
      throw AppError.badRequest("Invalid patient identifier format", "BAD_REQUEST");
    }

    if (!mongoose.Types.ObjectId.isValid(input.doctorId)) {
      throw AppError.badRequest("Invalid doctor identifier format", "BAD_REQUEST");
    }

    const scheduledStart = new Date(input.scheduledStart);
    if (isNaN(scheduledStart.getTime())) {
      throw AppError.badRequest(
        "Invalid scheduledStart datetime",
        "BAD_REQUEST"
      );
    }

    const userObjectId = new mongoose.Types.ObjectId(patientUserId);
    let recordClaimed = false;
    let currentOwnerToken: string | undefined;

    // 1. Idempotency Check & Claim (if Idempotency-Key provided)
    if (idempotencyKey) {
      const normalizedPayload = {
        doctorId: input.doctorId,
        appointmentType: input.appointmentType,
        scheduledStart: scheduledStart.toISOString(),
        reason: input.reason.trim(),
      };

      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");

      const expiresAt24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const leaseExpiresAt = new Date(Date.now() + IDEMPOTENCY_LEASE_MS);
      const initialOwnerToken = crypto.randomUUID();

      try {
        await IdempotencyRecord.create({
          key: idempotencyKey,
          userId: userObjectId,
          operation: "APPOINTMENT_RESERVATION",
          requestHash,
          status: IdempotencyStatus.PROCESSING,
          ownerToken: initialOwnerToken,
          lockedUntil: leaseExpiresAt,
          expiresAt: expiresAt24h,
        });
        currentOwnerToken = initialOwnerToken;
        recordClaimed = true;
      } catch (idempError: unknown) {
        // If duplicate key error on (key, userId, operation), inspect existing record
        if (
          typeof idempError === "object" &&
          idempError !== null &&
          ("code" in idempError || "name" in idempError) &&
          (idempError as { code?: number }).code === 11000
        ) {
          const existing = await IdempotencyRecord.findOne({
            key: idempotencyKey,
            userId: userObjectId,
            operation: "APPOINTMENT_RESERVATION",
          });

          if (!existing) {
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Request with identical idempotency key is already processing"
            );
          }

          // 1A. Deterministic Payload Mismatch Rejection
          if (existing.requestHash !== requestHash) {
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency key reused with conflicting request payload"
            );
          }

          // 1B. Completed Record Replay
          if (existing.status === IdempotencyStatus.COMPLETED) {
            const cachedData = existing.responseData as any;
            return {
              appointmentId: cachedData.appointmentId,
              status: cachedData.status,
              expiresAt: cachedData.expiresAt,
              fee: cachedData.fee,
              currency: cachedData.currency,
              isReplayed: true,
            };
          }

          // 1C. Active vs Stale PROCESSING Claim Recovery
          const nowMs = Date.now();
          const isLeaseActive =
            existing.lockedUntil &&
            existing.lockedUntil.getTime() > nowMs;

          if (isLeaseActive) {
            // Live in-flight request holds the lease
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Request with identical idempotency key is currently being processed"
            );
          }

          // Stale / abandoned claim: atomically acquire the stale lease with a NEW ownerToken FIRST
          const newOwnerToken = crypto.randomUUID();
          const acquired = await IdempotencyRecord.findOneAndUpdate(
            {
              _id: existing._id,
              status: IdempotencyStatus.PROCESSING,
              $or: [
                { lockedUntil: { $lte: new Date(nowMs) } },
                { lockedUntil: { $exists: false } },
              ],
            },
            {
              $set: {
                ownerToken: newOwnerToken,
                lockedUntil: new Date(nowMs + IDEMPOTENCY_LEASE_MS),
              },
            },
            { new: true }
          );

          if (!acquired) {
            // Another concurrent recovery request acquired the stale lease or completed it
            const latest = await IdempotencyRecord.findById(existing._id);
            if (latest && latest.status === IdempotencyStatus.COMPLETED) {
              const cachedData = latest.responseData as any;
              return {
                appointmentId: cachedData.appointmentId,
                status: cachedData.status,
                expiresAt: cachedData.expiresAt,
                fee: cachedData.fee,
                currency: cachedData.currency,
                isReplayed: true,
              };
            }
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Request with identical idempotency key is currently being processed"
            );
          }

          currentOwnerToken = newOwnerToken;
          recordClaimed = true;

          // With ownership established, check if an appointment was already created previously!
          const existingAppointment = await Appointment.findOne({
            patientId: userObjectId,
            idempotencyKey,
            status: {
              $in: [
                AppointmentStatus.PENDING_PAYMENT,
                AppointmentStatus.CONFIRMED,
                AppointmentStatus.IN_PROGRESS,
              ],
            },
          });

          if (existingAppointment) {
            // Reconstruct original response from persisted appointment
            const result = this.buildReplayResponse(existingAppointment, true);

            // Conditional update strictly fenced by our current ownerToken and PROCESSING status
            const updateResult = await IdempotencyRecord.updateOne(
              {
                _id: existing._id,
                status: IdempotencyStatus.PROCESSING,
                ownerToken: currentOwnerToken,
              },
              {
                $set: {
                  status: IdempotencyStatus.COMPLETED,
                  responseStatus: 201,
                  responseData: result,
                  responseMessage:
                    "Slot reserved for 15 minutes. Please complete payment.",
                  appointmentId: existingAppointment._id,
                },
                $unset: { lockedUntil: 1, ownerToken: 1 },
              }
            );

            if (updateResult.matchedCount === 0) {
              // Ownership was lost (lease expired and taken over by another request) before update executed!
              recordClaimed = false; // Do not mutate or delete on failure
              const latestRecord = await IdempotencyRecord.findById(existing._id);
              if (
                latestRecord &&
                latestRecord.status === IdempotencyStatus.COMPLETED
              ) {
                const cachedData = latestRecord.responseData as any;
                return {
                  appointmentId: cachedData.appointmentId,
                  status: cachedData.status,
                  expiresAt: cachedData.expiresAt,
                  fee: cachedData.fee,
                  currency: cachedData.currency,
                  isReplayed: true,
                };
              }
              throw new AppError(
                409,
                "IDEMPOTENCY_CONFLICT",
                "Request with identical idempotency key is currently being processed"
              );
            }

            recordClaimed = false; // Successfully completed, no cleanup needed
            return result;
          }
        } else {
          throw idempError;
        }
      }
    }

    try {
      // 2. Resolve doctor profile and verify eligibility
      const doctorObjectId = new mongoose.Types.ObjectId(input.doctorId);

      const doctorProfile = await DoctorProfile.findOne({
        $or: [{ _id: doctorObjectId }, { userId: doctorObjectId }],
      }).populate<{ userId: { _id: mongoose.Types.ObjectId; status: UserStatus } }>(
        "userId",
        "status"
      );

      if (!doctorProfile) {
        throw AppError.notFound("Doctor not found", "DOCTOR_NOT_FOUND");
      }

      if (
        doctorProfile.verificationStatus !==
        DoctorVerificationStatus.APPROVED_VERIFIED
      ) {
        throw AppError.forbidden(
          "Doctor is not verified by admin; cannot accept appointments",
          "DOCTOR_NOT_VERIFIED"
        );
      }

      if (
        !doctorProfile.userId ||
        doctorProfile.userId.status !== UserStatus.ACTIVE
      ) {
        throw AppError.forbidden(
          "Doctor account is not active; cannot accept appointments",
          "DOCTOR_NOT_VERIFIED"
        );
      }

      // 3. Validate scheduled datetime against past time
      if (scheduledStart.getTime() <= Date.now()) {
        throw new AppError(
          422,
          "APPOINTMENT_PAST_DATE",
          "Appointment cannot be scheduled in the past"
        );
      }

      const doctorTargetId =
        doctorProfile.userId._id || doctorProfile.userId;

      // 4. Pre-computation cleanup of expired locks:
      // Clean up any expired PENDING_PAYMENT reservation on this exact slot
      // BEFORE checking availability so that computeAvailableSlots sees the slot as free in DB.
      // Follow conservative policy: only cancel if lockExpiresAt is explicitly set and in the past.
      await Appointment.updateMany(
        {
          doctorId: doctorTargetId,
          scheduledStart,
          status: AppointmentStatus.PENDING_PAYMENT,
          lockExpiresAt: { $lte: new Date(), $exists: true, $ne: null },
        },
        {
          $set: {
            status: AppointmentStatus.CANCELLED,
            "cancellation.reason": "15-minute reservation lock expired without payment",
            "cancellation.cancelledAt": new Date(),
          },
        }
      );

      // 5. Validate against doctor schedule and availability engine
      const dateStr = scheduledStart.toISOString().slice(0, 10);
      const timeStr = scheduledStart.toISOString().slice(11, 16);

      const availabilityResult = await availabilityService.computeAvailableSlots(
        doctorProfile._id.toString(),
        dateStr
      );

      const matchingSlot = availabilityResult.slots.find(
        (slot) => slot.startTime === timeStr
      );

      if (!matchingSlot) {
        throw new AppError(
          409,
          "APPOINTMENT_SLOT_UNAVAILABLE",
          "The requested appointment slot is outside doctor working shifts"
        );
      }

      if (!matchingSlot.available) {
        throw new AppError(
          409,
          "APPOINTMENT_SLOT_UNAVAILABLE",
          "Slot is already reserved or booked by another patient"
        );
      }

      // Calculate slot end time based on slot duration
      const [startH, startM] = matchingSlot.startTime.split(":").map(Number);
      const [endH, endM] = matchingSlot.endTime.split(":").map(Number);
      const durationMinutes = endH * 60 + endM - (startH * 60 + startM);
      const scheduledEnd = new Date(
        scheduledStart.getTime() + durationMinutes * 60 * 1000
      );

      // Pre-creation ownership fence: verify we still hold active ownership before persisting
      if (idempotencyKey && currentOwnerToken) {
        const stillOwner = await IdempotencyRecord.exists({
          key: idempotencyKey,
          userId: userObjectId,
          operation: "APPOINTMENT_RESERVATION",
          ownerToken: currentOwnerToken,
          status: IdempotencyStatus.PROCESSING,
        });

        if (!stillOwner) {
          throw new AppError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency claim lease expired and was acquired by another request"
          );
        }
      }

      // 6. Execute atomic slot reservation
      const result = await this.executeSlotReservation(
        patientUserId,
        doctorProfile,
        input,
        scheduledStart,
        scheduledEnd,
        idempotencyKey
      );

      // If idempotency was active, mark record as COMPLETED conditional on currentOwnerToken
      if (idempotencyKey && recordClaimed && currentOwnerToken) {
        const updateResult = await IdempotencyRecord.updateOne(
          {
            key: idempotencyKey,
            userId: userObjectId,
            operation: "APPOINTMENT_RESERVATION",
            ownerToken: currentOwnerToken, // Fenced update
          },
          {
            $set: {
              status: IdempotencyStatus.COMPLETED,
              responseStatus: 201,
              responseData: result,
              responseMessage:
                "Slot reserved for 15 minutes. Please complete payment.",
              appointmentId: new mongoose.Types.ObjectId(result.appointmentId),
            },
            $unset: { lockedUntil: 1, ownerToken: 1 },
          }
        );

        if (updateResult.matchedCount === 0) {
          // Ownership was lost after reservation creation!
          const currentRecord = await IdempotencyRecord.findOne({
            key: idempotencyKey,
            userId: userObjectId,
            operation: "APPOINTMENT_RESERVATION",
          });
          if (currentRecord?.status !== IdempotencyStatus.COMPLETED) {
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Idempotency claim lease expired and was acquired by another request"
            );
          }
        }
      }

      // Asynchronous audit logging (fail-safe)
      void auditLogService.log({
        actorId: patientUserId,
        actorRole: UserRole.PATIENT,
        action: AuditAction.APPOINTMENT_CREATED,
        resourceType: "Appointment",
        resourceId: result.appointmentId,
        ipAddress: clientContext?.ipAddress,
        userAgent: clientContext?.userAgent,
        metadata: {
          doctorId: (
            doctorProfile.userId._id || doctorProfile.userId
          ).toString(),
          doctorProfileId: doctorProfile._id.toString(),
          scheduledStart: scheduledStart.toISOString(),
          appointmentType: input.appointmentType,
          fee: result.fee,
          currency: result.currency,
          ...(idempotencyKey ? { idempotencyKey } : {}),
        },
        status: "SUCCESS",
      });

      return result;
    } catch (error) {
      // Safe recovery on failure conditional on currentOwnerToken:
      if (idempotencyKey && recordClaimed && currentOwnerToken) {
        // Did the appointment actually get created?
        const persistedAppt = await Appointment.findOne({
          patientId: userObjectId,
          idempotencyKey,
        });

        if (persistedAppt) {
          // The appointment WAS created, but a subsequent step failed.
          // DO NOT delete the idempotency claim! Try to complete it conditionally on ownerToken
          try {
            const replayed = this.buildReplayResponse(persistedAppt, true);
            await IdempotencyRecord.updateOne(
              {
                key: idempotencyKey,
                userId: userObjectId,
                operation: "APPOINTMENT_RESERVATION",
                ownerToken: currentOwnerToken, // Fenced!
              },
              {
                $set: {
                  status: IdempotencyStatus.COMPLETED,
                  responseStatus: 201,
                  responseData: replayed,
                  responseMessage:
                    "Slot reserved for 15 minutes. Please complete payment.",
                  appointmentId: persistedAppt._id,
                },
                $unset: { lockedUntil: 1, ownerToken: 1 },
              }
            );
          } catch {
            // Leave in PROCESSING with lockedUntil so retry recovery can handle it
          }
        } else {
          // The appointment definitely was NOT created.
          // Safely delete the claim ONLY if we are still the current owner!
          await IdempotencyRecord.deleteOne({
            key: idempotencyKey,
            userId: userObjectId,
            operation: "APPOINTMENT_RESERVATION",
            ownerToken: currentOwnerToken, // Fenced! Old owner cannot delete new owner's claim!
          });
        }
      }
      throw error;
    }
  }

  /**
   * List appointments with role-based scoping, date range filtering, and pagination.
   * Endpoint: GET /api/v1/appointments
   * Source: docs/api/API_CONTRACT.md Section 6.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
   */
  async listAppointments(
    actor: AuthenticatedUser,
    query: ListAppointmentsQuery
  ): Promise<{
    appointments: IAppointment[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = {};

    // 1. Role-based scoping (strictly server-side derived identity)
    if (actor.role === UserRole.PATIENT) {
      filter.patientId = new mongoose.Types.ObjectId(actor.id);
    } else if (actor.role === UserRole.DOCTOR) {
      const docProfile = await DoctorProfile.findOne({ userId: actor.id });
      if (docProfile) {
        filter.doctorId = {
          $in: [
            new mongoose.Types.ObjectId(actor.id),
            docProfile._id,
          ],
        };
      } else {
        filter.doctorId = new mongoose.Types.ObjectId(actor.id);
      }
    } else if (actor.role === UserRole.ADMIN) {
      if (query.patientId) {
        filter.patientId = new mongoose.Types.ObjectId(query.patientId);
      }
      if (query.doctorId) {
        filter.doctorId = new mongoose.Types.ObjectId(query.doctorId);
      }
    } else {
      throw AppError.forbidden(
        "Access denied: role not permitted to view appointments",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // 2. Status filtering
    if (query.status) {
      filter.status = query.status;
    }

    // 3. Date range filtering on scheduledStart
    if (query.from || query.to) {
      const dateFilter: Record<string, Date> = {};
      if (query.from) {
        dateFilter.$gte = new Date(query.from);
      }
      if (query.to) {
        dateFilter.$lte = new Date(query.to);
      }
      filter.scheduledStart = dateFilter;
    }

    // 4. Pagination & sorting
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const allowedSortFields = [
      "scheduledStart",
      "createdAt",
      "updatedAt",
      "fee",
      "status",
    ];
    const sortField = allowedSortFields.includes(query.sort || "")
      ? query.sort!
      : "scheduledStart";
    const sortOrder: 1 | -1 = query.order === "asc" ? 1 : -1;

    const [total, appointments] = await Promise.all([
      Appointment.countDocuments(filter),
      Appointment.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .exec(),
    ]);

    return {
      appointments,
      total,
      page,
      limit,
    };
  }

  /**
   * Cancel a scheduled appointment with 2-hour policy enforcement and atomic state transition.
   * Endpoint: PATCH /api/v1/appointments/:id/cancel
   * Source: docs/api/API_CONTRACT.md Section 6.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
   */
  async cancelAppointment(
    appointmentId: string,
    actor: AuthenticatedUser,
    cancellationReason: string,
    clientContext?: { ipAddress?: string; userAgent?: string }
  ): Promise<IAppointment> {
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      throw AppError.badRequest(
        "Invalid appointment identifier format",
        "BAD_REQUEST"
      );
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    }

    // 1. Ownership authorization verification
    if (actor.role === UserRole.PATIENT) {
      if (appointment.patientId.toString() !== actor.id) {
        throw AppError.forbidden(
          "Access denied: you do not have ownership of this appointment",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }
    } else if (actor.role === UserRole.DOCTOR) {
      let isAssignedDoctor = appointment.doctorId.toString() === actor.id;
      if (!isAssignedDoctor) {
        const docProfile = await DoctorProfile.findOne({ userId: actor.id });
        if (
          docProfile &&
          appointment.doctorId.toString() === docProfile._id.toString()
        ) {
          isAssignedDoctor = true;
        }
      }
      if (!isAssignedDoctor) {
        throw AppError.forbidden(
          "Access denied: you are not the assigned doctor for this appointment",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }
    } else if (actor.role === UserRole.ADMIN) {
      // Admin is explicitly permitted per authorization matrix
    } else {
      throw AppError.forbidden(
        "Access denied: role not permitted to cancel appointments",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // 2. Two-Hour Cancellation Policy Rule (Patient only)
    if (actor.role === UserRole.PATIENT) {
      const nowMs = Date.now();
      const scheduledStartMs = appointment.scheduledStart.getTime();
      const timeRemainingMs = scheduledStartMs - nowMs;
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

      if (timeRemainingMs <= TWO_HOURS_MS) {
        throw new AppError(
          422,
          "APPOINTMENT_CANCELLATION_WINDOW_EXPIRED",
          "Cannot cancel appointment within 2 hours of scheduled start time"
        );
      }
    }

    // 3. State machine validation
    if (appointment.status === AppointmentStatus.COMPLETED) {
      throw new AppError(
        409,
        "APPOINTMENT_ALREADY_COMPLETED",
        "Cannot cancel an appointment that has already been completed"
      );
    }

    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        "Appointment is already cancelled"
      );
    }

    const cancellableStatuses = [
      AppointmentStatus.PENDING_PAYMENT,
      AppointmentStatus.CONFIRMED,
    ];
    if (!cancellableStatuses.includes(appointment.status)) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        `Cannot cancel appointment with current status '${appointment.status}'`
      );
    }

    // 4. Conditional atomic state transition in MongoDB
    // By transitioning status to CANCELLED, the appointment is automatically excluded
    // from the partial unique active-slot index { doctorId: 1, scheduledStart: 1 },
    // atomically freeing the slot for new bookings.
    // Detects concurrent status changes or schedule shifts by matching current status & scheduledStart.
    const updated = await Appointment.findOneAndUpdate(
      {
        _id: appointment._id,
        status: { $in: cancellableStatuses },
        scheduledStart: appointment.scheduledStart,
      },
      {
        $set: {
          status: AppointmentStatus.CANCELLED,
          cancellation: {
            reason: cancellationReason.trim(),
            cancelledBy: new mongoose.Types.ObjectId(actor.id),
            cancelledAt: new Date(),
          },
        },
        $unset: { lockExpiresAt: 1 },
      },
      { new: true }
    );

    if (!updated) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        "Appointment status or schedule was modified concurrently"
      );
    }

    // 5. Asynchronous audit logging
    void auditLogService.log({
      actorId: actor.id,
      actorRole: actor.role as UserRole,
      action: AuditAction.APPOINTMENT_CANCELLED,
      resourceType: "Appointment",
      resourceId: updated._id.toString(),
      ipAddress: clientContext?.ipAddress,
      userAgent: clientContext?.userAgent,
      metadata: {
        doctorId: updated.doctorId.toString(),
        patientId: updated.patientId.toString(),
        scheduledStart: updated.scheduledStart.toISOString(),
        cancellationReason: cancellationReason.trim(),
        previousStatus: appointment.status,
      },
      status: "SUCCESS",
    });

    return updated;
  }

  /**
   * Reschedule an appointment to a new slot with atomic slot shifting.
   * Endpoint: PATCH /api/v1/appointments/:id/reschedule
   * Source: docs/api/API_CONTRACT.md & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
   */
  async rescheduleAppointment(
    appointmentId: string,
    actor: AuthenticatedUser,
    input: RescheduleAppointmentInput,
    clientContext?: { ipAddress?: string; userAgent?: string }
  ): Promise<IAppointment> {
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      throw AppError.badRequest(
        "Invalid appointment identifier format",
        "BAD_REQUEST"
      );
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    }

    // 1. Ownership authorization verification
    if (actor.role === UserRole.PATIENT) {
      if (appointment.patientId.toString() !== actor.id) {
        throw AppError.forbidden(
          "Access denied: you do not have ownership of this appointment",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }
    } else if (actor.role === UserRole.DOCTOR) {
      let isAssignedDoctor = appointment.doctorId.toString() === actor.id;
      if (!isAssignedDoctor) {
        const docProfile = await DoctorProfile.findOne({ userId: actor.id });
        if (
          docProfile &&
          appointment.doctorId.toString() === docProfile._id.toString()
        ) {
          isAssignedDoctor = true;
        }
      }
      if (!isAssignedDoctor) {
        throw AppError.forbidden(
          "Access denied: you are not the assigned doctor for this appointment",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }
    } else if (actor.role === UserRole.ADMIN) {
      // Admin is explicitly permitted per authorization matrix
    } else {
      throw AppError.forbidden(
        "Access denied: role not permitted to reschedule appointments",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // 2. State eligibility (strictly CONFIRMED per STATE_MACHINES.md)
    if (appointment.status === AppointmentStatus.COMPLETED) {
      throw new AppError(
        409,
        "APPOINTMENT_ALREADY_COMPLETED",
        "Cannot modify a completed appointment"
      );
    }

    if (appointment.status === AppointmentStatus.CANCELLED) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        "Cannot reschedule a cancelled appointment"
      );
    }

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        `Cannot reschedule appointment with status '${appointment.status}'. Only confirmed appointments can be rescheduled.`
      );
    }

    // 3. Four-Hour Rescheduling Policy Cutoff (STATE_MACHINES.md: current time < scheduledStart - 4h)
    if (actor.role !== UserRole.ADMIN) {
      const nowMs = Date.now();
      const scheduledStartMs = appointment.scheduledStart.getTime();
      const timeRemainingMs = scheduledStartMs - nowMs;
      const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

      if (timeRemainingMs <= FOUR_HOURS_MS) {
        throw new AppError(
          422,
          "APPOINTMENT_RESCHEDULE_WINDOW_EXPIRED",
          "Cannot reschedule appointment when 4 hours or less remain before scheduled start time"
        );
      }
    }

    // 3. Validate target schedule
    const targetStartString = input.scheduledStart || input.newScheduledStart!;
    const newScheduledStart = new Date(targetStartString);
    if (isNaN(newScheduledStart.getTime())) {
      throw AppError.unprocessable(
        "Invalid scheduled start datetime",
        "VALIDATION_ERROR",
        [{ field: "scheduledStart", issue: "Invalid scheduled start datetime" }]
      );
    }

    if (newScheduledStart.getTime() <= Date.now()) {
      throw new AppError(
        422,
        "APPOINTMENT_PAST_DATE",
        "Appointment cannot be scheduled in the past"
      );
    }

    // If rescheduling to the exact same start time, nothing to shift
    if (newScheduledStart.getTime() === appointment.scheduledStart.getTime()) {
      return appointment;
    }

    // Calculate new end time preserving duration
    const durationMs =
      appointment.scheduledEnd.getTime() - appointment.scheduledStart.getTime();
    const newScheduledEnd = new Date(newScheduledStart.getTime() + durationMs);

    // 4. Verify Doctor Profile and eligibility
    const doctorProfile = await DoctorProfile.findOne({
      userId: appointment.doctorId,
    });
    if (!doctorProfile) {
      throw new AppError(404, "DOCTOR_NOT_FOUND", "Doctor profile not found");
    }
    if (
      doctorProfile.verificationStatus !==
      DoctorVerificationStatus.APPROVED_VERIFIED
    ) {
      throw new AppError(
        403,
        "DOCTOR_NOT_VERIFIED",
        "Doctor profile is not verified"
      );
    }

    // 5. Target slot availability verification
    // Use computeAvailableSlots to verify doctor working shifts, slot duration alignment, and exceptions
    const targetDateStr = newScheduledStart.toISOString().split("T")[0];
    const availability = await availabilityService.computeAvailableSlots(
      doctorProfile._id.toString(),
      targetDateStr
    );

    const targetTimeStr = newScheduledStart.toISOString().substring(11, 16);
    const targetSlot = availability.slots.find(
      (s) => s.startTime === targetTimeStr
    );

    if (!targetSlot || !targetSlot.available) {
      throw new AppError(
        409,
        "APPOINTMENT_SLOT_UNAVAILABLE",
        "Requested appointment slot is not available"
      );
    }

    // 6. Atomic Slot Shifting
    // Conditional single-document update guarantees that:
    // a) The appointment status and scheduledStart haven't changed concurrently (prevents stale-read lost updates).
    // b) If the target slot conflicts, MongoDB's partial unique index
    //    { doctorId: 1, scheduledStart: 1 } throws E11000 duplicate key error,
    //    which leaves the original reservation completely intact.
    try {
      const updated = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          status: appointment.status,
          scheduledStart: appointment.scheduledStart,
        },
        {
          $set: {
            scheduledStart: newScheduledStart,
            scheduledEnd: newScheduledEnd,
            ...(input.reason ? { reason: input.reason.trim() } : {}),
          },
        },
        { new: true }
      );

      if (!updated) {
        throw new AppError(
          409,
          "APPOINTMENT_INVALID_TRANSITION",
          "Appointment status or schedule changed concurrently"
        );
      }

      // Asynchronous audit logging
      void auditLogService.log({
        actorId: actor.id,
        actorRole: actor.role as UserRole,
        action: AuditAction.APPOINTMENT_RESCHEDULED,
        resourceType: "Appointment",
        resourceId: updated._id.toString(),
        ipAddress: clientContext?.ipAddress,
        userAgent: clientContext?.userAgent,
        metadata: {
          doctorId: updated.doctorId.toString(),
          patientId: updated.patientId.toString(),
          previousStart: appointment.scheduledStart.toISOString(),
          newStart: newScheduledStart.toISOString(),
          reason: input.reason?.trim(),
        },
        status: "SUCCESS",
      });

      return updated;
    } catch (err: unknown) {
      if (this.isSlotDuplicateKeyError(err)) {
        throw new AppError(
          409,
          "APPOINTMENT_SLOT_UNAVAILABLE",
          "Requested appointment slot is already reserved or booked by another patient"
        );
      }
      throw err;
    }
  }
}

export const appointmentService = new AppointmentService();
