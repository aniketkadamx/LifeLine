import mongoose from "mongoose";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import { PharmacyProfile } from "../models/pharmacy-profile.model.js";
import {
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  type IDoctorProfile,
  type IPharmacyProfile,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type {
  VerifyDoctorInput,
  VerifyPharmacyInput,
} from "../validators/admin.validator.js";

export interface VerifyDoctorResult {
  updatedProfile: IDoctorProfile;
  previousStatus: DoctorVerificationStatus;
}

export interface VerifyPharmacyResult {
  updatedProfile: IPharmacyProfile;
  previousStatus: PharmacyVerificationStatus;
}

/**
 * Service handling administrator verification workflows for medical doctors
 * and retail licensed pharmacies.
 *
 * Implements strict state-machine compliance and concurrency guards:
 * - Doctor state machine: docs/api/STATE_MACHINES.md Section 6.
 * - Pharmacy state machine: docs/api/STATE_MACHINES.md Section 7.
 */
export class AdminService {
  /**
   * Reviews doctor credentials and transitions verification status.
   *
   * Permitted review decisions:
   * - APPROVED_VERIFIED: Doctor credentials validated.
   * - INFO_REQUESTED: Discrepancies found; additional documents requested.
   * - REJECTED: Credentials rejected (invalid/unrecognized license).
   *
   * State Machine Preconditions:
   * - Doctor profile must exist.
   * - Doctor's current status must be PENDING_REVIEW.
   * - Transitions from already APPROVED_VERIFIED reject with DOCTOR_ALREADY_VERIFIED.
   * - Transitions from other states (UNSUBMITTED, INFO_REQUESTED, REJECTED, SUSPENDED)
   *   reject with INVALID_STATE_TRANSITION.
   */
  public async verifyDoctor(
    doctorId: string,
    adminUserId: string,
    input: VerifyDoctorInput
  ): Promise<VerifyDoctorResult> {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      throw AppError.badRequest("Invalid doctor identifier format", "BAD_REQUEST");
    }

    if (!mongoose.Types.ObjectId.isValid(adminUserId)) {
      throw AppError.badRequest("Invalid administrator identifier format", "BAD_REQUEST");
    }

    const doctorObjectId = new mongoose.Types.ObjectId(doctorId);
    const profile = await DoctorProfile.findOne({
      $or: [{ _id: doctorObjectId }, { userId: doctorObjectId }],
    });

    if (!profile) {
      throw AppError.notFound("Doctor profile not found", "DOCTOR_NOT_FOUND");
    }

    // Guard: Prevent overwriting an already approved and verified doctor
    if (profile.verificationStatus === DoctorVerificationStatus.APPROVED_VERIFIED) {
      throw AppError.conflict(
        "Doctor credentials are already approved and verified",
        "DOCTOR_ALREADY_VERIFIED"
      );
    }

    // Guard: State machine transition permitted only from PENDING_REVIEW
    if (profile.verificationStatus !== DoctorVerificationStatus.PENDING_REVIEW) {
      throw AppError.conflict(
        `Cannot review doctor credentials from current status '${profile.verificationStatus}'`,
        "INVALID_STATE_TRANSITION"
      );
    }

    const previousStatus = profile.verificationStatus;

    // Concurrency guard: Atomically check that status is still PENDING_REVIEW
    const updated = await DoctorProfile.findOneAndUpdate(
      {
        _id: profile._id,
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      },
      {
        $set: {
          verificationStatus: input.status,
          verificationReviewedBy: new mongoose.Types.ObjectId(adminUserId),
          verificationReviewedAt: new Date(),
          verificationNotes: input.reviewNotes,
        },
      },
      { new: true }
    );

    if (!updated) {
      throw AppError.conflict(
        "Concurrent modification detected or doctor credentials are no longer awaiting review",
        "INVALID_STATE_TRANSITION"
      );
    }

    return {
      updatedProfile: updated,
      previousStatus,
    };
  }

  /**
   * Reviews retail pharmacy premises license and transitions verification status.
   *
   * Permitted review decisions:
   * - APPROVED_VERIFIED: License validated; enables pharmacy operations.
   * - REJECTED: Premises license rejected.
   * - LICENSE_VERIFYING: Internal administrative background check in progress.
   *
   * State Machine Preconditions:
   * - Pharmacy profile must exist.
   * - Allowed source status: PENDING_REVIEW or LICENSE_VERIFYING.
   * - Transitions from already APPROVED_VERIFIED reject with PHARMACY_ALREADY_VERIFIED.
   * - Transitions from other states (UNSUBMITTED, REJECTED, SUSPENDED)
   *   reject with INVALID_STATE_TRANSITION.
   */
  public async verifyPharmacy(
    pharmacyId: string,
    adminUserId: string,
    input: VerifyPharmacyInput
  ): Promise<VerifyPharmacyResult> {
    if (!mongoose.Types.ObjectId.isValid(pharmacyId)) {
      throw AppError.badRequest("Invalid pharmacy identifier format", "BAD_REQUEST");
    }

    if (!mongoose.Types.ObjectId.isValid(adminUserId)) {
      throw AppError.badRequest("Invalid administrator identifier format", "BAD_REQUEST");
    }

    const pharmacyObjectId = new mongoose.Types.ObjectId(pharmacyId);
    const profile = await PharmacyProfile.findOne({
      $or: [{ _id: pharmacyObjectId }, { userId: pharmacyObjectId }],
    });

    if (!profile) {
      throw AppError.notFound("Pharmacy profile not found", "PHARMACY_NOT_FOUND");
    }

    // Guard: Prevent overwriting an already approved and verified pharmacy
    if (profile.verificationStatus === PharmacyVerificationStatus.APPROVED_VERIFIED) {
      throw AppError.conflict(
        "Pharmacy license is already approved and verified",
        "PHARMACY_ALREADY_VERIFIED"
      );
    }

    // Determine allowed source states based on target transition
    const allowedSourceStatuses: PharmacyVerificationStatus[] =
      input.status === PharmacyVerificationStatus.LICENSE_VERIFYING
        ? [PharmacyVerificationStatus.PENDING_REVIEW]
        : [
            PharmacyVerificationStatus.PENDING_REVIEW,
            PharmacyVerificationStatus.LICENSE_VERIFYING,
          ];

    if (!allowedSourceStatuses.includes(profile.verificationStatus)) {
      throw AppError.conflict(
        `Cannot review pharmacy license from current status '${profile.verificationStatus}'`,
        "INVALID_STATE_TRANSITION"
      );
    }

    const previousStatus = profile.verificationStatus;

    // Concurrency guard: Atomically check that status is still in allowed source states
    const updated = await PharmacyProfile.findOneAndUpdate(
      {
        _id: profile._id,
        verificationStatus: { $in: allowedSourceStatuses },
      },
      {
        $set: {
          verificationStatus: input.status,
          verificationReviewedBy: new mongoose.Types.ObjectId(adminUserId),
          verificationReviewedAt: new Date(),
          verificationNotes: input.reviewNotes,
        },
      },
      { new: true }
    );

    if (!updated) {
      throw AppError.conflict(
        "Concurrent modification detected or pharmacy license is no longer awaiting review",
        "INVALID_STATE_TRANSITION"
      );
    }

    return {
      updatedProfile: updated,
      previousStatus,
    };
  }
}

export const adminService = new AdminService();
