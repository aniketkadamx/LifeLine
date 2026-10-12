import { z } from "zod";
import { ConsultationType } from "../types/models.js";

/**
 * Zod validation schema for clinic address.
 */
export const clinicAddressSchema = z
  .object({
    street: z.string().trim().optional(),
    city: z.string({ required_error: "City is required" }).trim().min(1, "City is required"),
    state: z.string({ required_error: "State is required" }).trim().min(1, "State is required"),
    postalCode: z
      .string({ required_error: "Postal code is required" })
      .trim()
      .min(1, "Postal code is required"),
    country: z
      .string({ required_error: "Country is required" })
      .trim()
      .min(1, "Country is required"),
    coordinates: z.tuple([z.number(), z.number()]).optional(),
  })
  .strict();

/**
 * Zod validation schema for doctor verification document upload item.
 * Source: docs/api/API_CONTRACT.md Section 4.3.
 */
export const verificationDocumentItemSchema = z
  .object({
    documentType: z.enum(
      ["MEDICAL_LICENSE", "DEGREE_CERTIFICATE", "GOVERNMENT_ID"],
      {
        errorMap: () => ({
          message:
            "Document type must be one of: MEDICAL_LICENSE, DEGREE_CERTIFICATE, GOVERNMENT_ID",
        }),
      }
    ),
    fileKey: z
      .string({ required_error: "fileKey is required" })
      .trim()
      .min(1, "fileKey cannot be empty"),
  })
  .strict();

/**
 * Zod validation schema for submitting doctor verification documents.
 * Endpoint: POST /api/v1/doctors/me/verification-documents.
 * Source: docs/api/API_CONTRACT.md Section 4.3.
 */
export const submitVerificationDocumentsSchema = z
  .object({
    registrationNumber: z
      .string({ required_error: "Medical registration license number is required" })
      .trim()
      .min(5, "Registration number must be at least 5 characters long"),
    registrationCouncil: z
      .string({ required_error: "Medical registration council is required" })
      .trim()
      .min(3, "Registration council must be at least 3 characters long"),
    qualifications: z
      .array(z.string().trim().min(1, "Qualification entry cannot be empty"), {
        required_error: "Qualifications array is required",
      })
      .min(1, "At least one qualification is required"),
    documents: z
      .array(verificationDocumentItemSchema, {
        required_error: "Documents array is required",
      })
      .min(1, "At least one verification document is required"),
  })
  .strict();

export type SubmitVerificationDocumentsInput = z.infer<
  typeof submitVerificationDocumentsSchema
>;

/**
 * Zod validation schema for updating doctor self-service profile details.
 * Endpoint: PUT/PATCH /api/v1/doctors/me/profile.
 * Rejects protected verification, review, and rating fields via .strict().
 */
export const updateDoctorProfileSchema = z
  .object({
    specialization: z
      .string()
      .trim()
      .min(2, "Specialization must be at least 2 characters long")
      .optional(),
    experienceYears: z
      .number()
      .int()
      .min(0, "Experience years cannot be negative")
      .optional(),
    qualifications: z
      .array(z.string().trim().min(1, "Qualification entry cannot be empty"))
      .min(1, "Qualifications array must contain at least one qualification")
      .optional(),
    clinicName: z.string().trim().min(1).optional(),
    clinicAddress: clinicAddressSchema.optional(),
    languages: z
      .array(z.string().trim().min(1, "Language entry cannot be empty"))
      .optional(),
    consultationFee: z
      .number()
      .min(0, "Consultation fee cannot be negative")
      .optional(),
    consultationTypes: z
      .array(
        z.nativeEnum(ConsultationType, {
          errorMap: () => ({
            message:
              "Consultation type must be one of: VIDEO, AUDIO, CHAT, IN_PERSON",
          }),
        })
      )
      .optional(),
    bio: z
      .string()
      .trim()
      .max(2000, "Bio cannot exceed 2000 characters")
      .optional(),
  })
  .strict();

export type UpdateDoctorProfileInput = z.infer<
  typeof updateDoctorProfileSchema
>;
