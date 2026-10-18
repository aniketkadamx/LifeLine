import { z } from "zod";

/**
 * Route parameter validation schema for conversation/consultation ID.
 * Endpoint: GET /api/v1/conversations/:id/messages
 */
export const conversationIdParamSchema = z
  .object({
    id: z
      .string({ required_error: "Conversation ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid conversation identifier format"),
  })
  .strict();

export type ConversationIdParam = z.infer<typeof conversationIdParamSchema>;

/**
 * Zod validation schema for socket send_message event payload.
 */
export const sendMessagePayloadSchema = z
  .object({
    consultationId: z
      .string({ required_error: "Consultation ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid consultation identifier format"),
    text: z
      .string({ required_error: "Message text is required" })
      .min(1, "Message cannot be empty")
      .max(2000, "Message cannot exceed 2000 characters"),
    clientMessageId: z
      .string()
      .trim()
      .max(100, "Client message ID cannot exceed 100 characters")
      .optional(),
  })
  .strict();

export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>;

/**
 * Query parameter validation schema for retrieving paginated chat history.
 * Endpoint: GET /api/v1/conversations/:id/messages?limit=50&before=...
 */
export const getChatHistoryQuerySchema = z
  .object({
    limit: z
      .string()
      .optional()
      .transform((val) => (val !== undefined ? Number(val) : 50))
      .pipe(
        z
          .number({ invalid_type_error: "Limit must be a valid number" })
          .int("Limit must be an integer")
          .min(1, "Limit must be at least 1")
          .max(100, "Limit cannot exceed 100")
      ),
    before: z
      .string()
      .trim()
      .optional(),
  })
  .strict();

export type GetChatHistoryQuery = z.infer<typeof getChatHistoryQuerySchema>;
