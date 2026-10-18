import { z } from "zod";

/**
 * Route parameter validation schema for notification ID.
 * Endpoint: PATCH /api/v1/notifications/:id/read
 */
export const notificationIdParamSchema = z
  .object({
    id: z
      .string({ required_error: "Notification ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid notification identifier format"),
  })
  .strict();

export type NotificationIdParam = z.infer<typeof notificationIdParamSchema>;

/**
 * Query parameter validation schema for listing user notifications.
 * Endpoint: GET /api/v1/notifications?unreadOnly=true&page=1&limit=20
 */
export const listNotificationsQuerySchema = z
  .object({
    unreadOnly: z.enum(["true", "false"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
