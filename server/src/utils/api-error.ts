import type { ErrorDetail } from "./api-response.js";

/**
 * Controlled application and domain error class.
 * Integrates directly with the centralized error handling middleware.
 * Source: docs/api/ERROR_TAXONOMY.md.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: ErrorDetail[];
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: ErrorDetail[],
    isOperational = true
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Helper factory for 400 Bad Request.
   */
  static badRequest(
    message = "Bad request syntax or invalid parameters",
    code = "BAD_REQUEST",
    details?: ErrorDetail[]
  ): AppError {
    return new AppError(400, code, message, details);
  }

  /**
   * Helper factory for 401 Unauthorized.
   */
  static unauthorized(
    message = "Authentication required",
    code = "AUTH_TOKEN_MISSING"
  ): AppError {
    return new AppError(401, code, message);
  }

  /**
   * Helper factory for 403 Forbidden.
   */
  static forbidden(
    message = "Access denied for requested resource",
    code = "AUTH_INSUFFICIENT_PERMISSIONS"
  ): AppError {
    return new AppError(403, code, message);
  }

  /**
   * Helper factory for 404 Not Found.
   */
  static notFound(
    message = "Requested resource not found",
    code = "NOT_FOUND"
  ): AppError {
    return new AppError(404, code, message);
  }

  /**
   * Helper factory for 409 Conflict.
   */
  static conflict(
    message = "Resource state conflict",
    code = "CONFLICT"
  ): AppError {
    return new AppError(409, code, message);
  }

  /**
   * Helper factory for 422 Unprocessable Entity.
   */
  static unprocessable(
    message = "Validation failed for provided fields",
    code = "VALIDATION_ERROR",
    details?: ErrorDetail[]
  ): AppError {
    return new AppError(422, code, message, details);
  }

  /**
   * Helper factory for 500 Internal Server Error.
   */
  static internal(
    message = "An unexpected server error occurred",
    code = "INTERNAL_SERVER_ERROR"
  ): AppError {
    return new AppError(500, code, message, undefined, false);
  }
}
