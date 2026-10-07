import { Schema, model, type Model } from "mongoose";
import {
  OrderStatus,
  type IOrder,
  type IOrderItemSnapshot,
  type IOrderTotals,
  type IOrderPrescriptionReview,
  type IAddress,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const orderItemSnapshotSchema = new Schema<IOrderItemSnapshot>(
  {
    medicineId: {
      type: Schema.Types.ObjectId,
      ref: "Medicine",
      required: [true, "Medicine ID is required"],
    },
    medicineName: {
      type: String,
      required: [true, "Medicine name snapshot is required"],
      trim: true,
    },
    dosageForm: {
      type: String,
      trim: true,
    },
    strength: {
      type: String,
      trim: true,
    },
    quantity: {
      type: Number,
      required: [true, "Item quantity is required"],
      min: [1, "Quantity must be at least 1"],
      validate: {
        validator: Number.isInteger,
        message: "Quantity must be an integer",
      },
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price snapshot is required"],
      min: [0, "Unit price cannot be negative"],
    },
    totalPrice: {
      type: Number,
      required: [true, "Total item price is required"],
      min: [0, "Total price cannot be negative"],
    },
  },
  { _id: false }
);

const orderTotalsSchema = new Schema<IOrderTotals>(
  {
    subtotal: {
      type: Number,
      required: [true, "Order subtotal is required"],
      min: [0, "Subtotal cannot be negative"],
    },
    deliveryFee: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "Delivery fee cannot be negative"],
    },
    totalAmount: {
      type: Number,
      required: [true, "Total order amount is required"],
      min: [0, "Total amount cannot be negative"],
    },
  },
  { _id: false }
);

const deliveryAddressSchema = new Schema<IAddress>(
  {
    street: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      required: [true, "City is required"],
      trim: true,
    },
    state: {
      type: String,
      required: [true, "State is required"],
      trim: true,
    },
    postalCode: {
      type: String,
      required: [true, "Postal code is required"],
      trim: true,
    },
    country: {
      type: String,
      required: [true, "Country is required"],
      trim: true,
    },
    coordinates: {
      type: [Number],
      default: undefined,
      validate: [
        (val: number[] | undefined) =>
          !val || val.length === 0 || val.length === 2,
        "Coordinates must be [longitude, latitude]",
      ],
    },
  },
  { _id: false }
);

const orderPrescriptionReviewSchema = new Schema<IOrderPrescriptionReview>(
  {
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    reviewedAt: {
      type: Date,
    },
    decision: {
      type: String,
      enum: ["APPROVE", "REJECT"],
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const orderSchema = new Schema<IOrder>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Patient ID is required"],
      index: true,
    },
    pharmacyId: {
      type: Schema.Types.ObjectId,
      ref: "PharmacyProfile",
      required: [true, "Pharmacy ID is required"],
      index: true,
    },
    items: {
      type: [orderItemSnapshotSchema],
      required: [true, "Order items are required"],
      validate: [
        (val: IOrderItemSnapshot[]) => Array.isArray(val) && val.length > 0,
        "Order must contain at least one item",
      ],
    },
    prescriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Prescription",
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PENDING", "PAID", "REFUNDED"],
      default: "UNPAID",
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.PLACED,
      required: true,
      index: true,
    },
    deliveryAddress: {
      type: deliveryAddressSchema,
      required: [true, "Delivery address is required"],
    },
    totals: {
      type: orderTotalsSchema,
      required: [true, "Order totals breakdown is required"],
    },
    currency: {
      type: String,
      default: "INR",
      required: true,
      trim: true,
      uppercase: true,
    },
    deliveryOtp: {
      type: String,
      trim: true,
      private: true,
    },
    deliveryNotes: {
      type: String,
      trim: true,
    },
    prescriptionReview: {
      type: orderPrescriptionReviewSchema,
    },
    cancelledAt: {
      type: Date,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Query and processing indexes
orderSchema.index({ patientId: 1, createdAt: -1 });
orderSchema.index({ pharmacyId: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

orderSchema.plugin(toJSONPlugin);

export const Order: Model<IOrder> = model<IOrder>("Order", orderSchema);
