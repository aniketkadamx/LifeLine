import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

/**
 * Registration request body schema.
 * Source: docs/api/API_CONTRACT.md Section 1.1.
 */
export const registerSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Invalid email format")
    .transform((val) => val.toLowerCase().trim()),
  password: z
    .string({ required_error: "Password is required" })
    .min(8, "Password must be at least 8 characters long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/,
      "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)"
    ),
  role: z.enum(["PATIENT", "DOCTOR", "PHARMACY"], {
    errorMap: () => ({ message: "Role must be one of: PATIENT, DOCTOR, PHARMACY" }),
  }),
  fullName: z
    .string({ required_error: "Full name is required" })
    .min(2, "Full name must be at least 2 characters long")
    .max(100, "Full name cannot exceed 100 characters")
    .transform((val) => val.trim()),
  phone: z
    .string({ required_error: "Phone number is required" })
    .regex(/^\+?[1-9]\d{1,14}$/, "Phone number must be a valid E.164 format (e.g. +15551234567)")
    .transform((val) => val.trim()),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Login request body schema.
 * Source: docs/api/API_CONTRACT.md Section 1.2.
 */
export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Invalid email format")
    .transform((val) => val.toLowerCase().trim()),
  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Express middleware helper to validate request body against a Zod schema.
 * Forwards ZodError directly to centralized error-handling middleware.
 */
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Express middleware helper to validate request query parameters against a Zod schema.
 * Replaces req.query with parsed and coerced values.
 * Forwards ZodError directly to centralized error-handling middleware.
 */
export function validateQuery<T>(schema: z.ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (error) {
      next(error);
    }
  };
}
