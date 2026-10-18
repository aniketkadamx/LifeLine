import { z } from "zod";
import {
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
} from "../types/models.js";

/**
 * Validation schema for filing a platform complaint or dispute.
 * Endpoint: POST /api/v1/complaints
 * Source: docs/api/API_CONTRACT.md Group 17.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.2.
 */
export const createComplaintSchema = z
  .object({
    category: z.nativeEnum(ComplaintCategory, {
      required_error: "Complaint category is required",
      invalid_type_error: "Invalid complaint category",
    }),
    subject: z
      .string()
      .trim()
      .min(3, "Subject must be at least 3 characters")
      .max(200, "Subject cannot exceed 200 characters")
      .optional(),
    title: z
      .string()
      .trim()
      .min(3, "Title must be at least 3 characters")
      .max(200, "Title cannot exceed 200 characters")
      .optional(),
    description: z
      .string({ required_error: "Complaint description is required" })
      .trim()
      .min(10, "Complaint description must be at least 10 characters")
      .max(5000, "Complaint description cannot exceed 5000 characters"),
    relatedId: z
      .string()
      .trim()
      .max(100, "Related identifier cannot exceed 100 characters")
      .optional(),
    relatedEntityId: z
      .string()
      .trim()
      .max(100, "Related entity ID cannot exceed 100 characters")
      .optional(),
    relatedEntityType: z
      .string()
      .trim()
      .max(100, "Related entity type cannot exceed 100 characters")
      .optional(),
  })
  .strict();

export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;

/**
 * Validation schema for resolving or rejecting a complaint by an administrator.
 * Endpoint: PATCH /api/v1/complaints/:id/resolve
 * Source: docs/api/API_CONTRACT.md Group 17.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.2.
 */
export const resolveComplaintSchema = z
  .object({
    status: z.enum([ComplaintStatus.RESOLVED, ComplaintStatus.REJECTED], {
      errorMap: (issue) => {
        if (issue.code === "invalid_type" && issue.received === "undefined") {
          return { message: "Status is required" };
        }
        return { message: "Status must be either RESOLVED or REJECTED" };
      },
    }),
    resolutionNotes: z
      .string({ required_error: "Resolution notes are required" })
      .trim()
      .min(5, "Resolution notes must be at least 5 characters")
      .max(2000, "Resolution notes cannot exceed 2000 characters"),
  })
  .strict();

export type ResolveComplaintInput = z.infer<typeof resolveComplaintSchema>;

/**
 * Route parameter validation schema for complaint identification.
 * Endpoint: GET /api/v1/complaints/:id, PATCH /api/v1/complaints/:id/resolve
 */
export const complaintIdParamSchema = z
  .object({
    id: z
      .string({ required_error: "Complaint ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid complaint identifier format"),
  })
  .strict();

export type ComplaintIdParam = z.infer<typeof complaintIdParamSchema>;

/**
 * Query parameter validation schema for listing complaints with pagination and filtering.
 * Endpoint: GET /api/v1/complaints
 */
export const listComplaintsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(ComplaintStatus).optional(),
    category: z.nativeEnum(ComplaintCategory).optional(),
    priority: z.nativeEnum(ComplaintPriority).optional(),
  })
  .strict();

export type ListComplaintsQuery = z.infer<typeof listComplaintsQuerySchema>;
