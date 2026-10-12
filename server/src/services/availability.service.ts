import mongoose from "mongoose";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import { DoctorAvailability } from "../models/doctor-availability.model.js";
import { Appointment } from "../models/appointment.model.js";
import {
  DoctorVerificationStatus,
  UserStatus,
  AuditAction,
  AppointmentStatus,
  type IDoctorAvailability,
  type IScheduleException,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { auditLogService } from "./audit-log.service.js";
import {
  hasOverlappingShifts,
  toMinutes,
  minutesToTimeString,
  getDayOfWeekFromDateString,
  type UpdateAvailabilityInput,
  type ScheduleExceptionInput,
} from "../validators/availability.validator.js";

export interface ComputedAvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
}

export interface DoctorAvailabilityResult {
  doctorId: string;
  date: string;
  slots: ComputedAvailabilitySlot[];
}

/**
 * Service managing doctor weekly recurring schedules, slot durations,
 * and date-specific exceptions/leaves.
 */
export class AvailabilityService {
  /**
   * Helper: Resolves and verifies doctor profile eligibility from authenticated user ID.
   * Enforces:
   * 1. Valid user ID format.
   * 2. Doctor profile existence.
   * 3. Doctor verification status === APPROVED_VERIFIED (docs/api/AUTHORIZATION_MATRIX.md Section 4).
   */
  private async getVerifiedDoctorProfile(userId: string) {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await DoctorProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Doctor profile not found", "DOCTOR_NOT_FOUND");
    }

    if (profile.verificationStatus !== DoctorVerificationStatus.APPROVED_VERIFIED) {
      throw AppError.forbidden(
        "Doctor credentials must be verified by administrator to configure availability schedule",
        "DOCTOR_NOT_VERIFIED"
      );
    }

    return profile;
  }

  /**
   * Retrieves availability schedule configuration for the authenticated doctor.
   */
  public async getAvailabilityByDoctorUserId(
    userId: string
  ): Promise<IDoctorAvailability | { doctorId: string; slotDurationMinutes: number; weeklySchedule: []; exceptions: [] }> {
    const profile = await this.getVerifiedDoctorProfile(userId);

    const availability = await DoctorAvailability.findOne({
      doctorId: profile._id,
    });

    if (!availability) {
      // Return initial empty configuration template if not yet configured
      return {
        doctorId: profile._id.toString(),
        slotDurationMinutes: 30,
        weeklySchedule: [],
        exceptions: [],
      };
    }

    return availability;
  }

  /**
   * Updates recurring weekly schedule and slot duration for authenticated doctor.
   */
  public async updateAvailability(
    userId: string,
    input: UpdateAvailabilityInput,
    clientContext?: { ipAddress?: string; userAgent?: string }
  ): Promise<IDoctorAvailability> {
    const profile = await this.getVerifiedDoctorProfile(userId);

    // Defensive validation for overlapping shifts on each day
    for (const day of input.weeklySchedule) {
      for (const shift of day.shifts) {
        if (toMinutes(shift.startTime) >= toMinutes(shift.endTime)) {
          throw new AppError(
            422,
            "AVAILABILITY_SLOT_INVALID",
            "Shift start time must precede end time"
          );
        }
      }

      if (hasOverlappingShifts(day.shifts)) {
        throw new AppError(
          409,
          "AVAILABILITY_OVERLAP",
          `Shifts cannot overlap on ${day.dayOfWeek}`
        );
      }
    }

    const updateDoc: Record<string, any> = {
      slotDurationMinutes: input.slotDurationMinutes,
      weeklySchedule: input.weeklySchedule,
    };

    if (input.exceptions !== undefined) {
      updateDoc.exceptions = input.exceptions;
    }

    const availability = await DoctorAvailability.findOneAndUpdate(
      { doctorId: profile._id },
      { $set: updateDoc },
      { new: true, upsert: true, runValidators: true }
    );

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: userId,
      actorRole: "DOCTOR" as any,
      action: AuditAction.USER_UPDATED,
      resourceType: "DoctorAvailability",
      resourceId: availability._id.toString(),
      ipAddress: clientContext?.ipAddress,
      userAgent: clientContext?.userAgent,
      metadata: {
        slotDurationMinutes: input.slotDurationMinutes,
        daysConfigured: input.weeklySchedule.length,
      },
      status: "SUCCESS",
    });

    return availability;
  }

  /**
   * Adds a date-specific exception or leave.
   * Rejects duplicate exceptions for the same date with AVAILABILITY_LEAVE_CONFLICT (HTTP 409).
   */
  public async createException(
    userId: string,
    input: ScheduleExceptionInput,
    clientContext?: { ipAddress?: string; userAgent?: string }
  ): Promise<{ availability: IDoctorAvailability; createdException: IScheduleException }> {
    const profile = await this.getVerifiedDoctorProfile(userId);

    let availability = await DoctorAvailability.findOne({
      doctorId: profile._id,
    });

    if (!availability) {
      availability = new DoctorAvailability({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [],
        exceptions: [],
      });
    }

    // Check for existing exception on this date
    const existingIndex = availability.exceptions.findIndex(
      (e) => e.date === input.date
    );

    if (existingIndex !== -1) {
      throw new AppError(
        409,
        "AVAILABILITY_LEAVE_CONFLICT",
        `Schedule exception already exists for date '${input.date}'`
      );
    }

    // Defensive check for working shifts if isAvailable === true
    if (input.isAvailable && input.shifts) {
      for (const shift of input.shifts) {
        if (toMinutes(shift.startTime) >= toMinutes(shift.endTime)) {
          throw new AppError(
            422,
            "AVAILABILITY_SLOT_INVALID",
            "Exception shift start time must precede end time"
          );
        }
      }

      if (hasOverlappingShifts(input.shifts)) {
        throw new AppError(
          409,
          "AVAILABILITY_OVERLAP",
          `Exception shifts cannot overlap on date '${input.date}'`
        );
      }
    }

    const newException: IScheduleException = {
      date: input.date,
      isAvailable: input.isAvailable,
      reason: input.reason,
      shifts: input.shifts || [],
    };

    availability.exceptions.push(newException);
    await availability.save();

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: userId,
      actorRole: "DOCTOR" as any,
      action: AuditAction.USER_UPDATED,
      resourceType: "DoctorAvailability",
      resourceId: availability._id.toString(),
      ipAddress: clientContext?.ipAddress,
      userAgent: clientContext?.userAgent,
      metadata: {
        exceptionDate: input.date,
        isAvailable: input.isAvailable,
        reason: input.reason,
      },
      status: "SUCCESS",
    });

    const savedException =
      availability.exceptions[availability.exceptions.length - 1];

    return {
      availability,
      createdException: savedException,
    };
  }

  /**
   * Deletes a date-specific exception by date string (YYYY-MM-DD).
   */
  public async deleteException(
    userId: string,
    date: string,
    clientContext?: { ipAddress?: string; userAgent?: string }
  ): Promise<IDoctorAvailability> {
    const profile = await this.getVerifiedDoctorProfile(userId);

    const availability = await DoctorAvailability.findOne({
      doctorId: profile._id,
    });

    if (!availability) {
      throw AppError.notFound(
        "Doctor availability schedule not found",
        "DOCTOR_NOT_FOUND"
      );
    }

    const existingIndex = availability.exceptions.findIndex(
      (e) => e.date === date
    );

    if (existingIndex === -1) {
      throw AppError.notFound(
        `Schedule exception not found for date '${date}'`,
        "EXCEPTION_NOT_FOUND"
      );
    }

    availability.exceptions.splice(existingIndex, 1);
    await availability.save();

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: userId,
      actorRole: "DOCTOR" as any,
      action: AuditAction.USER_UPDATED,
      resourceType: "DoctorAvailability",
      resourceId: availability._id.toString(),
      ipAddress: clientContext?.ipAddress,
      userAgent: clientContext?.userAgent,
      metadata: {
        deletedExceptionDate: date,
      },
      status: "SUCCESS",
    });

    return availability;
  }

  /**
   * Dynamically computes bookable time slots for a doctor on a target date.
   * Endpoint: GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD
   *
   * Business Rules:
   * 1. Resolves doctor profile and enforces discovery eligibility:
   *    - Doctor profile exists (by _id or userId).
   *    - verificationStatus === APPROVED_VERIFIED.
   *    - user.status === ACTIVE.
   *    Returns 404 DOCTOR_NOT_FOUND if doctor is unknown, unverified, or inactive.
   * 2. Retrieves doctor availability configuration:
   *    - slotDurationMinutes (15, 30, or 60; default 30 if unconfigured).
   *    - recurring weeklySchedule and exceptions.
   * 3. Exception semantics:
   *    - Leave exception (isAvailable: false) -> returns empty slots ([]).
   *    - Working exception (isAvailable: true) -> overrides recurring schedule with custom shifts.
   *    - No exception -> uses recurring shifts for target day of week in UTC.
   *    - Missing shifts -> returns empty slots ([]).
   * 4. Slices effective shifts into sequential candidate slots of slotDurationMinutes.
   *    Never creates a slot that extends beyond shift end time.
   * 5. Identifies booked appointments and active locks overlapping the candidate slots:
   *    - CONFIRMED, IN_PROGRESS, COMPLETED occupy the slot (available: false).
   *    - PENDING_PAYMENT with active (unexpired) lock occupies the slot (available: false).
   *    - PENDING_PAYMENT with expired lock (lockExpiresAt <= now) does NOT occupy the slot (available: true).
   *    - CANCELLED, REJECTED, RESCHEDULED, NO_SHOW do NOT occupy the slot.
   * 6. Checks partial and full interval overlaps (slotStart < apptEnd && slotEnd > apptStart).
   * 7. Returns slots in chronological order.
   */
  public async computeAvailableSlots(
    doctorId: string,
    dateStr: string
  ): Promise<DoctorAvailabilityResult> {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      throw AppError.badRequest("Invalid doctor identifier format", "BAD_REQUEST");
    }

    const doctorObjectId = new mongoose.Types.ObjectId(doctorId);

    // 1. Resolve doctor profile and verify public discovery eligibility
    const pipeline: mongoose.PipelineStage[] = [
      {
        $match: {
          $or: [{ _id: doctorObjectId }, { userId: doctorObjectId }],
          verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $match: {
          "user.status": UserStatus.ACTIVE,
        },
      },
    ];

    const [doctor] = await DoctorProfile.aggregate(pipeline);

    if (!doctor) {
      throw AppError.notFound("Doctor not found", "DOCTOR_NOT_FOUND");
    }

    const doctorProfileId = doctor._id.toString();
    const doctorUserId = doctor.userId;

    // 2. Load doctor's persisted availability configuration
    const availability = await DoctorAvailability.findOne({
      doctorId: doctor._id,
    });

    const slotDuration = availability?.slotDurationMinutes || 30;

    // 3. Evaluate date-specific exceptions or recurring schedule
    let effectiveShifts: Array<{ startTime: string; endTime: string }> = [];

    const dateException = availability?.exceptions?.find(
      (exc) => exc.date === dateStr
    );

    if (dateException) {
      if (!dateException.isAvailable) {
        // Doctor is on leave for this entire date
        return {
          doctorId: doctorProfileId,
          date: dateStr,
          slots: [],
        };
      } else {
        // Working exception: custom shifts override recurring schedule
        effectiveShifts = dateException.shifts || [];
      }
    } else {
      // No exception: evaluate recurring weekly schedule for target day in UTC
      const targetDayOfWeek = getDayOfWeekFromDateString(dateStr);
      const daySchedule = availability?.weeklySchedule?.find(
        (day) => day.dayOfWeek === targetDayOfWeek
      );
      effectiveShifts = daySchedule?.shifts || [];
    }

    if (!effectiveShifts || effectiveShifts.length === 0) {
      return {
        doctorId: doctorProfileId,
        date: dateStr,
        slots: [],
      };
    }

    // 4. Divide effective working intervals into sequential candidate slots
    const candidateSlots: Array<{ startTime: string; endTime: string }> = [];

    for (const shift of effectiveShifts) {
      const shiftStartMinutes = toMinutes(shift.startTime);
      const shiftEndMinutes = toMinutes(shift.endTime);

      let current = shiftStartMinutes;
      while (current + slotDuration <= shiftEndMinutes) {
        candidateSlots.push({
          startTime: minutesToTimeString(current),
          endTime: minutesToTimeString(current + slotDuration),
        });
        current += slotDuration;
      }
    }

    // Sort candidate slots chronologically
    candidateSlots.sort(
      (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
    );

    if (candidateSlots.length === 0) {
      return {
        doctorId: doctorProfileId,
        date: dateStr,
        slots: [],
      };
    }

    // 5. Query active appointments and locks for this doctor touching the target date
    const dayStartUtc = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEndUtc = new Date(`${dateStr}T23:59:59.999Z`);

    const appointments = await Appointment.find({
      doctorId: { $in: [doctor._id, doctorUserId] },
      scheduledStart: { $lte: dayEndUtc },
      scheduledEnd: { $gte: dayStartUtc },
      status: {
        $in: [
          AppointmentStatus.PENDING_PAYMENT,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.IN_PROGRESS,
          AppointmentStatus.COMPLETED,
        ],
      },
    });

    // Filter out expired locks
    const nowMs = Date.now();
    const blockingAppointments = appointments.filter((appt) => {
      if (appt.status === AppointmentStatus.PENDING_PAYMENT) {
        if (appt.lockExpiresAt && new Date(appt.lockExpiresAt).getTime() <= nowMs) {
          return false; // Expired lock does not block availability
        }
      }
      return true;
    });

    // 6. Overlap detection: mark slots unavailable if overlapping any active booking/lock
    const computedSlots: ComputedAvailabilitySlot[] = candidateSlots.map(
      (candidate) => {
        const slotStartMs = new Date(
          `${dateStr}T${candidate.startTime}:00.000Z`
        ).getTime();
        const slotEndMs = new Date(
          `${dateStr}T${candidate.endTime}:00.000Z`
        ).getTime();

        const isBlocked = blockingAppointments.some((appt) => {
          const apptStartMs = new Date(appt.scheduledStart).getTime();
          const apptEndMs = new Date(appt.scheduledEnd).getTime();
          // Interval overlap: slotStart < apptEnd && slotEnd > apptStart
          return slotStartMs < apptEndMs && slotEndMs > apptStartMs;
        });

        return {
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          available: !isBlocked,
        };
      }
    );

    return {
      doctorId: doctorProfileId,
      date: dateStr,
      slots: computedSlots,
    };
  }
}

export const availabilityService = new AvailabilityService();
