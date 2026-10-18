import mongoose, { Schema, model, type Model } from "mongoose";
import { ReviewStatus, type IReview } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const reviewSchema = new Schema<IReview>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Patient reviewer ID is required"],
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
      required: [
        function (this: IReview) {
          return !this.pharmacyId;
        },
        "Review must target either a doctor or a pharmacy",
      ],
    },
    pharmacyId: {
      type: Schema.Types.ObjectId,
      ref: "PharmacyProfile",
      index: true,
      required: [
        function (this: IReview) {
          return !this.doctorId;
        },
        "Review must target either a doctor or a pharmacy",
      ],
    },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
      validate: {
        validator: Number.isInteger,
        message: "Rating must be an integer between 1 and 5",
      },
    },
    comment: {
      type: String,
      trim: true,
      minlength: [5, "Review comment must be at least 5 characters"],
      maxlength: [1000, "Review comment cannot exceed 1000 characters"],
    },
    status: {
      type: String,
      enum: Object.values(ReviewStatus),
      default: ReviewStatus.PUBLISHED,
      required: true,
    },
    moderationReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// CRITICAL UNIQUE CONSTRAINT: Exactly one review per appointment
reviewSchema.index({ appointmentId: 1 }, { unique: true, sparse: true });

// Order reviews uniqueness if order is reviewed
reviewSchema.index({ orderId: 1 }, { unique: true, sparse: true });

// Profile discovery and aggregate calculation query indexes
reviewSchema.index({ doctorId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ pharmacyId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ patientId: 1, createdAt: -1 });

reviewSchema.plugin(toJSONPlugin);

export const Review: Model<IReview> =
  (mongoose.models.Review as Model<IReview>) ||
  model<IReview>("Review", reviewSchema);
