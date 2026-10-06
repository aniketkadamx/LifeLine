import { Schema, model, type Model } from "mongoose";
import {
  PharmacyVerificationStatus,
  type IPharmacyProfile,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const pharmacyAddressSchema = new Schema(
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

const pharmacyLicenseDocumentSchema = new Schema(
  {
    documentType: {
      type: String,
      default: "PHARMACY_LICENSE",
      required: true,
    },
    fileKey: {
      type: String,
      required: true,
      trim: true,
      private: true, // Sensitive internal storage key
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

pharmacyLicenseDocumentSchema.plugin(toJSONPlugin);

const openingHoursSchema = new Schema(
  {
    openTime: { type: String, required: true, trim: true }, // e.g. "08:00"
    closeTime: { type: String, required: true, trim: true }, // e.g. "22:00"
    closedDays: { type: [String], default: [] },
  },
  { _id: false }
);

const pharmacyProfileSchema = new Schema<IPharmacyProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owning user ID is required"],
      unique: true, // Strictly one pharmacy profile per user
      index: true,
    },
    pharmacyName: {
      type: String,
      required: [true, "Pharmacy name is required"],
      trim: true,
      index: true,
    },
    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
    },
    licenseNumber: {
      type: String,
      required: [true, "Retail drug license number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    address: {
      type: pharmacyAddressSchema,
      required: [true, "Pharmacy address is required"],
    },
    phone: {
      type: String,
      required: [true, "Contact phone number is required"],
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    openingHours: {
      type: openingHoursSchema,
    },
    verificationStatus: {
      type: String,
      enum: Object.values(PharmacyVerificationStatus),
      default: PharmacyVerificationStatus.UNSUBMITTED,
      required: true,
      index: true,
    },
    licenseDocuments: {
      type: [pharmacyLicenseDocumentSchema],
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
    deliveryAvailable: {
      type: Boolean,
      default: true,
    },
    serviceArea: {
      type: [String],
      default: [],
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
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

pharmacyProfileSchema.index({ verificationStatus: 1, "address.city": 1 });

pharmacyProfileSchema.plugin(toJSONPlugin);

export const PharmacyProfile: Model<IPharmacyProfile> = model<IPharmacyProfile>(
  "PharmacyProfile",
  pharmacyProfileSchema
);
