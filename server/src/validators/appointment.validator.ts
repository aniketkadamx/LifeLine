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

import { AppointmentStatus } from "../types/models.js";

/**
 * Zod validation schema for listing appointments.
 * Endpoint: GET /api/v1/appointments
 * Source: docs/api/API_CONTRACT.md Section 6.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
 */
export const listAppointmentsQuerySchema = z
  .object({
    status: z.nativeEnum(AppointmentStatus).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.string().trim().default("scheduledStart"),
    order: z.enum(["asc", "desc"]).default("desc"),
    patientId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid patient identifier format")
      .optional(),
    doctorId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid doctor identifier format")
      .optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message: "'from' date cannot be after 'to' date",
      path: ["from"],
    }
  );

export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

/**
 * Zod validation schema for appointment ID route parameter.
 * Endpoint: PATCH /api/v1/appointments/:id/*
 */
export const appointmentIdParamSchema = z
  .object({
    id: z
      .string({ required_error: "Appointment ID is required" })
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid appointment identifier format"),
  })
  .strict();

export type AppointmentIdParam = z.infer<typeof appointmentIdParamSchema>;

/**
 * Zod validation schema for appointment cancellation.
 * Endpoint: PATCH /api/v1/appointments/:id/cancel
 * Source: docs/api/API_CONTRACT.md Section 6.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
 */
export const cancelAppointmentSchema = z
  .object({
    cancellationReason: z
      .string()
      .trim()
      .min(5, "Cancellation reason must be at least 5 characters long")
      .max(500, "Cancellation reason cannot exceed 500 characters")
      .optional(),
    reason: z
      .string()
      .trim()
      .min(5, "Reason must be at least 5 characters long")
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
  })
  .strict()
  .refine((data) => Boolean(data.cancellationReason || data.reason), {
    message: "Cancellation reason is required and must be at least 5 characters long",
    path: ["cancellationReason"],
  });

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

/**
 * Zod validation schema for appointment rescheduling.
 * Endpoint: PATCH /api/v1/appointments/:id/reschedule
 * Source: docs/api/API_CONTRACT.md & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
 */
export const rescheduleAppointmentSchema = z
  .object({
    scheduledStart: z
      .string()
      .datetime({ message: "scheduledStart must be a valid ISO 8601 datetime string" })
      .optional(),
    newScheduledStart: z
      .string()
      .datetime({ message: "newScheduledStart must be a valid ISO 8601 datetime string" })
      .optional(),
    reason: z
      .string()
      .trim()
      .min(5, "Reason must be at least 5 characters long")
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
  })
  .strict()
  .refine((data) => Boolean(data.scheduledStart || data.newScheduledStart), {
    message: "Either scheduledStart or newScheduledStart must be provided",
    path: ["scheduledStart"],
  });

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
