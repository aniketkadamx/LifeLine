import type { Request, Response, NextFunction } from "express";
import { paymentService } from "../services/payment.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  CreatePaymentIntentInput,
  ProcessRefundInput,
} from "../validators/payment.validator.js";

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

/**
 * Handler: POST /api/v1/payments/webhook
 *
 * Verifies Razorpay webhook HMAC signature on the raw body buffer and settles payment.
 * Role: Provider-to-server callback (secured via cryptographic HMAC signature).
 * Source: docs/api/API_CONTRACT.md Group 13.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.2.
 */
export async function handleRazorpayWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawBuffer: Buffer = Buffer.isBuffer(req.body)
      ? req.body
      : (req as any).rawBody;

    if (!rawBuffer || !Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
      throw AppError.unauthorized(
        "Missing webhook request payload buffer",
        "INVALID_WEBHOOK_SIGNATURE"
      );
    }

    const signature = req.headers["x-razorpay-signature"] as string | undefined;

    const result = await paymentService.handleRazorpayWebhook(rawBuffer, signature);

    sendSuccess(res, result, "Webhook event processed successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/payments/:id/refund
 *
 * Processes refund for an eligible payment transaction.
 * Role: ADMIN.
 * Source: docs/api/AUTHORIZATION_MATRIX.md Section 6.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.3.
 */
export async function processRefundHandler(
  req: Request<{ id: string }, unknown, ProcessRefundInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const { amount, reason } = req.body || {};

    const result = await paymentService.processRefund(id, amount, reason, req.user);

    sendSuccess(res, result, "Payment refund processed successfully", 200);
  } catch (error) {
    next(error);
  }
}
