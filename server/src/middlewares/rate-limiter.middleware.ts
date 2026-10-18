import rateLimit, {
  ipKeyGenerator,
  type RateLimitRequestHandler,
} from "express-rate-limit";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/index.js";
import { AppError } from "../utils/api-error.js";

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  code?: string;
  message?: string;
  keyGenerator?: (req: Request) => string;
}

/**
 * Resolves client IP address, supporting isolated test keys during automated tests
 * to prevent cross-test contamination without compromising production security.
 * IPv6 addresses are properly normalized using express-rate-limit's ipKeyGenerator.
 */
function resolveClientIp(req: Request): string {
  const isTestEnv = process.env.NODE_ENV === "test" || env.NODE_ENV === "test";
  if (isTestEnv && req.headers["x-test-client-ip"]) {
    return req.headers["x-test-client-ip"] as string;
  }
  return ipKeyGenerator(req.ip || req.socket.remoteAddress || "127.0.0.1");
}

/**
 * Factory helper for creating rate limiters that return standard RateLimit-* headers
 * and integrate seamlessly with the M2.1 centralized error handling pipeline.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: "draft-6",
    legacyHeaders: false,
    keyGenerator: options.keyGenerator || resolveClientIp,
    handler: (_req: Request, _res: Response, next: NextFunction) => {
      next(
        new AppError(
          429,
          options.code || "RATE_LIMIT_EXCEEDED",
          options.message || "Too many requests, please try again later"
        )
      );
    },
  });
}

/**
 * Global API rate limiter: 100 requests per minute.
 * Protects general HTTP and API traffic.
 */
export const globalLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 100, // 100 requests per minute
  code: "RATE_LIMIT_EXCEEDED",
  message: "Too many requests, please try again later",
});

/**
 * Authentication rate limiter: 5 attempts per 15 minutes.
 * Exported for future authentication endpoints (login, register brute-force protection).
 */
export const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 requests per 15 minutes
  code: "RATE_LIMIT_EXCEEDED",
  message: "Too many authentication attempts, please try again after 15 minutes",
});

/**
 * AI service rate limiter: 10 requests per minute per authenticated user.
 * Keys by authenticated user ID (req.user.id) to protect expensive LLM providers.
 * Falls back to client IP for unauthenticated requests.
 */
export const aiLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 10, // 10 requests per minute
  code: "AI_RATE_LIMIT_EXCEEDED",
  message: "AI assistant rate limit exceeded, please try again later",
  keyGenerator: (req: Request) => {
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    return resolveClientIp(req);
  },
});
