import mongoose from "mongoose";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import {
  DoctorVerificationStatus,
  type IDoctorProfile,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type {
  SubmitVerificationDocumentsInput,
  UpdateDoctorProfileInput,
} from "../validators/doctor.validator.js";

/**
 * Service managing doctor profile retrieval, self-service updates,
 * and credential verification document submission.
 */
export class DoctorService {
  /**
   * Retrieves a doctor profile by the owning user's ID.
   */
  public async getProfileByUserId(userId: string): Promise<IDoctorProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await DoctorProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Doctor profile not found", "DOCTOR_NOT_FOUND");
    }

    return profile;
  }

  /**
   * Updates non-protected doctor self-service profile attributes.
   * Strictly preserves omitted fields during partial updates.
   */
  public async updateProfile(
    userId: string,
    input: UpdateDoctorProfileInput
  ): Promise<IDoctorProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await DoctorProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Doctor profile not found", "DOCTOR_NOT_FOUND");
    }

    // Apply partial updates while preserving unsupplied fields
    if (input.specialization !== undefined) {
      profile.specialization = input.specialization;
    }
    if (input.experienceYears !== undefined) {
      profile.experienceYears = input.experienceYears;
    }
    if (input.qualifications !== undefined) {
      profile.qualifications = input.qualifications;
    }
    if (input.clinicName !== undefined) {
      profile.clinicName = input.clinicName;
    }
    if (input.clinicAddress !== undefined) {
      profile.clinicAddress = input.clinicAddress;
    }
    if (input.languages !== undefined) {
      profile.languages = input.languages;
    }
    if (input.consultationFee !== undefined) {
      profile.consultationFee = input.consultationFee;
    }
    if (input.consultationTypes !== undefined) {
      profile.consultationTypes = input.consultationTypes;
    }
    if (input.bio !== undefined) {
      profile.bio = input.bio;
    }

    await profile.save();
    return profile;
  }

  /**
   * Submits medical registration license and verification documents for administrative review.
   * Follows the Doctor Verification State Machine in docs/api/STATE_MACHINES.md Section 6.
   */
  public async submitVerificationDocuments(
    userId: string,
    input: SubmitVerificationDocumentsInput
  ): Promise<IDoctorProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await DoctorProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Doctor profile not found", "DOCTOR_NOT_FOUND");
    }

    // Guard: Approved credentials cannot be overwritten without admin authorization
    if (
      profile.verificationStatus === DoctorVerificationStatus.APPROVED_VERIFIED
    ) {
      throw AppError.conflict(
        "Verified doctor credentials cannot be modified without admin approval",
        "DOCTOR_ALREADY_VERIFIED"
      );
    }

    // Guard: Prevent redundant resubmission while already awaiting review
    if (
      profile.verificationStatus === DoctorVerificationStatus.PENDING_REVIEW
    ) {
      throw AppError.conflict(
        "Verification documents are already under review",
        "INVALID_STATE_TRANSITION"
      );
    }

    // Guard: State machine transition only permitted from UNSUBMITTED or INFO_REQUESTED
    if (
      profile.verificationStatus !== DoctorVerificationStatus.UNSUBMITTED &&
      profile.verificationStatus !== DoctorVerificationStatus.INFO_REQUESTED
    ) {
      throw AppError.conflict(
        `Cannot submit verification documents from current status '${profile.verificationStatus}'`,
        "INVALID_STATE_TRANSITION"
      );
    }

    // Uniqueness check for medical registration license number
    const normalizedRegNumber = input.registrationNumber.trim().toUpperCase();
    const existingRegistration = await DoctorProfile.findOne({
      registrationNumber: normalizedRegNumber,
      _id: { $ne: profile._id },
    });

    if (existingRegistration) {
      throw AppError.conflict(
        "Medical registration number already exists in system",
        "DOCTOR_REGISTRATION_EXISTS"
      );
    }

    // Update credentials and document metadata
    profile.registrationNumber = normalizedRegNumber;
    profile.registrationCouncil = input.registrationCouncil.trim();
    profile.qualifications = input.qualifications;
    profile.verificationDocuments = input.documents.map((doc) => ({
      documentType: doc.documentType,
      fileKey: doc.fileKey.trim(),
      uploadedAt: new Date(),
    }));

    // State Transition: UNSUBMITTED / INFO_REQUESTED -> PENDING_REVIEW
    profile.verificationStatus = DoctorVerificationStatus.PENDING_REVIEW;

    try {
      await profile.save();
    } catch (error: unknown) {
      // Handle concurrent race conditions colliding on the unique registrationNumber index
      if (
        (error as { code?: number }).code === 11000 ||
        ((error as { name?: string }).name === "MongoServerError" &&
          (error as { code?: number }).code === 11000)
      ) {
        throw AppError.conflict(
          "Medical registration number already exists in system",
          "DOCTOR_REGISTRATION_EXISTS"
        );
      }
      throw error;
    }

    return profile;
  }
}

/**
 * Strips private document keys (fileKey) and internal Mongoose fields
 * before returning doctor profiles to clients.
 */
export function sanitizeDoctorProfile(
  profile: IDoctorProfile | (Record<string, unknown> & { toJSON?: () => Record<string, unknown> })
): Record<string, unknown> {
  const json: Record<string, any> =
    typeof (profile as { toJSON?: () => Record<string, unknown> }).toJSON === "function"
      ? (profile as { toJSON: () => Record<string, unknown> }).toJSON()
      : { ...(profile as Record<string, unknown>) };

  delete json.__v;
  if (json._id) {
    json.id = json._id.toString();
    delete json._id;
  }

  if (Array.isArray(json.verificationDocuments)) {
    json.verificationDocuments = json.verificationDocuments.map((doc: any) => {
      const sanitizedDoc =
        typeof doc?.toJSON === "function" ? doc.toJSON() : { ...doc };
      delete sanitizedDoc.fileKey;
      return sanitizedDoc;
    });
  }

  return json;
}

export const doctorService = new DoctorService();
