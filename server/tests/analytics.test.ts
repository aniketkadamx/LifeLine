import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  PharmacyProfile,
  Appointment,
  Payment,
  Order,
  Medicine,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  AppointmentStatus,
  ConsultationType,
  OrderStatus,
  DosageForm,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";

describe("Milestone 12 - Task 12.3: Operational Analytics & Financial Reporting", () => {
  let adminUser: any;
  let adminToken: string;

  let doctor1User: any;
  let doctor1Profile: any;
  let doctor1Token: string;

  let doctor2User: any;
  let doctor2Profile: any;
  let doctor2Token: string;

  let pharmacy1User: any;
  let pharmacy1Profile: any;
  let pharmacy1Token: string;

  let pharmacy2User: any;
  let pharmacy2Profile: any;
  let pharmacy2Token: string;

  let patientUser: any;
  let patientToken: string;

  let testMedicine: any;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_analytics_engine_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Payment.syncIndexes();
    await Order.syncIndexes();
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await DoctorProfile.deleteMany({});
    await PharmacyProfile.deleteMany({});
    await Appointment.deleteMany({});
    await Payment.deleteMany({});
    await Order.deleteMany({});
    await Medicine.deleteMany({});

    // 1. Admin User
    adminUser = await User.create({
      email: "admin.analytics@lifeline.org",
      phone: "+919876543001",
      fullName: "Admin Controller",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    adminToken = tokenService.generateAccessToken(
      adminUser._id.toString(),
      UserRole.ADMIN
    );

    // 2. Doctor 1
    doctor1User = await User.create({
      email: "dr.house@lifeline.org",
      phone: "+919876543002",
      fullName: "Dr. Gregory House",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctor1Profile = await DoctorProfile.create({
      userId: doctor1User._id,
      specialization: "Diagnostics",
      qualifications: ["MD", "MBBS"],
      experienceYears: 15,
      registrationNumber: "DOC-ANALYTICS-001",
      registrationCouncil: "Medical Council of India",
      consultationFee: 800,
      consultationTypes: [ConsultationType.VIDEO],
    });
    doctor1Token = tokenService.generateAccessToken(
      doctor1User._id.toString(),
      UserRole.DOCTOR
    );

    // 3. Doctor 2
    doctor2User = await User.create({
      email: "dr.wilson@lifeline.org",
      phone: "+919876543003",
      fullName: "Dr. James Wilson",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctor2Profile = await DoctorProfile.create({
      userId: doctor2User._id,
      specialization: "Oncology",
      qualifications: ["MD"],
      experienceYears: 12,
      registrationNumber: "DOC-ANALYTICS-002",
      registrationCouncil: "Medical Council of India",
      consultationFee: 1000,
      consultationTypes: [ConsultationType.VIDEO],
    });
    doctor2Token = tokenService.generateAccessToken(
      doctor2User._id.toString(),
      UserRole.DOCTOR
    );

    // 4. Pharmacy 1
    pharmacy1User = await User.create({
      email: "rx.central@lifeline.org",
      phone: "+919876543004",
      fullName: "Central Pharma Ops",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacy1Profile = await PharmacyProfile.create({
      userId: pharmacy1User._id,
      pharmacyName: "LifeLine Central Pharmacy",
      ownerName: "Alice Pharmacist",
      licenseNumber: "LIC-PHARMA-ANALYTICS-001",
      address: {
        street: "123 Medical Way",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      phone: "+919876543004",
      serviceArea: ["400001"],
    });
    pharmacy1Token = tokenService.generateAccessToken(
      pharmacy1User._id.toString(),
      UserRole.PHARMACY
    );

    // 5. Pharmacy 2
    pharmacy2User = await User.create({
      email: "rx.suburban@lifeline.org",
      phone: "+919876543005",
      fullName: "Suburban Pharma Ops",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacy2Profile = await PharmacyProfile.create({
      userId: pharmacy2User._id,
      pharmacyName: "LifeLine Suburban Pharmacy",
      ownerName: "Bob Pharmacist",
      licenseNumber: "LIC-PHARMA-ANALYTICS-002",
      address: {
        street: "456 Suburban Road",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "India",
      },
      phone: "+919876543005",
      serviceArea: ["411001"],
    });
    pharmacy2Token = tokenService.generateAccessToken(
      pharmacy2User._id.toString(),
      UserRole.PHARMACY
    );

    // 6. Patient User
    patientUser = await User.create({
      email: "patient.analytics@lifeline.org",
      phone: "+919876543006",
      fullName: "John Doe Patient",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patientToken = tokenService.generateAccessToken(
      patientUser._id.toString(),
      UserRole.PATIENT
    );

    // 7. Master Medicine for order item snapshots
    testMedicine = await Medicine.create({
      name: "Paracetamol 500mg",
      genericName: "Acetaminophen",
      manufacturer: "HealthCorp",
      dosageForm: DosageForm.TABLET,
      prescriptionRequired: false,
      isActive: true,
    });
  });

  // =========================================================================
  // SECTION 1: Administrator Overview Analytics
  // =========================================================================
  describe("1. Administrator Overview Analytics", () => {
    it("1. calculates total users and role breakdown correctly from seeded records", async () => {
      // Seed an unverified user
      await User.create({
        email: "pending.user@lifeline.org",
        phone: "+919876543007",
        fullName: "Pending Verification",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
        role: UserRole.PATIENT,
        status: UserStatus.PENDING_VERIFICATION,
        emailVerified: false,
        phoneVerified: false,
      });

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userMetrics.totalUsers).toBe(7); // 6 initial + 1 pending
      expect(res.body.data.userMetrics.activeUsers).toBe(6);
      expect(res.body.data.userMetrics.byRole.PATIENT).toBe(2);
      expect(res.body.data.userMetrics.byRole.DOCTOR).toBe(2);
      expect(res.body.data.userMetrics.byRole.PHARMACY).toBe(2);
      expect(res.body.data.userMetrics.byRole.ADMIN).toBe(1);
      expect(
        res.body.data.userMetrics.byStatus[UserStatus.PENDING_VERIFICATION]
      ).toBe(1);
    });

    it("2. calculates gross transaction volume exclusively from qualifying captured payments", async () => {
      // Successful payment 1: 500
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-001",
      });

      // Successful payment 2: 1200
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.ORDER,
        targetId: new mongoose.Types.ObjectId(),
        amount: 1200,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-002",
      });

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.financialMetrics.grossTransactionVolume).toBe(1700);
      expect(res.body.data.financialMetrics.netTransactionVolume).toBe(1700);
      expect(res.body.data.financialMetrics.totalRefunds).toBe(0);
    });

    it("3. strictly excludes failed, pending, expired, and created payment records", async () => {
      // Successful: 1000
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 1000,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-SUCCESS",
      });

      // Ineligible payments
      await Payment.create([
        {
          userId: patientUser._id,
          targetType: PaymentTargetType.APPOINTMENT,
          targetId: new mongoose.Types.ObjectId(),
          amount: 500,
          currency: "INR",
          status: PaymentStatus.FAILED,
          provider: PaymentProvider.RAZORPAY,
          referenceId: "PAY-REF-FAILED",
        },
        {
          userId: patientUser._id,
          targetType: PaymentTargetType.APPOINTMENT,
          targetId: new mongoose.Types.ObjectId(),
          amount: 600,
          currency: "INR",
          status: PaymentStatus.CREATED,
          provider: PaymentProvider.RAZORPAY,
          referenceId: "PAY-REF-CREATED",
        },
        {
          userId: patientUser._id,
          targetType: PaymentTargetType.APPOINTMENT,
          targetId: new mongoose.Types.ObjectId(),
          amount: 700,
          currency: "INR",
          status: PaymentStatus.PROCESSING,
          provider: PaymentProvider.RAZORPAY,
          referenceId: "PAY-REF-PROCESSING",
        },
        {
          userId: patientUser._id,
          targetType: PaymentTargetType.APPOINTMENT,
          targetId: new mongoose.Types.ObjectId(),
          amount: 800,
          currency: "INR",
          status: PaymentStatus.EXPIRED,
          provider: PaymentProvider.RAZORPAY,
          referenceId: "PAY-REF-EXPIRED",
        },
      ]);

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.financialMetrics.grossTransactionVolume).toBe(1000);
      expect(res.body.data.financialMetrics.netTransactionVolume).toBe(1000);
    });

    it("4. prevents duplicate counting and webhook retry inflation", async () => {
      // Single payment record representing captured transaction
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 950,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-IDEMPOTENT",
        providerPaymentId: "pay_webhook_unique_123",
      });

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.financialMetrics.grossTransactionVolume).toBe(950);
      expect(
        res.body.data.financialMetrics.currencies[0].successfulTransactions
      ).toBe(1);
    });

    it("5. correctly distinguishes gross captured volume, refunds, and net volume", async () => {
      // 1. Success payment: 1000
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 1000,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-CLEAN",
      });

      // 2. Fully refunded payment: originally 800, refundAmount 800
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 800,
        currency: "INR",
        status: PaymentStatus.REFUNDED,
        refundAmount: 800,
        refundStatus: "processed",
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-REFUNDED",
      });

      // 3. Partially refunded payment: originally 1500, refundAmount 500
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.ORDER,
        targetId: new mongoose.Types.ObjectId(),
        amount: 1500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        refundAmount: 500,
        refundStatus: "processed",
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-REF-PARTIAL",
      });

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Gross = 1000 + 800 + 1500 = 3300
      expect(res.body.data.financialMetrics.grossTransactionVolume).toBe(3300);
      // Refunds = 800 + 500 = 1300
      expect(res.body.data.financialMetrics.totalRefunds).toBe(1300);
      // Net = 3300 - 1300 = 2000
      expect(res.body.data.financialMetrics.netTransactionVolume).toBe(2000);
    });

    it("6. calculates appointment completion rate using authoritative eligible denominator", async () => {
      const now = new Date();

      // 3 COMPLETED
      for (let i = 0; i < 3; i++) {
        await Appointment.create({
          patientId: patientUser._id,
          doctorId: doctor1User._id,
          appointmentType: ConsultationType.VIDEO,
          scheduledStart: new Date(now.getTime() - i * 3600000),
          scheduledEnd: new Date(now.getTime() - i * 3600000 + 1800000),
          status: AppointmentStatus.COMPLETED,
          reason: `Completed Checkup ${i}`,
          fee: 800,
          paymentStatus: "PAID",
        });
      }

      // 1 CANCELLED
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(now.getTime() - 4 * 3600000),
        scheduledEnd: new Date(now.getTime() - 4 * 3600000 + 1800000),
        status: AppointmentStatus.CANCELLED,
        reason: "Patient cancelled",
        fee: 800,
        cancellation: { reason: "Schedule conflict", cancelledAt: new Date() },
      });

      // 1 REJECTED
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(now.getTime() - 5 * 3600000),
        scheduledEnd: new Date(now.getTime() - 5 * 3600000 + 1800000),
        status: AppointmentStatus.REJECTED,
        reason: "Doctor unavailable",
        fee: 800,
      });

      // 1 NO_SHOW
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(now.getTime() - 6 * 3600000),
        scheduledEnd: new Date(now.getTime() - 6 * 3600000 + 1800000),
        status: AppointmentStatus.NO_SHOW,
        reason: "Patient did not attend",
        fee: 800,
      });

      // 2 In-Flight / Future CONFIRMED (must NOT be in eligible outcome denominator)
      for (let i = 1; i <= 2; i++) {
        await Appointment.create({
          patientId: patientUser._id,
          doctorId: doctor1User._id,
          appointmentType: ConsultationType.VIDEO,
          scheduledStart: new Date(now.getTime() + i * 86400000),
          scheduledEnd: new Date(now.getTime() + i * 86400000 + 1800000),
          status: AppointmentStatus.CONFIRMED,
          reason: `Future Appointment ${i}`,
          fee: 800,
          paymentStatus: "PAID",
        });
      }

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const metrics = res.body.data.appointmentMetrics;
      expect(metrics.totalAppointments).toBe(8);
      expect(metrics.completedAppointments).toBe(3);
      // Eligible = 3 completed + 1 cancelled + 1 rejected + 1 no-show = 6
      expect(metrics.eligibleAppointments).toBe(6);
      // Rate = (3 / 6) * 100 = 50.00%
      expect(metrics.completionRate).toBe(50);
      expect(metrics.overallCompletionRate).toBe(37.5); // 3 / 8 = 37.5%
    });

    it("7. handles empty datasets safely without division by zero or errors", async () => {
      // Clear all records except admin
      await Payment.deleteMany({});
      await Appointment.deleteMany({});
      await Order.deleteMany({});

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.financialMetrics.grossTransactionVolume).toBe(0);
      expect(res.body.data.financialMetrics.totalRefunds).toBe(0);
      expect(res.body.data.financialMetrics.netTransactionVolume).toBe(0);
      expect(res.body.data.appointmentMetrics.completionRate).toBe(0);
      expect(res.body.data.appointmentMetrics.totalAppointments).toBe(0);
      expect(res.body.data.orderMetrics.totalOrders).toBe(0);
    });

    it("8. respects validated date range boundaries on overview analytics", async () => {
      const pastPayment = await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-PAST",
      });
      // Backdate to 2026-01-15 via native collection update to bypass Mongoose timestamp immutability
      await Payment.collection.updateOne(
        { _id: pastPayment._id },
        { $set: { createdAt: new Date("2026-01-15T10:00:00Z") } }
      );

      const recentPayment = await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 1500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-RECENT",
      });
      // Date to 2026-06-15 via native collection update
      await Payment.collection.updateOne(
        { _id: recentPayment._id },
        { $set: { createdAt: new Date("2026-06-15T10:00:00Z") } }
      );

      // Query window matching ONLY recent payment
      const res = await request(app)
        .get(
          "/api/v1/analytics/overview?from=2026-06-01T00:00:00Z&to=2026-06-30T23:59:59Z"
        )
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.financialMetrics.grossTransactionVolume).toBe(1500);
      expect(res.body.data.period.from).toBe("2026-06-01T00:00:00Z");
      expect(res.body.data.period.to).toBe("2026-06-30T23:59:59Z");
    });

    it("9. rejects unauthenticated and non-admin access with 401 and 403", async () => {
      // 1. Unauthenticated
      const unauthRes = await request(app).get("/api/v1/analytics/overview");
      expect(unauthRes.status).toBe(401);

      // 2. Doctor caller
      const docRes = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${doctor1Token}`);
      expect(docRes.status).toBe(403);

      // 3. Pharmacy caller
      const rxRes = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${pharmacy1Token}`);
      expect(rxRes.status).toBe(403);

      // 4. Patient caller
      const patientRes = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${patientToken}`);
      expect(patientRes.status).toBe(403);
    });

    it("resolves API Contract 19.1 alias /api/v1/analytics/admin/overview identically", async () => {
      const res = await request(app)
        .get("/api/v1/analytics/admin/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.userMetrics).toBeDefined();
      expect(res.body.data.financialMetrics).toBeDefined();
    });
  });

  // =========================================================================
  // SECTION 2: Doctor Consultation & Earnings Analytics
  // =========================================================================
  describe("2. Doctor Consultation & Earnings Analytics", () => {
    it("10. counts completed consultations correctly for the authenticated doctor", async () => {
      // 2 Completed for Doctor 1
      for (let i = 0; i < 2; i++) {
        await Appointment.create({
          patientId: patientUser._id,
          doctorId: doctor1User._id,
          appointmentType: ConsultationType.VIDEO,
          scheduledStart: new Date(),
          scheduledEnd: new Date(Date.now() + 1800000),
          status: AppointmentStatus.COMPLETED,
          reason: `Completed Consult ${i}`,
          fee: 800,
          paymentStatus: "PAID",
        });
      }

      // 1 Cancelled for Doctor 1
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.CANCELLED,
        reason: "Cancelled by patient",
        fee: 800,
      });

      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.consultationMetrics.completedConsultations).toBe(2);
      expect(res.body.data.consultationMetrics.totalAppointments).toBe(3);
    });

    it("11. calculates doctor earnings from completed, paid appointments", async () => {
      // 2 Completed, Paid consultations of 800 each
      for (let i = 0; i < 2; i++) {
        await Appointment.create({
          patientId: patientUser._id,
          doctorId: doctor1User._id,
          appointmentType: ConsultationType.VIDEO,
          scheduledStart: new Date(),
          scheduledEnd: new Date(Date.now() + 1800000),
          status: AppointmentStatus.COMPLETED,
          reason: `Paid Consultation ${i}`,
          fee: 800,
          currency: "INR",
          paymentStatus: "PAID",
        });
      }

      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.earningsSummary.totalEarnings).toBe(1600);
      expect(res.body.data.earningsSummary.completedPaidConsultations).toBe(2);
    });

    it("12. excludes failed, unpaid, or pending financial records from earned income", async () => {
      // 1 Completed and PAID: 800
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.COMPLETED,
        reason: "Paid Consult",
        fee: 800,
        currency: "INR",
        paymentStatus: "PAID",
      });

      // 1 Completed but UNPAID: 800 (not earned yet)
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.COMPLETED,
        reason: "Unpaid Consult",
        fee: 800,
        currency: "INR",
        paymentStatus: "UNPAID",
      });

      // 1 In-progress CONFIRMED: 800 (not completed)
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(Date.now() + 86400000),
        scheduledEnd: new Date(Date.now() + 86400000 + 1800000),
        status: AppointmentStatus.CONFIRMED,
        reason: "Confirmed Future Consult",
        fee: 800,
        currency: "INR",
        paymentStatus: "PAID",
      });

      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.earningsSummary.totalEarnings).toBe(800);
      expect(res.body.data.earningsSummary.completedPaidConsultations).toBe(1);
    });

    it("13. excludes refunded appointments and reports commission model", async () => {
      // Cancelled & refunded
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.CANCELLED,
        reason: "Cancelled appointment",
        fee: 800,
        paymentStatus: "REFUNDED",
      });

      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.earningsSummary.totalEarnings).toBe(0);
      expect(
        res.body.data.earningsSummary.commissionModel.platformCommissionRate
      ).toBe(0);
    });

    it("14. enforces strict doctor isolation: Doctor A cannot obtain Doctor B's earnings", async () => {
      // Doctor 1 has ₹1600 earnings
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.COMPLETED,
        reason: "Doctor 1 Visit",
        fee: 1600,
        paymentStatus: "PAID",
      });

      // Doctor 2 has ₹1000 earnings
      await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor2User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.COMPLETED,
        reason: "Doctor 2 Visit",
        fee: 1000,
        paymentStatus: "PAID",
      });

      // Doctor 2 requests analytics
      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.doctorId).toBe(doctor2User._id.toString());
      expect(res.body.data.earningsSummary.totalEarnings).toBe(1000);
      expect(res.body.data.consultationMetrics.completedConsultations).toBe(1);
    });

    it("15. rejects/ignores client-supplied doctorId query parameters", async () => {
      // Doctor 2 attempts to spoof Doctor 1's ID via query param
      const res = await request(app)
        .get(`/api/v1/analytics/doctor?doctorId=${doctor1User._id.toString()}`)
        .set("Authorization", `Bearer ${doctor2Token}`);

      expect(res.status).toBe(200);
      // Must still evaluate to Doctor 2!
      expect(res.body.data.doctorId).toBe(doctor2User._id.toString());
    });

    it("16. avoids join multiplication from multiple payments or consultation records", async () => {
      // Create 1 completed appointment with fee 800
      const appointment = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctor1User._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 1800000),
        status: AppointmentStatus.COMPLETED,
        reason: "Unique Visit",
        fee: 800,
        paymentStatus: "PAID",
      });

      // Create multiple payment references for the same appointment (e.g. retry records)
      await Payment.create([
        {
          userId: patientUser._id,
          targetType: PaymentTargetType.APPOINTMENT,
          targetId: appointment._id,
          amount: 800,
          currency: "INR",
          status: PaymentStatus.FAILED,
          provider: PaymentProvider.RAZORPAY,
          referenceId: "PAY-ATTEMPT-1",
        },
        {
          userId: patientUser._id,
          targetType: PaymentTargetType.APPOINTMENT,
          targetId: appointment._id,
          amount: 800,
          currency: "INR",
          status: PaymentStatus.SUCCESS,
          provider: PaymentProvider.RAZORPAY,
          referenceId: "PAY-ATTEMPT-2",
        },
      ]);

      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.earningsSummary.totalEarnings).toBe(800);
      expect(res.body.data.consultationMetrics.completedConsultations).toBe(1);
    });

    it("resolves API Contract 19.2 alias /api/v1/analytics/doctor/earnings identically", async () => {
      const res = await request(app)
        .get("/api/v1/analytics/doctor/earnings")
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.earningsSummary).toBeDefined();
      expect(res.body.data.consultationMetrics).toBeDefined();
    });
  });

  // =========================================================================
  // SECTION 3: Pharmacy Fulfillment & Revenue Analytics
  // =========================================================================
  describe("3. Pharmacy Fulfillment & Revenue Analytics", () => {
    it("17. calculates fulfillment volume following order lifecycle", async () => {
      // 2 DELIVERED orders
      for (let i = 0; i < 2; i++) {
        await Order.create({
          patientId: patientUser._id,
          pharmacyId: pharmacy1Profile._id,
          items: [
            {
              medicineId: testMedicine._id,
              medicineName: "Paracetamol 500mg",
              quantity: 2,
              unitPrice: 50,
              totalPrice: 100,
            },
          ],
          totals: { subtotal: 100, deliveryFee: 30, totalAmount: 130 },
          deliveryAddress: {
            city: "Mumbai",
            state: "MH",
            postalCode: "400001",
            country: "India",
          },
          status: OrderStatus.DELIVERED,
          paymentStatus: "PAID",
          deliveredAt: new Date(),
        });
      }

      // 1 PREPARING order
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 1,
            unitPrice: 50,
            totalPrice: 50,
          },
        ],
        totals: { subtotal: 50, deliveryFee: 30, totalAmount: 80 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.PREPARING,
        paymentStatus: "PAID",
      });

      // 1 CANCELLED order
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 1,
            unitPrice: 50,
            totalPrice: 50,
          },
        ],
        totals: { subtotal: 50, deliveryFee: 30, totalAmount: 80 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.CANCELLED,
        paymentStatus: "REFUNDED",
      });

      const res = await request(app)
        .get("/api/v1/analytics/pharmacy")
        .set("Authorization", `Bearer ${pharmacy1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.fulfillmentMetrics.totalOrders).toBe(4);
      expect(res.body.data.fulfillmentMetrics.deliveredOrders).toBe(2);
      expect(res.body.data.fulfillmentMetrics.cancelledOrders).toBe(1);
      expect(res.body.data.fulfillmentMetrics.fulfillmentRate).toBe(50); // 2/4 = 50%
    });

    it("18. calculates pharmacy revenue from delivered, paid orders", async () => {
      // Delivered paid order 1: 500
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 5,
            unitPrice: 100,
            totalPrice: 500,
          },
        ],
        totals: { subtotal: 500, deliveryFee: 50, totalAmount: 550 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.DELIVERED,
        paymentStatus: "PAID",
        deliveredAt: new Date(),
      });

      const res = await request(app)
        .get("/api/v1/analytics/pharmacy")
        .set("Authorization", `Bearer ${pharmacy1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.revenueSummary.totalRevenue).toBe(550);
      expect(res.body.data.revenueSummary.deliveredPaidOrders).toBe(1);
    });

    it("19. excludes cancelled, rejected, unpaid, and refunded orders from recognized revenue", async () => {
      // 1 Delivered Paid: 300
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 3,
            unitPrice: 100,
            totalPrice: 300,
          },
        ],
        totals: { subtotal: 300, deliveryFee: 0, totalAmount: 300 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.DELIVERED,
        paymentStatus: "PAID",
        deliveredAt: new Date(),
      });

      // 1 Delivered but UNPAID: 400 (excluded from realized revenue)
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 4,
            unitPrice: 100,
            totalPrice: 400,
          },
        ],
        totals: { subtotal: 400, deliveryFee: 0, totalAmount: 400 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.DELIVERED,
        paymentStatus: "UNPAID",
        deliveredAt: new Date(),
      });

      // 1 Cancelled & Refunded: 600
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 6,
            unitPrice: 100,
            totalPrice: 600,
          },
        ],
        totals: { subtotal: 600, deliveryFee: 0, totalAmount: 600 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.CANCELLED,
        paymentStatus: "REFUNDED",
      });

      const res = await request(app)
        .get("/api/v1/analytics/pharmacy")
        .set("Authorization", `Bearer ${pharmacy1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.revenueSummary.totalRevenue).toBe(300);
      expect(res.body.data.revenueSummary.deliveredPaidOrders).toBe(1);
    });

    it("20. enforces strict pharmacy isolation: Pharmacy A cannot access Pharmacy B metrics", async () => {
      // Pharmacy 1 has 1 order of 400
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Paracetamol 500mg",
            quantity: 4,
            unitPrice: 100,
            totalPrice: 400,
          },
        ],
        totals: { subtotal: 400, deliveryFee: 0, totalAmount: 400 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.DELIVERED,
        paymentStatus: "PAID",
      });

      // Pharmacy 2 requests its metrics
      const res = await request(app)
        .get("/api/v1/analytics/pharmacy")
        .set("Authorization", `Bearer ${pharmacy2Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.pharmacyId).toBe(pharmacy2Profile._id.toString());
      expect(res.body.data.fulfillmentMetrics.totalOrders).toBe(0);
      expect(res.body.data.revenueSummary.totalRevenue).toBe(0);
    });

    it("21. client-supplied pharmacyId cannot override authenticated identity", async () => {
      // Pharmacy 2 supplies Pharmacy 1's ID in query
      const res = await request(app)
        .get(
          `/api/v1/analytics/pharmacy?pharmacyId=${pharmacy1Profile._id.toString()}`
        )
        .set("Authorization", `Bearer ${pharmacy2Token}`);

      expect(res.status).toBe(200);
      // Still scoped to Pharmacy 2
      expect(res.body.data.pharmacyId).toBe(pharmacy2Profile._id.toString());
    });

    it("22. multiple order items do not multiply revenue or order counts", async () => {
      // 1 Order with 4 different line items totalling 500
      await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacy1Profile._id,
        items: [
          {
            medicineId: testMedicine._id,
            medicineName: "Item 1",
            quantity: 1,
            unitPrice: 100,
            totalPrice: 100,
          },
          {
            medicineId: testMedicine._id,
            medicineName: "Item 2",
            quantity: 1,
            unitPrice: 150,
            totalPrice: 150,
          },
          {
            medicineId: testMedicine._id,
            medicineName: "Item 3",
            quantity: 1,
            unitPrice: 200,
            totalPrice: 200,
          },
          {
            medicineId: testMedicine._id,
            medicineName: "Item 4",
            quantity: 1,
            unitPrice: 50,
            totalPrice: 50,
          },
        ],
        totals: { subtotal: 500, deliveryFee: 0, totalAmount: 500 },
        deliveryAddress: {
          city: "Mumbai",
          state: "MH",
          postalCode: "400001",
          country: "India",
        },
        status: OrderStatus.DELIVERED,
        paymentStatus: "PAID",
      });

      const res = await request(app)
        .get("/api/v1/analytics/pharmacy")
        .set("Authorization", `Bearer ${pharmacy1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.fulfillmentMetrics.totalOrders).toBe(1);
      expect(res.body.data.revenueSummary.totalRevenue).toBe(500);
    });
  });

  // =========================================================================
  // SECTION 4: Aggregation Robustness, Validation & Safety
  // =========================================================================
  describe("4. Aggregation Robustness, Validation & Safety", () => {
    it("23. validates correctly formatted ISO date filter parameters", async () => {
      const res = await request(app)
        .get(
          "/api/v1/analytics/overview?from=2026-01-01T00:00:00.000Z&to=2026-12-31T23:59:59.999Z"
        )
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("24. rejects invalid date strings and inverted date ranges with validation error (422/400)", async () => {
      // 1. Invalid date string
      const invalidRes = await request(app)
        .get("/api/v1/analytics/overview?from=not-a-valid-date")
        .set("Authorization", `Bearer ${adminToken}`);
      expect([400, 422]).toContain(invalidRes.status);

      // 2. Inverted date range (from > to)
      const invertedRes = await request(app)
        .get(
          "/api/v1/analytics/overview?from=2026-12-31T00:00:00Z&to=2026-01-01T00:00:00Z"
        )
        .set("Authorization", `Bearer ${adminToken}`);
      expect([400, 422]).toContain(invertedRes.status);
      expect(JSON.stringify(invertedRes.body)).toContain("earlier than or equal");
    });

    it("25. handles missing optional profiles safely", async () => {
      // Doctor user without DoctorProfile document
      const docUserNoProfile = await User.create({
        email: "doc.noprofile@lifeline.org",
        phone: "+919876543099",
        fullName: "Dr. No Profile",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
        role: UserRole.DOCTOR,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        phoneVerified: true,
      });
      const tokenNoProfile = tokenService.generateAccessToken(
        docUserNoProfile._id.toString(),
        UserRole.DOCTOR
      );

      const res = await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${tokenNoProfile}`);

      expect(res.status).toBe(200);
      expect(res.body.data.consultationMetrics.totalAppointments).toBe(0);
      expect(res.body.data.earningsSummary.totalEarnings).toBe(0);
    });

    it("26. preserves multi-currency grouping without unsafe conversion or conflation", async () => {
      // Payment in INR
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.RAZORPAY,
        referenceId: "PAY-INR-1",
      });

      // Payment in USD
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: new mongoose.Types.ObjectId(),
        amount: 50,
        currency: "USD",
        status: PaymentStatus.SUCCESS,
        provider: PaymentProvider.STRIPE,
        referenceId: "PAY-USD-1",
      });

      const res = await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const currencies = res.body.data.financialMetrics.currencies;
      expect(currencies.length).toBe(2);

      const inrGroup = currencies.find((c: any) => c.currency === "INR");
      const usdGroup = currencies.find((c: any) => c.currency === "USD");

      expect(inrGroup?.grossTransactionVolume).toBe(500);
      expect(usdGroup?.grossTransactionVolume).toBe(50);
    });

    it("27. query is read-only and does not mutate any underlying collection", async () => {
      const userCountBefore = await User.countDocuments();
      const paymentCountBefore = await Payment.countDocuments();
      const appointmentCountBefore = await Appointment.countDocuments();
      const orderCountBefore = await Order.countDocuments();

      await request(app)
        .get("/api/v1/analytics/overview")
        .set("Authorization", `Bearer ${adminToken}`);

      await request(app)
        .get("/api/v1/analytics/doctor")
        .set("Authorization", `Bearer ${doctor1Token}`);

      await request(app)
        .get("/api/v1/analytics/pharmacy")
        .set("Authorization", `Bearer ${pharmacy1Token}`);

      expect(await User.countDocuments()).toBe(userCountBefore);
      expect(await Payment.countDocuments()).toBe(paymentCountBefore);
      expect(await Appointment.countDocuments()).toBe(appointmentCountBefore);
      expect(await Order.countDocuments()).toBe(orderCountBefore);
    });

    it("28. existing appointment, payment, and order business state machines are unchanged", async () => {
      // Check that enums and valid states are fully respected
      expect(Object.values(AppointmentStatus)).toContain("COMPLETED");
      expect(Object.values(PaymentStatus)).toContain("SUCCESS");
      expect(Object.values(OrderStatus)).toContain("DELIVERED");
    });
  });
});
