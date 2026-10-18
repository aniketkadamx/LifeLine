import type { Request, Response, NextFunction } from "express";
import { notificationService } from "../services/notification.service.js";
import { AppError } from "../utils/api-error.js";
import { sendPaginated, sendSuccess } from "../utils/api-response.js";

/**
 * Handler: GET /api/v1/notifications
 *
 * Lists in-app notifications for the authenticated user with optional unread filtering and bounded pagination.
 * Auth: Any authenticated user.
 * Source: docs/api/API_CONTRACT.md Group 14.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 11.3.
 */
export async function listNotificationsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const query = req.query as Record<string, any>;
    const unreadOnly =
      query.unreadOnly === true || query.unreadOnly === "true"
        ? true
        : query.unreadOnly === false || query.unreadOnly === "false"
        ? false
        : undefined;
    const page = query.page !== undefined ? Number(query.page) : undefined;
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;

    const result = await notificationService.listForUser(req.user.id, {
      unreadOnly,
      page,
      limit,
    });

    sendPaginated(
      res,
      result.notifications,
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
      "Notifications retrieved successfully"
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/notifications/:id/read
 *
 * Marks an individual notification as read.
 * Strict recipient ownership is enforced: users cannot update notifications belonging to others.
 * Idempotent: repeated calls succeed without error.
 * Auth: Owner only.
 * Source: docs/api/API_CONTRACT.md Group 14.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 11.3.
 */
export async function markNotificationAsReadHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params as { id: string };
    const notification = await notificationService.markAsRead(req.user.id, id);

    sendSuccess(res, notification, "Notification marked as read successfully");
  } catch (error) {
    next(error);
  }
}
