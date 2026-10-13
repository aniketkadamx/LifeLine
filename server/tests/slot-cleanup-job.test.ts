import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { Appointment, User, DoctorProfile } from "../src/models/index.js";
import {
  AppointmentStatus,
  ConsultationType,
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
} from "../src/types/models.js";
import {
  releaseExpiredSlots,
  startSlotCleanupJob,
  stopSlotCleanupJob,
  isSlotCleanupJobActive,
} from "../src/jobs/slot-cleanup.job.js";
import { startAllJobs, stopAllJobs } from "../src/jobs/index.js";

describe("Milestone 6 - Task 6.3: Scheduled Worker for Abandoned Slot Release", () => {
  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_slot_cleanup_test"
    );
    await Appointment.syncIndexes();
  }, 30000);

  afterAll(async () => {
    stopSlotCleanupJob();
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    stopSlotCleanupJob();
    if (mongoose.connection.readyState === 1) {
      await Appointment.deleteMany({});
      await User.deleteMany({});
      await DoctorProfile.deleteMany({});
    }
  });

  async function createDoctorAndPatient() {
    const doctorUser = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHashForTesting123",
      fullName: "Dr. Cleanup Test",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "General Medicine",
      qualifications: ["MBBS"],
      experienceYears: 10,
      registrationNumber: `REG-${doctorUser._id.toString().slice(-8).toUpperCase()}`,
      registrationCouncil: "Medical Council",
      consultationFee: 1000,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    const patientUser = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHashForTesting123",
      fullName: "Patient Cleanup Test",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    return { doctorUser, doctorProfile, patientUser };
  }

  it("1. an appointment with PENDING_PAYMENT and an expired lock becomes CANCELLED and frees active slot", async () => {
    const { doctorUser, patientUser } = await createDoctorAndPatient();
    const scheduledStart = new Date("2026-10-20T10:00:00.000Z");
    const scheduledEnd = new Date("2026-10-20T10:30:00.000Z");

    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart,
      scheduledEnd,
      status: AppointmentStatus.PENDING_PAYMENT,
      reason: "Initial consultation",
      fee: 1000,
      currency: "INR",
      lockExpiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
    });

    const result = await releaseExpiredSlots();
    expect(result.modifiedCount).toBe(1);

    const updated = await Appointment.findById(appt._id);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(AppointmentStatus.CANCELLED);
    expect(updated!.cancellation?.reason).toBe(
      "15-minute reservation lock expired without payment"
    );
    expect(updated!.cancellation?.cancelledAt).toBeInstanceOf(Date);
    expect(updated!.lockExpiresAt).toBeUndefined();

    // Verify the slot is freed: another active booking on the exact same slot does not collide
    const newPatient = await User.create({
      email: `patient2.${Date.now()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHash123",
      fullName: "Second Patient",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const newBooking = await Appointment.create({
      patientId: newPatient._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart,
      scheduledEnd,
      status: AppointmentStatus.CONFIRMED,
      reason: "New patient booked freed slot",
      fee: 1000,
      currency: "INR",
    });

    expect(newBooking._id).toBeDefined();
    expect(newBooking.status).toBe(AppointmentStatus.CONFIRMED);
  });

  it("2. a PENDING_PAYMENT appointment whose lock expires in the future remains unchanged", async () => {
    const { doctorUser, patientUser } = await createDoctorAndPatient();
    const futureLock = new Date(Date.now() + 10 * 60 * 1000); // Expires in 10 minutes

    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date("2026-10-20T11:00:00.000Z"),
      scheduledEnd: new Date("2026-10-20T11:30:00.000Z"),
      status: AppointmentStatus.PENDING_PAYMENT,
      reason: "Consultation in active 15m window",
      fee: 1000,
      currency: "INR",
      lockExpiresAt: futureLock,
    });

    const result = await releaseExpiredSlots();
    expect(result.modifiedCount).toBe(0);

    const check = await Appointment.findById(appt._id);
    expect(check!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    expect(check!.lockExpiresAt?.getTime()).toBe(futureLock.getTime());
    expect(check!.cancellation).toBeUndefined();
  });

  it("3. an appointment with CONFIRMED status remains unchanged even if its expiration timestamp is in the past", async () => {
    const { doctorUser, patientUser } = await createDoctorAndPatient();

    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date("2026-10-20T12:00:00.000Z"),
      scheduledEnd: new Date("2026-10-20T12:30:00.000Z"),
      status: AppointmentStatus.CONFIRMED,
      reason: "Paid and confirmed appointment",
      fee: 1000,
      currency: "INR",
      lockExpiresAt: new Date(Date.now() - 30000), // Expired lock timestamp
    });

    const result = await releaseExpiredSlots();
    expect(result.modifiedCount).toBe(0);

    const check = await Appointment.findById(appt._id);
    expect(check!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(check!.cancellation).toBeUndefined();
  });

  it("4. a missing or null lockExpiresAt is not incorrectly cancelled", async () => {
    const { doctorUser, patientUser } = await createDoctorAndPatient();

    // Appointment with null/undefined lockExpiresAt
    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date("2026-10-20T13:00:00.000Z"),
      scheduledEnd: new Date("2026-10-20T13:30:00.000Z"),
      status: AppointmentStatus.PENDING_PAYMENT,
      reason: "Missing lockExpiresAt",
      fee: 1000,
      currency: "INR",
    });

    const result = await releaseExpiredSlots();
    expect(result.modifiedCount).toBe(0);

    const check = await Appointment.findById(appt._id);
    expect(check!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    expect(check!.cancellation).toBeUndefined();
  });

  it("5. repeated worker runs are safe, idempotent, and do not corrupt appointment state", async () => {
    const { doctorUser, patientUser } = await createDoctorAndPatient();

    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date("2026-10-20T14:00:00.000Z"),
      scheduledEnd: new Date("2026-10-20T14:30:00.000Z"),
      status: AppointmentStatus.PENDING_PAYMENT,
      reason: "Idempotency test appointment",
      fee: 1000,
      currency: "INR",
      lockExpiresAt: new Date(Date.now() - 10000),
    });

    // Run 1: updates the appointment
    const run1 = await releaseExpiredSlots();
    expect(run1.modifiedCount).toBe(1);

    const afterRun1 = await Appointment.findById(appt._id);
    expect(afterRun1!.status).toBe(AppointmentStatus.CANCELLED);

    // Run 2: finds 0 matches because already CANCELLED
    const run2 = await releaseExpiredSlots();
    expect(run2.modifiedCount).toBe(0);

    // Run 3: finds 0 matches
    const run3 = await releaseExpiredSlots();
    expect(run3.modifiedCount).toBe(0);

    const afterRun3 = await Appointment.findById(appt._id);
    expect(afterRun3!.status).toBe(AppointmentStatus.CANCELLED);
    expect(afterRun3!.cancellation?.reason).toBe(
      "15-minute reservation lock expired without payment"
    );
  });

  it("6. a database failure is logged/handled without crashing the server", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const updateManySpy = vi
      .spyOn(Appointment, "updateMany")
      .mockRejectedValueOnce(new Error("Simulated MongoDB connection drop"));

    try {
      // Trigger job execution
      startSlotCleanupJob(60000, true);

      // Give async execution a tick to finish
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCall = consoleErrorSpy.mock.calls.find((call) =>
        call[0]?.includes("[SlotCleanupJob] Error releasing expired reservation locks")
      );
      expect(errorCall).toBeDefined();
      expect(errorCall![0]).toContain("Simulated MongoDB connection drop");
    } finally {
      stopSlotCleanupJob();
      updateManySpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("7. the scheduler invokes cleanup at the intended 60-second interval", async () => {
    vi.useFakeTimers();

    const updateManySpy = vi
      .spyOn(Appointment, "updateMany")
      .mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      } as any);

    try {
      expect(isSlotCleanupJobActive()).toBe(false);

      // Start job without immediate execution
      startSlotCleanupJob(60000, false);
      expect(isSlotCleanupJobActive()).toBe(true);
      expect(updateManySpy).toHaveBeenCalledTimes(0);

      // Duplicate start call is safely ignored
      startSlotCleanupJob(60000, false);
      expect(updateManySpy).toHaveBeenCalledTimes(0);

      // Advance by 59 seconds: not triggered yet
      await vi.advanceTimersByTimeAsync(59000);
      expect(updateManySpy).toHaveBeenCalledTimes(0);

      // Advance to 60 seconds: triggered once
      await vi.advanceTimersByTimeAsync(1000);
      expect(updateManySpy).toHaveBeenCalledTimes(1);

      // Advance another 60 seconds: triggered twice
      await vi.advanceTimersByTimeAsync(60000);
      expect(updateManySpy).toHaveBeenCalledTimes(2);

      // Stop the worker
      stopSlotCleanupJob();
      expect(isSlotCleanupJobActive()).toBe(false);

      // Advance another 60 seconds: no further calls
      await vi.advanceTimersByTimeAsync(60000);
      expect(updateManySpy).toHaveBeenCalledTimes(2);
    } finally {
      stopSlotCleanupJob();
      updateManySpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("8. a concurrent status transition cannot be overwritten by cleanup", async () => {
    const { doctorUser, patientUser } = await createDoctorAndPatient();

    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date("2026-10-20T15:00:00.000Z"),
      scheduledEnd: new Date("2026-10-20T15:30:00.000Z"),
      status: AppointmentStatus.PENDING_PAYMENT,
      reason: "Race test appointment",
      fee: 1000,
      currency: "INR",
      lockExpiresAt: new Date(Date.now() - 1000), // Expired lock
    });

    // Simulate concurrent payment confirmation occurring right before or during cleanup
    await Appointment.updateOne(
      { _id: appt._id, status: AppointmentStatus.PENDING_PAYMENT },
      {
        $set: {
          status: AppointmentStatus.CONFIRMED,
          paymentStatus: "PAID",
        },
        $unset: { lockExpiresAt: 1 },
      }
    );

    // Run cleanup
    const result = await releaseExpiredSlots();
    expect(result.modifiedCount).toBe(0);

    // Verify appointment was NOT overwritten to CANCELLED
    const after = await Appointment.findById(appt._id);
    expect(after!.status).toBe(AppointmentStatus.CONFIRMED);
    expect(after!.paymentStatus).toBe("PAID");
    expect(after!.cancellation).toBeUndefined();
  });

  it("9. index exports startAllJobs and stopAllJobs operate cleanly", () => {
    expect(isSlotCleanupJobActive()).toBe(false);
    startAllJobs();
    expect(isSlotCleanupJobActive()).toBe(true);
    stopAllJobs();
    expect(isSlotCleanupJobActive()).toBe(false);
  });
});
