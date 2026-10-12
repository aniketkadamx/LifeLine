import type { Request, Response, NextFunction } from "express";
import { adminService } from "../services/admin.service.js";
import { sanitizeDoctorProfile } from "../services/doctor.service.js";
import { sanitizePharmacyProfile } from "../services/pharmacy.service.js";
import { auditLogService } from "../services/audit-log.service.js";
import {
  AuditAction,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  UserRole,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  VerifyDoctorInput,
  VerifyPharmacyInput,
} from "../validators/admin.validator.js";

/**
 * Maps doctor verification decision to the mandatory audit action.
 */
function getDoctorAuditAction(status: DoctorVerificationStatus): AuditAction {
  switch (status) {
    case DoctorVerificationStatus.APPROVED_VERIFIED:
      return AuditAction.DOCTOR_VERIFICATION_APPROVED;
    case DoctorVerificationStatus.REJECTED:
      return AuditAction.DOCTOR_VERIFICATION_REJECTED;
    case DoctorVerificationStatus.INFO_REQUESTED:
      return AuditAction.DOCTOR_VERIFICATION_INFO_REQUESTED;
    default:
      return AuditAction.ADMIN_ACTION;
  }
}

/**
 * Maps pharmacy verification decision to the mandatory audit action.
 */
function getPharmacyAuditAction(status: PharmacyVerificationStatus): AuditAction {
  switch (status) {
    case PharmacyVerificationStatus.APPROVED_VERIFIED:
      return AuditAction.PHARMACY_VERIFICATION_APPROVED;
    case PharmacyVerificationStatus.REJECTED:
      return AuditAction.PHARMACY_VERIFICATION_REJECTED;
    case PharmacyVerificationStatus.LICENSE_VERIFYING:
      return AuditAction.PHARMACY_VERIFICATION_REVIEW_STARTED;
    default:
      return AuditAction.ADMIN_ACTION;
  }
}

/**
 * Handler: PATCH /api/v1/admin/doctors/:id/verify
 *
 * Evaluates and transitions a doctor's credential verification status:
 * - Requires authentication with role ADMIN.
 * - Rejects non-admin actors with HTTP 403.
 * - Validates route parameter and review payload.
 * - Enforces the Doctor Verification State Machine.
 * - Generates mandatory audit log entry with administrator actor ID and details.
 * - Never leaks private document keys (fileKey) in the response envelope.
 */
export async function verifyDoctorHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.ADMIN) {
      throw AppError.forbidden(
        "Access denied: only administrators may perform credential verification",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const input = req.body as VerifyDoctorInput;

    const result = await adminService.verifyDoctor(id, req.user.id, input);

    // Audit logging: Mandatory audit trail of administrative verification decisions
    const auditAction = getDoctorAuditAction(input.status);
    await auditLogService.log({
      actorId: req.user.id,
      actorRole: UserRole.ADMIN,
      action: auditAction,
      resourceType: "DoctorProfile",
      resourceId: result.updatedProfile._id.toString(),
      metadata: {
        targetUserId: result.updatedProfile.userId.toString(),
        previousStatus: result.previousStatus,
        newStatus: input.status,
        reviewNotes: input.reviewNotes,
      },
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      sanitizeDoctorProfile(result.updatedProfile),
      "Doctor verification status updated successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/admin/pharmacies/:id/verify
 *
 * Evaluates and transitions a retail pharmacy's drug license verification status:
 * - Requires authentication with role ADMIN.
 * - Rejects non-admin actors with HTTP 403.
 * - Validates route parameter and review payload.
 * - Enforces the Pharmacy License Verification State Machine.
 * - Generates mandatory audit log entry with administrator actor ID and details.
 * - Never leaks private storage keys (fileKey) in the response envelope.
 */
export async function verifyPharmacyHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.ADMIN) {
      throw AppError.forbidden(
        "Access denied: only administrators may perform license verification",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const input = req.body as VerifyPharmacyInput;

    const result = await adminService.verifyPharmacy(id, req.user.id, input);

    // Audit logging: Mandatory audit trail of administrative verification decisions
    const auditAction = getPharmacyAuditAction(input.status);
    await auditLogService.log({
      actorId: req.user.id,
      actorRole: UserRole.ADMIN,
      action: auditAction,
      resourceType: "PharmacyProfile",
      resourceId: result.updatedProfile._id.toString(),
      metadata: {
        targetUserId: result.updatedProfile.userId.toString(),
        previousStatus: result.previousStatus,
        newStatus: input.status,
        reviewNotes: input.reviewNotes,
      },
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      sanitizePharmacyProfile(result.updatedProfile),
      "Pharmacy verification status updated successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
