import { z } from "zod";
import mongoose from "mongoose";
import { DosageForm } from "../types/models.js";

/**
 * Route parameter validation schema for pharmacy identifier in inventory routes.
 * Supports both literal "me" and 24-hex ObjectId.
 */
export const pharmacyIdParamSchema = z.object({
  id: z
    .string({ required_error: "Pharmacy ID is required" })
    .trim()
    .refine(
      (val) => val === "me" || mongoose.Types.ObjectId.isValid(val),
      "Pharmacy identifier must be 'me' or a valid 24-character hex ObjectId"
    ),
});

export type PharmacyIdParam = z.infer<typeof pharmacyIdParamSchema>;

/**
 * Route parameter validation schema for inventory item operations.
 */
export const inventoryIdParamSchema = z.object({
  id: z
    .string({ required_error: "Pharmacy ID is required" })
    .trim()
    .refine(
      (val) => val === "me" || mongoose.Types.ObjectId.isValid(val),
      "Pharmacy identifier must be 'me' or a valid 24-character hex ObjectId"
    ),
  inventoryId: z
    .string({ required_error: "Inventory ID is required" })
    .trim()
    .refine(
      (val) => mongoose.Types.ObjectId.isValid(val),
      "inventoryId must be a valid 24-character hex ObjectId"
    ),
});

export type InventoryIdParam = z.infer<typeof inventoryIdParamSchema>;

/**
 * Validation schema for adding a medicine to pharmacy stock.
 * Source: docs/api/API_CONTRACT.md Group 11 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
export const createInventorySchema = z
  .object({
    medicineId: z
      .string({ required_error: "Medicine ID is required" })
      .trim()
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        "medicineId must be a valid 24-character hex ObjectId"
      ),
    quantity: z
      .number({ required_error: "Stock quantity is required" })
      .int("Stock quantity must be an integer")
      .min(0, "Stock quantity cannot be negative"),
    price: z
      .number({ required_error: "Selling price is required" })
      .min(0.01, "Selling price must be at least 0.01"),
    batchNumber: z
      .string()
      .trim()
      .min(1, "Batch number cannot be empty")
      .max(100, "Batch number cannot exceed 100 characters")
      .optional(),
    expiryDate: z
      .string()
      .datetime({ message: "expiryDate must be a valid ISO 8601 date string" })
      .optional(),
    isAvailable: z.boolean().optional().default(true),
    lowStockThreshold: z
      .number()
      .int("Low stock threshold must be an integer")
      .min(0, "Low stock threshold cannot be negative")
      .optional()
      .default(10),
    reorderQuantity: z
      .number()
      .int("Reorder quantity must be an integer")
      .min(0, "Reorder quantity cannot be negative")
      .optional()
      .default(50),
  })
  .strict();

export type CreateInventoryInput = z.infer<typeof createInventorySchema>;

/**
 * Validation schema for updating inventory stock, price, batch, and expiry.
 * Source: docs/api/API_CONTRACT.md Group 11.3.
 */
export const updateInventorySchema = z
  .object({
    quantity: z
      .number()
      .int("Stock quantity must be an integer")
      .min(0, "Stock quantity cannot be negative")
      .optional(),
    price: z
      .number()
      .min(0.01, "Selling price must be at least 0.01")
      .optional(),
    batchNumber: z
      .string()
      .trim()
      .min(1, "Batch number cannot be empty")
      .max(100, "Batch number cannot exceed 100 characters")
      .optional(),
    expiryDate: z
      .string()
      .datetime({ message: "expiryDate must be a valid ISO 8601 date string" })
      .optional(),
    isAvailable: z.boolean().optional(),
    lowStockThreshold: z
      .number()
      .int("Low stock threshold must be an integer")
      .min(0, "Low stock threshold cannot be negative")
      .optional(),
    reorderQuantity: z
      .number()
      .int("Reorder quantity must be an integer")
      .min(0, "Reorder quantity cannot be negative")
      .optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one inventory field must be provided for update"
  );

export type UpdateInventoryInput = z.infer<typeof updateInventorySchema>;

/**
 * Validation schema for public pharmacy inventory discovery query parameters.
 * Source: docs/api/API_CONTRACT.md Group 11.2.
 */
export const publicInventoryQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .min(1, "Search term cannot be empty")
      .max(100, "Search term cannot exceed 100 characters")
      .optional(),
    medicineId: z
      .string()
      .trim()
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        "medicineId must be a valid 24-character hex ObjectId"
      )
      .optional(),
    dosageForm: z
      .nativeEnum(DosageForm, {
        errorMap: () => ({
          message: `Dosage form must be one of: ${Object.values(DosageForm).join(", ")}`,
        }),
      })
      .optional(),
    category: z
      .string()
      .trim()
      .min(1, "Category cannot be empty")
      .max(100, "Category cannot exceed 100 characters")
      .optional(),
    inStockOnly: z
      .preprocess((val) => {
        if (val === "true" || val === true) return true;
        if (val === "false" || val === false) return false;
        return val;
      }, z.boolean({ invalid_type_error: "inStockOnly must be a boolean" }))
      .optional()
      .default(true),
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
      .enum(["price", "quantity", "createdAt", "updatedAt"], {
        errorMap: () => ({
          message: "sort must be one of: price, quantity, createdAt, updatedAt",
        }),
      })
      .default("createdAt"),
    order: z
      .enum(["asc", "desc"], {
        errorMap: () => ({ message: "order must be one of: asc, desc" }),
      })
      .default("desc"),
  })
  .strict();

export type PublicInventoryQuery = z.infer<typeof publicInventoryQuerySchema>;
