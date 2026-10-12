import { z } from "zod";

/**
 * Zod validation schema for pharmacy physical address.
 */
export const pharmacyAddressSchema = z
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
 * Zod validation schema for pharmacy opening hours.
 */
export const openingHoursSchema = z
  .object({
    openTime: z
      .string({ required_error: "Open time is required" })
      .trim()
      .regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, "Open time must be in HH:mm format (e.g. 08:00)"),
    closeTime: z
      .string({ required_error: "Close time is required" })
      .trim()
      .regex(/^([01]\d|2[0-3]):?([0-5]\d)$/, "Close time must be in HH:mm format (e.g. 22:00)"),
    closedDays: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

/**
 * Zod validation schema for updating pharmacy self-service profile details.
 * Endpoint: PUT/PATCH /api/v1/pharmacies/me/profile.
 * Rejects protected verification, license, rating, and review fields via .strict().
 */
export const updatePharmacyProfileSchema = z
  .object({
    pharmacyName: z
      .string()
      .trim()
      .min(2, "Pharmacy name must be at least 2 characters long")
      .optional(),
    ownerName: z
      .string()
      .trim()
      .min(2, "Owner name must be at least 2 characters long")
      .optional(),
    address: pharmacyAddressSchema.optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{1,14}$/, "Phone number must be a valid E.164 format")
      .optional(),
    email: z
      .string()
      .trim()
      .email("Invalid email format")
      .optional(),
    openingHours: openingHoursSchema.optional(),
    deliveryAvailable: z.boolean().optional(),
    serviceArea: z
      .array(z.string().trim().min(1, "Service area entry cannot be empty"))
      .optional(),
  })
  .strict();

export type UpdatePharmacyProfileInput = z.infer<
  typeof updatePharmacyProfileSchema
>;

/**
 * Zod validation schema for pharmacy license document upload item.
 */
export const pharmacyLicenseDocumentItemSchema = z
  .object({
    documentType: z.enum(
      ["PHARMACY_LICENSE", "GST_CERTIFICATE", "ADDRESS_PROOF", "OTHER"],
      {
        errorMap: () => ({
          message:
            "Document type must be one of: PHARMACY_LICENSE, GST_CERTIFICATE, ADDRESS_PROOF, OTHER",
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
 * Zod validation schema for submitting pharmacy license documents.
 * Endpoint: POST /api/v1/pharmacies/me/license.
 * Source: docs/api/STATE_MACHINES.md Section 7.
 */
export const submitPharmacyLicenseSchema = z
  .object({
    licenseNumber: z
      .string({ required_error: "Retail drug license number is required" })
      .trim()
      .min(5, "License number must be at least 5 characters long"),
    documents: z
      .array(pharmacyLicenseDocumentItemSchema, {
        required_error: "Documents array is required",
      })
      .min(1, "At least one verification document is required"),
  })
  .strict();

export type SubmitPharmacyLicenseInput = z.infer<
  typeof submitPharmacyLicenseSchema
>;
