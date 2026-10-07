import { Schema, model, type Model } from "mongoose";
import {
  ConsultationStatus,
  ConsultationType,
  type IConsultation,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const consultationSchema = new Schema<IConsultation>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: [true, "Parent appointment ID is required"],
      unique: true, // 1-to-1 relationship between appointment and clinical consultation session
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Patient ID is required"],
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Doctor ID is required"],
      index: true,
    },
    consultationType: {
      type: String,
      enum: Object.values(ConsultationType),
      required: [true, "Consultation type is required"],
    },
    status: {
      type: String,
      enum: Object.values(ConsultationStatus),
      default: ConsultationStatus.SCHEDULED,
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      required: [true, "Virtual room ID is required"],
      trim: true,
    },
    startedAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    pausedAt: {
      type: Date,
    },
    pauseGraceExpiresAt: {
      type: Date, // 5-minute grace window before auto-terminating paused session
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    diagnosis: {
      type: String,
      trim: true,
    },
    clinicalNotes: {
      type: String,
      trim: true,
    },
    recommendedFollowUpDays: {
      type: Number,
      min: 0,
    },
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
    },
    providerSessionId: {
      type: String,
      trim: true,
    },
    providerMetadata: {
      type: Schema.Types.Mixed,
      private: true, // Internal WebRTC provider tokens/secrets hidden from client JSON
    },
  },
  {
    timestamps: true,
  }
);

consultationSchema.index({ patientId: 1, status: 1 });
consultationSchema.index({ doctorId: 1, status: 1 });

consultationSchema.plugin(toJSONPlugin);

export const Consultation: Model<IConsultation> = model<IConsultation>(
  "Consultation",
  consultationSchema
);
