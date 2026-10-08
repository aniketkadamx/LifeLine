import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import mongoose from "mongoose";
import { AuditLog } from "../src/models/audit-log.model.js";
import { auditLogService, AuditLogService } from "../src/services/index.js";
import { auditMiddleware } from "../src/middlewares/index.js";
import { AuditAction } from "../src/types/models.js";

describe("Audit Logging Service & Pipeline (Task 2.3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Successful Audit Creation via Service", () => {
    it("should successfully record an audit event with all required fields", async () => {
      const actorId = new mongoose.Types.ObjectId();
      const patientId = new mongoose.Types.ObjectId();
      const resourceId = "rec_999";

      // Mock AuditLog.create to validate and return a document in-memory
      const createSpy = vi.spyOn(AuditLog, "create").mockImplementation(async (doc: any) => {
        return new AuditLog(doc);
      });

      const result = await auditLogService.log({
        actorId,
        actorRole: "DOCTOR",
        action: AuditAction.MEDICAL_RECORD_VIEWED,
        resourceType: "MedicalRecord",
        resourceId,
        patientId,
        ipAddress: "192.168.1.100",
        userAgent: "LifeLine-Web/1.0",
        metadata: {
          accessReason: "Scheduled consultation review",
          modality: "VIDEO",
        },
        status: "SUCCESS",
      });

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
      expect(result?.actorId).toEqual(actorId);
      expect(result?.actorRole).toBe("DOCTOR");
      expect(result?.action).toBe(AuditAction.MEDICAL_RECORD_VIEWED);
      expect(result?.resourceType).toBe("MedicalRecord");
      expect(result?.resourceId).toBe(resourceId);
      expect(result?.patientId).toEqual(patientId);
      expect(result?.ipAddress).toBe("192.168.1.100");
      expect(result?.userAgent).toBe("LifeLine-Web/1.0");
      expect(result?.status).toBe("SUCCESS");
      expect(result?.metadata).toEqual({
        accessReason: "Scheduled consultation review",
        modality: "VIDEO",
      });
    });

    it("should support string actorId and patientId by converting them to ObjectIds", async () => {
      const actorIdStr = new mongoose.Types.ObjectId().toString();
      const patientIdStr = new mongoose.Types.ObjectId().toString();

      vi.spyOn(AuditLog, "create").mockImplementation(async (doc: any) => {
        return new AuditLog(doc);
      });

      const result = await auditLogService.log({
        actorId: actorIdStr,
        actorRole: "ADMIN",
        action: AuditAction.DOCTOR_VERIFICATION_APPROVED,
        resourceType: "DoctorProfile",
        resourceId: "doc_123",
        patientId: patientIdStr,
      });

      expect(result).toBeDefined();
      expect(result?.actorId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(result?.patientId).toBeInstanceOf(mongoose.Types.ObjectId);
      expect(result?.actorId.toString()).toBe(actorIdStr);
    });
  });

  describe("2. Audit Record Immutability & Append-Only Guarantees", () => {
    it("should not expose update or delete methods on AuditLogService", () => {
      const service = auditLogService as any;

      expect(service.update).toBeUndefined();
      expect(service.updateOne).toBeUndefined();
      expect(service.updateMany).toBeUndefined();
      expect(service.findByIdAndUpdate).toBeUndefined();
      expect(service.findOneAndUpdate).toBeUndefined();
      expect(service.delete).toBeUndefined();
      expect(service.deleteOne).toBeUndefined();
      expect(service.deleteMany).toBeUndefined();
      expect(service.findByIdAndDelete).toBeUndefined();
      expect(service.remove).toBeUndefined();
      expect(service.patch).toBeUndefined();
    });

    it("service class should only expose log and sanitizeMetadata methods", () => {
      const publicMethods = Object.getOwnPropertyNames(AuditLogService.prototype).filter(
        (name) => name !== "constructor"
      );

      expect(publicMethods).toContain("log");
      expect(publicMethods).toContain("sanitizeMetadata");
      expect(publicMethods).toHaveLength(2);
    });
  });

  describe("3. Sensitive Metadata Sanitization", () => {
    it("should strip all sensitive authentication credentials, tokens, secrets, and raw clinical contents", () => {
      const sensitivePayload = {
        password: "SuperSecretPassword123!",
        passwordHash: "$2b$10$abcdef1234567890",
        accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_access_token",
        refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy_refresh_token",
        jwt: "bearer.jwt.token",
        authorization: "Bearer secret-auth-token-xyz",
        cookie: "session_id=abc; __Secure-refresh_token=secret",
        otp: "849201",
        medicalReportContent: "CONFIDENTIAL: Patient has acute clinical diagnosis and extensive lab results...",
        fileContent: "BINARY_RAW_MEDICAL_PDF_DATA",
        fileBuffer: "RAW_BYTES_STREAM",
        clientSecret: "rzp_test_secret_key_12345",
        signature: "crypto_signature_hash_abc",
        safeProperty: "appointment_status_update",
        safeCount: 42,
        nestedContext: {
          userNote: "Follow-up requested in 7 days",
          nestedPassword: "another_bad_password",
          nestedToken: "bad_nested_token",
        },
      };

      const sanitized = auditLogService.sanitizeMetadata(sensitivePayload);

      expect(sanitized).toBeDefined();

      // Verify safe properties are preserved
      expect(sanitized?.safeProperty).toBe("appointment_status_update");
      expect(sanitized?.safeCount).toBe(42);
      expect((sanitized?.nestedContext as any)?.userNote).toBe("Follow-up requested in 7 days");

      // Verify sensitive keys are completely absent
      expect(sanitized?.password).toBeUndefined();
      expect(sanitized?.passwordHash).toBeUndefined();
      expect(sanitized?.accessToken).toBeUndefined();
      expect(sanitized?.refreshToken).toBeUndefined();
      expect(sanitized?.jwt).toBeUndefined();
      expect(sanitized?.authorization).toBeUndefined();
      expect(sanitized?.cookie).toBeUndefined();
      expect(sanitized?.otp).toBeUndefined();
      expect(sanitized?.medicalReportContent).toBeUndefined();
      expect(sanitized?.fileContent).toBeUndefined();
      expect(sanitized?.fileBuffer).toBeUndefined();
      expect(sanitized?.clientSecret).toBeUndefined();
      expect(sanitized?.signature).toBeUndefined();
      expect((sanitized?.nestedContext as any)?.nestedPassword).toBeUndefined();
      expect((sanitized?.nestedContext as any)?.nestedToken).toBeUndefined();

      // Stringified check: None of the secret values must appear in serialized metadata
      const jsonStr = JSON.stringify(sanitized);
      expect(jsonStr).not.toContain("SuperSecretPassword123!");
      expect(jsonStr).not.toContain("CONFIDENTIAL: Patient has acute clinical diagnosis");
      expect(jsonStr).not.toContain("rzp_test_secret_key_12345");
    });

    it("should sanitize metadata when persisting through auditLogService.log()", async () => {
      let persistedMetadata: Record<string, unknown> | undefined;

      vi.spyOn(AuditLog, "create").mockImplementation(async (doc: any) => {
        persistedMetadata = doc.metadata;
        return new AuditLog(doc);
      });

      await auditLogService.log({
        actorId: new mongoose.Types.ObjectId(),
        actorRole: "ADMIN",
        action: AuditAction.USER_ACCOUNT_SUSPENDED,
        resourceType: "User",
        resourceId: "usr_555",
        metadata: {
          reason: "Terms of service violation",
          passwordHash: "should_be_stripped",
          otp: "123456",
        },
      });

      expect(persistedMetadata).toBeDefined();
      expect(persistedMetadata?.reason).toBe("Terms of service violation");
      expect(persistedMetadata?.passwordHash).toBeUndefined();
      expect(persistedMetadata?.otp).toBeUndefined();
    });
  });

  describe("4. Fail-Safe Behavior", () => {
    it("service should catch database persistence rejections and return null without throwing", async () => {
      vi.spyOn(AuditLog, "create").mockRejectedValueOnce(
        new Error("MongoNetworkError: connection timed out")
      );

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Calling log must resolve cleanly without rejecting
      let errorThrown = false;
      let result: any = null;

      try {
        result = await auditLogService.log({
          actorId: new mongoose.Types.ObjectId(),
          actorRole: "PATIENT",
          action: AuditAction.APPOINTMENT_CREATED,
          resourceType: "Appointment",
          resourceId: "apt_111",
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(false);
      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("business request should succeed even if audit logging fails during request lifecycle", async () => {
      const testApp = express();
      testApp.use(express.json());

      // Simulate an audited route
      testApp.post(
        "/api/appointments",
        (req: Request, _res: Response, next: NextFunction) => {
          // Attach mock authenticated user
          (req as any).user = {
            id: new mongoose.Types.ObjectId().toString(),
            role: "PATIENT",
          };
          next();
        },
        auditMiddleware({
          action: AuditAction.APPOINTMENT_CREATED,
          resourceType: "Appointment",
          getResourceId: () => "apt_generated_123",
        }),
        (_req: Request, res: Response) => {
          res.status(201).json({
            success: true,
            data: { appointmentId: "apt_generated_123", status: "PENDING_PAYMENT" },
            message: "Appointment created successfully",
          });
        }
      );

      // Force auditLogService.log to reject/fail
      vi.spyOn(auditLogService, "log").mockRejectedValueOnce(
        new Error("Database write locked")
      );

      const res = await request(testApp).post("/api/appointments").send();

      // Main business request must still succeed with 201 Created!
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.appointmentId).toBe("apt_generated_123");
    });
  });

  describe("5. Unauthenticated Request Handling", () => {
    it("auditLogService.log should safely return null when actorId is missing without inventing fake identities", async () => {
      const createSpy = vi.spyOn(AuditLog, "create");

      const result = await auditLogService.log({
        actorRole: "SYSTEM",
        action: AuditAction.OTHER,
        resourceType: "System",
        resourceId: "sys_01",
        // actorId is intentionally omitted
      });

      expect(result).toBeNull();
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("auditMiddleware should safely process unauthenticated requests without throwing or fabricating actor IDs", async () => {
      const testApp = express();
      testApp.use(express.json());

      const logSpy = vi.spyOn(auditLogService, "log");

      testApp.get(
        "/public/doctors",
        auditMiddleware({
          action: AuditAction.DOCTOR_PROFILE_ACCESSED,
          resourceType: "DoctorProfile",
        }),
        (_req: Request, res: Response) => {
          res.status(200).json({ success: true, data: [] });
        }
      );

      // Request without any auth headers/user
      const res = await request(testApp).get("/public/doctors");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify that no audit log was created with fake credentials
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("6. Middleware Integration with Authenticated Context", () => {
    it("should capture actor context and route metadata upon response completion", async () => {
      const testApp = express();
      testApp.use(express.json());

      const actorId = new mongoose.Types.ObjectId();
      const logSpy = vi.spyOn(auditLogService, "log").mockResolvedValue(null);

      testApp.post(
        "/api/records/:id",
        (req: Request, _res: Response, next: NextFunction) => {
          (req as any).user = {
            id: actorId.toString(),
            role: "DOCTOR",
          };
          next();
        },
        auditMiddleware({
          action: AuditAction.MEDICAL_RECORD_ACCESSED,
          resourceType: "MedicalRecord",
          getResourceId: (req) => req.params.id,
          getMetadata: (req) => ({ recordAction: "DOWNLOAD", queryParam: req.query.format }),
        }),
        (req: Request, res: Response) => {
          res.status(200).json({ success: true, data: { id: req.params.id } });
        }
      );

      const res = await request(testApp)
        .post("/api/records/rec_888?format=pdf")
        .set("x-test-client-ip", "192.168.1.50")
        .set("User-Agent", "DoctorPortal/2.0");

      expect(res.status).toBe(200);
      expect(logSpy).toHaveBeenCalledTimes(1);

      const loggedArg = logSpy.mock.calls[0][0];
      expect(loggedArg.actorId).toBe(actorId.toString());
      expect(loggedArg.actorRole).toBe("DOCTOR");
      expect(loggedArg.action).toBe(AuditAction.MEDICAL_RECORD_ACCESSED);
      expect(loggedArg.resourceType).toBe("MedicalRecord");
      expect(loggedArg.resourceId).toBe("rec_888");
      expect(loggedArg.ipAddress).toBe("192.168.1.50");
      expect(loggedArg.userAgent).toBe("DoctorPortal/2.0");
      expect(loggedArg.status).toBe("SUCCESS");
      expect(loggedArg.metadata).toEqual({ recordAction: "DOWNLOAD", queryParam: "pdf" });
    });
  });
});
