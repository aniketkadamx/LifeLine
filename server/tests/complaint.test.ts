import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, Complaint, AuditLog } from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";

describe("Milestone 12 - Task 12.2: Platform Complaints & Dispute Resolution", () => {
  let patientUser: any;
  let patientToken: string;

  let otherPatientUser: any;
  let otherPatientToken: string;

  let doctorUser: any;
  let doctorToken: string;

  let adminUser: any;
  let adminToken: string;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_complaint_system_test"
    );
    await User.syncIndexes();
    await Complaint.syncIndexes();
    await AuditLog.syncIndexes();
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Complaint.deleteMany({});
    await AuditLog.deleteMany({});

    // 1. Patient User 1
    patientUser = await User.create({
      email: "patient1.complaint@example.com",
      phone: "+919876542001",
      fullName: "Alice Complainant",
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

    // 2. Patient User 2
    otherPatientUser = await User.create({
      email: "patient2.complaint@example.com",
      phone: "+919876542002",
      fullName: "Bob Complainant",
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

    // 3. Doctor User
    doctorUser = await User.create({
      email: "doctor.complaint@example.com",
      phone: "+919876542003",
      fullName: "Dr. Gregory House",
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

    // 4. Admin User
    adminUser = await User.create({
      email: "admin.complaint@example.com",
      phone: "+919876542004",
      fullName: "Platform Administrator",
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

  describe("Section 1: Complaint Filing", () => {
    it("1. Authenticated user creates a valid complaint successfully", async () => {
      const response = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.DOCTOR_CONDUCT,
          subject: "Unprofessional consultation demeanor",
          description: "The clinician arrived 20 minutes late and was dismissive of acute chest pain.",
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.category).toBe(ComplaintCategory.DOCTOR_CONDUCT);
      expect(response.body.data.subject).toBe("Unprofessional consultation demeanor");
      expect(response.body.data.description).toBe(
        "The clinician arrived 20 minutes late and was dismissive of acute chest pain."
      );
      expect(response.body.data.status).toBe(ComplaintStatus.OPEN);
      expect(response.body.data.priority).toBe(ComplaintPriority.MEDIUM);
    });

    it("2. Complaint is persisted with the correct authenticated user ID", async () => {
      const response = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.PAYMENT,
          subject: "Double deduction during booking",
          description: "My account was debited twice for a single video consultation encounter.",
        });

      expect(response.status).toBe(201);
      const complaintId = response.body.data.id || response.body.data._id;
      const dbRecord = await Complaint.findById(complaintId);

      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.complainantId.toString()).toBe(patientUser._id.toString());
    });

    it("3. Client cannot impersonate another user via request payload", async () => {
      const spoofedUserId = otherPatientUser._id.toString();

      const response = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.DELIVERY,
          subject: "Spoofed user test",
          description: "Attempting to file a complaint on behalf of someone else.",
          complainantId: spoofedUserId, // Disallowed / prohibited field
        });

      // Strict schema rejects unknown/prohibited fields with HTTP 422
      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("4. Client cannot set initial status to RESOLVED or REJECTED", async () => {
      const response = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.MEDICINE_QUALITY,
          subject: "Privileged status injection attempt",
          description: "Attempting to bypass administrative review by setting status directly.",
          status: ComplaintStatus.RESOLVED, // Prohibited field
        });

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("5. Invalid category, missing fields, empty text, and oversized fields are rejected", async () => {
      // 5a. Invalid category
      const resInvalidCat = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: "NON_EXISTENT_CATEGORY",
          description: "Valid long description for complaint filing.",
        });
      expect(resInvalidCat.status).toBe(422);
      expect(resInvalidCat.body.error.code).toBe("VALIDATION_ERROR");

      // 5b. Missing description
      const resMissingDesc = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.APPOINTMENT,
        });
      expect(resMissingDesc.status).toBe(422);
      expect(resMissingDesc.body.error.code).toBe("VALIDATION_ERROR");

      // 5c. Description too short (< 10 chars)
      const resShortDesc = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.OTHER,
          description: "Short",
        });
      expect(resShortDesc.status).toBe(422);
      expect(resShortDesc.body.error.code).toBe("VALIDATION_ERROR");

      // 5d. Empty / whitespace description
      const resEmptyDesc = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.OTHER,
          description: "          ",
        });
      expect(resEmptyDesc.status).toBe(422);
      expect(resEmptyDesc.body.error.code).toBe("VALIDATION_ERROR");

      // 5e. Oversized description (> 5000 characters)
      const resLongDesc = await request(app)
        .post("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          category: ComplaintCategory.OTHER,
          description: "A".repeat(5001),
        });
      expect(resLongDesc.status).toBe(422);
      expect(resLongDesc.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("6. Unauthenticated filing is rejected with HTTP 401", async () => {
      const response = await request(app)
        .post("/api/v1/complaints")
        .send({
          category: ComplaintCategory.APPOINTMENT,
          description: "Anonymous submission attempt.",
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });
  });

  describe("Section 2: Listing and Privacy", () => {
    beforeEach(async () => {
      // Create 2 complaints for Patient 1
      await Complaint.create([
        {
          complainantId: patientUser._id,
          category: ComplaintCategory.APPOINTMENT,
          subject: "Alice Complaint 1",
          description: "Doctor missed scheduled video consultation appointment.",
          status: ComplaintStatus.OPEN,
          priority: ComplaintPriority.HIGH,
        },
        {
          complainantId: patientUser._id,
          category: ComplaintCategory.PAYMENT,
          subject: "Alice Complaint 2",
          description: "Payment gateway timeout without booking confirmation.",
          status: ComplaintStatus.OPEN,
          priority: ComplaintPriority.MEDIUM,
        },
      ]);

      // Create 1 complaint for Patient 2
      await Complaint.create({
        complainantId: otherPatientUser._id,
        category: ComplaintCategory.MEDICINE_QUALITY,
        subject: "Bob Complaint 1",
        description: "Damaged bottle seal upon medicine package delivery.",
        status: ComplaintStatus.OPEN,
        priority: ComplaintPriority.MEDIUM,
      });
    });

    it("7. A user sees only their own complaints", async () => {
      const response = await request(app)
        .get("/api/v1/complaints")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);

      // Verify all complaints belong to Patient 1
      for (const item of response.body.data) {
        const ownerId = item.complainantId?.id || item.complainantId?._id || item.complainantId;
        expect(ownerId.toString()).toBe(patientUser._id.toString());
      }
    });

    it("8. A non-admin cannot list platform-wide complaints even with filters", async () => {
      // Patient 1 tries to list with status or all complaints
      const response = await request(app)
        .get("/api/v1/complaints?status=OPEN")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2); // Only Alice's 2, Bob's is excluded
    });

    it("9. An admin can list complaints across the entire platform for review", async () => {
      const response = await request(app)
        .get("/api/v1/complaints")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3); // Both Alice and Bob's complaints
      expect(response.body.meta.total).toBe(3);
    });

    it("10. Pagination and ordering behave consistently", async () => {
      // Page 1 with limit 2
      const resPage1 = await request(app)
        .get("/api/v1/complaints?page=1&limit=2")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data).toHaveLength(2);
      expect(resPage1.body.meta.page).toBe(1);
      expect(resPage1.body.meta.limit).toBe(2);
      expect(resPage1.body.meta.totalPages).toBe(2);
      expect(resPage1.body.meta.hasNextPage).toBe(true);

      // Page 2 with limit 2
      const resPage2 = await request(app)
        .get("/api/v1/complaints?page=2&limit=2")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data).toHaveLength(1);
      expect(resPage2.body.meta.page).toBe(2);
      expect(resPage2.body.meta.hasNextPage).toBe(false);
    });

    it("11. Malformed IDs and query parameters are rejected", async () => {
      // Malformed ID in single lookup
      const resBadId = await request(app)
        .get("/api/v1/complaints/not-an-object-id")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(resBadId.status).toBe(400);
      expect(resBadId.body.error.code).toBe("BAD_REQUEST");

      // Non-owner cannot view another user's complaint details
      const bobComplaint = await Complaint.findOne({ complainantId: otherPatientUser._id });
      const resForbidden = await request(app)
        .get(`/api/v1/complaints/${bobComplaint?._id.toString()}`)
        .set("Authorization", `Bearer ${patientToken}`);
      expect(resForbidden.status).toBe(403);
      expect(resForbidden.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");

      // Owner CAN view their own complaint details
      const aliceComplaint = await Complaint.findOne({ complainantId: patientUser._id });
      const resOwner = await request(app)
        .get(`/api/v1/complaints/${aliceComplaint?._id.toString()}`)
        .set("Authorization", `Bearer ${patientToken}`);
      expect(resOwner.status).toBe(200);
      expect(resOwner.body.data.subject).toBe(aliceComplaint?.subject);

      // Admin CAN view any complaint details
      const resAdmin = await request(app)
        .get(`/api/v1/complaints/${bobComplaint?._id.toString()}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(resAdmin.status).toBe(200);
    });
  });

  describe("Section 3: Resolution and Authorization", () => {
    let testComplaint: any;

    beforeEach(async () => {
      testComplaint = await Complaint.create({
        complainantId: patientUser._id,
        category: ComplaintCategory.PAYMENT,
        subject: "Billing Dispute",
        description: "Charge incurred for cancelled consultation.",
        status: ComplaintStatus.OPEN,
        priority: ComplaintPriority.HIGH,
      });
    });

    it("12. An admin can resolve an open complaint with valid notes", async () => {
      const response = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Disputed charge investigated and refunded via payment provider.",
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe(ComplaintStatus.RESOLVED);
      expect(response.body.data.resolution).toBeDefined();
      expect(response.body.data.resolution.resolutionNotes).toBe(
        "Disputed charge investigated and refunded via payment provider."
      );
      expect(response.body.data.resolution.resolvedBy.toString()).toBe(adminUser._id.toString());
      expect(response.body.data.resolution.resolvedAt).toBeDefined();

      // Verify DB persistence
      const updatedDb = await Complaint.findById(testComplaint._id);
      expect(updatedDb?.status).toBe(ComplaintStatus.RESOLVED);
      expect(updatedDb?.resolution?.resolvedBy?.toString()).toBe(adminUser._id.toString());
    });

    it("13. An admin can reject an open complaint with valid notes", async () => {
      const response = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.REJECTED,
          resolutionNotes: "Consultation took place as scheduled; no billing discrepancy found.",
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe(ComplaintStatus.REJECTED);

      const updatedDb = await Complaint.findById(testComplaint._id);
      expect(updatedDb?.status).toBe(ComplaintStatus.REJECTED);
    });

    it("14. A non-admin cannot resolve a complaint and receives HTTP 403", async () => {
      // Patient tries to resolve
      const resPatient = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Patient attempting self-resolution.",
        });
      expect(resPatient.status).toBe(403);
      expect(resPatient.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Doctor tries to resolve
      const resDoc = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Doctor attempting unauthorized resolution.",
        });
      expect(resDoc.status).toBe(403);
      expect(resDoc.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("15. An unauthenticated request cannot resolve a complaint", async () => {
      const response = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Anonymous resolution attempt.",
        });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("16. A nonexistent complaint returns HTTP 404", async () => {
      const ghostId = new mongoose.Types.ObjectId().toString();

      const response = await request(app)
        .patch(`/api/v1/complaints/${ghostId}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Resolving ghost complaint.",
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("COMPLAINT_NOT_FOUND");
    });

    it("17. Missing or invalid resolution notes are rejected", async () => {
      // Missing notes
      const resMissingNotes = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
        });
      expect(resMissingNotes.status).toBe(422);
      expect(resMissingNotes.body.error.code).toBe("VALIDATION_ERROR");

      // Notes too short (< 5 chars)
      const resShortNotes = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "OK",
        });
      expect(resShortNotes.status).toBe(422);
      expect(resShortNotes.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("18. Client-supplied resolver IDs and timestamps cannot be spoofed", async () => {
      const fakeAdminId = new mongoose.Types.ObjectId().toString();
      const fakeTimestamp = new Date("2020-01-01T00:00:00Z");

      const response = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Legitimate resolution with spoofed metadata attempt.",
          resolvedBy: fakeAdminId, // Prohibited field in schema
          resolvedAt: fakeTimestamp, // Prohibited field in schema
        });

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("19. An already resolved or rejected complaint cannot be silently overwritten", async () => {
      // First resolution succeeds
      const firstRes = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "First resolution note.",
        });
      expect(firstRes.status).toBe(200);

      // Second attempt to resolve or reject returns HTTP 409 Conflict
      const secondRes = await request(app)
        .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.REJECTED,
          resolutionNotes: "Attempting to overwrite previous resolution.",
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error.code).toBe("COMPLAINT_ALREADY_RESOLVED");

      // Verify original resolution notes preserved
      const dbRecord = await Complaint.findById(testComplaint._id);
      expect(dbRecord?.status).toBe(ComplaintStatus.RESOLVED);
      expect(dbRecord?.resolution?.resolutionNotes).toBe("First resolution note.");
    });

    it("20. Concurrent resolution attempts cannot produce conflicting final state", async () => {
      // Fire 5 simultaneous resolution requests for the same complaint
      const promises = Array.from({ length: 5 }, (_, i) =>
        request(app)
          .patch(`/api/v1/complaints/${testComplaint._id.toString()}/resolve`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            status: ComplaintStatus.RESOLVED,
            resolutionNotes: `Concurrent resolution note ${i + 1}`,
          })
      );

      const responses = await Promise.all(promises);

      const successes = responses.filter((r) => r.status === 200);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(4);
    });
  });

  describe("Section 4: Audit and Failure Safety", () => {
    it("21. Successful resolution produces the expected safe audit event", async () => {
      const complaint = await Complaint.create({
        complainantId: patientUser._id,
        category: ComplaintCategory.DOCTOR_CONDUCT,
        subject: "Audit Test Complaint",
        description: "Testing audit log creation on complaint resolution.",
        status: ComplaintStatus.OPEN,
        priority: ComplaintPriority.HIGH,
      });

      const response = await request(app)
        .patch(`/api/v1/complaints/${complaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Audit log verified resolution note.",
        });

      expect(response.status).toBe(200);

      // Verify audit log entry in DB
      const auditEntry = await AuditLog.findOne({
        resourceId: complaint._id.toString(),
        action: AuditAction.COMPLAINT_RESOLVED,
      });

      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.actorId.toString()).toBe(adminUser._id.toString());
      expect(auditEntry?.actorRole).toBe("ADMIN");
      expect(auditEntry?.resourceType).toBe("COMPLAINT");
      expect(auditEntry?.status).toBe("SUCCESS");
      expect(auditEntry?.metadata?.previousStatus).toBe(ComplaintStatus.OPEN);
      expect(auditEntry?.metadata?.newStatus).toBe(ComplaintStatus.RESOLVED);
    });

    it("22. Audit metadata contains no credentials, tokens, or raw medical data", async () => {
      const complaint = await Complaint.create({
        complainantId: patientUser._id,
        category: ComplaintCategory.APPOINTMENT,
        subject: "Privacy Audit Test",
        description: "Checking that metadata contains no passwords or secret tokens.",
        status: ComplaintStatus.OPEN,
      });

      await request(app)
        .patch(`/api/v1/complaints/${complaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.REJECTED,
          resolutionNotes: "Rejected due to invalid appointment record.",
        });

      const auditEntry = await AuditLog.findOne({
        resourceId: complaint._id.toString(),
        action: AuditAction.COMPLAINT_REJECTED,
      });

      expect(auditEntry).not.toBeNull();
      const metaStr = JSON.stringify(auditEntry?.metadata || {});

      expect(metaStr).not.toContain("password");
      expect(metaStr).not.toContain("passwordHash");
      expect(metaStr).not.toContain("Bearer");
      expect(metaStr).not.toContain("token");
      expect(metaStr).not.toContain("secret");
    });

    it("23. Audit persistence failure does not fail an otherwise successful resolution (fail-safe)", async () => {
      const complaint = await Complaint.create({
        complainantId: patientUser._id,
        category: ComplaintCategory.OTHER,
        subject: "Fail-safe Test",
        description: "Verifying that audit failure does not break business logic.",
        status: ComplaintStatus.OPEN,
      });

      // Spy on AuditLog.create to simulate persistence failure
      const auditSpy = vi
        .spyOn(AuditLog, "create")
        .mockRejectedValueOnce(new Error("Simulated audit database connection failure"));

      const response = await request(app)
        .patch(`/api/v1/complaints/${complaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Dispute settled despite audit infrastructure failure.",
        });

      auditSpy.mockRestore();

      // Complaint resolution should still succeed!
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe(ComplaintStatus.RESOLVED);

      // Verify DB state was updated
      const updatedDb = await Complaint.findById(complaint._id);
      expect(updatedDb?.status).toBe(ComplaintStatus.RESOLVED);
    });

    it("24. Audit failure does not expose sensitive internal error details to client", async () => {
      const complaint = await Complaint.create({
        complainantId: patientUser._id,
        category: ComplaintCategory.OTHER,
        subject: "Information Disclosure Test",
        description: "Verifying no internal error leaks.",
        status: ComplaintStatus.OPEN,
      });

      const auditSpy = vi
        .spyOn(AuditLog, "create")
        .mockRejectedValueOnce(new Error("Internal MongoConnectionException: auth failed at mongodb://secrets"));

      const response = await request(app)
        .patch(`/api/v1/complaints/${complaint._id.toString()}/resolve`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: ComplaintStatus.RESOLVED,
          resolutionNotes: "Resolution notes for testing response payload.",
        });

      auditSpy.mockRestore();

      expect(response.status).toBe(200);
      const resStr = JSON.stringify(response.body);
      expect(resStr).not.toContain("Internal MongoConnectionException");
      expect(resStr).not.toContain("mongodb://secrets");
    });
  });
});
