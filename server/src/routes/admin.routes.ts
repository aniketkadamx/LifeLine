import { Router } from "express";
import {
  verifyDoctorHandler,
  verifyPharmacyHandler,
} from "../controllers/admin.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import {
  verifyDoctorSchema,
  verifyPharmacySchema,
} from "../validators/admin.validator.js";
import { UserRole } from "../types/models.js";

export const adminRouter = Router();

// Protect all admin endpoints with JWT authentication and strict ADMIN role authorization
adminRouter.use(authenticate);
adminRouter.use(authorizeRole(UserRole.ADMIN));

/**
 * PATCH /api/v1/admin/doctors/:id/verify
 * Reviews and updates doctor credential verification status.
 * Source: docs/api/API_CONTRACT.md Section 18.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 4.5.
 */
adminRouter.patch(
  "/doctors/:id/verify",
  validateBody(verifyDoctorSchema),
  verifyDoctorHandler
);

/**
 * PATCH /api/v1/admin/pharmacies/:id/verify
 * Reviews and updates retail pharmacy license verification status.
 * Source: docs/api/STATE_MACHINES.md Section 7 & MASTER_IMPLEMENTATION_ROADMAP.md Task 4.5.
 */
adminRouter.patch(
  "/pharmacies/:id/verify",
  validateBody(verifyPharmacySchema),
  verifyPharmacyHandler
);
