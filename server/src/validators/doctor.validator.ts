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

/**
 * Validation schema for public doctor directory search and filtering query parameters.
 * Source: docs/api/API_CONTRACT.md Section 4.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 5.1.
 */
export const doctorSearchQuerySchema = z
  .object({
    search: z.string().trim().min(1, "Search query cannot be empty").optional(),
    specialization: z
      .string()
      .trim()
      .min(1, "Specialization cannot be empty")
      .optional(),
    location: z.string().trim().min(1, "Location cannot be empty").optional(),
    minExperience: z.coerce
      .number({ invalid_type_error: "minExperience must be a number" })
      .int("minExperience must be an integer")
      .min(0, "minExperience cannot be negative")
      .optional(),
    experience: z.coerce
      .number({ invalid_type_error: "experience must be a number" })
      .int("experience must be an integer")
      .min(0, "experience cannot be negative")
      .optional(),
    minRating: z.coerce
      .number({ invalid_type_error: "minRating must be a number" })
      .min(0, "minRating cannot be negative")
      .max(5, "minRating cannot exceed 5")
      .optional(),
    rating: z.coerce
      .number({ invalid_type_error: "rating must be a number" })
      .min(0, "rating cannot be negative")
      .max(5, "rating cannot exceed 5")
      .optional(),
    minFee: z.coerce
      .number({ invalid_type_error: "minFee must be a number" })
      .min(0, "minFee cannot be negative")
      .optional(),
    maxFee: z.coerce
      .number({ invalid_type_error: "maxFee must be a number" })
      .min(0, "maxFee cannot be negative")
      .optional(),
    page: z.coerce
      .number({ invalid_type_error: "page must be a number" })
      .int("page must be an integer")
      .min(1, "page must be at least 1")
      .default(1),
    limit: z.coerce
      .number({ invalid_type_error: "limit must be a number" })
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(100, "limit cannot exceed 100")
      .default(10),
    sort: z
      .enum(
        [
          "rating",
          "experience",
          "experienceYears",
          "fee",
          "consultationFee",
          "createdAt",
        ],
        {
          errorMap: () => ({
            message:
              "sort must be one of: rating, experience, experienceYears, fee, consultationFee, createdAt",
          }),
        }
      )
      .default("rating"),
    order: z
      .enum(["asc", "desc"], {
        errorMap: () => ({ message: "order must be one of: asc, desc" }),
      })
      .default("desc"),
  })
  .strict()
  .refine(
    (data) => {
      if (data.minFee !== undefined && data.maxFee !== undefined) {
        return data.minFee <= data.maxFee;
      }
      return true;
    },
    {
      message: "minFee cannot exceed maxFee",
      path: ["minFee"],
    }
  );

export type DoctorSearchQuery = z.infer<typeof doctorSearchQuerySchema>;

/**
 * Route parameter validation schema for doctor identifier.
 */
export const doctorIdParamSchema = z.object({
  id: z
    .string({ required_error: "Doctor ID is required" })
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid doctor identifier format"),
});
