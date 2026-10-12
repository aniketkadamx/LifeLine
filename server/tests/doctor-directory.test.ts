import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, DoctorProfile } from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  ConsultationType,
} from "../src/types/models.js";

describe("Milestone 5 - Task 5.1: Public Doctor Directory Search & Filtering", () => {
  let ipCounter = 1200;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.120.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_doctor_directory_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
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
      await DoctorProfile.deleteMany({});
    }
  });

  // Helper: creates a doctor user and profile with customizable attributes
  async function createDoctorFixture(overrides: {
    fullName?: string;
    userStatus?: UserStatus;
    verificationStatus?: DoctorVerificationStatus;
    specialization?: string;
    qualifications?: string[];
    experienceYears?: number;
    clinicName?: string;
    city?: string;
    postalCode?: string;
    state?: string;
    consultationFee?: number;
    rating?: number;
    totalReviews?: number;
    languages?: string[];
  } = {}) {
    const user = await User.create({
      email: `doc.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: overrides.fullName || "Dr. Sarah Jenkins",
      role: UserRole.DOCTOR,
      status: overrides.userStatus || UserStatus.ACTIVE,
      avatar: "https://storage.lifeline.internal/avatars/dr-sarah.png",
      emailVerified: true,
      phoneVerified: true,
    });

    const regNumber = `REG-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: overrides.specialization || "Cardiology",
      qualifications: overrides.qualifications || ["MBBS", "MD Cardiology"],
      experienceYears: overrides.experienceYears ?? 10,
      registrationNumber: regNumber,
      registrationCouncil: "Maharashtra Medical Council",
      clinicName: overrides.clinicName || "City Heart Clinic",
      clinicAddress: {
        street: "45 Marine Drive",
        city: overrides.city || "Mumbai",
        state: overrides.state || "Maharashtra",
        postalCode: overrides.postalCode || "400020",
        country: "India",
      },
      languages: overrides.languages || ["English", "Hindi"],
      consultationFee: overrides.consultationFee ?? 1200,
      consultationTypes: [ConsultationType.VIDEO, ConsultationType.CHAT],
      bio: "Board-certified cardiologist specializing in preventive cardiology.",
      verificationStatus:
        overrides.verificationStatus || DoctorVerificationStatus.APPROVED_VERIFIED,
      verificationDocuments: [
        {
          documentType: "MEDICAL_LICENSE",
          fileKey: "private/documents/secret-license-key-999.pdf",
          uploadedAt: new Date(),
        },
      ],
      verificationReviewedBy: new mongoose.Types.ObjectId(),
      verificationReviewedAt: new Date(),
      verificationNotes: "Internal administrative approval notes - strictly secret",
      rating: overrides.rating ?? 4.8,
      totalReviews: overrides.totalReviews ?? 25,
    });

    return { user, profile };
  }

  // =========================================================================
  // 1. Eligibility Filtering (APPROVED_VERIFIED & ACTIVE)
  // =========================================================================
  describe("1. Directory Eligibility Enforcement", () => {
    it("returns eligible verified and active doctors in the public directory", async () => {
      await createDoctorFixture({
        fullName: "Dr. Gregory House",
        verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
        userStatus: UserStatus.ACTIVE,
      });

      const res = await request(app)
        .get("/api/v1/doctors")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Dr. Gregory House");
      expect(res.body.meta.total).toBe(1);
    });

    it("excludes doctors who are UNSUBMITTED, PENDING_REVIEW, INFO_REQUESTED, or REJECTED", async () => {
      await createDoctorFixture({
        fullName: "Dr. Unsubmitted",
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });
      await createDoctorFixture({
        fullName: "Dr. Pending",
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });
      await createDoctorFixture({
        fullName: "Dr. InfoRequested",
        verificationStatus: DoctorVerificationStatus.INFO_REQUESTED,
      });
      await createDoctorFixture({
        fullName: "Dr. Rejected",
        verificationStatus: DoctorVerificationStatus.REJECTED,
      });

      const res = await request(app)
        .get("/api/v1/doctors")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it("excludes verified doctors whose user account is SUSPENDED or DEACTIVATED", async () => {
      await createDoctorFixture({
        fullName: "Dr. Suspended User",
        verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
        userStatus: UserStatus.SUSPENDED,
      });
      await createDoctorFixture({
        fullName: "Dr. Deactivated User",
        verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
        userStatus: UserStatus.DEACTIVATED,
      });

      const res = await request(app)
        .get("/api/v1/doctors")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it("excludes ineligible doctor from direct detail lookup (/api/v1/doctors/:id) with 404 DOCTOR_NOT_FOUND", async () => {
      const { profile: pendingDoc } = await createDoctorFixture({
        fullName: "Dr. Pending Doctor",
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });
      const { profile: suspendedUserDoc } = await createDoctorFixture({
        fullName: "Dr. Suspended Doctor",
        verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
        userStatus: UserStatus.SUSPENDED,
      });

      const resPending = await request(app)
        .get(`/api/v1/doctors/${pendingDoc._id.toString()}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resPending.status).toBe(404);
      expect(resPending.body.success).toBe(false);
      expect(resPending.body.error.code).toBe("DOCTOR_NOT_FOUND");

      const resSuspended = await request(app)
        .get(`/api/v1/doctors/${suspendedUserDoc._id.toString()}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resSuspended.status).toBe(404);
      expect(resSuspended.body.success).toBe(false);
      expect(resSuspended.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });
  });

  // =========================================================================
  // 2. Search & Filtering Engine
  // =========================================================================
  describe("2. Filtering by Specialization, Location, Experience, Rating, Fee & Search", () => {
    beforeEach(async () => {
      // Seed diverse set of verified active doctors
      await createDoctorFixture({
        fullName: "Dr. Sarah Jenkins",
        specialization: "Cardiology",
        city: "Mumbai",
        postalCode: "400001",
        experienceYears: 12,
        rating: 4.9,
        totalReviews: 40,
        consultationFee: 1500,
        clinicName: "Apollo Heart Centre",
      });

      await createDoctorFixture({
        fullName: "Dr. Rajesh Sharma",
        specialization: "Dermatology",
        city: "Pune",
        postalCode: "411001",
        experienceYears: 6,
        rating: 4.2,
        totalReviews: 15,
        consultationFee: 800,
        clinicName: "Skin Glow Clinic",
      });

      await createDoctorFixture({
        fullName: "Dr. Anita Desai",
        specialization: "Pediatrics",
        city: "Mumbai",
        postalCode: "400050",
        experienceYears: 15,
        rating: 4.8,
        totalReviews: 50,
        consultationFee: 1000,
        clinicName: "Kids Care Hospital",
      });

      await createDoctorFixture({
        fullName: "Dr. Vikram Seth",
        specialization: "Cardiology",
        city: "Delhi",
        postalCode: "110001",
        experienceYears: 4,
        rating: 3.8,
        totalReviews: 8,
        consultationFee: 600,
        clinicName: "Delhi Cardio Care",
      });
    });

    it("filters doctors by specialization (case-insensitive)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?specialization=cardiology")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(
        res.body.data.every((d: any) => d.specialization === "Cardiology")
      ).toBe(true);
    });

    it("filters doctors by location (city or postal code)", async () => {
      const resMumbai = await request(app)
        .get("/api/v1/doctors?location=mumbai")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resMumbai.status).toBe(200);
      expect(resMumbai.body.data).toHaveLength(2);
      expect(
        resMumbai.body.data.every((d: any) => d.clinicAddress?.city === "Mumbai")
      ).toBe(true);

      const resPostal = await request(app)
        .get("/api/v1/doctors?location=411001")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resPostal.status).toBe(200);
      expect(resPostal.body.data).toHaveLength(1);
      expect(resPostal.body.data[0].name).toBe("Dr. Rajesh Sharma");
    });

    it("filters doctors by minimum experience (minExperience)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?minExperience=10")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(
        res.body.data.every((d: any) => d.experienceYears >= 10)
      ).toBe(true);
    });

    it("filters doctors by minimum rating (minRating)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?minRating=4.5")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((d: any) => d.rating >= 4.5)).toBe(true);
    });

    it("filters doctors by maximum consultation fee (maxFee)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?maxFee=1000")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3); // Rajesh (800), Anita (1000), Vikram (600)
      for (const d of res.body.data) {
        expect(d.consultationFee).toBeLessThanOrEqual(1000);
      }

      const resLower = await request(app)
        .get("/api/v1/doctors?maxFee=700")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resLower.status).toBe(200);
      expect(resLower.body.data).toHaveLength(1);
      expect(resLower.body.data[0].name).toBe("Dr. Vikram Seth");
      expect(resLower.body.data[0].consultationFee).toBe(600);
    });

    it("performs text search across doctor name and clinic name", async () => {
      const resDocName = await request(app)
        .get("/api/v1/doctors?search=anita")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resDocName.status).toBe(200);
      expect(resDocName.body.data).toHaveLength(1);
      expect(resDocName.body.data[0].name).toBe("Dr. Anita Desai");

      const resClinic = await request(app)
        .get("/api/v1/doctors?search=Apollo")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resClinic.status).toBe(200);
      expect(resClinic.body.data).toHaveLength(1);
      expect(resClinic.body.data[0].clinicName).toBe("Apollo Heart Centre");
    });

    it("combines multiple filters correctly", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?specialization=Cardiology&location=Mumbai&minRating=4.5&minExperience=10")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe("Dr. Sarah Jenkins");
      expect(res.body.data[0].specialization).toBe("Cardiology");
    });
  });

  // =========================================================================
  // 3. Pagination, Sorting & Metadata
  // =========================================================================
  describe("3. Pagination & Deterministic Sorting", () => {
    beforeEach(async () => {
      for (let i = 1; i <= 25; i++) {
        await createDoctorFixture({
          fullName: `Dr. Candidate ${String(i).padStart(2, "0")}`,
          specialization: "General Physician",
          consultationFee: 500 + i * 50,
          rating: Number((3 + (i / 25) * 2).toFixed(1)),
          experienceYears: i,
        });
      }
    });

    it("applies default pagination when limit is omitted (page=1, limit=20)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.total).toBe(25);
      expect(res.body.meta.totalPages).toBe(2);
      expect(res.body.meta.hasNextPage).toBe(true);
      expect(res.body.meta.hasPrevPage).toBe(false);
    });

    it("supports custom page with default limit (page=2, limit=20)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?page=2")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.meta.page).toBe(2);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.total).toBe(25);
      expect(res.body.meta.totalPages).toBe(2);
      expect(res.body.meta.hasNextPage).toBe(false);
      expect(res.body.meta.hasPrevPage).toBe(true);
    });

    it("supports explicit valid limits (limit=5)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?page=1&limit=5")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(5);
      expect(res.body.meta.total).toBe(25);
      expect(res.body.meta.totalPages).toBe(5);
      expect(res.body.meta.hasNextPage).toBe(true);
    });

    it("supports maximum limit of 100", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?limit=100")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(25);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(100);
      expect(res.body.meta.total).toBe(25);
      expect(res.body.meta.totalPages).toBe(1);
      expect(res.body.meta.hasNextPage).toBe(false);
    });

    it("supports sorting by consultationFee ascending", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?sort=fee&order=asc&limit=5")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      const fees = res.body.data.map((d: any) => d.consultationFee);
      expect(fees[0]).toBeLessThanOrEqual(fees[1]);
      expect(fees[1]).toBeLessThanOrEqual(fees[2]);
    });

    it("handles empty results gracefully with 200 OK and empty array", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?specialization=NonExistentSpecialty")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
      expect(res.body.meta.totalPages).toBe(0);
    });
  });

  // =========================================================================
  // 4. Query Validation & Error Envelopes
  // =========================================================================
  describe("4. Query Validation & Error Taxonomies", () => {
    it("returns 422 VALIDATION_ERROR when limit exceeds maximum allowed (limit=101)", async () => {
      const res = await request(app)
        .get("/api/v1/doctors?limit=101")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 VALIDATION_ERROR when unknown query parameters or unapproved aliases are passed", async () => {
      const resMinFee = await request(app)
        .get("/api/v1/doctors?minFee=500")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resMinFee.status).toBe(422);
      expect(resMinFee.body.success).toBe(false);
      expect(resMinFee.body.error.code).toBe("VALIDATION_ERROR");

      const resExp = await request(app)
        .get("/api/v1/doctors?experience=5")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resExp.status).toBe(422);
      expect(resExp.body.error.code).toBe("VALIDATION_ERROR");

      const resRating = await request(app)
        .get("/api/v1/doctors?rating=4")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resRating.status).toBe(422);
      expect(resRating.body.error.code).toBe("VALIDATION_ERROR");

      const resInjection = await request(app)
        .get("/api/v1/doctors?unrecognizedField=injectionAttempt")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resInjection.status).toBe(422);
      expect(resInjection.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 VALIDATION_ERROR for negative maxFee, negative minExperience or invalid minRating", async () => {
      const resNegFee = await request(app)
        .get("/api/v1/doctors?maxFee=-100")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resNegFee.status).toBe(422);
      expect(resNegFee.body.error.code).toBe("VALIDATION_ERROR");

      const resNegExp = await request(app)
        .get("/api/v1/doctors?minExperience=-5")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resNegExp.status).toBe(422);
      expect(resNegExp.body.error.code).toBe("VALIDATION_ERROR");

      const resBadRating = await request(app)
        .get("/api/v1/doctors?minRating=6.5")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resBadRating.status).toBe(422);
      expect(resBadRating.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 BAD_REQUEST for malformed doctor identifier in detail endpoint (non-hex, invalid length)", async () => {
      const resNonHex = await request(app)
        .get("/api/v1/doctors/invalid-not-hex-id")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resNonHex.status).toBe(400);
      expect(resNonHex.body.success).toBe(false);
      expect(resNonHex.body.error.code).toBe("BAD_REQUEST");

      const resShort = await request(app)
        .get("/api/v1/doctors/507f1f77bcf86cd79943901")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resShort.status).toBe(400);
      expect(resShort.body.success).toBe(false);
      expect(resShort.body.error.code).toBe("BAD_REQUEST");

      const resLong = await request(app)
        .get("/api/v1/doctors/507f1f77bcf86cd799439011aabb")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resLong.status).toBe(400);
      expect(resLong.body.success).toBe(false);
      expect(resLong.body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 404 DOCTOR_NOT_FOUND when valid ObjectId does not exist", async () => {
      const randomId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/doctors/${randomId}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });
  });

  // =========================================================================
  // 5. Data Privacy & Response Sanitization
  // =========================================================================
  describe("5. Data Privacy & Sensitive Information Protection", () => {
    it("never exposes verification documents, fileKey, review notes or passwords in list response", async () => {
      await createDoctorFixture({
        fullName: "Dr. Sensitive Test",
        specialization: "Neurology",
      });

      const res = await request(app)
        .get("/api/v1/doctors")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      const doctor = res.body.data[0];

      // Public allowed attributes
      expect(doctor.name).toBe("Dr. Sensitive Test");
      expect(doctor.specialization).toBe("Neurology");
      expect(doctor.consultationFee).toBeDefined();

      // Protected/private attributes MUST be undefined
      expect(doctor.fileKey).toBeUndefined();
      expect(doctor.verificationDocuments).toBeUndefined();
      expect(doctor.verificationNotes).toBeUndefined();
      expect(doctor.verificationReviewedBy).toBeUndefined();
      expect(doctor.verificationReviewedAt).toBeUndefined();
      expect(doctor.passwordHash).toBeUndefined();
      expect(doctor.__v).toBeUndefined();
      expect(doctor.phone).toBeUndefined(); // Doctor's private phone must not leak
      expect(doctor.email).toBeUndefined(); // Doctor's private email must not leak
    });

    it("never exposes verification documents, fileKey, review notes or passwords in detail response", async () => {
      const { profile } = await createDoctorFixture({
        fullName: "Dr. Detailed Sensitive Test",
        specialization: "Oncology",
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id.toString()}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const doctor = res.body.data;

      expect(doctor.name).toBe("Dr. Detailed Sensitive Test");
      expect(doctor.bio).toBeDefined();
      expect(doctor.registrationCouncil).toBeDefined();

      // Protected fields MUST be absent
      expect(doctor.fileKey).toBeUndefined();
      expect(doctor.verificationDocuments).toBeUndefined();
      expect(doctor.verificationNotes).toBeUndefined();
      expect(doctor.verificationReviewedBy).toBeUndefined();
      expect(doctor.passwordHash).toBeUndefined();
      expect(doctor.phone).toBeUndefined();
      expect(doctor.email).toBeUndefined();
    });
  });
});
