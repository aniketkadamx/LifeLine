import { z } from "zod";

/**
 * User self-management update schema (PATCH /api/v1/users/me).
 *
 * Strictly allows only self-service contact fields:
 * - `phone`: E.164 formatted telephone number.
 * - `avatar`: Valid image URL.
 *
 * Uses `.strict()` to reject any unexpected or privileged fields
 * (e.g. role, email, status, passwordHash, id) to prevent mass assignment.
 */
export const updateUserSchema = z
  .object({
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{1,14}$/, "Phone number must be a valid E.164 format (e.g. +15551234567)")
      .transform((val) => val.trim())
      .optional(),
    avatar: z
      .string()
      .url("Avatar must be a valid URL")
      .transform((val) => val.trim())
      .optional(),
  })
  .strict();

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
