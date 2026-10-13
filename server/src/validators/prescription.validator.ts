import { z } from "zod";
import mongoose from "mongoose";
import { MedicineRoute } from "../types/models.js";

/**
 * Validation schema for individual prescribed medication items.
 * Preserves point-in-time snapshot of the prescribed drug regimen.
 * Source: docs/api/API_CONTRACT.md Group 9.1.
 */
export const prescriptionMedicineItemSchema = z.object({
  medicineId: z
    .string({ required_error: "Medicine ID is required" })
    .trim()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "medicineId must be a valid 24-character hex ObjectId",
    }),
  medicineName: z
    .string({ required_error: "Medicine name is required" })
    .trim()
    .min(1, "Medicine name cannot be empty")
    .max(200, "Medicine name cannot exceed 200 characters"),
  dosage: z
    .string({ required_error: "Dosage is required (e.g., '500mg')" })
    .trim()
    .min(1, "Dosage cannot be empty")
    .max(100, "Dosage string cannot exceed 100 characters"),
  frequency: z
    .string({ required_error: "Frequency instructions are required (e.g., '1-0-1 (After food)')" })
    .trim()
    .min(1, "Frequency cannot be empty")
    .max(100, "Frequency string cannot exceed 100 characters"),
  durationDays: z
    .number({ required_error: "Duration in days is required" })
    .int("durationDays must be an integer")
    .min(1, "Duration must be at least 1 day")
    .max(365, "Duration cannot exceed 365 days"),
  quantity: z
    .number()
    .int("quantity must be an integer")
    .min(1, "Quantity must be at least 1")
    .default(1),
  route: z
    .nativeEnum(MedicineRoute, {
      errorMap: () => ({
        message: `Route must be one of: ${Object.values(MedicineRoute).join(", ")}`,
      }),
    })
    .default(MedicineRoute.ORAL),
  specialInstructions: z
    .string()
    .trim()
    .max(500, "Special instructions cannot exceed 500 characters")
    .optional(),
});

export type PrescriptionMedicineItemInput = z.infer<
  typeof prescriptionMedicineItemSchema
>;

/**
 * Request validation schema for issuing a digital prescription.
 * Endpoint: POST /api/v1/prescriptions
 * Role: DOCTOR (VERIFIED).
 * Source: docs/api/API_CONTRACT.md Group 9.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.3.
 */
export const issuePrescriptionSchema = z
  .object({
    appointmentId: z
      .string({ required_error: "Appointment ID is required" })
      .trim()
      .refine((val) => mongoose.Types.ObjectId.isValid(val), {
        message: "appointmentId must be a valid 24-character hex ObjectId",
      }),
    consultationId: z
      .string()
      .trim()
      .refine((val) => mongoose.Types.ObjectId.isValid(val), {
        message: "consultationId must be a valid 24-character hex ObjectId",
      })
      .optional(),
    diagnosis: z
      .string({ required_error: "Clinical diagnosis is required" })
      .trim()
      .min(3, "Diagnosis must be at least 3 characters long")
      .max(500, "Diagnosis cannot exceed 500 characters"),
    medicines: z
      .array(prescriptionMedicineItemSchema, {
        required_error: "Medicines list is required",
      })
      .min(1, "Prescription must contain at least one medicine item")
      .max(50, "Prescription cannot contain more than 50 medicine items"),
    additionalNotes: z
      .string()
      .trim()
      .max(1000, "Additional notes cannot exceed 1000 characters")
      .optional(),
  })
  .strict(); // Disallows client-supplied doctorId, patientId, status, issuedAt, expiresAt, etc.

export type IssuePrescriptionInput = z.infer<typeof issuePrescriptionSchema>;

/**
 * Route parameter validation schema for prescription lookups.
 */
export const prescriptionIdParamSchema = z.object({
  id: z
    .string({ required_error: "Prescription ID is required" })
    .trim()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "Prescription ID must be a valid 24-character hex ObjectId",
    }),
});

export type PrescriptionIdParam = z.infer<typeof prescriptionIdParamSchema>;
