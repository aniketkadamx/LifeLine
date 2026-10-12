import { z } from "zod";
import { BloodGroup, Gender } from "../types/models.js";

/**
 * Zod validation schema for patient emergency contact.
 */
export const emergencyContactSchema = z
  .object({
    name: z
      .string({ required_error: "Emergency contact name is required" })
      .trim()
      .min(1, "Emergency contact name cannot be empty"),
    relationship: z
      .string({ required_error: "Relationship is required" })
      .trim()
      .min(1, "Relationship cannot be empty"),
    phone: z
      .string({ required_error: "Emergency contact phone is required" })
      .trim()
      .regex(
        /^\+?[1-9]\d{1,14}$/,
        "Emergency contact phone number must be a valid E.164 format (e.g. +15551234567)"
      ),
  })
  .strict();

/**
 * Zod validation schema for updating a patient health profile (PUT /api/v1/patients/me/profile).
 * Source: docs/api/API_CONTRACT.md Section 3.2.
 */
export const updatePatientProfileSchema = z
  .object({
    dateOfBirth: z
      .string()
      .datetime({ offset: true })
      .or(
        z
          .string()
          .regex(
            /^\d{4}-\d{2}-\d{2}$/,
            "Date of birth must be a valid ISO 8601 datetime or YYYY-MM-DD date"
          )
      )
      .refine(
        (val) => !isNaN(Date.parse(val)) && new Date(val) <= new Date(),
        "Date of birth must be a valid date in the past"
      )
      .optional(),
    gender: z
      .nativeEnum(Gender, {
        errorMap: () => ({
          message: "Gender must be one of: MALE, FEMALE, OTHER",
        }),
      })
      .optional(),
    bloodGroup: z
      .nativeEnum(BloodGroup, {
        errorMap: () => ({
          message:
            "Blood group must be one of: A+, A-, B+, B-, AB+, AB-, O+, O-",
        }),
      })
      .optional(),
    allergies: z
      .array(z.string().trim().min(1, "Allergy entry cannot be empty"))
      .optional(),
    medicalConditions: z
      .array(z.string().trim().min(1, "Medical condition entry cannot be empty"))
      .optional(),
    currentMedications: z
      .array(z.string().trim().min(1, "Current medication entry cannot be empty"))
      .optional(),
    emergencyContact: emergencyContactSchema.optional(),
  })
  .strict();

export type UpdatePatientProfileInput = z.infer<
  typeof updatePatientProfileSchema
>;
