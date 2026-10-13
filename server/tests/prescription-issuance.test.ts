import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  PatientProfile,
  Appointment,
  Consultation,
  Prescription,
  AuditLog,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  AppointmentStatus,
  ConsultationStatus,
  ConsultationType,
  PrescriptionStatus,
  MedicineRoute,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  computePrescriptionDigest,
  calculatePrescriptionExpiry,
  prescriptionService,
} from "../src/services/prescription.service.js";

describe("Milestone 9 - Task 9.3: Digital Prescription Builder & Cryptographic Issuance", () => {
  let verifiedDoctorUser: any;
  let verifiedDoctorToken: string;

  let unverifiedDoctorUser: any;
  let unverifiedDoctorToken: string;

  let otherDoctorUser: any;
  let otherDoctorToken: string;

  let patientUser: any;
  let patientToken: string;

  let otherPatientUser: any;
  let otherPatientToken: string;

  let adminUser: any;
  let adminToken: string;

  let pharmacyUser: any;
  let pharmacyToken: string;

  let testAppointment: any;
  let testConsultation: any;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_prescription_issuance_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PatientProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Consultation.syncIndexes();
    await Prescription.syncIndexes();
    await AuditLog.syncIndexes();
  }, 30000);

  afterAll(async () => {
    await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    await DoctorProfile.deleteMany({});
    await PatientProfile.deleteMany({});
    await Appointment.deleteMany({});
    await Consultation.deleteMany({});
    await Prescription.deleteMany({});
    await AuditLog.deleteMany({});
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Prescription.deleteMany({});
    await Consultation.deleteMany({});
    await Appointment.deleteMany({});
    await AuditLog.deleteMany({});
    await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    await DoctorProfile.deleteMany({});
    await PatientProfile.deleteMany({});

    // 1. Verified Attending Doctor
    verifiedDoctorUser = await User.create({
      email: "doctor.verified.m93@example.com",
      phone: "+919876540101",
      fullName: "Dr. Verified Attending",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    verifiedDoctorToken = tokenService.generateAccessToken(
      verifiedDoctorUser._id.toString(),
      UserRole.DOCTOR
    );
    await DoctorProfile.create({
      userId: verifiedDoctorUser._id,
      specialization: "General Medicine",
      qualifications: ["MBBS", "MD"],
      registrationNumber: "DOC-REG-M93-001",
      registrationCouncil: "Medical Council of India",
      experienceYears: 10,
      consultationFee: 750,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    // 2. Unverified Doctor
    unverifiedDoctorUser = await User.create({
      email: "doctor.unverified.m93@example.com",
      phone: "+919876540102",
      fullName: "Dr. Unverified Novice",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    unverifiedDoctorToken = tokenService.generateAccessToken(
      unverifiedDoctorUser._id.toString(),
      UserRole.DOCTOR
    );
    await DoctorProfile.create({
      userId: unverifiedDoctorUser._id,
      specialization: "Cardiology",
      qualifications: ["MBBS"],
      registrationNumber: "DOC-REG-M93-002",
      registrationCouncil: "Medical Council",
      experienceYears: 2,
      consultationFee: 600,
      verificationStatus: DoctorVerificationStatus.PENDING_REVIEW,
    });

    // 3. Other Doctor (Verified, but unassigned)
    otherDoctorUser = await User.create({
      email: "doctor.other.m93@example.com",
      phone: "+919876540103",
      fullName: "Dr. Other Clinician",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherDoctorToken = tokenService.generateAccessToken(
      otherDoctorUser._id.toString(),
      UserRole.DOCTOR
    );
    await DoctorProfile.create({
      userId: otherDoctorUser._id,
      specialization: "Orthopedics",
      qualifications: ["MBBS", "MS"],
      registrationNumber: "DOC-REG-M93-003",
      registrationCouncil: "Medical Council",
      experienceYears: 7,
      consultationFee: 800,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    // 4. Patient User
    patientUser = await User.create({
      email: "patient.m93@example.com",
      phone: "+919876540104",
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
    await PatientProfile.create({
      userId: patientUser._id,
      dateOfBirth: new Date("1992-05-15"),
      gender: "FEMALE",
      bloodGroup: "A+",
      allergies: ["Penicillin"],
      chronicConditions: ["Asthma"],
    });

    // 5. Other Patient User
    otherPatientUser = await User.create({
      email: "patient.other.m93@example.com",
      phone: "+919876540105",
      fullName: "Bob Other",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherPatientToken = tokenService.generateAccessToken(
      otherPatientUser._id.toString(),
      UserRole.PATIENT
    );

    // 6. Admin User
    adminUser = await User.create({
      email: "admin.m93@example.com",
      phone: "+919876540106",
      fullName: "System Admin",
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

    // 7. Pharmacy User
    pharmacyUser = await User.create({
      email: "pharmacy.m93@example.com",
      phone: "+919876540107",
      fullName: "Apollo Pharmacy",
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

    // Setup active Appointment & Consultation
    const now = Date.now();
    testAppointment = await Appointment.create({
      doctorId: verifiedDoctorUser._id,
      patientId: patientUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(now - 15 * 60 * 1000),
      scheduledEnd: new Date(now + 15 * 60 * 1000),
      fee: 750,
      currency: "INR",
      reason: "Persistent throat soreness and fever",
      status: AppointmentStatus.IN_PROGRESS,
      paymentStatus: "PAID",
    });

    testConsultation = await Consultation.create({
      appointmentId: testAppointment._id,
      patientId: patientUser._id,
      doctorId: verifiedDoctorUser._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.IN_CONSULTATION,
      roomId: `room_${testAppointment._id}`,
      startedAt: new Date(now - 10 * 60 * 1000),
    });
  });

  const validMedicationPayload = {
    medicines: [
      {
        medicineId: new mongoose.Types.ObjectId().toString(),
        medicineName: "Amoxicillin-Clavulanate 625mg",
        dosage: "625mg",
        frequency: "1-0-1 (After food)",
        durationDays: 7,
        quantity: 14,
        route: "ORAL",
        specialInstructions: "Take with food to prevent gastric irritation",
      },
      {
        medicineId: new mongoose.Types.ObjectId().toString(),
        medicineName: "Paracetamol 650mg",
        dosage: "650mg",
        frequency: "1-1-1 (SOS fever)",
        durationDays: 3,
        quantity: 10,
        route: "ORAL",
      },
    ],
    diagnosis: "Acute Streptococcal Pharyngitis",
    additionalNotes: "Rest, warm saline gargles 3 times daily, plenty of fluids.",
  };

  // =========================================================================
  // Section 1: Successful Issuance, Snapshots & 90-Day Validity (Tests 1 - 5)
  // =========================================================================
  describe("1. Prescription Issuance, Medication Snapshots & Expiry Calculation", () => {
    it("1. A verified attending doctor can successfully issue a digital prescription", async () => {
      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          consultationId: testConsultation._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(PrescriptionStatus.FINALIZED_ISSUED);
      expect(res.body.data.diagnosis).toBe("Acute Streptococcal Pharyngitis");
      expect(res.body.data.medicines).toHaveLength(2);

      // Verify DB persistence
      const saved = await Prescription.findById(res.body.data.id || res.body.data._id);
      expect(saved).not.toBeNull();
      expect(saved!.status).toBe(PrescriptionStatus.FINALIZED_ISSUED);
      expect(saved!.doctorId.toString()).toBe(verifiedDoctorUser._id.toString());
      expect(saved!.patientId.toString()).toBe(patientUser._id.toString());
    });

    it("2. Medication details are persisted as immutable point-in-time snapshots", async () => {
      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      const med1 = res.body.data.medicines[0];
      expect(med1.medicineName).toBe("Amoxicillin-Clavulanate 625mg");
      expect(med1.dosage).toBe("625mg");
      expect(med1.frequency).toBe("1-0-1 (After food)");
      expect(med1.durationDays).toBe(7);
      expect(med1.quantity).toBe(14);
      expect(med1.route).toBe(MedicineRoute.ORAL);
      expect(med1.specialInstructions).toBe(
        "Take with food to prevent gastric irritation"
      );

      const med2 = res.body.data.medicines[1];
      expect(med2.medicineName).toBe("Paracetamol 650mg");
      expect(med2.durationDays).toBe(3);
    });

    it("3. issuedAt is strictly server-controlled and cannot be spoofed by client payload", async () => {
      const beforeTime = new Date().getTime();

      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          issuedAt: new Date("2020-01-01T00:00:00.000Z"), // Client spoof attempt
          status: "DRAFT", // Client spoof attempt
          doctorId: otherDoctorUser._id.toString(), // Client spoof attempt
          patientId: otherPatientUser._id.toString(), // Client spoof attempt
          ...validMedicationPayload,
        });

      // Zod strict schema rejects unknown/privileged keys
      expect(res.status).toBe(422);

      // Normal request without spoofed fields
      const validRes = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      const afterTime = new Date().getTime();
      const serverIssuedAt = new Date(validRes.body.data.issuedAt).getTime();
      expect(serverIssuedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(serverIssuedAt).toBeLessThanOrEqual(afterTime);
    });

    it("4. expiresAt is calculated as exactly 90 calendar days in UTC across month and year boundaries", () => {
      // Test standard date
      const standardDate = new Date("2026-10-13T12:00:00.000Z");
      const expiry1 = calculatePrescriptionExpiry(standardDate);
      // 90 calendar days = 90 * 24 * 60 * 60 * 1000 ms
      const diffMs1 = expiry1.getTime() - standardDate.getTime();
      expect(diffMs1).toBe(90 * 24 * 60 * 60 * 1000);
      expect(expiry1.toISOString()).toBe("2027-01-11T12:00:00.000Z");

      // Test leap year boundary (Jan 1, 2028 -> leap year)
      const leapYearDate = new Date("2028-01-01T00:00:00.000Z");
      const expiryLeap = calculatePrescriptionExpiry(leapYearDate);
      expect(expiryLeap.getTime() - leapYearDate.getTime()).toBe(
        90 * 24 * 60 * 60 * 1000
      );
      expect(expiryLeap.toISOString()).toBe("2028-03-31T00:00:00.000Z");
    });

    it("5. Prescription document transitions atomically to FINALIZED_ISSUED and links consultation", async () => {
      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      expect(res.body.data.status).toBe(PrescriptionStatus.FINALIZED_ISSUED);

      // Verify consultation links back to prescription
      const updatedConsultation = await Consultation.findById(testConsultation._id);
      expect(updatedConsultation?.prescriptionId?.toString()).toBe(
        res.body.data.id || res.body.data._id
      );
    });
  });

  // =========================================================================
  // Section 2: Authorization & Encounter Eligibility (Tests 6 - 8)
  // =========================================================================
  describe("2. Zero-Trust Authorization & Consultation Eligibility", () => {
    it("6. An unverified doctor cannot issue prescriptions (HTTP 403)", async () => {
      // Setup appointment for unverified doctor
      const unverifiedAppointment = await Appointment.create({
        doctorId: unverifiedDoctorUser._id,
        patientId: patientUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 30 * 60 * 1000),
        fee: 600,
        currency: "INR",
        reason: "Cardio check",
        status: AppointmentStatus.IN_PROGRESS,
        paymentStatus: "PAID",
      });

      await Consultation.create({
        appointmentId: unverifiedAppointment._id,
        patientId: patientUser._id,
        doctorId: unverifiedDoctorUser._id,
        consultationType: ConsultationType.VIDEO,
        status: ConsultationStatus.IN_CONSULTATION,
        roomId: `room_${unverifiedAppointment._id}`,
      });

      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${unverifiedDoctorToken}`)
        .send({
          appointmentId: unverifiedAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
      expect(res.body.error.message).toContain("unverified");
    });

    it("7. A doctor not assigned to the consultation cannot issue prescriptions (HTTP 403)", async () => {
      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${otherDoctorToken}`) // Verified doctor, but unassigned
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(403);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
      expect(res.body.error.message).toContain("not the attending doctor");
    });

    it("8. Ineligible consultations (SCHEDULED, CANCELLED, or missing) are rejected", async () => {
      // 8a: Missing appointment returns 404
      const fakeId = new mongoose.Types.ObjectId().toString();
      const resMissing = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: fakeId,
          ...validMedicationPayload,
        })
        .expect(404);
      expect(resMissing.body.error.code).toBe("APPOINTMENT_NOT_FOUND");

      // 8b: Cancelled appointment returns 409
      const cancelledAppointment = await Appointment.create({
        doctorId: verifiedDoctorUser._id,
        patientId: patientUser._id,
        appointmentType: ConsultationType.VIDEO,
        scheduledStart: new Date(),
        scheduledEnd: new Date(Date.now() + 30 * 60 * 1000),
        fee: 750,
        currency: "INR",
        reason: "Checkup",
        status: AppointmentStatus.CANCELLED,
        paymentStatus: "PAID",
      });
      await Consultation.create({
        appointmentId: cancelledAppointment._id,
        patientId: patientUser._id,
        doctorId: verifiedDoctorUser._id,
        consultationType: ConsultationType.VIDEO,
        status: ConsultationStatus.ROOM_OPENED,
        roomId: "room_cancelled",
      });

      const resCancelled = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: cancelledAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(409);
      expect(resCancelled.body.error.code).toBe("APPOINTMENT_INELIGIBLE");

      // 8c: SCHEDULED consultation returns 409
      testConsultation.status = ConsultationStatus.SCHEDULED;
      await testConsultation.save();

      const resScheduled = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(409);
      expect(resScheduled.body.error.code).toBe("CONSULTATION_NOT_STARTED");
    });
  });

  // =========================================================================
  // Section 3: Input Validation & Sanitization (Tests 9 - 10)
  // =========================================================================
  describe("3. Input Validation & Parameter Sanitization", () => {
    it("9. Invalid medication payloads are rejected with HTTP 422", async () => {
      // Empty medicines array
      const resEmpty = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          diagnosis: "Pharyngitis",
          medicines: [],
        })
        .expect(422);
      expect(resEmpty.body.success).toBe(false);

      // DurationDays <= 0
      const resZeroDuration = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          diagnosis: "Pharyngitis",
          medicines: [
            {
              medicineId: new mongoose.Types.ObjectId().toString(),
              medicineName: "Amoxicillin",
              dosage: "500mg",
              frequency: "1-0-1",
              durationDays: 0,
            },
          ],
        })
        .expect(422);
      expect(resZeroDuration.body.success).toBe(false);

      // Invalid medicineId hex ObjectId
      const resBadId = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          diagnosis: "Pharyngitis",
          medicines: [
            {
              medicineId: "invalid-not-an-objectid",
              medicineName: "Amoxicillin",
              dosage: "500mg",
              frequency: "1-0-1",
              durationDays: 5,
            },
          ],
        })
        .expect(422);
      expect(resBadId.body.success).toBe(false);
    });

    it("10. Non-doctor roles (Patient, Pharmacy, Admin) cannot issue prescriptions", async () => {
      // Patient cannot POST /prescriptions
      await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(403);

      // Pharmacy cannot POST /prescriptions
      await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(403);

      // Admin cannot issue prescriptions (OWN Verified Doctor only)
      await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(403);
    });
  });

  // =========================================================================
  // Section 4: Immutability & Concurrency (Tests 11 - 12)
  // =========================================================================
  describe("4. Prescription Immutability & Concurrency Protection", () => {
    it("11. An issued prescription cannot be edited; mutation attempts return HTTP 409", async () => {
      const issueRes = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      const prescriptionId = issueRes.body.data.id || issueRes.body.data._id;

      // PATCH attempt returns 409
      const patchRes = await request(app)
        .patch(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          diagnosis: "Modified diagnosis attempt",
        })
        .expect(409);

      expect(patchRes.body.success).toBe(false);
      expect(patchRes.body.error.code).toBe("PRESCRIPTION_IMMUTABLE");

      // PUT attempt returns 409
      const putRes = await request(app)
        .put(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          diagnosis: "Replaced diagnosis attempt",
        })
        .expect(409);

      expect(putRes.body.success).toBe(false);
      expect(putRes.body.error.code).toBe("PRESCRIPTION_IMMUTABLE");
    });

    it("12. Concurrent or repeated issuance on the same consultation is rejected with HTTP 409", async () => {
      // First issuance succeeds
      await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      // Second issuance attempt on same consultation must return 409 RESOURCE_CONFLICT
      const resDup = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(409);

      expect(resDup.body.success).toBe(false);
      expect(resDup.body.error.code).toBe("RESOURCE_CONFLICT");
    });
  });

  // =========================================================================
  // Section 5: Events, Auditing & Integrity (Tests 13 - 17)
  // =========================================================================
  describe("5. Events, Audit Trails & Cryptographic Integrity", () => {
    it("13. Audit log records PRESCRIPTION_ISSUED action with safe metadata", async () => {
      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      const prescriptionId = res.body.data.id || res.body.data._id;

      const auditRecord = await AuditLog.findOne({
        action: AuditAction.PRESCRIPTION_ISSUED,
        resourceId: prescriptionId,
      });

      expect(auditRecord).not.toBeNull();
      expect(auditRecord!.actorId.toString()).toBe(verifiedDoctorUser._id.toString());
      expect(auditRecord!.actorRole).toBe("DOCTOR");
      expect(auditRecord!.patientId?.toString()).toBe(patientUser._id.toString());
      expect(auditRecord!.status).toBe("SUCCESS");

      // Verify no sensitive tokens or raw clinical payloads are dumped in audit
      expect(auditRecord!.metadata).not.toHaveProperty("diagnosis");
      expect(auditRecord!.metadata).not.toHaveProperty("rawContent");
    });

    it("14. Prescriptions store a deterministic canonical SHA-256 integrity checksum", async () => {
      const res = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      const saved = await Prescription.findById(res.body.data.id || res.body.data._id);
      expect(saved?.integrityChecksum).toBeDefined();
      expect(typeof saved?.integrityChecksum).toBe("string");
      expect(saved?.integrityChecksum).toHaveLength(64); // SHA-256 hex length
    });

    it("15. Tampering with any medication or clinical field alters the computed digest", () => {
      const payloadOriginal = {
        patientId: patientUser._id.toString(),
        doctorId: verifiedDoctorUser._id.toString(),
        appointmentId: testAppointment._id.toString(),
        consultationId: testConsultation._id.toString(),
        diagnosis: "Acute Bronchitis",
        medicines: [
          {
            medicineId: new mongoose.Types.ObjectId().toString(),
            medicineName: "Azithromycin 500mg",
            dosage: "500mg",
            frequency: "1-0-0",
            durationDays: 3,
            quantity: 3,
            route: "ORAL",
          },
        ],
        issuedAt: new Date("2026-10-13T10:00:00.000Z"),
        expiresAt: new Date("2027-01-11T10:00:00.000Z"),
      };

      const digestOriginal = computePrescriptionDigest(payloadOriginal);

      // Tamper with dosage (e.g. 500mg -> 1000mg)
      const payloadTampered = {
        ...payloadOriginal,
        medicines: [
          {
            ...payloadOriginal.medicines[0],
            dosage: "1000mg", // Tampered
          },
        ],
      };

      const digestTampered = computePrescriptionDigest(payloadTampered);

      expect(digestOriginal).not.toBe(digestTampered);
    });

    it("16. Prescription retrieval enforces zero-trust role access (GET /api/v1/prescriptions/:id)", async () => {
      const issueRes = await request(app)
        .post("/api/v1/prescriptions")
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .send({
          appointmentId: testAppointment._id.toString(),
          ...validMedicationPayload,
        })
        .expect(201);

      const prescriptionId = issueRes.body.data.id || issueRes.body.data._id;

      // 1. Patient owner can retrieve
      const patientRes = await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${patientToken}`)
        .expect(200);
      expect(patientRes.body.success).toBe(true);

      // 2. Issuing doctor can retrieve
      const doctorRes = await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${verifiedDoctorToken}`)
        .expect(200);
      expect(doctorRes.body.success).toBe(true);

      // 3. Pharmacy can retrieve
      const pharmacyRes = await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${pharmacyToken}`)
        .expect(200);
      expect(pharmacyRes.body.success).toBe(true);

      // 4. Admin can retrieve
      const adminRes = await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
      expect(adminRes.body.success).toBe(true);

      // 5. Unrelated patient CANNOT retrieve (403)
      await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${otherPatientToken}`)
        .expect(403);

      // 6. Unassigned doctor CANNOT retrieve (403)
      await request(app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .expect(403);
    });
  });
});
