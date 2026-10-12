import { Router } from "express";
import {
  getPatientProfileHandler,
  updatePatientProfileHandler,
} from "../controllers/patient.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { updatePatientProfileSchema } from "../validators/patient.validator.js";
import { UserRole } from "../types/models.js";

export const patientRouter = Router();

/**
 * GET /api/v1/patients/me/profile
 * Retrieves authenticated patient's personal health profile (or doctor with relationship).
 */
patientRouter.get(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.PATIENT, UserRole.DOCTOR),
  getPatientProfileHandler
);

/**
 * PUT /api/v1/patients/me/profile
 * Updates personal health profile for authenticated patient (own profile only).
 */
patientRouter.put(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(updatePatientProfileSchema),
  updatePatientProfileHandler
);

/**
 * GET /api/v1/patients/:id/profile
 * Retrieves a patient profile by ID:
 * - Patient may only retrieve their own profile.
 * - Doctor may only retrieve if an active clinical relationship exists.
 */
patientRouter.get(
  "/:id/profile",
  authenticate,
  authorizeRole(UserRole.PATIENT, UserRole.DOCTOR),
  getPatientProfileHandler
);
