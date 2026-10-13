import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  Medicine,
  Prescription,
  AuditLog,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DosageForm,
  PrescriptionStatus,
  MedicineRoute,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { auditLogService } from "../src/services/audit-log.service.js";

describe("Milestone 10 - Task 10.1: Master Medicine Catalog Management", () => {
  let adminUser: any;
  let adminToken: string;

  let patientUser: any;
  let patientToken: string;

  let doctorUser: any;
  let doctorToken: string;

  let pharmacyUser: any;
  let pharmacyToken: string;

  let sampleMedicine1: any;
  let sampleMedicine2: any;
  let sampleMedicine3: any;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_medicine_catalog_test"
    );
    await User.syncIndexes();
    await Medicine.syncIndexes();
    await Prescription.syncIndexes();
    await AuditLog.syncIndexes();

    // 1. Admin User
    adminUser = await User.create({
      email: "admin.m101@example.com",
      phone: "+919876541001",
      fullName: "Super Admin",
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

    // 2. Patient User
    patientUser = await User.create({
      email: "patient.m101@example.com",
      phone: "+919876541002",
      fullName: "Jane Patient",
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

    // 3. Doctor User
    doctorUser = await User.create({
      email: "doctor.m101@example.com",
      phone: "+919876541003",
      fullName: "Dr. Clinician",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 4. Pharmacy User
    pharmacyUser = await User.create({
      email: "pharmacy.m101@example.com",
      phone: "+919876541004",
      fullName: "City Pharmacy",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacyToken = tokenService.generateAccessToken(
      pharmacyUser._id.toString(),
      UserRole.PHARMACY
    );
  }, 30000);

  afterAll(async () => {
    await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    await Medicine.deleteMany({});
    await Prescription.deleteMany({});
    await AuditLog.deleteMany({});
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Medicine.deleteMany({});
    await Prescription.deleteMany({});
    await AuditLog.deleteMany({});

    // Seed 3 standard pharmaceutical catalog entries
    sampleMedicine1 = await Medicine.create({
      name: "Paracetamol 500mg Tablet",
      genericName: "Acetaminophen",
      brandName: "Calpol",
      manufacturer: "GlaxoSmithKline",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      category: "Analgesic",
      description: "Effective relief for fever and mild to moderate pain",
      prescriptionRequired: false,
      isActive: true,
    });

    sampleMedicine2 = await Medicine.create({
      name: "Amoxicillin 500mg Capsule",
      genericName: "Amoxicillin Trihydrate",
      brandName: "Mox",
      manufacturer: "Ranbaxy Laboratories",
      dosageForm: DosageForm.CAPSULE,
      strength: "500mg",
      category: "Antibiotic",
      description: "Broad-spectrum penicillin antibiotic",
      prescriptionRequired: true,
      isActive: true,
    });

    sampleMedicine3 = await Medicine.create({
      name: "Metformin 500mg Tablet",
      genericName: "Metformin Hydrochloride",
      brandName: "Glyciphage",
      manufacturer: "Franco-Indian Pharmaceuticals",
      dosageForm: DosageForm.TABLET,
      strength: "500mg",
      category: "Antidiabetic",
      description: "First-line oral antidiabetic medication for Type 2 Diabetes",
      prescriptionRequired: true,
      isActive: true,
    });
  });

  // =========================================================================
  // Section 1: Public Catalog Search & Retrieval (Tests 1 - 7)
  // =========================================================================
  describe("1. Public Catalog Search & Discovery", () => {
    it("1. Public search matches medicines by name", async () => {
      const res = await request(app)
        .get("/api/v1/medicines")
        .query({ search: "Paracetamol" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe("Paracetamol 500mg Tablet");
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.page).toBe(1);
    });

    it("2. Public search matches medicines by generic chemical name", async () => {
      const res = await request(app)
        .get("/api/v1/medicines")
        .query({ genericName: "Amoxicillin" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].genericName).toBe("Amoxicillin Trihydrate");
    });

    it("3. Public search filters by category", async () => {
      const res = await request(app)
        .get("/api/v1/medicines")
        .query({ category: "Antibiotic" })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toContain("Amoxicillin");
    });

    it("4. Public search filters by dosage form", async () => {
      const res = await request(app)
        .get("/api/v1/medicines")
        .query({ dosageForm: DosageForm.CAPSULE })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].dosageForm).toBe(DosageForm.CAPSULE);
    });

    it("5. Public search filters by prescription-required status", async () => {
      // OTC / Non-prescription required
      const otcRes = await request(app)
        .get("/api/v1/medicines")
        .query({ prescriptionRequired: "false" })
        .expect(200);

      expect(otcRes.body.success).toBe(true);
      expect(otcRes.body.data.length).toBe(1);
      expect(otcRes.body.data[0].prescriptionRequired).toBe(false);

      // Prescription required
      const rxRes = await request(app)
        .get("/api/v1/medicines")
        .query({ prescriptionRequired: "true" })
        .expect(200);

      expect(rxRes.body.success).toBe(true);
      expect(rxRes.body.data.length).toBe(2);
      expect(rxRes.body.data.every((m: any) => m.prescriptionRequired === true)).toBe(true);
    });

    it("6. Public search supports combined filters, sorting, and pagination", async () => {
      const res = await request(app)
        .get("/api/v1/medicines")
        .query({
          dosageForm: DosageForm.TABLET,
          prescriptionRequired: "true",
          page: 1,
          limit: 10,
          sort: "name",
          order: "asc",
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe("Metformin 500mg Tablet");
      expect(res.body.meta).toMatchObject({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      });
    });

    it("7. Public search handles empty results and malformed parameters gracefully", async () => {
      // Empty results
      const emptyRes = await request(app)
        .get("/api/v1/medicines")
        .query({ search: "NonExistentDrugNameXYZ" })
        .expect(200);

      expect(emptyRes.body.success).toBe(true);
      expect(emptyRes.body.data).toEqual([]);
      expect(emptyRes.body.meta.total).toBe(0);

      // Malformed dosageForm enum returns 422
      const badEnumRes = await request(app)
        .get("/api/v1/medicines")
        .query({ dosageForm: "INVALID_FORM" })
        .expect(422);

      expect(badEnumRes.body.success).toBe(false);

      // Malformed prescriptionRequired returns 422
      const badBoolRes = await request(app)
        .get("/api/v1/medicines")
        .query({ prescriptionRequired: "not-a-bool" })
        .expect(422);

      expect(badBoolRes.body.success).toBe(false);
    });

    it("7b. Public single medicine retrieval by ID works and returns 404/400 appropriately", async () => {
      // Success retrieval
      const getRes = await request(app)
        .get(`/api/v1/medicines/${sampleMedicine1._id}`)
        .expect(200);

      expect(getRes.body.success).toBe(true);
      expect(getRes.body.data.name).toBe("Paracetamol 500mg Tablet");

      // Nonexistent ID returns 404
      const nonexistentId = new mongoose.Types.ObjectId().toString();
      const notFoundRes = await request(app)
        .get(`/api/v1/medicines/${nonexistentId}`)
        .expect(404);

      expect(notFoundRes.body.success).toBe(false);
      expect(notFoundRes.body.error.code).toBe("MEDICINE_NOT_FOUND");

      // Malformed ID returns 400
      const badIdRes = await request(app)
        .get("/api/v1/medicines/invalid-hex-id")
        .expect(400);

      expect(badIdRes.body.success).toBe(false);
    });
  });

  // =========================================================================
  // Section 2: Authorization & Administrative Catalog Management (Tests 8 - 14)
  // =========================================================================
  describe("2. Authorization & Catalog Administration", () => {
    const validCreatePayload = {
      name: "Ibuprofen 400mg Tablet",
      genericName: "Ibuprofen",
      brandName: "Brufen",
      manufacturer: "Abbott Healthcare",
      dosageForm: DosageForm.TABLET,
      strength: "400mg",
      category: "NSAID",
      description: "Non-steroidal anti-inflammatory drug",
      prescriptionRequired: false,
    };

    it("8. Unauthenticated requests cannot create medicines (HTTP 401)", async () => {
      const res = await request(app)
        .post("/api/v1/medicines")
        .send(validCreatePayload)
        .expect(401);

      expect(res.body.success).toBe(false);
    });

    it("9. Patient role cannot create medicines (HTTP 403)", async () => {
      const res = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${patientToken}`)
        .send(validCreatePayload)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("10. Doctor role cannot create medicines (HTTP 403)", async () => {
      const res = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${doctorToken}`)
        .send(validCreatePayload)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("11. Pharmacy role cannot create master medicines (HTTP 403)", async () => {
      const res = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .send(validCreatePayload)
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("12. Admin role can successfully create a valid master medicine (HTTP 201)", async () => {
      const res = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(validCreatePayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Ibuprofen 400mg Tablet");
      expect(res.body.data.manufacturer).toBe("Abbott Healthcare");

      // Verify persisted in DB
      const dbDoc = await Medicine.findById(res.body.data.id || res.body.data._id);
      expect(dbDoc).toBeDefined();
      expect(dbDoc?.genericName).toBe("Ibuprofen");
    });

    it("13. Only Admin can update a catalog entry (HTTP 200), non-admins are forbidden", async () => {
      const updatePayload = {
        description: "Updated clinical guidance and indications",
        category: "Pain Relief",
      };

      // Patient cannot PATCH
      await request(app)
        .patch(`/api/v1/medicines/${sampleMedicine1._id}`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send(updatePayload)
        .expect(403);

      // Doctor cannot PATCH
      await request(app)
        .patch(`/api/v1/medicines/${sampleMedicine1._id}`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send(updatePayload)
        .expect(403);

      // Pharmacy cannot PATCH
      await request(app)
        .patch(`/api/v1/medicines/${sampleMedicine1._id}`)
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .send(updatePayload)
        .expect(403);

      // Admin can PATCH successfully
      const adminRes = await request(app)
        .patch(`/api/v1/medicines/${sampleMedicine1._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send(updatePayload)
        .expect(200);

      expect(adminRes.body.success).toBe(true);
      expect(adminRes.body.data.category).toBe("Pain Relief");
      expect(adminRes.body.data.description).toBe(
        "Updated clinical guidance and indications"
      );

      // Verify in DB
      const updatedDoc = await Medicine.findById(sampleMedicine1._id);
      expect(updatedDoc?.category).toBe("Pain Relief");
    });

    it("14. Invalid payloads and disallowed fields are rejected with HTTP 422", async () => {
      // Missing required name
      const resMissingName = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          genericName: "Ibuprofen",
          manufacturer: "Abbott",
          dosageForm: DosageForm.TABLET,
        })
        .expect(422);

      expect(resMissingName.body.success).toBe(false);

      // Disallowed pharmacy inventory fields rejected by strict schema
      const resDisallowedField = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          ...validCreatePayload,
          quantity: 500, // Inventory field!
          price: 99.99,  // Inventory field!
        })
        .expect(422);

      expect(resDisallowedField.body.success).toBe(false);

      // Empty update body rejected
      const resEmptyUpdate = await request(app)
        .patch(`/api/v1/medicines/${sampleMedicine1._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({})
        .expect(422);

      expect(resEmptyUpdate.body.success).toBe(false);
    });
  });

  // =========================================================================
  // Section 3: Query Security & Data Integrity (Tests 15 - 20)
  // =========================================================================
  describe("3. Query Security & Data Integrity", () => {
    it("15. Regex metacharacters in search terms are escaped safely", async () => {
      // Searching with dangerous regex tokens should not throw ReDoS or crash
      const resDangerousRegex = await request(app)
        .get("/api/v1/medicines")
        .query({ search: ".*+?^${}()|[]\\" })
        .expect(200);

      expect(resDangerousRegex.body.success).toBe(true);
      expect(resDangerousRegex.body.data).toEqual([]);
    });

    it("16. MongoDB operator injection attempts are rejected or treated as harmless literal input", async () => {
      // If client attempts to pass MongoDB operator in search query
      const resInjection = await request(app)
        .get("/api/v1/medicines")
        .query({ search: '{"$gt": ""}' })
        .expect(200);

      expect(resInjection.body.success).toBe(true);
      // It must treat '{"$gt": ""}' as a literal string search, not execute a MongoDB operator
      expect(resInjection.body.data).toEqual([]);
    });

    it("17. Pagination limits are enforced and bounded (max 100 limit)", async () => {
      // Query limit over 100 rejected with 422
      const resExcessiveLimit = await request(app)
        .get("/api/v1/medicines")
        .query({ limit: 500 })
        .expect(422);

      expect(resExcessiveLimit.body.success).toBe(false);

      // Zero or negative page rejected with 422
      const resZeroPage = await request(app)
        .get("/api/v1/medicines")
        .query({ page: 0 })
        .expect(422);

      expect(resZeroPage.body.success).toBe(false);
    });

    it("18. Updating master catalog does not mutate already-issued prescription medication snapshots", async () => {
      // 1. Issue an existing prescription referencing sampleMedicine1
      const prescription = await Prescription.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        status: PrescriptionStatus.FINALIZED_ISSUED,
        diagnosis: "Acute Bronchitis",
        medicines: [
          {
            medicineId: sampleMedicine1._id,
            medicineName: "Paracetamol 500mg Tablet", // Immutable snapshot
            dosage: "500mg",
            frequency: "1-0-1",
            durationDays: 5,
            quantity: 10,
            route: MedicineRoute.ORAL,
          },
        ],
        expiresAt: new Date(Date.now() + 90 * 86400000),
      });

      // 2. Admin updates the master catalog entry name
      await request(app)
        .patch(`/api/v1/medicines/${sampleMedicine1._id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Paracetamol 650mg Extra Strength Tablet",
        })
        .expect(200);

      // 3. Verify that the issued prescription snapshot remains completely unchanged
      const freshPrescription = await Prescription.findById(prescription._id);
      expect(freshPrescription?.medicines[0].medicineName).toBe(
        "Paracetamol 500mg Tablet"
      );
      expect(freshPrescription?.medicines[0].dosage).toBe("500mg");
    });

    it("19. Audit log failure does not cause catalog creation or update to fail (fail-safe)", async () => {
      const auditSpy = vi
        .spyOn(auditLogService, "log")
        .mockRejectedValueOnce(new Error("Simulated audit database connection timeout"));

      const res = await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Cetirizine 10mg Tablet",
          genericName: "Cetirizine Hydrochloride",
          manufacturer: "Dr. Reddy's",
          dosageForm: DosageForm.TABLET,
          prescriptionRequired: false,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Cetirizine 10mg Tablet");

      auditSpy.mockRestore();
    });

    it("20. Audit log records ADMIN_ACTION for successful catalog mutations", async () => {
      await request(app)
        .post("/api/v1/medicines")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Azithromycin 500mg Tablet",
          genericName: "Azithromycin",
          manufacturer: "Cipla Ltd",
          dosageForm: DosageForm.TABLET,
          prescriptionRequired: true,
        })
        .expect(201);

      // Verify audit entry in database
      const auditEntry = await AuditLog.findOne({
        action: AuditAction.ADMIN_ACTION,
        resourceType: "Medicine",
      });

      expect(auditEntry).toBeDefined();
      expect(auditEntry?.actorRole).toBe(UserRole.ADMIN);
      expect(auditEntry?.metadata?.operation).toBe("CREATE_MEDICINE");
      expect(auditEntry?.metadata?.medicineName).toBe(
        "Azithromycin 500mg Tablet"
      );
    });
  });
});
