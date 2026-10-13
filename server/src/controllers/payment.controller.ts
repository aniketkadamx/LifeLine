import type { Request, Response, NextFunction } from "express";
import { paymentService } from "../services/payment.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { CreatePaymentIntentInput } from "../validators/payment.validator.js";

/**
 * Handler: POST /api/v1/payments/create-intent
 *
 * Initializes a Razorpay order intent for an eligible appointment in PENDING_PAYMENT.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Group 13.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.1.
 */
export async function createPaymentIntentHandler(
  req: Request<unknown, unknown, CreatePaymentIntentInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const result = await paymentService.createPaymentIntent(req.user, req.body);

    sendSuccess(res, result, "Payment order intent created successfully", 200);
  } catch (error) {
    next(error);
  }
}
