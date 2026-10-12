import { Schema, model, type Model, type Types } from "mongoose";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

export enum IdempotencyStatus {
  PROCESSING = "PROCESSING",
  COMPLETED = "COMPLETED",
}

export interface IIdempotencyRecord {
  key: string;
  userId: Types.ObjectId;
  operation: string;
  requestHash: string;
  status: IdempotencyStatus;
  ownerToken?: string; // Fencing token identifying the current lease holder
  lockedUntil?: Date; // Active processing lease expiration
  appointmentId?: Types.ObjectId; // Associated appointment ID if created
  responseStatus?: number;
  responseData?: Record<string, unknown>;
  responseMessage?: string;
  expiresAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const idempotencyRecordSchema = new Schema<IIdempotencyRecord>(
  {
    key: {
      type: String,
      required: [true, "Idempotency key is required"],
      trim: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
    },
    operation: {
      type: String,
      required: [true, "Operation identifier is required"],
      trim: true,
    },
    requestHash: {
      type: String,
      required: [true, "Request hash is required"],
    },
    status: {
      type: String,
      enum: Object.values(IdempotencyStatus),
      default: IdempotencyStatus.PROCESSING,
      required: true,
    },
    ownerToken: {
      type: String,
      trim: true,
    },
    lockedUntil: {
      type: Date,
    },
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    responseStatus: {
      type: Number,
    },
    responseData: {
      type: Schema.Types.Mixed,
    },
    responseMessage: {
      type: String,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // 24-hour TTL index
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index ensuring only one transaction per (key, userId, operation)
idempotencyRecordSchema.index(
  { key: 1, userId: 1, operation: 1 },
  { unique: true }
);

idempotencyRecordSchema.plugin(toJSONPlugin);

export const IdempotencyRecord: Model<IIdempotencyRecord> = model<IIdempotencyRecord>(
  "IdempotencyRecord",
  idempotencyRecordSchema
);
