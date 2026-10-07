import { Schema, model, type Model } from "mongoose";
import {
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
  type IComplaint,
  type IComplaintResolution,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const complaintResolutionSchema = new Schema<IComplaintResolution>(
  {
    resolvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: {
      type: Date,
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const complaintSchema = new Schema<IComplaint>(
  {
    complainantId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Complainant user ID is required"],
      index: true,
    },
    category: {
      type: String,
      enum: Object.values(ComplaintCategory),
      required: [true, "Complaint category is required"],
      index: true,
    },
    subject: {
      type: String,
      required: [true, "Complaint subject is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Complaint description is required"],
      trim: true,
      minlength: [10, "Complaint description must be at least 10 characters"],
    },
    relatedEntityType: {
      type: String,
      trim: true,
    },
    relatedEntityId: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(ComplaintStatus),
      default: ComplaintStatus.OPEN,
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(ComplaintPriority),
      default: ComplaintPriority.MEDIUM,
      required: true,
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    resolution: {
      type: complaintResolutionSchema,
    },
  },
  {
    timestamps: true,
  }
);

// Admin triage, priority queues, and user inquiry history indexes
complaintSchema.index({ complainantId: 1, createdAt: -1 });
complaintSchema.index({ status: 1, priority: 1, createdAt: -1 });
complaintSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
complaintSchema.index({ createdAt: -1 });

complaintSchema.plugin(toJSONPlugin);

export const Complaint: Model<IComplaint> = model<IComplaint>("Complaint", complaintSchema);
