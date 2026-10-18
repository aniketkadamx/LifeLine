import { Router } from "express";
import {
  listNotificationsHandler,
  markNotificationAsReadHandler,
} from "../controllers/notification.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  notificationIdParamSchema,
  listNotificationsQuerySchema,
} from "../validators/notification.validator.js";

export const notificationRouter = Router();

/**
 * GET /api/v1/notifications
 * Lists in-app notifications for the authenticated user with optional unread filtering and bounded pagination.
 * Auth: Any authenticated user.
 * Source: docs/api/API_CONTRACT.md Group 14.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 11.3.
 */
notificationRouter.get(
  "/",
  authenticate,
  validateQuery(listNotificationsQuerySchema as any),
  listNotificationsHandler
);

/**
 * PATCH /api/v1/notifications/:id/read
 * Marks an individual notification as read. Enforces strict recipient ownership.
 * Auth: Owner only.
 * Source: docs/api/API_CONTRACT.md Group 14.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 11.3.
 */
notificationRouter.patch(
  "/:id/read",
  authenticate,
  validateParams(notificationIdParamSchema),
  markNotificationAsReadHandler
);
