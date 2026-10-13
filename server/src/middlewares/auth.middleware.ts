import type { Request, Response, NextFunction } from "express";
import { tokenService } from "../services/token.service.js";
import { AppError } from "../utils/api-error.js";

/**
 * Authentication middleware that verifies JWT Bearer access tokens.
 *
 * Enforces:
 * 1. Presence of Authorization header.
 * 2. Proper "Bearer <token>" format.
 * 3. Valid access token signature, issuer, expiration, and claims.
 * 4. Rejection of refresh tokens or corrupted/tampered tokens.
 * 5. Strong typing of `req.user` with authenticated identity.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw AppError.unauthorized("Authentication token is required", "AUTH_TOKEN_MISSING");
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      throw AppError.unauthorized(
        "Authentication header format must be 'Bearer <token>'",
        "AUTH_TOKEN_INVALID"
      );
    }

    const token = parts[1];
    if (!token) {
      throw AppError.unauthorized("Authentication token is required", "AUTH_TOKEN_MISSING");
    }

    const payload = tokenService.verifyAccessToken(token);

    req.user = {
      id: payload.sub,
      role: payload.role,
      tokenId: payload.jti,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication middleware: parses Authorization Bearer token if present,
 * populating req.user without rejecting unauthenticated requests.
 */
export function optionalAuthenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return next();
    }

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length === 2 && parts[0] === "Bearer" && parts[1]) {
      const payload = tokenService.verifyAccessToken(parts[1]);
      req.user = {
        id: payload.sub,
        role: payload.role,
        tokenId: payload.jti,
      };
    }
  } catch {
    // Gracefully ignore token errors for optional routes
  }
  next();
}
