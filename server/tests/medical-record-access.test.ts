import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  PatientProfile,
  Appointment,
  Consultation,
  MedicalRecord,
  AuditLog,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  AppointmentStatus,
  ConsultationStatus,
  ConsultationType,
  MedicalRecordType,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  setStorageCredentials,
  setS3Client,
  setMockObjectMetadata,
  getStorageCredentials,
} from "../src/integrations/storage/s3.client.js";
import { AppError } from "../src/utils/api-error.js";

const TEST_STORAGE_CONFIG = {
  bucket: "lifeline-medical-records-test",
  region: "us-east-1",
  accessKeyId: "TEST_AWS_ACCESS_KEY_ID_M9_2",
  secretAccessKey: "TEST_AWS_SECRET_ACCESS_KEY_AT_LEAST_32_CHARS_LONG",
};

describe("Milestone 9 - Task 9.2: Medical Record Metadata & 15-Minute Expiring Download Access", () => {
  let patientUser: any;
  let patientToken: string;

  let otherPatientUser: any;
  let otherPatientToken: string;

  let assignedDoctorUser: any;
  let assignedDoctorToken: string;

  let unassignedDoctorUser: any;
  let unassignedDoctorToken: string;

  let pharmacyUser: any;
  let pharmacyToken: string;

  let adminUser: any;
  let adminToken: string;

  beforeAll(async () => {
    setStorageCredentials(TEST_STORAGE_CONFIG);

    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_medical_record_access_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PatientProfile.syncIndexes();
    await Appointment.syncIndexes();
    await MedicalRecord.syncIndexes();
    await AuditLog.syncIndexes();
  }, 30000);

  afterAll(async () => {
    setStorageCredentials(null);
    setS3Client(null);
    setMockObjectMetadata(null);

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    setStorageCredentials(TEST_STORAGE_CONFIG);
    setS3Client(null);

    // Setup default mock object metadata handler for S3 HeadObject operations
    setMockObjectMetadata((key: string) => {
      if (key.includes("000000000001")) {
        throw new AppError(
          404,
          "STORAGE_OBJECT_NOT_FOUND",
          "Uploaded object not found in storage bucket"
        );
      }
      if (key.includes("000000000002")) {
        return { contentLength: 0, contentType: "application/pdf" };
      }
      if (key.includes("000000000003")) {
        return {
          contentLength: 20 * 1024 * 1024, // 20 MiB (> 15 MiB)
          contentType: "application/pdf",
        };
      }
      if (key.includes("000000000004")) {
        return {
          contentLength: 2048,
          contentType: "application/x-executable",
        };
      }
      if (key.includes("000000000005")) {
        return {
          contentLength: 4096,
          contentType: "image/png", // Key ends in .pdf but object is image/png
        };
      }

      let contentType = "application/pdf";
      if (key.endsWith(".png")) contentType = "image/png";
      if (key.endsWith(".jpg")) contentType = "image/jpeg";
      if (key.endsWith(".dcm")) contentType = "application/dicom";

      return {
        contentLength: 512 * 1024, // 512 KB
        contentType,
        eTag: "\"mock-verified-etag-12345\"",
      };
    });

    await User.deleteMany({});
    await DoctorProfile.deleteMany({});
    await PatientProfile.deleteMany({});
    await Appointment.deleteMany({});
    await MedicalRecord.deleteMany({});
    await AuditLog.deleteMany({});

    // 1. Patient User & Profile
    patientUser = await User.create({
      email: "patient.m92@example.com",
      phone: "+919876540301",
      fullName: "Patient Primary M9",
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
    await PatientProfile.create({
      userId: patientUser._id,
      emergencyContact: {
        name: "Emergency Kin",
        relationship: "Sibling",
        phone: "+919876540399",
      },
    });

    // 2. Unrelated Patient User
    otherPatientUser = await User.create({
      email: "patient.unrelated.m92@example.com",
      phone: "+919876540302",
      fullName: "Patient Unrelated M9",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherPatientToken = tokenService.generateAccessToken(
      otherPatientUser._id.toString(),
      UserRole.PATIENT
    );

    // 3. Assigned Doctor User & Verified Profile
    assignedDoctorUser = await User.create({
      email: "doctor.assigned.m92@example.com",
      phone: "+919876540303",
      fullName: "Dr. Assigned Clinician",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    assignedDoctorToken = tokenService.generateAccessToken(
      assignedDoctorUser._id.toString(),
      UserRole.DOCTOR
    );
    await DoctorProfile.create({
      userId: assignedDoctorUser._id,
      specialization: "Internal Medicine",
      qualifications: ["MD", "MBBS"],
      registrationNumber: "DOC-REG-M9-301",
      registrationCouncil: "Medical Council",
      experienceYears: 12,
      consultationFee: 800,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    // 4. Unassigned Doctor User & Verified Profile
    unassignedDoctorUser = await User.create({
      email: "doctor.unassigned.m92@example.com",
      phone: "+919876540304",
      fullName: "Dr. Unassigned Clinician",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    unassignedDoctorToken = tokenService.generateAccessToken(
      unassignedDoctorUser._id.toString(),
      UserRole.DOCTOR
    );
    await DoctorProfile.create({
      userId: unassignedDoctorUser._id,
      specialization: "Dermatology",
      qualifications: ["MD", "MBBS"],
      registrationNumber: "DOC-REG-M9-302",
      registrationCouncil: "Medical Council",
      experienceYears: 8,
      consultationFee: 700,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    // 5. Pharmacy User
    pharmacyUser = await User.create({
      email: "pharmacy.m92@example.com",
      phone: "+919876540305",
      fullName: "City Pharmacy M9",
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

    // 6. Admin User
    adminUser = await User.create({
      email: "admin.m92@example.com",
      phone: "+919876540306",
      fullName: "Compliance Admin M9",
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

  // Helper to establish an active clinical appointment relationship
  async function establishClinicalRelationship(
    doctorId = assignedDoctorUser._id,
    patientId = patientUser._id,
    status = AppointmentStatus.CONFIRMED
  ) {
    const now = Date.now();
    return await Appointment.create({
      doctorId,
      patientId,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(now + 30 * 60 * 1000),
      scheduledEnd: new Date(now + 60 * 60 * 1000),
      fee: 800,
      currency: "INR",
      reason: "Clinical Follow-up & Lab Review",
      status,
      paymentStatus: "PAID",
    });
  }

  // =========================================================================
  // Section A: Medical Record Metadata Registration (Tests 1 - 8)
  // =========================================================================
  describe("A. Metadata Registration & Object Verification", () => {
    it("1. A valid uploaded object is verified via S3 and registered successfully", async () => {
      const validKey = "records/a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6.pdf";

      const res = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Complete Blood Count Panel",
          recordType: MedicalRecordType.LAB_REPORT,
          storageKey: validKey,
          description: "Routine diagnostic blood work",
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe("Complete Blood Count Panel");
      expect(res.body.data.recordType).toBe(MedicalRecordType.LAB_REPORT);
      expect(res.body.data.fileType).toBe("application/pdf");
      expect(res.body.data.sizeBytes).toBe(512 * 1024);
      // Ensure storageKey is stripped from client serialization via toJSONPlugin
      expect(res.body.data.storageKey).toBeUndefined();
    });

    it("2. The persisted record uses the authenticated patient's trusted identity", async () => {
      const validKey = "records/11223344-5566-4778-8899-aabbccddeeff.png";

      const res = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Chest X-Ray Digital Image",
          recordType: MedicalRecordType.XRAY,
          storageKey: validKey,
        })
        .expect(201);

      const recordId = res.body.data.id;
      const recordInDb = await MedicalRecord.findById(recordId);

      expect(recordInDb).toBeDefined();
      expect(recordInDb!.patientId.toString()).toBe(patientUser._id.toString());
      expect(recordInDb!.uploadedBy.toString()).toBe(patientUser._id.toString());
    });

    it("3. Client-supplied ownership and arbitrary storage paths cannot override server-controlled values", async () => {
      // Attacker attempts to register an arbitrary or path-traversing storageKey
      const badKeyRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Injected Path Attack",
          recordType: MedicalRecordType.OTHER,
          storageKey: "../../../etc/passwd",
        })
        .expect(422);

      expect(badKeyRes.body.success).toBe(false);
      expect(badKeyRes.body.error.code).toBe("VALIDATION_ERROR");

      // Attacker attempts to supply another patient's ID in request body
      const spoofKey = "records/22334455-6677-4889-99aa-bbccddeeff00.pdf";
      const spoofRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Ownership Tampering Attempt",
          recordType: MedicalRecordType.LAB_REPORT,
          storageKey: spoofKey,
          patientId: otherPatientUser._id.toString(), // Attacker tries to attach to other patient
          uploadedBy: otherPatientUser._id.toString(),
        })
        .expect(201);

      const recordInDb = await MedicalRecord.findById(spoofRes.body.data.id);
      expect(recordInDb!.patientId.toString()).toBe(patientUser._id.toString());
      expect(recordInDb!.uploadedBy.toString()).toBe(patientUser._id.toString());
    });

    it("4. A missing object in cloud storage cannot be registered (returns 404)", async () => {
      const missingKey = "records/00000000-0000-4000-8000-000000000001.pdf";

      const res = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Nonexistent File Registration",
          recordType: MedicalRecordType.LAB_REPORT,
          storageKey: missingKey,
        })
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("STORAGE_OBJECT_NOT_FOUND");
    });

    it("5. An empty, oversized, disallowed, or MIME-mismatched object is rejected with HTTP 422", async () => {
      // A. Empty object (0 bytes)
      const emptyRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Zero Byte File",
          recordType: MedicalRecordType.LAB_REPORT,
          storageKey: "records/00000000-0000-4000-8000-000000000002.pdf",
        })
        .expect(422);
      expect(emptyRes.body.error.message).toContain("empty");

      // B. Oversized object (> 15 MiB)
      const oversizedRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Oversized File",
          recordType: MedicalRecordType.MRI,
          storageKey: "records/00000000-0000-4000-8000-000000000003.pdf",
        })
        .expect(422);
      expect(oversizedRes.body.error.message).toContain("15 MiB");

      // C. Disallowed executable MIME type in S3
      const disallowedRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Executable Payload",
          recordType: MedicalRecordType.OTHER,
          storageKey: "records/00000000-0000-4000-8000-000000000004.pdf",
        })
        .expect(422);
      expect(disallowedRes.body.error.message).toContain("unsupported MIME type");

      // D. Extension and ContentType mismatch
      const mismatchRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "MIME Mismatch File",
          recordType: MedicalRecordType.LAB_REPORT,
          storageKey: "records/00000000-0000-4000-8000-000000000005.pdf", // Has .pdf but S3 reports image/png
        })
        .expect(422);
      expect(mismatchRes.body.error.message).toContain("Storage key extension does not match");
    });

    it("6. Actual verified size and MIME type from storage are persisted rather than client claims", async () => {
      const validKey = "records/55555555-5555-4555-8555-555555555555.dcm";

      const res = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Cardiac CT Scan DICOM",
          recordType: MedicalRecordType.CT_SCAN,
          storageKey: validKey,
          sizeBytes: 99999999, // False client claim
          fileType: "fake/mime", // False client claim
        })
        .expect(201);

      const recordInDb = await MedicalRecord.findById(res.body.data.id);
      expect(recordInDb!.sizeBytes).toBe(512 * 1024); // Verified from S3!
      expect(recordInDb!.fileType).toBe("application/dicom"); // Verified from S3!
    });

    it("7. Failed verification creates no permanent MedicalRecord database document", async () => {
      const invalidKey = "records/00000000-0000-4000-8000-000000000002.pdf";

      await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Should Not Persist",
          recordType: MedicalRecordType.LAB_REPORT,
          storageKey: invalidKey,
        })
        .expect(422);

      const count = await MedicalRecord.countDocuments({ storageKey: invalidKey });
      expect(count).toBe(0);
    });

    it("8. Duplicate registration of the same storage object is rejected with 409 RESOURCE_CONFLICT", async () => {
      const uniqueKey = "records/77777777-7777-4777-8777-777777777777.pdf";

      // 1st Registration -> 201 Created
      await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Ultrasound Report",
          recordType: MedicalRecordType.OTHER,
          storageKey: uniqueKey,
        })
        .expect(201);

      // 2nd Registration -> 409 Conflict
      const dupRes = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Duplicate Registration Attempt",
          recordType: MedicalRecordType.OTHER,
          storageKey: uniqueKey,
        })
        .expect(409);

      expect(dupRes.body.success).toBe(false);
      expect(dupRes.body.error.code).toBe("RESOURCE_CONFLICT");
    });
  });

  // =========================================================================
  // Section B: Download Authorization & URL Expiry (Tests 9 - 16)
  // =========================================================================
  describe("B. Zero-Trust Download Authorization & 900-Second Expiry", () => {
    let testRecord: any;

    beforeEach(async () => {
      testRecord = await MedicalRecord.create({
        patientId: patientUser._id,
        uploadedBy: patientUser._id,
        title: "Protected Lipid Panel",
        recordType: MedicalRecordType.LAB_REPORT,
        recordDate: new Date(),
        storageKey: "records/88888888-8888-4888-8888-888888888888.pdf",
        fileName: "lipid_panel.pdf",
        fileType: "application/pdf",
        sizeBytes: 102400,
      });
    });

    it("9. The patient owner receives a valid pre-signed GET URL", async () => {
      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBe(900);
      expect(res.body.data.fileName).toBe("lipid_panel.pdf");
      expect(res.body.data.fileType).toBe("application/pdf");
    });

    it("10. A doctor with an active clinical relationship receives a valid pre-signed GET URL", async () => {
      // Establish active clinical appointment relationship between assignedDoctor and patient
      await establishClinicalRelationship(
        assignedDoctorUser._id,
        patientUser._id,
        AppointmentStatus.CONFIRMED
      );

      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${assignedDoctorToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
      expect(res.body.data.expiresInSeconds).toBe(900);
    });

    it("11. An unassigned doctor without a clinical relationship receives HTTP 403 Forbidden", async () => {
      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${unassignedDoctorToken}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
      expect(res.body.error.message).toContain("clinical relationship");
    });

    it("12. A doctor whose relationship is cancelled/ineligible receives HTTP 403 Forbidden", async () => {
      // Appointment exists but is CANCELLED -> relationship is NOT active
      await establishClinicalRelationship(
        assignedDoctorUser._id,
        patientUser._id,
        AppointmentStatus.CANCELLED
      );

      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${assignedDoctorToken}`)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("13. Other roles follow Section 4: Admin allowed (with audit), Pharmacy denied with 403", async () => {
      // Admin allowed
      const adminRes = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(adminRes.body.success).toBe(true);
      expect(adminRes.body.data.downloadUrl).toBeDefined();

      // Pharmacy denied (403)
      const pharmRes = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .expect(403);
      expect(pharmRes.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");

      // Unrelated patient denied (403)
      const otherPatRes = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${otherPatientToken}`)
        .expect(403);
      expect(otherPatRes.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("14. A nonexistent or archived record returns HTTP 404 Not Found", async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      // Nonexistent record
      await request(app)
        .get(`/api/v1/medical-records/${nonExistentId}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(404);

      // Archived record
      testRecord.isArchived = true;
      await testRecord.save();

      const archivedRes = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(404);

      expect(archivedRes.body.error.code).toBe("NOT_FOUND");
    });

    it("15. The generated pre-signed URL expires in exactly 900 seconds (15 minutes)", async () => {
      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);

      expect(res.body.data.expiresInSeconds).toBe(900);

      const parsedUrl = new URL(res.body.data.downloadUrl);
      expect(parsedUrl.searchParams.get("X-Amz-Expires")).toBe("900");
    });

    it("16. The signed GET URL is never logged, audited, or persisted into database", async () => {
      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);

      const downloadUrl = res.body.data.downloadUrl;

      // Check MedicalRecord document
      const record = await MedicalRecord.findById(testRecord._id);
      expect(JSON.stringify(record)).not.toContain(downloadUrl);

      // Check AuditLog document
      const logs = await AuditLog.find({ resourceId: testRecord._id.toString() });
      for (const log of logs) {
        const str = JSON.stringify(log.metadata || {});
        expect(str).not.toContain(downloadUrl);
        expect(str).not.toContain(TEST_STORAGE_CONFIG.secretAccessKey);
      }
    });
  });

  // =========================================================================
  // Section C: Audit Logging & Failure Safety (Tests 17 - 21)
  // =========================================================================
  describe("C. Audit Trail & Failure Safety", () => {
    let testRecord: any;

    beforeEach(async () => {
      testRecord = await MedicalRecord.create({
        patientId: patientUser._id,
        uploadedBy: patientUser._id,
        title: "Audit Test Report",
        recordType: MedicalRecordType.LAB_REPORT,
        recordDate: new Date(),
        storageKey: "records/99999999-9999-4999-8999-999999999999.pdf",
        fileName: "audit_test.pdf",
        fileType: "application/pdf",
        sizeBytes: 20480,
      });
    });

    it("17. Successful authorized access creates a MEDICAL_RECORD_ACCESSED audit record", async () => {
      await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);

      const auditLog = await AuditLog.findOne({
        resourceId: testRecord._id.toString(),
        action: AuditAction.MEDICAL_RECORD_ACCESSED,
      });

      expect(auditLog).toBeDefined();
      expect(auditLog!.actorId.toString()).toBe(patientUser._id.toString());
      expect(auditLog!.actorRole).toBe(UserRole.PATIENT);
      expect(auditLog!.resourceType).toBe("MedicalRecord");
      expect(auditLog!.status).toBe("SUCCESS");
      expect(auditLog!.metadata?.expiresInSeconds).toBe(900);
    });

    it("18. Unauthorized access does NOT create a successful-access audit event", async () => {
      await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${unassignedDoctorToken}`)
        .expect(403);

      const auditLog = await AuditLog.findOne({
        resourceId: testRecord._id.toString(),
        actorId: unassignedDoctorUser._id,
      });

      expect(auditLog).toBeNull();
    });

    it("19. Storage provider errors produce safe 503 errors without exposing credentials or keys", async () => {
      // Simulate storage provider failure during download URL generation
      setMockObjectMetadata(() => {
        throw new AppError(
          503,
          "STORAGE_PROVIDER_ERROR",
          "Simulated AWS S3 network connectivity failure"
        );
      });

      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(503);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("STORAGE_PROVIDER_ERROR");
      expect(res.body.error.message).not.toContain(TEST_STORAGE_CONFIG.secretAccessKey);
    });

    it("20. Cache-Control and anti-cache headers prevent public caching of download URLs", async () => {
      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);

      expect(res.headers["cache-control"]).toContain("no-store");
      expect(res.headers["cache-control"]).toContain("no-cache");
      expect(res.headers["cache-control"]).toContain("must-revalidate");
      expect(res.headers["cache-control"]).toContain("private");
      expect(res.headers["pragma"]).toBe("no-cache");
      expect(res.headers["expires"]).toBe("0");
      expect(res.headers["surrogate-control"]).toBe("no-store");
    });

    it("21. Storage configuration resolves fallback AWS SDK environment variables consistently", () => {
      setStorageCredentials(null); // Reset custom credentials
      const origS3Bucket = process.env.S3_BUCKET_NAME;
      const origAwsRegion = process.env.AWS_REGION;
      const origAwsKey = process.env.AWS_ACCESS_KEY_ID;
      const origAwsSecret = process.env.AWS_SECRET_ACCESS_KEY;

      try {
        delete process.env.STORAGE_BUCKET;
        delete process.env.STORAGE_REGION;
        delete process.env.STORAGE_ACCESS_KEY;
        delete process.env.STORAGE_SECRET_KEY;

        process.env.S3_BUCKET_NAME = "aws-fallback-bucket";
        process.env.AWS_REGION = "eu-west-1";
        process.env.AWS_ACCESS_KEY_ID = "FALLBACK_KEY_ID";
        process.env.AWS_SECRET_ACCESS_KEY = "FALLBACK_SECRET_KEY";

        const creds = getStorageCredentials();
        expect(creds.bucket).toBe("aws-fallback-bucket");
        expect(creds.region).toBe("eu-west-1");
        expect(creds.accessKeyId).toBe("FALLBACK_KEY_ID");
        expect(creds.secretAccessKey).toBe("FALLBACK_SECRET_KEY");
      } finally {
        // Restore
        if (origS3Bucket !== undefined) process.env.S3_BUCKET_NAME = origS3Bucket; else delete process.env.S3_BUCKET_NAME;
        if (origAwsRegion !== undefined) process.env.AWS_REGION = origAwsRegion; else delete process.env.AWS_REGION;
        if (origAwsKey !== undefined) process.env.AWS_ACCESS_KEY_ID = origAwsKey; else delete process.env.AWS_ACCESS_KEY_ID;
        if (origAwsSecret !== undefined) process.env.AWS_SECRET_ACCESS_KEY = origAwsSecret; else delete process.env.AWS_SECRET_ACCESS_KEY;
        setStorageCredentials(TEST_STORAGE_CONFIG);
      }
    });

    it("22. Metadata registration supports .jpeg file extension matching image/jpeg content type", async () => {
      const jpegKey = "records/00000000-0000-4000-8000-000000000099.jpeg";
      setMockObjectMetadata((key) => {
        if (key === jpegKey) {
          return {
            contentLength: 50000,
            contentType: "image/jpeg",
          };
        }
        return {
          contentLength: 1024,
          contentType: "application/pdf",
        };
      });

      const res = await request(app)
        .post("/api/v1/medical-records")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          title: "Skin Rash JPEG Photo",
          recordType: MedicalRecordType.OTHER,
          storageKey: jpegKey,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.fileType).toBe("image/jpeg");
    });

    it("23. Doctor cannot download record if consultation is tied to a cancelled appointment", async () => {
      const cancelledAppointment = await establishClinicalRelationship(
        unassignedDoctorUser._id,
        patientUser._id,
        AppointmentStatus.CANCELLED
      );

      await Consultation.create({
        appointmentId: cancelledAppointment._id,
        patientId: patientUser._id,
        doctorId: unassignedDoctorUser._id,
        consultationType: ConsultationType.VIDEO,
        status: ConsultationStatus.ROOM_OPENED,
        roomId: "room_cancelled_apt_123",
      });

      const res = await request(app)
        .get(`/api/v1/medical-records/${testRecord._id}/download-url`)
        .set("Authorization", `Bearer ${unassignedDoctorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });
  });
});
