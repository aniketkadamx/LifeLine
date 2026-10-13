import { Router } from "express";
import {
  requestUploadUrlHandler,
  createMedicalRecordHandler,
  getDownloadUrlHandler,
} from "../controllers/medical-record.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody, validateParams } from "../validators/auth.validator.js";
import {
  uploadUrlSchema,
  createMedicalRecordSchema,
  medicalRecordIdParamSchema,
} from "../validators/medical-record.validator.js";
import { UserRole } from "../types/models.js";

export const medicalRecordRouter = Router();

/**
 * POST /api/v1/medical-records/upload-url
 * Patient requests a secure, expiring pre-signed S3 upload URL.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Group 8.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.1.
 */
medicalRecordRouter.post(
  "/upload-url",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(uploadUrlSchema),
  requestUploadUrlHandler
);

/**
 * POST /api/v1/medical-records
 * Patient registers medical record metadata after uploading the file to S3.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Group 8.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.2.
 */
medicalRecordRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(createMedicalRecordSchema),
  createMedicalRecordHandler
);

/**
 * GET /api/v1/medical-records/:id/download-url
 * Authorized user (Patient owner, Attending doctor, or Admin) retrieves
 * an expiring (15-minute) pre-signed GET URL for secure download access.
 * Role: PATIENT (owner), DOCTOR (active clinical relationship), ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 8.3 & AUTHORIZATION_MATRIX.md Section 4.
 */
medicalRecordRouter.get(
  "/:id/download-url",
  authenticate,
  validateParams(medicalRecordIdParamSchema),
  getDownloadUrlHandler
);
