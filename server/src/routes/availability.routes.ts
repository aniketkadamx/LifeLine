import { Router } from "express";
import {
  getDoctorAvailabilityHandler,
  updateDoctorAvailabilityHandler,
  createScheduleExceptionHandler,
  deleteScheduleExceptionHandler,
  getPublicDoctorAvailabilityHandler,
} from "../controllers/availability.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  updateAvailabilitySchema,
  scheduleExceptionSchema,
  exceptionDateParamSchema,
  getDoctorAvailabilityQuerySchema,
} from "../validators/availability.validator.js";
import { doctorIdParamSchema } from "../validators/doctor.validator.js";
import { UserRole } from "../types/models.js";

export const availabilityRouter = Router();

/**
 * GET /api/v1/doctors/me/availability
 * Retrieves current recurring schedule and exceptions for authenticated verified doctor.
 */
availabilityRouter.get(
  "/me/availability",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  getDoctorAvailabilityHandler
);

/**
 * PUT /api/v1/doctors/me/availability
 * Updates recurring weekly working schedule and slot duration.
 * Source: docs/api/API_CONTRACT.md Section 5.2.
 */
availabilityRouter.put(
  "/me/availability",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateBody(updateAvailabilitySchema),
  updateDoctorAvailabilityHandler
);

/**
 * POST /api/v1/doctors/me/availability/exceptions
 * Creates a date-specific schedule exception or leave.
 * Source: MASTER_IMPLEMENTATION_ROADMAP.md Task 5.2.
 */
availabilityRouter.post(
  "/me/availability/exceptions",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateBody(scheduleExceptionSchema),
  createScheduleExceptionHandler
);

/**
 * DELETE /api/v1/doctors/me/availability/exceptions/:date
 * Removes a date-specific schedule exception.
 */
availabilityRouter.delete(
  "/me/availability/exceptions/:date",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateParams(exceptionDateParamSchema),
  deleteScheduleExceptionHandler
);

/**
 * GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD
 * Public endpoint: dynamically computes bookable time slots for a doctor on a target date.
 * Source: docs/api/API_CONTRACT.md Section 5.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 5.3.
 */
availabilityRouter.get(
  "/:id/availability",
  validateParams(doctorIdParamSchema),
  validateQuery(getDoctorAvailabilityQuerySchema),
  getPublicDoctorAvailabilityHandler
);
