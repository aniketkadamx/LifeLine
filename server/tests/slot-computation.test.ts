import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  DoctorAvailability,
  Appointment,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  DayOfWeek,
  ConsultationType,
  AppointmentStatus,
} from "../src/types/models.js";

describe("Milestone 5 - Task 5.3: Public Slot Computation Engine", () => {
  let ipCounter = 3000;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.140.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_slot_computation_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await DoctorAvailability.syncIndexes();
    await Appointment.syncIndexes();
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
    }
  });

  // Helper: creates a verified doctor with configurable attributes
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
      fullName: overrides.fullName || "Dr. Anthony Fauci",
      role: UserRole.DOCTOR,
      status: overrides.userStatus || UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const regNumber = `REG-${user._id.toString().slice(-8).toUpperCase()}`;

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: "Immunology",
      qualifications: ["MD", "PhD"],
      experienceYears: 25,
      registrationNumber: regNumber,
      registrationCouncil: "Medical Council",
      consultationFee: 1500,
      verificationStatus:
        overrides.verificationStatus || DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    user.doctorProfile = profile._id;
    await user.save();

    return { user, profile };
  }

  // Helper: creates a patient fixture
  async function createPatientFixture() {
    return await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Patient John Doe",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
    });
  }

  // Helper: creates an appointment
  async function createAppointmentFixture(params: {
    patientId: mongoose.Types.ObjectId;
    doctorId: mongoose.Types.ObjectId;
    scheduledStart: Date;
    scheduledEnd: Date;
    status: AppointmentStatus;
    lockExpiresAt?: Date;
  }) {
    return await Appointment.create({
      patientId: params.patientId,
      doctorId: params.doctorId,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: params.scheduledStart,
      scheduledEnd: params.scheduledEnd,
      status: params.status,
      reason: "General consultation",
      fee: 1500,
      currency: "INR",
      lockExpiresAt: params.lockExpiresAt,
    });
  }

  // =========================================================================
  // 1. Basic Slot Generation & Boundaries (09:00-11:00 -> 4 slots)
  // =========================================================================
  describe("1. Shift & Slot Generation", () => {
    it("produces exactly four slots for a 09:00-11:00 shift with 30-minute duration", async () => {
      const { profile } = await createDoctorFixture();

      // Configure Thursday schedule: 09:00 - 11:00
      // 2026-10-15 is a Thursday
      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.doctorId).toBe(profile._id.toString());
      expect(res.body.data.date).toBe("2026-10-15");
      expect(res.body.data.slots).toHaveLength(4);
      expect(res.body.data.slots).toEqual([
        { startTime: "09:00", endTime: "09:30", available: true },
        { startTime: "09:30", endTime: "10:00", available: true },
        { startTime: "10:00", endTime: "10:30", available: true },
        { startTime: "10:30", endTime: "11:00", available: true },
      ]);
    });

    it("ensures slot boundaries never extend past working-shift end times", async () => {
      const { profile } = await createDoctorFixture();

      // Shift is 09:00 - 10:15 (75 min). With 30-min slots:
      // 09:00 - 09:30 (slot 1)
      // 09:30 - 10:00 (slot 2)
      // 10:00 - 10:30 exceeds 10:15, so must NOT be generated
      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "10:15" }],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toHaveLength(2);
      expect(res.body.data.slots).toEqual([
        { startTime: "09:00", endTime: "09:30", available: true },
        { startTime: "09:30", endTime: "10:00", available: true },
      ]);
    });

    it("generates slots for multiple non-adjacent shifts in chronological order", async () => {
      const { profile } = await createDoctorFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [
              { startTime: "09:00", endTime: "10:00" },
              { startTime: "14:00", endTime: "15:00" },
            ],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toHaveLength(4);
      expect(res.body.data.slots).toEqual([
        { startTime: "09:00", endTime: "09:30", available: true },
        { startTime: "09:30", endTime: "10:00", available: true },
        { startTime: "14:00", endTime: "14:30", available: true },
        { startTime: "14:30", endTime: "15:00", available: true },
      ]);
    });
  });

  // =========================================================================
  // 2. Booking Conflicts & Active Locks
  // =========================================================================
  describe("2. Booking and Lock Conflict Detection", () => {
    it("marks 09:30 slot unavailable when a CONFIRMED booking occupies it", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      // Create a confirmed appointment for 09:30 - 10:00
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:30:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:00:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toEqual([
        { startTime: "09:00", endTime: "09:30", available: true },
        { startTime: "09:30", endTime: "10:00", available: false },
        { startTime: "10:00", endTime: "10:30", available: true },
        { startTime: "10:30", endTime: "11:00", available: true },
      ]);
    });

    it("marks slot unavailable when an active lock (unexpired PENDING_PAYMENT) occupies it", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      // Active lock with lockExpiresAt 15 minutes into the future
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        lockExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots[0]).toEqual({
        startTime: "09:00",
        endTime: "09:30",
        available: false,
      });
      expect(res.body.data.slots[1].available).toBe(true);
    });

    it("does not block slot when lock has expired (lockExpiresAt in past)", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      // Expired lock: lock expired 5 minutes ago
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        lockExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots[0]).toEqual({
        startTime: "09:00",
        endTime: "09:30",
        available: true,
      });
    });

    it("blocks both affected slots when an appointment partially overlaps across slot boundaries", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      // Appointment from 09:15 to 09:45 overlaps BOTH [09:00-09:30] and [09:30-10:00]
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:15:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:45:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toEqual([
        { startTime: "09:00", endTime: "09:30", available: false },
        { startTime: "09:30", endTime: "10:00", available: false },
        { startTime: "10:00", endTime: "10:30", available: true },
        { startTime: "10:30", endTime: "11:00", available: true },
      ]);
    });

    it("does not block slots for non-blocking appointment statuses (CANCELLED, REJECTED, RESCHEDULED, NO_SHOW)", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      // Four non-blocking appointments on the four slots
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CANCELLED,
      });

      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:30:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:00:00.000Z"),
        status: AppointmentStatus.REJECTED,
      });

      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.RESCHEDULED,
      });

      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T10:30:00.000Z"),
        scheduledEnd: new Date("2026-10-15T11:00:00.000Z"),
        status: AppointmentStatus.NO_SHOW,
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toHaveLength(4);
      expect(res.body.data.slots.every((s: any) => s.available === true)).toBe(true);
    });

    it("blocks slot when appointment status is IN_PROGRESS or COMPLETED", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
      });

      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.IN_PROGRESS,
      });

      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-15T09:30:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:00:00.000Z"),
        status: AppointmentStatus.COMPLETED,
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots[0].available).toBe(false);
      expect(res.body.data.slots[1].available).toBe(false);
      expect(res.body.data.slots[2].available).toBe(true);
      expect(res.body.data.slots[3].available).toBe(true);
    });
  });

  // =========================================================================
  // 3. Exception Semantics (Leave vs Working Overrides)
  // =========================================================================
  describe("3. Exception Semantics", () => {
    it("produces no available slots when doctor has a leave exception on that date", async () => {
      const { profile } = await createDoctorFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "17:00" }],
          },
        ],
        exceptions: [
          {
            date: "2026-10-15",
            isAvailable: false,
            reason: "Annual Medical Symposium",
            shifts: [],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots).toEqual([]);
    });

    it("overrides recurring schedule with custom shifts when working exception exists", async () => {
      const { profile } = await createDoctorFixture();

      // Recurring schedule is 09:00 - 11:00
      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "11:00" }],
          },
        ],
        exceptions: [
          {
            date: "2026-10-15",
            isAvailable: true,
            reason: "Afternoon emergency hours",
            shifts: [{ startTime: "14:00", endTime: "15:00" }],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.data.slots).toHaveLength(2);
      expect(res.body.data.slots).toEqual([
        { startTime: "14:00", endTime: "14:30", available: true },
        { startTime: "14:30", endTime: "15:00", available: true },
      ]);
    });

    it("returns empty slots when doctor has no recurring shifts configured for that weekday", async () => {
      const { profile } = await createDoctorFixture();

      // Only Monday configured; 2026-10-15 is Thursday
      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.MONDAY,
            shifts: [{ startTime: "09:00", endTime: "12:00" }],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots).toEqual([]);
    });

    it("returns empty slots when doctor has not yet configured any availability record", async () => {
      const { profile } = await createDoctorFixture();

      // No DoctorAvailability document created
      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots).toEqual([]);
    });
  });

  // =========================================================================
  // 4. Input Validation & Error Handling
  // =========================================================================
  describe("4. Input Validation & Error Handling", () => {
    it("rejects malformed doctor ID with 400 BAD_REQUEST", async () => {
      const res = await request(app)
        .get("/api/v1/doctors/invalid-non-hex-id/availability?date=2026-10-15")
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("rejects missing date query parameter with 422 VALIDATION_ERROR", async () => {
      const validId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/doctors/${validId}/availability`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "date" }),
        ])
      );
    });

    it("rejects malformed date strings with 422 VALIDATION_ERROR", async () => {
      const validId = new mongoose.Types.ObjectId().toString();

      const resBadFormat = await request(app)
        .get(`/api/v1/doctors/${validId}/availability?date=15-10-2026`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resBadFormat.status).toBe(422);
      expect(resBadFormat.body.error.code).toBe("VALIDATION_ERROR");

      const resInvalidMonth = await request(app)
        .get(`/api/v1/doctors/${validId}/availability?date=2026-13-10`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resInvalidMonth.status).toBe(422);
      expect(resInvalidMonth.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects impossible calendar dates (e.g. Feb 31) with 422 VALIDATION_ERROR", async () => {
      const validId = new mongoose.Types.ObjectId().toString();

      const resFeb31 = await request(app)
        .get(`/api/v1/doctors/${validId}/availability?date=2026-02-31`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resFeb31.status).toBe(422);
      expect(resFeb31.body.error.code).toBe("VALIDATION_ERROR");

      const resApr31 = await request(app)
        .get(`/api/v1/doctors/${validId}/availability?date=2026-04-31`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resApr31.status).toBe(422);
      expect(resApr31.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects unknown extra query parameters due to strict schema", async () => {
      const validId = new mongoose.Types.ObjectId().toString();

      const resExtra = await request(app)
        .get(`/api/v1/doctors/${validId}/availability?date=2026-10-15&extra=unexpected`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resExtra.status).toBe(422);
      expect(resExtra.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // 5. Doctor Discovery Eligibility & Public Access
  // =========================================================================
  describe("5. Doctor Eligibility & Public Access", () => {
    it("returns 404 DOCTOR_NOT_FOUND when doctor does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .get(`/api/v1/doctors/${nonExistentId}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });

    it("returns 404 DOCTOR_NOT_FOUND when doctor is unverified (PENDING_REVIEW / REJECTED)", async () => {
      const { profile: pendingProfile } = await createDoctorFixture({
        verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
      });

      const resPending = await request(app)
        .get(`/api/v1/doctors/${pendingProfile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resPending.status).toBe(404);
      expect(resPending.body.error.code).toBe("DOCTOR_NOT_FOUND");

      const { profile: rejectedProfile } = await createDoctorFixture({
        verificationStatus: DoctorVerificationStatus.REJECTED,
      });

      const resRejected = await request(app)
        .get(`/api/v1/doctors/${rejectedProfile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(resRejected.status).toBe(404);
      expect(resRejected.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });

    it("returns 404 DOCTOR_NOT_FOUND when doctor user account is not ACTIVE (SUSPENDED)", async () => {
      const { profile } = await createDoctorFixture({
        userStatus: UserStatus.SUSPENDED,
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("DOCTOR_NOT_FOUND");
    });

    it("allows unauthenticated clients to access the endpoint without Authorization header", async () => {
      const { profile } = await createDoctorFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 60,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "10:00", endTime: "12:00" }],
          },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      // Public access must succeed without token
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots).toHaveLength(2);
    });

    it("resolves doctor availability by doctor userId as well as profile _id", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "10:00" }],
          },
        ],
      });

      // Call endpoint using the user's _id
      const res = await request(app)
        .get(`/api/v1/doctors/${doctorUser._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots).toHaveLength(2);
      expect(res.body.data.doctorId).toBe(profile._id.toString());
    });
  });

  // =========================================================================
  // 6. Timezone & Cross-Date Isolation
  // =========================================================================
  describe("6. Timezone Consistency & Date Boundaries", () => {
    it("does not let appointments on adjacent dates bleed into requested date", async () => {
      const { user: doctorUser, profile } = await createDoctorFixture();
      const patient = await createPatientFixture();

      await DoctorAvailability.create({
        doctorId: profile._id,
        slotDurationMinutes: 30,
        weeklySchedule: [
          {
            dayOfWeek: DayOfWeek.THURSDAY,
            shifts: [{ startTime: "09:00", endTime: "10:00" }],
          },
        ],
      });

      // Appointment on Friday 2026-10-16 at 09:00 - 09:30
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-16T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-16T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
      });

      // Appointment on Wednesday 2026-10-14 at 09:00 - 09:30
      await createAppointmentFixture({
        patientId: patient._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date("2026-10-14T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-14T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
      });

      // Request for Thursday 2026-10-15
      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("X-Forwarded-For", getUniqueIp());

      expect(res.status).toBe(200);
      // Both Thursday slots should be available
      expect(res.body.data.slots).toEqual([
        { startTime: "09:00", endTime: "09:30", available: true },
        { startTime: "09:30", endTime: "10:00", available: true },
      ]);
    });
  });

  // =========================================================================
  // 7. Rate Limiting Middleware
  // =========================================================================
  describe("7. Rate Limiting", () => {
    it("attaches standard RateLimit-* headers to responses", async () => {
      const { profile } = await createDoctorFixture();

      const res = await request(app)
        .get(`/api/v1/doctors/${profile._id}/availability?date=2026-10-15`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.headers["ratelimit-limit"]).toBe("100");
      expect(res.headers["ratelimit-remaining"]).toBeDefined();
    });
  });
});

