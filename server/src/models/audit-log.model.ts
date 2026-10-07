import { Schema, model, type Model } from "mongoose";
import { type IAuditLog } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Actor user ID is required"],
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["PATIENT", "DOCTOR", "PHARMACY", "ADMIN", "SYSTEM"],
      required: [true, "Actor role is required"],
      index: true,
    },
    action: {
      type: String,
      required: [true, "Audit action is required"],
      trim: true,
      index: true,
    },
    resourceType: {
      type: String,
      required: [true, "Resource type is required"],
      trim: true,
      index: true,
    },
    resourceId: {
      type: String,
      required: [true, "Resource ID is required"],
      trim: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      private: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILURE"],
      default: "SUCCESS",
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// High-performance audit query indexes
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ patientId: 1, createdAt: -1 }, { sparse: true });

auditLogSchema.plugin(toJSONPlugin);

export const AuditLog: Model<IAuditLog> = model<IAuditLog>("AuditLog", auditLogSchema);
