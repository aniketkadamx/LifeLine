import type { Request, Response, NextFunction } from "express";
import { aiService } from "../services/ai.service.js";
import { auditLogService } from "../services/audit-log.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";

/**
 * Controller handler: POST /api/v1/ai/assistant/chat & POST /api/v1/ai/assistant/message
 *
 * Provides safe, non-diagnostic healthcare navigation and query responses.
 * Supported roles: PATIENT, DOCTOR, ADMIN.
 * Rate limited to 10 requests per minute per authenticated user.
 *
 * Sources:
 * - docs/api/API_CONTRACT.md Group 20.1
 * - MASTER_IMPLEMENTATION_ROADMAP.md Task 12.4
 */
export async function chatHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const rawInput = (req.body?.message || req.body?.query) as string | undefined;

    if (!rawInput || typeof rawInput !== "string") {
      throw AppError.badRequest(
        "A valid 'message' or 'query' string is required",
        "INVALID_REQUEST_BODY"
      );
    }

    const result = await aiService.processHealthcareQuery(rawInput);

    // Non-blocking safe operational audit logging (NEVER contains user message, prompt, or PHI)
    try {
      void auditLogService.log({
        actorId: req.user.id,
        actorRole: req.user.role as any,
        action: "AI_ASSISTANT_QUERY",
        resourceType: "AIAssistant",
        resourceId: req.user.id,
        status: "SUCCESS",
        metadata: {
          category: result.category,
        },
      });
    } catch {
      // Audit failure must never crash assistant responses
    }

    sendSuccess(res, result, "Assistant response generated successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: POST /api/v1/ai/assistant/explain-terms
 *
 * Explains medical terminology from prescriptions or clinical reports in plain language.
 * Supported roles: PATIENT, DOCTOR, ADMIN.
 *
 * Sources:
 * - docs/api/API_CONTRACT.md Group 20.2
 * - MASTER_IMPLEMENTATION_ROADMAP.md Task 12.4
 */
export async function explainTermsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const term = req.body?.term as string | undefined;

    if (!term || typeof term !== "string") {
      throw AppError.badRequest(
        "A valid medical 'term' string is required",
        "INVALID_REQUEST_BODY"
      );
    }

    const result = await aiService.explainMedicalTerm(term);

    // Non-blocking safe operational audit logging
    try {
      void auditLogService.log({
        actorId: req.user.id,
        actorRole: req.user.role as any,
        action: "AI_EXPLAIN_TERM",
        resourceType: "AIAssistant",
        resourceId: req.user.id,
        status: "SUCCESS",
        metadata: {
          category: result.category,
        },
      });
    } catch {
      // Ignore audit failure
    }

    sendSuccess(res, result, "Medical term explained successfully", 200);
  } catch (error) {
    next(error);
  }
}
