import type { Request, Response, NextFunction } from "express";
import { UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";

/**
 * Role-Based Access Control (RBAC) middleware factory.
 *
 * Verifies that the authenticated user (`req.user`) has one of the explicitly allowed roles.
 * Rejects requests from unauthorized roles with HTTP 403 (AUTH_INSUFFICIENT_PERMISSIONS).
 *
 * Requirements:
 * - Authentication must run before this middleware (relies on cryptographically verified `req.user`).
 * - Never trusts role claims supplied via client request body, query parameters, or headers.
 * - Forwards all errors into the centralized error handling pipeline.
 *
 * @param allowedRoles List of roles permitted to access the route
 */
export function authorizeRole(
  ...allowedRoles: (UserRole | `${UserRole}`)[]
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!req.user || !req.user.role) {
        throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
      }

      const userRole = req.user.role;

      if (!allowedRoles.includes(userRole)) {
        throw AppError.forbidden(
          "Access denied: insufficient permissions for this resource",
          "AUTH_INSUFFICIENT_PERMISSIONS"
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
