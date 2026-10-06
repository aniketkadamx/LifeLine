import { Schema, model, type Model } from "mongoose";
import { UserRole, UserStatus, type IUser } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      sparse: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false, // Omit from default query projections
      private: true, // Stripped by toJSONPlugin
    },
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.PATIENT,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(UserStatus),
      default: UserStatus.ACTIVE,
      required: true,
      index: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    lastLoginAt: {
      type: Date,
    },
    patientProfile: {
      type: Schema.Types.ObjectId,
      ref: "PatientProfile",
    },
    doctorProfile: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
    },
    pharmacyProfile: {
      type: Schema.Types.ObjectId,
      ref: "PharmacyProfile",
    },
  },
  {
    timestamps: true,
  }
);

// Apply generic serialization plugin
userSchema.plugin(toJSONPlugin);

export const User: Model<IUser> = model<IUser>("User", userSchema);
