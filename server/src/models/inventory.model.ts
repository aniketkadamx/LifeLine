import { Schema, model, type Model } from "mongoose";
import type { IInventory } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const inventorySchema = new Schema<IInventory>(
  {
    pharmacyId: {
      type: Schema.Types.ObjectId,
      ref: "PharmacyProfile",
      required: [true, "Pharmacy ID is required"],
      index: true,
    },
    medicineId: {
      type: Schema.Types.ObjectId,
      ref: "Medicine",
      required: [true, "Medicine ID is required"],
      index: true,
    },
    quantity: {
      type: Number,
      required: [true, "Stock quantity is required"],
      min: [0, "Stock quantity cannot be negative"],
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Stock quantity must be an integer",
      },
    },
    reservedQuantity: {
      type: Number,
      required: true,
      min: [0, "Reserved quantity cannot be negative"],
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: "Reserved quantity must be an integer",
      },
    },
    price: {
      type: Number,
      required: [true, "Selling price is required"],
      min: [0.01, "Selling price must be at least 0.01"],
    },
    batchNumber: {
      type: String,
      trim: true,
    },
    expiryDate: {
      type: Date,
    },
    isAvailable: {
      type: Boolean,
      default: true,
      required: true,
      index: true,
    },
    lowStockThreshold: {
      type: Number,
      default: 10,
      min: [0, "Low stock threshold cannot be negative"],
      required: true,
    },
    reorderQuantity: {
      type: Number,
      default: 50,
      min: [0, "Reorder quantity cannot be negative"],
    },
  },
  {
    timestamps: true,
  }
);

// Unique constraint: one inventory record per medicine per pharmacy
inventorySchema.index({ pharmacyId: 1, medicineId: 1 }, { unique: true });

// Pharmacy stock management and public availability search indexes
inventorySchema.index({ pharmacyId: 1, isAvailable: 1 });
inventorySchema.index({ medicineId: 1, isAvailable: 1, quantity: 1 });

inventorySchema.plugin(toJSONPlugin);

export const Inventory: Model<IInventory> = model<IInventory>("Inventory", inventorySchema);
