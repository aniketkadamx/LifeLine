import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { User, DoctorProfile, DoctorAvailability } from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  DayOfWeek,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";

describe("Milestone 5 - Task 5.2: Doctor Working Hours & Availability Builder", () => {
  let ipCounter = 2000;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.130.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_doctor_availability_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await DoctorAvailability.syncIndexes();
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
      await DoctorAvailability.deleteMany({});
    }
  });

  // Helper: creates a verified doctor with auth token
  async function createDoctorFixture(
    overrides: {
      fullName?: string;
      verificationStatus?: DoctorVerificationStatus;
      userStatus?: UserStatus;
    } = {}
  ) {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: overrides.fullName || "Dr. Sarah Jenkins",
      role: UserRole.DOCTOR,
      status: overrides.userStatus || UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const regNumber = `REG-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: "Cardiology",
      qualifications: ["MBBS", "MD Cardiology"],
      experienceYears: 10,
      registrationNumber: regNumber,
      registrationCouncil: "State Medical Council",
      consultationFee: 1000,
      verificationStatus:
        overrides.verificationStatus || DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    user.doctorProfile = profile._id;
    await user.save();

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, profile, token };
  }

  // Helper: creates a non-doctor user (e.g. Patient)
  async function createPatientFixture() {
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
  // 1. Authentication & Role / Verification Authorization
  // =========================================================================
  describe("1. Security & Authorization Checks", () => {
    it("rejects unauthenticated requests with 401 AUTH_TOKEN_MISSING", async () => {
      const resGet = await request(app)
        .get("/api/v1/doctors/me/availability")
        .set("X-Forwarded-For", getUniqueIp());

      expect(resGet.status).toBe(401);
      expect(resGet.body.error.code).toBe("AUTH_TOKEN_MISSING");

      const resPut = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 30,
          weeklySchedule: [],
        });

      expect(resPut.status).toBe(401);
      expect(resPut.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("rejects non-doctor users (e.g. Patient) with 403 AUTH_INSUFFICIENT_PERMISSIONS", async () => {
      const { token: patientToken } = await createPatientFixture();

      const res = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 30,
          weeklySchedule: [],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("rejects unverified doctors (UNSUBMITTED / PENDING_REVIEW / REJECTED) with 403 DOCTOR_NOT_VERIFIED", async () => {
      const { token: unsubmittedToken } = await createDoctorFixture({
        verificationStatus: DoctorVerificationStatus.UNSUBMITTED,
      });

      const resUnsubmitted = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${unsubmittedToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 30,
          weeklySchedule: [
            {
              dayOfWeek: DayOfWeek.MONDAY,
              shifts: [{ startTime: "09:00", endTime: "13:00" }],
            },
          ],
        });

      expect(resUnsubmitted.status).toBe(403);
      expect(resUnsubmitted.body.error.code).toBe("DOCTOR_NOT_VERIFIED");

      const { token: pendingToken } = await createDoctorFixture({
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });

      const resPending = await request(app)
        .get("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${pendingToken}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resPending.status).toBe(403);
      expect(resPending.body.error.code).toBe("DOCTOR_NOT_VERIFIED");
    });
  });

  // =========================================================================
  // 2. Recurring Weekly Schedule Configuration
  // =========================================================================
  describe("2. Recurring Weekly Schedule Configuration", () => {
    it("configures a valid recurring weekly schedule with split shifts (e.g. Mon 09:00-13:00, 14:00-18:00)", async () => {
      const { token } = await createDoctorFixture();

      const validPayload = {
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.MONDAY,
            shifts: [
              { startTime: "09:00", endTime: "13:00" },
              { startTime: "14:00", endTime: "18:00" },
            ],
          },
          {
            dayOfWeek: DayOfWeek.WEDNESDAY,
            shifts: [{ startTime: "10:00", endTime: "16:00" }],
          },
        ],
      };

      const res = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send(validPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slotDurationMinutes).toBe(30);
      expect(res.body.data.weeklySchedule).toHaveLength(2);
      expect(res.body.data.weeklySchedule[0].dayOfWeek).toBe("MONDAY");
      expect(res.body.data.weeklySchedule[0].shifts).toHaveLength(2);

      // Verify retrieval via GET /api/v1/doctors/me/availability
      const resGet = await request(app)
        .get("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resGet.status).toBe(200);
      expect(resGet.body.data.weeklySchedule).toHaveLength(2);
      expect(resGet.body.data.weeklySchedule[0].shifts[0].startTime).toBe("09:00");
    });

    it("permits multiple non-overlapping shifts on one day", async () => {
      const { token } = await createDoctorFixture();

      const payload = {
        slotDurationMinutes: 60,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.FRIDAY,
            shifts: [
              { startTime: "08:00", endTime: "11:00" },
              { startTime: "12:00", endTime: "15:00" },
              { startTime: "16:00", endTime: "19:00" },
            ],
          },
        ],
      };

      const res = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.data.weeklySchedule[0].shifts).toHaveLength(3);
    });

    it("rejects overlapping shifts within the same day", async () => {
      const { token } = await createDoctorFixture();

      // Intersecting shifts: 09:00-13:00 and 12:00-15:00
      const overlappingPayload = {
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.TUESDAY,
            shifts: [
              { startTime: "09:00", endTime: "13:00" },
              { startTime: "12:00", endTime: "15:00" },
            ],
          },
        ],
      };

      const res = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send(overlappingPayload);

      expect([409, 422]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it("rejects shift start times that do not precede shift end times (AVAILABILITY_SLOT_INVALID)", async () => {
      const { token } = await createDoctorFixture();

      // End time before start time
      const invertedPayload = {
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.MONDAY,
            shifts: [{ startTime: "15:00", endTime: "09:00" }],
          },
        ],
      };

      const resInverted = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send(invertedPayload);

      expect(resInverted.status).toBe(422);
      expect(resInverted.body.success).toBe(false);

      // Start time equals end time
      const equalPayload = {
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.MONDAY,
            shifts: [{ startTime: "10:00", endTime: "10:00" }],
          },
        ],
      };

      const resEqual = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send(equalPayload);

      expect(resEqual.status).toBe(422);
      expect(resEqual.body.success).toBe(false);
    });

    it("strictly validates time strings to HH:mm 24-hour format", async () => {
      const { token } = await createDoctorFixture();

      const invalidTimes = [
        "9:00",
        "25:00",
        "09:65",
        "morning",
        "09-00",
        "12:00 PM",
      ];

      for (const badTime of invalidTimes) {
        const res = await request(app)
          .put("/api/v1/doctors/me/availability")
          .set("Authorization", `Bearer ${token}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            slotDurationMinutes: 30,
            weeklySchedule: [
              {
                dayOfWeek: DayOfWeek.MONDAY,
                shifts: [{ startTime: badTime, endTime: "12:00" }],
              },
            ],
          });

        expect(res.status).toBe(422);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("accepts supported slot durations 15, 30, and 60 minutes", async () => {
      const { token } = await createDoctorFixture();

      for (const slotDuration of [15, 30, 60]) {
        const res = await request(app)
          .put("/api/v1/doctors/me/availability")
          .set("Authorization", `Bearer ${token}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            slotDurationMinutes: slotDuration,
            weeklySchedule: [
              {
                dayOfWeek: DayOfWeek.THURSDAY,
                shifts: [{ startTime: "09:00", endTime: "12:00" }],
              },
            ],
          });

        expect(res.status).toBe(200);
        expect(res.body.data.slotDurationMinutes).toBe(slotDuration);
      }
    });

    it("rejects unsupported slot durations (e.g. 20, 45, 90, 0, -15)", async () => {
      const { token } = await createDoctorFixture();

      for (const badDuration of [20, 45, 90, 0, -15]) {
        const res = await request(app)
          .put("/api/v1/doctors/me/availability")
          .set("Authorization", `Bearer ${token}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            slotDurationMinutes: badDuration,
            weeklySchedule: [
              {
                dayOfWeek: DayOfWeek.THURSDAY,
                shifts: [{ startTime: "09:00", endTime: "12:00" }],
              },
            ],
          });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects shift durations that are incompatible with slotDurationMinutes", async () => {
      const { token } = await createDoctorFixture();

      // Shift is 45 minutes (09:00 to 09:45), but slotDuration is 60 minutes
      const res = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 60,
          weeklySchedule: [
            {
              dayOfWeek: DayOfWeek.MONDAY,
              shifts: [{ startTime: "09:00", endTime: "09:45" }],
            },
          ],
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // 3. Date-Specific Schedule Exceptions & Leave
  // =========================================================================
  describe("3. Date-Specific Schedule Exceptions & Leave Management", () => {
    it("creates a leave exception (isAvailable: false) successfully", async () => {
      const { token } = await createDoctorFixture();

      const res = await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-11-15",
          isAvailable: false,
          reason: "Attending Annual Cardiology Conference",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.createdException.date).toBe("2026-11-15");
      expect(res.body.data.createdException.isAvailable).toBe(false);
      expect(res.body.data.createdException.reason).toBe(
        "Attending Annual Cardiology Conference"
      );

      // Verify leave exception is visible in doctor availability schedule
      const resGet = await request(app)
        .get("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resGet.status).toBe(200);
      expect(resGet.body.data.exceptions).toHaveLength(1);
      expect(resGet.body.data.exceptions[0].date).toBe("2026-11-15");
    });

    it("creates a working exception with custom shifts (isAvailable: true)", async () => {
      const { token } = await createDoctorFixture();

      const res = await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-11-20",
          isAvailable: true,
          reason: "Special Holiday Clinic",
          shifts: [
            { startTime: "10:00", endTime: "14:00" },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.createdException.isAvailable).toBe(true);
      expect(res.body.data.createdException.shifts).toHaveLength(1);
    });

    it("rejects duplicate exceptions for the same date with 409 AVAILABILITY_LEAVE_CONFLICT", async () => {
      const { token } = await createDoctorFixture();

      // First creation succeeds
      await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-12-25",
          isAvailable: false,
          reason: "Christmas Leave",
        });

      // Duplicate creation fails with conflict
      const resDup = await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-12-25",
          isAvailable: false,
          reason: "Duplicate Christmas Request",
        });

      expect(resDup.status).toBe(409);
      expect(resDup.body.error.code).toBe("AVAILABILITY_LEAVE_CONFLICT");
    });

    it("rejects contradictory exception data (e.g. leave with shifts, or working with no shifts)", async () => {
      const { token } = await createDoctorFixture();

      // Contradictory: isAvailable === false (leave) but shifts provided
      const resLeaveWithShifts = await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-11-10",
          isAvailable: false,
          shifts: [{ startTime: "09:00", endTime: "13:00" }],
        });

      expect(resLeaveWithShifts.status).toBe(422);
      expect(resLeaveWithShifts.body.error.code).toBe("VALIDATION_ERROR");

      // Contradictory: isAvailable === true (working) but no shifts provided
      const resWorkNoShifts = await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-11-10",
          isAvailable: true,
          shifts: [],
        });

      expect(resWorkNoShifts.status).toBe(422);
      expect(resWorkNoShifts.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects invalid date strings (malformed or invalid calendar dates)", async () => {
      const { token } = await createDoctorFixture();

      const invalidDates = [
        "15-11-2026",
        "2026/11/15",
        "invalid-date",
        "2026-02-31", // February 31st does not exist
      ];

      for (const badDate of invalidDates) {
        const res = await request(app)
          .post("/api/v1/doctors/me/availability/exceptions")
          .set("Authorization", `Bearer ${token}`)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            date: badDate,
            isAvailable: false,
          });

        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("deletes an existing date-specific exception successfully", async () => {
      const { token } = await createDoctorFixture();

      await request(app)
        .post("/api/v1/doctors/me/availability/exceptions")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          date: "2026-10-31",
          isAvailable: false,
          reason: "Halloween",
        });

      const resDel = await request(app)
        .delete("/api/v1/doctors/me/availability/exceptions/2026-10-31")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resDel.status).toBe(200);
      expect(resDel.body.success).toBe(true);
      expect(resDel.body.data.exceptions).toHaveLength(0);

      // Deleting again returns 404
      const resDelAgain = await request(app)
        .delete("/api/v1/doctors/me/availability/exceptions/2026-10-31")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resDelAgain.status).toBe(404);
    });
  });

  // =========================================================================
  // 4. Multi-Doctor Isolation & Strict Payload Validation
  // =========================================================================
  describe("4. Multi-Doctor Isolation & Strict Payload Validation", () => {
    it("ensures strict schedule isolation between different doctors", async () => {
      const { token: doctorAToken } = await createDoctorFixture({
        fullName: "Dr. Doctor A",
      });
      const { token: doctorBToken } = await createDoctorFixture({
        fullName: "Dr. Doctor B",
      });

      // Doctor A configures Monday schedule
      await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${doctorAToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 15,
          weeklySchedule: [
            {
              dayOfWeek: DayOfWeek.MONDAY,
              shifts: [{ startTime: "09:00", endTime: "12:00" }],
            },
          ],
        });

      // Doctor B configures Friday schedule
      await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${doctorBToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 60,
          weeklySchedule: [
            {
              dayOfWeek: DayOfWeek.FRIDAY,
              shifts: [{ startTime: "14:00", endTime: "18:00" }],
            },
          ],
        });

      // Check Doctor A sees ONLY Monday with slotDuration 15
      const resA = await request(app)
        .get("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${doctorAToken}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resA.body.data.slotDurationMinutes).toBe(15);
      expect(resA.body.data.weeklySchedule[0].dayOfWeek).toBe("MONDAY");

      // Check Doctor B sees ONLY Friday with slotDuration 60
      const resB = await request(app)
        .get("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${doctorBToken}`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resB.body.data.slotDurationMinutes).toBe(60);
      expect(resB.body.data.weeklySchedule[0].dayOfWeek).toBe("FRIDAY");
    });

    it("rejects unknown/unexpected request fields with 422 VALIDATION_ERROR (strict schema)", async () => {
      const { token } = await createDoctorFixture();

      const res = await request(app)
        .put("/api/v1/doctors/me/availability")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          slotDurationMinutes: 30,
          weeklySchedule: [],
          maliciousInjectedField: "exploit",
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });
});
