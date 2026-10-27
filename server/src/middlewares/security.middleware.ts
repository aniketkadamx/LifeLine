import helmet from "helmet";
import cors, { type CorsOptions } from "cors";
import { env } from "../config/index.js";
import { AppError } from "../utils/api-error.js";

/**
 * Helmet middleware securing HTTP headers.
 * Sets X-Content-Type-Options: nosniff, frameguard, HSTS, and other secure headers.
 */
export const helmetMiddleware = helmet();

/**
 * Strict CORS configuration.
 * Exclusively permits requests from env.CLIENT_URL with credentials enabled.
 * Requests from unauthorized origins are rejected with HTTP 403.
 */
export const corsOptions: CorsOptions = {
  origin: (requestOrigin, callback) => {
    // Allow non-browser requests (e.g. mobile apps, curl, server-to-server) or exact CLIENT_URL match
    const isDev = env.NODE_ENV !== "production";
    const isDevLocalhost =
      isDev && Boolean(requestOrigin && /^http:\/\/(localhost|127\.0\.0\.1):(5173|5174|5175|3000)$/.test(requestOrigin));

    if (!requestOrigin || requestOrigin === env.CLIENT_URL || isDevLocalhost) {
      callback(null, true);
    } else {
      callback(new AppError(403, "CORS_FORBIDDEN", "Origin not allowed by CORS policy"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Request-Id",
    "Idempotency-Key",
  ],
};

export const corsMiddleware = cors(corsOptions);
