import mongoose, { Schema, model, type Model } from "mongoose";
import { UserRole, type IMessage } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const messageSchema = new Schema<IMessage>(
  {
    consultationId: {
      type: Schema.Types.ObjectId,
      ref: "Consultation",
      required: [true, "Consultation ID is required"],
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sender user ID is required"],
      index: true,
    },
    senderRole: {
      type: String,
      enum: Object.values(UserRole),
      required: [true, "Sender role is required"],
    },
    text: {
      type: String,
      required: [true, "Message text is required"],
      trim: true,
      maxlength: [2000, "Message cannot exceed 2000 characters"],
    },
    clientMessageId: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Chronological history query index (compound index with secondary _id for stable sorting)
messageSchema.index({ consultationId: 1, createdAt: 1, _id: 1 });
messageSchema.index({ consultationId: 1, createdAt: -1, _id: -1 });

messageSchema.plugin(toJSONPlugin);

export const Message: Model<IMessage> =
  (mongoose.models.Message as Model<IMessage>) ||
  model<IMessage>("Message", messageSchema);
