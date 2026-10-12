import type { Request, Response, NextFunction } from "express";
import {
  doctorService,
  sanitizeDoctorProfile,
} from "../services/doctor.service.js";
import { auditLogService } from "../services/audit-log.service.js";
import { AuditAction, UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  SubmitVerificationDocumentsInput,
  UpdateDoctorProfileInput,
} from "../validators/doctor.validator.js";

/**
 * Handler: GET /api/v1/doctors/me/profile
 *
 * Retrieves doctor profile for authenticated doctor:
 * - Restricts access strictly to role DOCTOR.
 * - Derives doctor identity strictly from authenticated user (req.user.id).
 * - Never leaks private document keys or internal DB fields.
 */
export async function getDoctorProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may access this profile endpoint",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const profile = await doctorService.getProfileByUserId(req.user.id);

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.DOCTOR_PROFILE_ACCESSED,
      resourceType: "DoctorProfile",
      resourceId: profile._id.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      sanitizeDoctorProfile(profile),
      "Doctor profile retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PUT /api/v1/doctors/me/profile (and PATCH)
 *
 * Updates non-protected doctor self-service profile attributes:
 * - Restricts mutation strictly to role DOCTOR.
 * - Always targets authenticated doctor's own profile (req.user.id).
 * - Preserves omitted fields during partial updates.
 * - Emits audit logging.
 */
export async function updateDoctorProfileHandler(
  req: Request<unknown, unknown, UpdateDoctorProfileInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may update their profile",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const updatedProfile = await doctorService.updateProfile(
      req.user.id,
      req.body
    );

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.USER_UPDATED,
      resourceType: "DoctorProfile",
      resourceId: updatedProfile._id.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      sanitizeDoctorProfile(updatedProfile),
      "Doctor profile updated successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/doctors/me/verification-documents
 *
 * Submits medical registration license and verification documents:
 * - Restricts mutation strictly to role DOCTOR.
 * - Follows Doctor Verification State Machine (UNSUBMITTED / INFO_REQUESTED -> PENDING_REVIEW).
 * - Enforces registration number uniqueness.
 * - Emits DOCTOR_VERIFICATION_SUBMITTED audit event.
 * - Response contains { status: "PENDING_REVIEW" } per API_CONTRACT.md.
 */
export async function submitVerificationDocumentsHandler(
  req: Request<unknown, unknown, SubmitVerificationDocumentsInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.DOCTOR) {
      throw AppError.forbidden(
        "Access denied: only doctors may submit verification documents",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const updatedProfile = await doctorService.submitVerificationDocuments(
      req.user.id,
      req.body
    );

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.DOCTOR_VERIFICATION_SUBMITTED,
      resourceType: "DoctorProfile",
      resourceId: updatedProfile._id.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      {
        status: updatedProfile.verificationStatus,
        profile: sanitizeDoctorProfile(updatedProfile),
      },
      "Verification documents submitted successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
