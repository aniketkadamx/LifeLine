import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, MedicalRecord, AuditLog } from "../src/models/index.js";
import { UserRole, UserStatus, AuditAction } from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  setStorageCredentials,
  setS3Client,
} from "../src/integrations/storage/s3.client.js";
import { MAX_FILE_SIZE_BYTES } from "../src/validators/medical-record.validator.js";

const TEST_STORAGE_CONFIG = {
  bucket: "lifeline-medical-records-test",
  region: "us-east-1",
  accessKeyId: "TEST_AWS_ACCESS_KEY_ID_M9",
  secretAccessKey: "TEST_AWS_SECRET_ACCESS_KEY_AT_LEAST_32_CHARS_LONG",
};

describe("Milestone 9 - Task 9.1: Secure Object Storage Client & Pre-Signed Upload URLs", () => {
  let patientUser: any;
  let patientToken: string;

  let doctorUser: any;
  let doctorToken: string;

  let pharmacyUser: any;
  let pharmacyToken: string;

  let adminUser: any;
  let adminToken: string;

  beforeAll(async () => {
    setStorageCredentials(TEST_STORAGE_CONFIG);

    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_medical_record_upload_test"
    );
    await User.syncIndexes();
    await MedicalRecord.syncIndexes();
    await AuditLog.syncIndexes();
  }, 30000);

  afterAll(async () => {
    setStorageCredentials(null);
    setS3Client(null);

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    setStorageCredentials(TEST_STORAGE_CONFIG);
    setS3Client(null);

    await User.deleteMany({});
    await MedicalRecord.deleteMany({});
    await AuditLog.deleteMany({});

    // 1. Patient User
    patientUser = await User.create({
      email: "patient.records@example.com",
      phone: "+919876540201",
      fullName: "Patient Storage Test",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patientToken = tokenService.generateAccessToken(
      patientUser._id.toString(),
      UserRole.PATIENT
    );

    // 2. Doctor User
    doctorUser = await User.create({
      email: "doctor.records@example.com",
      phone: "+919876540202",
      fullName: "Dr. Storage Test",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 3. Pharmacy User
    pharmacyUser = await User.create({
      email: "pharmacy.records@example.com",
      phone: "+919876540203",
      fullName: "Pharmacy Storage Test",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyToken = tokenService.generateAccessToken(
      pharmacyUser._id.toString(),
      UserRole.PHARMACY
    );

    // 4. Admin User
    adminUser = await User.create({
      email: "admin.records@example.com",
      phone: "+919876540204",
      fullName: "Admin Storage Test",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    adminToken = tokenService.generateAccessToken(
      adminUser._id.toString(),
      UserRole.ADMIN
    );
  });

  // =========================================================================
  // Section A: Validation Tests (1 - 6)
  // =========================================================================
  describe("A. Upload Request Validation", () => {
    it("1. A file size of exactly 15 MiB (15,728,640 bytes) is accepted", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "large-scan.pdf",
          fileType: "application/pdf",
          sizeBytes: MAX_FILE_SIZE_BYTES, // Exactly 15,728,640 bytes
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.uploadUrl).toBeDefined();
      expect(res.body.data.storageKey).toBeDefined();
    });

    it("2. A file size greater than 15 MiB returns HTTP 422 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "too-large.pdf",
          fileType: "application/pdf",
          sizeBytes: MAX_FILE_SIZE_BYTES + 1, // 15,728,641 bytes (1 byte over)
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(res.body.error.details)).toContain("File size exceeds 15 MiB limit");
    });

    it("3. Zero, negative, missing, non-integer, or non-finite sizes are rejected with HTTP 422", async () => {
      // Zero size
      const zeroRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "empty.pdf",
          fileType: "application/pdf",
          sizeBytes: 0,
        })
        .expect(422);
      expect(zeroRes.body.error.code).toBe("VALIDATION_ERROR");

      // Negative size
      const negRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "negative.pdf",
          fileType: "application/pdf",
          sizeBytes: -500,
        })
        .expect(422);
      expect(negRes.body.error.code).toBe("VALIDATION_ERROR");

      // Missing size
      const missingRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "missing-size.pdf",
          fileType: "application/pdf",
        })
        .expect(422);
      expect(missingRes.body.error.code).toBe("VALIDATION_ERROR");

      // Non-integer size (float)
      const floatRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "fractional.pdf",
          fileType: "application/pdf",
          sizeBytes: 1024.5,
        })
        .expect(422);
      expect(floatRes.body.error.code).toBe("VALIDATION_ERROR");

      // Non-finite / string size
      const strRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "string-size.pdf",
          fileType: "application/pdf",
          sizeBytes: "15MB",
        })
        .expect(422);
      expect(strRes.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("4. Unsupported executable MIME types are rejected with HTTP 422", async () => {
      const maliciousMimes = [
        "application/x-executable",
        "application/x-msdownload",
        "application/x-sh",
        "application/x-bat",
        "application/javascript",
        "application/octet-stream",
        "text/html",
      ];

      for (const badMime of maliciousMimes) {
        const res = await request(app)
          .post("/api/v1/medical-records/upload-url")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            fileName: "script.sh",
            fileType: badMime,
            sizeBytes: 1024,
          })
          .expect(422);

        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
        expect(JSON.stringify(res.body.error.details)).toContain("Unsupported file type");
      }
    });

    it("5. Unsupported arbitrary MIME types cannot receive a pre-signed URL", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "video.mp4",
          fileType: "video/mp4",
          sizeBytes: 1024 * 1024,
        })
        .expect(422);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("6. Supported PDF, documented image types, and DICOM pass validation", async () => {
      const supportedCases = [
        { type: "application/pdf", ext: ".pdf" },
        { type: "image/png", ext: ".png" },
        { type: "image/jpeg", ext: ".jpg" },
        { type: "application/dicom", ext: ".dcm" },
      ];

      for (const item of supportedCases) {
        const res = await request(app)
          .post("/api/v1/medical-records/upload-url")
          .set("Authorization", `Bearer ${patientToken}`)
          .send({
            fileName: `scan${item.ext}`,
            fileType: item.type,
            sizeBytes: 2 * 1024 * 1024,
          })
          .expect(200);

        expect(res.body.success).toBe(true);
        expect(res.body.data.uploadUrl).toBeDefined();
        expect(res.body.data.storageKey.endsWith(item.ext)).toBe(true);
        expect(res.body.data.headers["Content-Type"]).toBe(item.type);
      }
    });
  });

  // =========================================================================
  // Section B: Signing Behavior Tests (7 - 12)
  // =========================================================================
  describe("B. Pre-Signing Behavior & Key Security", () => {
    it("7. The service generates a random UUID-based server-owned object key", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "mri-report.pdf",
          fileType: "application/pdf",
          sizeBytes: 512000,
        })
        .expect(200);

      const storageKey = res.body.data.storageKey;
      // Validates format: records/<uuid>.pdf
      const uuidRegex =
        /^records\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;
      expect(uuidRegex.test(storageKey)).toBe(true);
    });

    it("8. Original filename and client-provided object keys cannot control the resulting storage key", async () => {
      const maliciousPayload = {
        fileName: "../../../etc/passwd",
        fileType: "application/pdf",
        sizeBytes: 2048,
        storageKey: "injected-custom-key/root.pdf",
        objectKey: "hacked/path/attack.pdf",
        bucket: "malicious-bucket",
      };

      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send(maliciousPayload)
        .expect(200);

      const storageKey = res.body.data.storageKey;
      expect(storageKey).not.toContain("etc/passwd");
      expect(storageKey).not.toContain("injected-custom-key");
      expect(storageKey).not.toContain("hacked/path");
      expect(storageKey.startsWith("records/")).toBe(true);
    });

    it("9. The pre-signed URL expires after exactly 600 seconds (10 minutes)", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "cbc-report.pdf",
          fileType: "application/pdf",
          sizeBytes: 1048576,
        })
        .expect(200);

      expect(res.body.data.expiresInSeconds).toBe(600);

      const parsedUrl = new URL(res.body.data.uploadUrl);
      expect(parsedUrl.searchParams.get("X-Amz-Expires")).toBe("600");
    });

    it("10. The Content-Type is cryptographically bound in the signed PUT request", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "xray.png",
          fileType: "image/png",
          sizeBytes: 3145728,
        })
        .expect(200);

      const parsedUrl = new URL(res.body.data.uploadUrl);
      const signedHeaders = parsedUrl.searchParams.get("X-Amz-SignedHeaders");
      expect(signedHeaders).toBeDefined();
      expect(signedHeaders).toContain("content-type");
    });

    it("11. Returned object key and upload headers match the generated request", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "scan.dcm",
          fileType: "application/dicom",
          sizeBytes: 4096000,
        })
        .expect(200);

      expect(res.body.data.method).toBe("PUT");
      expect(res.body.data.headers).toEqual({
        "Content-Type": "application/dicom",
      });
      expect(res.body.data.storageKey).toMatch(/^records\/[0-9a-f-]+\.dcm$/);
    });

    it("12. Storage credentials and secrets are NEVER included in the response", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "test.pdf",
          fileType: "application/pdf",
          sizeBytes: 50000,
        })
        .expect(200);

      const rawResponse = JSON.stringify(res.body);
      expect(rawResponse).not.toContain(TEST_STORAGE_CONFIG.secretAccessKey);
      expect(res.body.data.accessKeyId).toBeUndefined();
      expect(res.body.data.secretAccessKey).toBeUndefined();
    });
  });

  // =========================================================================
  // Section C: Access, Authorization & Failure Behavior (13 - 18)
  // =========================================================================
  describe("C. Access Control & Provider Failure Safety", () => {
    it("13. Unauthenticated requests are rejected with 401 AUTH_TOKEN_MISSING", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .send({
          fileName: "test.pdf",
          fileType: "application/pdf",
          sizeBytes: 10000,
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("14. Authorization enforces that only PATIENTS can request upload URLs (Doctor, Pharmacy, Admin rejected)", async () => {
      const payload = {
        fileName: "clinical-report.pdf",
        fileType: "application/pdf",
        sizeBytes: 20000,
      };

      // Doctor rejected (403)
      const docRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send(payload)
        .expect(403);
      expect(docRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Pharmacy rejected (403)
      const pharmRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .send(payload)
        .expect(403);
      expect(pharmRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Admin rejected (403)
      const adminRes = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload)
        .expect(403);
      expect(adminRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("15. Storage configuration errors produce safe 503 STORAGE_CONFIG_ERROR", async () => {
      // Invalidate credentials
      setStorageCredentials({
        bucket: "",
        region: "",
        accessKeyId: "",
        secretAccessKey: "",
      });

      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "test.pdf",
          fileType: "application/pdf",
          sizeBytes: 10000,
        })
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("STORAGE_CONFIG_ERROR");

      // Restore credentials
      setStorageCredentials(TEST_STORAGE_CONFIG);
    });

    it("16. Storage provider errors do not leak secrets or credentials into responses", async () => {
      // Invalidate configuration to trigger error
      setStorageCredentials({
        bucket: "test-bucket",
        region: "us-east-1",
        accessKeyId: "",
        secretAccessKey: "",
      });

      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "test.pdf",
          fileType: "application/pdf",
          sizeBytes: 10000,
        })
        .expect(503);

      expect(res.body.error.message).not.toContain(TEST_STORAGE_CONFIG.secretAccessKey);
      expect(res.body.error.message).not.toContain("TEST_AWS_SECRET_ACCESS_KEY");

      // Restore credentials
      setStorageCredentials(TEST_STORAGE_CONFIG);
    });

    it("17. Zero public-read ACL is requested on the pre-signed PutObjectCommand", async () => {
      // The PutObjectCommand does not include ACL: "public-read"
      // Verify generated URL does not contain public-read ACL header
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "test.pdf",
          fileType: "application/pdf",
          sizeBytes: 10000,
        })
        .expect(200);

      const parsedUrl = new URL(res.body.data.uploadUrl);
      expect(parsedUrl.searchParams.get("x-amz-acl")).toBeNull();
    });

    it("18. The API accepts only JSON metadata and does not receive or buffer file bytes", async () => {
      // Direct file buffer POST is rejected as invalid JSON
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("Content-Type", "application/octet-stream")
        .send(Buffer.from("RAW_FILE_BINARY_CONTENT"))
        .expect(422);

      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // Section D: Audit Logging & Database State Safety (19 - 20)
  // =========================================================================
  describe("D. Audit Logging & State Governance", () => {
    it("19. Audit log entry is recorded with sanitized metadata omitting signed URLs and credentials", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "blood-test.pdf",
          fileType: "application/pdf",
          sizeBytes: 150000,
        })
        .expect(200);

      const storageKey = res.body.data.storageKey;
      const uploadUrl = res.body.data.uploadUrl;

      // Check AuditLog collection
      const auditLog = await AuditLog.findOne({
        resourceId: storageKey,
        resourceType: "MedicalRecord",
      });

      expect(auditLog).toBeDefined();
      expect(auditLog!.actorId.toString()).toBe(patientUser._id.toString());
      expect(auditLog!.action).toBe(AuditAction.MEDICAL_RECORD_UPLOADED);

      const metadataString = JSON.stringify(auditLog!.metadata || {});
      // Strictly verify no signed URLs or credentials in audit logs
      expect(metadataString).not.toContain(uploadUrl);
      expect(metadataString).not.toContain(TEST_STORAGE_CONFIG.secretAccessKey);
      expect(metadataString).not.toContain("X-Amz-Signature");
    });

    it("20. No permanent MedicalRecord database document is created before file is uploaded", async () => {
      const res = await request(app)
        .post("/api/v1/medical-records/upload-url")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          fileName: "unconfirmed-upload.pdf",
          fileType: "application/pdf",
          sizeBytes: 80000,
        })
        .expect(200);

      // Verify MedicalRecord collection remains empty until Task 9.2 metadata registration
      const recordCount = await MedicalRecord.countDocuments({
        storageKey: res.body.data.storageKey,
      });
      expect(recordCount).toBe(0);
    });
  });
});
