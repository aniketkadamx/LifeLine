import { z } from "zod";
import mongoose from "mongoose";

/**
 * Validation schema for a single ordered medication item.
 * Source: docs/api/API_CONTRACT.md Group 12.1.
 */
export const orderItemInputSchema = z
  .object({
    medicineId: z
      .string({ required_error: "Medicine ID is required" })
      .trim()
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        "medicineId must be a valid 24-character hex ObjectId"
      ),
    quantity: z
      .number({ required_error: "Item quantity is required" })
      .int("Quantity must be an integer")
      .min(1, "Quantity must be at least 1"),
  })
  .strict();

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

/**
 * Validation schema for delivery address details.
 * Source: docs/api/API_CONTRACT.md Group 12.1 & server/src/models/order.model.ts.
 */
export const deliveryAddressInputSchema = z
  .object({
    street: z.string().trim().optional(),
    city: z
      .string({ required_error: "City is required" })
      .trim()
      .min(1, "City cannot be empty"),
    state: z
      .string({ required_error: "State is required" })
      .trim()
      .min(1, "State cannot be empty"),
    postalCode: z
      .string({ required_error: "Postal code is required" })
      .trim()
      .min(1, "Postal code cannot be empty"),
    country: z
      .string({ required_error: "Country is required" })
      .trim()
      .min(1, "Country cannot be empty"),
    coordinates: z
      .array(z.number())
      .length(2, "Coordinates must be [longitude, latitude]")
      .optional(),
  })
  .strict();

export type DeliveryAddressInput = z.infer<typeof deliveryAddressInputSchema>;

/**
 * Request body validation schema for creating a new medicine order.
 * Source: docs/api/API_CONTRACT.md Group 12.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.3.
 */
export const createOrderSchema = z
  .object({
    pharmacyId: z
      .string({ required_error: "Pharmacy ID is required" })
      .trim()
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        "pharmacyId must be a valid 24-character hex ObjectId"
      ),
    items: z
      .array(orderItemInputSchema, {
        required_error: "Order items are required",
      })
      .min(1, "Order must contain at least one item")
      .refine(
        (items) => {
          const ids = items.map((i) => i.medicineId);
          return new Set(ids).size === ids.length;
        },
        { message: "Duplicate medicine items are not allowed in an order" }
      ),
    deliveryAddress: deliveryAddressInputSchema,
    prescriptionId: z
      .string()
      .trim()
      .refine(
        (val) => mongoose.Types.ObjectId.isValid(val),
        "prescriptionId must be a valid 24-character hex ObjectId"
      )
      .optional(),
    deliveryNotes: z
      .string()
      .trim()
      .max(500, "Delivery notes cannot exceed 500 characters")
      .optional(),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
