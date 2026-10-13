import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
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
import {
  verifyRazorpayWebhookSignature,
} from "../src/integrations/payment/razorpay.client.js";

describe("Milestone 7 - Task 7.2: Cryptographic Webhook Listener & Atomic Settlement", () => {
  const TEST_WEBHOOK_SECRET = "test_webhook_secret_key_1234567890";

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_payment_webhook_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Payment.syncIndexes();
  }, 30000);

  afterAll(async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
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
  });

  function generateSignature(rawBody: string | Buffer, secret: string = TEST_WEBHOOK_SECRET): string {
    return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  async function createDoctorFixture() {
    const user = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHash123",
      fullName: "Dr. Webhook Test",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const profile = await DoctorProfile.create({
      userId: user._id,
      specialization: "Internal Medicine",
      qualifications: ["MD"],
      experienceYears: 12,
      registrationNumber: `REG-${user._id.toString().slice(-8).toUpperCase()}`,
      registrationCouncil: "Medical Council",
      consultationFee: 1500,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    return { user, profile };
  }

  async function createPatientFixture() {
    return User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "dummyHash123",
      fullName: "Patient Webhook Test",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
  }

  async function createPaymentAndAppointment(overrides: {
    fee?: number;
    currency?: string;
    appointmentStatus?: AppointmentStatus;
    lockExpiresAt?: Date;
    providerOrderId?: string;
    paymentStatus?: PaymentStatus;
  } = {}) {
    const { user: doctorUser } = await createDoctorFixture();
    const patientUser = await createPatientFixture();

    const scheduledStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60 * 1000);

    const appt = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart,
      scheduledEnd,
      status: overrides.appointmentStatus || AppointmentStatus.PENDING_PAYMENT,
      reason: "Webhook settlement test",
      fee: overrides.fee ?? 1500,
      currency: overrides.currency || "INR",
      lockExpiresAt: overrides.lockExpiresAt || new Date(Date.now() + 15 * 60 * 1000),
    });

    const orderId = overrides.providerOrderId || `order_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const payment = await Payment.create({
      userId: patientUser._id,
      targetType: PaymentTargetType.APPOINTMENT,
      targetId: appt._id,
      amount: appt.fee,
      currency: appt.currency,
      status: overrides.paymentStatus || PaymentStatus.CREATED,
      provider: PaymentProvider.RAZORPAY,
      referenceId: `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      providerOrderId: orderId,
    });

    appt.paymentId = payment._id;
    await appt.save();

    return { doctorUser, patientUser, appt, payment, orderId };
  }

  function buildWebhookPayload(params: {
    event?: string;
    orderId: string;
    paymentId?: string;
    amount?: number;
    currency?: string;
  }) {
    return {
      entity: "event",
      account_id: "acc_lifeline_test",
      event: params.event || "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: params.paymentId || `pay_test_${Date.now()}`,
            entity: "payment",
            amount: params.amount ?? 150000,
            currency: params.currency || "INR",
            status: "captured",
            order_id: params.orderId,
            method: "card",
            captured: true,
            created_at: Math.floor(Date.now() / 1000),
          },
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    };
  }

  // =========================================================================
  // 1. Cryptographic HMAC Signature Verification Helper Unit Tests
  // =========================================================================
  describe("1. HMAC Signature Verification Helper", () => {
    it("accepts valid HMAC SHA-256 signature calculated from raw buffer", () => {
      const buffer = Buffer.from(JSON.stringify({ hello: "world" }), "utf8");
      const sig = generateSignature(buffer, TEST_WEBHOOK_SECRET);

      const isValid = verifyRazorpayWebhookSignature(buffer, sig, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(true);
    });

    it("rejects signature if raw payload is altered by even one byte", () => {
      const originalBuffer = Buffer.from(JSON.stringify({ amount: 150000 }), "utf8");
      const sig = generateSignature(originalBuffer, TEST_WEBHOOK_SECRET);

      const tamperedBuffer = Buffer.from(JSON.stringify({ amount: 150001 }), "utf8");
      const isValid = verifyRazorpayWebhookSignature(tamperedBuffer, sig, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(false);
    });

    it("rejects missing, null, or empty signatures", () => {
      const buffer = Buffer.from("{}", "utf8");
      expect(verifyRazorpayWebhookSignature(buffer, undefined, TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyRazorpayWebhookSignature(buffer, null, TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyRazorpayWebhookSignature(buffer, "", TEST_WEBHOOK_SECRET)).toBe(false);
    });

    it("rejects malformed signature (non-hex or invalid digest length)", () => {
      const buffer = Buffer.from("{}", "utf8");
      expect(verifyRazorpayWebhookSignature(buffer, "invalid_sig", TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyRazorpayWebhookSignature(buffer, "a".repeat(63), TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyRazorpayWebhookSignature(buffer, "a".repeat(65), TEST_WEBHOOK_SECRET)).toBe(false);
    });

    it("rejects validly formatted signature signed with incorrect secret", () => {
      const buffer = Buffer.from(JSON.stringify({ test: true }), "utf8");
      const wrongSecretSig = generateSignature(buffer, "wrong_secret_key");

      const isValid = verifyRazorpayWebhookSignature(buffer, wrongSecretSig, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(false);
    });
  });

  // =========================================================================
  // 2. HTTP Webhook Signature Enforcement
  // =========================================================================
  describe("2. HTTP Webhook Signature Enforcement", () => {
    it("rejects request without X-Razorpay-Signature header (401 INVALID_WEBHOOK_SIGNATURE)", async () => {
      const payload = JSON.stringify({ event: "payment.captured" });

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_WEBHOOK_SIGNATURE");
    });

    it("rejects request with invalid signature header (401 INVALID_WEBHOOK_SIGNATURE)", async () => {
      const payload = JSON.stringify({ event: "payment.captured" });
      const fakeSig = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", fakeSig)
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("INVALID_WEBHOOK_SIGNATURE");
    });

    it("invalid signature causes zero database modifications", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500 });
      const payloadObj = buildWebhookPayload({ orderId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const invalidSig = "ba0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

      await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", invalidSig)
        .send(rawPayload);

      // Verify payment and appointment were NOT modified
      const paymentCheck = await Payment.findById(payment._id);
      expect(paymentCheck!.status).toBe(PaymentStatus.CREATED);

      const apptCheck = await Appointment.findById(appt._id);
      expect(apptCheck!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });
  });

  // =========================================================================
  // 3. Atomic Settlement & Appointment Confirmation
  // =========================================================================
  describe("3. Atomic Settlement & Appointment Confirmation", () => {
    it("valid payment.captured settles Payment to SUCCESS and Appointment to CONFIRMED atomically", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({
        fee: 1500,
        currency: "INR",
      });

      const paymentId = "pay_livecapture12345";
      const payloadObj = buildWebhookPayload({ orderId, paymentId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("SETTLED");
      expect(res.body.data.paymentId).toBe(payment._id.toString());
      expect(res.body.data.appointmentId).toBe(appt._id.toString());
      expect(res.body.data.orderId).toBe(orderId);

      // Verify Payment record
      const settledPayment = await Payment.findById(payment._id);
      expect(settledPayment!.status).toBe(PaymentStatus.SUCCESS);
      expect(settledPayment!.providerPaymentId).toBe(paymentId);
      expect(settledPayment!.providerSignature).toBe(sig);

      // Verify Appointment record
      const confirmedAppt = await Appointment.findById(appt._id);
      expect(confirmedAppt!.status).toBe(AppointmentStatus.CONFIRMED);
      expect(confirmedAppt!.paymentStatus).toBe("PAID");
      expect(confirmedAppt!.paymentId?.toString()).toBe(payment._id.toString());
      expect(confirmedAppt!.lockExpiresAt).toBeUndefined(); // Lock removed upon confirmation
    });

    it("duplicate webhook delivery is acknowledged safely without repeating settlement", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500 });
      const payloadObj = buildWebhookPayload({ orderId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      // Delivery 1
      const res1 = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);
      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe("SETTLED");

      // Delivery 2 (Duplicate replay)
      const res2 = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);
      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("ALREADY_SETTLED");
      expect(res2.body.data.acknowledged).toBe(true);

      // Appointment and payment remain valid
      const paymentCheck = await Payment.findById(payment._id);
      expect(paymentCheck!.status).toBe(PaymentStatus.SUCCESS);

      const apptCheck = await Appointment.findById(appt._id);
      expect(apptCheck!.status).toBe(AppointmentStatus.CONFIRMED);
    });
  });

  // =========================================================================
  // 4. Financial Integrity & Verification Boundary Checks
  // =========================================================================
  describe("4. Financial Integrity & Verification Boundary Checks", () => {
    it("rejects captured amount mismatch without settlement (400 PAYMENT_AMOUNT_MISMATCH)", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500 });
      // Tampered amount: 50000 (500 INR) instead of expected 150000 (1500 INR)
      const payloadObj = buildWebhookPayload({ orderId, amount: 50000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PAYMENT_AMOUNT_MISMATCH");

      // Verify no changes were made
      const paymentCheck = await Payment.findById(payment._id);
      expect(paymentCheck!.status).toBe(PaymentStatus.CREATED);

      const apptCheck = await Appointment.findById(appt._id);
      expect(apptCheck!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });

    it("rejects captured currency mismatch without settlement (400 PAYMENT_AMOUNT_MISMATCH)", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500, currency: "INR" });
      const payloadObj = buildWebhookPayload({ orderId, amount: 150000, currency: "USD" });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PAYMENT_AMOUNT_MISMATCH");
    });

    it("returns 404 PAYMENT_NOT_FOUND when order ID is not recognized", async () => {
      const payloadObj = buildWebhookPayload({ orderId: "order_unrecognized_99999" });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PAYMENT_NOT_FOUND");
    });

    it("rejects settlement if appointment is already CANCELLED (409 APPOINTMENT_INVALID_TRANSITION)", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({
        appointmentStatus: AppointmentStatus.CANCELLED,
      });

      const payloadObj = buildWebhookPayload({ orderId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");

      // Verify payment was rolled back and not marked SUCCESS
      const paymentCheck = await Payment.findById(payment._id);
      expect(paymentCheck!.status).toBe(PaymentStatus.CREATED);

      const apptCheck = await Appointment.findById(appt._id);
      expect(apptCheck!.status).toBe(AppointmentStatus.CANCELLED);
    });

    it("rejects settlement if appointment reservation lock has expired (409 APPOINTMENT_INVALID_TRANSITION)", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({
        lockExpiresAt: new Date(Date.now() - 30000), // Expired 30 seconds ago
      });

      const payloadObj = buildWebhookPayload({ orderId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");

      const paymentCheck = await Payment.findById(payment._id);
      expect(paymentCheck!.status).toBe(PaymentStatus.CREATED);
    });

    it("acknowledges unrelated validly signed events without executing settlement", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500 });
      // Event: payment.authorized instead of payment.captured
      const payloadObj = buildWebhookPayload({ event: "payment.authorized", orderId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("IGNORED");
      expect(res.body.data.acknowledged).toBe(true);

      // Verify no state transitions occurred
      const paymentCheck = await Payment.findById(payment._id);
      expect(paymentCheck!.status).toBe(PaymentStatus.CREATED);

      const apptCheck = await Appointment.findById(appt._id);
      expect(apptCheck!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
    });
  });

  // =========================================================================
  // 5. Concurrency & Database Error Isolation
  // =========================================================================
  describe("5. Concurrency & Database Error Isolation", () => {
    it("handles database update failure without reporting false success", async () => {
      const updateOneSpy = vi
        .spyOn(Appointment, "findOneAndUpdate")
        .mockRejectedValueOnce(new Error("Simulated MongoDB connection interruption"));

      try {
        const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500 });
        const payloadObj = buildWebhookPayload({ orderId, amount: 150000 });
        const rawPayload = JSON.stringify(payloadObj);
        const sig = generateSignature(rawPayload);

        const res = await request(app)
          .post("/api/v1/payments/webhook")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", sig)
          .send(rawPayload);

        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);

        // Verify appointment was NOT confirmed
        const apptCheck = await Appointment.findById(appt._id);
        expect(apptCheck!.status).toBe(AppointmentStatus.PENDING_PAYMENT);
      } finally {
        updateOneSpy.mockRestore();
      }
    });

    it("concurrent deliveries do not double settle or corrupt state", async () => {
      const { appt, payment, orderId } = await createPaymentAndAppointment({ fee: 1500 });
      const payloadObj = buildWebhookPayload({ orderId, amount: 150000 });
      const rawPayload = JSON.stringify(payloadObj);
      const sig = generateSignature(rawPayload);

      // Fire 2 concurrent webhook deliveries simultaneously
      const [res1, res2] = await Promise.all([
        request(app)
          .post("/api/v1/payments/webhook")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", sig)
          .send(rawPayload),
        request(app)
          .post("/api/v1/payments/webhook")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", sig)
          .send(rawPayload),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // One must settle and the other acknowledge duplicate/concurrently settled
      const statuses = [res1.body.data.status, res2.body.data.status];
      expect(statuses).toContain("SETTLED");
      expect(statuses).toContain("ALREADY_SETTLED");

      // Verify single confirmed state
      const finalPayment = await Payment.findById(payment._id);
      expect(finalPayment!.status).toBe(PaymentStatus.SUCCESS);

      const finalAppt = await Appointment.findById(appt._id);
      expect(finalAppt!.status).toBe(AppointmentStatus.CONFIRMED);
    });
  });
});
