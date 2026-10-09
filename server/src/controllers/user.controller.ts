import type { Request, Response, NextFunction } from "express";
import { User, PatientProfile, DoctorProfile, PharmacyProfile } from "../models/index.js";
import { auditLogService } from "../services/audit-log.service.js";
import { AuditAction, UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { UpdateUserInput } from "../validators/user.validator.js";

/**
 * Handler: GET /api/v1/users/me
 *
 * Retrieves the currently authenticated user's safe account information
 * along with their role-specific linked profile (PatientProfile, DoctorProfile, or PharmacyProfile).
 */
export async function getMeHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const user = await User.findById(req.user.id)
      .populate("patientProfile")
      .populate("doctorProfile")
      .populate("pharmacyProfile");

    if (!user) {
      throw AppError.notFound("User not found", "USER_NOT_FOUND");
    }

    // Retrieve role-specific linked profile
    let profile = null;
    if (user.role === UserRole.PATIENT) {
      profile = user.patientProfile || (await PatientProfile.findOne({ userId: user._id }));
    } else if (user.role === UserRole.DOCTOR) {
      profile = user.doctorProfile || (await DoctorProfile.findOne({ userId: user._id }));
    } else if (user.role === UserRole.PHARMACY) {
      profile = user.pharmacyProfile || (await PharmacyProfile.findOne({ userId: user._id }));
    }

    const safeUser = user.toJSON();
    const safeProfile =
      profile && typeof (profile as { toJSON?: () => unknown }).toJSON === "function"
        ? (profile as { toJSON: () => unknown }).toJSON()
        : profile;

    const responseData = {
      ...safeUser,
      profile: safeProfile ?? null,
    };

    sendSuccess(res, responseData, "User profile retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/users/me
 *
 * Allows the authenticated user to update only permitted self-service fields:
 * - phone (E.164 validated)
 * - avatar (valid URL)
 *
 * All privileged and unrecognized fields are strictly rejected by validation.
 */
export async function updateMeHandler(
  req: Request<unknown, unknown, UpdateUserInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const updateFields: Partial<{ phone: string; avatar: string }> = {};

    if (req.body.phone !== undefined) {
      updateFields.phone = req.body.phone;
    }
    if (req.body.avatar !== undefined) {
      updateFields.avatar = req.body.avatar;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      throw AppError.notFound("User not found", "USER_NOT_FOUND");
    }

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: AuditAction.USER_UPDATED,
      resourceType: "User",
      resourceId: req.user.id,
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    const safeUser = updatedUser.toJSON();
    sendSuccess(res, safeUser, "User profile updated successfully", 200);
  } catch (error) {
    next(error);
  }
}
