import mongoose from "mongoose";
import { AuditLog } from "../models/audit-log.model.js";
import { AuditAction, type IAuditLog } from "../types/models.js";

/**
 * Data Transfer Object for creating an audit log entry.
 */
export interface AuditLogDto {
  actorId?: string | mongoose.Types.ObjectId;
  actorRole: "PATIENT" | "DOCTOR" | "PHARMACY" | "ADMIN" | "SYSTEM";
  action: AuditAction | string;
  resourceType: string;
  resourceId: string;
  patientId?: string | mongoose.Types.ObjectId;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  status?: "SUCCESS" | "FAILURE";
}

/**
 * Set of sensitive property names (normalized lowercase, alphanumeric only)
 * that must NEVER be persisted in audit log metadata.
 */
const SENSITIVE_PATTERNS = new Set([
  "password",
  "passwordhash",
  "pass",
  "accesstoken",
  "refreshtoken",
  "token",
  "jwt",
  "authorization",
  "cookie",
  "cookies",
  "otp",
  "code",
  "verificationcode",
  "deliveryotp",
  "secret",
  "clientsecret",
  "keysecret",
  "razorpaysignature",
  "providersignature",
  "signature",
  "medicalreportcontent",
  "rawcontent",
  "filecontent",
  "filebuffer",
  "buffer",
  "diagnosisdocument",
  "rawprescription",
  "cvv",
  "cardnumber",
]);

/**
 * Checks if a key name matches or contains any known sensitive credential patterns.
 */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_PATTERNS.has(normalized)) {
    return true;
  }

  const sensitiveSubstrings = [
    "password",
    "token",
    "secret",
    "cookie",
    "auth",
    "jwt",
    "otp",
    "signature",
    "medicalreport",
    "rawcontent",
    "filebuffer",
    "filecontent",
    "cvv",
    "cardnumber",
  ];

  return sensitiveSubstrings.some((sub) => normalized.includes(sub));
}

/**
 * Asynchronous, fail-safe Audit Logging Service.
 * Persists non-repudiable audit trails to the auditLogs collection.
 *
 * Guarantees:
 * 1. Append-only: No update or deletion capabilities are exposed.
 * 2. Fail-safe: Audit failures never crash or reject into the business transaction.
 * 3. Security: Metadata is deeply sanitized against credentials, tokens, and raw clinical files.
 */
export class AuditLogService {
  /**
   * Deeply sanitizes metadata to strip all sensitive authentication credentials,
   * tokens, secrets, and raw medical document payloads.
   */
  public sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== "object") {
      return undefined;
    }

    const sanitizeValue = (val: unknown, depth = 0): unknown => {
      if (depth > 5 || val === null || val === undefined) {
        return val;
      }

      if (Array.isArray(val)) {
        return val.map((item) => sanitizeValue(item, depth + 1));
      }

      if (typeof val === "object" && !(val instanceof Date) && !(val instanceof mongoose.Types.ObjectId)) {
        const cleanedObj: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          if (!isSensitiveKey(k)) {
            cleanedObj[k] = sanitizeValue(v, depth + 1);
          }
        }
        return cleanedObj;
      }

      return val;
    };

    const sanitized = sanitizeValue(metadata) as Record<string, unknown>;
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  /**
   * Persists an audit log entry asynchronously.
   * Never throws into the business logic if database persistence fails.
   */
  public async log(dto: AuditLogDto): Promise<IAuditLog | null> {
    try {
      // Unauthenticated request guard: Do not invent fake actor identities
      if (!dto.actorId) {
        return null;
      }

      // Format actor and patient ObjectIds safely
      const actorObjectId =
        typeof dto.actorId === "string" ? new mongoose.Types.ObjectId(dto.actorId) : dto.actorId;

      const patientObjectId = dto.patientId
        ? typeof dto.patientId === "string"
          ? new mongoose.Types.ObjectId(dto.patientId)
          : dto.patientId
        : undefined;

      // Deeply sanitize metadata
      const sanitizedMetadata = this.sanitizeMetadata(dto.metadata);

      // Persist to MongoDB via the existing AuditLog model
      const auditRecord = await AuditLog.create({
        actorId: actorObjectId,
        actorRole: dto.actorRole,
        action: dto.action,
        resourceType: dto.resourceType,
        resourceId: String(dto.resourceId),
        patientId: patientObjectId,
        ipAddress: dto.ipAddress,
        userAgent: dto.userAgent,
        metadata: sanitizedMetadata,
        status: dto.status || "SUCCESS",
      });

      return auditRecord;
    } catch (error) {
      // Fail-safe: Log error internally without exposing it or crashing callers
      console.error(
        "[AuditLogService] Failed to record audit log:",
        error instanceof Error ? error.message : "Unknown error"
      );
      return null;
    }
  }
}

export const auditLogService = new AuditLogService();
