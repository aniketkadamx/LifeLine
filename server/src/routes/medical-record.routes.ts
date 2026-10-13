import { Router } from "express";
import { requestUploadUrlHandler } from "../controllers/medical-record.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { uploadUrlSchema } from "../validators/medical-record.validator.js";
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
