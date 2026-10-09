import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, PatientProfile, DoctorProfile, PharmacyProfile, RefreshToken } from "../src/models/index.js";
import { DoctorVerificationStatus, PharmacyVerificationStatus } from "../src/types/models.js";

describe("Milestone 3 - Task 3.2: User Registration & Login Endpoints", () => {
  let ipCounter = 1;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.10.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase("mongodb://127.0.0.1:27017/lifeline_auth_routes_test");
  });

  afterAll(async () => {
    // Clean up test database
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Clear collections between test cases
    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({});
      await PatientProfile.deleteMany({});
      await DoctorProfile.deleteMany({});
      await PharmacyProfile.deleteMany({});
      await RefreshToken.deleteMany({});
    }
  });

  describe("1. Registration Endpoint (POST /api/v1/auth/register)", () => {
    it("should successfully register a PATIENT and create atomic PatientProfile", async () => {
      const payload = {
        email: "patient.alice@example.com",
        password: "SecurePassword123!",
        role: "PATIENT",
        fullName: "Alice Smith",
        phone: "+15551234567",
      };

      const res = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe("patient.alice@example.com");
      expect(res.body.data.role).toBe("PATIENT");
      expect(res.body.data.status).toBe("PENDING_VERIFICATION");
      expect(res.body.data.userId).toBeDefined();
      expect(res.body.message).toBe("Registration successful. Please verify your email.");

      // Critical Security: passwordHash must never appear in response
      expect(res.body.data.passwordHash).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("passwordHash");

      // Verify User in DB
      const user = await User.findOne({ email: "patient.alice@example.com" });
      expect(user).toBeDefined();
      expect(user?.patientProfile).toBeDefined();

      // Verify PatientProfile in DB
      const profile = await PatientProfile.findOne({ userId: user?._id });
      expect(profile).toBeDefined();
      expect(profile?.userId.toString()).toBe(user?._id.toString());
    });

    it("should successfully register a DOCTOR and create unverified skeleton DoctorProfile", async () => {
      const payload = {
        email: "doctor.sarah@example.com",
        password: "SecurePassword123!",
        role: "DOCTOR",
        fullName: "Dr. Sarah Jenkins",
        phone: "+15559876543",
      };

      const res = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe("DOCTOR");
      expect(res.body.data.status).toBe("PENDING_VERIFICATION");

      // Verify DoctorProfile created with UNSUBMITTED verification status
      const user = await User.findOne({ email: "doctor.sarah@example.com" });
      expect(user?.doctorProfile).toBeDefined();

      const profile = await DoctorProfile.findOne({ userId: user?._id });
      expect(profile).toBeDefined();
      expect(profile?.verificationStatus).toBe(DoctorVerificationStatus.UNSUBMITTED);
      expect(profile?.specialization).toBe("GENERAL_MEDICINE");
      expect(profile?.qualifications).toContain("MBBS");
    });

    it("should successfully register a PHARMACY and create unverified skeleton PharmacyProfile", async () => {
      const payload = {
        email: "care.pharmacy@example.com",
        password: "SecurePassword123!",
        role: "PHARMACY",
        fullName: "City Care Pharmacy",
        phone: "+15555554321",
      };

      const res = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.role).toBe("PHARMACY");
      expect(res.body.data.status).toBe("PENDING_VERIFICATION");

      // Verify PharmacyProfile created with UNSUBMITTED verification status
      const user = await User.findOne({ email: "care.pharmacy@example.com" });
      expect(user?.pharmacyProfile).toBeDefined();

      const profile = await PharmacyProfile.findOne({ userId: user?._id });
      expect(profile).toBeDefined();
      expect(profile?.verificationStatus).toBe(PharmacyVerificationStatus.UNSUBMITTED);
      expect(profile?.pharmacyName).toBe("City Care Pharmacy's Pharmacy");
    });

    it("should reject duplicate email registration with HTTP 409", async () => {
      const payload = {
        email: "duplicate.test@example.com",
        password: "SecurePassword123!",
        role: "PATIENT",
        fullName: "Duplicate User",
        phone: "+15551112233",
      };

      // First registration
      const firstRes = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);
      expect(firstRes.status).toBe(201);

      // Second registration with same email
      const secondRes = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          ...payload,
          phone: "+15559998877", // Different phone, identical email
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.success).toBe(false);
      expect(secondRes.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");
      expect(secondRes.body.error.message).toContain("already in use");
    });

    it("should reject invalid registration payloads with HTTP 422", async () => {
      // Test 1: Weak password (no number, no special char)
      const resWeakPass = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "valid@example.com",
          password: "password",
          role: "PATIENT",
          fullName: "Valid Name",
          phone: "+15551234567",
        });
      expect(resWeakPass.status).toBe(422);
      expect(resWeakPass.body.error.code).toBe("VALIDATION_ERROR");

      // Test 2: Invalid role (ADMIN self-registration is forbidden)
      const resAdminRole = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "admin@example.com",
          password: "SecurePassword123!",
          role: "ADMIN",
          fullName: "Admin Attempt",
          phone: "+15551234567",
        });
      expect(resAdminRole.status).toBe(422);
      expect(resAdminRole.body.error.code).toBe("VALIDATION_ERROR");

      // Test 3: Malformed email
      const resBadEmail = await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "not-an-email",
          password: "SecurePassword123!",
          role: "PATIENT",
          fullName: "Valid Name",
          phone: "+15551234567",
        });
      expect(resBadEmail.status).toBe(422);
      expect(resBadEmail.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("2. Login Endpoint (POST /api/v1/auth/login)", () => {
    const userCredentials = {
      email: "login.user@example.com",
      password: "SecurePassword123!",
      role: "PATIENT",
      fullName: "Login Tester",
      phone: "+15554443322",
    };

    beforeEach(async () => {
      await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send(userCredentials);
    });

    it("should successfully authenticate with valid credentials, return accessToken, and set HttpOnly refresh cookie", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: userCredentials.email,
          password: userCredentials.password,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Login successful");
      expect(res.body.data.accessToken).toBeDefined();
      expect(typeof res.body.data.accessToken).toBe("string");
      expect(res.body.data.user.email).toBe(userCredentials.email);
      expect(res.body.data.user.fullName).toBe("Login Tester");
      expect(res.body.data.user.role).toBe("PATIENT");

      // Verify no password hash or raw refresh token in body
      expect(res.body.data.passwordHash).toBeUndefined();
      expect(res.body.data.refreshToken).toBeUndefined();

      // Verify HttpOnly cookie header
      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      const refreshCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.includes("__Secure-refresh_token="))
        : cookies;

      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain("HttpOnly");
      expect(refreshCookie).toContain("SameSite=Strict");
      expect(refreshCookie).toContain("Path=/api/v1/auth");

      // Verify lastLoginAt updated in DB
      const user = await User.findOne({ email: userCredentials.email });
      expect(user?.lastLoginAt).toBeDefined();
      expect(user?.lastLoginAt).toBeInstanceOf(Date);
    });

    it("should reject incorrect password with HTTP 401 AUTH_INVALID_CREDENTIALS", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: userCredentials.email,
          password: "WrongPassword999!",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
      expect(res.body.error.message).toBe("Invalid email or password");
    });

    it("should reject unknown email with HTTP 401 without account enumeration", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "unknown.account@example.com",
          password: "SecurePassword123!",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
      // Must match exact message as wrong password
      expect(res.body.error.message).toBe("Invalid email or password");
    });
  });

  describe("3. Refresh Token Endpoint (POST /api/v1/auth/refresh-token)", () => {
    let initialRefreshCookie: string;

    beforeEach(async () => {
      // Register and login to obtain initial refresh cookie
      await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "refresh.user@example.com",
          password: "SecurePassword123!",
          role: "DOCTOR",
          fullName: "Dr. Refresh",
          phone: "+15558887766",
        });

      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "refresh.user@example.com",
          password: "SecurePassword123!",
        });

      const cookies = loginRes.headers["set-cookie"];
      initialRefreshCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.includes("__Secure-refresh_token=")) || ""
        : cookies || "";
    });

    it("should rotate refresh token, return new accessToken, and update cookie", async () => {
      // First refresh
      const res = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("x-test-client-ip", getUniqueIp())
        .set("Cookie", initialRefreshCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.role).toBe("DOCTOR");
      expect(res.body.message).toBe("Token refreshed successfully");

      // Rotated cookie must be returned
      const rotatedCookies = res.headers["set-cookie"];
      expect(rotatedCookies).toBeDefined();
      const newCookie = Array.isArray(rotatedCookies)
        ? rotatedCookies.find((c: string) => c.includes("__Secure-refresh_token="))
        : rotatedCookies;

      expect(newCookie).toBeDefined();
      expect(newCookie).not.toBe(initialRefreshCookie);
    });

    it("should detect reuse of an old rotated refresh token and revoke the token family with HTTP 401", async () => {
      // 1. Perform legitimate rotation
      const rotateRes = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("x-test-client-ip", getUniqueIp())
        .set("Cookie", initialRefreshCookie);

      expect(rotateRes.status).toBe(200);

      // 2. Attacker attempts to replay the OLD initialRefreshCookie
      const replayRes = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("x-test-client-ip", getUniqueIp())
        .set("Cookie", initialRefreshCookie);

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.success).toBe(false);
      expect(replayRes.body.error.code).toBe("AUTH_REFRESH_TOKEN_REVOKED");
      expect(replayRes.body.error.message).toMatch(/reuse detected/i);

      // 3. Verify the entire token family was revoked: even the new cookie must now fail
      const rotatedCookies = rotateRes.headers["set-cookie"];
      const newCookie = Array.isArray(rotatedCookies)
        ? rotatedCookies.find((c: string) => c.includes("__Secure-refresh_token="))
        : rotatedCookies;

      const subsequentRes = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("x-test-client-ip", getUniqueIp())
        .set("Cookie", newCookie);

      expect(subsequentRes.status).toBe(401);
      expect(subsequentRes.body.error.code).toBe("AUTH_REFRESH_TOKEN_REVOKED");
    });
  });

  describe("4. Logout Endpoint (POST /api/v1/auth/logout)", () => {
    it("should revoke server-side refresh token and clear cookie", async () => {
      // Register and login
      await request(app)
        .post("/api/v1/auth/register")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "logout.user@example.com",
          password: "SecurePassword123!",
          role: "PATIENT",
          fullName: "Logout Tester",
          phone: "+15550009988",
        });

      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .set("x-test-client-ip", getUniqueIp())
        .send({
          email: "logout.user@example.com",
          password: "SecurePassword123!",
        });

      const cookies = loginRes.headers["set-cookie"];
      const refreshCookie = Array.isArray(cookies)
        ? cookies.find((c: string) => c.includes("__Secure-refresh_token=")) || ""
        : cookies || "";

      // Logout request
      const logoutRes = await request(app)
        .post("/api/v1/auth/logout")
        .set("x-test-client-ip", getUniqueIp())
        .set("Cookie", refreshCookie);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);
      expect(logoutRes.body.message).toBe("Logged out successfully");

      // Cookie must be cleared (Expires in past or Max-Age=0)
      const logoutCookies = logoutRes.headers["set-cookie"];
      const clearedCookie = Array.isArray(logoutCookies)
        ? logoutCookies.find((c: string) => c.includes("__Secure-refresh_token="))
        : logoutCookies;

      expect(clearedCookie).toBeDefined();

      // Subsequent refresh attempt with logged-out token must fail
      const refreshAttempt = await request(app)
        .post("/api/v1/auth/refresh-token")
        .set("x-test-client-ip", getUniqueIp())
        .set("Cookie", refreshCookie);

      expect(refreshAttempt.status).toBe(401);
      expect(refreshAttempt.body.error.code).toBe("AUTH_REFRESH_TOKEN_REVOKED");
    });
  });

  describe("5. Rate Limiting Protection (authLimiter)", () => {
    it("should trigger HTTP 429 after exceeding rate limit on repeated auth attempts", async () => {
      const fixedIp = "10.77.88.99";

      // Send 5 requests from the same fixed IP (permitted quota)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post("/api/v1/auth/login")
          .set("x-test-client-ip", fixedIp)
          .send({
            email: "nonexistent@example.com",
            password: "WrongPassword123!",
          });
      }

      // 6th request from the same IP must be rate-limited
      const blockedRes = await request(app)
        .post("/api/v1/auth/login")
        .set("x-test-client-ip", fixedIp)
        .send({
          email: "nonexistent@example.com",
          password: "WrongPassword123!",
        });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.success).toBe(false);
      expect(blockedRes.body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });
  });
});
