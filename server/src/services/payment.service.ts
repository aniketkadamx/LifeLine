import crypto from "node:crypto";
import mongoose from "mongoose";
import { Appointment } from "../models/appointment.model.js";
import { Payment } from "../models/payment.model.js";
import { Notification } from "../models/notification.model.js";
import {
  AppointmentStatus,
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  AuditAction,
  NotificationType,
  type IPayment,
} from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import { AppError } from "../utils/api-error.js";
import {
  getRazorpayClient,
  getRazorpayPublicKey,
  verifyRazorpayWebhookSignature,
} from "../integrations/payment/razorpay.client.js";
import { auditLogService } from "./audit-log.service.js";
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
 * Result data returned after processing a webhook event.
 */
export interface WebhookProcessingResult {
  acknowledged: boolean;
  event?: string;
  status: "SETTLED" | "ALREADY_SETTLED" | "IGNORED";
  paymentId?: string;
  appointmentId?: string;
  orderId?: string;
  message?: string;
}

/**
 * Result data returned after processing a refund request.
 */
export interface ProcessRefundResult {
  success: boolean;
  status: "PROCESSED" | "PENDING" | "ALREADY_REFUNDED" | "FAILED";
  paymentId: string;
  refundId?: string;
  amount: number;
  currency: string;
  message?: string;
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

  /**
   * Processes an incoming Razorpay webhook delivery with cryptographic signature verification
   * and atomic settlement.
   *
   * @param rawBody Raw HTTP request buffer
   * @param signature Razorpay signature from X-Razorpay-Signature header
   */
  async handleRazorpayWebhook(
    rawBody: Buffer,
    signature: string | undefined | null
  ): Promise<WebhookProcessingResult> {
    // 1. Cryptographic HMAC-SHA256 signature verification
    const isSignatureValid = verifyRazorpayWebhookSignature(rawBody, signature);
    if (!isSignatureValid) {
      throw AppError.unauthorized(
        "Invalid webhook signature",
        "INVALID_WEBHOOK_SIGNATURE"
      );
    }

    // 2. Parse payload safely
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw AppError.badRequest(
        "Malformed JSON payload in webhook delivery",
        "INVALID_PAYLOAD"
      );
    }

    const event = payload?.event;

    // Asynchronous provider refund confirmation
    if (event === "refund.processed") {
      const refundEntity = payload?.payload?.refund?.entity;
      if (!refundEntity || !refundEntity.id) {
        throw AppError.badRequest(
          "Missing refund entity in webhook payload",
          "INVALID_PAYLOAD"
        );
      }
      const refundId = refundEntity.id;
      const providerPaymentId = refundEntity.payment_id;

      const payment = await Payment.findOne({
        $or: [{ refundId }, { providerPaymentId }],
      });

      if (!payment) {
        return {
          acknowledged: true,
          event,
          status: "IGNORED",
          message: `No payment found for refund ${refundId}`,
        };
      }

      if (payment.status === PaymentStatus.REFUNDED) {
        return {
          acknowledged: true,
          event,
          status: "ALREADY_SETTLED",
          paymentId: payment._id.toString(),
          message: "Payment is already marked REFUNDED",
        };
      }

      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: PaymentStatus.REFUNDED,
            refundId: refundEntity.id,
            refundStatus: "processed",
            refundedAt: new Date(),
          },
          $unset: { failureCode: 1, failureReason: 1 },
        }
      );

      if (payment.targetType === PaymentTargetType.APPOINTMENT) {
        await Appointment.updateOne(
          { _id: payment.targetId },
          { $set: { paymentStatus: "REFUNDED" } }
        );
      }

      void auditLogService.log({
        actorId: payment.userId,
        actorRole: "SYSTEM",
        action: AuditAction.PAYMENT_REFUND_ISSUED,
        resourceType: "Payment",
        resourceId: payment._id.toString(),
        patientId: payment.userId,
        status: "SUCCESS",
        metadata: {
          source: "WEBHOOK",
          providerRefundId: refundEntity.id,
          amount: payment.refundAmount || payment.amount,
          event,
        },
      });

      return {
        acknowledged: true,
        event,
        status: "SETTLED",
        paymentId: payment._id.toString(),
        message: "Refund settled via webhook callback",
      };
    }

    if (event !== "payment.captured") {
      // Unrelated valid event acknowledged without side effects
      return {
        acknowledged: true,
        event,
        status: "IGNORED",
        message: `Webhook event '${event}' acknowledged without settlement`,
      };
    }

    // 3. Extract captured payment details
    const paymentEntity = payload?.payload?.payment?.entity;
    if (!paymentEntity || !paymentEntity.order_id || !paymentEntity.id) {
      throw AppError.badRequest(
        "Missing payment entity or order_id in webhook payload",
        "INVALID_PAYLOAD"
      );
    }

    const razorpayOrderId = paymentEntity.order_id;
    const razorpayPaymentId = paymentEntity.id;
    const capturedAmount = paymentEntity.amount;
    const capturedCurrency = paymentEntity.currency?.toUpperCase()?.trim();

    // 4. Match local Payment document by providerOrderId
    const payment = await Payment.findOne({ providerOrderId: razorpayOrderId });
    if (!payment) {
      throw new AppError(
        404,
        "PAYMENT_NOT_FOUND",
        `Payment record not found for provider order ID ${razorpayOrderId}`
      );
    }

    // 5. Idempotent check: duplicate delivery for already settled payment
    if (payment.status === PaymentStatus.SUCCESS) {
      return {
        acknowledged: true,
        event,
        status: "ALREADY_SETTLED",
        paymentId: payment._id.toString(),
        appointmentId: payment.targetId.toString(),
        orderId: razorpayOrderId,
        message: "Payment order has already been settled",
      };
    }

    if (
      payment.status !== PaymentStatus.CREATED &&
      payment.status !== PaymentStatus.PENDING_GATEWAY
    ) {
      throw new AppError(
        409,
        "PAYMENT_INVALID_TRANSITION",
        `Cannot settle payment with status '${payment.status}'`
      );
    }

    // 6. Verify amount and currency match trusted server payment intent
    const expectedSubunits = convertToSmallestCurrencyUnit(
      payment.amount,
      payment.currency
    );

    if (
      Number(capturedAmount) !== expectedSubunits ||
      capturedCurrency !== payment.currency
    ) {
      throw new AppError(
        400,
        "PAYMENT_AMOUNT_MISMATCH",
        "Captured payment amount or currency does not match payment intent"
      );
    }

    // 7. Load target appointment and verify eligibility
    const appointment = await Appointment.findById(payment.targetId);
    if (!appointment) {
      throw new AppError(
        404,
        "APPOINTMENT_NOT_FOUND",
        "Associated appointment not found"
      );
    }

    if (appointment.status !== AppointmentStatus.PENDING_PAYMENT) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        `Cannot confirm appointment with status '${appointment.status}'. Appointment must be in PENDING_PAYMENT.`
      );
    }

    if (
      appointment.lockExpiresAt &&
      appointment.lockExpiresAt.getTime() < Date.now()
    ) {
      throw new AppError(
        409,
        "APPOINTMENT_INVALID_TRANSITION",
        "Cannot confirm an expired appointment reservation lock"
      );
    }

    // 8. Atomic Settlement: use native MongoDB transactions if replica set is active,
    // or conditional updates with compensating rollback on standalone MongoDB.
    let isReplicaSet = false;
    if (mongoose.connection.readyState === 1) {
      try {
        const client = mongoose.connection.getClient();
        const topology = (
          client as unknown as {
            topology?: { description?: { type?: string; setName?: string } };
          }
        )?.topology?.description;

        isReplicaSet =
          topology?.type === "ReplicaSetWithPrimary" ||
          topology?.type === "Sharded" ||
          Boolean(topology?.setName);
      } catch {
        isReplicaSet = false;
      }
    }

    let session: mongoose.ClientSession | undefined = undefined;
    if (isReplicaSet) {
      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch {
        session = undefined;
      }
    }

    let updatedPayment: IPayment | null = null;
    try {
      updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: payment._id,
          status: payment.status,
        },
        {
          $set: {
            status: PaymentStatus.SUCCESS,
            providerPaymentId: razorpayPaymentId,
            ...(signature ? { providerSignature: signature } : {}),
            gatewayMetadata: paymentEntity,
          },
        },
        { new: true, ...(session ? { session } : {}) }
      );

      if (!updatedPayment) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }
        return {
          acknowledged: true,
          event,
          status: "ALREADY_SETTLED",
          paymentId: payment._id.toString(),
          appointmentId: appointment._id.toString(),
          orderId: razorpayOrderId,
          message: "Payment order settled concurrently",
        };
      }

      const updatedAppointment = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          status: AppointmentStatus.PENDING_PAYMENT,
        },
        {
          $set: {
            status: AppointmentStatus.CONFIRMED,
            paymentStatus: "PAID",
            paymentId: payment._id,
          },
          $unset: { lockExpiresAt: 1 },
        },
        { new: true, ...(session ? { session } : {}) }
      );

      if (!updatedAppointment) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        } else {
          // Compensating rollback for standalone deployment
          await Payment.updateOne(
            { _id: payment._id },
            {
              $set: { status: payment.status },
              $unset: { providerPaymentId: 1, providerSignature: 1 },
            }
          );
        }
        throw new AppError(
          409,
          "APPOINTMENT_INVALID_TRANSITION",
          "Appointment status modified concurrently; cannot be confirmed"
        );
      }

      if (session && session.inTransaction()) {
        await session.commitTransaction();
      }
    } catch (err: unknown) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      if (session) {
        await session.endSession();
      }
    }

    // 9. Post-commit side effects: real-time events & audit logging
    try {
      const { io } = await import("../server.js");
      if (io) {
        io.to(`patient:${appointment.patientId}`).emit("appointment:confirmed", {
          appointmentId: appointment._id.toString(),
          status: AppointmentStatus.CONFIRMED,
          paymentId: payment._id.toString(),
        });
        io.to(`doctor:${appointment.doctorId}`).emit("appointment:confirmed", {
          appointmentId: appointment._id.toString(),
          status: AppointmentStatus.CONFIRMED,
          paymentId: payment._id.toString(),
        });
        io.emit("APPOINTMENT_CONFIRMED", {
          appointmentId: appointment._id.toString(),
          status: AppointmentStatus.CONFIRMED,
          paymentId: payment._id.toString(),
        });
      }
    } catch {
      // In decoupled test environments, ignore if io is not bound
    }

    void auditLogService.log({
      actorRole: "SYSTEM",
      action: AuditAction.PAYMENT_VERIFIED,
      resourceType: "Payment",
      resourceId: payment._id.toString(),
      metadata: {
        appointmentId: appointment._id.toString(),
        providerOrderId: razorpayOrderId,
        providerPaymentId: razorpayPaymentId,
        amount: payment.amount,
      },
      status: "SUCCESS",
    });

    return {
      acknowledged: true,
      event,
      status: "SETTLED",
      paymentId: payment._id.toString(),
      appointmentId: appointment._id.toString(),
      orderId: razorpayOrderId,
    };
  }

  /**
   * Processes a financial refund for a captured payment via Razorpay Refunds API.
   *
   * Business Rules:
   * 1. Validates payment identifier format (ObjectId).
   * 2. Retrieves payment from database (404 if not found).
   * 3. Idempotency checks:
   *    - If already REFUNDED, returns acknowledged status without re-invoking gateway.
   *    - If REFUND_PENDING, reconciles with provider to prevent double-refunding.
   *    - If not SUCCESS, rejects with 409 PAYMENT_INVALID_TRANSITION.
   * 4. Ensures payment has a valid providerPaymentId (must be captured).
   * 5. Validates refund amount:
   *    - Must be positive finite number.
   *    - Must not exceed remaining refundable amount (payment.amount - (payment.refundAmount || 0)).
   * 6. Converts amount to subunits (paise) integer-safely.
   * 7. Concurrency lock: atomically sets status to REFUND_PENDING conditionally.
   * 8. Executes external Razorpay refund API call outside DB transactions.
   * 9. On gateway success:
   *    - If status === "processed": updates Payment to REFUNDED, updates Appointment paymentStatus to "REFUNDED".
   *    - If status === "pending": updates Payment to REFUND_PENDING (retains pending).
   *    - Creates in-app Notification for patient.
   *    - Emits real-time Socket.IO event.
   *    - Records audit log (AuditAction.PAYMENT_REFUND_ISSUED).
   * 10. On gateway failure:
   *    - Records failure details (failureCode, failureReason, refundStatus: "failed") on Payment.
   *    - Reverts status back to SUCCESS for manual admin retry.
   *    - Records audit log failure.
   *    - Throws AppError(500, "PAYMENT_REFUND_FAILED").
   */
  async processRefund(
    paymentId: string,
    amount?: number,
    reason?: string,
    actor?: AuthenticatedUser
  ): Promise<ProcessRefundResult> {
    if (!paymentId || !mongoose.Types.ObjectId.isValid(paymentId)) {
      throw AppError.badRequest(
        "Invalid payment identifier format",
        "BAD_REQUEST"
      );
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment record not found");
    }

    // Idempotency: already refunded
    if (payment.status === PaymentStatus.REFUNDED) {
      return {
        success: true,
        status: "ALREADY_REFUNDED",
        paymentId: payment._id.toString(),
        refundId: payment.refundId,
        amount: payment.refundAmount || payment.amount,
        currency: payment.currency,
        message: "Payment has already been refunded",
      };
    }

    // Idempotency / reconciliation: refund pending
    if (payment.status === PaymentStatus.REFUND_PENDING) {
      if (payment.refundId) {
        const razorpay = getRazorpayClient();
        let providerRefund: any;
        try {
          if (typeof razorpay.refunds?.fetch === "function") {
            providerRefund = await razorpay.refunds.fetch(payment.refundId);
          } else if (
            payment.providerPaymentId &&
            typeof razorpay.payments?.fetchRefund === "function"
          ) {
            providerRefund = await razorpay.payments.fetchRefund(
              payment.providerPaymentId,
              payment.refundId
            );
          }
        } catch {
          // Provider fetch failed; keep existing pending status
        }

        if (providerRefund?.status === "processed") {
          await Payment.updateOne(
            { _id: payment._id },
            {
              $set: {
                status: PaymentStatus.REFUNDED,
                refundStatus: "processed",
                refundedAt: new Date(),
              },
              $unset: { failureCode: 1, failureReason: 1 },
            }
          );
          if (payment.targetType === PaymentTargetType.APPOINTMENT) {
            await Appointment.updateOne(
              { _id: payment.targetId },
              { $set: { paymentStatus: "REFUNDED" } }
            );
          }
          return {
            success: true,
            status: "PROCESSED",
            paymentId: payment._id.toString(),
            refundId: payment.refundId,
            amount: payment.refundAmount || payment.amount,
            currency: payment.currency,
            message: "Reconciled with provider: refund processed",
          };
        }

        return {
          success: true,
          status: "PENDING",
          paymentId: payment._id.toString(),
          refundId: payment.refundId,
          amount: payment.refundAmount || payment.amount,
          currency: payment.currency,
          message: "Refund is currently pending provider settlement",
        };
      }
    }

    // Eligibility: must be SUCCESS
    if (payment.status !== PaymentStatus.SUCCESS) {
      throw new AppError(
        409,
        "PAYMENT_INVALID_TRANSITION",
        `Cannot refund payment with status '${payment.status}'. Payment must be in SUCCESS state.`
      );
    }

    // Must have providerPaymentId
    if (!payment.providerPaymentId) {
      throw new AppError(
        400,
        "PAYMENT_NO_PROVIDER_PAYMENT_ID",
        "Payment record has no provider payment identifier (uncaptured payment)"
      );
    }

    // Calculate & validate refund amount
    const settledRefundAmount =
      payment.refundStatus === "processed"
        ? payment.refundAmount || 0
        : 0;
    const maxRefundable = payment.amount - settledRefundAmount;
    let refundAmount: number;

    if (amount !== undefined && amount !== null) {
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        isNaN(amount) ||
        amount <= 0
      ) {
        throw AppError.badRequest(
          "Refund amount must be a positive finite number",
          "INVALID_AMOUNT"
        );
      }

      if (amount > maxRefundable) {
        throw new AppError(
          400,
          "PAYMENT_REFUND_EXCEEDS_AMOUNT",
          `Refund amount (${amount}) exceeds remaining refundable payment amount (${maxRefundable})`
        );
      }
      refundAmount = amount;
    } else {
      if (maxRefundable <= 0) {
        throw new AppError(
          400,
          "PAYMENT_REFUND_EXCEEDS_AMOUNT",
          "Payment has already been fully refunded"
        );
      }
      refundAmount = maxRefundable;
    }

    const cleanReason =
      reason && typeof reason === "string" && reason.trim()
        ? reason.trim()
        : "Appointment cancellation refund";

    const refundSubunits = convertToSmallestCurrencyUnit(
      refundAmount,
      payment.currency
    );

    // Concurrency lock: atomically transition to REFUND_PENDING
    const lockedPayment = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        status: PaymentStatus.SUCCESS,
      },
      {
        $set: {
          status: PaymentStatus.REFUND_PENDING,
          refundAmount,
          refundReason: cleanReason,
        },
      },
      { new: true }
    );

    if (!lockedPayment) {
      // Re-read current state
      const current = await Payment.findById(payment._id);
      if (current?.status === PaymentStatus.REFUNDED) {
        return {
          success: true,
          status: "ALREADY_REFUNDED",
          paymentId: payment._id.toString(),
          refundId: current.refundId,
          amount: current.refundAmount || payment.amount,
          currency: payment.currency,
          message: "Payment was refunded concurrently",
        };
      }
      if (current?.status === PaymentStatus.REFUND_PENDING) {
        return {
          success: true,
          status: "PENDING",
          paymentId: payment._id.toString(),
          refundId: current.refundId,
          amount: current.refundAmount || payment.amount,
          currency: payment.currency,
          message: "Refund is being processed concurrently",
        };
      }
      throw new AppError(
        409,
        "PAYMENT_CONCURRENT_REFUND",
        "Payment refund is being processed concurrently"
      );
    }

    // Call Razorpay Refunds API outside database transactions
    const razorpay = getRazorpayClient();
    let providerRefund: any;

    try {
      providerRefund = await razorpay.payments.refund(
        payment.providerPaymentId,
        {
          amount: refundSubunits,
          notes: {
            paymentId: payment._id.toString(),
            targetType: payment.targetType,
            targetId: payment.targetId.toString(),
            reason: cleanReason,
          },
        }
      );
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : "Razorpay refund request failed";
      console.error(
        `[PaymentService] Gateway refund failed for payment ${payment._id}: ${errorMsg}`
      );

      // Record recoverable failure on Payment and revert status to SUCCESS so it can be retried
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: PaymentStatus.SUCCESS,
            failureCode: "PAYMENT_REFUND_FAILED",
            failureReason: errorMsg,
            refundStatus: "failed",
          },
          $unset: {
            refundAmount: 1,
            refundId: 1,
          },
        }
      );

      void auditLogService.log({
        actorId: actor?.id || payment.userId,
        actorRole: actor?.role || "SYSTEM",
        action: AuditAction.PAYMENT_REFUND_ISSUED,
        resourceType: "Payment",
        resourceId: payment._id.toString(),
        patientId: payment.userId,
        status: "FAILURE",
        metadata: {
          error: errorMsg,
          amount: refundAmount,
          reason: cleanReason,
          appointmentId: payment.targetId.toString(),
        },
      });

      throw new AppError(
        500,
        "PAYMENT_REFUND_FAILED",
        `Payment refund request failed: ${errorMsg}`
      );
    }

    // Evaluate provider response
    if (providerRefund?.status === "processed") {
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: PaymentStatus.REFUNDED,
            refundId: providerRefund.id,
            refundAmount,
            refundStatus: "processed",
            refundedAt: new Date(),
          },
          $unset: { failureCode: 1, failureReason: 1 },
        }
      );

      if (payment.targetType === PaymentTargetType.APPOINTMENT) {
        await Appointment.updateOne(
          { _id: payment.targetId },
          { $set: { paymentStatus: "REFUNDED" } }
        );
      }

      // Patient Notification
      try {
        await Notification.create({
          userId: payment.userId,
          type: NotificationType.REFUND_PROCESSED,
          title: "Refund Processed",
          message: `Your refund of ${payment.currency} ${refundAmount} for appointment has been successfully processed.`,
          relatedEntityType: "Payment",
          relatedEntityId: payment._id,
          metadata: {
            appointmentId: payment.targetId.toString(),
            refundId: providerRefund.id,
            amount: refundAmount,
            currency: payment.currency,
            status: "processed",
          },
        });
      } catch {}

      // Socket.IO event
      try {
        const { io } = await import("../server.js");
        if (io) {
          io.to(`patient:${payment.userId}`).emit("payment:refunded", {
            paymentId: payment._id.toString(),
            appointmentId: payment.targetId.toString(),
            refundId: providerRefund.id,
            status: "REFUNDED",
            amount: refundAmount,
          });
          io.emit("REFUND_COMPLETED", {
            paymentId: payment._id.toString(),
            refundId: providerRefund.id,
            status: "REFUNDED",
          });
        }
      } catch {}

      // Audit Log
      void auditLogService.log({
        actorId: actor?.id || payment.userId,
        actorRole: actor?.role || "SYSTEM",
        action: AuditAction.PAYMENT_REFUND_ISSUED,
        resourceType: "Payment",
        resourceId: payment._id.toString(),
        patientId: payment.userId,
        status: "SUCCESS",
        metadata: {
          appointmentId: payment.targetId.toString(),
          providerRefundId: providerRefund.id,
          amount: refundAmount,
          currency: payment.currency,
          reason: cleanReason,
          status: "REFUNDED",
        },
      });

      return {
        success: true,
        status: "PROCESSED",
        paymentId: payment._id.toString(),
        refundId: providerRefund.id,
        amount: refundAmount,
        currency: payment.currency,
      };
    }

    if (providerRefund?.status === "pending") {
      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            status: PaymentStatus.REFUND_PENDING,
            refundId: providerRefund.id,
            refundAmount,
            refundStatus: "pending",
          },
          $unset: { failureCode: 1, failureReason: 1 },
        }
      );

      if (payment.targetType === PaymentTargetType.APPOINTMENT) {
        await Appointment.updateOne(
          { _id: payment.targetId },
          { $set: { paymentStatus: "PENDING" } }
        );
      }

      try {
        await Notification.create({
          userId: payment.userId,
          type: NotificationType.REFUND_PROCESSED,
          title: "Refund Initiated",
          message: `Your refund of ${payment.currency} ${refundAmount} has been initiated and is pending provider settlement.`,
          relatedEntityType: "Payment",
          relatedEntityId: payment._id,
          metadata: {
            appointmentId: payment.targetId.toString(),
            refundId: providerRefund.id,
            amount: refundAmount,
            status: "pending",
          },
        });
      } catch {}

      void auditLogService.log({
        actorId: actor?.id || payment.userId,
        actorRole: actor?.role || "SYSTEM",
        action: AuditAction.PAYMENT_REFUND_ISSUED,
        resourceType: "Payment",
        resourceId: payment._id.toString(),
        patientId: payment.userId,
        status: "SUCCESS",
        metadata: {
          appointmentId: payment.targetId.toString(),
          providerRefundId: providerRefund.id,
          amount: refundAmount,
          currency: payment.currency,
          reason: cleanReason,
          status: "PENDING",
        },
      });

      return {
        success: true,
        status: "PENDING",
        paymentId: payment._id.toString(),
        refundId: providerRefund.id,
        amount: refundAmount,
        currency: payment.currency,
        message: "Refund initiated and pending provider settlement",
      };
    }

    // Status is 'failed' from provider
    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          status: PaymentStatus.SUCCESS,
          failureCode: "REFUND_REJECTED",
          failureReason: "Provider declined refund request",
          refundStatus: "failed",
          refundId: providerRefund?.id,
        },
      }
    );

    void auditLogService.log({
      actorId: actor?.id || payment.userId,
      actorRole: actor?.role || "SYSTEM",
      action: AuditAction.PAYMENT_REFUND_ISSUED,
      resourceType: "Payment",
      resourceId: payment._id.toString(),
      patientId: payment.userId,
      status: "FAILURE",
      metadata: {
        error: "Provider declined refund request",
        amount: refundAmount,
        reason: cleanReason,
      },
    });

    throw new AppError(
      500,
      "PAYMENT_REFUND_FAILED",
      "Provider declined refund request"
    );
  }
}

export const paymentService = new PaymentService();
