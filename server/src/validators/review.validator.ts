import { z } from "zod";

/**
 * Validation schema for creating a verified post-consultation doctor review.
 * Endpoint: POST /api/v1/reviews
 * Source: docs/api/API_CONTRACT.md Section 16.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.1.
 */
export const createReviewSchema = z
  .object({
    appointmentId: z
      .string({ required_error: "Appointment ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid appointment identifier format"),
    doctorId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid doctor identifier format")
      .optional(),
    rating: z
      .number({ required_error: "Rating is required" })
      .int("Rating must be an integer")
      .min(1, "Rating must be between 1 and 5")
      .max(5, "Rating must be between 1 and 5"),
    comment: z
      .string()
      .trim()
      .max(1000, "Review comment cannot exceed 1000 characters")
      .optional(),
  })
  .strict();

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/**
 * Route parameter validation schema for doctor review retrieval.
 * Endpoint: GET /api/v1/reviews/doctors/:id
 */
export const doctorReviewParamsSchema = z
  .object({
    id: z
      .string({ required_error: "Doctor ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid doctor identifier format"),
  })
  .strict();

export type DoctorReviewParams = z.infer<typeof doctorReviewParamsSchema>;

/**
 * Query parameter validation schema for doctor review list pagination.
 * Endpoint: GET /api/v1/reviews/doctors/:id?page=1&limit=20
 */
export const listDoctorReviewsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ListDoctorReviewsQuery = z.infer<
  typeof listDoctorReviewsQuerySchema
>;
