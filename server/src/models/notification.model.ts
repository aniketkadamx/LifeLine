import mongoose, { Schema, model, type Model } from "mongoose";
import { NotificationType, type INotification } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Recipient user ID is required"],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      required: [true, "Notification type is required"],
      index: true,
    },
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
    },
    message: {
      type: String,
      required: [true, "Notification message body is required"],
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      required: true,
      index: true,
    },
    readAt: {
      type: Date,
    },
    relatedEntityType: {
      type: String,
      trim: true,
    },
    relatedEntityId: {
      type: Schema.Types.ObjectId,
    },
    channels: {
      type: [String],
      default: ["IN_APP"],
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

// High-frequency notification polling and unread badge query indexes
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, createdAt: -1 });

notificationSchema.plugin(toJSONPlugin);

export const Notification: Model<INotification> =
  (mongoose.models.Notification as Model<INotification>) ||
  model<INotification>("Notification", notificationSchema);
