import { Schema, model, type Model } from "mongoose";
import {
  DoctorVerificationStatus,
  ConsultationType,
  type IDoctorProfile,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const clinicAddressSchema = new Schema(
  {
    street: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: "2dsphere",
    },
  },
  { _id: false }
);

const verificationDocumentSchema = new Schema(
  {
    documentType: {
      type: String,
      enum: ["MEDICAL_LICENSE", "DEGREE_CERTIFICATE", "GOVERNMENT_ID", "OTHER"],
      required: true,
    },
    fileKey: {
      type: String,
      required: true,
      trim: true,
      private: true, // Internal storage key, hidden by default from public view
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

verificationDocumentSchema.plugin(toJSONPlugin);

const doctorProfileSchema = new Schema<IDoctorProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owning user ID is required"],
      unique: true, // Strictly one doctor profile per user
      index: true,
    },
    specialization: {
      type: String,
      required: [true, "Specialization is required"],
      trim: true,
      index: true,
    },
    qualifications: {
      type: [String],
      required: [true, "At least one qualification is required"],
      validate: [(val: string[]) => val.length > 0, "Must provide at least one qualification"],
    },
    experienceYears: {
      type: Number,
      required: [true, "Years of experience is required"],
      min: [0, "Experience cannot be negative"],
      index: true,
    },
    registrationNumber: {
      type: String,
      required: [true, "Medical registration license number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    registrationCouncil: {
      type: String,
      required: [true, "Medical registration council name is required"],
      trim: true,
    },
    clinicName: {
      type: String,
      trim: true,
    },
    clinicAddress: {
      type: clinicAddressSchema,
    },
    languages: {
      type: [String],
      default: ["English"],
    },
    consultationFee: {
      type: Number,
      required: [true, "Consultation fee is required"],
      min: [0, "Consultation fee cannot be negative"],
      index: true,
    },
    consultationTypes: {
      type: [String],
      enum: Object.values(ConsultationType),
      default: [ConsultationType.VIDEO, ConsultationType.CHAT],
    },
    bio: {
      type: String,
      maxlength: [2000, "Bio cannot exceed 2000 characters"],
      trim: true,
    },
    verificationStatus: {
      type: String,
      enum: Object.values(DoctorVerificationStatus),
      default: DoctorVerificationStatus.UNSUBMITTED,
      required: true,
      index: true,
    },
    verificationDocuments: {
      type: [verificationDocumentSchema],
      default: [],
    },
    verificationReviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    verificationReviewedAt: {
      type: Date,
    },
    verificationNotes: {
      type: String,
      trim: true,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      index: true,
    },
    totalReviews: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for public doctor discovery and search filtering
doctorProfileSchema.index({ verificationStatus: 1, specialization: 1, rating: -1 });
doctorProfileSchema.index({ "clinicAddress.city": 1, verificationStatus: 1 });

doctorProfileSchema.plugin(toJSONPlugin);

export const DoctorProfile: Model<IDoctorProfile> = model<IDoctorProfile>(
  "DoctorProfile",
  doctorProfileSchema
);
