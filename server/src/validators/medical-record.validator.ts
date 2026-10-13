import { z } from "zod";
import mongoose from "mongoose";
import { MedicalRecordType } from "../types/models.js";

/**
 * Maximum allowed medical file upload size: 15 MiB (15 * 1024 * 1024 bytes).
 * Source: docs/roadmap/MASTER_IMPLEMENTATION_ROADMAP.md Task 9.1 & docs/api/API_CONTRACT.md Group 8.1.
 */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15,728,640 bytes

/**
 * Supported MIME types for medical record documents and clinical imaging.
 * Source: docs/api/API_CONTRACT.md Group 8.1.
 */
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/dicom",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Canonical safe file extension mapping for validated MIME types.
 * Extensions are derived strictly from server-verified MIME types, never from user-supplied filenames.
 */
export const MIME_TO_EXTENSION_MAP: Record<AllowedMimeType, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/dicom": ".dcm",
};

/**
 * Strict regex for server-generated random UUID storage keys.
 * Format: records/<uuid>.<ext>
 */
export const STORAGE_KEY_REGEX =
  /^records\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|png|jpg|jpeg|dcm)$/;

/**
 * Request validation schema for generating a pre-signed object storage upload URL.
 * Endpoint: POST /api/v1/medical-records/upload-url
 * Role: PATIENT
 * Source: docs/api/API_CONTRACT.md Group 8.1.
 */
export const uploadUrlSchema = z.object({
  fileName: z
    .string({ required_error: "File name is required" })
    .trim()
    .min(1, "File name cannot be empty")
    .max(255, "File name cannot exceed 255 characters"),
  fileType: z.enum(ALLOWED_MIME_TYPES, {
    errorMap: () => ({
      message:
        "Unsupported file type. Allowed MIME types are: application/pdf, image/png, image/jpeg, application/dicom",
    }),
  }),
  sizeBytes: z
    .number({ required_error: "File size in bytes is required" })
    .int("File size must be an integer number of bytes")
    .positive("File size must be greater than 0")
    .max(
      MAX_FILE_SIZE_BYTES,
      `File size exceeds 15 MiB limit (maximum allowed is ${MAX_FILE_SIZE_BYTES} bytes)`
    ),
});

export type UploadUrlInput = z.infer<typeof uploadUrlSchema>;

/**
 * Request validation schema for registering medical record metadata after object upload.
 * Endpoint: POST /api/v1/medical-records
 * Role: PATIENT
 * Source: docs/api/API_CONTRACT.md Group 8.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.2.
 */
export const createMedicalRecordSchema = z.object({
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(3, "Title must be at least 3 characters long")
    .max(200, "Title cannot exceed 200 characters"),
  description: z
    .string()
    .trim()
    .max(2000, "Description cannot exceed 2000 characters")
    .optional(),
  recordType: z.nativeEnum(MedicalRecordType, {
    errorMap: () => ({
      message: `Invalid record type. Must be one of: ${Object.values(MedicalRecordType).join(", ")}`,
    }),
  }),
  storageKey: z
    .string({ required_error: "Storage key is required" })
    .trim()
    .regex(
      STORAGE_KEY_REGEX,
      "Storage key must match the server-generated format (records/<UUID>.<extension>)"
    ),
  fileName: z
    .string()
    .trim()
    .min(1, "File name cannot be empty")
    .max(255, "File name cannot exceed 255 characters")
    .optional(),
  recordDate: z
    .string()
    .datetime({ message: "recordDate must be a valid ISO 8601 UTC timestamp" })
    .or(z.date())
    .optional(),
  relatedAppointmentId: z
    .string()
    .trim()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "relatedAppointmentId must be a valid 24-character hex ObjectId",
    })
    .optional(),
});

export type CreateMedicalRecordInput = z.infer<typeof createMedicalRecordSchema>;

/**
 * Route parameter validation schema for medical record operations.
 */
export const medicalRecordIdParamSchema = z.object({
  id: z
    .string({ required_error: "Medical record ID is required" })
    .trim()
    .refine((val) => mongoose.Types.ObjectId.isValid(val), {
      message: "Medical record ID must be a valid 24-character hex ObjectId",
    }),
});

export type MedicalRecordIdParam = z.infer<typeof medicalRecordIdParamSchema>;
