import mongoose from "mongoose";
import { PharmacyProfile } from "../models/pharmacy-profile.model.js";
import {
  PharmacyVerificationStatus,
  type IPharmacyProfile,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type {
  SubmitPharmacyLicenseInput,
  UpdatePharmacyProfileInput,
} from "../validators/pharmacy.validator.js";

/**
 * Service managing pharmacy profile retrieval, self-service updates,
 * and drug license credential submission.
 */
export class PharmacyService {
  /**
   * Retrieves a pharmacy profile by the owning user's ID.
   */
  public async getProfileByUserId(userId: string): Promise<IPharmacyProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await PharmacyProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Pharmacy profile not found", "PHARMACY_NOT_FOUND");
    }

    return profile;
  }

  /**
   * Updates non-protected pharmacy self-service profile attributes.
   * Strictly preserves omitted fields during partial updates.
   */
  public async updateProfile(
    userId: string,
    input: UpdatePharmacyProfileInput
  ): Promise<IPharmacyProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await PharmacyProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Pharmacy profile not found", "PHARMACY_NOT_FOUND");
    }

    // Apply partial updates while preserving unsupplied fields
    if (input.pharmacyName !== undefined) {
      profile.pharmacyName = input.pharmacyName;
    }
    if (input.ownerName !== undefined) {
      profile.ownerName = input.ownerName;
    }
    if (input.address !== undefined) {
      profile.address = input.address;
    }
    if (input.phone !== undefined) {
      profile.phone = input.phone;
    }
    if (input.email !== undefined) {
      profile.email = input.email;
    }
    if (input.openingHours !== undefined) {
      profile.openingHours = input.openingHours;
    }
    if (input.deliveryAvailable !== undefined) {
      profile.deliveryAvailable = input.deliveryAvailable;
    }
    if (input.serviceArea !== undefined) {
      profile.serviceArea = input.serviceArea;
    }

    await profile.save();
    return profile;
  }

  /**
   * Submits retail drug license credentials and documents for administrative review.
   * Follows the Pharmacy License Verification State Machine in docs/api/STATE_MACHINES.md Section 7.
   */
  public async submitLicense(
    userId: string,
    input: SubmitPharmacyLicenseInput
  ): Promise<IPharmacyProfile> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier format", "BAD_REQUEST");
    }

    const profile = await PharmacyProfile.findOne({
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (!profile) {
      throw AppError.notFound("Pharmacy profile not found", "PHARMACY_NOT_FOUND");
    }

    // Guard: Approved credentials cannot be overwritten without admin authorization
    if (
      profile.verificationStatus === PharmacyVerificationStatus.APPROVED_VERIFIED
    ) {
      throw AppError.conflict(
        "Verified pharmacy credentials cannot be modified without admin approval",
        "PHARMACY_ALREADY_VERIFIED"
      );
    }

    // Guard: Prevent redundant resubmission while already awaiting review
    if (
      profile.verificationStatus === PharmacyVerificationStatus.PENDING_REVIEW
    ) {
      throw AppError.conflict(
        "Pharmacy license documents are already under review",
        "INVALID_STATE_TRANSITION"
      );
    }

    // Guard: State machine transition only permitted from UNSUBMITTED
    if (
      profile.verificationStatus !== PharmacyVerificationStatus.UNSUBMITTED
    ) {
      throw AppError.conflict(
        `Cannot submit license documents from current status '${profile.verificationStatus}'`,
        "INVALID_STATE_TRANSITION"
      );
    }

    // Uniqueness check for retail drug license number
    const normalizedLicenseNumber = input.licenseNumber.trim().toUpperCase();
    const existingLicense = await PharmacyProfile.findOne({
      licenseNumber: normalizedLicenseNumber,
      _id: { $ne: profile._id },
    });

    if (existingLicense) {
      throw AppError.conflict(
        "Retail drug license number already exists in system",
        "PHARMACY_LICENSE_EXISTS"
      );
    }

    // Update credentials and document metadata
    profile.licenseNumber = normalizedLicenseNumber;
    profile.licenseDocuments = input.documents.map((doc) => ({
      documentType: doc.documentType,
      fileKey: doc.fileKey.trim(),
      uploadedAt: new Date(),
    }));

    // State Transition: UNSUBMITTED -> PENDING_REVIEW
    profile.verificationStatus = PharmacyVerificationStatus.PENDING_REVIEW;

    try {
      await profile.save();
    } catch (error: unknown) {
      // Handle concurrent race conditions colliding on the unique licenseNumber index
      if (
        (error as { code?: number }).code === 11000 ||
        ((error as { name?: string }).name === "MongoServerError" &&
          (error as { code?: number }).code === 11000)
      ) {
        throw AppError.conflict(
          "Retail drug license number already exists in system",
          "PHARMACY_LICENSE_EXISTS"
        );
      }
      throw error;
    }

    return profile;
  }
}

/**
 * Strips private document keys (fileKey) and internal Mongoose fields
 * before returning pharmacy profiles to clients.
 */
export function sanitizePharmacyProfile(
  profile: IPharmacyProfile | (Record<string, unknown> & { toJSON?: () => Record<string, unknown> })
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

  if (Array.isArray(json.licenseDocuments)) {
    json.licenseDocuments = json.licenseDocuments.map((doc: any) => {
      const sanitizedDoc =
        typeof doc?.toJSON === "function" ? doc.toJSON() : { ...doc };
      delete sanitizedDoc.fileKey;
      return sanitizedDoc;
    });
  }

  return json;
}

export const pharmacyService = new PharmacyService();
