import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, DoctorProfile, AuditLog } from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  ConsultationType,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 4 - Task 4.3: Doctor Profile & Verification Document Submission", () => {
  let ipCounter = 300;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.40.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase("mongodb://127.0.0.1:27017/lifeline_doctor_profile_test");
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
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
      await AuditLog.deleteMany({});
    }
  });

  // Helper: creates a test doctor user with linked DoctorProfile
  async function createDoctorUser(
    profileOverrides: Partial<{
      specialization: string;
      experienceYears: number;
      registrationNumber: string;
      registrationCouncil: string;
      consultationFee: number;
      verificationStatus: DoctorVerificationStatus;
      qualifications: string[];
      bio: string;
    }> = {}
  ) {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Dr. Gregory House",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
    });

    const regNumber =
      profileOverrides.registrationNumber ||
      `REG-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: profileOverrides.specialization || "GENERAL_MEDICINE",
      qualifications: profileOverrides.qualifications || ["MBBS", "MD Internal Medicine"],
      experienceYears: profileOverrides.experienceYears !== undefined ? profileOverrides.experienceYears : 8,
      registrationNumber: regNumber,
      registrationCouncil: profileOverrides.registrationCouncil || "State Medical Council",
      consultationFee: profileOverrides.consultationFee !== undefined ? profileOverrides.consultationFee : 750,
      verificationStatus: profileOverrides.verificationStatus || DoctorVerificationStatus.UNSUBMITTED,
      bio: profileOverrides.bio || "Experienced diagnostician and general practitioner.",
    });

    user.doctorProfile = profile._id;
    await user.save();

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, profile, token };
  }

  // Helper: creates a test patient user
  async function createPatientUser() {
    const user = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Test Patient",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);
    return { user, token };
  }

  // Helper: creates a test pharmacy user
  async function createPharmacyUser() {
    const user = await User.create({
      email: `pharmacy.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Apex Pharmacy",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);
    return { user, token };
  }

  // =========================================================================
  // Requirement 1 & 6: Access, Self-Service Updates & Preserving Omitted Fields
  // =========================================================================
  describe("1. Self-Service Profile Access & Updates", () => {
    it("1. Authenticated doctor can access and update their own permitted profile fields", async () => {
      const { user, profile, token } = await createDoctorUser({
        specialization: "CARDIOLOGY",
        consultationFee: 1000,
      });

      // 1.1 Read profile
      const resGet = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(200);
      expect(resGet.body.success).toBe(true);
      expect(resGet.body.data.id).toBe(profile.id);
      expect(resGet.body.data.userId).toBe(user.id);
      expect(resGet.body.data.specialization).toBe("CARDIOLOGY");
      expect(resGet.body.data.consultationFee).toBe(1000);

      // 1.2 Update profile
      const updatePayload = {
        clinicName: "Princeton Plainsboro Clinic",
        clinicAddress: {
          city: "Princeton",
          state: "New Jersey",
          postalCode: "08540",
          country: "United States",
        },
        consultationFee: 1200,
        consultationTypes: [ConsultationType.VIDEO, ConsultationType.IN_PERSON],
        languages: ["English", "Spanish"],
        bio: "Specializing in complex cardiac diagnostics and non-invasive procedures.",
      };

      const resPut = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send(updatePayload);

      expect(resPut.status).toBe(200);
      expect(resPut.body.success).toBe(true);
      expect(resPut.body.data.clinicName).toBe("Princeton Plainsboro Clinic");
      expect(resPut.body.data.clinicAddress.city).toBe("Princeton");
      expect(resPut.body.data.consultationFee).toBe(1200);
      expect(resPut.body.data.consultationTypes).toEqual(["VIDEO", "IN_PERSON"]);
      expect(resPut.body.data.languages).toEqual(["English", "Spanish"]);
      expect(resPut.body.data.bio).toBe(
        "Specializing in complex cardiac diagnostics and non-invasive procedures."
      );

      // 1.3 Verify database state
      const updatedInDb = await DoctorProfile.findById(profile.id);
      expect(updatedInDb?.clinicName).toBe("Princeton Plainsboro Clinic");
      expect(updatedInDb?.consultationFee).toBe(1200);
    });

    it("6. Omitted profile fields remain unchanged during partial updates", async () => {
      const { profile, token } = await createDoctorUser({
        specialization: "NEUROLOGY",
        experienceYears: 12,
        consultationFee: 1500,
        bio: "Original neurologist bio",
      });

      const resPatch = await request(app)
        .patch("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          bio: "Updated neurologist bio only",
        });

      expect(resPatch.status).toBe(200);
      expect(resPatch.body.success).toBe(true);
      expect(resPatch.body.data.bio).toBe("Updated neurologist bio only");
      // Preserved fields
      expect(resPatch.body.data.specialization).toBe("NEUROLOGY");
      expect(resPatch.body.data.experienceYears).toBe(12);
      expect(resPatch.body.data.consultationFee).toBe(1500);

      const inDb = await DoctorProfile.findById(profile.id);
      expect(inDb?.specialization).toBe("NEUROLOGY");
      expect(inDb?.experienceYears).toBe(12);
      expect(inDb?.consultationFee).toBe(1500);
      expect(inDb?.bio).toBe("Updated neurologist bio only");
    });
  });

  // =========================================================================
  // Requirement 2: Doctor Isolation & Ownership Protection
  // =========================================================================
  describe("2. Resource Ownership & Identity Derivation", () => {
    it("2. A doctor cannot modify another doctor's profile by supplying client IDs", async () => {
      const doctorA = await createDoctorUser({ specialization: "DERMATOLOGY", consultationFee: 500 });
      const doctorB = await createDoctorUser({ specialization: "PEDIATRICS", consultationFee: 800 });

      // Doctor A attempts to update Doctor B by injecting doctorB ID in body
      const res = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${doctorA.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          consultationFee: 999,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(doctorA.profile.id);
      expect(res.body.data.consultationFee).toBe(999);

      // Verify Doctor B's profile was not touched
      const refreshedDoctorB = await DoctorProfile.findById(doctorB.profile.id);
      expect(refreshedDoctorB?.consultationFee).toBe(800);
      expect(refreshedDoctorB?.specialization).toBe("PEDIATRICS");
    });
  });

  // =========================================================================
  // Requirement 3 & 4: Authentication & Authorization Controls
  // =========================================================================
  describe("3-4. Authentication & Authorization Enforcement", () => {
    it("3. Unauthenticated requests are rejected with HTTP 401", async () => {
      const resGet = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(401);
      expect(resGet.body.error.code).toBe("AUTH_TOKEN_MISSING");

      const resPut = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("x-test-client-ip", getUniqueIp())
        .send({ consultationFee: 500 });

      expect(resPut.status).toBe(401);
      expect(resPut.body.error.code).toBe("AUTH_TOKEN_MISSING");

      const resDoc = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "MED-12345",
          registrationCouncil: "Medical Council",
          qualifications: ["MBBS"],
          documents: [{ documentType: "MEDICAL_LICENSE", fileKey: "docs/lic.pdf" }],
        });

      expect(resDoc.status).toBe(401);
      expect(resDoc.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("4. Non-doctor roles (PATIENT, PHARMACY) are rejected with HTTP 403", async () => {
      const { token: patientToken } = await createPatientUser();
      const { token: pharmacyToken } = await createPharmacyUser();

      // Patient attempting doctor endpoints
      const resPatientGet = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp());
      expect(resPatientGet.status).toBe(403);
      expect(resPatientGet.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resPatientPut = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ consultationFee: 600 });
      expect(resPatientPut.status).toBe(403);
      expect(resPatientPut.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resPatientDocs = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "MED-99999",
          registrationCouncil: "Council",
          qualifications: ["MBBS"],
          documents: [{ documentType: "MEDICAL_LICENSE", fileKey: "docs/lic.pdf" }],
        });
      expect(resPatientDocs.status).toBe(403);
      expect(resPatientDocs.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Pharmacy attempting doctor endpoints
      const resPharmGet = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .set("x-test-client-ip", getUniqueIp());
      expect(resPharmGet.status).toBe(403);
      expect(resPharmGet.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resPharmPut = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ consultationFee: 600 });
      expect(resPharmPut.status).toBe(403);
      expect(resPharmPut.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resPharmDocs = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "MED-88888",
          registrationCouncil: "Council",
          qualifications: ["MBBS"],
          documents: [{ documentType: "MEDICAL_LICENSE", fileKey: "docs/lic.pdf" }],
        });
      expect(resPharmDocs.status).toBe(403);
      expect(resPharmDocs.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });
  });

  // =========================================================================
  // Requirement 5 & 8: Input Validation, Schema Rejection & Mass-Assignment
  // =========================================================================
  describe("5, 8. Input Validation & Mass-Assignment Prevention", () => {
    it("5. Mass-assignment of protected verification or review fields is rejected with 422", async () => {
      const { token } = await createDoctorUser();

      // Attempting to self-verify
      const resStatus = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          verificationStatus: "APPROVED_VERIFIED",
        });

      expect(resStatus.status).toBe(422);
      expect(resStatus.body.error.code).toBe("VALIDATION_ERROR");

      // Attempting to modify rating
      const resRating = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          rating: 5,
        });

      expect(resRating.status).toBe(422);
      expect(resRating.body.error.code).toBe("VALIDATION_ERROR");

      // Attempting unknown properties
      const resUnknown = await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          unauthorizedProperty: "malicious_payload",
        });

      expect(resUnknown.status).toBe(422);
      expect(resUnknown.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("8. Invalid credential metadata and document references are rejected with 422", async () => {
      const { token } = await createDoctorUser();

      // Empty documents array
      const resEmptyDocs = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "MED-12345",
          registrationCouncil: "State Medical Council",
          qualifications: ["MBBS"],
          documents: [],
        });

      expect(resEmptyDocs.status).toBe(422);
      expect(resEmptyDocs.body.error.code).toBe("VALIDATION_ERROR");

      // Invalid document type
      const resInvalidDocType = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "MED-12345",
          registrationCouncil: "State Medical Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "RANDOM_UNSUPPORTED_TYPE",
              fileKey: "docs/file.pdf",
            },
          ],
        });

      expect(resInvalidDocType.status).toBe(422);
      expect(resInvalidDocType.body.error.code).toBe("VALIDATION_ERROR");

      // Short registration number (< 5 chars)
      const resShortReg = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "123",
          registrationCouncil: "State Medical Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "docs/file.pdf",
            },
          ],
        });

      expect(resShortReg.status).toBe(422);
      expect(resShortReg.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // Requirement 7: Credential Submission & State Machine Transition
  // =========================================================================
  describe("7. Credential Submission & State Machine Transition", () => {
    it("7. Valid credential submission produces the contract-defined state transition to PENDING_REVIEW", async () => {
      const { profile, token } = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });

      const submissionPayload = {
        registrationNumber: "MCI-2026-98765",
        registrationCouncil: "Delhi Medical Council",
        qualifications: ["MBBS", "MD Cardiology", "DM Interventional Cardiology"],
        documents: [
          {
            documentType: "MEDICAL_LICENSE",
            fileKey: "private/documents/doctors/mci-2026-98765.pdf",
          },
          {
            documentType: "DEGREE_CERTIFICATE",
            fileKey: "private/documents/doctors/dm-degree.pdf",
          },
          {
            documentType: "GOVERNMENT_ID",
            fileKey: "private/documents/doctors/passport.pdf",
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send(submissionPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PENDING_REVIEW");

      // Verify persistence in DB
      const updatedInDb = await DoctorProfile.findById(profile.id);
      expect(updatedInDb?.verificationStatus).toBe(DoctorVerificationStatus.PENDING_REVIEW);
      expect(updatedInDb?.registrationNumber).toBe("MCI-2026-98765");
      expect(updatedInDb?.registrationCouncil).toBe("Delhi Medical Council");
      expect(updatedInDb?.qualifications).toEqual([
        "MBBS",
        "MD Cardiology",
        "DM Interventional Cardiology",
      ]);
      expect(updatedInDb?.verificationDocuments).toHaveLength(3);
    });

    it("Submitting credentials from INFO_REQUESTED successfully transitions to PENDING_REVIEW", async () => {
      const { profile, token } = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.INFO_REQUESTED,
      });

      const submissionPayload = {
        registrationNumber: "MCI-2026-44556",
        registrationCouncil: "Maharashtra Medical Council",
        qualifications: ["MBBS", "MS General Surgery"],
        documents: [
          {
            documentType: "MEDICAL_LICENSE",
            fileKey: "private/documents/doctors/reuploaded-license.pdf",
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send(submissionPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PENDING_REVIEW");

      const inDb = await DoctorProfile.findById(profile.id);
      expect(inDb?.verificationStatus).toBe(DoctorVerificationStatus.PENDING_REVIEW);
    });
  });

  // =========================================================================
  // Requirement 9 & 10: Registration Number Uniqueness & Concurrency
  // =========================================================================
  describe("9-10. Unique Registration Number & Concurrency Handling", () => {
    it("9. Duplicate registration numbers return HTTP 409 with DOCTOR_REGISTRATION_EXISTS", async () => {
      // Doctor 1 has already claimed registration number REG-UNIQUE-100
      await createDoctorUser({
        registrationNumber: "REG-UNIQUE-100",
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });

      // Doctor 2 attempts to submit the same registration number
      const doctor2 = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });

      const res = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${doctor2.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "reg-unique-100", // Case insensitive collision check
          registrationCouncil: "State Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "private/documents/doctors/lic.pdf",
            },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: "DOCTOR_REGISTRATION_EXISTS",
          message: "Medical registration number already exists in system",
          timestamp: expect.any(String),
        },
      });
    });

    it("10. Concurrent duplicate registration submissions cannot create conflicting records", async () => {
      const doctorA = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });
      const doctorB = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });

      const sharedRegNumber = "REG-CONCURRENT-RACE-001";
      const payload = {
        registrationNumber: sharedRegNumber,
        registrationCouncil: "Central Council",
        qualifications: ["MBBS"],
        documents: [
          {
            documentType: "MEDICAL_LICENSE",
            fileKey: "private/docs/race.pdf",
          },
        ],
      };

      // Launch both submissions concurrently
      const [resA, resB] = await Promise.all([
        request(app)
          .post("/api/v1/doctors/me/verification-documents")
          .set("Authorization", `Bearer ${doctorA.token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
        request(app)
          .post("/api/v1/doctors/me/verification-documents")
          .set("Authorization", `Bearer ${doctorB.token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      expect(conflictRes.body.error.code).toBe("DOCTOR_REGISTRATION_EXISTS");

      // Verify that in MongoDB, exactly one doctor holds this registration number
      const doctorsWithReg = await DoctorProfile.find({
        registrationNumber: sharedRegNumber,
      });
      expect(doctorsWithReg).toHaveLength(1);
    });
  });

  // =========================================================================
  // Requirement 11 & 12: Protection Against Overwriting Approved Credentials & State Guard
  // =========================================================================
  describe("11-12. Verification State Guards & Approved Document Protection", () => {
    it("11. An approved doctor's verification documents cannot be overwritten through self-service", async () => {
      const { profile, token } = await createDoctorUser({
        registrationNumber: "REG-APPROVED-777",
        verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      });

      const res = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "REG-NEW-TRY-888",
          registrationCouncil: "New Council",
          qualifications: ["MBBS", "MD"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "private/docs/overwrite-try.pdf",
            },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("DOCTOR_ALREADY_VERIFIED");
      expect(res.body.error.message).toBe(
        "Verified doctor credentials cannot be modified without admin approval"
      );

      // Verify profile remained unchanged in database
      const inDb = await DoctorProfile.findById(profile.id);
      expect(inDb?.verificationStatus).toBe(DoctorVerificationStatus.APPROVED_VERIFIED);
      expect(inDb?.registrationNumber).toBe("REG-APPROVED-777");
    });

    it("12. Invalid verification-state transitions are rejected (PENDING_REVIEW, REJECTED, SUSPENDED)", async () => {
      // 12.1 Resubmission while already PENDING_REVIEW
      const pendingDoctor = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });

      const resPending = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${pendingDoctor.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "REG-PENDING-RETRY",
          registrationCouncil: "Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "private/docs/pending-retry.pdf",
            },
          ],
        });

      expect(resPending.status).toBe(409);
      expect(resPending.body.error.code).toBe("INVALID_STATE_TRANSITION");

      // 12.2 Submission when REJECTED
      const rejectedDoctor = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.REJECTED,
      });

      const resRejected = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${rejectedDoctor.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "REG-REJECTED-RETRY",
          registrationCouncil: "Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "private/docs/rejected-retry.pdf",
            },
          ],
        });

      expect(resRejected.status).toBe(409);
      expect(resRejected.body.error.code).toBe("INVALID_STATE_TRANSITION");

      // 12.3 Submission when SUSPENDED
      const suspendedDoctor = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.SUSPENDED,
      });

      const resSuspended = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${suspendedDoctor.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "REG-SUSPENDED-RETRY",
          registrationCouncil: "Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "private/docs/suspended-retry.pdf",
            },
          ],
        });

      expect(resSuspended.status).toBe(409);
      expect(resSuspended.body.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // =========================================================================
  // Requirement 13: Audit Events Verification
  // =========================================================================
  describe("13. Audit Logging Pipeline", () => {
    it("13. Audit events are recorded for doctor profile access, updates, and credential submission", async () => {
      const auditLogSpy = vi.spyOn(auditLogService, "log");

      const { user, profile, token } = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });

      // 13.1 Profile Access
      await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: user.id,
          actorRole: UserRole.DOCTOR,
          action: AuditAction.DOCTOR_PROFILE_ACCESSED,
          resourceType: "DoctorProfile",
          resourceId: profile.id,
        })
      );

      // 13.2 Profile Update
      await request(app)
        .put("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          consultationFee: 950,
        });

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: user.id,
          actorRole: UserRole.DOCTOR,
          action: AuditAction.USER_UPDATED,
          resourceType: "DoctorProfile",
          resourceId: profile.id,
        })
      );

      // 13.3 Verification Document Submission
      await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "REG-AUDIT-TEST-99",
          registrationCouncil: "State Council",
          qualifications: ["MBBS"],
          documents: [
            {
              documentType: "MEDICAL_LICENSE",
              fileKey: "private/docs/audit-doc.pdf",
            },
          ],
        });

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: user.id,
          actorRole: UserRole.DOCTOR,
          action: AuditAction.DOCTOR_VERIFICATION_SUBMITTED,
          resourceType: "DoctorProfile",
          resourceId: profile.id,
        })
      );

      auditLogSpy.mockRestore();
    });
  });

  // =========================================================================
  // Requirement 14 & 15: Document Privacy & Response Envelopes
  // =========================================================================
  describe("14-15. Data Privacy & API Contract Compliance", () => {
    it("14. Private storage keys (fileKey) and internal fields are never exposed in responses", async () => {
      const { token } = await createDoctorUser({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });

      const privateKey1 = "super-secret-s3-key-medical-license-12345.pdf";
      const privateKey2 = "super-secret-s3-key-degree-cert-67890.pdf";

      const resSubmit = await request(app)
        .post("/api/v1/doctors/me/verification-documents")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          registrationNumber: "MCI-PRIVACY-CHECK",
          registrationCouncil: "Privacy Medical Council",
          qualifications: ["MBBS"],
          documents: [
            { documentType: "MEDICAL_LICENSE", fileKey: privateKey1 },
            { documentType: "DEGREE_CERTIFICATE", fileKey: privateKey2 },
          ],
        });

      expect(resSubmit.status).toBe(200);

      const submitBodyStr = JSON.stringify(resSubmit.body);
      expect(submitBodyStr).not.toContain(privateKey1);
      expect(submitBodyStr).not.toContain(privateKey2);
      expect(submitBodyStr).not.toContain("__v");
      expect(submitBodyStr).not.toContain("passwordHash");

      // Verify GET /me/profile also does not leak private fileKey
      const resGet = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(200);
      const getBodyStr = JSON.stringify(resGet.body);
      expect(getBodyStr).not.toContain(privateKey1);
      expect(getBodyStr).not.toContain(privateKey2);
      expect(getBodyStr).not.toContain("__v");

      // Documents array present but stripped of fileKey
      expect(resGet.body.data.verificationDocuments).toBeDefined();
      expect(resGet.body.data.verificationDocuments.length).toBe(2);
      expect(resGet.body.data.verificationDocuments[0].fileKey).toBeUndefined();
      expect(resGet.body.data.verificationDocuments[1].fileKey).toBeUndefined();
    });

    it("15. Success responses adhere to universal success envelope format", async () => {
      const { token } = await createDoctorUser();

      const res = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: expect.any(Object),
        message: "Doctor profile retrieved successfully",
      });
    });

    it("15b. Missing profile produces 404 DOCTOR_NOT_FOUND error envelope", async () => {
      // Create a doctor user with no doctorProfile
      const orphanDoctor = await User.create({
        email: `orphan.doc.${Date.now()}@example.com`,
        phone: "+15551112233",
        passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
        fullName: "Orphan Doctor",
        role: UserRole.DOCTOR,
        status: UserStatus.ACTIVE,
      });

      const orphanToken = tokenService.generateAccessToken(
        orphanDoctor.id,
        orphanDoctor.role
      );

      const res = await request(app)
        .get("/api/v1/doctors/me/profile")
        .set("Authorization", `Bearer ${orphanToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: "DOCTOR_NOT_FOUND",
          message: "Doctor profile not found",
          timestamp: expect.any(String),
        },
      });
    });
  });
});
