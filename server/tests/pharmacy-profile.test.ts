import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, PharmacyProfile, AuditLog } from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  PharmacyVerificationStatus,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 4 - Task 4.4: Pharmacy Profile & License Submission", () => {
  let ipCounter = 400;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.50.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase("mongodb://127.0.0.1:27017/lifeline_pharmacy_profile_test");
    await User.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await AuditLog.syncIndexes();
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({});
      await PharmacyProfile.deleteMany({});
      await AuditLog.deleteMany({});
    }
  });

  // Helper: creates a test pharmacy user with linked PharmacyProfile
  async function createPharmacyUser(
    profileOverrides: Partial<{
      pharmacyName: string;
      ownerName: string;
      licenseNumber: string;
      phone: string;
      email: string;
      verificationStatus: PharmacyVerificationStatus;
      deliveryAvailable: boolean;
      serviceArea: string[];
    }> = {}
  ) {
    const user = await User.create({
      email: `pharmacy.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: profileOverrides.ownerName || "Marcus Vance",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
    });

    const licNumber =
      profileOverrides.licenseNumber ||
      `LIC-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await PharmacyProfile.create({
      userId: user._id,
      pharmacyName: profileOverrides.pharmacyName || "Apex Care Pharmacy",
      ownerName: profileOverrides.ownerName || user.fullName,
      licenseNumber: licNumber,
      address: {
        street: "123 Health Blvd",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      phone: profileOverrides.phone || user.phone,
      email: profileOverrides.email || "contact@apexcare.com",
      openingHours: {
        openTime: "08:00",
        closeTime: "22:00",
        closedDays: ["Sunday"],
      },
      deliveryAvailable:
        profileOverrides.deliveryAvailable !== undefined
          ? profileOverrides.deliveryAvailable
          : true,
      serviceArea: profileOverrides.serviceArea || ["Mumbai South", "Mumbai Central"],
      verificationStatus:
        profileOverrides.verificationStatus || PharmacyVerificationStatus.UNSUBMITTED,
    });

    user.pharmacyProfile = profile._id;
    await user.save();

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, profile, token };
  }

  // Helper: creates a test doctor user
  async function createDoctorUser() {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Dr. Sarah Jenkins",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);
    return { user, token };
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

  // =========================================================================
  // Requirement 1 & 10: Access, Self-Service Updates & Preserving Omitted Fields
  // =========================================================================
  describe("1. Self-Service Profile Access & Updates", () => {
    it("1. Authenticated pharmacy can access and update their own permitted profile fields", async () => {
      const { user, profile, token } = await createPharmacyUser({
        pharmacyName: "Downtown Chemist",
        ownerName: "Robert Green",
      });

      // 1.1 Read profile
      const resGet = await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(200);
      expect(resGet.body.success).toBe(true);
      expect(resGet.body.data.id).toBe(profile.id);
      expect(resGet.body.data.userId).toBe(user.id);
      expect(resGet.body.data.pharmacyName).toBe("Downtown Chemist");
      expect(resGet.body.data.ownerName).toBe("Robert Green");

      // 1.2 Update profile via PUT
      const updatePayload = {
        pharmacyName: "Downtown Super Chemist",
        ownerName: "Robert Green Jr.",
        address: {
          street: "456 Market Lane",
          city: "Pune",
          state: "Maharashtra",
          postalCode: "411001",
          country: "India",
        },
        phone: "+15558889900",
        email: "downtown@chemist.com",
        openingHours: {
          openTime: "07:30",
          closeTime: "23:00",
          closedDays: [],
        },
        deliveryAvailable: false,
        serviceArea: ["Pune Central", "Kothrud"],
      };

      const resPut = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send(updatePayload);

      expect(resPut.status).toBe(200);
      expect(resPut.body.success).toBe(true);
      expect(resPut.body.data.pharmacyName).toBe("Downtown Super Chemist");
      expect(resPut.body.data.ownerName).toBe("Robert Green Jr.");
      expect(resPut.body.data.address.city).toBe("Pune");
      expect(resPut.body.data.phone).toBe("+15558889900");
      expect(resPut.body.data.email).toBe("downtown@chemist.com");
      expect(resPut.body.data.deliveryAvailable).toBe(false);
      expect(resPut.body.data.serviceArea).toEqual(["Pune Central", "Kothrud"]);

      // 1.3 Verify database state
      const updatedInDb = await PharmacyProfile.findById(profile.id);
      expect(updatedInDb?.pharmacyName).toBe("Downtown Super Chemist");
      expect(updatedInDb?.deliveryAvailable).toBe(false);
    });

    it("10. Omitted profile fields remain unchanged during partial updates (PATCH)", async () => {
      const { profile, token } = await createPharmacyUser({
        pharmacyName: "City Meds",
        ownerName: "Elena Rostova",
        deliveryAvailable: true,
      });

      const resPatch = await request(app)
        .patch("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          pharmacyName: "City Meds & Wellness",
        });

      expect(resPatch.status).toBe(200);
      expect(resPatch.body.success).toBe(true);
      expect(resPatch.body.data.pharmacyName).toBe("City Meds & Wellness");
      // Preserved fields
      expect(resPatch.body.data.ownerName).toBe("Elena Rostova");
      expect(resPatch.body.data.deliveryAvailable).toBe(true);

      const inDb = await PharmacyProfile.findById(profile.id);
      expect(inDb?.pharmacyName).toBe("City Meds & Wellness");
      expect(inDb?.ownerName).toBe("Elena Rostova");
      expect(inDb?.deliveryAvailable).toBe(true);
    });
  });

  // =========================================================================
  // Requirement 4: Ownership & Identity Derivation
  // =========================================================================
  describe("4. Ownership & Identity Derivation", () => {
    it("4. A pharmacy cannot modify another pharmacy's profile by supplying client IDs", async () => {
      const pharmacyA = await createPharmacyUser({ pharmacyName: "Pharmacy Alpha" });
      const pharmacyB = await createPharmacyUser({ pharmacyName: "Pharmacy Beta" });

      const res = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${pharmacyA.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          pharmacyName: "Pharmacy Alpha Updated",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(pharmacyA.profile.id);
      expect(res.body.data.pharmacyName).toBe("Pharmacy Alpha Updated");

      // Verify Pharmacy B was untouched
      const refreshedB = await PharmacyProfile.findById(pharmacyB.profile.id);
      expect(refreshedB?.pharmacyName).toBe("Pharmacy Beta");
    });
  });

  // =========================================================================
  // Requirement 2: Authentication & Authorization Enforcement
  // =========================================================================
  describe("2. Authentication & Authorization Enforcement", () => {
    it("Unauthenticated requests are rejected with HTTP 401", async () => {
      const resGet = await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("x-test-client-ip", getUniqueIp());
      expect(resGet.status).toBe(401);
      expect(resGet.body.error.code).toBe("AUTH_TOKEN_MISSING");

      const resPut = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("x-test-client-ip", getUniqueIp())
        .send({ pharmacyName: "Intruder" });
      expect(resPut.status).toBe(401);
      expect(resPut.body.error.code).toBe("AUTH_TOKEN_MISSING");

      const resLicense = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-12345",
          documents: [{ documentType: "PHARMACY_LICENSE", fileKey: "docs/lic.pdf" }],
        });
      expect(resLicense.status).toBe(401);
      expect(resLicense.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("Non-pharmacy roles (PATIENT, DOCTOR) are rejected with HTTP 403", async () => {
      const { token: patientToken } = await createPatientUser();
      const { token: doctorToken } = await createDoctorUser();

      // Patient attempting pharmacy endpoints
      const resPatientGet = await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp());
      expect(resPatientGet.status).toBe(403);
      expect(resPatientGet.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resPatientLicense = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-99999",
          documents: [{ documentType: "PHARMACY_LICENSE", fileKey: "docs/lic.pdf" }],
        });
      expect(resPatientLicense.status).toBe(403);
      expect(resPatientLicense.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Doctor attempting pharmacy endpoints
      const resDocGet = await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp());
      expect(resDocGet.status).toBe(403);
      expect(resDocGet.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      const resDocPut = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ pharmacyName: "Doctor Drug Store" });
      expect(resDocPut.status).toBe(403);
      expect(resDocPut.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });
  });

  // =========================================================================
  // Requirement 3: Input Validation & Mass-Assignment Prevention
  // =========================================================================
  describe("3. Input Validation & Mass-Assignment Prevention", () => {
    it("Mass-assignment of protected verification, license, rating, or review fields is rejected with 422", async () => {
      const { token } = await createPharmacyUser();

      // Attempting to self-verify
      const resStatus = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          verificationStatus: "APPROVED_VERIFIED",
        });

      expect(resStatus.status).toBe(422);
      expect(resStatus.body.error.code).toBe("VALIDATION_ERROR");

      // Attempting to mutate licenseNumber directly on profile
      const resLicense = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-HACKED-999",
        });

      expect(resLicense.status).toBe(422);
      expect(resLicense.body.error.code).toBe("VALIDATION_ERROR");

      // Attempting to modify rating
      const resRating = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          rating: 5,
        });

      expect(resRating.status).toBe(422);
      expect(resRating.body.error.code).toBe("VALIDATION_ERROR");

      // Unknown fields
      const resUnknown = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          arbitraryProperty: "injected",
        });

      expect(resUnknown.status).toBe(422);
      expect(resUnknown.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("Invalid license metadata and document references are rejected with 422", async () => {
      const { token } = await createPharmacyUser();

      // Empty documents array
      const resEmptyDocs = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-12345",
          documents: [],
        });

      expect(resEmptyDocs.status).toBe(422);
      expect(resEmptyDocs.body.error.code).toBe("VALIDATION_ERROR");

      // Short license number (< 5 chars)
      const resShortLic = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "123",
          documents: [
            {
              documentType: "PHARMACY_LICENSE",
              fileKey: "docs/lic.pdf",
            },
          ],
        });

      expect(resShortLic.status).toBe(422);
      expect(resShortLic.body.error.code).toBe("VALIDATION_ERROR");

      // Invalid document type
      const resInvalidType = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-VALID-123",
          documents: [
            {
              documentType: "UNSUPPORTED_DOC_TYPE",
              fileKey: "docs/lic.pdf",
            },
          ],
        });

      expect(resInvalidType.status).toBe(422);
      expect(resInvalidType.body.error.code).toBe("VALIDATION_ERROR");

      // Empty fileKey
      const resEmptyFileKey = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-VALID-123",
          documents: [
            {
              documentType: "PHARMACY_LICENSE",
              fileKey: "   ",
            },
          ],
        });

      expect(resEmptyFileKey.status).toBe(422);
      expect(resEmptyFileKey.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // Requirement 5: Valid License Submission & State Machine Transition
  // =========================================================================
  describe("5. License Submission & State Machine Transition", () => {
    it("5. Valid license submission produces the state transition to PENDING_REVIEW", async () => {
      const { profile, token } = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
      });

      const submissionPayload = {
        licenseNumber: "MH-PUN-2026-998877",
        documents: [
          {
            documentType: "PHARMACY_LICENSE",
            fileKey: "private/documents/pharmacies/retail-drug-license.pdf",
          },
          {
            documentType: "GST_CERTIFICATE",
            fileKey: "private/documents/pharmacies/gstin-cert.pdf",
          },
          {
            documentType: "ADDRESS_PROOF",
            fileKey: "private/documents/pharmacies/electricity-bill.pdf",
          },
        ],
      };

      const res = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send(submissionPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PENDING_REVIEW");

      // Verify persistence in DB
      const updatedInDb = await PharmacyProfile.findById(profile.id);
      expect(updatedInDb?.verificationStatus).toBe(PharmacyVerificationStatus.PENDING_REVIEW);
      expect(updatedInDb?.licenseNumber).toBe("MH-PUN-2026-998877");
      expect(updatedInDb?.licenseDocuments).toHaveLength(3);
    });
  });

  // =========================================================================
  // Requirement 7 & 8: State Guards & Approved Credentials Protection
  // =========================================================================
  describe("7-8. State Machine Guards & Approved License Protection", () => {
    it("8. An approved pharmacy's license credentials cannot be overwritten via self-service", async () => {
      const { profile, token } = await createPharmacyUser({
        licenseNumber: "MH-APPROVED-LIC-001",
        verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
      });

      const res = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "MH-TRY-OVERWRITE",
          documents: [
            {
              documentType: "PHARMACY_LICENSE",
              fileKey: "private/docs/overwrite.pdf",
            },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PHARMACY_ALREADY_VERIFIED");
      expect(res.body.error.message).toBe(
        "Verified pharmacy credentials cannot be modified without admin approval"
      );

      const inDb = await PharmacyProfile.findById(profile.id);
      expect(inDb?.verificationStatus).toBe(PharmacyVerificationStatus.APPROVED_VERIFIED);
      expect(inDb?.licenseNumber).toBe("MH-APPROVED-LIC-001");
    });

    it("7. Invalid verification-state transitions are rejected (PENDING_REVIEW, REJECTED, SUSPENDED)", async () => {
      // 7.1 Resubmission while already PENDING_REVIEW
      const pendingPharm = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.PENDING_REVIEW,
      });

      const resPending = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${pendingPharm.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-PENDING-RETRY",
          documents: [
            { documentType: "PHARMACY_LICENSE", fileKey: "private/docs/lic.pdf" },
          ],
        });

      expect(resPending.status).toBe(409);
      expect(resPending.body.error.code).toBe("INVALID_STATE_TRANSITION");

      // 7.2 Submission when REJECTED
      const rejectedPharm = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.REJECTED,
      });

      const resRejected = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${rejectedPharm.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-REJECTED-RETRY",
          documents: [
            { documentType: "PHARMACY_LICENSE", fileKey: "private/docs/lic.pdf" },
          ],
        });

      expect(resRejected.status).toBe(409);
      expect(resRejected.body.error.code).toBe("INVALID_STATE_TRANSITION");

      // 7.3 Submission when SUSPENDED
      const suspendedPharm = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.SUSPENDED,
      });

      const resSuspended = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${suspendedPharm.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-SUSPENDED-RETRY",
          documents: [
            { documentType: "PHARMACY_LICENSE", fileKey: "private/docs/lic.pdf" },
          ],
        });

      expect(resSuspended.status).toBe(409);
      expect(resSuspended.body.error.code).toBe("INVALID_STATE_TRANSITION");
    });
  });

  // =========================================================================
  // Requirement 9: Duplicate License & Concurrency Handling
  // =========================================================================
  describe("9. Unique License Number & Concurrency Handling", () => {
    it("Duplicate license numbers return HTTP 409 with PHARMACY_LICENSE_EXISTS", async () => {
      // Pharmacy 1 holds license LIC-UNIQUE-888
      await createPharmacyUser({
        licenseNumber: "LIC-UNIQUE-888",
        verificationStatus: PharmacyVerificationStatus.PENDING_REVIEW,
      });

      // Pharmacy 2 attempts to submit the same license number (case-insensitively)
      const pharm2 = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
      });

      const res = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${pharm2.token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "lic-unique-888",
          documents: [
            {
              documentType: "PHARMACY_LICENSE",
              fileKey: "private/docs/lic.pdf",
            },
          ],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PHARMACY_LICENSE_EXISTS");
      expect(res.body.error.message).toBe(
        "Retail drug license number already exists in system"
      );
    });

    it("Concurrent duplicate license submissions cannot create conflicting records", async () => {
      const pharmA = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
      });
      const pharmB = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
      });

      const sharedLicNumber = "LIC-CONCURRENT-RACE-777";
      const payload = {
        licenseNumber: sharedLicNumber,
        documents: [
          {
            documentType: "PHARMACY_LICENSE",
            fileKey: "private/docs/race-license.pdf",
          },
        ],
      };

      const [resA, resB] = await Promise.all([
        request(app)
          .post("/api/v1/pharmacies/me/license")
          .set("Authorization", `Bearer ${pharmA.token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
        request(app)
          .post("/api/v1/pharmacies/me/license")
          .set("Authorization", `Bearer ${pharmB.token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      expect(conflictRes.body.error.code).toBe("PHARMACY_LICENSE_EXISTS");

      // Verify that exactly one pharmacy holds this license in MongoDB
      const recordsWithLic = await PharmacyProfile.find({
        licenseNumber: sharedLicNumber,
      });
      expect(recordsWithLic).toHaveLength(1);
    });
  });

  // =========================================================================
  // Requirement 13: Audit Events Verification
  // =========================================================================
  describe("13. Audit Logging Pipeline", () => {
    it("Audit events are recorded for pharmacy profile access, updates, and license submission", async () => {
      const auditLogSpy = vi.spyOn(auditLogService, "log");

      const { user, profile, token } = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
      });

      // 13.1 Profile Access
      await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: user.id,
          actorRole: UserRole.PHARMACY,
          action: AuditAction.PHARMACY_PROFILE_ACCESSED,
          resourceType: "PharmacyProfile",
          resourceId: profile.id,
        })
      );

      // 13.2 Profile Update
      await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          pharmacyName: "Health Plus Chemist",
        });

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: user.id,
          actorRole: UserRole.PHARMACY,
          action: AuditAction.USER_UPDATED,
          resourceType: "PharmacyProfile",
          resourceId: profile.id,
        })
      );

      // 13.3 License Submission
      await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-AUDIT-TEST-55",
          documents: [
            {
              documentType: "PHARMACY_LICENSE",
              fileKey: "private/docs/audit-pharmacy.pdf",
            },
          ],
        });

      expect(auditLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: user.id,
          actorRole: UserRole.PHARMACY,
          action: AuditAction.PHARMACY_LICENSE_SUBMITTED,
          resourceType: "PharmacyProfile",
          resourceId: profile.id,
        })
      );

      auditLogSpy.mockRestore();
    });
  });

  // =========================================================================
  // Requirement 11, 12 & 14: Data Privacy & Error Envelope Compliance
  // =========================================================================
  describe("11, 12, 14. Data Privacy & API Contract Compliance", () => {
    it("12. Private storage keys (fileKey) and internal fields are never exposed in responses", async () => {
      const { token } = await createPharmacyUser({
        verificationStatus: PharmacyVerificationStatus.UNSUBMITTED,
      });

      const privateKey1 = "super-secret-s3-key-retail-drug-license-999.pdf";
      const privateKey2 = "super-secret-s3-key-gst-cert-888.pdf";

      const resSubmit = await request(app)
        .post("/api/v1/pharmacies/me/license")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          licenseNumber: "LIC-PRIVACY-CHECK",
          documents: [
            { documentType: "PHARMACY_LICENSE", fileKey: privateKey1 },
            { documentType: "GST_CERTIFICATE", fileKey: privateKey2 },
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
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resGet.status).toBe(200);
      const getBodyStr = JSON.stringify(resGet.body);
      expect(getBodyStr).not.toContain(privateKey1);
      expect(getBodyStr).not.toContain(privateKey2);
      expect(getBodyStr).not.toContain("__v");

      expect(resGet.body.data.licenseDocuments).toBeDefined();
      expect(resGet.body.data.licenseDocuments.length).toBe(2);
      expect(resGet.body.data.licenseDocuments[0].fileKey).toBeUndefined();
      expect(resGet.body.data.licenseDocuments[1].fileKey).toBeUndefined();

      // Verify PUT /me/profile also does not leak private fileKey
      const resPut = await request(app)
        .put("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ pharmacyName: "Privacy Confirmed Pharmacy" });

      expect(resPut.status).toBe(200);
      const putBodyStr = JSON.stringify(resPut.body);
      expect(putBodyStr).not.toContain(privateKey1);
      expect(putBodyStr).not.toContain(privateKey2);
      expect(putBodyStr).not.toContain("__v");
      expect(resPut.body.data.licenseDocuments[0].fileKey).toBeUndefined();
      expect(resPut.body.data.licenseDocuments[1].fileKey).toBeUndefined();
    });

    it("14. Success responses adhere to universal success envelope format", async () => {
      const { token } = await createPharmacyUser();

      const res = await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        data: expect.any(Object),
        message: "Pharmacy profile retrieved successfully",
      });
    });

    it("11. Missing pharmacy profile produces 404 PHARMACY_NOT_FOUND error envelope", async () => {
      // Create a pharmacy user with no linked PharmacyProfile
      const orphanPharmacy = await User.create({
        email: `orphan.pharmacy.${Date.now()}@example.com`,
        phone: "+15552223344",
        passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
        fullName: "Orphan Pharmacist",
        role: UserRole.PHARMACY,
        status: UserStatus.ACTIVE,
      });

      const orphanToken = tokenService.generateAccessToken(
        orphanPharmacy.id,
        orphanPharmacy.role
      );

      const res = await request(app)
        .get("/api/v1/pharmacies/me/profile")
        .set("Authorization", `Bearer ${orphanToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: "PHARMACY_NOT_FOUND",
          message: "Pharmacy profile not found",
          timestamp: expect.any(String),
        },
      });
    });
  });
});
