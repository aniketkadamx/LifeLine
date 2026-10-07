import { Schema, model, type Model } from "mongoose";
import {
  PrescriptionStatus,
  MedicineRoute,
  type IPrescription,
  type IPrescriptionMedicineItem,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const prescriptionMedicineItemSchema = new Schema<IPrescriptionMedicineItem>(
  {
    medicineId: {
      type: Schema.Types.ObjectId,
      required: [true, "Medicine ID reference is required"],
    },
    medicineName: {
      type: String,
      required: [true, "Medicine name snapshot is required"],
      trim: true,
    },
    dosage: {
      type: String,
      required: [true, "Dosage is required"],
      trim: true,
    },
    frequency: {
      type: String,
      required: [true, "Frequency instructions are required"],
      trim: true,
    },
    durationDays: {
      type: Number,
      required: [true, "Duration in days is required"],
      min: [1, "Duration must be at least 1 day"],
    },
    quantity: {
      type: Number,
      required: [true, "Total quantity is required"],
      min: [1, "Quantity must be at least 1"],
      default: 1,
    },
    route: {
      type: String,
      enum: Object.values(MedicineRoute),
      default: MedicineRoute.ORAL,
      required: true,
    },
    specialInstructions: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const prescriptionSchema = new Schema<IPrescription>(
  {
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
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      index: true,
    },
    consultationId: {
      type: Schema.Types.ObjectId,
      ref: "Consultation",
    },
    status: {
      type: String,
      enum: Object.values(PrescriptionStatus),
      default: PrescriptionStatus.DRAFT,
      required: true,
      index: true,
    },
    diagnosis: {
      type: String,
      required: [true, "Clinical diagnosis is required"],
      trim: true,
    },
    medicines: {
      type: [prescriptionMedicineItemSchema],
      required: [true, "At least one medicine item is required"],
      validate: [
        (val: IPrescriptionMedicineItem[]) => val.length > 0,
        "Prescription must contain at least one medicine item",
      ],
    },
    additionalNotes: {
      type: String,
      trim: true,
    },
    issuedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      required: [true, "Expiration date is required (standard 90 days validity)"],
      index: true,
    },
    revokedAt: {
      type: Date,
    },
    revokedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    revocationReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

prescriptionSchema.index({ patientId: 1, issuedAt: -1 });
prescriptionSchema.index({ doctorId: 1, issuedAt: -1 });
prescriptionSchema.index({ status: 1, expiresAt: 1 });

prescriptionSchema.plugin(toJSONPlugin);

export const Prescription: Model<IPrescription> = model<IPrescription>(
  "Prescription",
  prescriptionSchema
);
