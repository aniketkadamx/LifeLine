import type { Request, Response, NextFunction } from "express";
import { medicalRecordService } from "../services/medical-record.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  UploadUrlInput,
  CreateMedicalRecordInput,
} from "../validators/medical-record.validator.js";

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

/**
 * Handler: POST /api/v1/medical-records
 *
 * Authenticated patient registers medical record metadata after successfully
 * uploading the file object directly to cloud storage.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Group 8.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.2.
 */
export async function createMedicalRecordHandler(
  req: Request<unknown, unknown, CreateMedicalRecordInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const result = await medicalRecordService.createMedicalRecord(
      req.user,
      req.body
    );

    sendSuccess(res, result, "Medical record registered successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/medical-records/:id/download-url
 *
 * Authorized participant (Patient owner, Attending doctor with clinical relationship, or Admin)
 * requests an expiring (15-minute) pre-signed GET URL to download the private medical document.
 * Role: PATIENT (owner), DOCTOR (active clinical relationship), ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 8.3 & AUTHORIZATION_MATRIX.md Section 4.
 */
export async function getDownloadUrlHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const result = await medicalRecordService.getDownloadUrl(req.user, id);

    // Ensure temporary pre-signed URL is never cached by proxies or browsers
    res.set("Cache-Control", "no-store, private");
    res.set("Pragma", "no-cache");

    sendSuccess(res, result, "Download URL generated successfully", 200);
  } catch (error) {
    next(error);
  }
}
