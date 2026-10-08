import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { env } from "../config/index.js";
import { AppError } from "../utils/api-error.js";
import type { ApiResponseError, ErrorDetail } from "../utils/api-response.js";

/**
 * 404 Not Found handler for unmatched Express routes.
 * Forwards a standardized AppError into the centralized error pipeline.
 */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, "ROUTE_NOT_FOUND", "The requested endpoint does not exist"));
}

/**
 * Centralized Express error-handling middleware.
 * Transforms all operational and unexpected exceptions into the standardized
 * ApiResponseError JSON envelope defined by docs/api/ERROR_TAXONOMY.md.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const isProduction = process.env.NODE_ENV === "production" || env.NODE_ENV === "production";
  const requestId = (req.headers["x-request-id"] as string) || undefined;

  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "An unexpected server error occurred";
  let details: ErrorDetail[] | undefined = undefined;

  // 1. Controlled Application / Domain Errors
  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  }
  // 2. Zod Schema Validation Errors (HTTP 422)
  else if (err instanceof ZodError) {
    statusCode = 422;
    code = "VALIDATION_ERROR";
    message = "Validation failed for provided fields";
    details = err.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join(".") : undefined,
      issue: issue.message,
    }));
  }
  // 3. MongoDB / Mongoose Duplicate Key Errors (E11000 -> HTTP 409)
  else if (
    (err as { code?: number }).code === 11000 ||
    ((err as { name?: string }).name === "MongoServerError" && (err as { code?: number }).code === 11000)
  ) {
    statusCode = 409;
    const mongoErr = err as { keyValue?: Record<string, unknown>; keyPattern?: Record<string, unknown> };
    const keyValue = mongoErr.keyValue || mongoErr.keyPattern || {};
    const duplicateFields = Object.keys(keyValue);
    const primaryField = duplicateFields[0];

    if (primaryField === "email") {
      code = "AUTH_EMAIL_ALREADY_EXISTS";
      message = "Provided email address is already in use";
    } else if (primaryField === "phone") {
      code = "AUTH_PHONE_ALREADY_EXISTS";
      message = "Provided phone number is already registered";
    } else if (primaryField === "appointmentId") {
      code = "APPOINTMENT_DOUBLE_BOOKING_PREVENTED";
      message = "An appointment has already been reviewed or recorded";
    } else {
      code = "RESOURCE_CONFLICT";
      message = primaryField
        ? `A record with this ${primaryField} already exists`
        : "A duplicate key conflict occurred in the database";
    }

    if (primaryField) {
      details = [{ field: primaryField, issue: `Duplicate value for field '${primaryField}'` }];
    }
  }
  // 4. Mongoose CastError (e.g., malformed ObjectId)
  else if ((err as { name?: string }).name === "CastError") {
    statusCode = 400;
    code = "BAD_REQUEST";
    const castErr = err as { path?: string; value?: unknown };
    message = `Invalid ${castErr.path || "identifier"} format`;
    if (castErr.path) {
      details = [{ field: castErr.path, issue: `Invalid ${castErr.path} value: '${String(castErr.value)}'` }];
    }
  }
  // 5. Mongoose Schema Validation Errors
  else if ((err as { name?: string }).name === "ValidationError") {
    statusCode = 422;
    code = "VALIDATION_ERROR";
    message = "Validation failed for provided fields";
    const mongooseErr = err as { errors?: Record<string, { path?: string; message: string }> };
    if (mongooseErr.errors) {
      details = Object.values(mongooseErr.errors).map((validationIssue) => ({
        field: validationIssue.path,
        issue: validationIssue.message,
      }));
    }
  }
  // 6. JSON Parse / Syntax Errors (Malformed Body)
  else if (err instanceof SyntaxError && "body" in err && (err as { status?: number }).status === 400) {
    statusCode = 400;
    code = "BAD_REQUEST";
    message = "Invalid JSON payload provided in request body";
  }
  // 7. Unknown / Unhandled Server Errors (HTTP 500)
  else {
    statusCode = 500;
    code = "INTERNAL_SERVER_ERROR";
    message = isProduction ? "An unexpected server error occurred" : err.message || "An unexpected server error occurred";
  }

  // Construct standardized error response envelope
  const responsePayload: ApiResponseError = {
    success: false,
    error: {
      code,
      message,
      ...(details && details.length > 0 ? { details } : {}),
      timestamp: new Date().toISOString(),
      ...(requestId ? { requestId } : {}),
    },
  };

  res.status(statusCode).json(responsePayload);
}
