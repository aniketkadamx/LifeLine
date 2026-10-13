import { Router } from "express";
import {
  issuePrescriptionHandler,
  getPrescriptionByIdHandler,
  modifyPrescriptionHandler,
} from "../controllers/prescription.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody, validateParams } from "../validators/auth.validator.js";
import {
  issuePrescriptionSchema,
  prescriptionIdParamSchema,
} from "../validators/prescription.validator.js";
import { UserRole } from "../types/models.js";

export const prescriptionRouter = Router();

/**
 * POST /api/v1/prescriptions
 * Attending verified doctor issues an immutable digital prescription.
 * Role: DOCTOR.
 * Source: docs/api/API_CONTRACT.md Group 9.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.3.
 */
prescriptionRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateBody(issuePrescriptionSchema),
  issuePrescriptionHandler
);

/**
 * GET /api/v1/prescriptions/:id
 * Authorized participant (Patient owner, Issuing doctor, Pharmacy, or Admin)
 * retrieves prescription details.
 * Role: PATIENT, DOCTOR, PHARMACY, ADMIN.
 * Source: docs/api/AUTHORIZATION_MATRIX.md Table line 62.
 */
prescriptionRouter.get(
  "/:id",
  authenticate,
  validateParams(prescriptionIdParamSchema),
  getPrescriptionByIdHandler
);

/**
 * PATCH /api/v1/prescriptions/:id
 * Rejects mutation attempts with HTTP 409 Conflict.
 * Digital prescriptions are immutable legal records.
 */
prescriptionRouter.patch(
  "/:id",
  authenticate,
  validateParams(prescriptionIdParamSchema),
  modifyPrescriptionHandler
);

/**
 * PUT /api/v1/prescriptions/:id
 * Rejects replacement attempts with HTTP 409 Conflict.
 */
prescriptionRouter.put(
  "/:id",
  authenticate,
  validateParams(prescriptionIdParamSchema),
  modifyPrescriptionHandler
);
