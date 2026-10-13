import crypto from "node:crypto";
import Razorpay from "razorpay";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/api-error.js";

let razorpayClientInstance: Razorpay | null = null;
let mockPublicKey: string | null = null;

/**
 * Retrieves the initialized Razorpay SDK client singleton.
 * Validates that environment credentials are provided without exposing secrets.
 */
export function getRazorpayClient(): Razorpay {
  if (razorpayClientInstance) {
    return razorpayClientInstance;
  }

  const key_id = process.env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET || env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new AppError(
      500,
      "PAYMENT_GATEWAY_CONFIG_ERROR",
      "Razorpay gateway credentials missing: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured"
    );
  }

  razorpayClientInstance = new Razorpay({
    key_id,
    key_secret,
  });

  return razorpayClientInstance;
}

/**
 * Sets or mocks the active Razorpay client instance (used for testing and dependency injection).
 *
 * @param client Mocked or custom Razorpay client (or null to reset)
 * @param publicKey Optional mock public key ID to return for client checkout
 */
export function setRazorpayClient(
  client: Razorpay | null,
  publicKey: string | null = null
): void {
  razorpayClientInstance = client;
  mockPublicKey = publicKey;
}

/**
 * Returns the public Razorpay Key ID for client-side modal checkout initialization.
 * Never exposes the key secret.
 */
export function getRazorpayPublicKey(): string {
  if (mockPublicKey) {
    return mockPublicKey;
  }
  const key_id = process.env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID;
  if (!key_id) {
    throw new AppError(
      500,
      "PAYMENT_GATEWAY_CONFIG_ERROR",
      "Razorpay public key ID is not configured"
    );
  }
  return key_id;
}

/**
 * Cryptographically verifies Razorpay webhook signature using HMAC SHA-256.
 *
 * Security Requirements:
 * - Computes HMAC SHA-256 digest using raw Buffer bytes.
 * - Enforces timing-safe comparison (crypto.timingSafeEqual).
 * - Validates signature format and length before comparison.
 * - Rejects missing, invalid, or malformed signatures with false.
 * - Never logs or exposes the webhook secret.
 *
 * @param rawBody Raw HTTP request buffer
 * @param signature Value of X-Razorpay-Signature header
 * @param secret Optional explicit webhook secret override (defaults to environment config)
 * @returns true if cryptographically valid, false otherwise
 */
export function verifyRazorpayWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined | null,
  secret?: string
): boolean {
  if (!signature || typeof signature !== "string") {
    return false;
  }

  const webhookSecret =
    secret || process.env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    throw new AppError(
      500,
      "PAYMENT_GATEWAY_CONFIG_ERROR",
      "RAZORPAY_WEBHOOK_SECRET is not configured"
    );
  }

  const cleanSig = signature.trim();
  // Valid Razorpay SHA-256 hex digest is exactly 64 hexadecimal characters
  if (!/^[0-9a-fA-F]{64}$/.test(cleanSig)) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const sigBuffer = Buffer.from(cleanSig.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expectedSignature.toLowerCase(), "utf8");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
