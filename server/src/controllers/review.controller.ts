import type { Request, Response, NextFunction } from "express";
import { reviewService } from "../services/review.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { CreateReviewInput, ListDoctorReviewsQuery } from "../validators/review.validator.js";

/**
 * Controller handler: POST /api/v1/reviews
 *
 * Submits a verified post-consultation doctor review for an encounter.
 * Allowed only for authenticated patients who completed the encounter.
 * Source: docs/api/API_CONTRACT.md Group 16.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.1.
 */
export async function createReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const review = await reviewService.createReview(
      req.user,
      req.body as CreateReviewInput
    );

    sendSuccess(res, review, "Review submitted successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: GET /api/v1/reviews/doctors/:id
 *
 * Retrieves public, sanitized reviews and aggregate ratings for a doctor with bounded pagination.
 * Publicly accessible with deterministic sorting (newest first).
 * Source: docs/roadmap/MASTER_IMPLEMENTATION_ROADMAP.md Task 12.1.
 */
export async function getDoctorReviewsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const query = req.query as unknown as ListDoctorReviewsQuery;

    const page = query.page !== undefined ? Number(query.page) : undefined;
    const limit = query.limit !== undefined ? Number(query.limit) : undefined;

    const result = await reviewService.getDoctorReviews(id, { page, limit });

    sendSuccess(
      res,
      result.reviews,
      "Doctor reviews retrieved successfully",
      200,
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
        doctor: result.doctor,
        timestamp: new Date().toISOString(),
      }
    );
  } catch (error) {
    next(error);
  }
}
