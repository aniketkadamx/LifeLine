import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  Appointment,
  Payment,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  ConsultationType,
  AppointmentStatus,
  PaymentStatus,
  PaymentProvider,
  PaymentTargetType,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  setRazorpayClient,
  getRazorpayClient,
  getRazorpayPublicKey,
} from "../src/integrations/payment/razorpay.client.js";
import { convertToSmallestCurrencyUnit } from "../src/services/payment.service.js";

describe("Milestone 7 - Task 7.1: Razorpay Order Intent Service", () => {
  let mockOrdersCreate: any;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_payment_intent_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Payment.syncIndexes();
  }, 30000);

  afterAll(async () => {
    setRazorpayClient(null);
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await Payment.deleteMany({});
      await Appointment.deleteMany({});
      await DoctorProfile.deleteMany({});
      await User.deleteMany({});
    }

    mockOrdersCreate = vi.fn().mockImplementation(async (params: any) => ({
      id: "order_mock1234567890",
      amount: params.amount,
      currency: params.currency,
      receipt: params.receipt,
      status: "created",
    }));

    setRazorpayClient(
      {
        orders: {
          create: mockOrdersCreate,
        },
      } as any,
      "rzp_test_mock_key_id"
    );
  });

  async function createDoctorFixture() {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHashForTesting123",
      fullName: "Dr. Payment Test",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: "General Practice",
      qualifications: ["MBBS"],
      experienceYears: 10,
      registrationNumber: `REG-${user._id.toString().slice(-8).toUpperCase()}`,
      registrationCouncil: "Medical Council",
      consultationFee: 1200,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    return { user, profile };
  }

  async function createPatientFixture(overrides: { fullName?: string } = {}) {
    const user = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHashForTesting123",
      fullName: overrides.fullName || "Patient Buyer",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const token = tokenService.generateAccessToken(user.id, user.role);

    return { user, token };
  }

  async function createAppointmentFixture(
    patientId: mongoose.Types.ObjectId,
    doctorId: mongoose.Types.ObjectId,
    overrides: {
      status?: AppointmentStatus;
      fee?: number;
      currency?: string;
      lockExpiresAt?: Date;
    } = {}
  ) {
    const scheduledStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60 * 1000);

    return Appointment.create({
      patientId,
      doctorId,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart,
      scheduledEnd,
      status: overrides.status || AppointmentStatus.PENDING_PAYMENT,
      reason: "Routine medical consultation",
      fee: overrides.fee ?? 1200,
      currency: overrides.currency || "INR",
      lockExpiresAt: overrides.lockExpiresAt || new Date(Date.now() + 15 * 60 * 1000),
    });
  }

  // =========================================================================
  // 1. Currency Conversion Unit Tests (Integer-Safe)
  // =========================================================================
  describe("1. Currency Conversion (Integer-Safe Subunits)", () => {
    it("converts standard whole amounts accurately", () => {
      expect(convertToSmallestCurrencyUnit(1200, "INR")).toBe(120000);
      expect(convertToSmallestCurrencyUnit(500, "INR")).toBe(50000);
      expect(convertToSmallestCurrencyUnit(1, "INR")).toBe(100);
    });

    it("converts decimal amounts without floating-point inaccuracies", () => {
      expect(convertToSmallestCurrencyUnit(1200.5, "INR")).toBe(120050);
      expect(convertToSmallestCurrencyUnit(1200.55, "INR")).toBe(120055);
      expect(convertToSmallestCurrencyUnit(1.14, "USD")).toBe(114);
      expect(convertToSmallestCurrencyUnit(0.01, "USD")).toBe(1);
    });

    it("supports zero-decimal and three-decimal currencies correctly", () => {
      expect(convertToSmallestCurrencyUnit(1000, "JPY")).toBe(1000);
      expect(convertToSmallestCurrencyUnit(5, "KWD")).toBe(5000);
    });

    it("rejects non-positive, zero, non-finite, and NaN amounts", () => {
      expect(() => convertToSmallestCurrencyUnit(0, "INR")).toThrow();
      expect(() => convertToSmallestCurrencyUnit(-10, "INR")).toThrow();
      expect(() => convertToSmallestCurrencyUnit(NaN, "INR")).toThrow();
      expect(() => convertToSmallestCurrencyUnit(Infinity, "INR")).toThrow();
      expect(() => convertToSmallestCurrencyUnit("100" as any, "INR")).toThrow();
    });
  });

  // =========================================================================
  // 2. Successful Order Intent Creation
  // =========================================================================
  describe("2. Successful Order Intent Creation", () => {
    it("creates Razorpay order and persists Payment document with status CREATED", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id, {
        fee: 1500,
        currency: "INR",
      });

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderId).toBe("order_mock1234567890");
      expect(res.body.data.amount).toBe(150000); // 1500 * 100 paise
      expect(res.body.data.currency).toBe("INR");
      expect(res.body.data.paymentId).toBeDefined();
      expect(res.body.data.keyId).toBe("rzp_test_mock_key_id");

      // Verify Razorpay Orders API was invoked with exact parameters
      expect(mockOrdersCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockOrdersCreate.mock.calls[0][0];
      expect(callArgs.amount).toBe(150000);
      expect(callArgs.currency).toBe("INR");
      expect(callArgs.receipt).toBe(`rcpt_${appt._id.toString()}`);
      expect(callArgs.notes.appointmentId).toBe(appt._id.toString());
      expect(callArgs.notes.patientId).toBe(patientUser._id.toString());

      // Verify Payment document in MongoDB
      const paymentDoc = await Payment.findById(res.body.data.paymentId);
      expect(paymentDoc).not.toBeNull();
      expect(paymentDoc!.status).toBe(PaymentStatus.CREATED);
      expect(paymentDoc!.provider).toBe(PaymentProvider.RAZORPAY);
      expect(paymentDoc!.targetType).toBe(PaymentTargetType.APPOINTMENT);
      expect(paymentDoc!.targetId.toString()).toBe(appt._id.toString());
      expect(paymentDoc!.userId.toString()).toBe(patientUser._id.toString());
      expect(paymentDoc!.amount).toBe(1500);
      expect(paymentDoc!.currency).toBe("INR");
      expect(paymentDoc!.providerOrderId).toBe("order_mock1234567890");
      expect(paymentDoc!.referenceId).toBeDefined();

      // Verify appointment was linked with paymentId
      const updatedAppt = await Appointment.findById(appt._id);
      expect(updatedAppt!.paymentId?.toString()).toBe(paymentDoc!._id.toString());
      expect(updatedAppt!.paymentStatus).toBe("PENDING");
      // Appointment status remains PENDING_PAYMENT (not marked paid or confirmed)
      expect(updatedAppt!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it("accepts appointmentId as the identifier alias", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id, {
        fee: 800,
      });

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ appointmentId: appt._id.toString() });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.amount).toBe(80000);
    });
  });

  // =========================================================================
  // 3. Security Checks & Client Tampering Defense
  // =========================================================================
  describe("3. Security Checks & Client Tampering Defense", () => {
    it("ignores client-supplied amount and currency tampering, deriving strictly from DB", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id, {
        fee: 2000,
        currency: "INR",
      });

      // Malicious client attempts to pay 10 INR instead of 2000 INR
      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({
          targetId: appt._id.toString(),
          amount: 10,
          currency: "USD",
        });

      expect(res.status).toBe(200);
      // The server must enforce the trusted 2000 INR from the database
      expect(res.body.data.amount).toBe(200000);
      expect(res.body.data.currency).toBe("INR");

      const paymentDoc = await Payment.findById(res.body.data.paymentId);
      expect(paymentDoc!.amount).toBe(2000);
      expect(paymentDoc!.currency).toBe("INR");
    });

    it("rejects request if caller does not own the appointment (403 AUTH_RESOURCE_ACCESS_DENIED)", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientA } = await createPatientFixture({ fullName: "Patient A" });
      const { token: tokenB } = await createPatientFixture({ fullName: "Patient B" });

      const appt = await createAppointmentFixture(patientA._id, doctorUser._id);

      // Patient B attempts to create payment intent for Patient A's appointment
      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("rejects unauthenticated requests (401 AUTH_TOKEN_MISSING)", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id);

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("rejects non-patient caller (e.g. Doctor role)", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id);

      const doctorToken = tokenService.generateAccessToken(doctorUser.id, doctorUser.role);

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });
  });

  // =========================================================================
  // 4. State Preconditions & Validation
  // =========================================================================
  describe("4. State Preconditions & Validation", () => {
    it("returns 404 APPOINTMENT_NOT_FOUND when appointment does not exist", async () => {
      const { token } = await createPatientFixture();
      const nonExistentId = new mongoose.Types.ObjectId().toString();

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: nonExistentId });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("APPOINTMENT_NOT_FOUND");
    });

    it("returns 422 VALIDATION_ERROR for malformed ID format", async () => {
      const { token } = await createPatientFixture();

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: "not-a-valid-object-id" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects appointment already in CONFIRMED state (409 APPOINTMENT_INVALID_TRANSITION)", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id, {
        status: AppointmentStatus.CONFIRMED,
      });

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("rejects appointment in CANCELLED state (409 APPOINTMENT_INVALID_TRANSITION)", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id, {
        status: AppointmentStatus.CANCELLED,
      });

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("rejects appointment with expired reservation lock (422 APPOINTMENT_LOCK_EXPIRED)", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id, {
        lockExpiresAt: new Date(Date.now() - 10000), // Expired 10 seconds ago
      });

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("APPOINTMENT_LOCK_EXPIRED");
    });
  });

  // =========================================================================
  // 5. Gateway Failure & Error Handling
  // =========================================================================
  describe("5. Gateway Failure & Persistence Error Handling", () => {
    it("handles Razorpay API failure with 502 PAYMENT_GATEWAY_ERROR and persists no payment", async () => {
      mockOrdersCreate.mockRejectedValueOnce(new Error("Razorpay upstream network timeout"));

      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id);

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PAYMENT_GATEWAY_ERROR");

      // Verify no dangling payment document was created
      const payments = await Payment.find({ targetId: appt._id });
      expect(payments).toHaveLength(0);
    });

    it("handles database persistence failure with 500 PAYMENT_PERSISTENCE_FAILED without reporting false success", async () => {
      const paymentCreateSpy = vi
        .spyOn(Payment, "create")
        .mockRejectedValueOnce(new Error("Simulated MongoDB write connection error"));

      try {
        const { user: doctorUser } = await createDoctorFixture();
        const { user: patientUser, token } = await createPatientFixture();
        const appt = await createAppointmentFixture(patientUser._id, doctorUser._id);

        const res = await request(app)
          .post("/api/v1/payments/create-intent")
          .set("Authorization", `Bearer ${token}`)
          .send({ targetId: appt._id.toString() });

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe("PAYMENT_PERSISTENCE_FAILED");
      } finally {
        paymentCreateSpy.mockRestore();
      }
    });

    it("rejects appointment if database fee is non-positive or corrupted", async () => {
      const { user: doctorUser } = await createDoctorFixture();
      const { user: patientUser, token } = await createPatientFixture();
      const appt = await createAppointmentFixture(patientUser._id, doctorUser._id);

      // Bypass document-level schema validation using updateOne to simulate corrupt DB state
      await Appointment.updateOne({ _id: appt._id }, { $set: { fee: -100 } });

      const res = await request(app)
        .post("/api/v1/payments/create-intent")
        .set("Authorization", `Bearer ${token}`)
        .send({ targetId: appt._id.toString() });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_AMOUNT");
    });

    it("throws 500 PAYMENT_GATEWAY_CONFIG_ERROR if credentials are not configured", () => {
      setRazorpayClient(null, null);
      const originalKeyId = process.env.RAZORPAY_KEY_ID;
      const originalKeySecret = process.env.RAZORPAY_KEY_SECRET;
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;

      try {
        try {
          getRazorpayPublicKey();
          expect.unreachable("Should have thrown");
        } catch (err: any) {
          expect(err.statusCode).toBe(500);
          expect(err.code).toBe("PAYMENT_GATEWAY_CONFIG_ERROR");
        }

        try {
          getRazorpayClient();
          expect.unreachable("Should have thrown");
        } catch (err: any) {
          expect(err.statusCode).toBe(500);
          expect(err.code).toBe("PAYMENT_GATEWAY_CONFIG_ERROR");
        }
      } finally {
        process.env.RAZORPAY_KEY_ID = originalKeyId;
        process.env.RAZORPAY_KEY_SECRET = originalKeySecret;
      }
    });
  });
});
