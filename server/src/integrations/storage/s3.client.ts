import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/api-error.js";

/**
 * Storage configuration credentials interface.
 */
export interface StorageCredentials {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}

/**
 * Parameters for generating a secure pre-signed PUT upload URL.
 */
export interface GenerateUploadUrlOptions {
  objectKey: string;
  contentType: string;
  expiresInSeconds?: number;
}

/**
 * Result returned upon pre-signed upload URL generation.
 */
export interface PresignedUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
  method: "PUT";
  headers: {
    "Content-Type": string;
  };
}

/**
 * Metadata retrieved from an object in cloud storage.
 */
export interface ObjectMetadataResult {
  contentLength: number;
  contentType: string;
  eTag?: string;
}

/**
 * Parameters for generating a secure pre-signed GET download URL.
 */
export interface GenerateDownloadUrlOptions {
  objectKey: string;
  expiresInSeconds?: number;
}

/**
 * Result returned upon pre-signed download URL generation.
 */
export interface PresignedDownloadUrlResult {
  downloadUrl: string;
  expiresInSeconds: number;
}

let customCredentials: Partial<StorageCredentials> | null = null;
let customS3Client: S3Client | null = null;
let s3ClientInstance: S3Client | null = null;
let mockObjectMetadataHandler:
  | ((
      key: string
    ) =>
      | Promise<ObjectMetadataResult>
      | ObjectMetadataResult)
  | null = null;

/**
 * Sets or resets custom storage credentials (primarily used for automated testing).
 * Pass null to restore environment-based credential resolution.
 */
export function setStorageCredentials(
  credentials: Partial<StorageCredentials> | null
): void {
  customCredentials = credentials;
  s3ClientInstance = null; // Invalidate cached client singleton
}

/**
 * Injects a mocked or custom S3Client instance (used for testing).
 * Pass null to restore real SDK client instantiation.
 */
export function setS3Client(client: S3Client | null): void {
  customS3Client = client;
  s3ClientInstance = null;
}

/**
 * Injects a mock metadata provider for HeadObject operations during automated testing.
 * Pass null to restore real S3 client HeadObject execution.
 */
export function setMockObjectMetadata(
  handler:
    | ((
        key: string
      ) =>
        | Promise<ObjectMetadataResult>
        | ObjectMetadataResult)
    | null
): void {
  mockObjectMetadataHandler = handler;
}

/**
 * Resolves active storage credentials from configuration or test overrides.
 * Fails safely with a 503 error if any required configuration is missing,
 * strictly preventing operations with incomplete cloud credentials.
 */
export function getStorageCredentials(): StorageCredentials {
  const bucket =
    customCredentials?.bucket !== undefined
      ? customCredentials.bucket
      : process.env.STORAGE_BUCKET || env.STORAGE_BUCKET;
  const region =
    customCredentials?.region !== undefined
      ? customCredentials.region
      : process.env.STORAGE_REGION || env.STORAGE_REGION;
  const accessKeyId =
    customCredentials?.accessKeyId !== undefined
      ? customCredentials.accessKeyId
      : process.env.STORAGE_ACCESS_KEY || env.STORAGE_ACCESS_KEY;
  const secretAccessKey =
    customCredentials?.secretAccessKey !== undefined
      ? customCredentials.secretAccessKey
      : process.env.STORAGE_SECRET_KEY || env.STORAGE_SECRET_KEY;
  const endpoint =
    customCredentials?.endpoint !== undefined
      ? customCredentials.endpoint
      : process.env.STORAGE_ENDPOINT || env.STORAGE_ENDPOINT;
  const forcePathStyle =
    customCredentials?.forcePathStyle !== undefined
      ? customCredentials.forcePathStyle
      : false;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new AppError(
      503,
      "STORAGE_CONFIG_ERROR",
      "Object storage provider configuration is incomplete: STORAGE_BUCKET, STORAGE_REGION, STORAGE_ACCESS_KEY, and STORAGE_SECRET_KEY must be configured"
    );
  }

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint: endpoint || undefined,
    forcePathStyle,
  };
}

/**
 * Retrieves the initialized S3Client SDK singleton.
 */
export function getS3Client(): S3Client {
  if (customS3Client) {
    return customS3Client;
  }

  if (s3ClientInstance) {
    return s3ClientInstance;
  }

  const credentials = getStorageCredentials();

  s3ClientInstance = new S3Client({
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
    endpoint: credentials.endpoint,
    forcePathStyle: credentials.forcePathStyle,
  });

  return s3ClientInstance;
}

/**
 * Generates a cryptographically signed S3 pre-signed PUT URL with a 10-minute expiration.
 *
 * Security Guarantees:
 * - Scoped strictly to the configured private bucket (zero public read access).
 * - Cryptographically binds the exact Content-Type via signableHeaders.
 * - Expires in exactly 600 seconds (10 minutes).
 * - Never grants public ACLs or read permissions.
 * - Never prints credentials or signed URLs in error logs.
 *
 * @param options - Upload parameters (objectKey, contentType, expiresInSeconds)
 * @returns PresignedUploadUrlResult containing uploadUrl, storageKey, headers, and expiry
 */
export async function generatePresignedUploadUrl(
  options: GenerateUploadUrlOptions
): Promise<PresignedUploadUrlResult> {
  const { objectKey, contentType } = options;

  if (!objectKey || typeof objectKey !== "string" || !objectKey.trim()) {
    throw AppError.badRequest("Storage object key is required", "BAD_REQUEST");
  }

  if (!contentType || typeof contentType !== "string" || !contentType.trim()) {
    throw AppError.badRequest("Content-Type is required for upload signing", "BAD_REQUEST");
  }

  const credentials = getStorageCredentials();
  const client = getS3Client();
  const expiresIn = options.expiresInSeconds ?? 600; // 10 minutes default

  try {
    const command = new PutObjectCommand({
      Bucket: credentials.bucket,
      Key: objectKey.trim(),
      ContentType: contentType.trim(),
      // Strictly NO ACL: "public-read" - bucket policies enforce server-signed access only
    });

    const uploadUrl = await getSignedUrl(client, command, {
      expiresIn,
      signableHeaders: new Set(["content-type", "host"]),
    });

    return {
      uploadUrl,
      storageKey: objectKey.trim(),
      expiresInSeconds: expiresIn,
      method: "PUT",
      headers: {
        "Content-Type": contentType.trim(),
      },
    };
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    const message =
      error instanceof Error ? error.message : "Provider failure";
    throw new AppError(
      503,
      "STORAGE_PROVIDER_ERROR",
      `Failed to generate object storage upload URL: ${message}`
    );
  }
}

/**
 * Retrieves the object's actual metadata (ContentLength, ContentType) from cloud storage
 * via a HeadObject operation, verifying that the file was uploaded and confirming its actual properties.
 *
 * Security Guarantees:
 * - Confirms object actually exists in the private bucket before database persistence.
 * - Inspects actual ContentLength and ContentType from S3 without downloading file bytes into memory.
 * - Fails safely with 404 if object does not exist.
 *
 * @param objectKey Storage object key
 * @returns ObjectMetadataResult containing verified contentLength and contentType
 */
export async function getObjectMetadata(
  objectKey: string
): Promise<ObjectMetadataResult> {
  if (!objectKey || typeof objectKey !== "string" || !objectKey.trim()) {
    throw AppError.badRequest("Storage object key is required", "BAD_REQUEST");
  }

  if (mockObjectMetadataHandler) {
    return await mockObjectMetadataHandler(objectKey.trim());
  }

  const credentials = getStorageCredentials();
  const client = getS3Client();

  try {
    const command = new HeadObjectCommand({
      Bucket: credentials.bucket,
      Key: objectKey.trim(),
    });

    const response = await client.send(command);

    return {
      contentLength: response.ContentLength ?? 0,
      contentType: response.ContentType || "application/octet-stream",
      eTag: response.ETag,
    };
  } catch (error: any) {
    if (error instanceof AppError) {
      throw error;
    }
    if (
      error?.name === "NotFound" ||
      error?.name === "NoSuchKey" ||
      error?.$metadata?.httpStatusCode === 404
    ) {
      throw new AppError(
        404,
        "STORAGE_OBJECT_NOT_FOUND",
        "Uploaded object not found in storage bucket"
      );
    }
    const message = error instanceof Error ? error.message : "Provider failure";
    throw new AppError(
      503,
      "STORAGE_PROVIDER_ERROR",
      `Failed to retrieve object metadata: ${message}`
    );
  }
}

/**
 * Generates a cryptographically signed S3 pre-signed GET URL with a 15-minute expiration (900 seconds).
 *
 * Security Guarantees:
 * - Scoped strictly to the configured private bucket.
 * - Expires in exactly 900 seconds (15 minutes) per AUTHORIZATION_MATRIX.md Section 4.
 * - Never returns public read URLs or cloud credentials.
 * - Never logs the signed URL.
 *
 * @param options - Download parameters (objectKey, expiresInSeconds)
 * @returns PresignedDownloadUrlResult containing downloadUrl and expiresInSeconds
 */
export async function generatePresignedDownloadUrl(
  options: GenerateDownloadUrlOptions
): Promise<PresignedDownloadUrlResult> {
  const { objectKey } = options;

  if (!objectKey || typeof objectKey !== "string" || !objectKey.trim()) {
    throw AppError.badRequest("Storage object key is required", "BAD_REQUEST");
  }

  const credentials = getStorageCredentials();
  const client = getS3Client();
  const expiresIn = options.expiresInSeconds ?? 900; // Exactly 15 minutes (900 seconds)

  try {
    const command = new GetObjectCommand({
      Bucket: credentials.bucket,
      Key: objectKey.trim(),
    });

    const downloadUrl = await getSignedUrl(client, command, {
      expiresIn,
    });

    return {
      downloadUrl,
      expiresInSeconds: expiresIn,
    };
  } catch (error: unknown) {
    if (error instanceof AppError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Provider failure";
    throw new AppError(
      503,
      "STORAGE_PROVIDER_ERROR",
      `Failed to generate object storage download URL: ${message}`
    );
  }
}
