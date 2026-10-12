import { Router } from "express";
import {
  getDoctorProfileHandler,
  updateDoctorProfileHandler,
  submitVerificationDocumentsHandler,
} from "../controllers/doctor.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import {
  submitVerificationDocumentsSchema,
  updateDoctorProfileSchema,
} from "../validators/doctor.validator.js";
import { UserRole } from "../types/models.js";

export const doctorRouter = Router();

/**
 * GET /api/v1/doctors/me/profile
 * Retrieves authenticated doctor's professional profile.
 */
doctorRouter.get(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  getDoctorProfileHandler
);

/**
 * PUT /api/v1/doctors/me/profile
 * Self-service update of doctor's own profile.
 */
doctorRouter.put(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateBody(updateDoctorProfileSchema),
  updateDoctorProfileHandler
);

/**
 * PATCH /api/v1/doctors/me/profile
 * Partial self-service update of doctor's own profile.
 */
doctorRouter.patch(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateBody(updateDoctorProfileSchema),
  updateDoctorProfileHandler
);

/**
 * POST /api/v1/doctors/me/verification-documents
 * Submits medical registration license and verification documents for administrative review.
 */
doctorRouter.post(
  "/me/verification-documents",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateBody(submitVerificationDocumentsSchema),
  submitVerificationDocumentsHandler
);
