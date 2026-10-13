import { z } from "zod";

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
