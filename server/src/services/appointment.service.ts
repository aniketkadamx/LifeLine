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
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { auditLogService } from "./audit-log.service.js";
import { availabilityService } from "./availability.service.js";
import type { CreateAppointmentInput } from "../validators/appointment.validator.js";

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

      try {
        await IdempotencyRecord.create({
          key: idempotencyKey,
          userId: userObjectId,
          operation: "APPOINTMENT_RESERVATION",
          requestHash,
          status: IdempotencyStatus.PROCESSING,
          lockedUntil: leaseExpiresAt,
          expiresAt: expiresAt24h,
        });
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

          // Stale / abandoned claim: first check if an appointment was already created!
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
            // Appointment was created previously! Reconstruct response and complete idempotency record
            const result = this.buildReplayResponse(existingAppointment, true);
            await IdempotencyRecord.updateOne(
              { _id: existing._id },
              {
                $set: {
                  status: IdempotencyStatus.COMPLETED,
                  responseStatus: 201,
                  responseData: result,
                  responseMessage:
                    "Slot reserved for 15 minutes. Please complete payment.",
                  appointmentId: existingAppointment._id,
                },
                $unset: { lockedUntil: 1 },
              }
            );
            return result;
          }

          // No existing appointment: attempt to acquire the stale lease atomically
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
                lockedUntil: new Date(nowMs + IDEMPOTENCY_LEASE_MS),
              },
            },
            { new: true }
          );

          if (!acquired) {
            // Another concurrent recovery request acquired the stale lease
            throw new AppError(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Request with identical idempotency key is currently being processed"
            );
          }

          recordClaimed = true;
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

      // 6. Execute atomic slot reservation
      const result = await this.executeSlotReservation(
        patientUserId,
        doctorProfile,
        input,
        scheduledStart,
        scheduledEnd,
        idempotencyKey
      );

      // If idempotency was active, mark record as COMPLETED
      if (idempotencyKey && recordClaimed) {
        await IdempotencyRecord.updateOne(
          {
            key: idempotencyKey,
            userId: userObjectId,
            operation: "APPOINTMENT_RESERVATION",
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
            $unset: { lockedUntil: 1 },
          }
        );
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
      // Safe recovery on failure:
      if (idempotencyKey && recordClaimed) {
        // Did the appointment actually get created?
        const persistedAppt = await Appointment.findOne({
          patientId: userObjectId,
          idempotencyKey,
        });

        if (persistedAppt) {
          // The appointment WAS created, but a subsequent step (e.g. idempotency update or audit) failed.
          // DO NOT delete the idempotency claim! Try to complete it so subsequent retries succeed cleanly.
          try {
            const replayed = this.buildReplayResponse(persistedAppt, true);
            await IdempotencyRecord.updateOne(
              {
                key: idempotencyKey,
                userId: userObjectId,
                operation: "APPOINTMENT_RESERVATION",
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
                $unset: { lockedUntil: 1 },
              }
            );
          } catch {
            // Leave in PROCESSING with lockedUntil so retry recovery can handle it!
          }
        } else {
          // The appointment definitely was NOT created.
          // Safely delete the claim so the operation can be retried cleanly.
          await IdempotencyRecord.deleteOne({
            key: idempotencyKey,
            userId: userObjectId,
            operation: "APPOINTMENT_RESERVATION",
          });
        }
      }
      throw error;
    }
  }
}

export const appointmentService = new AppointmentService();
