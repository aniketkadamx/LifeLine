import type { Request, Response, NextFunction } from "express";
import { chatService } from "../services/chat.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { GetChatHistoryQuery } from "../validators/chat.validator.js";

/**
 * Handler: GET /api/v1/conversations/:id/messages
 *
 * Retrieves chronological, paginated chat message history for an authorized consultation.
 * Accessible only to authorized participants (attending doctor or patient) during the active chat window.
 * Source: docs/api/API_CONTRACT.md Group 15.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 11.2.
 */
export async function getChatHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id: consultationId } = req.params as { id: string };
    const query = req.query as Record<string, string | undefined>;

    const limit = query.limit !== undefined ? Number(query.limit) : undefined;
    const before = query.before;

    const result = await chatService.getMessageHistory(req.user, consultationId, {
      limit,
      before,
    });

    sendSuccess(
      res,
      result.messages,
      "Chat history retrieved successfully",
      200,
      result.pagination
    );
  } catch (error) {
    next(error);
  }
}
