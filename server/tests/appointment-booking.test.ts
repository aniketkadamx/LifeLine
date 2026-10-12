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
  IdempotencyStatus,
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
import { availabilityService } from "../src/services/availability.service.js";

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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
      const oldExpiredAppt = await Appointment.create({
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
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Fresh booking on expired slot",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      // Verify the old appointment was cancelled with proper metadata
      const oldApptInDb = await Appointment.findById(oldExpiredAppt._id);
      expect(oldApptInDb!.status).toBe(AppointmentStatus.CANCELLED);
      expect(oldApptInDb!.cancellation?.reason).toBe(
        "15-minute reservation lock expired without payment"
      );
      expect(oldApptInDb!.cancellation?.cancelledAt).toBeDefined();

      // Verify new one is active and has a future expiration
      const activeAppt = await Appointment.find({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
      });
      expect(activeAppt).toHaveLength(1);
      expect(activeAppt[0]._id.toString()).toBe(res.body.data.appointmentId);
      expect(new Date(activeAppt[0].lockExpiresAt!).getTime()).toBeGreaterThan(
        Date.now()
      );
    });

    it("conservatively blocks booking when a reservation has no lockExpiresAt (legacy record)", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: legacyPatient } = await createPatientFixture();
      const { token: newPatientToken } = await createPatientFixture();

      // Legacy appointment without lockExpiresAt
      const legacyAppt = await Appointment.create({
        patientId: legacyPatient._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: "Legacy booking without expiration field",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${newPatientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Attempt booking over legacy record",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");

      // Verify the legacy record was NOT silently cancelled
      const legacyInDb = await Appointment.findById(legacyAppt._id);
      expect(legacyInDb!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it("unexpired reservation continues to block the slot with 409", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: activePatient } = await createPatientFixture();
      const { token: newPatientToken } = await createPatientFixture();

      // Active unexpired lock (expires in 10 minutes)
      const activeLock = await Appointment.create({
        patientId: activePatient._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: "Active holding lock",
        fee: 1200,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${newPatientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Attempt booking over unexpired lock",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");

      const lockInDb = await Appointment.findById(activeLock._id);
      expect(lockInDb!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res1.status).toBe(201);
      const apptId1 = res1.body.data.appointmentId;

      // Second identical request
      const res2 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
        .set("x-test-client-ip", getUniqueIp())
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
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
        request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
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

    it("rejects retry against an active PROCESSING claim whose lease is still unexpired with 409 IDEMPOTENCY_CONFLICT", async () => {
      const { profile } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Lease testing active claim",
      };

      const normalizedPayload = {
        doctorId: payload.doctorId,
        appointmentType: payload.appointmentType,
        scheduledStart: new Date(payload.scheduledStart).toISOString(),
        reason: payload.reason.trim(),
      };
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");

      // Seed an active claim with lockedUntil 30 seconds into the future
      await IdempotencyRecord.create({
        key: idempotencyKey,
        userId: patientUser._id,
        operation: "APPOINTMENT_RESERVATION",
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        lockedUntil: new Date(Date.now() + 30 * 1000),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(res.body.error.message).toContain("currently being processed");
    });

    it("stale PROCESSING claim with expired lease and no appointment is safely recovered and creates the reservation", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Recover stale uncompleted reservation",
      };

      const normalizedPayload = {
        doctorId: payload.doctorId,
        appointmentType: payload.appointmentType,
        scheduledStart: new Date(payload.scheduledStart).toISOString(),
        reason: payload.reason.trim(),
      };
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");

      // Seed a stale claim (expired lease, no appointment created)
      await IdempotencyRecord.create({
        key: idempotencyKey,
        userId: patientUser._id,
        operation: "APPOINTMENT_RESERVATION",
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        lockedUntil: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PENDING_PAYMENT");

      // Verify the idempotency record was marked COMPLETED
      const idempDoc = await IdempotencyRecord.findOne({ key: idempotencyKey });
      expect(idempDoc!.status).toBe(IdempotencyStatus.COMPLETED);
      expect(idempDoc!.appointmentId).toBeDefined();

      // Verify exactly ONE appointment was created
      const apptCount = await Appointment.countDocuments({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
      });
      expect(apptCount).toBe(1);
    });

    it("multiple simultaneous retries against a stale PROCESSING claim allow at most one operation to proceed", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Simultaneous stale retry test",
      };

      const normalizedPayload = {
        doctorId: payload.doctorId,
        appointmentType: payload.appointmentType,
        scheduledStart: new Date(payload.scheduledStart).toISOString(),
        reason: payload.reason.trim(),
      };
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");

      // Seed a stale claim
      await IdempotencyRecord.create({
        key: idempotencyKey,
        userId: patientUser._id,
        operation: "APPOINTMENT_RESERVATION",
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        lockedUntil: new Date(Date.now() - 10000),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const results = await Promise.all([
        request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
        request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
        request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload),
      ]);

      const successResponses = results.filter((r) => r.status === 201);
      expect(successResponses.length).toBeGreaterThanOrEqual(1);

      // Verify in database: exactly ONE appointment document was created
      const apptCount = await Appointment.countDocuments({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
      });
      expect(apptCount).toBe(1);
    });

    it("stale PROCESSING claim whose appointment was already persisted recovers and replays the original appointment", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Pre-existing appointment recovery",
      };

      const normalizedPayload = {
        doctorId: payload.doctorId,
        appointmentType: payload.appointmentType,
        scheduledStart: new Date(payload.scheduledStart).toISOString(),
        reason: payload.reason.trim(),
      };
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(normalizedPayload))
        .digest("hex");

      // Seed an appointment already saved with this idempotencyKey
      const preExistingAppt = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: payload.reason,
        fee: 1200,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey,
      });

      // Seed a stale PROCESSING claim
      await IdempotencyRecord.create({
        key: idempotencyKey,
        userId: patientUser._id,
        operation: "APPOINTMENT_RESERVATION",
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        lockedUntil: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.appointmentId).toBe(preExistingAppt._id.toString());

      // Verify no duplicate appointment was created
      const totalCount = await Appointment.countDocuments({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
      });
      expect(totalCount).toBe(1);

      // Verify idempotency record is now COMPLETED
      const idemp = await IdempotencyRecord.findOne({ key: idempotencyKey });
      expect(idemp!.status).toBe(IdempotencyStatus.COMPLETED);
    });

    it("reusing a stale claim with a DIFFERENT payload still rejects with 409 IDEMPOTENCY_CONFLICT", async () => {
      const { profile } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();

      // Seed stale record for payload A
      const hashA = crypto.createHash("sha256").update("payload-A").digest("hex");
      await IdempotencyRecord.create({
        key: idempotencyKey,
        userId: patientUser._id,
        operation: "APPOINTMENT_RESERVATION",
        requestHash: hashA,
        status: IdempotencyStatus.PROCESSING,
        lockedUntil: new Date(Date.now() - 5000),
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: profile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T09:00:00.000Z",
          reason: "Payload B is different from A",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("partial failure: simulated failure during appointment insert unpoisons the claim allowing immediate retry", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Fault injection insert test",
      };

      // Mock appointment save to fail once
      const saveSpy = vi
        .spyOn(Appointment.prototype, "save")
        .mockRejectedValueOnce(new Error("Simulated transient MongoDB network failure"));

      const res1 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res1.status).toBe(500);

      // Verify the claim was deleted (unpoisoned)
      const claim = await IdempotencyRecord.findOne({ key: idempotencyKey });
      expect(claim).toBeNull();

      saveSpy.mockRestore();

      // Immediate retry with the same idempotency key succeeds
      const res2 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);
    });

    it("partial failure: simulated failure after appointment save but before idempotency completion retains the claim and enables clean replay on retry without duplicates", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Fault injection completion test",
      };

      // Spy on IdempotencyRecord.updateOne to fail when marking COMPLETED
      const updateOneSpy = vi
        .spyOn(IdempotencyRecord, "updateOne")
        .mockRejectedValueOnce(
          new Error("Simulated network timeout during idempotency completion update")
        );

      const res1 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      // The controller returns 500 because the service threw the update error
      expect(res1.status).toBe(500);

      // Verify the appointment WAS created in MongoDB
      const createdAppt = await Appointment.findOne({ idempotencyKey });
      expect(createdAppt).not.toBeNull();

      // Verify the idempotency record was NOT blindly deleted
      const idempRecord = await IdempotencyRecord.findOne({ key: idempotencyKey });
      expect(idempRecord).not.toBeNull();

      updateOneSpy.mockRestore();

      // Expire the lease to simulate recovering the claim
      await IdempotencyRecord.updateOne(
        { key: idempotencyKey },
        { $set: { lockedUntil: new Date(Date.now() - 5000) } }
      );

      // Retry request with the identical key and payload
      const res2 = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res2.status).toBe(201);
      expect(res2.body.data.appointmentId).toBe(createdAppt!._id.toString());

      // Verify no duplicate appointment was created in MongoDB
      const totalCount = await Appointment.countDocuments({
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
      });
      expect(totalCount).toBe(1);
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
          .set("x-test-client-ip", getUniqueIp())
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

    it("concurrent expired-slot reuse: 5 simultaneous requests against an expired slot yield exactly 1 success (201) and 4 conflicts (409) with no accidental cancellation of the winner", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: oldPatient } = await createPatientFixture();

      const targetSlot = "2026-10-15T09:00:00.000Z";

      // Seed an expired reservation on the slot
      await Appointment.create({
        patientId: oldPatient._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(targetSlot),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: "Old expired lock on target slot",
        fee: 1200,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() - 5000),
      });

      // 5 concurrent patients attempting to book the expired slot simultaneously
      const patients = await Promise.all([
        createPatientFixture({ fullName: "Expired Reuse Patient 1" }),
        createPatientFixture({ fullName: "Expired Reuse Patient 2" }),
        createPatientFixture({ fullName: "Expired Reuse Patient 3" }),
        createPatientFixture({ fullName: "Expired Reuse Patient 4" }),
        createPatientFixture({ fullName: "Expired Reuse Patient 5" }),
      ]);

      const promises = patients.map((patient, index) => {
        const idempotencyKey = crypto.randomUUID();
        return request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${patient.token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send({
            doctorId: profile._id.toString(),
            appointmentType: "VIDEO",
            scheduledStart: targetSlot,
            reason: `Race for expired slot by patient ${index + 1}`,
          });
      });

      const results = await Promise.all(promises);

      const successfulResponses = results.filter((r) => r.status === 201);
      const conflictResponses = results.filter((r) => r.status === 409);

      // Exactly ONE wins the slot
      expect(successfulResponses).toHaveLength(1);
      expect(successfulResponses[0].body.success).toBe(true);
      expect(successfulResponses[0].body.data.status).toBe("PENDING_PAYMENT");

      // Exactly FOUR receive 409 APPOINTMENT_SLOT_UNAVAILABLE
      expect(conflictResponses).toHaveLength(4);
      for (const conflict of conflictResponses) {
        expect(conflict.body.success).toBe(false);
        expect(conflict.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
      }

      // Verify the winner's appointment is active and was NOT accidentally cancelled
      const activeAppt = await Appointment.find({
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
      expect(activeAppt).toHaveLength(1);
      expect(activeAppt[0]._id.toString()).toBe(
        successfulResponses[0].body.data.appointmentId
      );
      expect(new Date(activeAppt[0].lockExpiresAt!).getTime()).toBeGreaterThan(
        Date.now()
      );
    });
  });

  // =========================================================================
  // 5. Deterministic Concurrency & Fencing Tests
  // =========================================================================
  describe("5. Deterministic Concurrency & Fencing Tests", () => {
    function createDeferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("1. lease takeover & old-owner fencing: pauses request 1, retry takes over lease, and old owner is fenced from completing, overwriting, or duplicating", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const targetSlot = "2026-10-15T09:00:00.000Z";
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: targetSlot,
        reason: "Deterministic lease takeover barrier test",
      };

      const request1ReachedBarrier = createDeferred();
      const request1ReleaseBarrier = createDeferred();
      let interceptRequest1 = true;

      const originalCompute =
        availabilityService.computeAvailableSlots.bind(availabilityService);
      const availabilitySpy = vi
        .spyOn(availabilityService, "computeAvailableSlots")
        .mockImplementation((...args: [string, string]) => {
          if (interceptRequest1) {
            interceptRequest1 = false;
            return originalCompute(...args).then((res) => {
              request1ReachedBarrier.resolve();
              return request1ReleaseBarrier.promise.then(() => res);
            });
          }
          return originalCompute(...args);
        });

      try {
        // Fire Request 1 (which acquires initial claim, then pauses at the barrier)
        const req1Promise = request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload)
          .then((res) => res);

        // Wait until Request 1 has acquired the idempotency record and reached the barrier
        await request1ReachedBarrier.promise;

        // Verify Request 1 acquired the lease in MongoDB with an ownerToken
        const initialRecord = await IdempotencyRecord.findOne({
          key: idempotencyKey,
        });
        expect(initialRecord).not.toBeNull();
        expect(initialRecord!.status).toBe(IdempotencyStatus.PROCESSING);
        const oldOwnerToken = initialRecord!.ownerToken;
        expect(oldOwnerToken).toBeDefined();

        // Expire Request 1's lease in MongoDB
        await IdempotencyRecord.updateOne(
          { key: idempotencyKey },
          { $set: { lockedUntil: new Date(Date.now() - 5000) } }
        );

        // Fire Request 2 (retry). Because interceptRequest1 is now false, Request 2 runs to completion
        const res2 = await request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload);

        expect(res2.status).toBe(201);
        expect(res2.body.success).toBe(true);
        const apptId2 = res2.body.data.appointmentId;
        expect(apptId2).toBeDefined();

        // Verify IdempotencyRecord is marked COMPLETED with Request 2's appointment
        const recordAfterReq2 = await IdempotencyRecord.findOne({
          key: idempotencyKey,
        });
        expect(recordAfterReq2!.status).toBe(IdempotencyStatus.COMPLETED);
        expect(recordAfterReq2!.appointmentId!.toString()).toBe(apptId2);

        // Now release Request 1 from its barrier
        request1ReleaseBarrier.resolve();
        const res1 = await req1Promise;

        // Request 1 must be fenced with 409 IDEMPOTENCY_CONFLICT
        expect(res1.status).toBe(409);
        expect(res1.body.success).toBe(false);
        expect(res1.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

        // Verify in database: exactly ONE appointment exists
        const appointments = await Appointment.find({ idempotencyKey });
        expect(appointments).toHaveLength(1);
        expect(appointments[0]._id.toString()).toBe(apptId2);

        // Verify completed record was not overwritten or corrupted by Request 1
        const finalRecord = await IdempotencyRecord.findOne({
          key: idempotencyKey,
        });
        expect(finalRecord!.status).toBe(IdempotencyStatus.COMPLETED);
        expect(finalRecord!.appointmentId!.toString()).toBe(apptId2);
      } finally {
        availabilitySpy.mockRestore();
        request1ReleaseBarrier.resolve();
      }
    });

    it("2. failure cleanup fencing: an old owner's error path cannot delete a newer owner's claim", async () => {
      const { profile } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Old owner error path cleanup fencing test",
      };

      const request1ReachedBarrier = createDeferred();
      const request1ReleaseBarrier = createDeferred();

      const availabilitySpy = vi
        .spyOn(availabilityService, "computeAvailableSlots")
        .mockImplementation(() => {
          request1ReachedBarrier.resolve();
          return request1ReleaseBarrier.promise.then(() => {
            // Simulate an error inside Request 1 before appointment creation
            throw new Error("Simulated unexpected failure during availability check");
          });
        });

      try {
        // Request 1 starts and acquires initial claim
        const req1Promise = request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payload)
          .then((res) => res);

        await request1ReachedBarrier.promise;

        // Verify Request 1 acquired the claim with initial ownerToken
        const initialRecord = await IdempotencyRecord.findOne({
          key: idempotencyKey,
        });
        expect(initialRecord).not.toBeNull();
        const oldOwnerToken = initialRecord!.ownerToken;
        expect(oldOwnerToken).toBeDefined();

        // Expire the lease and simulate takeover by a new owner
        const newOwnerToken = crypto.randomUUID();
        await IdempotencyRecord.updateOne(
          { key: idempotencyKey },
          {
            $set: {
              ownerToken: newOwnerToken,
              lockedUntil: new Date(Date.now() + 60000),
            },
          }
        );

        // Now trigger the failure in Request 1
        request1ReleaseBarrier.resolve();
        const res1 = await req1Promise;

        // Request 1 failed (HTTP 500 because availability threw)
        expect(res1.status).toBe(500);

        // Verify Request 1's error cleanup DID NOT delete the claim, because the claim now belongs to newOwnerToken!
        const recordAfterFailure = await IdempotencyRecord.findOne({
          key: idempotencyKey,
        });
        expect(recordAfterFailure).not.toBeNull();
        expect(recordAfterFailure!.ownerToken).toBe(newOwnerToken);
        expect(recordAfterFailure!.status).toBe(IdempotencyStatus.PROCESSING);
      } finally {
        availabilitySpy.mockRestore();
        request1ReleaseBarrier.resolve();
      }
    });

    it("3. reservation safety with payload mismatch: request targeting a different slot with the same key is rejected even if lease expired, and cannot steal claim", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const payloadA = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:00:00.000Z",
        reason: "Original reservation for 9am",
      };
      const payloadB = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: "2026-10-15T09:30:00.000Z",
        reason: "Conflicting reservation for 9:30am with same key",
      };

      const request1ReachedBarrier = createDeferred();
      const request1ReleaseBarrier = createDeferred();

      const originalCompute =
        availabilityService.computeAvailableSlots.bind(availabilityService);
      const availabilitySpy = vi
        .spyOn(availabilityService, "computeAvailableSlots")
        .mockImplementation((...args: [string, string]) => {
          request1ReachedBarrier.resolve();
          return request1ReleaseBarrier.promise.then(() =>
            originalCompute(...args)
          );
        });

      try {
        // Request 1 starts for Slot A (09:00)
        const req1Promise = request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payloadA)
          .then((res) => res);

        await request1ReachedBarrier.promise;

        // Expire the lease in MongoDB
        await IdempotencyRecord.updateOne(
          { key: idempotencyKey },
          { $set: { lockedUntil: new Date(Date.now() - 5000) } }
        );

        // Request 2 arrives with the same key but different payload (Slot B)
        const res2 = await request(app)
          .post("/api/v1/appointments")
          .set("Authorization", `Bearer ${token}`)
          .set("Idempotency-Key", idempotencyKey)
          .set("x-test-client-ip", getUniqueIp())
          .send(payloadB);

        // Request 2 must be rejected with 409 IDEMPOTENCY_CONFLICT
        expect(res2.status).toBe(409);
        expect(res2.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

        // Release Request 1 to complete Slot A
        request1ReleaseBarrier.resolve();

        const res1 = await req1Promise;
        expect(res1.status).toBe(201);

        // Verify: Slot A was booked, Slot B was NOT booked
        const apptA = await Appointment.findOne({
          doctorId: doctorUser._id,
          scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        });
        expect(apptA).not.toBeNull();

        const apptB = await Appointment.findOne({
          doctorId: doctorUser._id,
          scheduledStart: new Date("2026-10-15T09:30:00.000Z"),
        });
        expect(apptB).toBeNull();

        // Exactly ONE appointment created in total
        const total = await Appointment.countDocuments({ idempotencyKey });
        expect(total).toBe(1);
      } finally {
        availabilitySpy.mockRestore();
        request1ReleaseBarrier.resolve();
      }
    });

    it("4. reservation safety: compound unique index { patientId: 1, idempotencyKey: 1 } prevents duplicate appointments and maps to 409 IDEMPOTENCY_CONFLICT", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture();
      const { user: patientUser } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();

      // Directly create appointment 1 for this patient with this idempotency key
      const appt1 = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: "First appointment",
        fee: 1000,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
        idempotencyKey,
      });
      expect(appt1).toBeDefined();

      // Attempting to directly create a second appointment for the same patient and idempotency key
      // MUST trigger Mongo duplicate key error on patientId_1_idempotencyKey_1
      let dbError: any;
      try {
        await Appointment.create({
          patientId: patientUser._id,
          doctorId: doctorUser._id,
          appointmentType: ConsultationType.VIDEO,
          scheduledStart: new Date("2026-10-15T10:00:00.000Z"), // Different time slot
          scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
          status: AppointmentStatus.PENDING_PAYMENT,
          reason: "Second conflicting appointment for same patient",
          fee: 1000,
          currency: "INR",
          lockExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          idempotencyKey,
        });
      } catch (err: any) {
        dbError = err;
      }

      expect(dbError).toBeDefined();
      expect(dbError.code).toBe(11000);
      expect(JSON.stringify(dbError)).toContain("idempotencyKey");

      // Verify that appointmentService handles duplicate idempotency key errors gracefully with 409 IDEMPOTENCY_CONFLICT
      await expect(
        appointmentService["executeSlotReservation"](
          patientUser._id.toString(),
          profile,
          {
            doctorId: profile._id.toString(),
            appointmentType: ConsultationType.VIDEO,
            scheduledStart: "2026-10-15T10:00:00.000Z",
            reason: "Another attempt",
          },
          new Date("2026-10-15T10:00:00.000Z"),
          new Date("2026-10-15T10:30:00.000Z"),
          idempotencyKey
        )
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "IDEMPOTENCY_CONFLICT",
      });
    });

    it("5. recovery after persistence: recovers original response values (id, fee, currency, status, lock expiration) without recomputing from mutable doctor data", async () => {
      const { profile, user: doctorUser } = await createDoctorFixture({
        consultationFee: 1500,
      });
      const { user: patientUser, token } = await createPatientFixture();

      const idempotencyKey = crypto.randomUUID();
      const targetSlot = "2026-10-15T09:00:00.000Z";
      const payload = {
        doctorId: profile._id.toString(),
        appointmentType: "VIDEO",
        scheduledStart: targetSlot,
        reason: "Original response preservation test",
      };

      const originalLockExpiresAt = new Date(Date.now() + 12 * 60 * 1000); // 12 mins remaining
      const originalFee = 1500;
      const originalCurrency = "INR";

      // Seed pre-existing appointment created previously
      const originalAppt = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(targetSlot),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: payload.reason,
        fee: originalFee,
        currency: originalCurrency,
        lockExpiresAt: originalLockExpiresAt,
        idempotencyKey,
      });

      // Seed idempotency record in PROCESSING with expired lease (completion was interrupted)
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex");

      await IdempotencyRecord.create({
        key: idempotencyKey,
        userId: patientUser._id,
        operation: "APPOINTMENT_RESERVATION",
        requestHash,
        status: IdempotencyStatus.PROCESSING,
        lockedUntil: new Date(Date.now() - 5000), // Expired lease
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      });

      // Now mutate doctor profile's consultation fee to prove response does NOT recompute from mutable data
      await DoctorProfile.updateOne(
        { _id: profile._id },
        { $set: { consultationFee: 3000 } }
      );

      // Retry request
      const res = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", idempotencyKey)
        .set("x-test-client-ip", getUniqueIp())
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Slot reserved for 15 minutes. Please complete payment.");
      expect(res.body.data.appointmentId).toBe(originalAppt._id.toString());
      expect(res.body.data.status).toBe("PENDING_PAYMENT");
      expect(res.body.data.fee).toBe(1500); // Original fee (1500), NOT mutated fee (3000)!
      expect(res.body.data.currency).toBe("INR");
      expect(res.body.data.expiresAt).toBe(originalLockExpiresAt.toISOString());
      expect(res.body.data.isReplayed).toBe(true);

      // Verify no duplicate appointment was created
      const count = await Appointment.countDocuments({ idempotencyKey });
      expect(count).toBe(1);

      // Verify idempotency record is completed
      const idemp = await IdempotencyRecord.findOne({ key: idempotencyKey });
      expect(idemp!.status).toBe(IdempotencyStatus.COMPLETED);
    });
  });
});
