import mongoose from "mongoose";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import { DoctorAvailability } from "../models/doctor-availability.model.js";
import {
  DoctorVerificationStatus,
  UserStatus,
  AuditAction,
  type IDoctorAvailability,
  type IScheduleException,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { auditLogService } from "./audit-log.service.js";
import {
  hasOverlappingShifts,
  toMinutes,
  type UpdateAvailabilityInput,
  type ScheduleExceptionInput,
} from "../validators/availability.validator.js";

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
}

export const availabilityService = new AvailabilityService();
