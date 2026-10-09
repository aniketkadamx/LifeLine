import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  PatientProfile,
  DoctorProfile,
  PharmacyProfile,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";

describe("Milestone 3 - Task 3.3: User Self-Management & Auth Middleware (/api/v1/users/me)", () => {
  let ipCounter = 100;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.20.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase("mongodb://127.0.0.1:27017/lifeline_user_me_test");
    // Ensure all unique indexes (email, phone, etc.) are built
    await User.syncIndexes();
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
      await PatientProfile.deleteMany({});
      await DoctorProfile.deleteMany({});
      await PharmacyProfile.deleteMany({});
    }
  });

  // Helper: create a valid test user in MongoDB
  async function createTestUser(
    overrides: Partial<{
      email: string;
      phone: string;
      role: UserRole;
      status: UserStatus;
      fullName: string;
      avatar: string;
    }> = {}
  ) {
    const user = await User.create({
      email: overrides.email || `user.${Date.now()}.${Math.random()}@example.com`,
      phone: overrides.phone || `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: overrides.fullName || "Test User",
      role: overrides.role || UserRole.PATIENT,
      status: overrides.status || UserStatus.ACTIVE,
      avatar: overrides.avatar,
    });

    return user;
  }

  // =========================================================================
  // Authentication Middleware Tests (Cases 1 - 7)
  // =========================================================================
  describe("Authentication Middleware", () => {
    it("1. Missing Authorization header returns 401", async () => {
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("2. Malformed Bearer header returns 401", async () => {
      const res1 = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", "Basic xyz123")
        .set("x-test-client-ip", getUniqueIp());

      expect(res1.status).toBe(401);
      expect(res1.body.success).toBe(false);
      expect(res1.body.error.code).toBe("AUTH_TOKEN_INVALID");

      const res2 = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", "Bearer")
        .set("x-test-client-ip", getUniqueIp());

      expect(res2.status).toBe(401);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });

    it("3. Invalid access token returns 401", async () => {
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", "Bearer invalid.jwt.signature")
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });

    it("4. Expired access token returns 401", async () => {
      const expiredToken = jwt.sign(
        {
          sub: new mongoose.Types.ObjectId().toString(),
          role: UserRole.PATIENT,
          type: "access",
          jti: "expired-jti-test",
        },
        env.JWT_ACCESS_SECRET,
        {
          issuer: "lifeline-api",
          expiresIn: -10, // expired 10 seconds ago
        }
      );

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${expiredToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_EXPIRED");
    });

    it("5. Refresh token used as a Bearer token returns 401", async () => {
      const userId = new mongoose.Types.ObjectId().toString();
      const refreshToken = tokenService.generateRefreshToken(
        userId,
        UserRole.PATIENT,
        "test-family-1",
        "test-jti-1"
      );

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${refreshToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_INVALID");
    });

    it("6. Valid access token allows the request to continue", async () => {
      const user = await createTestUser();
      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user.id);
    });

    it("7. Authentication failures use the established error envelope", async () => {
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("success", false);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toHaveProperty("code");
      expect(res.body.error).toHaveProperty("message");
      expect(typeof res.body.error.code).toBe("string");
      expect(typeof res.body.error.message).toBe("string");
    });
  });

  // =========================================================================
  // GET /api/v1/users/me Tests (Cases 8 - 13)
  // =========================================================================
  describe("GET /api/v1/users/me", () => {
    it("8. Unauthenticated request returns 401", async () => {
      const res = await request(app)
        .get("/api/v1/users/me")
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("9. Authenticated patient receives their safe user data and linked patient profile", async () => {
      const user = await createTestUser({ role: UserRole.PATIENT });
      const patientProfile = await PatientProfile.create({
        userId: user._id,
        allergies: ["Penicillin"],
        medicalConditions: ["Asthma"],
      });
      user.patientProfile = patientProfile._id;
      await user.save();

      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.email).toBe(user.email);
      expect(res.body.data.role).toBe("PATIENT");
      expect(res.body.data.profile).toBeDefined();
      expect(res.body.data.profile.allergies).toContain("Penicillin");
      expect(res.body.data.profile.medicalConditions).toContain("Asthma");
    });

    it("10. Authenticated doctor receives their safe user data and linked doctor profile", async () => {
      const user = await createTestUser({ role: UserRole.DOCTOR });
      const doctorProfile = await DoctorProfile.create({
        userId: user._id,
        specialization: "CARDIOLOGY",
        qualifications: ["MBBS", "MD"],
        experienceYears: 10,
        registrationNumber: "REG-DOC-12345",
        registrationCouncil: "Medical Council of India",
        consultationFee: 500,
        verificationStatus: DoctorVerificationStatus.VERIFIED,
      });
      user.doctorProfile = doctorProfile._id;
      await user.save();

      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.role).toBe("DOCTOR");
      expect(res.body.data.profile).toBeDefined();
      expect(res.body.data.profile.specialization).toBe("CARDIOLOGY");
      expect(res.body.data.profile.experienceYears).toBe(10);
    });

    it("11. Authenticated pharmacy user receives their safe user data and linked pharmacy profile", async () => {
      const user = await createTestUser({ role: UserRole.PHARMACY });
      const pharmacyProfile = await PharmacyProfile.create({
        userId: user._id,
        pharmacyName: "City Health Pharmacy",
        ownerName: user.fullName,
        licenseNumber: "LIC-PHARM-9988",
        address: {
          street: "123 Main St",
          city: "Metropolis",
          state: "State",
          postalCode: "123456",
          country: "India",
        },
        phone: user.phone,
        verificationStatus: PharmacyVerificationStatus.VERIFIED,
      });
      user.pharmacyProfile = pharmacyProfile._id;
      await user.save();

      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.role).toBe("PHARMACY");
      expect(res.body.data.profile).toBeDefined();
      expect(res.body.data.profile.pharmacyName).toBe("City Health Pharmacy");
    });

    it("12. Password hashes and other private fields are never returned", async () => {
      const user = await createTestUser({ role: UserRole.PATIENT });
      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.passwordHash).toBeUndefined();
      const stringified = JSON.stringify(res.body);
      expect(stringified).not.toContain("passwordHash");
      expect(stringified).not.toContain("SomeHashedSecretPassword");
    });

    it("13. A missing persisted user is handled safely", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const token = tokenService.generateAccessToken(nonExistentId, UserRole.PATIENT);

      const res = await request(app)
        .get("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });
  });

  // =========================================================================
  // PATCH /api/v1/users/me Tests (Cases 14 - 22)
  // =========================================================================
  describe("PATCH /api/v1/users/me", () => {
    it("14. Unauthenticated request returns 401", async () => {
      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("x-test-client-ip", getUniqueIp())
        .send({ phone: "+15559876543" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("15. Valid phone update persists to MongoDB", async () => {
      const user = await createTestUser({ phone: "+15551112222" });
      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ phone: "+15559876543" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe("+15559876543");

      const persisted = await User.findById(user.id);
      expect(persisted?.phone).toBe("+15559876543");
    });

    it("16. Valid avatar update persists to MongoDB", async () => {
      const user = await createTestUser();
      const token = tokenService.generateAccessToken(user.id, user.role);
      const avatarUrl = "https://images.example.com/profiles/avatar-42.png";

      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ avatar: avatarUrl });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatar).toBe(avatarUrl);

      const persisted = await User.findById(user.id);
      expect(persisted?.avatar).toBe(avatarUrl);
    });

    it("17. Partial updates preserve fields that were not supplied", async () => {
      const initialAvatar = "https://images.example.com/profiles/existing.png";
      const user = await createTestUser({
        phone: "+15551113333",
        avatar: initialAvatar,
      });
      const token = tokenService.generateAccessToken(user.id, user.role);

      // Update ONLY phone
      const res1 = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ phone: "+15554445555" });

      expect(res1.status).toBe(200);
      expect(res1.body.data.phone).toBe("+15554445555");
      expect(res1.body.data.avatar).toBe(initialAvatar);

      // Update ONLY avatar
      const newAvatar = "https://images.example.com/profiles/updated.png";
      const res2 = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ avatar: newAvatar });

      expect(res2.status).toBe(200);
      expect(res2.body.data.phone).toBe("+15554445555");
      expect(res2.body.data.avatar).toBe(newAvatar);
    });

    it("18. Invalid phone numbers are rejected", async () => {
      const user = await createTestUser();
      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ phone: "not-a-valid-phone" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("19. Unsupported or privileged fields are rejected", async () => {
      const user = await createTestUser();
      const token = tokenService.generateAccessToken(user.id, user.role);

      // Attempt to modify role
      const resRole = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ role: "ADMIN" });

      expect(resRole.status).toBe(422);
      expect(resRole.body.error.code).toBe("VALIDATION_ERROR");

      // Attempt to modify email
      const resEmail = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ email: "hacker@evil.com" });

      expect(resEmail.status).toBe(422);
      expect(resEmail.body.error.code).toBe("VALIDATION_ERROR");

      // Attempt to modify passwordHash
      const resPass = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ passwordHash: "tampered" });

      expect(resPass.status).toBe(422);
      expect(resPass.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("20. One user cannot update another user's record by supplying another user ID", async () => {
      const userA = await createTestUser({ phone: "+15551110001" });
      const userB = await createTestUser({ phone: "+15552220002" });

      const tokenA = tokenService.generateAccessToken(userA.id, userA.role);

      // Even if attacker injects id / userId into the payload:
      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${tokenA}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          id: userB.id,
          phone: "+15559998888",
        });

      // Strict validation rejects unrecognized/privileged fields like 'id'
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");

      // User B must remain completely unchanged
      const persistedB = await User.findById(userB.id);
      expect(persistedB?.phone).toBe("+15552220002");
    });

    it("21. Duplicate phone numbers produce the established conflict response", async () => {
      const userA = await createTestUser({ phone: "+15551119999" });
      const userB = await createTestUser({ phone: "+15552229999" });

      const tokenB = tokenService.generateAccessToken(userB.id, userB.role);

      // User B attempts to change phone to User A's phone
      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ phone: userA.phone });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_PHONE_ALREADY_EXISTS");
      expect(res.body.error.message).toBe("Provided phone number is already registered");
    });

    it("22. The response never contains a password hash or private fields", async () => {
      const user = await createTestUser();
      const token = tokenService.generateAccessToken(user.id, user.role);

      const res = await request(app)
        .patch("/api/v1/users/me")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ phone: "+15557778888" });

      expect(res.status).toBe(200);
      expect(res.body.data.passwordHash).toBeUndefined();
      const stringified = JSON.stringify(res.body);
      expect(stringified).not.toContain("passwordHash");
      expect(stringified).not.toContain("SomeHashedSecretPassword");
    });
  });
});
