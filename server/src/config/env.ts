import dotenv from "dotenv";
import { z } from "zod";

// Load environment variables from .env file
dotenv.config();

/**
 * Zod schema defining the environment configuration for the LifeLine backend.
 * Required variables fail fast on application boot.
 * Deferred service variables (Razorpay, LiveKit, S3, AI) are optional until their milestone is active.
 */
export const envSchema = z.object({
  // Core Server Configuration
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1024, "PORT must be >= 1024").max(65535, "PORT must be <= 65535").default(5001),
  CLIENT_URL: z.string().url("CLIENT_URL must be a valid URL").default("http://localhost:5173"),

  // Database Configuration
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required").refine(
    (uri) => uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"),
    { message: "MONGODB_URI must start with mongodb:// or mongodb+srv://" }
  ),

  // Authentication & Security (JWT)
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters long"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters long"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // Razorpay Payment Gateway (Optional until Milestone 7)
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // LiveKit Cloud Video Infrastructure (Optional until Milestone 8)
  LIVEKIT_URL: z.string().url("LIVEKIT_URL must be a valid URL").optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  // Secure Object Storage - S3 / R2 (Optional until Milestone 9)
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_REGION: z.string().optional(),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_ENDPOINT: z.string().url("STORAGE_ENDPOINT must be a valid URL").optional(),

  // Email Service - Resend / SMTP (Optional until Milestone 11)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email("EMAIL_FROM must be a valid email address").optional(),

  // AI Service Provider - Gemini / LLM (Optional until Milestone 12)
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gemini-1.5-pro").optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-1.5-flash").optional(),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates an input environment dictionary against the schema.
 * Formats errors clearly while strictly preventing secret leakage.
 *
 * @param envInput - Environment variables to validate
 * @returns Strongly-typed and defaulted EnvConfig object
 * @throws Error if validation fails
 */
export function validateEnv(envInput: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(envInput);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => {
        const path = issue.path.join(".");
        // Explicitly sanitize: only output field path and validation message, NEVER raw values
        return `  - ${path}: ${issue.message}`;
      })
      .join("\n");

    const message = `[FATAL] Invalid server environment configuration:\n${errorDetails}\nCheck your .env file or environment variables.`;
    throw new Error(message);
  }

  return result.data;
}

/**
 * Singleton validated environment configuration for the backend.
 * Imported across the application instead of direct process.env reads.
 */
export const env: EnvConfig = validateEnv(process.env);
