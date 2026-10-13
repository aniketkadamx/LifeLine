import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
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
  AuditLog,
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
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  computePrescriptionDigest,
} from "../src/services/prescription.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 10 - Task 10.3: Medicine Order Placement & Prescription Attachment", () => {
  // Patients
  let patientUser1: any;
  let patientToken1: string;

  let patientUser2: any;
  let patientToken2: string;

  // Doctor
  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  // Verified Pharmacy
  let pharmacyUser: any;
  let pharmacyProfile: any;
  let pharmacyToken: string;

  // Second Verified Pharmacy (for multi-tenant isolation tests)
  let pharmacyUser2: any;
  let pharmacyProfile2: any;

  // Unverified Pharmacy
  let unverifiedPharmacyUser: any;
  let unverifiedPharmacyProfile: any;

  // Catalog Medicines
  let otcMedicine1: any;
  let otcMedicine2: any;
  let rxMedicine1: any;
  let rxMedicine2: any;
  let inactiveMedicine: any;

  // Inventory records
  let invOtc1: any;
  let invOtc2: any;
  let invRx1: any;
  let invRx2: any;

  // Prescriptions
  let validPrescriptionPatient1: any;
  let expiredPrescriptionPatient1: any;
  let validPrescriptionPatient2: any;
  let tamperedPrescriptionPatient1: any;

  const validDeliveryAddress = {
    street: "123 Marine Drive",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400020",
    country: "India",
  };

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_order_creation_test"
    );

    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await Medicine.syncIndexes();
    await Inventory.syncIndexes();
    await Prescription.syncIndexes();
    await Order.syncIndexes();
    await AuditLog.syncIndexes();

    // 1. Create Patient 1
    patientUser1 = await User.create({
      email: "patient1.m103@example.com",
      phone: "+919876543001",
      fullName: "Ananya Sharma",
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

    // 2. Create Patient 2 (Separate patient tenant)
    patientUser2 = await User.create({
      email: "patient2.m103@example.com",
      phone: "+919876543002",
      fullName: "Vikram Malhotra",
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

    // 3. Create Doctor
    doctorUser = await User.create({
      email: "doctor.m103@example.com",
      phone: "+919876543003",
      fullName: "Dr. Rajesh Kothari",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "General Medicine",
      qualifications: ["MBBS", "MD"],
      experienceYears: 12,
      registrationNumber: "MCI-2026-M103",
      registrationCouncil: "Maharashtra Medical Council",
      consultationFee: 500,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 4. Create Pharmacy 1 (Approved & Verified)
    pharmacyUser = await User.create({
      email: "pharmacy1.m103@example.com",
      phone: "+919876543004",
      fullName: "Apollo Pharmacy Mumbai",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyProfile = await PharmacyProfile.create({
      userId: pharmacyUser._id,
      pharmacyName: "Apollo Pharmacy Mumbai",
      ownerName: "Apollo Hospitals Ltd",
      licenseNumber: "DL-MH-2026-901",
      address: {
        street: "45 Hospital Road",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      phone: "+919876543004",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });
    pharmacyToken = tokenService.generateAccessToken(
      pharmacyUser._id.toString(),
      UserRole.PHARMACY
    );

    // 5. Create Pharmacy 2 (Second Verified Pharmacy)
    pharmacyUser2 = await User.create({
      email: "pharmacy2.m103@example.com",
      phone: "+919876543005",
      fullName: "MedPlus Pharmacy Pune",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyProfile2 = await PharmacyProfile.create({
      userId: pharmacyUser2._id,
      pharmacyName: "MedPlus Pharmacy Pune",
      ownerName: "MedPlus Ltd",
      licenseNumber: "DL-MH-2026-902",
      address: {
        street: "78 Pune Station Rd",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "India",
      },
      phone: "+919876543005",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });

    // 6. Create Unverified Pharmacy
    unverifiedPharmacyUser = await User.create({
      email: "unverified.m103@example.com",
      phone: "+919876543006",
      fullName: "Local Unverified Chemist",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    unverifiedPharmacyProfile = await PharmacyProfile.create({
      userId: unverifiedPharmacyUser._id,
      pharmacyName: "Local Chemist",
      ownerName: "Unverified Chemist",
      licenseNumber: "DL-MH-2026-PENDING",
      address: {
        street: "99 Back Alley",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400099",
        country: "India",
      },
      phone: "+919876543006",
      verificationStatus: PharmacyVerificationStatus.PENDING_REVIEW,
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
    await AuditLog.deleteMany({});
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Order.deleteMany({});
    await Inventory.deleteMany({});
    await Prescription.deleteMany({});
    await Medicine.deleteMany({});
    await AuditLog.deleteMany({});

    // Seed master catalog medicines
    otcMedicine1 = await Medicine.create({
      name: "Paracetamol 500mg Tablet",
      genericName: "Acetaminophen",
      brandName: "Calpol",
      manufacturer: "GSK",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      category: "Analgesic",
      prescriptionRequired: false,
      isActive: true,
    });

    otcMedicine2 = await Medicine.create({
      name: "Vitamin C 500mg Chewable",
      genericName: "Ascorbic Acid",
      brandName: "Limcee",
      manufacturer: "Abbott",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      category: "Vitamin",
      prescriptionRequired: false,
      isActive: true,
    });

    rxMedicine1 = await Medicine.create({
      name: "Amoxicillin 500mg Capsule",
      genericName: "Amoxicillin",
      brandName: "Mox 500",
      manufacturer: "Ranbaxy",
      dosageForm: DosageForm.CAPSULE,
      strength: "500mg",
      category: "Antibiotic",
      prescriptionRequired: true,
      isActive: true,
    });

    rxMedicine2 = await Medicine.create({
      name: "Metformin 500mg Tablet",
      genericName: "Metformin HCl",
      brandName: "Glyciphage",
      manufacturer: "Franco-Indian",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      category: "Antidiabetic",
      prescriptionRequired: true,
      isActive: true,
    });

    inactiveMedicine = await Medicine.create({
      name: "Discontinued Cough Syrup",
      genericName: "Dextromethorphan",
      brandName: "OldSyrup",
      manufacturer: "OldCo",
      dosageForm: DosageForm.SYRUP,
      strength: "100ml",
      category: "Antitussive",
      prescriptionRequired: false,
      isActive: false,
    });

    // Seed pharmacy 1 inventory
    invOtc1 = await Inventory.create({
      pharmacyId: pharmacyProfile._id,
      medicineId: otcMedicine1._id,
      quantity: 100,
      reservedQuantity: 0,
      price: 15.0,
      isAvailable: true,
    });

    invOtc2 = await Inventory.create({
      pharmacyId: pharmacyProfile._id,
      medicineId: otcMedicine2._id,
      quantity: 50,
      reservedQuantity: 0,
      price: 25.0,
      isAvailable: true,
    });

    invRx1 = await Inventory.create({
      pharmacyId: pharmacyProfile._id,
      medicineId: rxMedicine1._id,
      quantity: 80,
      reservedQuantity: 0,
      price: 45.0,
      isAvailable: true,
    });

    invRx2 = await Inventory.create({
      pharmacyId: pharmacyProfile._id,
      medicineId: rxMedicine2._id,
      quantity: 10,
      reservedQuantity: 0,
      price: 60.0,
      isAvailable: true,
    });

    // Seed prescriptions
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 90 * 24 * 3600 * 1000);

    const rx1Items = [
      {
        medicineId: rxMedicine1._id.toString(),
        medicineName: rxMedicine1.name,
        dosage: "1 capsule",
        frequency: "Three times daily",
        durationDays: 7,
        quantity: 21,
        route: MedicineRoute.ORAL,
        specialInstructions: "Take after meals",
      },
    ];

    const digestPatient1 = computePrescriptionDigest({
      patientId: patientUser1._id.toString(),
      doctorId: doctorUser._id.toString(),
      diagnosis: "Bacterial respiratory infection",
      medicines: rx1Items,
      issuedAt,
      expiresAt,
    });

    validPrescriptionPatient1 = await Prescription.create({
      patientId: patientUser1._id,
      doctorId: doctorUser._id,
      diagnosis: "Bacterial respiratory infection",
      status: PrescriptionStatus.FINALIZED_ISSUED,
      medicines: [
        {
          medicineId: rxMedicine1._id,
          medicineName: rxMedicine1.name,
          dosage: "1 capsule",
          frequency: "Three times daily",
          durationDays: 7,
          quantity: 21,
          route: MedicineRoute.ORAL,
          specialInstructions: "Take after meals",
        },
      ],
      issuedAt,
      expiresAt,
      integrityChecksum: digestPatient1,
    });

    // Expired prescription for Patient 1
    const pastIssued = new Date(Date.now() - 100 * 24 * 3600 * 1000);
    const pastExpiry = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    expiredPrescriptionPatient1 = await Prescription.create({
      patientId: patientUser1._id,
      doctorId: doctorUser._id,
      diagnosis: "Old infection",
      status: PrescriptionStatus.FINALIZED_ISSUED,
      medicines: [
        {
          medicineId: rxMedicine1._id,
          medicineName: rxMedicine1.name,
          dosage: "1 capsule",
          frequency: "Twice daily",
          durationDays: 5,
          quantity: 10,
          route: MedicineRoute.ORAL,
        },
      ],
      issuedAt: pastIssued,
      expiresAt: pastExpiry,
    });

    // Valid prescription for Patient 2 (Separate patient)
    const digestPatient2 = computePrescriptionDigest({
      patientId: patientUser2._id.toString(),
      doctorId: doctorUser._id.toString(),
      diagnosis: "Acute Bronchitis",
      medicines: rx1Items,
      issuedAt,
      expiresAt,
    });

    validPrescriptionPatient2 = await Prescription.create({
      patientId: patientUser2._id,
      doctorId: doctorUser._id,
      diagnosis: "Acute Bronchitis",
      status: PrescriptionStatus.FINALIZED_ISSUED,
      medicines: [
        {
          medicineId: rxMedicine1._id,
          medicineName: rxMedicine1.name,
          dosage: "1 capsule",
          frequency: "Three times daily",
          durationDays: 7,
          quantity: 21,
          route: MedicineRoute.ORAL,
        },
      ],
      issuedAt,
      expiresAt,
      integrityChecksum: digestPatient2,
    });

    // Tampered checksum prescription
    tamperedPrescriptionPatient1 = await Prescription.create({
      patientId: patientUser1._id,
      doctorId: doctorUser._id,
      diagnosis: "Bacterial infection",
      status: PrescriptionStatus.FINALIZED_ISSUED,
      medicines: [
        {
          medicineId: rxMedicine1._id,
          medicineName: rxMedicine1.name,
          dosage: "1 capsule",
          frequency: "Three times daily",
          durationDays: 7,
          quantity: 21,
          route: MedicineRoute.ORAL,
        },
      ],
      issuedAt,
      expiresAt,
      integrityChecksum: "000000000000000000000000000000000000000000000000000000000000dead",
    });
  });

  // =========================================================================
  // 1. ORDER CREATION
  // =========================================================================

  describe("1. Order Creation & Routing", () => {
    it("1. An authenticated patient can place a valid OTC-only order", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: otcMedicine1._id.toString(), quantity: 2 },
          { medicineId: otcMedicine2._id.toString(), quantity: 1 },
        ],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.patientId).toBe(patientUser1._id.toString());
      expect(res.body.data.pharmacyId).toBe(pharmacyProfile._id.toString());
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.totals.subtotal).toBe(55); // (2*15) + (1*25) = 55
      expect(res.body.data.totals.totalAmount).toBe(55);
    });

    it("2. An OTC-only order receives PHARMACY_ACCEPTED initial status", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 3 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(OrderStatus.PHARMACY_ACCEPTED);
    });

    it("3. An order containing a prescription-required medicine without a prescription fails with HTTP 422", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: otcMedicine1._id.toString(), quantity: 1 },
          { medicineId: rxMedicine1._id.toString(), quantity: 1 }, // Prescription required!
        ],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("ORDER_PRESCRIPTION_MISSING");
    });

    it("4. An order containing a prescription-required medicine with a valid unexpired prescription enters PRESCRIPTION_REVIEW", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: rxMedicine1._id.toString(), quantity: 5 },
          { medicineId: otcMedicine1._id.toString(), quantity: 1 },
        ],
        deliveryAddress: validDeliveryAddress,
        prescriptionId: validPrescriptionPatient1._id.toString(),
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe(OrderStatus.PRESCRIPTION_REVIEW);
      expect(res.body.data.prescriptionId).toBe(validPrescriptionPatient1._id.toString());
    });

    it("5. A valid prescription belonging to another patient is rejected", async () => {
      // Patient 1 tries to use Patient 2's prescription
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: rxMedicine1._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
        prescriptionId: validPrescriptionPatient2._id.toString(),
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("6. Expired prescriptions are rejected", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: rxMedicine1._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
        prescriptionId: expiredPrescriptionPatient1._id.toString(),
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PRESCRIPTION_EXPIRED");
    });

    it("7. Invalid or integrity-failing prescriptions are rejected", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: rxMedicine1._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
        prescriptionId: tamperedPrescriptionPatient1._id.toString(),
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PRESCRIPTION_INTEGRITY_FAILED");
    });

    it("8. A prescription that does not cover the required medicine is rejected", async () => {
      // Prescription covers rxMedicine1 (Amoxicillin), but order requests rxMedicine2 (Metformin)
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: rxMedicine2._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
        prescriptionId: validPrescriptionPatient1._id.toString(),
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PRESCRIPTION_REJECTED");
    });
  });

  // =========================================================================
  // 2. PRICE SNAPSHOTS
  // =========================================================================

  describe("2. Price Snapshots", () => {
    it("9. Unit prices are read from the selected pharmacy's inventory", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 4 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      const item = res.body.data.items[0];
      expect(item.unitPrice).toBe(15.0);
      expect(item.totalPrice).toBe(60.0);
    });

    it("10. Client-supplied prices and totals cannot override authoritative inventory prices", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          {
            medicineId: otcMedicine1._id.toString(),
            quantity: 2,
            unitPrice: 0.01, // Client tries to forge cheap price
            totalPrice: 0.02,
          },
        ],
        deliveryAddress: validDeliveryAddress,
        totals: { subtotal: 0.02, totalAmount: 0.02 }, // Client tries to forge totals
      };

      // Zod schema is strict() and will reject unauthorized fields
      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("11. Order totals are calculated server-side accurately", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: otcMedicine1._id.toString(), quantity: 3 }, // 3 * 15 = 45
          { medicineId: otcMedicine2._id.toString(), quantity: 2 }, // 2 * 25 = 50
        ],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.totals.subtotal).toBe(95);
      expect(res.body.data.totals.totalAmount).toBe(95);
    });

    it("12. Existing order price snapshots remain unchanged when inventory prices change", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      const orderId = res.body.data.id;

      // Pharmacy subsequently increases price from 15 to 30 in inventory
      await Inventory.updateOne(
        { _id: invOtc1._id },
        { $set: { price: 30.0 } }
      );

      // Verify order record retains original price snapshot of 15
      const persistedOrder = await Order.findById(orderId);
      expect(persistedOrder?.items[0].unitPrice).toBe(15.0);
      expect(persistedOrder?.items[0].totalPrice).toBe(30.0);
      expect(persistedOrder?.totals.totalAmount).toBe(30.0);
    });
  });

  // =========================================================================
  // 3. INVENTORY RESERVATION
  // =========================================================================

  describe("3. Inventory Reservation & Concurrency", () => {
    it("13. Successful order creation reserves the requested stock", async () => {
      const beforeInv = await Inventory.findById(invOtc1._id);
      expect(beforeInv?.reservedQuantity).toBe(0);

      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 7 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);

      const afterInv = await Inventory.findById(invOtc1._id);
      expect(afterInv?.quantity).toBe(100); // Physical stock remains 100
      expect(afterInv?.reservedQuantity).toBe(7); // Reserved stock incremented
    });

    it("14. Insufficient stock rejects the order without leaving partial reservations", async () => {
      // invOtc2 has quantity: 50, reservedQuantity: 0
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: otcMedicine1._id.toString(), quantity: 5 }, // In stock (100)
          { medicineId: otcMedicine2._id.toString(), quantity: 500 }, // Out of stock (only 50 available)!
        ],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INVENTORY_INSUFFICIENT_STOCK");

      // Verify otcMedicine1 reservation was rolled back or never committed
      const otc1Inv = await Inventory.findById(invOtc1._id);
      expect(otc1Inv?.reservedQuantity).toBe(0);
    });

    it("15. Expired inventory cannot be reserved", async () => {
      // Mark invOtc1 expired
      await Inventory.updateOne(
        { _id: invOtc1._id },
        { $set: { expiryDate: new Date(Date.now() - 3600000) } }
      );

      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVENTORY_ITEM_EXPIRED");
    });

    it("16. Inventory belonging to another pharmacy cannot be used for the selected order", async () => {
      // Add medicine to pharmacy 2
      await Inventory.create({
        pharmacyId: pharmacyProfile2._id,
        medicineId: otcMedicine1._id,
        quantity: 50,
        price: 20.0,
      });

      // Target pharmacy 2, but request otcMedicine2 which only pharmacy 1 stocks
      const payload = {
        pharmacyId: pharmacyProfile2._id.toString(),
        items: [{ medicineId: otcMedicine2._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("INVENTORY_NOT_FOUND");
    });

    it("17. Concurrent requests cannot oversell inventory", async () => {
      // Set invOtc2 to quantity: 10, reservedQuantity: 0
      await Inventory.updateOne(
        { _id: invOtc2._id },
        { $set: { quantity: 10, reservedQuantity: 0 } }
      );

      // Execute 3 simultaneous order requests each requesting 4 units (total 12 units > 10 available)
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine2._id.toString(), quantity: 4 }],
        deliveryAddress: validDeliveryAddress,
      };

      const results = await Promise.all([
        request(app)
          .post("/api/v1/orders")
          .set("Authorization", `Bearer ${patientToken1}`)
          .send(payload),
        request(app)
          .post("/api/v1/orders")
          .set("Authorization", `Bearer ${patientToken1}`)
          .send(payload),
        request(app)
          .post("/api/v1/orders")
          .set("Authorization", `Bearer ${patientToken1}`)
          .send(payload),
      ]);

      const successful = results.filter((r) => r.status === 201);
      const failed = results.filter((r) => r.status === 409 || r.status === 422);

      // Exactly 2 orders can succeed (2 * 4 = 8 units <= 10), 3rd must fail (8 + 4 = 12 > 10)
      expect(successful.length).toBe(2);
      expect(failed.length).toBe(1);

      const invAfter = await Inventory.findById(invOtc2._id);
      expect(invAfter?.reservedQuantity).toBe(8);
      expect(invAfter?.quantity).toBe(10);
    });

    it("18. Repeated item IDs in order items array are rejected", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: otcMedicine1._id.toString(), quantity: 2 },
          { medicineId: otcMedicine1._id.toString(), quantity: 3 }, // Duplicate!
        ],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // 4. AUTHORIZATION AND DATA INTEGRITY
  // =========================================================================

  describe("4. Authorization and Data Integrity", () => {
    it("19. Unauthenticated users cannot create orders", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app).post("/api/v1/orders").send(payload);

      expect(res.status).toBe(401);
    });

    it("20. Non-patient roles cannot place orders", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
      };

      // Doctor attempt
      const docRes = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send(payload);

      expect(docRes.status).toBe(403);
      expect(docRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Pharmacy attempt
      const pharmRes = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .send(payload);

      expect(pharmRes.status).toBe(403);
      expect(pharmRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("21. Patient identity cannot be overridden by request payload", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        patientId: patientUser2._id.toString(), // Patient 1 tries to order for Patient 2
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
      };

      // Strict schema rejects unknown patientId field
      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
    });

    it("22. Unverified pharmacy cannot fulfill orders", async () => {
      const payload = {
        pharmacyId: unverifiedPharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PHARMACY_NOT_VERIFIED");
    });

    it("23. Inactive catalog medicines are rejected", async () => {
      // Seed inventory for inactive medicine
      await Inventory.create({
        pharmacyId: pharmacyProfile._id,
        medicineId: inactiveMedicine._id,
        quantity: 10,
        price: 5.0,
      });

      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: inactiveMedicine._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("24. Invalid request payloads cause no stock mutation", async () => {
      const beforeInv = await Inventory.findById(invOtc1._id);
      const beforeReserved = beforeInv?.reservedQuantity;

      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [
          { medicineId: otcMedicine1._id.toString(), quantity: -10 }, // Malformed quantity
        ],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(422);

      const afterInv = await Inventory.findById(invOtc1._id);
      expect(afterInv?.reservedQuantity).toBe(beforeReserved);
    });

    it("25. Audit persistence failure does not fail a successful order placement", async () => {
      const spy = vi
        .spyOn(auditLogService, "log")
        .mockRejectedValueOnce(new Error("Audit log database failure"));

      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 1 }],
        deliveryAddress: validDeliveryAddress,
      };

      const res = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      spy.mockRestore();
    });

    it("26. Authenticated patient can retrieve their created order", async () => {
      const payload = {
        pharmacyId: pharmacyProfile._id.toString(),
        items: [{ medicineId: otcMedicine1._id.toString(), quantity: 2 }],
        deliveryAddress: validDeliveryAddress,
      };

      const createRes = await request(app)
        .post("/api/v1/orders")
        .set("Authorization", `Bearer ${patientToken1}`)
        .send(payload);

      const orderId = createRes.body.data.id;

      // Patient 1 gets own order
      const getRes = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${patientToken1}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(orderId);

      // Patient 2 attempts to get Patient 1's order
      const deniedRes = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set("Authorization", `Bearer ${patientToken2}`);

      expect(deniedRes.status).toBe(403);
    });
  });
});
