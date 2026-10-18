import mongoose from "mongoose";
import { Notification } from "../models/notification.model.js";
import { User } from "../models/user.model.js";
import {
  NotificationType,
  type INotification,
  type IUser,
} from "../types/models.js";
import {
  resendClient,
  generateNotificationEmailHtml,
} from "../integrations/email/resend.client.js";
import { AppError } from "../utils/api-error.js";

export interface DispatchNotificationInput {
  userId: string | mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string | mongoose.Types.ObjectId;
  channels?: Array<"IN_APP" | "EMAIL" | "SMS">;
  metadata?: Record<string, unknown>;
  emailSubject?: string;
  emailHtml?: string;
}

export interface ListNotificationsOptions {
  unreadOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface ListNotificationsResult {
  notifications: INotification[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class NotificationService {
  /**
   * Dispatches a multi-channel notification:
   * 1. Validates recipient existence.
   * 2. Persists the durable in-app notification in MongoDB.
   * 3. Emits real-time notification to the user's private channel: `user:<userId>`.
   * 4. Asynchronously schedules email delivery via Resend if email is configured and eligible.
   *
   * Fail-Safe Guarantees:
   * - Socket or email failures NEVER roll back or disrupt the business transaction.
   * - Database persistence failure properly throws to the caller without reporting false success.
   */
  public async dispatch(
    input: DispatchNotificationInput
  ): Promise<INotification> {
    const recipientId =
      typeof input.userId === "string" ? input.userId.trim() : input.userId.toString();

    if (!mongoose.Types.ObjectId.isValid(recipientId)) {
      throw AppError.badRequest("Invalid recipient user identifier", "VALIDATION_ERROR");
    }

    // 1. Verify recipient user exists
    const recipient = await User.findById(recipientId).select("_id email fullName status");
    if (!recipient) {
      throw AppError.notFound("Recipient user not found", "USER_NOT_FOUND");
    }

    const channels = input.channels || ["IN_APP", "EMAIL"];

    // 2. Persist in-app notification record in MongoDB
    const notification = await Notification.create({
      userId: recipient._id,
      type: input.type,
      title: input.title.trim(),
      message: input.message.trim(),
      isRead: false,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId
        ? new mongoose.Types.ObjectId(input.relatedEntityId.toString())
        : undefined,
      channels,
      metadata: input.metadata,
    });

    // 3. Emit real-time event to the user's private Socket.IO channel
    try {
      const { getIO } = await import("../sockets/socket.server.js");
      const io = getIO();
      if (io) {
        const socketPayload = {
          id: notification._id.toString(),
          userId: recipient._id.toString(),
          type: notification.type,
          title: notification.title,
          message: notification.message,
          isRead: notification.isRead,
          relatedEntityType: notification.relatedEntityType,
          relatedEntityId: notification.relatedEntityId?.toString(),
          createdAt: notification.createdAt.toISOString(),
        };

        io.to(`user:${recipient._id.toString()}`).emit("notification:new", socketPayload);
        // Also emit legacy alias for broader client compatibility
        io.to(`user:${recipient._id.toString()}`).emit("notification", socketPayload);
      }
    } catch {
      // Sockets may not be bound in standalone tests or CLI jobs; fail-safe
    }

    // 4. Asynchronously dispatch email if recipient has a valid email and EMAIL channel is active
    if (channels.includes("EMAIL") && recipient.email) {
      void this.dispatchEmailAsync(recipient, notification, input);
    }

    return notification;
  }

  /**
   * Internal asynchronous email dispatcher:
   * - Never blocks caller
   * - Catches all provider and network errors
   */
  private async dispatchEmailAsync(
    recipient: Pick<IUser, "_id" | "email" | "fullName">,
    notification: INotification,
    input: DispatchNotificationInput
  ): Promise<void> {
    try {
      const subject = input.emailSubject || `[LifeLine] ${notification.title}`;
      const html =
        input.emailHtml ||
        generateNotificationEmailHtml({
          title: notification.title,
          message: notification.message,
        });

      await resendClient.sendEmail({
        to: recipient.email,
        subject,
        html,
        text: notification.message,
      });
    } catch {
      // Resend errors caught and ignored to prevent unhandled rejection
    }
  }

  /**
   * Lists notifications for the authenticated user with bounded pagination.
   */
  public async listForUser(
    userId: string,
    options: ListNotificationsOptions = {}
  ): Promise<ListNotificationsResult> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw AppError.badRequest("Invalid user identifier", "VALIDATION_ERROR");
    }

    const page = Math.max(1, options.page ? Math.floor(options.page) : 1);
    let limit = 20;
    if (options.limit !== undefined) {
      if (typeof options.limit !== "number" || isNaN(options.limit) || options.limit < 1) {
        throw AppError.badRequest("Invalid limit parameter", "VALIDATION_ERROR");
      }
      if (options.limit > 100) {
        throw AppError.badRequest("Limit cannot exceed 100", "VALIDATION_ERROR");
      }
      limit = Math.floor(options.limit);
    }

    const filter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    if (options.unreadOnly === true) {
      filter.isRead = false;
    }

    const total = await Notification.countDocuments(filter);
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      notifications,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Marks a notification as read, enforcing strict recipient ownership.
   * Idempotent: Subsequent calls return the updated notification without error.
   */
  public async markAsRead(
    userId: string,
    notificationId: string
  ): Promise<INotification> {
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      throw AppError.badRequest("Invalid notification identifier", "VALIDATION_ERROR");
    }

    const notification = await Notification.findById(notificationId);
    if (!notification) {
      throw AppError.notFound("Notification not found", "NOTIFICATION_NOT_FOUND");
    }

    // Ownership enforcement: only the recipient can mark their notification as read
    if (notification.userId.toString() !== userId) {
      throw AppError.forbidden(
        "Access denied: you do not own this notification",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    if (!notification.isRead) {
      notification.isRead = true;
      notification.readAt = new Date();
      await notification.save();
    }

    return notification;
  }
}

export const notificationService = new NotificationService();
