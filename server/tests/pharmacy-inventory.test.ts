import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  PharmacyProfile,
  Medicine,
  Inventory,
  AuditLog,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  PharmacyVerificationStatus,
  DosageForm,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 10 - Task 10.2: Pharmacy Inventory & Stock Management", () => {
  // Pharmacy 1 (Approved & Verified)
  let pharmacyUser1: any;
  let pharmacyProfile1: any;
  let pharmacyToken1: string;

  // Pharmacy 2 (Approved & Verified - Second Tenant)
  let pharmacyUser2: any;
  let pharmacyProfile2: any;
  let pharmacyToken2: string;

  // Pharmacy 3 (Unverified / Pending review)
  let unverifiedPharmacyUser: any;
  let unverifiedPharmacyProfile: any;
  let unverifiedPharmacyToken: string;

  // Patient user
  let patientUser: any;
  let patientToken: string;

  // Catalog Medicines
  let activeMedicine1: any;
  let activeMedicine2: any;
  let inactiveMedicine: any;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_pharmacy_inventory_test"
    );

    await User.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await Medicine.syncIndexes();
    await Inventory.syncIndexes();
    await AuditLog.syncIndexes();

    // 1. Create Pharmacy 1 (Approved)
    pharmacyUser1 = await User.create({
      email: "pharmacy1.m102@example.com",
      phone: "+919876542001",
      fullName: "Apollo Health Pharmacy",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyProfile1 = await PharmacyProfile.create({
      userId: pharmacyUser1._id,
      pharmacyName: "Apollo Health Pharmacy",
      ownerName: "Apollo Healthcare Ltd",
      licenseNumber: "DL-MH-2026-001A",
      address: {
        street: "123 Healthcare Way",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      phone: "+919876542001",
      email: "pharmacy1.m102@example.com",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });
    pharmacyToken1 = tokenService.generateAccessToken(
      pharmacyUser1._id.toString(),
      UserRole.PHARMACY
    );

    // 2. Create Pharmacy 2 (Approved - Second Tenant)
    pharmacyUser2 = await User.create({
      email: "pharmacy2.m102@example.com",
      phone: "+919876542002",
      fullName: "MedPlus Wellness Pharmacy",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyProfile2 = await PharmacyProfile.create({
      userId: pharmacyUser2._id,
      pharmacyName: "MedPlus Wellness Pharmacy",
      ownerName: "MedPlus Healthcare",
      licenseNumber: "DL-MH-2026-002B",
      address: {
        street: "456 Wellness Ave",
        city: "Pune",
        state: "Maharashtra",
        postalCode: "411001",
        country: "India",
      },
      phone: "+919876542002",
      email: "pharmacy2.m102@example.com",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });
    pharmacyToken2 = tokenService.generateAccessToken(
      pharmacyUser2._id.toString(),
      UserRole.PHARMACY
    );

    // 3. Create Unverified Pharmacy
    unverifiedPharmacyUser = await User.create({
      email: "unverified.m102@example.com",
      phone: "+919876542003",
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
      ownerName: "Pending Operator",
      licenseNumber: "DL-MH-2026-PENDING",
      address: {
        street: "789 Under Review Rd",
        city: "Nagpur",
        state: "Maharashtra",
        postalCode: "440001",
        country: "India",
      },
      phone: "+919876542003",
      email: "unverified.m102@example.com",
      verificationStatus: PharmacyVerificationStatus.PENDING_REVIEW,
    });
    unverifiedPharmacyToken = tokenService.generateAccessToken(
      unverifiedPharmacyUser._id.toString(),
      UserRole.PHARMACY
    );

    // 4. Create Patient
    patientUser = await User.create({
      email: "patient.m102@example.com",
      phone: "+919876542004",
      fullName: "Rahul Patient",
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
  }, 30000);

  afterAll(async () => {
    await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    await PharmacyProfile.deleteMany({});
    await Medicine.deleteMany({});
    await Inventory.deleteMany({});
    await AuditLog.deleteMany({});
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Inventory.deleteMany({});
    await AuditLog.deleteMany({});
    await Medicine.deleteMany({});

    // Seed master catalog medicines
    activeMedicine1 = await Medicine.create({
      name: "Paracetamol 500mg Tablet",
      genericName: "Acetaminophen",
      brandName: "Calpol",
      manufacturer: "GSK",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      category: "Analgesic",
      description: "Effective for pain and fever",
      prescriptionRequired: false,
      isActive: true,
    });

    activeMedicine2 = await Medicine.create({
      name: "Amoxicillin 500mg Capsule",
      genericName: "Amoxicillin",
      brandName: "Mox",
      manufacturer: "Ranbaxy",
      dosageForm: DosageForm.CAPSULE,
      strength: "500mg",
      category: "Antibiotic",
      description: "Antibiotic for bacterial infections",
      prescriptionRequired: true,
      isActive: true,
    });

    inactiveMedicine = await Medicine.create({
      name: "Withdrawn Medicine 100mg",
      genericName: "Discontinued Drug",
      brandName: "Discont",
      manufacturer: "Old Pharma",
      dosageForm: DosageForm.TABLET,
      strength: "100mg",
      category: "Withdrawn",
      description: "Discontinued medicine",
      prescriptionRequired: true,
      isActive: false,
    });
  });

  // =========================================================================
  // 1. INVENTORY CREATION AND UPDATES
  // =========================================================================

  describe("1. Inventory Creation and Updates", () => {
    it("1. An approved pharmacy can add a valid master-catalog medicine to its inventory", async () => {
      const payload = {
        medicineId: activeMedicine1._id.toString(),
        quantity: 100,
        price: 25.5,
      };

      const res = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pharmacyId).toBe(pharmacyProfile1._id.toString());
      expect(res.body.data.medicineId).toBe(activeMedicine1._id.toString());
      expect(res.body.data.quantity).toBe(100);
      expect(res.body.data.price).toBe(25.5);
      expect(res.body.data.isAvailable).toBe(true);

      // Verify DB persistence
      const saved = await Inventory.findOne({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
      });
      expect(saved).not.toBeNull();
      expect(saved?.quantity).toBe(100);
      expect(saved?.price).toBe(25.5);
    });

    it("2. An approved pharmacy can update stock quantity", async () => {
      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 20.0,
      });

      const res = await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ quantity: 150 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quantity).toBe(150);

      const refreshed = await Inventory.findById(item._id);
      expect(refreshed?.quantity).toBe(150);
    });

    it("3. An approved pharmacy can update unit price", async () => {
      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 20.0,
      });

      const res = await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ price: 34.99 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.price).toBe(34.99);

      const refreshed = await Inventory.findById(item._id);
      expect(refreshed?.price).toBe(34.99);
    });

    it("4. Batch number and expiration date are validated and persisted correctly", async () => {
      const futureExpiry = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
      const payload = {
        medicineId: activeMedicine2._id.toString(),
        quantity: 80,
        price: 18.0,
        batchNumber: "BATCH-2026-RX",
        expiryDate: futureExpiry,
      };

      const res = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.batchNumber).toBe("BATCH-2026-RX");
      expect(new Date(res.body.data.expiryDate).toISOString()).toBe(futureExpiry);

      const saved = await Inventory.findById(res.body.data.id);
      expect(saved?.batchNumber).toBe("BATCH-2026-RX");
      expect(saved?.expiryDate?.toISOString()).toBe(futureExpiry);
    });

    it("5. A negative stock quantity is rejected with HTTP 422", async () => {
      const createRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: -10,
          price: 25.0,
        });

      expect(createRes.status).toBe(422);
      expect(createRes.body.success).toBe(false);
      expect(createRes.body.error.code).toBe("VALIDATION_ERROR");

      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 20.0,
      });

      const updateRes = await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ quantity: -1 });

      expect(updateRes.status).toBe(422);
      expect(updateRes.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("6. Invalid prices, malformed dates, and invalid payloads are rejected", async () => {
      // 6a. Zero or negative price
      const zeroPriceRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10,
          price: 0,
        });
      expect(zeroPriceRes.status).toBe(422);

      const negPriceRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10,
          price: -5.5,
        });
      expect(negPriceRes.status).toBe(422);

      // 6b. Malformed date
      const malformedDateRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10,
          price: 15.0,
          expiryDate: "not-a-valid-date",
        });
      expect(malformedDateRes.status).toBe(422);

      // 6c. Non-integer stock quantity
      const nonIntRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10.5,
          price: 15.0,
        });
      expect(nonIntRes.status).toBe(422);

      // 6d. Empty update body
      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 20.0,
      });

      const emptyUpdateRes = await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({});
      expect(emptyUpdateRes.status).toBe(422);
    });

    it("7. Nonexistent medicine references are rejected with 404 and inactive medicines with 422", async () => {
      const fakeMedicineId = new mongoose.Types.ObjectId().toString();
      const notFoundRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: fakeMedicineId,
          quantity: 20,
          price: 10.0,
        });

      expect(notFoundRes.status).toBe(404);
      expect(notFoundRes.body.error.code).toBe("MEDICINE_NOT_FOUND");

      // Inactive catalog medicine
      const inactiveRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: inactiveMedicine._id.toString(),
          quantity: 20,
          price: 10.0,
        });

      expect(inactiveRes.status).toBe(422);
      expect(inactiveRes.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("8. Duplicate pharmacy/medicine entries are prevented by the unique database index", async () => {
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 30,
        price: 15.0,
      });

      // API attempt to add the exact same medicine to pharmacy stock
      const dupRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 50,
          price: 18.0,
        });

      expect(dupRes.status).toBe(409);
      expect(dupRes.body.error.code).toBe("RESOURCE_CONFLICT");

      // Direct MongoDB duplicate insertion attempt
      await expect(
        Inventory.create({
          pharmacyId: pharmacyProfile1._id,
          medicineId: activeMedicine1._id,
          quantity: 100,
          price: 20.0,
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 2. AUTHORIZATION AND MULTI-TENANCY
  // =========================================================================

  describe("2. Authorization and Multi-Tenancy", () => {
    it("9. An unauthenticated user cannot perform inventory mutations", async () => {
      const createRes = await request(app)
        .post(`/api/v1/pharmacies/${pharmacyProfile1._id}/inventory`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10,
          price: 15.0,
        });

      expect(createRes.status).toBe(401);

      const fakeId = new mongoose.Types.ObjectId().toString();
      const updateRes = await request(app)
        .patch(`/api/v1/pharmacies/${pharmacyProfile1._id}/inventory/${fakeId}`)
        .send({ quantity: 20 });

      expect(updateRes.status).toBe(401);
    });

    it("10. An unverified pharmacy cannot create or update inventory", async () => {
      const createRes = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${unverifiedPharmacyToken}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10,
          price: 15.0,
        });

      expect(createRes.status).toBe(403);
      expect(createRes.body.error.code).toBe("PHARMACY_NOT_VERIFIED");

      // Even if item existed in DB
      const item = await Inventory.create({
        pharmacyId: unverifiedPharmacyProfile._id,
        medicineId: activeMedicine1._id,
        quantity: 10,
        price: 15.0,
      });

      const updateRes = await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
        .set("Authorization", `Bearer ${unverifiedPharmacyToken}`)
        .send({ quantity: 30 });

      expect(updateRes.status).toBe(403);
      expect(updateRes.body.error.code).toBe("PHARMACY_NOT_VERIFIED");
    });

    it("11. A patient cannot perform pharmacy inventory mutations", async () => {
      const createRes = await request(app)
        .post(`/api/v1/pharmacies/${pharmacyProfile1._id}/inventory`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 10,
          price: 15.0,
        });

      expect(createRes.status).toBe(403);

      const fakeId = new mongoose.Types.ObjectId().toString();
      const updateRes = await request(app)
        .patch(`/api/v1/pharmacies/${pharmacyProfile1._id}/inventory/${fakeId}`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({ quantity: 20 });

      expect(updateRes.status).toBe(403);
    });

    it("12. A pharmacy cannot create or modify another pharmacy's inventory", async () => {
      // Pharmacy 1 tries to add stock targeting Pharmacy 2's route
      const createRes = await request(app)
        .post(`/api/v1/pharmacies/${pharmacyProfile2._id}/inventory`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 50,
          price: 15.0,
        });

      expect(createRes.status).toBe(403);
      expect(createRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Create item belonging to Pharmacy 2
      const itemPh2 = await Inventory.create({
        pharmacyId: pharmacyProfile2._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 20.0,
      });

      // Pharmacy 1 tries to update Pharmacy 2's item via Pharmacy 2's route
      const crossUpdateRes1 = await request(app)
        .patch(`/api/v1/pharmacies/${pharmacyProfile2._id}/inventory/${itemPh2._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ quantity: 999 });

      expect(crossUpdateRes1.status).toBe(403);

      // Pharmacy 1 tries to update Pharmacy 2's item using Pharmacy 1's /me route
      const crossUpdateRes2 = await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${itemPh2._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ quantity: 999 });

      expect(crossUpdateRes2.status).toBe(403);
      expect(crossUpdateRes2.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Verify Pharmacy 2's item was unchanged
      const unaffectedItem = await Inventory.findById(itemPh2._id);
      expect(unaffectedItem?.quantity).toBe(50);
    });

    it("13. A client cannot bypass ownership checks by changing the pharmacy ID in URL", async () => {
      const res = await request(app)
        .post(`/api/v1/pharmacies/${pharmacyProfile2._id}/inventory`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 20,
          price: 10.0,
        });

      expect(res.status).toBe(403);
    });

    it("14. A failed authorization attempt causes no database mutation", async () => {
      const initialCount = await Inventory.countDocuments({});

      await request(app)
        .post(`/api/v1/pharmacies/${pharmacyProfile2._id}/inventory`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 20,
          price: 10.0,
        });

      const afterCount = await Inventory.countDocuments({});
      expect(afterCount).toBe(initialCount);
    });
  });

  // =========================================================================
  // 3. PUBLIC STOCK DISCOVERY
  // =========================================================================

  describe("3. Public Stock Discovery", () => {
    it("15. Public users can query eligible pharmacy stock without authentication", async () => {
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 40,
        price: 22.0,
        isAvailable: true,
      });

      const res = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory`
      );

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].price).toBe(22.0);
      expect(res.body.data[0].quantity).toBe(40);
      expect(res.body.data[0].medicine._id).toBe(activeMedicine1._id.toString());
      expect(res.body.meta.total).toBe(1);
    });

    it("16. Public queries cannot modify inventory", async () => {
      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 40,
        price: 22.0,
        isAvailable: true,
      });

      await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory`
      );

      const unchanged = await Inventory.findById(item._id);
      expect(unchanged?.quantity).toBe(40);
      expect(unchanged?.price).toBe(22.0);
    });

    it("17. Expired stock is not reported as available", async () => {
      // 17a. Valid non-expired item
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 20.0,
        expiryDate: new Date(Date.now() + 180 * 24 * 3600 * 1000), // in future
        isAvailable: true,
      });

      // 17b. Expired item (expired 10 days ago)
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine2._id,
        quantity: 100,
        price: 15.0,
        expiryDate: new Date(Date.now() - 10 * 24 * 3600 * 1000), // in past
        isAvailable: true,
      });

      const res = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].medicine._id).toBe(activeMedicine1._id.toString());
    });

    it("18. Pagination is bounded and invalid query parameters are rejected", async () => {
      // 18a. Invalid negative page
      const invalidPage = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory?page=-1`
      );
      expect(invalidPage.status).toBe(422);

      // 18b. Exceeded limit (> 100)
      const invalidLimit = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory?limit=250`
      );
      expect(invalidLimit.status).toBe(422);

      // 18c. Unknown strict query parameters
      const unknownQuery = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory?unrecognizedField=foo`
      );
      expect(unknownQuery.status).toBe(422);

      // 18d. Valid bounded pagination
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 10,
        price: 10.0,
        isAvailable: true,
      });
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine2._id,
        quantity: 20,
        price: 20.0,
        isAvailable: true,
      });

      const validPaging = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory?page=1&limit=1`
      );
      expect(validPaging.status).toBe(200);
      expect(validPaging.body.data.length).toBe(1);
      expect(validPaging.body.meta.total).toBe(2);
      expect(validPaging.body.meta.limit).toBe(1);
    });

    it("19. Private pharmacy information and internal batch details are not leaked in public queries", async () => {
      await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 25.0,
        batchNumber: "SECRET-INTERNAL-BATCH-999",
        lowStockThreshold: 15,
        reorderQuantity: 60,
        isAvailable: true,
      });

      const res = await request(app).get(
        `/api/v1/pharmacies/${pharmacyProfile1._id}/inventory`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      const publicItem = res.body.data[0];

      expect(publicItem.batchNumber).toBeUndefined();
      expect(publicItem.lowStockThreshold).toBeUndefined();
      expect(publicItem.reorderQuantity).toBeUndefined();
      expect(publicItem.quantity).toBe(50);
      expect(publicItem.price).toBe(25.0);
    });
  });

  // =========================================================================
  // 4. DATA INTEGRITY AND CONCURRENCY
  // =========================================================================

  describe("4. Data Integrity and Concurrency", () => {
    it("20. Concurrent updates cannot cause negative stock", async () => {
      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 10,
        price: 25.0,
      });

      // Execute simultaneous updates with negative value attempts
      const [resValid, resInvalid] = await Promise.all([
        request(app)
          .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
          .set("Authorization", `Bearer ${pharmacyToken1}`)
          .send({ quantity: 5 }),
        request(app)
          .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
          .set("Authorization", `Bearer ${pharmacyToken1}`)
          .send({ quantity: -20 }),
      ]);

      expect(resValid.status).toBe(200);
      expect(resInvalid.status).toBe(422);

      const refreshed = await Inventory.findById(item._id);
      expect(refreshed?.quantity).toBeGreaterThanOrEqual(0);
      expect(refreshed?.quantity).toBe(5);
    });

    it("21. Concurrent creation attempts cannot bypass the unique compound index", async () => {
      const results = await Promise.allSettled([
        Inventory.create({
          pharmacyId: pharmacyProfile1._id,
          medicineId: activeMedicine1._id,
          quantity: 20,
          price: 15.0,
        }),
        Inventory.create({
          pharmacyId: pharmacyProfile1._id,
          medicineId: activeMedicine1._id,
          quantity: 30,
          price: 18.0,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const err: any = (rejected[0] as PromiseRejectedResult).reason;
      expect(err.code).toBe(11000);
    });

    it("22. Updating inventory does not modify the master medicine definition", async () => {
      const item = await Inventory.create({
        pharmacyId: pharmacyProfile1._id,
        medicineId: activeMedicine1._id,
        quantity: 50,
        price: 25.0,
      });

      await request(app)
        .patch(`/api/v1/pharmacies/me/inventory/${item._id}`)
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({ price: 99.99, quantity: 200 });

      const medAfter = await Medicine.findById(activeMedicine1._id);
      expect(medAfter?.name).toBe("Paracetamol 500mg Tablet");
      expect(medAfter?.isActive).toBe(true);
      expect(medAfter?.dosageForm).toBe(DosageForm.TABLET);
    });

    it("23. Audit persistence failure does not fail a successful inventory mutation", async () => {
      const spy = vi
        .spyOn(auditLogService, "log")
        .mockRejectedValueOnce(new Error("Simulated audit database connection outage"));

      const res = await request(app)
        .post("/api/v1/pharmacies/me/inventory")
        .set("Authorization", `Bearer ${pharmacyToken1}`)
        .send({
          medicineId: activeMedicine1._id.toString(),
          quantity: 75,
          price: 32.5,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quantity).toBe(75);

      spy.mockRestore();
    });
  });
});
