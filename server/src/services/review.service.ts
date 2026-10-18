import mongoose from "mongoose";
import { Review } from "../models/review.model.js";
import { Appointment } from "../models/appointment.model.js";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import { User } from "../models/user.model.js";
import {
  AppointmentStatus,
  ReviewStatus,
  UserRole,
  type IReview,
} from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import type { CreateReviewInput } from "../validators/review.validator.js";
import { AppError } from "../utils/api-error.js";

export interface ListDoctorReviewsOptions {
  page?: number;
  limit?: number;
}

export interface PublicReviewItem {
  id: string;
  rating: number;
  comment?: string;
  createdAt: string;
  patient: {
    id: string;
    fullName: string;
    avatar?: string;
  };
}

export interface ListDoctorReviewsResult {
  reviews: PublicReviewItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  doctor: {
    id: string;
    rating: number;
    totalReviews: number;
  };
}

export class ReviewService {
  /**
   * Submits a verified doctor review for a completed appointment.
   *
   * Business & Security Rules:
   * 1. Patient Role Only: Only authenticated patients may review doctors.
   * 2. Verified Appointment Ownership: The caller must own the appointment (appointment.patientId === user.id).
   * 3. Encounter Status: The appointment must be strictly COMPLETED (returns 422 APPOINTMENT_NOT_COMPLETED otherwise).
   * 4. Doctor Identity: Derived server-side from appointment.doctorId to prevent doctor spoofing.
   * 5. One Review Per Appointment: Enforced by application pre-check and atomic MongoDB unique index (returns 409).
   * 6. Concurrency-Safe Aggregate: Atomically updates doctor average rating and review count.
   *    Uses replica-set transactions where available, with compensating write rollback on standalone MongoDB.
   */
  public async createReview(
    user: AuthenticatedUser,
    input: CreateReviewInput
  ): Promise<IReview> {
    // 1. Role verification
    if (user.role !== UserRole.PATIENT) {
      throw AppError.forbidden(
        "Access denied: only patients may submit post-consultation reviews",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // 2. Validate appointment ID format
    if (!mongoose.Types.ObjectId.isValid(input.appointmentId)) {
      throw AppError.badRequest("Invalid appointment identifier format", "BAD_REQUEST");
    }

    // 3. Load appointment
    const appointment = await Appointment.findById(input.appointmentId);
    if (!appointment) {
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    }

    // 4. Verify patient ownership
    if (appointment.patientId.toString() !== user.id) {
      throw AppError.forbidden(
        "Access denied: you do not have permission to review this appointment",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 5. Verify appointment status is strictly COMPLETED
    if (appointment.status !== AppointmentStatus.COMPLETED) {
      throw new AppError(
        422,
        "APPOINTMENT_NOT_COMPLETED",
        `Cannot review appointment: status is '${appointment.status}'. Only completed appointments qualify for patient reviews.`
      );
    }

    // 6. Anti-fraud: Doctor identity derived strictly from appointment
    const doctorUserId = appointment.doctorId;
    if (input.doctorId && input.doctorId !== doctorUserId.toString()) {
      throw new AppError(
        400,
        "DOCTOR_MISMATCH",
        "Provided doctor identifier does not match the attending clinician for this appointment"
      );
    }

    // 7. Duplicate review pre-check
    const existingReview = await Review.findOne({
      appointmentId: appointment._id,
    });
    if (existingReview) {
      throw new AppError(
        409,
        "REVIEW_ALREADY_EXISTS",
        "A review has already been submitted for this appointment"
      );
    }

    // 8. Detect MongoDB transaction support (replica set vs standalone)
    let isReplicaSet = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const client = mongoose.connection.getClient();
        const topology = (
          client as unknown as {
            topology?: { description?: { type?: string; setName?: string } };
          }
        )?.topology?.description;
        isReplicaSet =
          topology?.type === "ReplicaSetWithPrimary" ||
          topology?.type === "Sharded" ||
          Boolean(topology?.setName);
      } catch {
        isReplicaSet = false;
      }
    }

    let session: mongoose.ClientSession | undefined = undefined;
    if (isReplicaSet) {
      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch {
        session = undefined;
      }
    }

    let createdReviewId: mongoose.Types.ObjectId | undefined;
    let review: IReview;

    try {
      // Step A: Insert review document with DB uniqueness constraint
      try {
        const [createdDoc] = await Review.create(
          [
            {
              patientId: appointment.patientId,
              doctorId: doctorUserId,
              appointmentId: appointment._id,
              rating: input.rating,
              comment: input.comment?.trim() || undefined,
              status: ReviewStatus.PUBLISHED,
            },
          ],
          session ? { session } : {}
        );
        review = createdDoc;
        createdReviewId = createdDoc._id;
      } catch (dbError: any) {
        if (dbError?.code === 11000) {
          throw new AppError(
            409,
            "REVIEW_ALREADY_EXISTS",
            "A review has already been submitted for this appointment"
          );
        }
        throw dbError;
      }

      // Step B: Atomically recalculate and update doctor aggregate rating on DoctorProfile
      await this.updateDoctorAggregateRating(doctorUserId, session);

      // Commit transaction if active
      if (session && session.inTransaction()) {
        await session.commitTransaction();
      }
    } catch (error) {
      if (session && session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {}
      } else if (createdReviewId) {
        // Compensating rollback for standalone MongoDB
        try {
          await Review.deleteOne({ _id: createdReviewId });
        } catch {}
      }
      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }

    return review;
  }

  private doctorUpdateQueues = new Map<string, Promise<any>>();

  /**
   * Recalculates doctor aggregate rating and review count using an atomic MongoDB aggregation pipeline.
   * Concurrency-safe: Serializes updates per doctor in-memory and enforces monotonic totalReviews guards in MongoDB.
   * Updates DoctorProfile with rounded 1-decimal average and total review count.
   */
  public async updateDoctorAggregateRating(
    doctorUserId: mongoose.Types.ObjectId,
    session?: mongoose.ClientSession
  ): Promise<{ rating: number; totalReviews: number }> {
    const queueKey = doctorUserId.toString();
    const previousTask = this.doctorUpdateQueues.get(queueKey) || Promise.resolve();

    const currentTask = (async () => {
      try {
        await previousTask;
      } catch {}

      let finalTotalReviews = 0;
      let finalRoundedRating = 0;
      let updated = false;
      let attempts = 0;

      while (!updated && attempts < 5) {
        attempts++;
        const stats = await Review.aggregate(
          [
            {
              $match: {
                doctorId: doctorUserId,
                status: ReviewStatus.PUBLISHED,
              },
            },
            {
              $group: {
                _id: "$doctorId",
                totalReviews: { $sum: 1 },
                averageRating: { $avg: "$rating" },
              },
            },
          ],
          session ? { session } : {}
        );

        finalTotalReviews = stats.length > 0 ? stats[0].totalReviews : 0;
        const rawAvg = stats.length > 0 ? stats[0].averageRating : 0;
        finalRoundedRating =
          finalTotalReviews > 0 ? Math.round(rawAvg * 10) / 10 : 0;

        const updateResult = await DoctorProfile.updateOne(
          {
            userId: doctorUserId,
            $or: [
              { totalReviews: { $lte: finalTotalReviews } },
              { totalReviews: { $exists: false } },
            ],
          },
          {
            $set: {
              rating: finalRoundedRating,
              totalReviews: finalTotalReviews,
            },
          },
          session ? { session } : {}
        );

        if (updateResult.matchedCount > 0 || finalTotalReviews === 0) {
          updated = true;
        }
      }

      return {
        rating: finalRoundedRating,
        totalReviews: finalTotalReviews,
      };
    })();

    this.doctorUpdateQueues.set(queueKey, currentTask);

    try {
      return await currentTask;
    } finally {
      if (this.doctorUpdateQueues.get(queueKey) === currentTask) {
        this.doctorUpdateQueues.delete(queueKey);
      }
    }
  }

  /**
   * Retrieves public, sanitized reviews for a doctor with bounded pagination and deterministic ordering.
   * Endpoint: GET /api/v1/reviews/doctors/:id
   */
  public async getDoctorReviews(
    doctorId: string,
    options: ListDoctorReviewsOptions = {}
  ): Promise<ListDoctorReviewsResult> {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      throw AppError.badRequest("Invalid doctor identifier format", "BAD_REQUEST");
    }

    const doctorObjectId = new mongoose.Types.ObjectId(doctorId);

    // Resolve doctor: :id can be DoctorProfile._id or Doctor User._id
    const doctorProfile = await DoctorProfile.findOne({
      $or: [{ _id: doctorObjectId }, { userId: doctorObjectId }],
    });

    let doctorUserId: mongoose.Types.ObjectId;
    let activeDoctorProfile = doctorProfile;

    if (doctorProfile) {
      doctorUserId = doctorProfile.userId;
    } else {
      // Check if :id is a User with DOCTOR role
      const doctorUser = await User.findOne({
        _id: doctorObjectId,
        role: UserRole.DOCTOR,
      });

      if (!doctorUser) {
        throw new AppError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
      }
      doctorUserId = doctorUser._id;
      activeDoctorProfile = await DoctorProfile.findOne({ userId: doctorUserId });
    }

    const page = Math.max(1, options.page ? Math.floor(options.page) : 1);
    let limit = 20;
    if (options.limit !== undefined) {
      if (typeof options.limit !== "number" || isNaN(options.limit) || options.limit < 1) {
        throw AppError.badRequest("Invalid limit parameter", "BAD_REQUEST");
      }
      limit = Math.min(100, Math.floor(options.limit));
    }

    const filter = {
      doctorId: doctorUserId,
      status: ReviewStatus.PUBLISHED,
    };

    const total = await Review.countDocuments(filter);
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    const rawReviews = await Review.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("patientId", "fullName avatar")
      .lean();

    const reviews: PublicReviewItem[] = rawReviews.map((r: any) => {
      const patientObj = r.patientId;
      const patientId = patientObj?._id ? patientObj._id.toString() : r.patientId?.toString() || "";
      const patientName = patientObj?.fullName || "Verified Patient";
      const patientAvatar = patientObj?.avatar || undefined;

      return {
        id: r._id.toString(),
        rating: r.rating,
        comment: r.comment || undefined,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
        patient: {
          id: patientId,
          fullName: patientName,
          ...(patientAvatar ? { avatar: patientAvatar } : {}),
        },
      };
    });

    return {
      reviews,
      total,
      page,
      limit,
      totalPages,
      doctor: {
        id: doctorUserId.toString(),
        rating: activeDoctorProfile?.rating ?? 0,
        totalReviews: activeDoctorProfile?.totalReviews ?? total,
      },
    };
  }
}

export const reviewService = new ReviewService();
