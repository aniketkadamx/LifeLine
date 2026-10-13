import { z } from "zod";

/**
 * Route parameter validation schema for appointment ID.
 * Endpoint: POST /api/v1/consultations/:appointmentId/session
 */
export const appointmentIdParamSchema = z
  .object({
    appointmentId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid appointment identifier format"),
  })
  .strict();

export type AppointmentIdParam = z.infer<typeof appointmentIdParamSchema>;

/**
 * Route parameter validation schema for consultation ID.
 * Endpoint: GET /:id, GET /:id/token, POST /:id/end, POST /:id/notes
 */
export const consultationIdParamSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, "Invalid consultation identifier format"),
  })
  .strict();

export type ConsultationIdParam = z.infer<typeof consultationIdParamSchema>;

/**
 * Zod validation schema for submitting clinical notes and diagnosis.
 * Endpoint: POST /api/v1/consultations/:id/notes
 * Source: docs/api/API_CONTRACT.md Group 7.3 & STATE_MACHINES.md Section 2.2.
 */
export const submitClinicalNotesSchema = z
  .object({
    diagnosis: z
      .string({ required_error: "Diagnosis is required" })
      .trim()
      .min(3, "Diagnosis must be at least 3 characters long")
      .max(500, "Diagnosis cannot exceed 500 characters"),
    clinicalNotes: z
      .string({ required_error: "Clinical notes are required" })
      .trim()
      .min(5, "Clinical notes must be at least 5 characters long")
      .max(5000, "Clinical notes cannot exceed 5000 characters"),
    recommendedFollowUpDays: z
      .number({ invalid_type_error: "Recommended follow-up days must be a number" })
      .int("Recommended follow-up days must be an integer")
      .min(0, "Recommended follow-up days cannot be negative")
      .max(365, "Recommended follow-up days cannot exceed 365")
      .optional(),
  })
  .strict();

export type SubmitClinicalNotesInput = z.infer<typeof submitClinicalNotesSchema>;
