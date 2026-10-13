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
import { availabilityService } from "../src/services/availability.service.js";

describe("Milestone 6 - Task 6.2: Appointment Management (List, Reschedule, Cancel)", () => {
  let ipCounter = 8000;

  function getUniqueIp(): string {
    ipCounter += 1;
    return `192.168.180.${ipCounter}`;
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_appointment_management_test"
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

    // Thursday schedule: 09:00 - 15:00
    await DoctorAvailability.create({
      doctorId: profile._id,
      slotDurationMinutes: overrides.slotDurationMinutes || 30,
      weeklySchedule: [
        {
          dayOfWeek: DayOfWeek.THURSDAY,
          shifts: overrides.shifts || [
            { startTime: "09:00", endTime: "15:00" },
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

  // Helper: creates an admin user with access token
  async function createAdminFixture() {
    const user = await User.create({
      email: `admin.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$SomeHashedSecretPasswordNotRealBcryptValueForTesting123",
      fullName: "Super Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, token };
  }

  // =========================================================================
  // 1. Mandatory Acceptance Tests (2-Hour Policy Rule)
  // =========================================================================
  describe("1. Mandatory Acceptance Tests (2-Hour Cancellation Policy)", () => {
    it("patient cancels within two hours (starts in 1 hour): rejects with 422 APPOINTMENT_CANCELLATION_WINDOW_EXPIRED, appointment and active slot remain protected", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token: patientToken } = await createPatientFixture();

      // Appointment starts in exactly 1 hour from now
      const scheduledStart = new Date(Date.now() + 1 * 60 * 60 * 1000);
      const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60 * 1000);

      const appointment = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart,
        scheduledEnd,
        status: AppointmentStatus.CONFIRMED,
        reason: "Flu follow-up consultation",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Suddenly busy, please cancel" });

      // Mandatory assertion: HTTP 422
      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("APPOINTMENT_CANCELLATION_WINDOW_EXPIRED");
      expect(res.body.error.message).toContain("within 2 hours");

      // Verify appointment remains unchanged in DB
      const dbAppt = await Appointment.findById(appointment._id);
      expect(dbAppt!.status).toBe(AppointmentStatus.CONFIRMED);
      expect(dbAppt!.cancellation).toBeUndefined();

      // Verify slot is STILL occupied and cannot be double-booked
      const { token: otherPatientToken } = await createPatientFixture();
      const doubleBookRes = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${otherPatientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: doctorUser.doctorProfile!.toString(),
          appointmentType: "VIDEO",
          scheduledStart: scheduledStart.toISOString(),
          reason: "Attempt to take protected slot",
        });

      expect(doubleBookRes.status).toBe(409);
      expect(doubleBookRes.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
    });

    it("patient cancels more than two hours before start (starts in 5 hours): succeeds (200), transitions to CANCELLED, and frees the active slot", async () => {
      const { user: doctorUser, profile: doctorProfile } = await createDoctorFixture();
      const { user: patientUser, token: patientToken } = await createPatientFixture();

      // Thursday slot 5 hours in the future
      const scheduledStart = new Date("2026-10-15T10:00:00.000Z");
      const scheduledEnd = new Date("2026-10-15T10:30:00.000Z");

      const appointment = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart,
        scheduledEnd,
        status: AppointmentStatus.CONFIRMED,
        reason: "Routine health check",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Rescheduling required due to travel" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("CANCELLED");
      expect(res.body.data.cancellation).toBeDefined();
      expect(res.body.data.cancellation.reason).toBe("Rescheduling required due to travel");

      // Verify DB state
      const dbAppt = await Appointment.findById(appointment._id);
      expect(dbAppt!.status).toBe(AppointmentStatus.CANCELLED);

      // Verify old slot is now FREE and a new patient can book it successfully!
      const { token: newPatientToken } = await createPatientFixture();
      const rebookRes = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${newPatientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: doctorProfile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: "2026-10-15T10:00:00.000Z",
          reason: "Booking newly freed slot",
        });

      expect(rebookRes.status).toBe(201);
      expect(rebookRes.body.success).toBe(true);
      expect(rebookRes.body.data.status).toBe("PENDING_PAYMENT");
    });
  });

  // =========================================================================
  // 2. Cancellation Authorization, Edge Cases & State Machine
  // =========================================================================
  describe("2. Cancellation Authorization & State Machine Guards", () => {
    it("patient cannot cancel another patient's appointment: rejects with 403 AUTH_RESOURCE_ACCESS_DENIED", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patient1 } = await createPatientFixture();
      const { token: patient2Token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient1._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 1 appointment",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${patient2Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Malicious cancellation attempt" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("doctor cannot cancel an appointment assigned to another doctor: rejects with 403 AUTH_RESOURCE_ACCESS_DENIED", async () => {
      const { user: doctor1 } = await createDoctorFixture({ fullName: "Dr. One" });
      const { token: doctor2Token } = await createDoctorFixture({ fullName: "Dr. Two" });
      const { user: patient } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor1._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Dr. One appointment",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${doctor2Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Unauthorized doctor cancellation" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("assigned doctor can cancel their appointment (even within 2 hours): succeeds (200)", async () => {
      const { user: doctor, token: doctorToken } = await createDoctorFixture();
      const { user: patient } = await createPatientFixture();

      // Starts in 30 minutes
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(Date.now() + 30 * 60 * 1000),
        scheduledEnd: new Date(Date.now() + 60 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        reason: "Emergency surgery for doctor",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Doctor called for emergency surgery" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("CANCELLED");
    });

    it("admin can cancel any appointment: succeeds (200)", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient } = await createPatientFixture();
      const { token: adminToken } = await createAdminFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(Date.now() + 30 * 60 * 1000),
        scheduledEnd: new Date(Date.now() + 60 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        reason: "Administrative cancellation",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Cancelled by platform administrator" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("CANCELLED");
    });

    it("non-existent appointment returns 404 APPOINTMENT_NOT_FOUND", async () => {
      const { token: patientToken } = await createPatientFixture();
      const fakeId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .patch(`/api/v1/appointments/${fakeId}/cancel`)
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Reason for non-existent appointment" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("APPOINTMENT_NOT_FOUND");
    });

    it("malformed appointment ID returns 400 BAD_REQUEST", async () => {
      const { token: patientToken } = await createPatientFixture();

      const res = await request(app)
        .patch("/api/v1/appointments/not-a-valid-object-id/cancel")
        .set("Authorization", `Bearer ${patientToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Valid cancellation reason string" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("cannot cancel an already CANCELLED appointment: returns 409 APPOINTMENT_INVALID_TRANSITION", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CANCELLED,
        reason: "Already cancelled",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Attempt second cancellation" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("cannot cancel a COMPLETED appointment: returns 409 APPOINTMENT_ALREADY_COMPLETED", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.COMPLETED,
        reason: "Consultation finished",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Attempt cancel completed" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_ALREADY_COMPLETED");
    });

    it("rejects cancellation without reason or reason under 5 characters: returns 422 VALIDATION_ERROR", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Checkup",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "bad" }); // < 5 chars

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // 3. Appointment Listing (GET /api/v1/appointments)
  // =========================================================================
  describe("3. Appointment Listing & Scoping", () => {
    it("patient sees only their own appointments", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient1, token: patient1Token } = await createPatientFixture({ fullName: "Patient 1" });
      const { user: patient2 } = await createPatientFixture({ fullName: "Patient 2" });

      // Create 2 appointments for Patient 1 and 1 for Patient 2
      await Appointment.create({
        patientId: patient1._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 1 First",
        fee: 1200,
        currency: "INR",
      });

      await Appointment.create({
        patientId: patient1._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 1 Second",
        fee: 1200,
        currency: "INR",
      });

      await Appointment.create({
        patientId: patient2._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T11:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T11:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 2 Secret Checkup",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .get("/api/v1/appointments")
        .set("Authorization", `Bearer ${patient1Token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);

      // Verify none of Patient 2's appointments are exposed
      const reasons = res.body.data.map((a: any) => a.reason);
      expect(reasons).toContain("Patient 1 First");
      expect(reasons).toContain("Patient 1 Second");
      expect(reasons).not.toContain("Patient 2 Secret Checkup");
    });

    it("doctor sees only their assigned appointments", async () => {
      const { user: doctor1, token: doctor1Token } = await createDoctorFixture({ fullName: "Dr. Gregory House" });
      const { user: doctor2 } = await createDoctorFixture({ fullName: "Dr. James Wilson" });
      const { user: patient } = await createPatientFixture();

      await Appointment.create({
        patientId: patient._id,
        doctorId: doctor1._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Assigned to Doctor 1",
        fee: 1200,
        currency: "INR",
      });

      await Appointment.create({
        patientId: patient._id,
        doctorId: doctor2._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Assigned to Doctor 2",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .get("/api/v1/appointments")
        .set("Authorization", `Bearer ${doctor1Token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].reason).toBe("Assigned to Doctor 1");
    });

    it("caller cannot widen results by supplying another user's ID in query parameters", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient1, token: patient1Token } = await createPatientFixture({ fullName: "Patient 1" });
      const { user: patient2 } = await createPatientFixture({ fullName: "Patient 2" });

      await Appointment.create({
        patientId: patient2._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 2 Data",
        fee: 1200,
        currency: "INR",
      });

      // Patient 1 tries to query Patient 2's appointments
      const res = await request(app)
        .get(`/api/v1/appointments?patientId=${patient2._id}`)
        .set("Authorization", `Bearer ${patient1Token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(200);
      // Returns 0 appointments because query is strictly scoped to authenticated user patient1
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it("admin can see all appointments and filter by patientId or doctorId", async () => {
      const { user: doctor1 } = await createDoctorFixture();
      const { user: doctor2 } = await createDoctorFixture();
      const { user: patient } = await createPatientFixture();
      const { token: adminToken } = await createAdminFixture();

      await Appointment.create({
        patientId: patient._id,
        doctorId: doctor1._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Appt 1",
        fee: 1200,
        currency: "INR",
      });

      await Appointment.create({
        patientId: patient._id,
        doctorId: doctor2._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Appt 2",
        fee: 1200,
        currency: "INR",
      });

      // Admin sees all without filter
      const resAll = await request(app)
        .get("/api/v1/appointments")
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resAll.status).toBe(200);
      expect(resAll.body.data).toHaveLength(2);

      // Admin filters by doctorId
      const resFiltered = await request(app)
        .get(`/api/v1/appointments?doctorId=${doctor1._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resFiltered.status).toBe(200);
      expect(resFiltered.body.data).toHaveLength(1);
      expect(resFiltered.body.data[0].reason).toBe("Appt 1");
    });

    it("filters appointments by status and date range with standard pagination", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Confirmed Appt",
        fee: 1200,
        currency: "INR",
      });

      await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T10:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CANCELLED,
        reason: "Cancelled Appt",
        fee: 1200,
        currency: "INR",
      });

      // Filter by status=CANCELLED
      const resStatus = await request(app)
        .get("/api/v1/appointments?status=CANCELLED")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resStatus.status).toBe(200);
      expect(resStatus.body.data).toHaveLength(1);
      expect(resStatus.body.data[0].status).toBe("CANCELLED");

      // Pagination check
      const resPage = await request(app)
        .get("/api/v1/appointments?page=1&limit=1")
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp());

      expect(resPage.status).toBe(200);
      expect(resPage.body.data).toHaveLength(1);
      expect(resPage.body.meta.limit).toBe(1);
      expect(resPage.body.meta.total).toBe(2);
      expect(resPage.body.meta.totalPages).toBe(2);
      expect(resPage.body.meta.hasNextPage).toBe(true);
    });

    it("unauthenticated request returns 401 AUTH_TOKEN_MISSING", async () => {
      const res = await request(app)
        .get("/api/v1/appointments")
        .set("x-test-client-ip", getUniqueIp());

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });
  });

  // =========================================================================
  // 4. Appointment Rescheduling (PATCH /api/v1/appointments/:id/reschedule)
  // =========================================================================
  describe("4. Appointment Rescheduling & Atomic Slot Shifting", () => {
    it("valid reschedule updates the intended appointment to the new slot", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const originalStart = new Date("2026-10-15T09:00:00.000Z");
      const originalEnd = new Date("2026-10-15T09:30:00.000Z");
      const targetStart = "2026-10-15T11:00:00.000Z";

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: originalStart,
        scheduledEnd: originalEnd,
        status: AppointmentStatus.CONFIRMED,
        reason: "Initial consultation",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          scheduledStart: targetStart,
          reason: "Need later slot at 11am",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(appointment._id.toString());
      expect(res.body.data.scheduledStart).toBe(targetStart);
      expect(res.body.data.scheduledEnd).toBe("2026-10-15T11:30:00.000Z");
      expect(res.body.data.status).toBe("CONFIRMED");

      // Verify in DB
      const dbAppt = await Appointment.findById(appointment._id);
      expect(dbAppt!.scheduledStart.toISOString()).toBe(targetStart);
    });

    it("conflicting target slot is rejected with 409 APPOINTMENT_SLOT_UNAVAILABLE and leaves original slot reserved", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient1, token: patient1Token } = await createPatientFixture();
      const { user: patient2 } = await createPatientFixture();

      const slotA = new Date("2026-10-15T09:00:00.000Z");
      const slotB = new Date("2026-10-15T10:00:00.000Z");

      // Patient 1 has slot A
      const appt1 = await Appointment.create({
        patientId: patient1._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: slotA,
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 1 on Slot A",
        fee: 1200,
        currency: "INR",
      });

      // Patient 2 already occupies slot B
      await Appointment.create({
        patientId: patient2._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: slotB,
        scheduledEnd: new Date("2026-10-15T10:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 2 on Slot B",
        fee: 1200,
        currency: "INR",
      });

      // Patient 1 attempts to reschedule to occupied Slot B
      const res = await request(app)
        .patch(`/api/v1/appointments/${appt1._id}/reschedule`)
        .set("Authorization", `Bearer ${patient1Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: slotB.toISOString() });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");

      // Verify Appt 1 is STILL at Slot A and was NOT shifted
      const dbAppt1 = await Appointment.findById(appt1._id);
      expect(dbAppt1!.scheduledStart.toISOString()).toBe(slotA.toISOString());
    });

    it("a subsequent booking can use the old slot only after successful rescheduling", async () => {
      const { user: doctor, profile: doctorProfile } = await createDoctorFixture();
      const { user: patient1, token: patient1Token } = await createPatientFixture();
      const { token: patient2Token } = await createPatientFixture();

      const slotA = "2026-10-15T09:00:00.000Z";
      const slotB = "2026-10-15T11:00:00.000Z";

      const appt1 = await Appointment.create({
        patientId: patient1._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(slotA),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Initial booking",
        fee: 1200,
        currency: "INR",
      });

      // Patient 1 reschedules from Slot A to Slot B
      const resReschedule = await request(app)
        .patch(`/api/v1/appointments/${appt1._id}/reschedule`)
        .set("Authorization", `Bearer ${patient1Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: slotB });

      expect(resReschedule.status).toBe(200);

      // Now Patient 2 can book the newly freed Slot A!
      const resBookOldSlot = await request(app)
        .post("/api/v1/appointments")
        .set("Authorization", `Bearer ${patient2Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({
          doctorId: doctorProfile._id.toString(),
          appointmentType: "VIDEO",
          scheduledStart: slotA,
          reason: "Booking Slot A after reschedule",
        });

      expect(resBookOldSlot.status).toBe(201);
      expect(resBookOldSlot.body.success).toBe(true);
    });

    it("rescheduling to slot outside doctor working hours returns 409 APPOINTMENT_SLOT_UNAVAILABLE", async () => {
      const { user: doctor } = await createDoctorFixture(); // Working hours: 09:00 - 15:00
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Working hours check",
        fee: 1200,
        currency: "INR",
      });

      // Attempt to reschedule to 20:00 (outside shifts)
      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T20:00:00.000Z" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_SLOT_UNAVAILABLE");
    });

    it("rescheduling to past date returns 422 APPOINTMENT_PAST_DATE", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Past date check",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2020-01-01T09:00:00.000Z" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("APPOINTMENT_PAST_DATE");
    });

    it("cannot reschedule an already CANCELLED appointment: returns 409 APPOINTMENT_INVALID_TRANSITION", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CANCELLED,
        reason: "Cancelled appt",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T11:00:00.000Z" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("patient cannot reschedule another patient's appointment: returns 403 AUTH_RESOURCE_ACCESS_DENIED", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient1 } = await createPatientFixture();
      const { token: patient2Token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient1._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Patient 1 appointment",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${patient2Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T11:00:00.000Z" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });
  });

  // =========================================================================
  // 5. Concurrency Races & Lifecycle Transition Guards (Deterministic Tests)
  // =========================================================================
  describe("5. Concurrency Races & Lifecycle Transition Guards", () => {
    function createDeferred<T = void>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it("patient cancels at exactly two hours before start (120 minutes): rejects with 422 APPOINTMENT_CANCELLATION_WINDOW_EXPIRED", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      // Exactly 120 minutes (2.0 hours) from now
      const exactlyTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: exactlyTwoHours,
        scheduledEnd: new Date(exactlyTwoHours.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        reason: "Exact 2-hour boundary appointment",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Cancel at exact boundary" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("APPOINTMENT_CANCELLATION_WINDOW_EXPIRED");

      const dbAppt = await Appointment.findById(appointment._id);
      expect(dbAppt!.status).toBe(AppointmentStatus.CONFIRMED);
    });

    it("cannot reschedule a PENDING_PAYMENT appointment (even with active lock): rejects with 409 APPOINTMENT_INVALID_TRANSITION", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.PENDING_PAYMENT,
        lockExpiresAt: new Date(Date.now() + 10 * 60 * 1000), // Active 10-minute lock
        reason: "Unpaid reservation with active lock",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T11:00:00.000Z" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("rejects reschedule when less than four hours remain before start (e.g. 2 hours): returns 422 APPOINTMENT_RESCHEDULE_WINDOW_EXPIRED", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const twoHoursAhead = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: twoHoursAhead,
        scheduledEnd: new Date(twoHoursAhead.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        reason: "Less than 4 hours remaining",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T11:00:00.000Z" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("APPOINTMENT_RESCHEDULE_WINDOW_EXPIRED");

      const dbAppt = await Appointment.findById(appointment._id);
      expect(dbAppt!.scheduledStart.toISOString()).toBe(twoHoursAhead.toISOString());
    });

    it("rejects reschedule at exactly four hours boundary (240 minutes): returns 422 APPOINTMENT_RESCHEDULE_WINDOW_EXPIRED", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const exactlyFourHours = new Date(Date.now() + 4 * 60 * 60 * 1000);
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: exactlyFourHours,
        scheduledEnd: new Date(exactlyFourHours.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.CONFIRMED,
        reason: "Exact 4 hours boundary",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T11:00:00.000Z" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("APPOINTMENT_RESCHEDULE_WINDOW_EXPIRED");

      const dbAppt = await Appointment.findById(appointment._id);
      expect(dbAppt!.scheduledStart.toISOString()).toBe(exactlyFourHours.toISOString());
    });

    it("allows reschedule when more than four hours remain before start: passes cutoff check", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const originalStart = new Date("2026-10-15T09:00:00.000Z"); // >4 hours ahead
      const targetStart = "2026-10-15T11:00:00.000Z";
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: originalStart,
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "More than 4 hours ahead",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: targetStart });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scheduledStart).toBe(targetStart);
    });

    it("assigned doctor can reschedule their appointment (when > 4 hours)", async () => {
      const { user: doctor, token: doctorToken } = await createDoctorFixture();
      const { user: patient } = await createPatientFixture();

      const originalStart = new Date("2026-10-15T09:00:00.000Z");
      const targetStart = "2026-10-15T11:00:00.000Z";
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: originalStart,
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Assigned doctor rescheduling",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: targetStart, reason: "Doctor shifted consultation" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scheduledStart).toBe(targetStart);
    });

    it("different doctor cannot reschedule an appointment assigned to another doctor: returns 403 AUTH_RESOURCE_ACCESS_DENIED", async () => {
      const { user: doctor1 } = await createDoctorFixture();
      const { token: doctor2Token } = await createDoctorFixture();
      const { user: patient } = await createPatientFixture();

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor1._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Doctor 1 Appt",
        fee: 1200,
        currency: "INR",
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
        .set("Authorization", `Bearer ${doctor2Token}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ scheduledStart: "2026-10-15T11:00:00.000Z" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("route middleware and service both authorize legitimate assigned doctor when appointment doctorId is doctorProfile._id", async () => {
      const { profile: doctorProfile, token: doctorToken } = await createDoctorFixture();
      const { user: patient } = await createPatientFixture();

      // Appointment created with doctorProfile._id instead of doctor.user._id
      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctorProfile._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date("2026-10-15T09:00:00.000Z"),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Profile ID appointment",
        fee: 1200,
        currency: "INR",
      });

      // Cancellation check
      const resCancel = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .set("x-test-client-ip", getUniqueIp())
        .send({ cancellationReason: "Doctor cancelling by profile ID match" });

      expect(resCancel.status).toBe(200);
      expect(resCancel.body.success).toBe(true);
      expect(resCancel.body.data.status).toBe("CANCELLED");
    });

    it("concurrent reschedules of same appointment cannot overwrite each other (stale read detection)", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const slotInitial = "2026-10-15T09:00:00.000Z";
      const slotA = "2026-10-15T10:00:00.000Z";
      const slotB = "2026-10-15T11:00:00.000Z";

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(slotInitial),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Original appointment",
        fee: 1200,
        currency: "INR",
      });

      const reqBReachedBarrier = createDeferred();
      const reqBReleaseBarrier = createDeferred();
      let interceptReqB = true;

      const originalComputeSlots = availabilityService.computeAvailableSlots.bind(availabilityService);
      const computeSpy = vi
        .spyOn(availabilityService, "computeAvailableSlots")
        .mockImplementation((...args: any[]) => {
          if (interceptReqB) {
            interceptReqB = false;
            return originalComputeSlots(...args).then((res) => {
              reqBReachedBarrier.resolve();
              return reqBReleaseBarrier.promise.then(() => res);
            });
          }
          return originalComputeSlots(...args);
        });

      try {
        // Request B starts and reads appointment at slotInitial (09:00), then pauses at barrier
        const reqBPromise = request(app)
          .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
          .set("Authorization", `Bearer ${token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send({ scheduledStart: slotB, reason: "Request B to slot B" })
          .then((res) => res);

        // Wait until Request B has read the appointment at 09:00 and computed target slots
        await reqBReachedBarrier.promise;

        // Request A executes completely and moves appointment to slotA (10:00)
        const resA = await request(app)
          .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
          .set("Authorization", `Bearer ${token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send({ scheduledStart: slotA, reason: "Request A to slot A" });

        expect(resA.status).toBe(200);
        expect(resA.body.data.scheduledStart).toBe(slotA);

        // Now resume Request B (which holds a stale read of slotInitial: 09:00)
        reqBReleaseBarrier.resolve();
        const resB = await reqBPromise;

        // Request B must be rejected due to conditional update detecting stale schedule
        expect(resB.status).toBe(409);
        expect(resB.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");

        // Verify the appointment remains at slotA (Request B did not overwrite Request A)
        const dbAppt = await Appointment.findById(appointment._id);
        expect(dbAppt!.scheduledStart.toISOString()).toBe(slotA);
        expect(dbAppt!.reason).toBe("Request A to slot A");
      } finally {
        computeSpy.mockRestore();
        reqBReleaseBarrier.resolve();
      }
    });

    it("concurrent reschedule and cancellation cannot produce an invalid lifecycle transition", async () => {
      const { user: doctor } = await createDoctorFixture();
      const { user: patient, token } = await createPatientFixture();

      const slotInitial = "2026-10-15T09:00:00.000Z";
      const slotNew = "2026-10-15T11:00:00.000Z";

      const appointment = await Appointment.create({
        patientId: patient._id,
        doctorId: doctor._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(slotInitial),
        scheduledEnd: new Date("2026-10-15T09:30:00.000Z"),
        status: AppointmentStatus.CONFIRMED,
        reason: "Appointment for race test",
        fee: 1200,
        currency: "INR",
      });

      const rescheduleReachedBarrier = createDeferred();
      const rescheduleReleaseBarrier = createDeferred();
      let interceptReschedule = true;

      const originalComputeSlots = availabilityService.computeAvailableSlots.bind(availabilityService);
      const computeSpy = vi
        .spyOn(availabilityService, "computeAvailableSlots")
        .mockImplementation((...args: any[]) => {
          if (interceptReschedule) {
            interceptReschedule = false;
            return originalComputeSlots(...args).then((res) => {
              rescheduleReachedBarrier.resolve();
              return rescheduleReleaseBarrier.promise.then(() => res);
            });
          }
          return originalComputeSlots(...args);
        });

      try {
        // Reschedule starts and reads appointment as CONFIRMED, then pauses
        const reschedulePromise = request(app)
          .patch(`/api/v1/appointments/${appointment._id}/reschedule`)
          .set("Authorization", `Bearer ${token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send({ scheduledStart: slotNew })
          .then((res) => res);

        await rescheduleReachedBarrier.promise;

        // Concurrently, patient cancels the appointment
        const resCancel = await request(app)
          .patch(`/api/v1/appointments/${appointment._id}/cancel`)
          .set("Authorization", `Bearer ${token}`)
          .set("x-test-client-ip", getUniqueIp())
          .send({ cancellationReason: "Cancelled while reschedule was pending" });

        expect(resCancel.status).toBe(200);

        // Resume reschedule request
        rescheduleReleaseBarrier.resolve();
        const resReschedule = await reschedulePromise;

        // Reschedule must be rejected with 409 because appointment became CANCELLED
        expect(resReschedule.status).toBe(409);
        expect(resReschedule.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");

        // Appointment remains CANCELLED at original slot, not shifted
        const dbAppt = await Appointment.findById(appointment._id);
        expect(dbAppt!.status).toBe(AppointmentStatus.CANCELLED);
      } finally {
        computeSpy.mockRestore();
        rescheduleReleaseBarrier.resolve();
      }
    });
  });
});
