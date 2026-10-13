import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { app } from "../src/app.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  User,
  DoctorProfile,
  Appointment,
  Consultation,
  Notification,
  AuditLog,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  ConsultationType,
  AppointmentStatus,
  ConsultationStatus,
  NotificationType,
  AuditAction,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { consultationService } from "../src/services/consultation.service.js";

describe("Milestone 8 - Task 8.1: Consultation Lifecycle Management", () => {
  let patientUser: any;
  let patientToken: string;
  let otherPatientUser: any;
  let otherPatientToken: string;

  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  let otherDoctorUser: any;
  let otherDoctorProfile: any;
  let otherDoctorToken: string;

  let adminUser: any;
  let adminToken: string;

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_consultation_lifecycle_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Consultation.syncIndexes();
    await Notification.syncIndexes();
    await AuditLog.syncIndexes();
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
    await Appointment.deleteMany({});
    await Consultation.deleteMany({});
    await Notification.deleteMany({});
    await AuditLog.deleteMany({});

    // 1. Patient User
    patientUser = await User.create({
      email: "patient.m8@example.com",
      phone: "+919876540001",
      fullName: "Patient One",
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

    // 2. Other Patient User
    otherPatientUser = await User.create({
      email: "patient.other.m8@example.com",
      phone: "+919876540002",
      fullName: "Patient Two",
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

    // 3. Attending Doctor User & Verified Profile
    doctorUser = await User.create({
      email: "doctor.m8@example.com",
      phone: "+919876540003",
      fullName: "Dr. Gregory House",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "Infectious Disease",
      qualifications: ["MD", "MBBS"],
      registrationNumber: "REG-DOC-M8-001",
      registrationCouncil: "Medical Council of India",
      experienceYears: 15,
      consultationFee: 1000,
      consultationTypes: [ConsultationType.VIDEO],
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      isAvailableForInstantConsultation: true,
      languages: ["English"],
    });
    doctorToken = tokenService.generateAccessToken(
      doctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 4. Other Doctor User & Verified Profile
    otherDoctorUser = await User.create({
      email: "doctor.other.m8@example.com",
      phone: "+919876540004",
      fullName: "Dr. James Wilson",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherDoctorProfile = await DoctorProfile.create({
      userId: otherDoctorUser._id,
      specialization: "Oncology",
      qualifications: ["MD", "MBBS"],
      registrationNumber: "REG-DOC-M8-002",
      registrationCouncil: "Medical Council of India",
      experienceYears: 12,
      consultationFee: 1200,
      consultationTypes: [ConsultationType.VIDEO],
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
      isAvailableForInstantConsultation: true,
      languages: ["English"],
    });
    otherDoctorToken = tokenService.generateAccessToken(
      otherDoctorUser._id.toString(),
      UserRole.DOCTOR
    );

    // 5. Admin User
    adminUser = await User.create({
      email: "admin.m8@example.com",
      phone: "+919876540005",
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
  });

  // Helper function to create an eligible paid appointment
  async function createEligibleAppointment(overrides: Partial<any> = {}) {
    const now = Date.now();
    return await Appointment.create({
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(now + 15 * 60 * 1000), // starts in 15 min (within 1-hr window)
      scheduledEnd: new Date(now + 45 * 60 * 1000),   // ends in 45 min
      status: AppointmentStatus.CONFIRMED,
      paymentStatus: "PAID",
      reason: "Clinical follow-up consultation",
      fee: 1000,
      currency: "INR",
      ...overrides,
    });
  }

  describe("1. Room Initialization & Appointment Window Constraints", () => {
    it("rejects doctor room initialization more than one hour before scheduled start", async () => {
      // Scheduled to start in 2 hours (> 1 hour away)
      const futureStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const futureEnd = new Date(Date.now() + 2.5 * 60 * 60 * 1000);

      const appt = await createEligibleAppointment({
        scheduledStart: futureStart,
        scheduledEnd: futureEnd,
      });

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CONSULTATION_WINDOW_NOT_REACHED");
      expect(res.body.error.message).toMatch(/more than one hour prior/i);
    });

    it("allows authorized assigned doctor to initialize room within the permitted 1-hour window", async () => {
      // Starts in 20 minutes (within 1 hour)
      const appt = await createEligibleAppointment();

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.consultationId).toBeDefined();
      expect(res.body.data.roomId).toBe(`consultation-${appt._id}`);
      expect(res.body.data.roomUrl).toBe(`/consultations/room/consultation-${appt._id}`);
      expect(res.body.data.status).toBe(ConsultationStatus.ROOM_OPENED);
      expect(res.body.data.token).toBeDefined();

      // Parent appointment transitions to IN_PROGRESS and links consultationId
      const updatedAppt = await Appointment.findById(appt._id);
      expect(updatedAppt?.status).toBe(AppointmentStatus.IN_PROGRESS);
      expect(updatedAppt?.consultationId?.toString()).toBe(res.body.data.consultationId);
    });

    it("rejects room initialization after scheduled appointment end time has expired", async () => {
      const pastStart = new Date(Date.now() - 60 * 60 * 1000);
      const pastEnd = new Date(Date.now() - 10 * 60 * 1000); // Ended 10 min ago

      const appt = await createEligibleAppointment({
        scheduledStart: pastStart,
        scheduledEnd: pastEnd,
      });

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CONSULTATION_WINDOW_EXPIRED");
    });

    it("rejects room initialization for unpaid appointments", async () => {
      const appt = await createEligibleAppointment({
        paymentStatus: "UNPAID",
      });

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(402);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("PAYMENT_REQUIRED");
    });

    it("rejects room initialization for cancelled appointments", async () => {
      const appt = await createEligibleAppointment({
        status: AppointmentStatus.CANCELLED,
      });

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("rejects room initialization for rejected appointments", async () => {
      const appt = await createEligibleAppointment({
        status: AppointmentStatus.REJECTED,
      });

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");
    });

    it("rejects room initialization for already completed appointments", async () => {
      const appt = await createEligibleAppointment({
        status: AppointmentStatus.COMPLETED,
      });

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("APPOINTMENT_ALREADY_COMPLETED");
    });

    it("rejects room initialization if doctor profile is not approved", async () => {
      await DoctorProfile.updateOne(
        { userId: doctorUser._id },
        { $set: { verificationStatus: DoctorVerificationStatus.PENDING_REVIEW } }
      );

      const appt = await createEligibleAppointment();

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("DOCTOR_NOT_VERIFIED");
    });
  });

  describe("2. Security & Participant Authorization", () => {
    it("unassigned doctor cannot initialize room for another doctor's appointment", async () => {
      const appt = await createEligibleAppointment();

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${otherDoctorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("unassigned doctor cannot view another doctor's consultation", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      const res = await request(app)
        .get(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${otherDoctorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("unrelated patient cannot access another patient's consultation", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      const res = await request(app)
        .get(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${otherPatientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("authorized assigned doctor and patient can both view their consultation details", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // Doctor view
      const docRes = await request(app)
        .get(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(docRes.status).toBe(200);
      expect(docRes.body.data.roomId).toBe(`consultation-${appt._id}`);

      // Patient view
      const patRes = await request(app)
        .get(`/api/v1/consultations/${consultationId}`)
        .set("Authorization", `Bearer ${patientToken}`);
      expect(patRes.status).toBe(200);
      expect(patRes.body.data.roomId).toBe(`consultation-${appt._id}`);
    });

    it("unassigned doctor cannot edit clinical notes or diagnosis", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // End session first
      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      const res = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${otherDoctorToken}`)
        .send({
          diagnosis: "Acute Bronchitis",
          clinicalNotes: "Patient presents with cough and mild fever.",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
    });

    it("patient cannot initialize rooms or submit clinical notes", async () => {
      const appt = await createEligibleAppointment();

      // Patient cannot initialize room
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${patientToken}`);
      expect(initRes.status).toBe(403);
      expect(initRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");

      // Doctor initializes room and ends it
      const docInit = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = docInit.body.data.consultationId;

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      // Patient cannot submit clinical notes
      const notesRes = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${patientToken}`)
        .send({
          diagnosis: "Self-Diagnosis",
          clinicalNotes: "Patient notes should not be accepted.",
        });
      expect(notesRes.status).toBe(403);
      expect(notesRes.body.error.code).toBe("AUTH_INSUFFICIENT_PERMISSIONS");
    });

    it("unauthenticated requests are rejected with 401 AUTH_TOKEN_MISSING", async () => {
      const appt = await createEligibleAppointment();

      const res = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });
  });

  describe("3. Idempotency & Concurrency Protections", () => {
    it("duplicate requests return existing consultation room without duplicate records", async () => {
      const appt = await createEligibleAppointment();

      // First call: creates record
      const res1 = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(res1.status).toBe(200);

      // Second call: idempotent return
      const res2 = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(res2.status).toBe(200);
      expect(res2.body.data.consultationId).toBe(res1.body.data.consultationId);
      expect(res2.body.data.roomId).toBe(res1.body.data.roomId);

      // Verify only 1 Consultation document was created in the database
      const count = await Consultation.countDocuments({ appointmentId: appt._id });
      expect(count).toBe(1);
    });

    it("concurrent initialization requests safely yield a single consultation record", async () => {
      const appt = await createEligibleAppointment();

      // Fire 3 simultaneous initialization requests
      const [r1, r2, r3] = await Promise.all([
        request(app)
          .post(`/api/v1/consultations/${appt._id}/session`)
          .set("Authorization", `Bearer ${doctorToken}`),
        request(app)
          .post(`/api/v1/consultations/${appt._id}/session`)
          .set("Authorization", `Bearer ${doctorToken}`),
        request(app)
          .post(`/api/v1/consultations/${appt._id}/session`)
          .set("Authorization", `Bearer ${doctorToken}`),
      ]);

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);

      expect(r1.body.data.consultationId).toBe(r2.body.data.consultationId);
      expect(r2.body.data.consultationId).toBe(r3.body.data.consultationId);

      const count = await Consultation.countDocuments({ appointmentId: appt._id });
      expect(count).toBe(1);
    });
  });

  describe("4. Participant Token & Real-Time Transitions", () => {
    it("patient retrieves token via GET /:id/token and transitions status from ROOM_OPENED to IN_CONSULTATION", async () => {
      const appt = await createEligibleAppointment();

      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // Patient joins room
      const tokenRes = await request(app)
        .get(`/api/v1/consultations/${consultationId}/token`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.data.token).toBeDefined();
      expect(tokenRes.body.data.expiresInSeconds).toBe(3600);
      expect(tokenRes.body.data.status).toBe(ConsultationStatus.IN_CONSULTATION);

      const updated = await Consultation.findById(consultationId);
      expect(updated?.status).toBe(ConsultationStatus.IN_CONSULTATION);
    });

    it("rejects token retrieval if consultation has not been initiated by doctor", async () => {
      const appt = await createEligibleAppointment();

      // Create a Consultation document in SCHEDULED status directly
      const schedConsultation = await Consultation.create({
        appointmentId: appt._id,
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        consultationType: ConsultationType.VIDEO,
        status: ConsultationStatus.SCHEDULED,
        roomId: `consultation-${appt._id}`,
      });

      const res = await request(app)
        .get(`/api/v1/consultations/${schedConsultation._id}/token`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONSULTATION_NOT_STARTED");
    });

    it("rejects token retrieval if consultation session is closed or completed", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // End session
      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      const res = await request(app)
        .get(`/api/v1/consultations/${consultationId}/token`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONSULTATION_SESSION_CLOSED");
    });
  });

  describe("5. Call Ending, Lifecycle State Guards & Clinical Notes Submission", () => {
    it("authorized participant can end call via POST /:id/end and record total duration", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      const endRes = await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      expect(endRes.status).toBe(200);
      expect(endRes.body.data.status).toBe(ConsultationStatus.ENDED);
      expect(endRes.body.data.endedAt).toBeDefined();

      const updated = await Consultation.findById(consultationId);
      expect(updated?.status).toBe(ConsultationStatus.ENDED);
    });

    it("submitting clinical documentation is REJECTED when consultation is not in ENDED state", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // Still in ROOM_OPENED state
      const res = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Viral Pharyngitis",
          clinicalNotes: "Throat erythema observed; prescribed supportive care.",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONSULTATION_INVALID_TRANSITION");
      expect(res.body.error.message).toMatch(/call must be ended first/i);
    });

    it("assigned doctor can submit clinical notes when consultation is in ENDED state, completing both consultation and appointment", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // 1. End session
      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      // 2. Submit notes
      const res = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Seasonal Allergic Rhinitis",
          clinicalNotes: "Patient reported nasal congestion and sneezing for 3 days.",
          recommendedFollowUpDays: 7,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ConsultationStatus.COMPLETED);
      expect(res.body.data.diagnosis).toBe("Seasonal Allergic Rhinitis");
      expect(res.body.data.clinicalNotes).toBe("Patient reported nasal congestion and sneezing for 3 days.");
      expect(res.body.data.recommendedFollowUpDays).toBe(7);
      expect(res.body.data.prescriptionUnlocked).toBe(true);

      // Verify Consultation document in DB
      const updatedConsult = await Consultation.findById(consultationId);
      expect(updatedConsult?.status).toBe(ConsultationStatus.COMPLETED);

      // Verify parent Appointment document transitioned to COMPLETED
      const updatedAppt = await Appointment.findById(appt._id);
      expect(updatedAppt?.status).toBe(AppointmentStatus.COMPLETED);
    });

    it("rejects post-completion edits to clinical documentation (immutable)", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // End and complete
      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Initial Diagnosis",
          clinicalNotes: "Initial clinical notes.",
        });

      // Attempt to edit post-completion
      const res = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Altered Diagnosis",
          clinicalNotes: "Attempted tampering after finalization.",
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONSULTATION_ALREADY_COMPLETED");
      expect(res.body.error.message).toMatch(/finalized and immutable/i);
    });

    it("rejects invalid request payloads with 422 VALIDATION_ERROR", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      // 1. Diagnosis too short (< 3 chars)
      const resShortDiag = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "AB",
          clinicalNotes: "Valid clinical notes.",
        });
      expect(resShortDiag.status).toBe(422);
      expect(resShortDiag.body.error.code).toBe("VALIDATION_ERROR");

      // 2. Clinical notes too short (< 5 chars)
      const resShortNotes = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Valid Diagnosis",
          clinicalNotes: "Nope",
        });
      expect(resShortNotes.status).toBe(422);
      expect(resShortNotes.body.error.code).toBe("VALIDATION_ERROR");

      // 3. Negative recommended follow-up days
      const resNegDays = await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Valid Diagnosis",
          clinicalNotes: "Valid clinical notes text.",
          recommendedFollowUpDays: -5,
        });
      expect(resNegDays.status).toBe(422);
      expect(resNegDays.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects malformed ObjectId path parameters with 400 BAD_REQUEST", async () => {
      const res1 = await request(app)
        .post("/api/v1/consultations/invalid-hex-id/session")
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(res1.status).toBe(400);
      expect(res1.body.error.code).toBe("BAD_REQUEST");

      const res2 = await request(app)
        .get("/api/v1/consultations/not-a-valid-object-id")
        .set("Authorization", `Bearer ${doctorToken}`);
      expect(res2.status).toBe(400);
      expect(res2.body.error.code).toBe("BAD_REQUEST");
    });
  });

  describe("6. Prescription Unlock & Audit Logging", () => {
    it("consultation completion unlocks the documented prescription-generation integration point", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      // Before completion: unlocked is false
      const preUnlock = await consultationService.isPrescriptionUnlocked(consultationId);
      expect(preUnlock.unlocked).toBe(false);

      // End session and submit notes
      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Acute Bronchitis",
          clinicalNotes: "Detailed assessment and treatment plan.",
        });

      // After completion: unlocked is true
      const postUnlock = await consultationService.isPrescriptionUnlocked(consultationId);
      expect(postUnlock.unlocked).toBe(true);
      expect(postUnlock.diagnosis).toBe("Acute Bronchitis");
      expect(postUnlock.patientId).toBe(patientUser._id.toString());
      expect(postUnlock.doctorId).toBe(doctorUser._id.toString());
    });

    it("creates patient in-app notification when room is initialized", async () => {
      const appt = await createEligibleAppointment();

      await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);

      const notif = await Notification.findOne({
        userId: patientUser._id,
        type: NotificationType.CONSULTATION_ROOM_OPENED,
      });

      expect(notif).toBeDefined();
      expect(notif?.title).toBe("Consultation Room Ready");
      expect(notif?.metadata?.roomId).toBe(`consultation-${appt._id}`);
    });

    it("records audit log on completion without exposing sensitive clinical documentation text", async () => {
      const appt = await createEligibleAppointment();
      const initRes = await request(app)
        .post(`/api/v1/consultations/${appt._id}/session`)
        .set("Authorization", `Bearer ${doctorToken}`);
      const consultationId = initRes.body.data.consultationId;

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/end`)
        .set("Authorization", `Bearer ${doctorToken}`);

      await request(app)
        .post(`/api/v1/consultations/${consultationId}/notes`)
        .set("Authorization", `Bearer ${doctorToken}`)
        .send({
          diagnosis: "Type 2 Diabetes Mellitus",
          clinicalNotes: "Patient has elevated HbA1c. Dietary modifications discussed.",
          recommendedFollowUpDays: 30,
        });

      const audit = await AuditLog.findOne({
        resourceId: consultationId,
        action: AuditAction.CLINICAL_NOTE_MODIFIED,
      });

      expect(audit).toBeDefined();
      expect(audit?.actorId?.toString()).toBe(doctorUser._id.toString());
      expect(audit?.status).toBe("SUCCESS");
      expect(audit?.metadata?.event).toBe("CONSULTATION_COMPLETED");
      expect(audit?.metadata?.hasDiagnosis).toBe(true);
      // Ensure private clinical text is not leaked in audit metadata
      expect(audit?.metadata?.clinicalNotes).toBeUndefined();
      expect(audit?.metadata?.diagnosis).toBeUndefined();
    });
  });
});
