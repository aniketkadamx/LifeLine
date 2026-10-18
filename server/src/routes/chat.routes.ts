import { Router } from "express";
import { getChatHistoryHandler } from "../controllers/chat.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { validateParams } from "../validators/auth.validator.js";
import { conversationIdParamSchema } from "../validators/chat.validator.js";

export const chatRouter = Router();

/**
 * GET /api/v1/conversations/:id/messages
 *
 * Retrieves paginated, chronological chat message history for an authorized consultation.
 * Accessible only to attending doctor and patient during the consultation chat window.
 * Source: docs/api/API_CONTRACT.md Group 15.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 11.2.
 */
chatRouter.get(
  "/:id/messages",
  authenticate,
  validateParams(conversationIdParamSchema),
  getChatHistoryHandler
);
