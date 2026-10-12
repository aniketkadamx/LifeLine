import mongoose from "mongoose";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import {
  DoctorVerificationStatus,
  UserStatus,
  type ConsultationType,
  type IDoctorProfile,
} from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import type {
  DoctorSearchQuery,
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

  /**
   * Searches and filters the public directory of verified and active doctors.
   *
   * Eligibility Criteria (strictly enforced inside the database query):
   * - verificationStatus === APPROVED_VERIFIED
   * - user.status === ACTIVE
   */
  public async searchPublicDoctors(query: DoctorSearchQuery): Promise<{
    doctors: PublicDoctorSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const matchDoctor: Record<string, any> = {
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    };

    if (query.specialization) {
      matchDoctor.specialization = {
        $regex: `^${escapeRegex(query.specialization)}$`,
        $options: "i",
      };
    }

    if (query.location) {
      const locRegex = { $regex: escapeRegex(query.location), $options: "i" };
      matchDoctor.$or = [
        { "clinicAddress.city": locRegex },
        { "clinicAddress.state": locRegex },
        { "clinicAddress.postalCode": locRegex },
      ];
    }

    const minExp = query.minExperience ?? query.experience;
    if (minExp !== undefined) {
      matchDoctor.experienceYears = { $gte: minExp };
    }

    const minRat = query.minRating ?? query.rating;
    if (minRat !== undefined) {
      matchDoctor.rating = { $gte: minRat };
    }

    if (query.minFee !== undefined || query.maxFee !== undefined) {
      matchDoctor.consultationFee = {};
      if (query.minFee !== undefined) {
        matchDoctor.consultationFee.$gte = query.minFee;
      }
      if (query.maxFee !== undefined) {
        matchDoctor.consultationFee.$lte = query.maxFee;
      }
    }

    const userMatch: Record<string, any> = {
      "user.status": UserStatus.ACTIVE,
    };

    if (query.search) {
      const searchRegex = { $regex: escapeRegex(query.search), $options: "i" };
      userMatch.$or = [
        { "user.fullName": searchRegex },
        { clinicName: searchRegex },
      ];
    }

    const sortFieldMap: Record<string, string> = {
      rating: "rating",
      experience: "experienceYears",
      experienceYears: "experienceYears",
      fee: "consultationFee",
      consultationFee: "consultationFee",
      createdAt: "createdAt",
    };

    const sortField = sortFieldMap[query.sort || "rating"] || "rating";
    const sortOrder = query.order === "asc" ? 1 : -1;

    const sortStage: Record<string, 1 | -1> = {
      [sortField]: sortOrder,
    };
    if (sortField === "rating") {
      sortStage.totalReviews = -1;
    }
    sortStage._id = 1;

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const skip = (page - 1) * limit;

    const pipeline: mongoose.PipelineStage[] = [
      { $match: matchDoctor },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      { $match: userMatch },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $sort: sortStage },
            { $skip: skip },
            { $limit: limit },
          ],
        },
      },
    ];

    const [result] = await DoctorProfile.aggregate(pipeline);
    const total = result?.metadata?.[0]?.total || 0;
    const rawDoctors = result?.data || [];
    const doctors = rawDoctors.map((doc: any) =>
      serializePublicDoctorSummary(doc)
    );

    return {
      doctors,
      total,
      page,
      limit,
    };
  }

  /**
   * Retrieves public details of a specific verified and active doctor.
   *
   * Enforces the public eligibility rule inside query:
   * Returns 404 DOCTOR_NOT_FOUND if the doctor does not exist,
   * is unverified, or user account is not ACTIVE.
   */
  public async getPublicDoctorById(
    doctorId: string
  ): Promise<PublicDoctorDetail> {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      throw AppError.badRequest("Invalid doctor identifier format", "BAD_REQUEST");
    }

    const doctorObjectId = new mongoose.Types.ObjectId(doctorId);

    const pipeline: mongoose.PipelineStage[] = [
      {
        $match: {
          $or: [{ _id: doctorObjectId }, { userId: doctorObjectId }],
          verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $match: {
          "user.status": UserStatus.ACTIVE,
        },
      },
    ];

    const [doctor] = await DoctorProfile.aggregate(pipeline);

    if (!doctor) {
      throw AppError.notFound("Doctor not found", "DOCTOR_NOT_FOUND");
    }

    return serializePublicDoctorDetail(doctor);
  }
}

export interface PublicDoctorSummary {
  id: string;
  name: string;
  avatar?: string;
  specialization: string;
  qualifications: string[];
  experienceYears: number;
  clinicName?: string;
  clinicAddress?: {
    street?: string;
    city: string;
    state: string;
    postalCode?: string;
    country?: string;
  };
  languages: string[];
  consultationFee: number;
  consultationTypes: ConsultationType[];
  rating: number;
  totalReviews: number;
}

export interface PublicDoctorDetail extends PublicDoctorSummary {
  bio?: string;
  registrationCouncil?: string;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function serializePublicDoctorSummary(doc: any): PublicDoctorSummary {
  return {
    id: doc._id?.toString() || doc.id,
    name: doc.user?.fullName || doc.name || "",
    avatar: doc.user?.avatar || doc.avatar,
    specialization: doc.specialization,
    qualifications: Array.isArray(doc.qualifications) ? doc.qualifications : [],
    experienceYears: doc.experienceYears ?? 0,
    clinicName: doc.clinicName,
    clinicAddress: doc.clinicAddress
      ? {
          street: doc.clinicAddress.street,
          city: doc.clinicAddress.city,
          state: doc.clinicAddress.state,
          postalCode: doc.clinicAddress.postalCode,
          country: doc.clinicAddress.country,
        }
      : undefined,
    languages: Array.isArray(doc.languages) ? doc.languages : ["English"],
    consultationFee: doc.consultationFee ?? 0,
    consultationTypes: Array.isArray(doc.consultationTypes)
      ? doc.consultationTypes
      : [],
    rating: doc.rating ?? 0,
    totalReviews: doc.totalReviews ?? 0,
  };
}

export function serializePublicDoctorDetail(doc: any): PublicDoctorDetail {
  const summary = serializePublicDoctorSummary(doc);
  return {
    ...summary,
    bio: doc.bio,
    registrationCouncil: doc.registrationCouncil,
  };
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
