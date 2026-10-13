import crypto from "node:crypto";
import mongoose from "mongoose";
import { Appointment } from "../models/appointment.model.js";
import { Payment } from "../models/payment.model.js";
import {
  AppointmentStatus,
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  type IPayment,
} from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import { AppError } from "../utils/api-error.js";
import {
  getRazorpayClient,
  getRazorpayPublicKey,
} from "../integrations/payment/razorpay.client.js";
import type { CreatePaymentIntentInput } from "../validators/payment.validator.js";

/**
 * Result data returned after successfully initializing a Razorpay order intent.
 */
export interface PaymentIntentResult {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  referenceId: string;
}

/**
 * Converts a standard currency amount (e.g. INR rupees or USD dollars) to its smallest currency unit
 * (e.g. paise or cents) using integer-safe parsing to eliminate floating-point inaccuracies.
 *
 * @param amount Amount in standard unit
 * @param currency ISO 4217 currency code (default: INR)
 * @returns Integer value in currency subunits (e.g. paise)
 */
export function convertToSmallestCurrencyUnit(
  amount: number,
  currency: string = "INR"
): number {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    isNaN(amount) ||
    amount <= 0
  ) {
    throw AppError.badRequest(
      "Invalid payment amount: must be a positive finite number",
      "INVALID_AMOUNT"
    );
  }

  const normalizedCurrency = currency.toUpperCase().trim();
  let subunitFactor = 100;

  // Zero-decimal currencies
  const zeroDecimalCurrencies = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND"
  ]);

  // Three-decimal currencies
  const threeDecimalCurrencies = new Set([
    "BHD", "JOD", "KWD", "OMR", "TND"
  ]);

  if (zeroDecimalCurrencies.has(normalizedCurrency)) {
    subunitFactor = 1;
  } else if (threeDecimalCurrencies.has(normalizedCurrency)) {
    subunitFactor = 1000;
  }

  const decimalPlaces = Math.log10(subunitFactor);
  const parts = amount.toString().split(".");
  const wholePart = parts[0];
  const decimalPart = parts[1] || "";

  const paddedDecimal = decimalPart.padEnd(decimalPlaces, "0").slice(0, decimalPlaces);
  const excessDecimals = decimalPart.slice(decimalPlaces);

  let subunitValue = BigInt(wholePart) * BigInt(subunitFactor) + BigInt(paddedDecimal);
  if (excessDecimals && Number(excessDecimals[0]) >= 5) {
    subunitValue += BigInt(1);
  }

  const result = Number(subunitValue);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw AppError.badRequest(
      "Payment amount exceeds safe integer range",
      "INVALID_AMOUNT"
    );
  }

  return result;
}

export class PaymentService {
  /**
   * Initializes a Razorpay order intent for an eligible appointment.
   *
   * Business Rules:
   * 1. Loads appointment from database.
   * 2. Verifies authenticated patient ownership.
   * 3. Requires appointment status to be strictly PENDING_PAYMENT.
   * 4. Enforces active reservation lock (rejects expired reservation locks).
   * 5. Derives fee and currency solely from database appointment record (disregards client body tampering).
   * 6. Converts fee to currency smallest unit (paise) integer-safely.
   * 7. Creates Razorpay order via official SDK.
   * 8. Persists Payment record with status CREATED.
   * 9. Returns client checkout initialization data (never exposes secrets).
   */
  async createPaymentIntent(
    actor: AuthenticatedUser,
    input: CreatePaymentIntentInput
  ): Promise<PaymentIntentResult> {
    const appointmentId = input.targetId || input.appointmentId;

    if (!appointmentId || !mongoose.Types.ObjectId.isValid(appointmentId)) {
      throw AppError.badRequest(
        "Invalid appointment identifier format",
        "BAD_REQUEST"
      );
    }

    // 1. Load appointment from database
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
    }

    // 2. Verify authenticated patient ownership
    if (appointment.patientId.toString() !== actor.id) {
      throw AppError.forbidden(
        "Access denied: you do not have ownership of this appointment",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    // 3. Require appointment status to be PENDING_PAYMENT
    if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        `Cannot create payment intent for appointment with status '${appointment.status}'. Appointment must be in PENDING_PAYMENT state.`
      );
    }

    // 4. Verify reservation lock has not expired
    if (
      appointment.lockExpiresAt &&
      appointment.lockExpiresAt.getTime() <= Date.now()
    ) {
      throw new AppError(
        422,
        "APPOINTMENT_LOCK_EXPIRED",
        "Appointment reservation lock has expired. Please select a new slot."
      );
    }

    // 5. Derive fee and currency solely from database record (preventing client tampering)
    const rawFee = appointment.fee;
    const currency = (appointment.currency || "INR").toUpperCase().trim();

    if (
      typeof rawFee !== "number" ||
      !Number.isFinite(rawFee) ||
      isNaN(rawFee) ||
      rawFee <= 0
    ) {
      throw AppError.badRequest(
        "Invalid appointment consultation fee in database record",
        "INVALID_AMOUNT"
      );
    }

    // 6. Integer-safe currency conversion to subunits (paise)
    const amountInSubunits = convertToSmallestCurrencyUnit(rawFee, currency);

    // 7. Initialize order with Razorpay Gateway
    const razorpay = getRazorpayClient();
    const receipt = `rcpt_${appointment._id.toString()}`.slice(0, 40);

    let razorpayOrder: { id: string; amount: number | string; currency: string };
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: amountInSubunits,
        currency,
        receipt,
        notes: {
          appointmentId: appointment._id.toString(),
          patientId: appointment.patientId.toString(),
        },
      });
    } catch (error: unknown) {
      const errorMsg =
        error instanceof Error ? error.message : "Razorpay order creation failed";
      console.error(
        `[PaymentService] Gateway order creation failure: ${errorMsg}`
      );
      throw new AppError(
        502,
        "PAYMENT_GATEWAY_ERROR",
        "Failed to initialize payment order with payment gateway"
      );
    }

    if (!razorpayOrder || !razorpayOrder.id) {
      throw new AppError(
        502,
        "PAYMENT_GATEWAY_ERROR",
        "Payment gateway returned an invalid order response"
      );
    }

    // 8. Persist Payment document
    const randomSuffix = crypto.randomBytes(4).toString("hex").toUpperCase();
    const referenceId = `PAY-${Date.now()}-${randomSuffix}`;

    let payment: IPayment;
    try {
      payment = await Payment.create({
        userId: new mongoose.Types.ObjectId(actor.id),
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: appointment._id,
        amount: rawFee,
        currency,
        status: PaymentStatus.CREATED,
        provider: PaymentProvider.RAZORPAY,
        referenceId,
        providerOrderId: razorpayOrder.id,
        gatewayMetadata: {
          orderId: razorpayOrder.id,
          amountInSubunits,
          receipt,
        },
      });
    } catch (err: unknown) {
      const errMessage =
        err instanceof Error ? err.message : "Failed to persist payment document";
      console.error(
        `[PaymentService] Database persistence error for payment: ${errMessage}`
      );
      throw new AppError(
        500,
        "PAYMENT_PERSISTENCE_FAILED",
        "Failed to record payment transaction intent in database"
      );
    }

    // Link payment ID to appointment
    try {
      await Appointment.updateOne(
        { _id: appointment._id },
        {
          $set: {
            paymentId: payment._id,
            paymentStatus: "PENDING",
          },
        }
      );
    } catch (updateErr: unknown) {
      console.warn(
        "[PaymentService] Could not update appointment with paymentId link:",
        updateErr
      );
    }

    // 9. Return client checkout credentials (never exposing secrets)
    return {
      paymentId: payment._id.toString(),
      orderId: razorpayOrder.id,
      amount: amountInSubunits,
      currency,
      keyId: getRazorpayPublicKey(),
      referenceId: payment.referenceId,
    };
  }
}

export const paymentService = new PaymentService();
