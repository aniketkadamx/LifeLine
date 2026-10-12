import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  PharmacyProfile,
  AuditLog,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 4 - Task 4.5: Admin Verification Workflow for Doctors & Pharmacies", () => {
  let ipCounter = 800;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.90.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_admin_verification_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await AuditLog.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({});
      await DoctorProfile.deleteMany({});
      await PharmacyProfile.deleteMany({});
      await AuditLog.deleteMany({});
    }
  });

  // Helper: creates an administrator user
  async function createAdminUser() {
    const adminUser = await User.create({
      email: `admin.${Date.now()}.${Math.random()}@lifeline.internal`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Super Administrator",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    const token = tokenService.generateAccessToken(
      adminUser._id.toString(),
      UserRole.ADMIN
    );
    return { adminUser, token };
  }

  // Helper: creates a doctor user with a doctor profile
  async function createDoctorUser(
    status: DoctorVerificationStatus = DoctorVerificationStatus.PENDING_REVIEW
  ) {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Dr. Evelyn Reed",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
    });

    const regNumber = `MCI-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: "Cardiology",
      qualifications: ["MBBS", "MD Cardiology"],
      experienceYears: 10,
      registrationNumber: regNumber,
      registrationCouncil: "Maharashtra Medical Council",
      consultationFee: 1500,
      verificationStatus: status,
      verificationDocuments: [
        {
          documentType: "MEDICAL_LICENSE",
          fileKey: "private/doctor/med-license-doc-1234.pdf",
          uploadedAt: new Date(),
        },
      ],
    });

    const token = tokenService.generateAccessToken(
      user._id.toString(),
      UserRole.DOCTOR
    );
    return { user, profile, token };
  }

  // Helper: creates a pharmacy user with a pharmacy profile
  async function createPharmacyUser(
    status: PharmacyVerificationStatus = PharmacyVerificationStatus.PENDING_REVIEW
  ) {
    const user = await User.create({
      email: `pharmacy.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Apex Pharmacy Owner",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
    });

    const licNumber = `MH-WZ2-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await PharmacyProfile.create({
      userId: user._id,
      pharmacyName: "Apex Meds & Care",
      ownerName: user.fullName,
      licenseNumber: licNumber,
      address: {
        street: "77 Marine Drive",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400020",
        country: "India",
      },
      phone: "+919876543210",
      verificationStatus: status,
      licenseDocuments: [
        {
          documentType: "DRUG_LICENSE",
          fileKey: "private/pharmacy/license-doc-secret-5678.pdf",
          uploadedAt: new Date(),
        },
      ],
    });

    const token = tokenService.generateAccessToken(
      user._id.toString(),
      UserRole.PHARMACY
    );
    return { user, profile, token };
  }

  // Helper: creates a patient user
  async function createPatientUser() {
    const user = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "John Doe",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
    });
    const token = tokenService.generateAccessToken(
      user._id.toString(),
      UserRole.PATIENT
    );
    return { user, token };
  }

  // =========================================================================
  // 1. Authentication & Role-Based Authorization
  // =========================================================================
  describe("1. Authentication & Authorization Enforcement", () => {
    it("rejects unauthenticated requests with HTTP 401 AUTH_TOKEN_MISSING", async () => {
      const { profile: doctorProfile } = await createDoctorUser();
      const { profile: pharmacyProfile } = await createPharmacyUser();

      const doctorRes = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Credentials approved by medical board",
        });

      expect(doctorRes.status).toBe(401);
      expect(doctorRes.body.success).toBe(false);
      expect(doctorRes.body.error.code).toBe("AUTH_TOKEN_MISSING");

      const pharmacyRes = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Retail license confirmed with state council",
        });

      expect(pharmacyRes.status).toBe(401);
      expect(pharmacyRes.body.success).toBe(false);
      expect(pharmacyRes.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("rejects non-admin roles (PATIENT, DOCTOR, PHARMACY) with HTTP 403 AUTH_INSUFFICIENT_PERMISSIONS", async () => {
      const { profile: doctorProfile } = await createDoctorUser();
      const { token: patientToken } = await createPatientUser();
      const { token: doctorToken } = await createDoctorUser();
      const { token: pharmacyToken } = await createPharmacyUser();

      const nonAdminTokens = [patientToken, doctorToken, pharmacyToken];

      for (const token of nonAdminTokens) {
        const resDoctor = await request(app)
          .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
          .set("Authorization", `Bearer ${token}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            status: DoctorVerificationStatus.APPROVED_VERIFIED,
            reviewNotes: "Valid credentials approved",
          });

        expect(resDoctor.status).toBe(403);
        expect(resDoctor.body.success).toBe(false);
        expect(resDoctor.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
      }
    });

    it("allows authorized administrator to access verification endpoints", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser();

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Approved by administrative board",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(DoctorVerificationStatus.APPROVED_VERIFIED);
    });
  });

  // =========================================================================
  // 2. Doctor Credential Verification State Machine
  // =========================================================================
  describe("2. Doctor Credential Verification State Machine", () => {
    it("successfully approves doctor credentials (PENDING_REVIEW -> APPROVED_VERIFIED)", async () => {
      const { token: adminToken, adminUser } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "All degree certificates and medical council records validated",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        DoctorVerificationStatus.APPROVED_VERIFIED
      );
      expect(res.body.data.verificationNotes).toBe(
        "All degree certificates and medical council records validated"
      );
      expect(res.body.data.verificationReviewedBy).toBe(adminUser._id.toString());
      expect(res.body.data.verificationReviewedAt).toBeDefined();

      // Check DB persistence
      const updatedInDb = await DoctorProfile.findById(doctorProfile._id);
      expect(updatedInDb?.verificationStatus).toBe(
        DoctorVerificationStatus.APPROVED_VERIFIED
      );
      expect(updatedInDb?.verificationReviewedBy?.toString()).toBe(
        adminUser._id.toString()
      );
    });

    it("supports looking up doctor by either profile ID or owning user ID", async () => {
      const { token: adminToken } = await createAdminUser();
      const { user: doctorUser, profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      // Calling with doctor's User._id instead of DoctorProfile._id
      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorUser._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Verified via user ID lookup",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(doctorProfile._id.toString());
    });

    it("successfully requests more info (PENDING_REVIEW -> INFO_REQUESTED)", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.INFO_REQUESTED,
          reviewNotes: "Please upload a clearer scan of the MBBS degree certificate",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        DoctorVerificationStatus.INFO_REQUESTED
      );

      const updated = await DoctorProfile.findById(doctorProfile._id);
      expect(updated?.verificationStatus).toBe(
        DoctorVerificationStatus.INFO_REQUESTED
      );
    });

    it("successfully rejects doctor credentials (PENDING_REVIEW -> REJECTED)", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.REJECTED,
          reviewNotes: "Registration number could not be authenticated with State Council",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        DoctorVerificationStatus.REJECTED
      );

      const updated = await DoctorProfile.findById(doctorProfile._id);
      expect(updated?.verificationStatus).toBe(
        DoctorVerificationStatus.REJECTED
      );
    });

    it("rejects review when doctor is already APPROVED_VERIFIED with 409 DOCTOR_ALREADY_VERIFIED", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.APPROVED_VERIFIED
      );

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Attempting redundant re-approval",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_ALREADY_VERIFIED");
    });

    it("rejects review when doctor is in UNSUBMITTED or REJECTED with 409 INVALID_STATE_TRANSITION", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: unsubmittedDoctor } = await createDoctorUser(
        DoctorVerificationStatus.UNSUBMITTED
      );
      const { profile: rejectedDoctor } = await createDoctorUser(
        DoctorVerificationStatus.REJECTED
      );

      const resUnsubmitted = await request(app)
        .patch(`/api/v1/admin/doctors/${unsubmittedDoctor._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Attempting review before submission",
        });

      expect(resUnsubmitted.status).toBe(409);
      expect(resUnsubmitted.body.error.code).toBe("INVALID_STATE_TRANSITION");

      const resRejected = await request(app)
        .patch(`/api/v1/admin/doctors/${rejectedDoctor._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Attempting re-approval on rejected",
        });

      expect(resRejected.status).toBe(409);
      expect(resRejected.body.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // =========================================================================
  // 3. Pharmacy License Verification State Machine
  // =========================================================================
  describe("3. Pharmacy License Verification State Machine", () => {
    it("successfully approves pharmacy license (PENDING_REVIEW -> APPROVED_VERIFIED)", async () => {
      const { token: adminToken, adminUser } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Retail drug license and premises address authenticated",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        PharmacyVerificationStatus.APPROVED_VERIFIED
      );
      expect(res.body.data.verificationReviewedBy).toBe(adminUser._id.toString());
      expect(res.body.data.verificationNotes).toBe(
        "Retail drug license and premises address authenticated"
      );

      const updated = await PharmacyProfile.findById(pharmacyProfile._id);
      expect(updated?.verificationStatus).toBe(
        PharmacyVerificationStatus.APPROVED_VERIFIED
      );
    });

    it("successfully transitions pharmacy from PENDING_REVIEW -> LICENSE_VERIFYING", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.LICENSE_VERIFYING,
          reviewNotes: "External state drug control database verification in progress",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        PharmacyVerificationStatus.LICENSE_VERIFYING
      );
    });

    it("successfully approves pharmacy from LICENSE_VERIFYING -> APPROVED_VERIFIED", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.LICENSE_VERIFYING
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Completed external validation check successfully",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        PharmacyVerificationStatus.APPROVED_VERIFIED
      );
    });

    it("successfully rejects pharmacy license from PENDING_REVIEW -> REJECTED", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.REJECTED,
          reviewNotes: "Expired retail license certificate provided",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(
        PharmacyVerificationStatus.REJECTED
      );
    });

    it("rejects review when pharmacy is already APPROVED_VERIFIED with 409 PHARMACY_ALREADY_VERIFIED", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.APPROVED_VERIFIED
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Redundant verification attempt",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PHARMACY_ALREADY_VERIFIED");
    });

    it("rejects INFO_REQUESTED for pharmacy with 422 VALIDATION_ERROR (not in pharmacy state machine)", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: "INFO_REQUESTED",
          reviewNotes: "Pharmacy does not have an INFO_REQUESTED lifecycle state",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects review when pharmacy is in UNSUBMITTED with 409 INVALID_STATE_TRANSITION", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.UNSUBMITTED
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Premature approval attempt",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // =========================================================================
  // 4. Input Validation & Mass-Assignment Prevention
  // =========================================================================
  describe("4. Input Validation & Target Identity Validation", () => {
    it("returns 400 BAD_REQUEST for malformed target identifier", async () => {
      const { token: adminToken } = await createAdminUser();

      const resDoctor = await request(app)
        .patch("/api/v1/admin/doctors/not-a-valid-object-id/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Valid review notes",
        });

      expect(resDoctor.status).toBe(400);
      expect(resDoctor.body.success).toBe(false);
      expect(resDoctor.body.error.code).toBe("BAD_REQUEST");

      const resPharmacy = await request(app)
        .patch("/api/v1/admin/pharmacies/invalid-id-xyz/verify")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Valid review notes",
        });

      expect(resPharmacy.status).toBe(400);
      expect(resPharmacy.body.success).toBe(false);
      expect(resPharmacy.body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 404 DOCTOR_NOT_FOUND or PHARMACY_NOT_FOUND for non-existent target ID", async () => {
      const { token: adminToken } = await createAdminUser();
      const fakeId = new mongoose.Types.ObjectId().toString();

      const resDoctor = await request(app)
        .patch(`/api/v1/admin/doctors/${fakeId}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Non-existent doctor review",
        });

      expect(resDoctor.status).toBe(404);
      expect(resDoctor.body.success).toBe(false);
      expect(resDoctor.body.error.code).toBe("DOCTOR_NOT_FOUND");

      const resPharmacy = await request(app)
        .patch(`/api/v1/admin/pharmacies/${fakeId}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Non-existent pharmacy review",
        });

      expect(resPharmacy.status).toBe(404);
      expect(resPharmacy.body.success).toBe(false);
      expect(resPharmacy.body.error.code).toBe("PHARMACY_NOT_FOUND");
    });

    it("rejects unknown or protected fields with 422 VALIDATION_ERROR (strict schema)", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser();

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Legitimate review notes",
          rating: 5, // Protected field
          totalReviews: 100, // Protected field
          verifiedBy: new mongoose.Types.ObjectId().toString(), // Mass-assignment attempt
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects reviewNotes shorter than 5 characters with 422 VALIDATION_ERROR", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser();

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "OK", // < 5 characters
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // 5. Mandatory Audit Logging Pipeline
  // =========================================================================
  describe("5. Mandatory Audit Logging Pipeline", () => {
    it("creates DOCTOR_VERIFICATION_APPROVED audit record on doctor approval", async () => {
      const { token: adminToken, adminUser } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Approval after reviewing medical registry credentials",
        });

      const auditRecord = await AuditLog.findOne({
        action: AuditAction.DOCTOR_VERIFICATION_APPROVED,
        resourceId: doctorProfile._id.toString(),
      });

      expect(auditRecord).toBeDefined();
      expect(auditRecord?.actorId?.toString()).toBe(adminUser._id.toString());
      expect(auditRecord?.actorRole).toBe(UserRole.ADMIN);
      expect(auditRecord?.resourceType).toBe("DoctorProfile");
      expect(auditRecord?.metadata?.previousStatus).toBe(
        DoctorVerificationStatus.PENDING_REVIEW
      );
      expect(auditRecord?.metadata?.newStatus).toBe(
        DoctorVerificationStatus.APPROVED_VERIFIED
      );
    });

    it("creates PHARMACY_VERIFICATION_APPROVED audit record on pharmacy approval", async () => {
      const { token: adminToken, adminUser } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.PENDING_REVIEW
      );

      await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Approval of drug retail store premises license",
        });

      const auditRecord = await AuditLog.findOne({
        action: AuditAction.PHARMACY_VERIFICATION_APPROVED,
        resourceId: pharmacyProfile._id.toString(),
      });

      expect(auditRecord).toBeDefined();
      expect(auditRecord?.actorId?.toString()).toBe(adminUser._id.toString());
      expect(auditRecord?.actorRole).toBe(UserRole.ADMIN);
      expect(auditRecord?.resourceType).toBe("PharmacyProfile");
      expect(auditRecord?.metadata?.previousStatus).toBe(
        PharmacyVerificationStatus.PENDING_REVIEW
      );
      expect(auditRecord?.metadata?.newStatus).toBe(
        PharmacyVerificationStatus.APPROVED_VERIFIED
      );
    });

    it("creates DOCTOR_VERIFICATION_REJECTED and DOCTOR_VERIFICATION_INFO_REQUESTED records", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doc1 } = await createDoctorUser(DoctorVerificationStatus.PENDING_REVIEW);
      const { profile: doc2 } = await createDoctorUser(DoctorVerificationStatus.PENDING_REVIEW);

      await request(app)
        .patch(`/api/v1/admin/doctors/${doc1._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.REJECTED,
          reviewNotes: "Medical degree could not be confirmed",
        });

      await request(app)
        .patch(`/api/v1/admin/doctors/${doc2._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.INFO_REQUESTED,
          reviewNotes: "Please upload certificate of registration renewal",
        });

      const rejectedAudit = await AuditLog.findOne({
        action: AuditAction.DOCTOR_VERIFICATION_REJECTED,
        resourceId: doc1._id.toString(),
      });
      const infoRequestedAudit = await AuditLog.findOne({
        action: AuditAction.DOCTOR_VERIFICATION_INFO_REQUESTED,
        resourceId: doc2._id.toString(),
      });

      expect(rejectedAudit).toBeDefined();
      expect(infoRequestedAudit).toBeDefined();
    });

    it("does not crash business flow when audit service encounters persistence error", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      // Spy on auditLogService to simulate a DB persistence failure
      const logSpy = vi
        .spyOn(auditLogService, "log")
        .mockResolvedValueOnce(null);

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Valid approval with mock audit failure",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verificationStatus).toBe(DoctorVerificationStatus.APPROVED_VERIFIED);

      logSpy.mockRestore();
    });
  });

  // =========================================================================
  // 6. Data Privacy, Storage Key Protection & Concurrency
  // =========================================================================
  describe("6. Data Privacy & Concurrency Safety", () => {
    it("never exposes private storage keys (fileKey) in doctor verification response", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Credentials approved with sanitized response",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationDocuments).toBeDefined();
      expect(res.body.data.verificationDocuments.length).toBeGreaterThan(0);
      for (const doc of res.body.data.verificationDocuments) {
        expect(doc.fileKey).toBeUndefined();
      }
    });

    it("never exposes private storage keys (fileKey) in pharmacy verification response", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: pharmacyProfile } = await createPharmacyUser(
        PharmacyVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/pharmacies/${pharmacyProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: PharmacyVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "License approved with sanitized response",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.licenseDocuments).toBeDefined();
      expect(res.body.data.licenseDocuments.length).toBeGreaterThan(0);
      for (const doc of res.body.data.licenseDocuments) {
        expect(doc.fileKey).toBeUndefined();
      }
    });

    it("prevents conflicting concurrent review decisions against the same doctor profile", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      // Fire two concurrent conflicting review decisions
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
          .set("Authorization", `Bearer ${adminToken}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            status: DoctorVerificationStatus.APPROVED_VERIFIED,
            reviewNotes: "Concurrent decision A - Approve",
          }),
        request(app)
          .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
          .set("Authorization", `Bearer ${adminToken}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            status: DoctorVerificationStatus.REJECTED,
            reviewNotes: "Concurrent decision B - Reject",
          }),
      ]);

      // Exactly one must succeed with 200, and the other must be rejected with 409
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const rejectedResponse = res1.status === 409 ? res1 : res2;
      expect(rejectedResponse.body.success).toBe(false);
      expect(
        rejectedResponse.body.error.code === "INVALID_STATE_TRANSITION" ||
          rejectedResponse.body.error.code === "DOCTOR_ALREADY_VERIFIED"
      ).toBe(true);
    });

    it("adheres to the universal success envelope standard", async () => {
      const { token: adminToken } = await createAdminUser();
      const { profile: doctorProfile } = await createDoctorUser(
        DoctorVerificationStatus.PENDING_REVIEW
      );

      const res = await request(app)
        .patch(`/api/v1/admin/doctors/${doctorProfile._id.toString()}/verify`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          status: DoctorVerificationStatus.APPROVED_VERIFIED,
          reviewNotes: "Envelope verification check",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("success", true);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("message");
      expect(typeof res.body.message).toBe("string");
    });
  });
});
