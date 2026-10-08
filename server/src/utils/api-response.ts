import type { Response } from "express";

/**
 * Granular issue or validation detail for API error responses.
 * Source: docs/api/ERROR_TAXONOMY.md Section 1.2.
 */
export interface ErrorDetail {
  field?: string;
  issue: string;
}

/**
 * Universal pagination metadata structure.
 * Source: docs/api/API_CONTRACT.md Section 1.3 & docs/api/ERROR_TAXONOMY.md Section 1.1.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  sort?: string;
  order?: "asc" | "desc";
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Universal success response envelope structure (2xx).
 * Source: docs/api/ERROR_TAXONOMY.md Section 1.1.
 */
export interface ApiResponseSuccess<T> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta | Record<string, unknown>;
}

/**
 * Universal error response envelope structure (4xx, 5xx).
 * Source: docs/api/ERROR_TAXONOMY.md Section 1.2.
 */
export interface ApiResponseError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    timestamp?: string;
    requestId?: string;
  };
}

/**
 * Input parameters for calculating pagination metadata.
 */
export interface PaginationOptions {
  page: number;
  limit: number;
  total: number;
  sort?: string;
  order?: "asc" | "desc";
}

/**
 * Sends a standardized success response matching the LifeLine API contract.
 *
 * @param res Express response object
 * @param data Response payload
 * @param message Optional human-readable success message
 * @param statusCode HTTP status code (defaults to 200)
 * @param meta Optional metadata object
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200,
  meta?: ApiResponseSuccess<T>["meta"]
): Response {
  const payload: ApiResponseSuccess<T> = {
    success: true,
    data,
    ...(message ? { message } : {}),
    ...(meta ? { meta } : {}),
  };

  return res.status(statusCode).json(payload);
}

/**
 * Sends a standardized paginated response with calculated pagination metadata.
 *
 * @param res Express response object
 * @param data Array of records for the current page
 * @param pagination Pagination configuration (page, limit, total, optional sort and order)
 * @param message Optional human-readable message
 * @param statusCode HTTP status code (defaults to 200)
 */
export function sendPaginated<T>(
  res: Response,
  data: T[],
  pagination: PaginationOptions,
  message?: string,
  statusCode = 200
): Response {
  const page = Math.max(1, pagination.page);
  const limit = Math.max(1, pagination.limit);
  const total = Math.max(0, pagination.total);
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1 && totalPages > 0;

  const meta: PaginationMeta = {
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    hasPrevPage,
    ...(pagination.sort ? { sort: pagination.sort } : {}),
    ...(pagination.order ? { order: pagination.order } : {}),
    timestamp: new Date().toISOString(),
  };

  const payload: ApiResponseSuccess<T[]> = {
    success: true,
    data,
    ...(message ? { message } : {}),
    meta,
  };

  return res.status(statusCode).json(payload);
}
