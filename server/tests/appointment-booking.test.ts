import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  DoctorAvailability,
  Appointment,
  IdempotencyRecord,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  DayOfWeek,
  ConsultationType,
  AppointmentStatus,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { appointmentService } from "../src/services/appointment.service.js";

describe("Milestone 6 - Task 6.1: Two-Phase Slot Reservation & Concurrency Lock", () => {
  let ipCounter = 4000;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.150.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_appointment_booking_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await DoctorAvailability.syncIndexes();
    await Appointment.syncIndexes();
    await IdempotencyRecord.syncIndexes();
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
      await Appointment.deleteMany({});
      await IdempotencyRecord.deleteMany({});
    }
  });

  // Helper: creates a verified doctor with availability schedule
  async function createDoctorFixture(
    overrides: {
      fullName?: string;
      verificationStatus?: DoctorVerificationStatus;
      userStatus?: UserStatus;
      consultationFee?: number;
      slotDurationMinutes?: number;
      shifts?: Array<{ startTime: string; endTime: string }>;
    } = {}
  ) {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: overrides.fullName || "Dr. Gregory House",
      role: UserRole.DOCTOR,
      status: overrides.userStatus || UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const regNumber = `REG-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: "Diagnostics",
      qualifications: ["MD"],
      experienceYears: 20,
      registrationNumber: regNumber,
      registrationCouncil: "State Medical Council",
      consultationFee: overrides.consultationFee ?? 1200,
      verificationStatus:
        overrides.verificationStatus || DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    user.doctorProfile = profile._id;
    await user.save();

    // 2026-10-15 is Thursday
    await DoctorAvailability.create({
      doctorId: profile._id,
      slotDurationMinutes: overrides.slotDurationMinutes || 30,
      weeklySchedule: [
        {
          dayOfWeek: DayOfWeek.THURSDAY,
          shifts: overrides.shifts || [
            { startTime: "09:00", endTime: "12:00" },
          ],
        },
      ],
    });

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, profile, token };
  }

  // Helper: creates a patient user with access token
  async function createPatientFixture(overrides: { fullName?: string } = {}) {
    const user = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: overrides.fullName || "Patient Jane Doe",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, token };
  }

  // =========================================================================
  // 1. Validation and Authorization
  // =========================================================================
  describe("1. Validation & Authorization", () => {
    it("successfully creates a reservation for a valid patient request", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.appointmentId).toBeDefined();
      expect(res.body.data.status).toBe("PENDING_PAYMENT");
      expect(res.body.data.fee).toBe(1200);
      expect(res.body.data.currency).toBe("INR");
      expect(res.body.data.expiresAt).toBeDefined();
      expect(res.body.message).toBe(
        "Slot reserved for 15 minutes. Please complete payment."
      );
    });

    it("rejects unauthenticated requests with 401 AUTH_TOKEN_MISSING", async () => {
      const { profile } = await createDoctorFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("rejects non-patient users (e.g. DOCTOR role) with 403 AUTH_INSUFFICIENT_PERMISSIONS", async () => {
      const { profile, token: doctorToken } = await createDoctorFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("rejects invalid doctor identifier with 422 VALIDATION_ERROR", async () => {
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: "invalid-not-hex-id",
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects invalid appointment type with 422 VALIDATION_ERROR", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "SMOKE_SIGNAL",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects malformed datetime or invalid body with 422 VALIDATION_ERROR", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const resBadDate = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "not-a-datetime",
          reason: "Routine quarterly consultation",
        });

      expect(resBadDate.status).toBe(422);
      expect(resBadDate.body.error.code).toBe("VALIDATION_ERROR");

      const resShortReason = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "hi", // Less than 5 characters
        });

      expect(resShortReason.status).toBe(422);
      expect(resShortReason.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects past appointment start times with 422 APPOINTMENT_PAST_DATE", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: pastDate,
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("APPOINTMENT_PAST_DATE");
    });

    it("returns 404 DOCTOR_NOT_FOUND when doctor does not exist", async () => {
      const { token } = await createPatientFixture();
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: nonExistentId,
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });

    it("returns 403 DOCTOR_NOT_VERIFIED when doctor is unverified (PENDING_REVIEW)", async () => {
      const { profile } = await createDoctorFixture({
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_NOT_VERIFIED");
    });

    it("returns 403 DOCTOR_NOT_VERIFIED when doctor user account is SUSPENDED", async () => {
      const { profile } = await createDoctorFixture({
        userStatus: UserStatus.SUSPENDED,
      });
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_NOT_VERIFIED");
    });

    it("returns 409 APPOINTMENT_SLOT_UNAVAILABLE when requesting a slot outside doctor working hours", async () => {
      const { profile } = await createDoctorFixture({
        shifts: [{ startTime: "09:00", endTime: "11:00" }],
      });
      const { token } = await createPatientFixture();

      // Requested time is 15:00 on Thursday, outside 09:00-11:00 shift
      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T15:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
    });

    it("returns 409 APPOINTMENT_SLOT_UNAVAILABLE when doctor is on leave on the requested date", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      // Add a leave exception on 2026-10-15
      await DoctorAvailability.updateOne(
        { doctorId: profile._id },
        {
          $push: {
            exceptions: {
              date: "2026-10-15",
              isAvailable: false,
              reason: "Medical leave",
              shifts: [],
            },
          },
        }
      );

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
    });
  });

  // =========================================================================
  // 2. Reservation Behavior & Concurrency Locking
  // =========================================================================
  describe("2. Reservation Behavior & Concurrency Locking", () => {
    it("creates exactly one PENDING_PAYMENT appointment with lock expiring in 15 minutes", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();

      const beforeTime = Date.now();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      const afterTime = Date.now();

      expect(res.status).toBe(201);
      const apptId = res.body.data.appointmentId;

      const apptInDb = await Appointment.findById(apptId);
      expect(apptInDb).not.toBeNull();
      expect(apptInDb!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
      expect(apptInDb!.patientId.toString()).toBe(patientUser._id.toString());
      expect(apptInDb!.doctorId.toString()).toBe(doctorUser._id.toString());
      expect(apptInDb!.fee).toBe(1200);
      expect(apptInDb!.currency).toBe("INR");

      // Verify expiration is ~15 minutes after creation
      const expiresAtMs = new Date(apptInDb!.lockExpiresAt!).getTime();
      const expectedMinExpires = beforeTime + 15 * 60 * 1000 - 1000;
      const expectedMaxExpires = afterTime + 15 * 60 * 1000 + 1000;
      expect(expiresAtMs).toBeGreaterThanOrEqual(expectedMinExpires);
      expect(expiresAtMs).toBeLessThanOrEqual(expectedMaxExpires);
    });

    it("returns 409 APPOINTMENT_SLOT_UNAVAILABLE when booking an already occupied slot", async () => {
      const { profile } = await createDoctorFixture();
      const { token: patient1Token } = await createPatientFixture({
        fullName: "First Patient",
      });
      const { token: patient2Token } = await createPatientFixture({
        fullName: "Second Patient",
      });

      // First patient books the 09:00 slot
      const res1 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${patient1Token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "First patient reservation",
        });
      expect(res1.status).toBe(201);

      // Second patient attempts to book the same slot
      const res2 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${patient2Token}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Second patient conflicting reservation",
        });

      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
    });

    it("allows booking when a previous reservation has expired (15-min lock elapsed)", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: oldPatient } = await createPatientFixture({
        fullName: "Old Patient",
      });
      const { token: newPatientToken } = await createPatientFixture({
        fullName: "New Patient",
      });

      // Insert an expired lock (expired 10 minutes ago)
      await Appointment.create({
        patientId: oldPatient._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: "Old expired reservation",
        fee: 1200,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      // New patient books the same slot
      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${newPatientToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Fresh booking on expired slot",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify the old appointment was cancelled and new one is active
      const activeAppt = await Appointment.find({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      expect(activeAppt).toHaveLength(1);
      expect(activeAppt[0]._id.toString()).toBe(res.body.data.appointmentId);
    });

    it("allows booking when a previous reservation was CANCELLED", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: oldPatient } = await createPatientFixture();
      const { token: newPatientToken } = await createPatientFixture();

      // Insert a CANCELLED appointment on the slot
      await Appointment.create({
        patientId: oldPatient._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CANCELLED,
        reason: "Cancelled appointment",
        fee: 1200,
        currency: "INR",
        cancellation: {
          reason: "Patient cancelled",
          cancelledAt: new Date(),
        },
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${newPatientToken}`)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Booking on cancelled slot",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it("does not mislabel unrelated duplicate-key errors as slot conflicts", async () => {
      const { profile } = await createDoctorFixture();
      const { user: patientUser } = await createPatientFixture();

      const fakeMongoError = new Error(
        "E11000 duplicate key error dup key: { customUniqueIndex: 1 }"
      );
      (fakeMongoError as any).code = 11000;
      (fakeMongoError as any).keyPattern = { customUniqueIndex: 1 };

      const saveSpy = vi
        .spyOn(Appointment.prototype, "save")
        .mockRejectedValueOnce(fakeMongoError);

      await expect(
        appointmentService.createReservation(patientUser._id.toString(), {
          doctorId: profile._id.toString(),
          appointmentType: ConsultationType.VIDEO,
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Unrelated duplicate key check",
        })
      ).rejects.toThrow("E11000 duplicate key error dup key: { customUniqueIndex: 1 }");

      saveSpy.mockRestore();
    });
  });

  // =========================================================================
  // 3. Idempotency Handling
  // =========================================================================
  describe("3. Idempotency Guarantees", () => {
    it("rejects invalid UUIDv4 in Idempotency-Key header with 422 VALIDATION_ERROR", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", "not-a-valid-uuidv4")
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Routine quarterly consultation",
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("repeating a request with identical Idempotency-Key returns cached response without duplicate appointment", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();

      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Idempotent reservation check",
      };

      // First request
      const res1 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("X-Forwarded-For", getUniqueIp())
        .send(payload);

      expect(res1.status).toBe(201);
      const apptId1 = res1.body.data.appointmentId;

      // Second identical request
      const res2 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("X-Forwarded-For", getUniqueIp())
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.data.appointmentId).toBe(apptId1);
      expect(res2.body.data.status).toBe("PENDING_PAYMENT");

      // Verify exactly ONE appointment document exists in MongoDB
      const count = await Appointment.countDocuments({
        _id: new mongoose.Types.ObjectId(apptId1),
      });
      expect(count).toBe(1);
    });

    it("reusing Idempotency-Key with different payload rejects with 409 IDEMPOTENCY_CONFLICT", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();

      // First request
      const res1 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Original reservation payload",
        });
      expect(res1.status).toBe(201);

      // Second request reusing the same key with DIFFERENT reason
      const res2 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("X-Forwarded-For", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Altered conflicting reservation payload",
        });

      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("concurrent requests using the same idempotency key produce exactly one logical reservation", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Concurrent identical idempotency test",
      };

      const results = await Promise.all([
        request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("X-Forwarded-For", getUniqueIp())
          .send(payload),
        request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("X-Forwarded-For", getUniqueIp())
          .send(payload),
      ]);

      // Exactly one succeeds with 201; the concurrent duplicate claim either gets 409 IDEMPOTENCY_CONFLICT or 201
      const createdResponses = results.filter((r) => r.status === 201);
      expect(createdResponses.length).toBeGreaterThanOrEqual(1);

      // Verify in database: exactly ONE appointment was created
      const totalAppointments = await Appointment.countDocuments({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
      });
      expect(totalAppointments).toBe(1);
    });
  });

  // =========================================================================
  // 4. Mandatory Concurrency Test (5 Simultaneous Requests)
  // =========================================================================
  describe("4. Mandatory Concurrency Test (5 Simultaneous Requests)", () => {
    it("launches 5 simultaneous requests for the exact same slot: exactly 1 succeeds (201) and 4 conflict (409)", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();

      // Create 5 distinct patients to simulate real concurrent traffic
      const patients = await Promise.all([
        createPatientFixture({ fullName: "Concurrent Patient 1" }),
        createPatientFixture({ fullName: "Concurrent Patient 2" }),
        createPatientFixture({ fullName: "Concurrent Patient 3" }),
        createPatientFixture({ fullName: "Concurrent Patient 4" }),
        createPatientFixture({ fullName: "Concurrent Patient 5" }),
      ]);

      const targetSlot = "2026-10-15T09:00:00.000Z";

      // Fire 5 simultaneous requests with different idempotency keys
      const promises = patients.map((patient, index) => {
        const idempotencyKey = crypto.randomUUID();
        return request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${patient.token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("X-Forwarded-For", getUniqueIp())
          .send({
            doctorId: profile._id.toString(),
            appointmentType: "VIDEO",
            scheduledStart: targetSlot,
            reason: `Concurrency test booking from patient ${index + 1}`,
          });
      });

      const results = await Promise.all(promises);

      const successfulResponses = results.filter((r) => r.status === 201);
      const conflictResponses = results.filter((r) => r.status === 409);

      // Exactly ONE succeeds
      expect(successfulResponses).toHaveLength(1);
      expect(successfulResponses[0].body.success).toBe(true);
      expect(successfulResponses[0].body.data.status).toBe("PENDING_PAYMENT");

      // Exactly FOUR fail with 409 APPOINTMENT_SLOT_UNAVAILABLE
      expect(conflictResponses).toHaveLength(4);
      for (const conflict of conflictResponses) {
        expect(conflict.body.success).toBe(false);
        expect(conflict.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
      }

      // Exactly ONE active appointment document exists in MongoDB for this doctor and slot
      const totalBookingsInDb = await Appointment.countDocuments({
        doctorId: doctorUser._id,
        scheduledStart: new Date(targetSlot),
        status: {
          $in: [
            AppointmentStatus.PENDING_PAYMENT,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.IN_PROGRESS,
          ],
        },
      });
      expect(totalBookingsInDb).toBe(1);
    });
  });
});
