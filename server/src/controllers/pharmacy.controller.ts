import type { Request, Response, NextFunction } from "express";
import {
  pharmacyService,
  sanitizePharmacyProfile,
} from "../services/pharmacy.service.js";
import { auditLogService } from "../services/audit-log.service.js";
import { AuditAction, UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  SubmitPharmacyLicenseInput,
  UpdatePharmacyProfileInput,
} from "../validators/pharmacy.validator.js";

/**
 * Handler: GET /api/v1/pharmacies/me/profile
 *
 * Retrieves pharmacy profile for authenticated pharmacy:
 * - Restricts access strictly to role PHARMACY.
 * - Derives pharmacy identity strictly from authenticated user (req.user.id).
 * - Never leaks private storage keys or internal DB fields.
 */
export async function getPharmacyProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.PHARMACY) {
      throw AppError.forbidden(
        "Access denied: only pharmacies may access this profile endpoint",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const profile = await pharmacyService.getProfileByUserId(req.user.id);

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.PHARMACY_PROFILE_ACCESSED,
      resourceType: "PharmacyProfile",
      resourceId: profile._id.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      sanitizePharmacyProfile(profile),
      "Pharmacy profile retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PUT /api/v1/pharmacies/me/profile (and PATCH)
 *
 * Updates non-protected pharmacy self-service profile attributes:
 * - Restricts mutation strictly to role PHARMACY.
 * - Always targets authenticated pharmacy's own profile (req.user.id).
 * - Preserves omitted fields during partial updates.
 * - Emits audit logging.
 */
export async function updatePharmacyProfileHandler(
  req: Request<unknown, unknown, UpdatePharmacyProfileInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.PHARMACY) {
      throw AppError.forbidden(
        "Access denied: only pharmacies may update their profile",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const updatedProfile = await pharmacyService.updateProfile(
      req.user.id,
      req.body
    );

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.USER_UPDATED,
      resourceType: "PharmacyProfile",
      resourceId: updatedProfile._id.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      sanitizePharmacyProfile(updatedProfile),
      "Pharmacy profile updated successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/pharmacies/me/license
 *
 * Submits retail drug license credentials and verification documents:
 * - Restricts mutation strictly to role PHARMACY.
 * - Follows Pharmacy Verification State Machine (UNSUBMITTED -> PENDING_REVIEW).
 * - Enforces license number uniqueness.
 * - Emits PHARMACY_LICENSE_SUBMITTED audit event.
 * - Response contains { status: "PENDING_REVIEW" } per contract.
 */
export async function submitPharmacyLicenseHandler(
  req: Request<unknown, unknown, SubmitPharmacyLicenseInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.PHARMACY) {
      throw AppError.forbidden(
        "Access denied: only pharmacies may submit license documents",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const updatedProfile = await pharmacyService.submitLicense(
      req.user.id,
      req.body
    );

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.PHARMACY_LICENSE_SUBMITTED,
      resourceType: "PharmacyProfile",
      resourceId: updatedProfile._id.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      {
        status: updatedProfile.verificationStatus,
        profile: sanitizePharmacyProfile(updatedProfile),
      },
      "Pharmacy license documents submitted successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
