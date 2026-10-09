import type { Request, Response, NextFunction, CookieOptions } from "express";
import { env } from "../config/index.js";
import { authService } from "../services/auth.service.js";
import { auditLogService } from "../services/audit-log.service.js";
import { AuditAction, type UserRole } from "../types/models.js";
import { sendSuccess } from "../utils/api-response.js";
import type { RegisterInput, LoginInput } from "../validators/auth.validator.js";

export const REFRESH_COOKIE_NAME = "__Secure-refresh_token";

/**
 * Returns standardized security options for the HttpOnly refresh token cookie.
 */
export function getRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

/**
 * Returns cookie options to clear the refresh token cookie.
 */
export function getClearRefreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/auth",
  };
}

/**
 * Handler: POST /api/v1/auth/register
 */
export async function registerHandler(
  req: Request<unknown, unknown, RegisterInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.register(req.body);

    // Asynchronous audit logging (fail-safe)
    void auditLogService.log({
      actorId: result.userId,
      actorRole: result.role as UserRole,
      action: AuditAction.USER_CREATED,
      resourceType: "User",
      resourceId: result.userId,
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(res, result, "Registration successful. Please verify your email.", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/auth/login
 */
export async function loginHandler(
  req: Request<unknown, unknown, LoginInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await authService.login(req.body);

    // Attach HttpOnly, SameSite=Strict cookie with refresh token
    res.cookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, getRefreshCookieOptions());

    // Asynchronous audit logging
    void auditLogService.log({
      actorId: result.user.id,
      actorRole: result.user.role as UserRole,
      action: AuditAction.AUTH_LOGIN,
      resourceType: "User",
      resourceId: result.user.id,
      ipAddress: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
      status: "SUCCESS",
    });

    sendSuccess(
      res,
      {
        accessToken: result.tokens.accessToken,
        user: result.user,
      },
      "Login successful",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/auth/refresh-token
 */
export async function refreshTokenHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawRefreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.cookies?.["refreshToken"] ||
      req.body?.refreshToken;

    const result = await authService.refreshToken(rawRefreshToken);

    // Set rotated refresh token cookie
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, getRefreshCookieOptions());

    sendSuccess(
      res,
      {
        accessToken: result.accessToken,
        user: result.user,
      },
      "Token refreshed successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/auth/logout
 */
export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawRefreshToken =
      req.cookies?.[REFRESH_COOKIE_NAME] ||
      req.cookies?.["refreshToken"] ||
      req.body?.refreshToken;

    await authService.logout(rawRefreshToken);

    // Invalidate browser cookie
    res.clearCookie(REFRESH_COOKIE_NAME, getClearRefreshCookieOptions());

    sendSuccess(res, null, "Logged out successfully", 200);
  } catch (error) {
    next(error);
  }
}
