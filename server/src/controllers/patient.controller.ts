import type { Request, Response, NextFunction } from "express";
import { patientService } from "../services/patient.service.js";
import { auditLogService } from "../services/audit-log.service.js";
import { AuditAction, UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { UpdatePatientProfileInput } from "../validators/patient.validator.js";

/**
 * Handler: GET /api/v1/patients/me/profile (or GET /api/v1/patients/:id/profile)
 *
 * Retrieves patient health profile:
 * - When requested by a PATIENT: returns strictly the patient's own profile.
 * - When requested by a DOCTOR: verifies an active clinical relationship exists.
 * - Other roles are rejected with HTTP 403.
 */
export async function getPatientProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    let profile;

    if (req.user.role === UserRole.PATIENT) {
      // Patients may only read their own profile; client-supplied IDs are ignored
      profile = await patientService.getProfileByUserId(req.user.id);
    } else if (req.user.role === UserRole.DOCTOR) {
      // Doctors may only read a patient's profile if an active relationship exists
      const paramId =
        typeof req.params.id === "string" && req.params.id !== "me"
          ? req.params.id
          : null;
      const queryId =
        typeof req.query.patientId === "string" ? req.query.patientId : null;
      const targetPatientId = paramId || queryId;

      if (!targetPatientId) {
        throw AppError.badRequest(
          "Patient identifier is required for doctor profile access",
          "BAD_REQUEST"
        );
      }

      profile = await patientService.getProfileForDoctor(
        req.user.id,
        targetPatientId
      );
    } else {
      throw AppError.forbidden(
        "Access denied: insufficient permissions to access patient profile",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.PATIENT_PROFILE_ACCESSED,
      resourceType: "PatientProfile",
      resourceId: profile._id.toString(),
      patientId: profile.userId.toString(),
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      typeof (profile as unknown as { toJSON?: () => unknown }).toJSON === "function"
        ? (profile as unknown as { toJSON: () => unknown }).toJSON()
        : profile,
      "Patient profile retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PUT /api/v1/patients/me/profile
 *
 * Updates personal health profile for the authenticated patient:
 * - Strictly restricted to role PATIENT (own profile only).
 * - Doctors and other roles cannot modify patient health profiles.
 */
export async function updatePatientProfileHandler(
  req: Request<unknown, unknown, UpdatePatientProfileInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.PATIENT) {
      throw AppError.forbidden(
        "Access denied: only patients may update their health profile",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // Always update strictly for the authenticated patient's own ID
    const updatedProfile = await patientService.updateProfile(
      req.user.id,
      req.body
    );

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.USER_UPDATED,
      resourceType: "PatientProfile",
      resourceId: updatedProfile._id.toString(),
      patientId: req.user.id,
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      typeof (updatedProfile as unknown as { toJSON?: () => unknown }).toJSON === "function"
        ? (updatedProfile as unknown as { toJSON: () => unknown }).toJSON()
        : updatedProfile,
      "Patient profile updated successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
