import { Router } from "express";
import {
  getDoctorProfileHandler,
  updateDoctorProfileHandler,
  submitVerificationDocumentsHandler,
  listPublicDoctorsHandler,
  getPublicDoctorByIdHandler,
} from "../controllers/doctor.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  doctorIdParamSchema,
  doctorSearchQuerySchema,
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

/**
 * GET /api/v1/doctors
 * Public doctor directory search and filtering.
 * Source: docs/api/API_CONTRACT.md Section 4.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 5.1.
 */
doctorRouter.get(
  "/",
  validateQuery(doctorSearchQuerySchema),
  listPublicDoctorsHandler
);

/**
 * GET /api/v1/doctors/:id
 * Public detailed profile for a verified doctor.
 * Source: docs/api/API_CONTRACT.md Section 4.2.
 */
doctorRouter.get(
  "/:id",
  validateParams(doctorIdParamSchema),
  getPublicDoctorByIdHandler
);
