import { z } from "zod";
import {
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
} from "../types/models.js";

/**
 * Validation schema for PATCH /api/v1/admin/doctors/:id/verify
 * Source: docs/api/API_CONTRACT.md Section 18.3 & docs/api/STATE_MACHINES.md Section 6.
 *
 * Requirements:
 * - Status must be one of: APPROVED_VERIFIED, REJECTED, INFO_REQUESTED.
 * - reviewNotes must be a string with minimum 5 characters.
 * - Strict schema rejects unknown or mass-assigned properties.
 */
export const verifyDoctorSchema = z
  .object({
    status: z.enum(
      [
        DoctorVerificationStatus.APPROVED_VERIFIED,
        DoctorVerificationStatus.REJECTED,
        DoctorVerificationStatus.INFO_REQUESTED,
      ],
      {
        required_error: "Verification status decision is required",
        invalid_type_error:
          "Status must be one of: APPROVED_VERIFIED, REJECTED, INFO_REQUESTED",
      }
    ),
    reviewNotes: z
      .string({ required_error: "Review notes are required" })
      .min(5, "Review notes must be at least 5 characters long")
      .trim(),
  })
  .strict();

export type VerifyDoctorInput = z.infer<typeof verifyDoctorSchema>;

/**
 * Validation schema for PATCH /api/v1/admin/pharmacies/:id/verify
 * Source: docs/api/STATE_MACHINES.md Section 7.
 *
 * Requirements:
 * - Status must be one of: APPROVED_VERIFIED, REJECTED, LICENSE_VERIFYING.
 *   (Note: Pharmacy verification does not support INFO_REQUESTED in its state machine).
 * - reviewNotes must be a string with minimum 5 characters.
 * - Strict schema rejects unknown or mass-assigned properties.
 */
export const verifyPharmacySchema = z
  .object({
    status: z.enum(
      [
        PharmacyVerificationStatus.APPROVED_VERIFIED,
        PharmacyVerificationStatus.REJECTED,
        PharmacyVerificationStatus.LICENSE_VERIFYING,
      ],
      {
        required_error: "Verification status decision is required",
        invalid_type_error:
          "Status must be one of: APPROVED_VERIFIED, REJECTED, LICENSE_VERIFYING",
      }
    ),
    reviewNotes: z
      .string({ required_error: "Review notes are required" })
      .min(5, "Review notes must be at least 5 characters long")
      .trim(),
  })
  .strict();

export type VerifyPharmacyInput = z.infer<typeof verifyPharmacySchema>;
