import { z } from "zod";
import mongoose from "mongoose";
import { DosageForm } from "../types/models.js";

/**
 * Zod validation schema for master medicine catalog search query parameters.
 * Source: docs/api/API_CONTRACT.md Group 10.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.1.
 */
export const medicineSearchQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .min(1, "Search term cannot be empty")
      .max(100, "Search term cannot exceed 100 characters")
      .optional(),
    name: z
      .string()
      .trim()
      .min(1, "Medicine name cannot be empty")
      .max(200, "Medicine name cannot exceed 200 characters")
      .optional(),
    genericName: z
      .string()
      .trim()
      .min(1, "Generic name cannot be empty")
      .max(200, "Generic name cannot exceed 200 characters")
      .optional(),
    category: z
      .string()
      .trim()
      .min(1, "Category cannot be empty")
      .max(100, "Category cannot exceed 100 characters")
      .optional(),
    dosageForm: z
      .nativeEnum(DosageForm, {
        errorMap: () => ({
          message: `Dosage form must be one of: ${Object.values(DosageForm).join(", ")}`,
        }),
      })
      .optional(),
    prescriptionRequired: z
      .preprocess((val) => {
        if (val === "true" || val === true) return true;
        if (val === "false" || val === false) return false;
        return val;
      }, z.boolean({ invalid_type_error: "prescriptionRequired must be a boolean" }))
      .optional(),
    isActive: z
      .preprocess((val) => {
        if (val === "true" || val === true) return true;
        if (val === "false" || val === false) return false;
        return val;
      }, z.boolean({ invalid_type_error: "isActive must be a boolean" }))
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
      .default(20),
    sort: z
      .enum(
        [
          "name",
          "genericName",
          "category",
          "manufacturer",
          "createdAt",
          "updatedAt",
        ],
        {
          errorMap: () => ({
            message:
              "sort must be one of: name, genericName, category, manufacturer, createdAt, updatedAt",
          }),
        }
      )
      .default("name"),
    order: z
      .enum(["asc", "desc"], {
        errorMap: () => ({ message: "order must be one of: asc, desc" }),
      })
      .default("asc"),
  })
  .strict();

export type MedicineSearchQuery = z.infer<typeof medicineSearchQuerySchema>;

/**
 * Route parameter validation schema for medicine identifier.
 */
export const medicineIdParamSchema = z.object({
  id: z
    .string({ required_error: "Medicine ID is required" })
    .trim()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "id must be a valid 24-character hex ObjectId",
    }),
});

export type MedicineIdParam = z.infer<typeof medicineIdParamSchema>;

/**
 * Zod validation schema for creating a new master catalog medicine document.
 * Restricts creation strictly to master catalog definition fields.
 * Disallows pharmacy inventory or stock attributes.
 * Source: docs/api/API_CONTRACT.md Group 10.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.1.
 */
export const createMedicineSchema = z
  .object({
    name: z
      .string({ required_error: "Medicine name is required" })
      .trim()
      .min(1, "Medicine name cannot be empty")
      .max(200, "Medicine name cannot exceed 200 characters"),
    genericName: z
      .string({ required_error: "Generic chemical name is required" })
      .trim()
      .min(1, "Generic name cannot be empty")
      .max(200, "Generic name cannot exceed 200 characters"),
    brandName: z
      .string()
      .trim()
      .max(200, "Brand name cannot exceed 200 characters")
      .optional(),
    manufacturer: z
      .string({ required_error: "Manufacturer name is required" })
      .trim()
      .min(1, "Manufacturer cannot be empty")
      .max(200, "Manufacturer cannot exceed 200 characters"),
    dosageForm: z.nativeEnum(DosageForm, {
      errorMap: () => ({
        message: `Dosage form must be one of: ${Object.values(DosageForm).join(", ")}`,
      }),
    }),
    strength: z
      .string()
      .trim()
      .max(100, "Strength cannot exceed 100 characters")
      .optional(),
    category: z
      .string()
      .trim()
      .max(100, "Category cannot exceed 100 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .optional(),
    prescriptionRequired: z
      .boolean({
        invalid_type_error: "prescriptionRequired must be a boolean",
      })
      .default(false),
    isActive: z
      .boolean({ invalid_type_error: "isActive must be a boolean" })
      .default(true),
  })
  .strict();

export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;

/**
 * Zod validation schema for updating an existing master catalog medicine document.
 * Only supports legitimate catalog fields.
 * Rejects modifications to internal, timestamp, or pharmacy inventory fields.
 */
export const updateMedicineSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Medicine name cannot be empty")
      .max(200, "Medicine name cannot exceed 200 characters")
      .optional(),
    genericName: z
      .string()
      .trim()
      .min(1, "Generic name cannot be empty")
      .max(200, "Generic name cannot exceed 200 characters")
      .optional(),
    brandName: z
      .string()
      .trim()
      .max(200, "Brand name cannot exceed 200 characters")
      .optional(),
    manufacturer: z
      .string()
      .trim()
      .min(1, "Manufacturer cannot be empty")
      .max(200, "Manufacturer cannot exceed 200 characters")
      .optional(),
    dosageForm: z
      .nativeEnum(DosageForm, {
        errorMap: () => ({
          message: `Dosage form must be one of: ${Object.values(DosageForm).join(", ")}`,
        }),
      })
      .optional(),
    strength: z
      .string()
      .trim()
      .max(100, "Strength cannot exceed 100 characters")
      .optional(),
    category: z
      .string()
      .trim()
      .max(100, "Category cannot exceed 100 characters")
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "Description cannot exceed 2000 characters")
      .optional(),
    prescriptionRequired: z
      .boolean({
        invalid_type_error: "prescriptionRequired must be a boolean",
      })
      .optional(),
    isActive: z
      .boolean({ invalid_type_error: "isActive must be a boolean" })
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one catalog field must be provided for update"
  );

export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;
