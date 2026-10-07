import { Schema, model, type Model } from "mongoose";
import {
  MedicalRecordType,
  type IMedicalRecord,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const medicalRecordSchema = new Schema<IMedicalRecord>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Patient ID is required"],
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Uploader user ID is required"],
    },
    relatedAppointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    relatedConsultationId: {
      type: Schema.Types.ObjectId,
      ref: "Consultation",
    },
    title: {
      type: String,
      required: [true, "Record title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, "Description cannot exceed 2000 characters"],
    },
    recordType: {
      type: String,
      enum: Object.values(MedicalRecordType),
      required: [true, "Record type is required"],
      index: true,
    },
    recordDate: {
      type: Date,
      required: [true, "Record date is required"],
      default: Date.now,
      index: true,
    },
    storageKey: {
      type: String,
      required: [true, "Storage key is required"],
      trim: true,
      private: true, // Internal S3/storage object path stripped from JSON output
    },
    fileName: {
      type: String,
      required: [true, "File name is required"],
      trim: true,
    },
    fileType: {
      type: String,
      required: [true, "File MIME type is required"],
      trim: true,
    },
    sizeBytes: {
      type: Number,
      required: [true, "File size in bytes is required"],
      min: [1, "File size must be greater than 0"],
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

medicalRecordSchema.index({ patientId: 1, recordDate: -1 });
medicalRecordSchema.index({ patientId: 1, recordType: 1 });

medicalRecordSchema.plugin(toJSONPlugin);

export const MedicalRecord: Model<IMedicalRecord> = model<IMedicalRecord>(
  "MedicalRecord",
  medicalRecordSchema
);
