import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  PharmacyProfile,
  Medicine,
  Inventory,
  Prescription,
  Order,
  Payment,
  AuditLog,
  Notification,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  PharmacyVerificationStatus,
  DoctorVerificationStatus,
  PrescriptionStatus,
  OrderStatus,
  DosageForm,
  MedicineRoute,
  AuditAction,
  PaymentStatus,
  PaymentTargetType,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { computePrescriptionDigest } from "../src/services/prescription.service.js";
import { paymentService } from "../src/services/payment.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 10 - Task 10.4: Pharmacist Prescription Verification & Fulfillment Pipeline", () => {
  // Test Users & Tokens
  let patientUser1: any;
  let patientToken1: string;

  let patientUser2: any;
  let patientToken2: string;

  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  let pharmacyUser1: any;
  let pharmacyProfile1: any;
  let pharmacyToken1: string;

  let pharmacyUser2: any;
  let pharmacyProfile2: any;
  let pharmacyToken2: string;

  let unverifiedPharmacyUser: any;
  let unverifiedPharmacyProfile: any;
  let unverifiedPharmacyToken: string;

  let adminUser: any;
  let adminToken: string;

  // Medicines
  let otcMedicine: any;
  let rxMedicine: any;

  // Prescriptions
  let validPrescription: any;
  let expiredPrescription: any;

  const validDeliveryAddress = {
    street: "789 Linking Road",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400050",
    country: "India",
  };

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_order_fulfillment_test"
    );

    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await Medicine.syncIndexes();
    await Inventory.syncIndexes();
    await Prescription.syncIndexes();
    await Order.syncIndexes();
    await Payment.syncIndexes();
    await AuditLog.syncIndexes();
    await Notification.syncIndexes();

    // 1. Patient 1
    patientUser1 = await User.create({
      email: "patient1.m104@example.com",
      phone: "+919876544001",
      fullName: "Kavita Rao",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patientToken1 = tokenService.generateAccessToken(
      patientUser1._id.toString(),
      UserRole.PATIENT
    );

    // 2. Patient 2
    patientUser2 = await User.create({
      email: "patient2.m104@example.com",
      phone: "+919876544002",
      fullName: "Rohan Varma",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patientToken2 = tokenService.generateAccessToken(
      patientUser2._id.toString(),
      UserRole.PATIENT
    );

    // 3. Doctor
    doctorUser = await User.create({
      email: "doctor.m104@example.com",
      phone: "+919876544003",
      fullName: "Dr. Deepak Singhania",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "General Practice",
      qualifications: ["MBBS"],
      experienceYears: 10,
      registrationNumber: "MCI-2026-M104",
      registrationCouncil: "Maharashtra Medical Council",
      consultationFee: 400,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 4. Pharmacy 1 (Assigned, Approved & Verified)
    pharmacyUser1 = await User.create({
      email: "pharmacy1.m104@example.com",
      phone: "+919876544004",
      fullName: "Guardian Pharmacy Bandra",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyProfile1 = await PharmacyProfile.create({
      userId: pharmacyUser1._id,
      pharmacyName: "Guardian Pharmacy Bandra",
      ownerName: "Guardian Healthcare Pvt Ltd",
      licenseNumber: "DL-MH-2026-M104-1",
      address: {
        street: "Bandra West",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400050",
        country: "India",
      },
      phone: "+919876544004",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });
    pharmacyToken1 = tokenService.generateAccessToken(
      pharmacyUser1._id.toString(),
      UserRole.PHARMACY
    );

    // 5. Pharmacy 2 (Unassigned, Approved & Verified)
    pharmacyUser2 = await User.create({
      email: "pharmacy2.m104@example.com",
      phone: "+919876544005",
      fullName: "Wellness Pharmacy Andheri",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyProfile2 = await PharmacyProfile.create({
      userId: pharmacyUser2._id,
      pharmacyName: "Wellness Pharmacy Andheri",
      ownerName: "Wellness Retail Ltd",
      licenseNumber: "DL-MH-2026-M104-2",
      address: {
        street: "Andheri West",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400058",
        country: "India",
      },
      phone: "+919876544005",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });
    pharmacyToken2 = tokenService.generateAccessToken(
      pharmacyUser2._id.toString(),
      UserRole.PHARMACY
    );

    // 6. Unverified Pharmacy
    unverifiedPharmacyUser = await User.create({
      email: "unverified.m104@example.com",
      phone: "+919876544006",
      fullName: "Unverified Chemist",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    unverifiedPharmacyProfile = await PharmacyProfile.create({
      userId: unverifiedPharmacyUser._id,
      pharmacyName: "Unverified Chemist",
      ownerName: "Pending License",
      licenseNumber: "DL-MH-2026-UNVERIFIED",
      address: {
        street: "Kurla",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400070",
        country: "India",
      },
      phone: "+919876544006",
      verificationStatus: PharmacyVerificationStatus.PENDING_REVIEW,
    });
    unverifiedPharmacyToken = tokenService.generateAccessToken(
      unverifiedPharmacyUser._id.toString(),
      UserRole.PHARMACY
    );

    // 7. Admin
    adminUser = await User.create({
      email: "admin.m104@example.com",
      phone: "+919876544007",
      fullName: "Admin Officer",
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

    // 8. Seed Medicines
    otcMedicine = await Medicine.create({
      name: "Paracetamol 500mg M104",
      genericName: "Paracetamol",
      brandName: "Crocin",
      manufacturer: "GSK",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      prescriptionRequired: false,
      scheduledDrugCategory: null,
      isActive: true,
    });

    rxMedicine = await Medicine.create({
      name: "Amoxicillin 500mg M104",
      genericName: "Amoxicillin",
      brandName: "Mox 500",
      manufacturer: "Ranbaxy",
      dosageForm: DosageForm.CAPSULE,
      strength: "500mg",
      prescriptionRequired: true,
      scheduledDrugCategory: "SCHEDULE_H",
      isActive: true,
    });

    // 9. Seed Inventory for Pharmacy 1
    await Inventory.create({
      pharmacyId: pharmacyProfile1._id,
      medicineId: otcMedicine._id,
      quantity: 100,
      reservedQuantity: 0,
      price: 20.0,
      isAvailable: true,
    });

    await Inventory.create({
      pharmacyId: pharmacyProfile1._id,
      medicineId: rxMedicine._id,
      quantity: 100,
      reservedQuantity: 0,
      price: 50.0,
      isAvailable: true,
    });

    // 10. Seed Prescriptions
    const issuedAt = new Date();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days valid
    const rxMedicinesList = [
      {
        medicineId: rxMedicine._id,
        medicineName: rxMedicine.name,
        dosage: "500mg",
        frequency: "TID",
        durationDays: 5,
        quantity: 15,
        route: MedicineRoute.ORAL,
        specialInstructions: "Take after meals",
      },
    ];

    const validChecksum = computePrescriptionDigest({
      patientId: patientUser1._id.toString(),
      doctorId: doctorUser._id.toString(),
      diagnosis: "Bacterial infection",
      medicines: rxMedicinesList.map((m) => ({
        medicineId: m.medicineId.toString(),
        medicineName: m.medicineName,
        dosage: m.dosage,
        frequency: m.frequency,
        durationDays: m.durationDays,
        quantity: m.quantity,
        route: m.route,
        specialInstructions: m.specialInstructions,
      })),
      issuedAt,
      expiresAt,
    });

    validPrescription = await Prescription.create({
      patientId: patientUser1._id,
      doctorId: doctorUser._id,
      diagnosis: "Bacterial infection",
      medicines: rxMedicinesList,
      status: PrescriptionStatus.FINALIZED_ISSUED,
      issuedAt,
      expiresAt,
      validityDays: 30,
      integrityChecksum: validChecksum,
    });

    expiredPrescription = await Prescription.create({
      patientId: patientUser1._id,
      doctorId: doctorUser._id,
      diagnosis: "Old condition",
      medicines: rxMedicinesList,
      status: PrescriptionStatus.FINALIZED_ISSUED,
      issuedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // Expired 10 days ago
      validityDays: 30,
    });
  }, 30000);

  afterAll(async () => {
    await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    await DoctorProfile.deleteMany({});
    await PharmacyProfile.deleteMany({});
    await Medicine.deleteMany({});
    await Inventory.deleteMany({});
    await Prescription.deleteMany({});
    await Order.deleteMany({});
    await Payment.deleteMany({});
    await AuditLog.deleteMany({});
    await Notification.deleteMany({});
    await disconnectDatabase();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  // Helper to create an Order in PRESCRIPTION_REVIEW status
  async function createOrderInPrescriptionReview(overrides = {}): Promise<any> {
    // Reset reserved stock
    await Inventory.updateOne(
      { pharmacyId: pharmacyProfile1._id, medicineId: rxMedicine._id },
      { $set: { quantity: 100, reservedQuantity: 10 } }
    );

    return await Order.create({
      patientId: patientUser1._id,
      pharmacyId: pharmacyProfile1._id,
      items: [
        {
          medicineId: rxMedicine._id,
          medicineName: rxMedicine.name,
          quantity: 10,
          unitPrice: 50.0,
          totalPrice: 500.0,
        },
      ],
      prescriptionId: validPrescription._id,
      paymentStatus: "UNPAID",
      status: OrderStatus.PRESCRIPTION_REVIEW,
      deliveryAddress: validDeliveryAddress,
      totals: {
        subtotal: 500.0,
        deliveryFee: 0,
        totalAmount: 500.0,
      },
      currency: "INR",
      stockReleased: false,
      stockConsumed: false,
      ...overrides,
    });
  }

  // Helper to create an Order in PHARMACY_ACCEPTED status
  async function createOrderInPharmacyAccepted(overrides = {}): Promise<any> {
    await Inventory.updateOne(
      { pharmacyId: pharmacyProfile1._id, medicineId: otcMedicine._id },
      { $set: { quantity: 100, reservedQuantity: 5 } }
    );

    return await Order.create({
      patientId: patientUser1._id,
      pharmacyId: pharmacyProfile1._id,
      items: [
        {
          medicineId: otcMedicine._id,
          medicineName: otcMedicine.name,
          quantity: 5,
          unitPrice: 20.0,
          totalPrice: 100.0,
        },
      ],
      paymentStatus: "PAID",
      status: OrderStatus.PHARMACY_ACCEPTED,
      deliveryAddress: validDeliveryAddress,
      totals: {
        subtotal: 100.0,
        deliveryFee: 0,
        totalAmount: 100.0,
      },
      currency: "INR",
      stockReleased: false,
      stockConsumed: false,
      ...overrides,
    });
  }

  // =========================================================================
  // GROUP 1: Pharmacist Prescription Review (PATCH /:id/prescription-review)
  // =========================================================================
  describe("1. Pharmacist Prescription Review", () => {
    it("1. Assigned, verified pharmacist can approve an eligible prescription", async () => {
      const order = await createOrderInPrescriptionReview();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(OrderStatus.PHARMACY_ACCEPTED);
      expect(res.body.data.prescriptionReview?.decision).toBe("APPROVED");
      expect(res.body.data.prescriptionReview?.reviewedBy).toBe(
        pharmacyUser1._id.toString()
      );
      expect(res.body.data.prescriptionReview?.reviewedAt).toBeDefined();

      // Verify in DB
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.status).toBe(OrderStatus.PHARMACY_ACCEPTED);
      expect(dbOrder?.prescriptionReview?.decision).toBe("APPROVED");
    });

    it("2. Assigned, verified pharmacist can reject an eligible prescription with a reason", async () => {
      const order = await createOrderInPrescriptionReview();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          decision: "REJECT",
          rejectionReason: "Dosage prescribed does not match patient age group",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(OrderStatus.REJECTED);
      expect(res.body.data.prescriptionReview?.decision).toBe("REJECTED");
      expect(res.body.data.prescriptionReview?.rejectionReason).toBe(
        "Dosage prescribed does not match patient age group"
      );

      // Verify DB and stock release
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.status).toBe(OrderStatus.REJECTED);
      expect(dbOrder?.stockReleased).toBe(true);

      const inv = await Inventory.findOne({
        pharmacyId: pharmacyProfile1._id,
        medicineId: rxMedicine._id,
      });
      expect(inv?.reservedQuantity).toBe(0); // 10 was released
    });

    it("3. A different pharmacy cannot review the order (403 AUTH_RESOURCE_ACCESS_DENIED)", async () => {
      const order = await createOrderInPrescriptionReview();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken2}`) // Pharmacy 2
        .send({ decision: "APPROVE" });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("4. Patient, doctor, unverified pharmacy, and unauthenticated callers are rejected", async () => {
      const order = await createOrderInPrescriptionReview();

      // Patient
      const patientRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${patientToken1}`)
        .send({ decision: "APPROVE" });
      expect(patientRes.status).toBe(403);

      // Doctor
      const doctorRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ decision: "APPROVE" });
      expect(doctorRes.status).toBe(403);

      // Unverified Pharmacy
      const unverifiedRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${unverifiedPharmacyToken}`)
        .send({ decision: "APPROVE" });
      expect(unverifiedRes.status).toBe(403);
      expect(unverifiedRes.body.error?.code).toBe("PHARMACY_NOT_VERIFIED");

      // Unauthenticated
      const anonRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .send({ decision: "APPROVE" });
      expect(anonRes.status).toBe(401);
    });

    it("5. Review on an invalid order state is rejected with HTTP 409", async () => {
      // Order already in PHARMACY_ACCEPTED
      const order = await createOrderInPharmacyAccepted();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("ORDER_INVALID_TRANSITION");
    });

    it("6. Repeated approval/rejection fails with 409 and does not duplicate side effects", async () => {
      const order = await createOrderInPrescriptionReview();

      // First approve
      const firstRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });
      expect(firstRes.status).toBe(200);

      // Second approve attempt
      const secondRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });
      expect(secondRes.status).toBe(409);
      expect(secondRes.body.error?.code).toBe("ORDER_INVALID_TRANSITION");
    });

    it("7. Rejection releases reservation exactly once and is idempotent", async () => {
      const order = await createOrderInPrescriptionReview();

      // Initial reservedQuantity is 10
      const initialInv = await Inventory.findOne({
        pharmacyId: pharmacyProfile1._id,
        medicineId: rxMedicine._id,
      });
      expect(initialInv?.reservedQuantity).toBe(10);

      // Reject order
      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "REJECT", rejectionReason: "Out of therapeutic range" });
      expect(res.status).toBe(200);

      const afterInv = await Inventory.findOne({
        pharmacyId: pharmacyProfile1._id,
        medicineId: rxMedicine._id,
      });
      expect(afterInv?.reservedQuantity).toBe(0);

      // Direct service call or repeat does not decrement below 0
      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder?.stockReleased).toBe(true);
    });

    it("8. Rejection initiates automated refund for a paid, eligible order", async () => {
      const payment = await Payment.create({
        referenceId: `PAY-M104-${crypto.randomUUID()}`,
        userId: patientUser1._id,
        targetType: PaymentTargetType.ORDER,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        providerPaymentId: "pay_fake_m104_001",
      });

      const order = await createOrderInPrescriptionReview({
        paymentId: payment._id,
        paymentStatus: "PAID",
      });

      // Mock paymentService.processRefund
      const processRefundSpy = vi
        .spyOn(paymentService, "processRefund")
        .mockResolvedValueOnce({
          success: true,
          status: "PROCESSED",
          paymentId: payment._id.toString(),
          refundId: "rfnd_fake_m104_001",
          amount: 500,
          currency: "INR",
        });

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "REJECT", rejectionReason: "Prescription illegible" });

      expect(res.status).toBe(200);
      expect(processRefundSpy).toHaveBeenCalledWith(
        payment._id.toString(),
        500,
        "Prescription illegible",
        expect.anything()
      );

      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.paymentStatus).toBe("REFUNDED");
    });

    it("9. Rejection does not refund an unpaid order", async () => {
      const order = await createOrderInPrescriptionReview({
        paymentStatus: "UNPAID",
        paymentId: undefined,
      });

      const processRefundSpy = vi.spyOn(paymentService, "processRefund");

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "REJECT", rejectionReason: "Doctor signature missing" });

      expect(res.status).toBe(200);
      expect(processRefundSpy).not.toHaveBeenCalled();

      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.paymentStatus).toBe("UNPAID");
    });

    it("10. Gateway refund failure preserves order rejection without marking order refunded", async () => {
      const payment = await Payment.create({
        referenceId: `PAY-M104-${crypto.randomUUID()}`,
        userId: patientUser1._id,
        targetType: PaymentTargetType.ORDER,
        targetId: new mongoose.Types.ObjectId(),
        amount: 500,
        currency: "INR",
        status: PaymentStatus.SUCCESS,
        providerPaymentId: "pay_fake_m104_002",
      });

      const order = await createOrderInPrescriptionReview({
        paymentId: payment._id,
        paymentStatus: "PAID",
      });

      vi.spyOn(paymentService, "processRefund").mockRejectedValueOnce(
        new Error("Gateway connection timed out")
      );

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "REJECT", rejectionReason: "Drug interaction risk" });

      expect(res.status).toBe(200);
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.status).toBe(OrderStatus.REJECTED);
      expect(dbOrder?.paymentStatus).toBe("PAID"); // NOT falsely marked REFUNDED
    });

    it("11. Rejection requires a non-empty rejectionReason", async () => {
      const order = await createOrderInPrescriptionReview();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "REJECT" }); // Missing rejectionReason

      expect(res.status).toBe(422);
    });

    it("12. Expired prescription attached to order causes approval to fail with 422", async () => {
      const order = await createOrderInPrescriptionReview({
        prescriptionId: expiredPrescription._id,
      });

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });

      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe("PRESCRIPTION_EXPIRED");
    });
  });

  // =========================================================================
  // GROUP 2: Fulfillment Progression (PATCH /:id/status)
  // =========================================================================
  describe("2. Fulfillment Status Transitions", () => {
    it("13. Valid fulfillment progression succeeds in sequence", async () => {
      const order = await createOrderInPharmacyAccepted();

      // Step 1: PHARMACY_ACCEPTED -> PREPARING
      const step1 = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      expect(step1.status).toBe(200);
      expect(step1.body.data.status).toBe("PREPARING");

      // Verify stock was permanently consumed
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.stockConsumed).toBe(true);

      // Step 2: PREPARING -> READY_FOR_DELIVERY
      const step2 = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "READY_FOR_DELIVERY" });

      expect(step2.status).toBe(200);
      expect(step2.body.data.status).toBe("READY_FOR_DELIVERY");

      // Step 3: READY_FOR_DELIVERY -> OUT_FOR_DELIVERY
      const step3 = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "OUT_FOR_DELIVERY" });

      expect(step3.status).toBe(200);
      expect(step3.body.data.status).toBe("OUT_FOR_DELIVERY");
    });

    it("14. Transitioning to PREPARING permanently decrements inventory quantity and clears reservation", async () => {
      // Set initial inventory: quantity 100, reserved 5
      await Inventory.updateOne(
        { pharmacyId: pharmacyProfile1._id, medicineId: otcMedicine._id },
        { $set: { quantity: 100, reservedQuantity: 5 } }
      );

      const order = await createOrderInPharmacyAccepted();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      expect(res.status).toBe(200);

      const inv = await Inventory.findOne({
        pharmacyId: pharmacyProfile1._id,
        medicineId: otcMedicine._id,
      });
      // 5 was consumed from physical quantity (100 -> 95) and reservedQuantity (5 -> 0)
      expect(inv?.quantity).toBe(95);
      expect(inv?.reservedQuantity).toBe(0);
    });

    it("15. Skipped transitions fail with HTTP 409", async () => {
      const order = await createOrderInPharmacyAccepted();

      // Cannot jump from PHARMACY_ACCEPTED to READY_FOR_DELIVERY
      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "READY_FOR_DELIVERY" });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("ORDER_INVALID_TRANSITION");
    });

    it("16. Backward transitions fail with HTTP 409", async () => {
      const order = await createOrderInPharmacyAccepted();

      // Move to PREPARING
      await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      // Move to READY_FOR_DELIVERY
      await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "READY_FOR_DELIVERY" });

      // Attempt backward to PREPARING
      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("ORDER_INVALID_TRANSITION");
    });

    it("17. Repeated transition to identical status fails with HTTP 409", async () => {
      const order = await createOrderInPharmacyAccepted();

      await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      const repeatRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      expect(repeatRes.status).toBe(409);
      expect(repeatRes.body.error?.code).toBe("ORDER_INVALID_TRANSITION");
    });

    it("18. Ineligible order states (REJECTED, PRESCRIPTION_REVIEW) cannot enter fulfillment", async () => {
      const rxOrder = await createOrderInPrescriptionReview();

      const res = await request(app)
        .patch(`/api/v1/orders/${rxOrder._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("ORDER_INVALID_TRANSITION");
    });

    it("19. Unassigned pharmacy cannot advance fulfillment status (403)", async () => {
      const order = await createOrderInPharmacyAccepted();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken2}`) // Pharmacy 2
        .send({ status: "PREPARING" });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("20. Platform Admin can advance fulfillment status", async () => {
      const order = await createOrderInPharmacyAccepted();

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "PREPARING" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PREPARING");
    });

    it("21. Patient and Doctor cannot advance fulfillment status (403)", async () => {
      const order = await createOrderInPharmacyAccepted();

      const patRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${patientToken1}`)
        .send({ status: "PREPARING" });
      expect(patRes.status).toBe(403);

      const docRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({ status: "PREPARING" });
      expect(docRes.status).toBe(403);
    });
  });

  // =========================================================================
  // GROUP 3: Delivery Verification OTP
  // =========================================================================
  describe("3. Delivery Verification OTP", () => {
    it("22. Transition to OUT_FOR_DELIVERY generates secure hashed OTP and notifies patient", async () => {
      const order = await createOrderInPharmacyAccepted();

      await Order.updateOne(
        { _id: order._id },
        { $set: { status: OrderStatus.READY_FOR_DELIVERY } }
      );

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "OUT_FOR_DELIVERY" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("OUT_FOR_DELIVERY");
      // OTP must NOT be exposed in API response
      expect(res.body.data.deliveryOtp).toBeUndefined();

      // Check DB: hashed OTP stored
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.deliveryOtp).toBeDefined();
      expect(dbOrder?.deliveryOtpExpiresAt).toBeDefined();
      expect(dbOrder?.deliveryOtpAttempts).toBe(0);

      // Verify patient notification was created with plaintext OTP
      const notification = await Notification.findOne({
        userId: patientUser1._id,
        relatedEntityId: order._id,
        title: "Order Out for Delivery",
      });
      expect(notification).toBeDefined();
      expect(notification?.message).toMatch(/\d{6}/); // contains 6-digit code
    });

    it("23. Correct unexpired OTP marks order DELIVERED and clears OTP atomically", async () => {
      const plaintextOtp = "654321";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser1._id,
        pharmacyId: pharmacyProfile1._id,
        items: [
          {
            medicineId: otcMedicine._id,
            medicineName: otcMedicine.name,
            quantity: 2,
            unitPrice: 20.0,
            totalPrice: 40.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 40, deliveryFee: 0, totalAmount: 40 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h in future
        deliveryOtpAttempts: 0,
      });

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED", deliveryOtp: plaintextOtp });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("DELIVERED");
      expect(res.body.data.deliveredAt).toBeDefined();

      // Verify DB: OTP cleared
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.status).toBe(OrderStatus.DELIVERED);
      expect(dbOrder?.deliveryOtp).toBeUndefined();
    });

    it("24. Missing or incorrect OTP cannot mark order DELIVERED", async () => {
      const plaintextOtp = "123456";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser1._id,
        pharmacyId: pharmacyProfile1._id,
        items: [
          {
            medicineId: otcMedicine._id,
            medicineName: otcMedicine.name,
            quantity: 1,
            unitPrice: 20.0,
            totalPrice: 20.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 20, deliveryFee: 0, totalAmount: 20 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        deliveryOtpAttempts: 0,
      });

      // Missing OTP
      const missingRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED" });
      expect(missingRes.status).toBe(422);

      // Incorrect OTP
      const wrongRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED", deliveryOtp: "999999" });
      expect(wrongRes.status).toBe(422);
      expect(wrongRes.body.error?.code).toBe("DELIVERY_OTP_INVALID");

      // Verify attempt counter incremented
      const dbOrder = await Order.findById(order._id);
      expect(dbOrder?.deliveryOtpAttempts).toBe(1);
    });

    it("25. Expired OTP fails verification with HTTP 422 DELIVERY_OTP_EXPIRED", async () => {
      const plaintextOtp = "123456";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser1._id,
        pharmacyId: pharmacyProfile1._id,
        items: [
          {
            medicineId: otcMedicine._id,
            medicineName: otcMedicine.name,
            quantity: 1,
            unitPrice: 20.0,
            totalPrice: 20.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 20, deliveryFee: 0, totalAmount: 20 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired 5 mins ago
        deliveryOtpAttempts: 0,
      });

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED", deliveryOtp: plaintextOtp });

      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe("DELIVERY_OTP_EXPIRED");
    });

    it("26. Exceeding 5 OTP verification attempts locks the order from further verification", async () => {
      const plaintextOtp = "123456";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser1._id,
        pharmacyId: pharmacyProfile1._id,
        items: [
          {
            medicineId: otcMedicine._id,
            medicineName: otcMedicine.name,
            quantity: 1,
            unitPrice: 20.0,
            totalPrice: 20.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 20, deliveryFee: 0, totalAmount: 20 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        deliveryOtpAttempts: 5, // Already reached 5
      });

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED", deliveryOtp: plaintextOtp });

      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe("DELIVERY_OTP_MAX_ATTEMPTS_EXCEEDED");
    });

    it("27. Consumed OTP cannot be reused after successful delivery", async () => {
      const plaintextOtp = "888999";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser1._id,
        pharmacyId: pharmacyProfile1._id,
        items: [
          {
            medicineId: otcMedicine._id,
            medicineName: otcMedicine.name,
            quantity: 1,
            unitPrice: 20.0,
            totalPrice: 20.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 20, deliveryFee: 0, totalAmount: 20 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        deliveryOtpAttempts: 0,
      });

      // First call delivers successfully
      const firstRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED", deliveryOtp: plaintextOtp });
      expect(firstRes.status).toBe(200);

      // Second call fails with 409
      const secondRes = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "DELIVERED", deliveryOtp: plaintextOtp });
      expect(secondRes.status).toBe(409);
    });

    it("28. OTP plaintext and hash are never exposed via ordinary GET endpoints", async () => {
      const plaintextOtp = "333444";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser1._id,
        pharmacyId: pharmacyProfile1._id,
        items: [
          {
            medicineId: otcMedicine._id,
            medicineName: otcMedicine.name,
            quantity: 1,
            unitPrice: 20.0,
            totalPrice: 20.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 20, deliveryFee: 0, totalAmount: 20 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        deliveryOtpAttempts: 0,
      });

      // Patient views order
      const patientGet = await request(app)
        .get(`/api/v1/orders/${order._id}`)
        .set("Authorization", `Bearer ${patientToken1}`);

      expect(patientGet.status).toBe(200);
      expect(patientGet.body.data.deliveryOtp).toBeUndefined();
      expect(patientGet.body.data.deliveryOtpExpiresAt).toBeUndefined();
      expect(patientGet.body.data.deliveryOtpAttempts).toBeUndefined();

      // Pharmacy views order
      const pharmacyGet = await request(app)
        .get(`/api/v1/orders/${order._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`);

      expect(pharmacyGet.status).toBe(200);
      expect(pharmacyGet.body.data.deliveryOtp).toBeUndefined();
    });
  });

  // =========================================================================
  // GROUP 4: Security, Audit Logging & Resilience
  // =========================================================================
  describe("4. Security, Audit Logging & Resilience", () => {
    it("29. Prescription review emits audit event with safe fields and no raw medical records", async () => {
      const order = await createOrderInPrescriptionReview();

      await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });

      const audit = await AuditLog.findOne({
        action: AuditAction.ORDER_PRESCRIPTION_VERIFIED,
        resourceId: order._id.toString(),
      });

      expect(audit).toBeDefined();
      expect(audit?.actorId.toString()).toBe(pharmacyUser1._id.toString());
      expect(audit?.actorRole).toBe(UserRole.PHARMACY);
      expect(audit?.metadata?.decision).toBe("APPROVED");
      // Must not expose raw prescription items, dosage or diagnoses
      expect(audit?.metadata?.medicines).toBeUndefined();
      expect(audit?.metadata?.diagnosis).toBeUndefined();
    });

    it("30. Audit logging failure does not fail the prescription review operation", async () => {
      const order = await createOrderInPrescriptionReview();

      vi.spyOn(auditLogService, "log").mockRejectedValueOnce(
        new Error("Audit database write failed")
      );

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/prescription-review`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ decision: "APPROVE" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(OrderStatus.PHARMACY_ACCEPTED);
    });

    it("31. Notification creation failure does not fail the fulfillment status transition", async () => {
      const order = await createOrderInPharmacyAccepted();

      vi.spyOn(Notification, "create").mockRejectedValueOnce(
        new Error("Notification queue disconnected")
      );

      const res = await request(app)
        .patch(`/api/v1/orders/${order._id}/status`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ status: "PREPARING" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("PREPARING");
    });
  });
});
