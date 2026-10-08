import type { Request, Response, NextFunction } from "express";
import { auditLogService } from "../services/audit-log.service.js";
import { AuditAction } from "../types/models.js";

export interface AuditMiddlewareOptions {
  action: AuditAction | string;
  resourceType: string;
  getResourceId?: (req: Request) => string;
  getPatientId?: (req: Request) => string | undefined;
  getMetadata?: (req: Request, res: Response) => Record<string, unknown> | undefined;
}

/**
 * Creates an Express route middleware that asynchronously records an audit event
 * upon HTTP response completion without blocking the request loop.
 *
 * Compatible with future JWT authentication (req.user), while safely handling
 * unauthenticated requests without inventing fake identities.
 */
export function auditMiddleware(options: AuditMiddlewareOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Non-blocking asynchronous capture on response finish
    res.on("finish", () => {
      // Safely inspect for authenticated actor context if populated by current or future auth
      const user = (req as { user?: { id?: string; _id?: string; role?: string } }).user;
      const actorId = user?.id || user?._id;
      const actorRole = (user?.role || "SYSTEM") as
        | "PATIENT"
        | "DOCTOR"
        | "PHARMACY"
        | "ADMIN"
        | "SYSTEM";

      // Unauthenticated request handling: Safely do not persist or invent fake actor identities
      if (!actorId) {
        return;
      }

      const resourceId = options.getResourceId
        ? options.getResourceId(req)
        : req.params?.id || (req.body && typeof req.body === "object" ? req.body.id : undefined) || "N/A";

      const patientId = options.getPatientId
        ? options.getPatientId(req)
        : req.params?.patientId || (req.body && typeof req.body === "object" ? req.body.patientId : undefined);

      const ipAddress =
        (req.headers["x-test-client-ip"] as string) || req.ip || req.socket.remoteAddress || "127.0.0.1";
      const userAgent = (req.headers["user-agent"] as string) || undefined;
      const metadata = options.getMetadata ? options.getMetadata(req, res) : undefined;
      const status: "SUCCESS" | "FAILURE" = res.statusCode < 400 ? "SUCCESS" : "FAILURE";

      void auditLogService.log({
        actorId,
        actorRole,
        action: options.action,
        resourceType: options.resourceType,
        resourceId: String(resourceId),
        patientId,
        ipAddress,
        userAgent,
        metadata,
        status,
      });
    });

    next();
  };
}
