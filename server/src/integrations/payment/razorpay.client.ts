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
