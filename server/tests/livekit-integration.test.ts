import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { TokenVerifier } from "livekit-server-sdk";
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
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import {
  setLiveKitCredentials,
  getLiveKitCredentials,
  verifyLiveKitToken,
} from "../src/integrations/video/livekit.client.js";

const TEST_API_KEY = "test_livekit_key_m8_82";
const TEST_API_SECRET = "test_livekit_secret_at_least_32_chars_long_12345";
const TEST_LIVEKIT_URL = "https://lifeline-test.livekit.cloud";

describe("Milestone 8 - Task 8.2: LiveKit Cloud Video SDK Integration & Token Generation", () => {
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
    // Configure test LiveKit credentials
    setLiveKitCredentials({
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      livekitUrl: TEST_LIVEKIT_URL,
    });

    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_livekit_integration_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Consultation.syncIndexes();
    await Notification.syncIndexes();
    await AuditLog.syncIndexes();
  }, 30000);

  afterAll(async () => {
    // Reset credentials override
    setLiveKitCredentials(null);

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Ensure active credentials are set for each test
    setLiveKitCredentials({
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      livekitUrl: TEST_LIVEKIT_URL,
    });

    await User.deleteMany({});
    await DoctorProfile.deleteMany({});
    await Appointment.deleteMany({});
    await Consultation.deleteMany({});
    await Notification.deleteMany({});
    await AuditLog.deleteMany({});

    // 1. Patient User
    patientUser = await User.create({
      email: "patient.livekit@example.com",
      phone: "+919876540101",
      fullName: "Patient Primary",
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

    // 2. Unrelated Patient User
    otherPatientUser = await User.create({
      email: "patient.unrelated@example.com",
      phone: "+919876540102",
      fullName: "Patient Unrelated",
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
      email: "doctor.livekit@example.com",
      phone: "+919876540103",
      fullName: "Dr. Attending",
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

    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "General Practice",
      qualifications: ["MD", "MBBS"],
      registrationNumber: "MED-LIVEKIT-101",
      registrationCouncil: "State Medical Council",
      experienceYears: 10,
      consultationFee: 750,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    // 4. Other Doctor User & Verified Profile
    otherDoctorUser = await User.create({
      email: "doctor.other@example.com",
      phone: "+919876540104",
      fullName: "Dr. Unrelated",
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

    otherDoctorProfile = await DoctorProfile.create({
      userId: otherDoctorUser._id,
      specialization: "Cardiology",
      qualifications: ["MD", "DM"],
      registrationNumber: "MED-LIVEKIT-102",
      registrationCouncil: "State Medical Council",
      experienceYears: 12,
      consultationFee: 1200,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });

    // 5. Admin User
    adminUser = await User.create({
      email: "admin.livekit@example.com",
      phone: "+919876540105",
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
      scheduledStart: new Date(now + 15 * 60 * 1000), // starts in 15 min
      scheduledEnd: new Date(now + 45 * 60 * 1000),   // ends in 45 min
      fee: 750,
      currency: "INR",
      reason: "LiveKit video consultation test",
      status: AppointmentStatus.CONFIRMED,
      paymentStatus: "PAID",
      ...overrides,
    });
  }

  // =========================================================================
  // Test 1: Configured Credentials & Cryptographic Signature Verification
  // =========================================================================
  it("1. Token generation uses the configured LiveKit API credentials and signs valid JWT", async () => {
    const appointment = await createEligibleAppointment();

    const res = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const token = res.body.data.token;
    expect(typeof token).toBe("string");

    // Verify token using official SDK TokenVerifier with the configured credentials
    const verifier = new TokenVerifier(TEST_API_KEY, TEST_API_SECRET);
    const claims = await verifier.verify(token);

    expect(claims.iss).toBe(TEST_API_KEY);
    expect(claims.sub).toBe(doctorUser._id.toString());

    // Verifying with an incorrect secret MUST fail cryptographically
    const wrongVerifier = new TokenVerifier(
      TEST_API_KEY,
      "wrong_secret_key_at_least_32_characters_long_12345"
    );
    await expect(wrongVerifier.verify(token)).rejects.toThrow();
  });

  // =========================================================================
  // Test 2: Room Join Grants and Least Privilege Permissions
  // =========================================================================
  it("2. Token includes the expected room-join grant with least privilege permissions", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const consultationId = initRes.body.data.consultationId;

    // Doctor token verification
    const docToken = initRes.body.data.token;
    const docClaims = await verifyLiveKitToken(docToken);

    expect(docClaims.video).toBeDefined();
    expect(docClaims.video.roomJoin).toBe(true);
    expect(docClaims.video.room).toBe(`consultation-${consultationId}`);
    expect(docClaims.video.canPublish).toBe(true);
    expect(docClaims.video.canSubscribe).toBe(true);
    expect(docClaims.video.canPublishData).toBe(true);
    // Explicitly zero administrative grants
    expect(docClaims.video.roomAdmin).toBeFalsy();
    expect(docClaims.video.roomCreate).toBeFalsy();
    expect(docClaims.video.roomList).toBeFalsy();
    expect(docClaims.video.roomRecord).toBeFalsy();

    // Patient token verification
    const patRes = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    const patToken = patRes.body.data.token;
    const patClaims = await verifyLiveKitToken(patToken);

    expect(patClaims.video.roomJoin).toBe(true);
    expect(patClaims.video.room).toBe(`consultation-${consultationId}`);
    expect(patClaims.video.canPublish).toBe(true);
    expect(patClaims.video.canSubscribe).toBe(true);
    expect(patClaims.video.canPublishData).toBe(true);
    expect(patClaims.video.roomAdmin).toBeFalsy();
    expect(patClaims.video.roomCreate).toBeFalsy();
    expect(patClaims.video.roomList).toBeFalsy();
    expect(patClaims.video.roomRecord).toBeFalsy();
  });

  // =========================================================================
  // Test 3: Token Identity Matches Trusted Authenticated Identity
  // =========================================================================
  it("3. Token identity matches the authenticated participant's trusted identity", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const consultationId = initRes.body.data.consultationId;

    // Doctor token claims
    const docClaims = await verifyLiveKitToken(initRes.body.data.token);
    expect(docClaims.sub).toBe(doctorUser._id.toString());
    expect(docClaims.name).toBe("Dr. Attending");

    // Patient token claims
    const patRes = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    const patClaims = await verifyLiveKitToken(patRes.body.data.token);
    expect(patClaims.sub).toBe(patientUser._id.toString());
    expect(patClaims.name).toBe("Patient Primary");
  });

  // =========================================================================
  // Test 4: Token Room Name Matches Persisted Consultation Room
  // =========================================================================
  it("4. Token room name matches the persisted consultation room name", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const consultationId = initRes.body.data.consultationId;
    const persistedConsultation = await Consultation.findById(consultationId);
    expect(persistedConsultation).toBeDefined();

    const expectedRoomName = `consultation-${consultationId}`;
    expect(persistedConsultation!.roomId).toBe(expectedRoomName);

    // Verify token claim matches persisted room
    const claims = await verifyLiveKitToken(initRes.body.data.token);
    expect(claims.video.room).toBe(persistedConsultation!.roomId);
  });

  // =========================================================================
  // Test 5: Token Expiration Is 60 Minutes from Issuance
  // =========================================================================
  it("5. Token expiration is 60 minutes (3600 seconds) from issuance", async () => {
    const appointment = await createEligibleAppointment();

    const res = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    expect(res.body.data.expiresInSeconds).toBe(3600);

    const claims = await verifyLiveKitToken(res.body.data.token);
    expect(claims.exp).toBeDefined();

    const issuedAt = claims.nbf ?? claims.iat;
    expect(issuedAt).toBeDefined();

    const durationSeconds = claims.exp - issuedAt;
    // Must be exactly 3600 seconds (allowing 2s tolerance for clock granularity)
    expect(Math.abs(durationSeconds - 3600)).toBeLessThanOrEqual(2);
  });

  // =========================================================================
  // Test 6: Doctor Cannot Generate Token for Another Doctor's Consultation
  // =========================================================================
  it("6. Doctor cannot generate a token for another doctor's consultation", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const consultationId = initRes.body.data.consultationId;

    // Unassigned Doctor attempts to get token
    const res = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${otherDoctorToken}`)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
  });

  // =========================================================================
  // Test 7: Patient Cannot Generate Token for Another Patient's Consultation
  // =========================================================================
  it("7. Patient cannot generate a token for another patient's consultation", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const consultationId = initRes.body.data.consultationId;

    // Unrelated Patient attempts to get token
    const res = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${otherPatientToken}`)
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");

    // Admin also rejected from joining clinical video room (clinical privacy)
    const adminRes = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);

    expect(adminRes.body.success).toBe(false);
    expect(adminRes.body.error.code).toBe("AUTH_RESOURCE_ACCESS_DENIED");
  });

  // =========================================================================
  // Test 8: Arbitrary Client-Supplied Room Names and Identities Cannot Alter Claims
  // =========================================================================
  it("8. Arbitrary client-supplied room names and identities cannot influence token claims", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        roomName: "injected-hacker-room",
        identity: "attacker-user-id",
        canPublish: false,
        roomAdmin: true,
      })
      .expect(200);

    const consultationId = initRes.body.data.consultationId;
    const docClaims = await verifyLiveKitToken(initRes.body.data.token);

    // Persisted room name and authenticated user ID remain authoritative
    expect(docClaims.video.room).toBe(`consultation-${consultationId}`);
    expect(docClaims.video.room).not.toBe("injected-hacker-room");
    expect(docClaims.sub).toBe(doctorUser._id.toString());
    expect(docClaims.sub).not.toBe("attacker-user-id");
    expect(docClaims.video.roomAdmin).toBeFalsy();

    // Injected query parameters on GET /:id/token
    const patRes = await request(app)
      .get(
        `/api/v1/consultations/${consultationId}/token?roomName=override-room&identity=override-id&roomAdmin=true`
      )
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(200);

    const patClaims = await verifyLiveKitToken(patRes.body.data.token);
    expect(patClaims.video.room).toBe(`consultation-${consultationId}`);
    expect(patClaims.sub).toBe(patientUser._id.toString());
    expect(patClaims.video.roomAdmin).toBeFalsy();
  });

  // =========================================================================
  // Test 9: Tokens Are Rejected for Consultations Not Yet Initialized
  // =========================================================================
  it("9. Tokens are rejected for consultations that have not been initialized by the doctor", async () => {
    const appointment = await createEligibleAppointment();

    // Create a consultation record directly in SCHEDULED state
    const scheduledConsultation = await Consultation.create({
      appointmentId: appointment._id,
      patientId: patientUser._id,
      doctorId: doctorUser._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.SCHEDULED,
      roomId: "uninitialized-room",
    });

    const res = await request(app)
      .get(`/api/v1/consultations/${scheduledConsultation._id}/token`)
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CONSULTATION_NOT_STARTED");
  });

  // =========================================================================
  // Test 10: Concluded Consultations Cannot Issue Join Tokens
  // =========================================================================
  it("10. Concluded or completed consultations cannot issue join tokens", async () => {
    const appointment = await createEligibleAppointment();

    const initRes = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const consultationId = initRes.body.data.consultationId;

    // End call
    await request(app)
      .post(`/api/v1/consultations/${consultationId}/end`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    // Joining an ENDED session is rejected
    const endedRes = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${patientToken}`)
      .expect(409);

    expect(endedRes.body.error.code).toBe("CONSULTATION_SESSION_CLOSED");

    // Submit notes to complete consultation
    await request(app)
      .post(`/api/v1/consultations/${consultationId}/notes`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        diagnosis: "Seasonal allergic rhinitis",
        clinicalNotes: "Patient prescribed antihistamines and advised rest.",
      })
      .expect(200);

    // Joining a COMPLETED session is rejected
    const completedRes = await request(app)
      .get(`/api/v1/consultations/${consultationId}/token`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(409);

    expect(completedRes.body.error.code).toBe("CONSULTATION_SESSION_CLOSED");
  });

  // =========================================================================
  // Test 11: Ineligible Appointments Cannot Initialize a Room
  // =========================================================================
  it("11. Ineligible appointments (unpaid, cancelled, rejected, window-mismatch) cannot initialize a room", async () => {
    const now = Date.now();

    // A. Unpaid appointment
    const unpaidAppt = await createEligibleAppointment({
      paymentStatus: "PENDING",
      status: AppointmentStatus.PENDING_PAYMENT,
    });
    const unpaidRes = await request(app)
      .post(`/api/v1/consultations/${unpaidAppt._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(409);
    expect(unpaidRes.body.error.code).toBe("APPOINTMENT_PAYMENT_REQUIRED");

    // B. Cancelled appointment
    const cancelledAppt = await createEligibleAppointment({
      status: AppointmentStatus.CANCELLED,
    });
    const cancelRes = await request(app)
      .post(`/api/v1/consultations/${cancelledAppt._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(409);
    expect(cancelRes.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");

    // C. Rejected appointment
    const rejectedAppt = await createEligibleAppointment({
      status: AppointmentStatus.REJECTED,
    });
    const rejectRes = await request(app)
      .post(`/api/v1/consultations/${rejectedAppt._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(409);
    expect(rejectRes.body.error.code).toBe("APPOINTMENT_INVALID_TRANSITION");

    // D. Window not reached (>1 hr before scheduledStart)
    const earlyAppt = await createEligibleAppointment({
      scheduledStart: new Date(now + 3 * 60 * 60 * 1000), // starts in 3 hours
      scheduledEnd: new Date(now + 3.5 * 60 * 60 * 1000),
    });
    const earlyRes = await request(app)
      .post(`/api/v1/consultations/${earlyAppt._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(422);
    expect(earlyRes.body.error.code).toBe("CONSULTATION_WINDOW_NOT_REACHED");

    // E. Window expired (scheduledEnd in past)
    const expiredAppt = await createEligibleAppointment({
      scheduledStart: new Date(now - 60 * 60 * 1000), // ended 15 min ago
      scheduledEnd: new Date(now - 15 * 60 * 1000),
    });
    const expiredRes = await request(app)
      .post(`/api/v1/consultations/${expiredAppt._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(422);
    expect(expiredRes.body.error.code).toBe("CONSULTATION_WINDOW_EXPIRED");

    // F. Doctor profile unverified
    await DoctorProfile.updateOne(
      { userId: doctorUser._id },
      { $set: { verificationStatus: DoctorVerificationStatus.PENDING_REVIEW } }
    );
    const validAppt = await createEligibleAppointment();
    const unverifiedRes = await request(app)
      .post(`/api/v1/consultations/${validAppt._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(403);
    expect(unverifiedRes.body.error.code).toBe("DOCTOR_NOT_VERIFIED");
  });

  // =========================================================================
  // Test 12: Missing or Invalid LiveKit Configuration Fails Safely
  // =========================================================================
  it("12. Missing or invalid LiveKit configuration fails safely without exposing secrets", async () => {
    const appointment = await createEligibleAppointment();

    // Invalidate credentials
    setLiveKitCredentials({
      apiKey: "",
      apiSecret: "",
      livekitUrl: "",
    });

    const res = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(503);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CONSULTATION_VIDEO_PROVIDER_ERROR");
    // Ensure no real secrets or internal credential values leaked in error message
    expect(res.body.error.message).not.toContain(TEST_API_SECRET);

    // Restore credentials for subsequent tests
    setLiveKitCredentials({
      apiKey: TEST_API_KEY,
      apiSecret: TEST_API_SECRET,
      livekitUrl: TEST_LIVEKIT_URL,
    });
  });

  // =========================================================================
  // Test 13: Repeated Room Initialization Does Not Create Duplicate Consultations
  // =========================================================================
  it("13. Repeated room initialization preserves canonical room and does not create duplicate records", async () => {
    const appointment = await createEligibleAppointment();

    // 1st initialization
    const res1 = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const { consultationId: id1, roomId: room1, token: token1 } = res1.body.data;

    // 2nd initialization (re-entering)
    const res2 = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const { consultationId: id2, roomId: room2, token: token2 } = res2.body.data;

    // Same consultation ID and room ID preserved
    expect(id1).toBe(id2);
    expect(room1).toBe(room2);
    expect(room1).toBe(`consultation-${id1}`);

    // Fresh token issued each time
    expect(typeof token1).toBe("string");
    expect(typeof token2).toBe("string");

    // Both tokens verify to canonical room
    const claims1 = await verifyLiveKitToken(token1);
    const claims2 = await verifyLiveKitToken(token2);
    expect(claims1.video.room).toBe(room1);
    expect(claims2.video.room).toBe(room2);

    // Exactly one consultation document in database
    const count = await Consultation.countDocuments({
      appointmentId: appointment._id,
    });
    expect(count).toBe(1);
  });

  // =========================================================================
  // Test 14: Client-facing LiveKit URL is returned and secrets are omitted
  // =========================================================================
  it("14. Client-facing response returns livekitUrl without leaking server credentials", async () => {
    const appointment = await createEligibleAppointment();

    const res = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    expect(res.body.data.livekitUrl).toBe(TEST_LIVEKIT_URL);
    expect(res.body.data.token).toBeDefined();

    // Strictly verify no secret/key fields exist anywhere in response envelope
    const rawResponse = JSON.stringify(res.body);
    expect(rawResponse).not.toContain(TEST_API_SECRET);
    expect(res.body.data.apiKey).toBeUndefined();
    expect(res.body.data.apiSecret).toBeUndefined();
  });

  // =========================================================================
  // Test 15: No Token or Credential Appears in Application Logs or Audit Metadata
  // =========================================================================
  it("15. No token or credential appears in audit metadata or database logs", async () => {
    const appointment = await createEligibleAppointment();

    const res = await request(app)
      .post(`/api/v1/consultations/${appointment._id}/session`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .expect(200);

    const token = res.body.data.token;
    const consultationId = res.body.data.consultationId;

    // Inspect AuditLog documents
    const auditLogs = await AuditLog.find({ resourceId: consultationId });
    expect(auditLogs.length).toBeGreaterThan(0);

    for (const log of auditLogs) {
      const metaString = JSON.stringify(log.metadata || {});
      // Ensure raw token is NEVER stored in audit logs
      expect(metaString).not.toContain(token);
      // Ensure API secrets are NEVER stored in audit logs
      expect(metaString).not.toContain(TEST_API_SECRET);
      expect(metaString).not.toContain("apiSecret");
    }
  });
});
