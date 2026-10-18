import { Router } from "express";
import {
  createReviewHandler,
  getDoctorReviewsHandler,
} from "../controllers/review.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { UserRole } from "../types/models.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  createReviewSchema,
  doctorReviewParamsSchema,
  listDoctorReviewsQuerySchema,
} from "../validators/review.validator.js";

export const reviewRouter = Router();

/**
 * POST /api/v1/reviews
 * Submits a verified review for a completed appointment.
 * Auth: Role PATIENT only.
 * Source: docs/api/API_CONTRACT.md Group 16.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.1.
 */
reviewRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(createReviewSchema),
  createReviewHandler
);

/**
 * GET /api/v1/reviews/doctors/:id
 * Retrieves public, sanitized reviews and aggregate ratings for a doctor with bounded pagination.
 * Auth: Public.
 * Source: docs/roadmap/MASTER_IMPLEMENTATION_ROADMAP.md Task 12.1.
 */
reviewRouter.get(
  "/doctors/:id",
  validateParams(doctorReviewParamsSchema),
  validateQuery(listDoctorReviewsQuerySchema as any),
  getDoctorReviewsHandler
);
