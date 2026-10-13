import type { Request, Response, NextFunction } from "express";
import { medicalRecordService } from "../services/medical-record.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { UploadUrlInput } from "../validators/medical-record.validator.js";

/**
 * Handler: POST /api/v1/medical-records/upload-url
 *
 * Authenticated patient requests a pre-signed S3 object storage upload URL
 * to upload a medical document directly to private cloud storage.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Group 8.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.1.
 */
export async function requestUploadUrlHandler(
  req: Request<unknown, unknown, UploadUrlInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const result = await medicalRecordService.generateUploadUrl(
      req.user,
      req.body
    );

    sendSuccess(res, result, "Pre-signed upload URL generated successfully", 200);
  } catch (error) {
    next(error);
  }
}
