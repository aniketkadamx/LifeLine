import type { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/api-error.js";
import type { AuthenticatedUser } from "../types/express.js";

/**
 * Strategy function or Mongoose model for locating a requested resource.
 */
export type ResourceFinder<T = any> =
  | ((req: Request) => Promise<T | null | undefined> | T | null | undefined)
  | {
      modelName: string;
      findById: (id: unknown) => Promise<T | null | undefined> | { exec: () => Promise<T | null | undefined> };
    };

/**
 * Permitted owner field representation:
 * - A single field name (e.g., "patientId", "userId")
 * - Multiple field names where any match confers ownership (e.g., ["patientId", "doctorId"])
 * - A custom predicate function evaluating the resource and authenticated identity
 */
export type OwnerField<T = any> =
  | string
  | string[]
  | ((resource: T, user: AuthenticatedUser) => boolean);

/**
 * Normalizes an unknown ID value (string, number, ObjectId, or populated document) into a clean string.
 */
function extractId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    // Populated Mongoose document or entity with _id
    if ("_id" in value && (value as { _id: unknown })._id != null) {
      return String((value as { _id: unknown })._id);
    }
    // Entity with id
    if ("id" in value && (value as { id: unknown }).id != null) {
      return String((value as { id: unknown }).id);
    }
    // Raw Mongoose ObjectId
    if (typeof (value as { toString?: () => string }).toString === "function") {
      const str = (value as { toString: () => string }).toString();
      if (str !== "[object Object]") {
        return str;
      }
    }
  }
  return null;
}

/**
 * Evaluates whether the authenticated user owns or is authorized on the resource.
 */
function checkOwnership<T>(
  resource: T,
  user: AuthenticatedUser,
  ownerField: OwnerField<T>
): boolean {
  if (!resource || !user || !user.id) {
    return false;
  }

  // 1. Predicate function
  if (typeof ownerField === "function") {
    return Boolean(ownerField(resource, user));
  }

  const userId = user.id.trim();

  // 2. Single attribute key
  if (typeof ownerField === "string") {
    const rawValue = (resource as Record<string, unknown>)[ownerField];
    if (rawValue === undefined || rawValue === null) {
      return false;
    }
    if (Array.isArray(rawValue)) {
      return rawValue.some((item) => extractId(item) === userId);
    }
    return extractId(rawValue) === userId;
  }

  // 3. Array of permitted attribute keys (e.g. ["patientId", "doctorId"])
  if (Array.isArray(ownerField)) {
    return ownerField.some((field) => {
      const rawValue = (resource as Record<string, unknown>)[field];
      if (rawValue === undefined || rawValue === null) {
        return false;
      }
      if (Array.isArray(rawValue)) {
        return rawValue.some((item) => extractId(item) === userId);
      }
      return extractId(rawValue) === userId;
    });
  }

  return false;
}

/**
 * Resource Ownership Authorization middleware factory.
 *
 * Verifies that the authenticated user (`req.user`) has explicit ownership rights
 * over the requested domain resource before downstream business controllers execute.
 *
 * Requirements:
 * - Authentication must run prior to this middleware.
 * - Extracts resource using the provided `resourceFinder`.
 * - If resource does not exist, terminates with HTTP 404 (NOT_FOUND).
 * - If resource exists but actor is not owner, terminates with HTTP 403 (AUTH_RESOURCE_ACCESS_DENIED).
 * - Never trusts client-supplied user IDs in request body, params, or query.
 * - Attaches the verified resource to `req.resource` to prevent redundant database queries.
 *
 * @param resourceFinder Async finder function `(req) => resource` or Mongoose Model
 * @param ownerField Key name, array of key names, or ownership predicate
 */
export function authorizeOwnership<T = any>(
  resourceFinder: ResourceFinder<T>,
  ownerField: OwnerField<T>
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user || !req.user.id) {
        throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
      }

      let resource: T | null | undefined;

      // Check if resourceFinder is a Mongoose model
      if (
        resourceFinder &&
        typeof resourceFinder === "function" &&
        "modelName" in resourceFinder &&
        typeof (resourceFinder as { findById?: unknown }).findById === "function"
      ) {
        const model = resourceFinder as unknown as {
          modelName: string;
          findById: (id: unknown) => { exec?: () => Promise<T | null>; then?: (cb: (v: T | null) => unknown) => unknown };
        };
        const paramId =
          req.params.id ||
          req.params[`${model.modelName.charAt(0).toLowerCase()}${model.modelName.slice(1)}Id`] ||
          req.params.resourceId;

        if (!paramId) {
          throw AppError.badRequest("Missing resource identifier in request parameters", "BAD_REQUEST");
        }

        const query = model.findById(paramId);
        resource = typeof query.exec === "function" ? await query.exec() : await (query as unknown as Promise<T | null>);
      } else if (typeof resourceFinder === "function") {
        resource = await (resourceFinder as (req: Request) => Promise<T | null | undefined> | T | null | undefined)(req);
      }

      if (!resource) {
        throw AppError.notFound("Requested resource not found", "NOT_FOUND");
      }

      const isOwner = checkOwnership(resource, req.user, ownerField);

      if (!isOwner) {
        throw AppError.forbidden(
          "Access denied: you do not have ownership of this resource",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }

      // Attach found resource to avoid duplicate queries down-pipeline
      req.resource = resource;

      next();
    } catch (error) {
      next(error);
    }
  };
}
