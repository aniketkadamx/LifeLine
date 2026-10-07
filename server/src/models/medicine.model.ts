import { Schema, model, type Model } from "mongoose";
import { DosageForm, type IMedicine } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const medicineSchema = new Schema<IMedicine>(
  {
    name: {
      type: String,
      required: [true, "Medicine name is required"],
      trim: true,
      index: true,
    },
    genericName: {
      type: String,
      required: [true, "Generic chemical name is required"],
      trim: true,
      index: true,
    },
    brandName: {
      type: String,
      trim: true,
    },
    manufacturer: {
      type: String,
      required: [true, "Manufacturer name is required"],
      trim: true,
      index: true,
    },
    dosageForm: {
      type: String,
      enum: Object.values(DosageForm),
      required: [true, "Dosage form is required"],
      index: true,
    },
    strength: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    prescriptionRequired: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound and full-text search indexes
medicineSchema.index({
  name: "text",
  genericName: "text",
  brandName: "text",
  manufacturer: "text",
});
medicineSchema.index({ isActive: 1, category: 1 });
medicineSchema.index({ isActive: 1, prescriptionRequired: 1 });

medicineSchema.plugin(toJSONPlugin);

export const Medicine: Model<IMedicine> = model<IMedicine>("Medicine", medicineSchema);
