import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import crypto from "node:crypto";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  Appointment,
  Payment,
  Notification,
  AuditLog,
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
  NotificationType,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  setRazorpayClient,
} from "../src/integrations/payment/razorpay.client.js";
import { paymentService } from "../src/services/payment.service.js";

describe("Milestone 7 - Task 7.3: Automated Refund Service", () => {
  const TEST_WEBHOOK_SECRET = "test_webhook_secret_key_m7_73";
  let patientUser: any;
  let patientToken: string;
  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;
  let otherDoctorUser: any;
  let otherDoctorProfile: any;
  let otherDoctorToken: string;
  let adminUser: any;
  let adminToken: string;

  let mockPaymentsRefund: any;
  let mockPaymentsFetchRefund: any;
  let mockRefundsFetch: any;

  beforeAll(async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_refund_service_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Payment.syncIndexes();
    await Notification.syncIndexes();
    await AuditLog.syncIndexes();
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
      await Notification.deleteMany({});
      await AuditLog.deleteMany({});
      await Payment.deleteMany({});
      await Appointment.deleteMany({});
      await DoctorProfile.deleteMany({});
      await User.deleteMany({});
    }

    mockPaymentsRefund = vi.fn().mockImplementation(
      async (paymentId: string, params: any) => ({
        id: "rfnd_mock_processed_123",
        entity: "refund",
        amount: params?.amount || 50000,
        currency: "INR",
        payment_id: paymentId,
        status: "processed",
        speed_processed: "instant",
        created_at: Math.floor(Date.now() / 1000),
      })
    );

    mockPaymentsFetchRefund = vi.fn().mockImplementation(
      async (_paymentId: string, refundId: string) => ({
        id: refundId,
        entity: "refund",
        amount: 50000,
        currency: "INR",
        status: "processed",
      })
    );

    mockRefundsFetch = vi.fn().mockImplementation(
      async (refundId: string) => ({
        id: refundId,
        entity: "refund",
        amount: 50000,
        currency: "INR",
        status: "processed",
      })
    );

    setRazorpayClient(
      {
        payments: {
          refund: mockPaymentsRefund,
          fetchRefund: mockPaymentsFetchRefund,
        },
        refunds: {
          fetch: mockRefundsFetch,
        },
      } as any,
      "rzp_test_public_key"
    );

    patientUser = await User.create({
      email: "patient.refund@test.com",
      phone: "+919876543201",
      passwordHash: "hash123",
      role: UserRole.PATIENT,
      fullName: "Patient Refund Test",
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patientToken = tokenService.generateAccessToken(
      patientUser._id.toString(),
      UserRole.PATIENT
    );

    doctorUser = await User.create({
      email: "doctor.refund@test.com",
      phone: "+919876543202",
      passwordHash: "hash123",
      role: UserRole.DOCTOR,
      fullName: "Dr. Assigned Doctor",
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "General Medicine",
      qualifications: ["MBBS"],
      experienceYears: 8,
      registrationNumber: "REG-DOC-REF-001",
      registrationCouncil: "Medical Council",
      consultationFee: 500,
      consultationTypes: [ConsultationType.VIDEO],
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      verificationDocuments: [],
      languages: ["English"],
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    otherDoctorUser = await User.create({
      email: "doctor.other@test.com",
      phone: "+919876543203",
      passwordHash: "hash123",
      role: UserRole.DOCTOR,
      fullName: "Dr. Other Doctor",
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherDoctorProfile = await DoctorProfile.create({
      userId: otherDoctorUser._id,
      specialization: "Dermatology",
      qualifications: ["MD"],
      experienceYears: 5,
      registrationNumber: "REG-DOC-REF-002",
      registrationCouncil: "Medical Council",
      consultationFee: 700,
      consultationTypes: [ConsultationType.VIDEO],
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      verificationDocuments: [],
      languages: ["English"],
    });
    otherDoctorToken = tokenService.generateAccessToken(
      otherDoctorUser._id.toString(),
      UserRole.DOCTOR
    );

    adminUser = await User.create({
      email: "admin.refund@test.com",
      phone: "+919876543299",
      passwordHash: "hash123",
      role: UserRole.ADMIN,
      fullName: "Super Admin",
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    adminToken = tokenService.generateAccessToken(
      adminUser._id.toString(),
      UserRole.ADMIN
    );
  });

  const createConfirmedPaidAppointment = async (hoursInFuture: number = 24) => {
    const scheduledStart = new Date(Date.now() + hoursInFuture * 60 * 60 * 1000);
    const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60 * 1000);

    const appointment = await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart,
      scheduledEnd,
      status: AppointmentStatus.CONFIRMED,
      paymentStatus: "PAID",
      reason: "General Consultation Review",
      fee: 500,
      currency: "INR",
    });

    const payment = await Payment.create({
      userId: patientUser._id,
      targetType: PaymentTargetType.APPOINTMENT,
      targetId: appointment._id,
      amount: 500,
      currency: "INR",
      status: PaymentStatus.SUCCESS,
      provider: PaymentProvider.RAZORPAY,
      referenceId: `REF-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      providerOrderId: "order_mock_12345",
      providerPaymentId: "pay_mock_captured_999",
    });

    appointment.paymentId = payment._id;
    await appointment.save();

    return { appointment, payment };
  };

  describe("1. Core Refund Service Execution & Gateway Contract", () => {
    it("successfully issues refund, transitions Payment to REFUNDED, and records provider metadata", async () => {
      const { payment, appointment } = await createConfirmedPaidAppointment();

      const result = await paymentService.processRefund(
        payment._id.toString(),
        500,
        "Customer requested cancellation",
        { id: patientUser._id.toString(), role: UserRole.PATIENT, email: patientUser.email }
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe("PROCESSED");
      expect(result.refundId).toBe("rfnd_mock_processed_123");
      expect(result.amount).toBe(500);

      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);
      expect(updatedPayment?.refundId).toBe("rfnd_mock_processed_123");
      expect(updatedPayment?.refundAmount).toBe(500);
      expect(updatedPayment?.refundStatus).toBe("processed");
      expect(updatedPayment?.refundedAt).toBeInstanceOf(Date);

      const updatedAppt = await Appointment.findById(appointment._id);
      expect(updatedAppt?.paymentStatus).toBe("REFUNDED");
    });

    it("passes exact provider payment ID, converted subunit amount, and reason to Razorpay SDK", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      await paymentService.processRefund(
        payment._id.toString(),
        250,
        "Partial consultation refund"
      );

      expect(mockPaymentsRefund).toHaveBeenCalledTimes(1);
      const [calledPaymentId, calledPayload] = mockPaymentsRefund.mock.calls[0];

      expect(calledPaymentId).toBe("pay_mock_captured_999");
      expect(calledPayload.amount).toBe(25000); // 250 INR * 100 paise
      expect(calledPayload.notes.reason).toBe("Partial consultation refund");
      expect(calledPayload.notes.paymentId).toBe(payment._id.toString());
    });

    it("transitions Payment to REFUND_PENDING when provider reports pending settlement status", async () => {
      mockPaymentsRefund.mockResolvedValueOnce({
        id: "rfnd_mock_pending_456",
        entity: "refund",
        amount: 50000,
        currency: "INR",
        payment_id: "pay_mock_captured_999",
        status: "pending",
        created_at: Math.floor(Date.now() / 1000),
      });

      const { payment, appointment } = await createConfirmedPaidAppointment();

      const result = await paymentService.processRefund(payment._id.toString(), 500);

      expect(result.success).toBe(true);
      expect(result.status).toBe("PENDING");
      expect(result.refundId).toBe("rfnd_mock_pending_456");

      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUND_PENDING);
      expect(updatedPayment?.refundStatus).toBe("pending");
      expect(updatedPayment?.refundedAt).toBeUndefined();

      const updatedAppt = await Appointment.findById(appointment._id);
      expect(updatedAppt?.paymentStatus).toBe("PENDING");
    });
  });

  describe("2. Validation, Boundary & Ineligibility Guards", () => {
    it("rejects invalid payment ID format with 400 BAD_REQUEST", async () => {
      await expect(
        paymentService.processRefund("not-a-valid-id", 500)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "BAD_REQUEST",
      });
    });

    it("rejects non-existent payment ID with 404 PAYMENT_NOT_FOUND", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      await expect(
        paymentService.processRefund(nonExistentId, 500)
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "PAYMENT_NOT_FOUND",
      });
    });

    it("rejects zero, negative, or non-finite refund amounts with 400 INVALID_AMOUNT", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      await expect(
        paymentService.processRefund(payment._id.toString(), 0)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_AMOUNT",
      });

      await expect(
        paymentService.processRefund(payment._id.toString(), -50)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_AMOUNT",
      });
    });

    it("rejects refund amount exceeding payment amount with 400 PAYMENT_REFUND_EXCEEDS_AMOUNT", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      await expect(
        paymentService.processRefund(payment._id.toString(), 600)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "PAYMENT_REFUND_EXCEEDS_AMOUNT",
      });
    });

    it("rejects uncaptured or non-SUCCESS payments with 409 PAYMENT_INVALID_TRANSITION", async () => {
      const pendingPayment = await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.CREATED,
        provider: PaymentProvider.RAZORPAY,
        referenceId: `REF-${Date.now()}-pending`,
      });

      await expect(
        paymentService.processRefund(pendingPayment._id.toString(), 500)
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "PAYMENT_INVALID_TRANSITION",
      });
    });

    it("rejects payment without providerPaymentId with 400 PAYMENT_NO_PROVIDER_PAYMENT_ID", async () => {
      const paymentWithoutProviderId = await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: `REF-${Date.now()}-noprov`,
      });

      await expect(
        paymentService.processRefund(paymentWithoutProviderId._id.toString(), 500)
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "PAYMENT_NO_PROVIDER_PAYMENT_ID",
      });
    });
  });

  describe("3. Idempotency, Concurrency & Gateway Failure Recovery", () => {
    it("handles duplicate refund invocation safely without invoking Razorpay API twice", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      const firstCall = await paymentService.processRefund(payment._id.toString(), 500);
      expect(firstCall.status).toBe("PROCESSED");
      expect(mockPaymentsRefund).toHaveBeenCalledTimes(1);

      const secondCall = await paymentService.processRefund(payment._id.toString(), 500);
      expect(secondCall.status).toBe("ALREADY_REFUNDED");
      expect(mockPaymentsRefund).toHaveBeenCalledTimes(1);
    });

    it("reconciles pending refund when retried without creating duplicate gateway refund", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      payment.status = PaymentStatus.REFUND_PENDING;
      payment.refundId = "rfnd_already_pending_888";
      payment.refundAmount = 500;
      await payment.save();

      mockRefundsFetch.mockResolvedValueOnce({
        id: "rfnd_already_pending_888",
        status: "processed",
      });

      const result = await paymentService.processRefund(payment._id.toString(), 500);

      expect(result.status).toBe("PROCESSED");
      expect(mockPaymentsRefund).not.toHaveBeenCalled();
      const updated = await Payment.findById(payment._id);
      expect(updated?.status).toBe(PaymentStatus.REFUNDED);
    });

    it("records recoverable failure details when Razorpay API throws and re-enables retry", async () => {
      mockPaymentsRefund.mockRejectedValueOnce(
        new Error("Razorpay gateway timeout during refund call")
      );

      const { payment } = await createConfirmedPaidAppointment();

      await expect(
        paymentService.processRefund(payment._id.toString(), 500)
      ).rejects.toMatchObject({
        statusCode: 500,
        code: "PAYMENT_REFUND_FAILED",
      });

      const updated = await Payment.findById(payment._id);
      expect(updated?.status).toBe(PaymentStatus.SUCCESS);
      expect(updated?.failureCode).toBe("PAYMENT_REFUND_FAILED");
      expect(updated?.failureReason).toContain("Razorpay gateway timeout");
      expect(updated?.refundStatus).toBe("failed");

      // Verify retry succeeds when provider becomes available
      mockPaymentsRefund.mockResolvedValueOnce({
        id: "rfnd_retry_success_777",
        status: "processed",
        amount: 50000,
      });

      const retryResult = await paymentService.processRefund(payment._id.toString(), 500);
      expect(retryResult.status).toBe("PROCESSED");
      const retried = await Payment.findById(payment._id);
      expect(retried?.status).toBe(PaymentStatus.REFUNDED);
      expect(retried?.failureCode).toBeUndefined();
    });

    it("prevents concurrent requests from double refunding", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      const results = await Promise.all([
        paymentService.processRefund(payment._id.toString(), 500),
        paymentService.processRefund(payment._id.toString(), 500),
      ]);

      const successResults = results.filter(
        (r) => r.status === "PROCESSED" || r.status === "ALREADY_REFUNDED" || r.status === "PENDING"
      );
      expect(successResults.length).toBe(2);
      expect(mockPaymentsRefund).toHaveBeenCalledTimes(1);
    });
  });

  describe("4. Notifications & Audit Trail", () => {
    it("creates in-app notification for patient and records audit log on successful refund", async () => {
      const { payment, appointment } = await createConfirmedPaidAppointment();

      await paymentService.processRefund(payment._id.toString(), 500, "Approved cancellation");

      const notifications = await Notification.find({
        userId: patientUser._id,
        type: NotificationType.REFUND_PROCESSED,
      });
      expect(notifications.length).toBe(1);
      expect(notifications[0].title).toBe("Refund Processed");
      expect(notifications[0].message).toContain("500");

      const auditLogs = await AuditLog.find({
        resourceId: payment._id.toString(),
        action: AuditAction.PAYMENT_REFUND_ISSUED,
      });
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].status).toBe("SUCCESS");
      expect(auditLogs[0].metadata?.providerRefundId).toBe("rfnd_mock_processed_123");
    });
  });

  describe("5. Appointment Cancellation & Doctor Rejection Integration", () => {
    it("patient cancelling confirmed paid appointment (>2h prior) triggers automated full refund", async () => {
      const { appointment, payment } = await createConfirmedPaidAppointment(24);

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ cancellationReason: "Patient travelling, please refund" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(AppointmentStatus.CANCELLED);
      expect(res.body.data.paymentStatus).toBe("REFUNDED");

      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);
      expect(updatedPayment?.refundAmount).toBe(500);
      expect(mockPaymentsRefund).toHaveBeenCalledTimes(1);
    });

    it("doctor cancelling their assigned confirmed paid appointment triggers automated refund", async () => {
      const { appointment, payment } = await createConfirmedPaidAppointment(1); // 1h before, doctor can cancel

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ cancellationReason: "Doctor emergency surgery" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(AppointmentStatus.CANCELLED);
      expect(res.body.data.paymentStatus).toBe("REFUNDED");

      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);
    });

    it("doctor rejecting appointment (PATCH /:id/reject) transitions to REJECTED and triggers refund", async () => {
      const { appointment, payment } = await createConfirmedPaidAppointment(12);

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reject`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ rejectionReason: "Doctor unavailable during specified slot" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(AppointmentStatus.REJECTED);
      expect(res.body.data.paymentStatus).toBe("REFUNDED");

      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);
      expect(mockPaymentsRefund).toHaveBeenCalledTimes(1);

      // Verify slot is freed: doctor can book another appointment at same start time
      const newAppt = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: appointment.scheduledStart,
        scheduledEnd: appointment.scheduledEnd,
        status: AppointmentStatus.CONFIRMED,
        paymentStatus: "PAID",
        reason: "New appointment taking freed slot",
        fee: 500,
      });
      expect(newAppt._id).toBeDefined();
    });

    it("cancelling an unpaid PENDING_PAYMENT appointment does NOT trigger refund", async () => {
      const scheduledStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const unpaidAppt = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart,
        scheduledEnd: new Date(scheduledStart.getTime() + 30 * 60 * 1000),
        status: AppointmentStatus.PENDING_PAYMENT,
        paymentStatus: "UNPAID",
        reason: "Consultation pending payment",
        fee: 500,
      });

      const res = await request(app)
        .patch(`/api/v1/appointments/${unpaidAppt._id}/cancel`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ cancellationReason: "Cancelled before payment" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(AppointmentStatus.CANCELLED);
      expect(mockPaymentsRefund).not.toHaveBeenCalled();
    });

    it("unassigned doctor cannot reject appointment: rejects with 403 AUTH_RESOURCE_ACCESS_DENIED", async () => {
      const { appointment } = await createConfirmedPaidAppointment();

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reject`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({ rejectionReason: "Unauthorized rejection attempt" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
      expect(mockPaymentsRefund).not.toHaveBeenCalled();
    });

    it("patient cannot reject appointment: rejects with 403 AUTH_INSUFFICIENT_PERMISSIONS", async () => {
      const { appointment } = await createConfirmedPaidAppointment();

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/reject`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ rejectionReason: "Patient cannot invoke reject" });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
      expect(mockPaymentsRefund).not.toHaveBeenCalled();
    });

    it("when refund fails during appointment cancellation, cancellation succeeds and failure is recorded", async () => {
      mockPaymentsRefund.mockRejectedValueOnce(
        new Error("Razorpay bank network failure")
      );

      const { appointment, payment } = await createConfirmedPaidAppointment(24);

      const res = await request(app)
        .patch(`/api/v1/appointments/${appointment._id}/cancel`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ cancellationReason: "Cancel despite gateway outage" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(AppointmentStatus.CANCELLED);
      expect(res.body.data.paymentStatus).toBe("PAID"); // Payment not yet refunded

      const failedPayment = await Payment.findById(payment._id);
      expect(failedPayment?.status).toBe(PaymentStatus.SUCCESS);
      expect(failedPayment?.failureCode).toBe("PAYMENT_REFUND_FAILED");
      expect(failedPayment?.refundStatus).toBe("failed");
    });
  });

  describe("6. Administrative Direct Refund Endpoint", () => {
    it("admin can directly trigger refund via POST /api/v1/payments/:id/refund", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      const res = await request(app)
        .post(`/api/v1/payments/${payment._id}/refund`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ amount: 500, reason: "Manual admin approved refund" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("PROCESSED");
      expect(res.body.data.refundId).toBe("rfnd_mock_processed_123");
    });

    it("non-admin roles cannot call POST /api/v1/payments/:id/refund: 403 AUTH_INSUFFICIENT_PERMISSIONS", async () => {
      const { payment } = await createConfirmedPaidAppointment();

      const res = await request(app)
        .post(`/api/v1/payments/${payment._id}/refund`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ amount: 500 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });
  });

  describe("7. Webhook Callback for Asynchronous Refund Settlement", () => {
    it("settles refund when signed refund.processed webhook is received", async () => {
      const { payment, appointment } = await createConfirmedPaidAppointment();

      payment.status = PaymentStatus.REFUND_PENDING;
      payment.refundId = "rfnd_async_webhook_444";
      await payment.save();

      const payload = {
        entity: "event",
        event: "refund.processed",
        payload: {
          refund: {
            entity: {
              id: "rfnd_async_webhook_444",
              payment_id: payment.providerPaymentId,
              amount: 50000,
              currency: "INR",
              status: "processed",
            },
          },
        },
      };

      const effectiveSecret =
        process.env.RAZORPAY_WEBHOOK_SECRET || "test_webhook_secret_key_1234567890";
      const rawPayload = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", effectiveSecret)
        .update(rawPayload)
        .digest("hex");

      const res = await request(app)
        .post("/api/v1/payments/webhook")
        .set("X-Razorpay-Signature", signature)
        .set("Content-Type", "application/json")
        .send(rawPayload);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("SETTLED");

      const updatedPayment = await Payment.findById(payment._id);
      expect(updatedPayment?.status).toBe(PaymentStatus.REFUNDED);
      expect(updatedPayment?.refundStatus).toBe("processed");

      const updatedAppt = await Appointment.findById(appointment._id);
      expect(updatedAppt?.paymentStatus).toBe("REFUNDED");
    });
  });
});
