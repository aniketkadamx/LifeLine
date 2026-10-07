import { Schema, model, type Model } from "mongoose";
import {
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  type IPayment,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const paymentSchema = new Schema<IPayment>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Payer user ID is required"],
      index: true,
    },
    targetType: {
      type: String,
      enum: Object.values(PaymentTargetType),
      required: [true, "Payment target type is required"],
      index: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: [true, "Payment target entity ID is required"],
      index: true,
    },
    amount: {
      type: Number,
      required: [true, "Payment amount is required"],
      min: [0.01, "Amount must be at least 0.01"],
    },
    currency: {
      type: String,
      required: true,
      default: "INR",
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.CREATED,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: Object.values(PaymentProvider),
      default: PaymentProvider.RAZORPAY,
      required: true,
    },
    referenceId: {
      type: String,
      required: [true, "Payment internal reference ID is required"],
      unique: true,
      trim: true,
    },
    providerOrderId: {
      type: String,
      trim: true,
    },
    providerPaymentId: {
      type: String,
      trim: true,
    },
    providerSignature: {
      type: String,
      trim: true,
      private: true,
    },
    failureCode: {
      type: String,
      trim: true,
    },
    failureReason: {
      type: String,
      trim: true,
    },
    refundId: {
      type: String,
      trim: true,
    },
    refundAmount: {
      type: Number,
      min: [0, "Refund amount cannot be negative"],
    },
    refundReason: {
      type: String,
      trim: true,
    },
    refundStatus: {
      type: String,
      trim: true,
    },
    refundedAt: {
      type: Date,
    },
    gatewayMetadata: {
      type: Schema.Types.Mixed,
      private: true,
    },
  },
  {
    timestamps: true,
  }
);

// Transaction queries, reconciliation, and audit indexes
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ targetType: 1, targetId: 1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ providerOrderId: 1 }, { sparse: true });

paymentSchema.plugin(toJSONPlugin);

export const Payment: Model<IPayment> = model<IPayment>("Payment", paymentSchema);
