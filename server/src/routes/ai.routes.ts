import { Router } from "express";
import { z } from "zod";
import {
  chatHandler,
  explainTermsHandler,
} from "../controllers/ai.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { aiLimiter } from "../middlewares/rate-limiter.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { UserRole } from "../types/models.js";

export const aiRouter = Router();

/**
 * Zod validation schema for chat / message requests.
 * Accepts either 'message' (Task 12.4 spec) or 'query' (API Contract 20.1).
 */
export const chatMessageSchema = z
  .object({
    message: z.string().min(2, "Message must be at least 2 characters long").max(1000, "Message cannot exceed 1000 characters").optional(),
    query: z.string().min(2, "Query must be at least 2 characters long").max(1000, "Query cannot exceed 1000 characters").optional(),
  })
  .refine((data) => Boolean(data.message || data.query), {
    message: "Either 'message' or 'query' must be provided (between 2 and 1000 characters)",
  });

/**
 * Zod validation schema for medical jargon explanation (API Contract 20.2).
 */
export const explainTermSchema = z.object({
  term: z
    .string({ required_error: "Medical term is required" })
    .min(2, "Medical term must be at least 2 characters long")
    .max(100, "Medical term cannot exceed 100 characters")
    .transform((val) => val.trim()),
});

/**
 * Permitted roles for AI healthcare assistant navigation:
 * PATIENT, DOCTOR, ADMIN (PHARMACY is denied).
 * Source: docs/api/AUTHORIZATION_MATRIX.md Line 82.
 */
const ALLOWED_AI_ROLES = [UserRole.PATIENT, UserRole.DOCTOR, UserRole.ADMIN];

/**
 * POST /api/v1/ai/assistant/message (Task 12.4 spec)
 * POST /api/v1/ai/assistant/chat (API Contract 20.1)
 *
 * Safe non-diagnostic healthcare navigation assistant.
 * Rate limit: 10 requests per minute per authenticated user.
 */
aiRouter.post(
  "/assistant/message",
  authenticate,
  authorizeRole(...ALLOWED_AI_ROLES),
  aiLimiter,
  validateBody(chatMessageSchema),
  chatHandler
);

aiRouter.post(
  "/assistant/chat",
  authenticate,
  authorizeRole(...ALLOWED_AI_ROLES),
  aiLimiter,
  validateBody(chatMessageSchema),
  chatHandler
);

/**
 * POST /api/v1/ai/assistant/explain-terms
 *
 * Explains medical terminology from clinical records in plain language.
 * Source: docs/api/API_CONTRACT.md Group 20.2.
 */
aiRouter.post(
  "/assistant/explain-terms",
  authenticate,
  authorizeRole(...ALLOWED_AI_ROLES),
  aiLimiter,
  validateBody(explainTermSchema),
  explainTermsHandler
);
