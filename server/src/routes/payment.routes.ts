import { Router } from "express";
import {
  createPaymentIntentHandler,
  handleRazorpayWebhookHandler,
} from "../controllers/payment.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { createPaymentIntentSchema } from "../validators/payment.validator.js";
import { UserRole } from "../types/models.js";

export const paymentRouter = Router();

/**
 * POST /api/v1/payments/create-intent
 * Creates a Razorpay order intent for checkout initialization.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Group 13.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.1.
 */
paymentRouter.post(
  "/create-intent",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(createPaymentIntentSchema),
  createPaymentIntentHandler
);

/**
 * POST /api/v1/payments/webhook
 * Cryptographic Razorpay webhook listener for asynchronous capture settlement.
 * Role: Provider callback (authenticates via HMAC-SHA256 signature, no user JWT required).
 * Source: docs/api/API_CONTRACT.md Group 13.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.2.
 */
paymentRouter.post(
  "/webhook",
  handleRazorpayWebhookHandler
);
