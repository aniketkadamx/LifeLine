import { z } from "zod";
import { PaymentTargetType } from "../types/models.js";

/**
 * Zod validation schema for payment order intent creation.
 * Endpoint: POST /api/v1/payments/create-intent
 * Source: docs/api/API_CONTRACT.md Group 13.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.1.
 */
export const createPaymentIntentSchema = z
  .object({
    targetType: z
      .nativeEnum(PaymentTargetType, {
        errorMap: () => ({
          message: "Invalid target type. Expected 'APPOINTMENT' | 'ORDER'",
        }),
      })
      .default(PaymentTargetType.APPOINTMENT),
    targetId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid target identifier format")
      .optional(),
    appointmentId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid appointment identifier format")
      .optional(),
    // Client may attempt to send an amount or currency; we accept it in schema so it doesn't fail parsing,
    // but the payment service strictly disregards it and calculates the trusted amount solely from the database.
    amount: z.any().optional(),
    currency: z.any().optional(),
  })
  .refine((data) => Boolean(data.targetId || data.appointmentId), {
    message: "Either targetId or appointmentId must be provided",
    path: ["targetId"],
  });

export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;

/**
 * Zod validation schema for payment ID URL param.
 */
export const paymentIdParamSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid payment identifier format"),
});

export type PaymentIdParam = z.infer<typeof paymentIdParamSchema>;

/**
 * Zod validation schema for refund processing.
 * Endpoint: POST /api/v1/payments/:id/refund
 * Source: docs/api/AUTHORIZATION_MATRIX.md Section 6.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.3.
 */
export const processRefundSchema = z
  .object({
    amount: z
      .number({ invalid_type_error: "Refund amount must be a number" })
      .positive("Refund amount must be greater than zero")
      .optional(),
    reason: z
      .string()
      .trim()
      .min(3, "Refund reason must be at least 3 characters long")
      .max(500, "Refund reason cannot exceed 500 characters")
      .optional(),
  })
  .strict();

export type ProcessRefundInput = z.infer<typeof processRefundSchema>;
