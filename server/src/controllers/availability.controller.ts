import type { Request, Response, NextFunction } from "express";
import { availabilityService } from "../services/availability.service.js";
import { UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  UpdateAvailabilityInput,
  ScheduleExceptionInput,
} from "../validators/availability.validator.js";

/**
 * Handler: GET /api/v1/doctors/me/availability
 *
 * Retrieves recurring schedule and exceptions for authenticated verified doctor.
 */
export async function getDoctorAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may access availability configuration",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const availability =
      await availabilityService.getAvailabilityByDoctorUserId(req.user.id);

    sendSuccess(
      res,
      availability,
      "Doctor availability retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PUT /api/v1/doctors/me/availability
 *
 * Updates doctor recurring weekly working shifts and slot durations.
 * Source: docs/api/API_CONTRACT.md Section 5.2.
 */
export async function updateDoctorAvailabilityHandler(
  req: Request<unknown, unknown, UpdateAvailabilityInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may update availability",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const ipAddress = (req.headers["x-test-client-ip"] as string) || req.ip;
    const userAgent = req.headers["user-agent"];

    const availability = await availabilityService.updateAvailability(
      req.user.id,
      req.body,
      { ipAddress, userAgent }
    );

    sendSuccess(
      res,
      availability,
      "Doctor availability updated successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/doctors/me/availability/exceptions
 *
 * Creates a date-specific schedule exception or leave.
 */
export async function createScheduleExceptionHandler(
  req: Request<unknown, unknown, ScheduleExceptionInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may manage availability exceptions",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const ipAddress = (req.headers["x-test-client-ip"] as string) || req.ip;
    const userAgent = req.headers["user-agent"];

    const result = await availabilityService.createException(
      req.user.id,
      req.body,
      { ipAddress, userAgent }
    );

    sendSuccess(
      res,
      result,
      "Schedule exception created successfully",
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: DELETE /api/v1/doctors/me/availability/exceptions/:date
 *
 * Removes a date-specific schedule exception.
 */
export async function deleteScheduleExceptionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may manage availability exceptions",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const date = Array.isArray(req.params.date)
      ? req.params.date[0]
      : req.params.date;

    const ipAddress = (req.headers["x-test-client-ip"] as string) || req.ip;
    const userAgent = req.headers["user-agent"];

    const updatedAvailability = await availabilityService.deleteException(
      req.user.id,
      date,
      { ipAddress, userAgent }
    );

    sendSuccess(
      res,
      updatedAvailability,
      "Schedule exception removed successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD
 *
 * Public endpoint: computes dynamically available appointment slots for a doctor on a target date.
 * Source: docs/api/API_CONTRACT.md Section 5.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 5.3.
 */
export async function getPublicDoctorAvailabilityHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const doctorId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const date = Array.isArray(req.query.date)
      ? (req.query.date[0] as string)
      : (req.query.date as string);

    const result = await availabilityService.computeAvailableSlots(
      doctorId,
      date
    );

    sendSuccess(
      res,
      result,
      "Doctor availability slots retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
