import { Router } from "express";
import {
  getPharmacyProfileHandler,
  updatePharmacyProfileHandler,
  submitPharmacyLicenseHandler,
} from "../controllers/pharmacy.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import {
  submitPharmacyLicenseSchema,
  updatePharmacyProfileSchema,
} from "../validators/pharmacy.validator.js";
import { UserRole } from "../types/models.js";

export const pharmacyRouter = Router();

/**
 * GET /api/v1/pharmacies/me/profile
 * Retrieves authenticated pharmacy's business profile.
 */
pharmacyRouter.get(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  getPharmacyProfileHandler
);

/**
 * PUT /api/v1/pharmacies/me/profile
 * Self-service update of pharmacy's own profile.
 */
pharmacyRouter.put(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateBody(updatePharmacyProfileSchema),
  updatePharmacyProfileHandler
);

/**
 * PATCH /api/v1/pharmacies/me/profile
 * Partial self-service update of pharmacy's own profile.
 */
pharmacyRouter.patch(
  "/me/profile",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateBody(updatePharmacyProfileSchema),
  updatePharmacyProfileHandler
);

/**
 * POST /api/v1/pharmacies/me/license
 * Submits retail drug license credentials and documents for administrative review.
 */
pharmacyRouter.post(
  "/me/license",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateBody(submitPharmacyLicenseSchema),
  submitPharmacyLicenseHandler
);
