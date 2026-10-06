import { Schema, model, type Model } from "mongoose";
import { Gender, BloodGroup, type IPatientProfile } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const addressSchema = new Schema(
  {
    street: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const emergencyContactSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    relationship: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const patientProfileSchema = new Schema<IPatientProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owning user ID is required"],
      unique: true, // Enforces strictly one patient profile per user
      index: true,
    },
    dateOfBirth: {
      type: Date,
    },
    gender: {
      type: String,
      enum: Object.values(Gender),
    },
    bloodGroup: {
      type: String,
      enum: Object.values(BloodGroup),
    },
    address: {
      type: addressSchema,
    },
    emergencyContact: {
      type: emergencyContactSchema,
    },
    allergies: {
      type: [String],
      default: [],
    },
    medicalConditions: {
      type: [String],
      default: [],
    },
    currentMedications: {
      type: [String],
      default: [],
    },
    profilePhoto: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

patientProfileSchema.plugin(toJSONPlugin);

export const PatientProfile: Model<IPatientProfile> = model<IPatientProfile>(
  "PatientProfile",
  patientProfileSchema
);
