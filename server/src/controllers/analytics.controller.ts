import type { Request, Response, NextFunction } from "express";
import { analyticsService } from "../services/analytics.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { AnalyticsDateFilterQuery } from "../validators/analytics.validator.js";

/**
 * Controller handler: GET /api/v1/analytics/overview (and /api/v1/analytics/admin/overview)
 *
 * Retrieves high-level platform operational and financial metrics.
 * Strictly restricted to users with role ADMIN.
 *
 * Sources:
 * - docs/api/API_CONTRACT.md Group 19.1
 * - MASTER_IMPLEMENTATION_ROADMAP.md Task 12.3
 */
export async function getAdminOverviewHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const filter = req.query as unknown as AnalyticsDateFilterQuery;
    const metrics = await analyticsService.getAdminOverview(filter);

    sendSuccess(
      res,
      metrics,
      "Platform overview analytics retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: GET /api/v1/analytics/doctor (and /api/v1/analytics/doctor/earnings)
 *
 * Retrieves doctor consultation performance and earnings metrics.
 * Strictly scoped to the authenticated doctor's identity (req.user.id).
 * Client-supplied identifiers are explicitly rejected/ignored.
 *
 * Sources:
 * - docs/api/API_CONTRACT.md Group 19.2
 * - MASTER_IMPLEMENTATION_ROADMAP.md Task 12.3
 */
export async function getDoctorMetricsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const filter = req.query as unknown as AnalyticsDateFilterQuery;
    const metrics = await analyticsService.getDoctorMetrics(req.user.id, filter);

    sendSuccess(
      res,
      metrics,
      "Doctor analytics retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: GET /api/v1/analytics/pharmacy
 *
 * Retrieves pharmacy order fulfillment volume and revenue summary.
 * Strictly scoped to the authenticated pharmacy's identity (req.user.id).
 * Client-supplied identifiers are explicitly rejected/ignored.
 *
 * Sources:
 * - docs/api/API_CONTRACT.md Group 19
 * - MASTER_IMPLEMENTATION_ROADMAP.md Task 12.3
 */
export async function getPharmacyMetricsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const filter = req.query as unknown as AnalyticsDateFilterQuery;
    const metrics = await analyticsService.getPharmacyMetrics(
      req.user.id,
      filter
    );

    sendSuccess(
      res,
      metrics,
      "Pharmacy analytics retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
