import { z } from "zod";
import { ConsultationType } from "../types/models.js";

/**
 * Zod validation schema for appointment reservation creation.
 * Endpoint: POST /api/v1/appointments
 * Source: docs/api/API_CONTRACT.md Section 6.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.1.
 */
export const createAppointmentSchema = z
  .object({
    doctorId: z
      .string({ required_error: "Doctor ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid doctor identifier format"),
    appointmentType: z.nativeEnum(ConsultationType, {
      errorMap: () => ({
        message:
          "Invalid appointment type. Expected 'VIDEO' | 'AUDIO' | 'CHAT' | 'IN_PERSON'",
      }),
    }),
    scheduledStart: z
      .string({ required_error: "Scheduled start time is required" })
      .datetime({ message: "scheduledStart must be a valid ISO 8601 datetime string" }),
    reason: z
      .string({ required_error: "Reason is required" })
      .trim()
      .min(5, "Reason must be at least 5 characters long")
      .max(500, "Reason cannot exceed 500 characters"),
  })
  .strict();

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * UUIDv4 validation schema for Idempotency-Key header.
 */
export const idempotencyKeyHeaderSchema = z
  .string()
  .uuid("Idempotency-Key header must be a valid UUIDv4");
