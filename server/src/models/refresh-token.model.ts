import { Schema, model, type Model } from "mongoose";
import type { IRefreshToken } from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User ID is required"],
      index: true,
    },
    familyId: {
      type: String,
      required: [true, "Token family ID is required"],
      index: true,
    },
    jti: {
      type: String,
      required: [true, "JWT ID (jti) is required"],
      unique: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: [true, "Token hash is required"],
      unique: true,
      index: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: [true, "Token expiration date is required"],
    },
    replacedByJti: {
      type: String,
      default: undefined,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically purge expired tokens from MongoDB
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for family lookup and rotation queries
refreshTokenSchema.index({ familyId: 1, isRevoked: 1 });

// Apply toJSON plugin for clean serialization
refreshTokenSchema.plugin(toJSONPlugin);

export const RefreshToken: Model<IRefreshToken> = model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema
);
