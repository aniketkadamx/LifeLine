import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "node:http";
import request from "supertest";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import {
  initSocketServer,
  closeSocketServer,
} from "../src/sockets/socket.server.js";
import {
  User,
  DoctorProfile,
  Appointment,
  Consultation,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  AppointmentStatus,
  ConsultationStatus,
  ConsultationType,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";

describe("Milestone 11 - Task 11.1: Authenticated Socket.IO Handshake & Room Scoping", () => {
  let server: http.Server;
  let serverPort: number;
  let activeClients: ClientSocket[] = [];

  // Users
  let patient1: any;
  let patient1Token: string;

  let patient2: any;
  let patient2Token: string;

  let doctor1: any;
  let doctor1Profile: any;
  let doctor1Token: string;

  let doctor2: any;
  let doctor2Profile: any;
  let doctor2Token: string;

  let suspendedUser: any;
  let suspendedToken: string;

  let deactivatedUser: any;
  let deactivatedToken: string;

  let adminUser: any;
  let adminToken: string;

  // Domain resources
  let appointment1: any; // between patient1 and doctor1 (CONFIRMED)
  let appointment2: any; // between patient2 and doctor2 (CONFIRMED)
  let cancelledAppointment: any; // between patient1 and doctor1 (CANCELLED)
  let rejectedAppointment: any; // between patient1 and doctor1 (REJECTED)

  let consultation1: any; // for appointment1
  let cancelledConsultation: any; // for cancelledAppointment

  function createClientSocket(
    token?: string,
    extraAuth?: Record<string, unknown>
  ): ClientSocket {
    const authPayload: Record<string, unknown> = {};
    if (token !== undefined) {
      authPayload.token = token;
    }
    if (extraAuth) {
      Object.assign(authPayload, extraAuth);
    }

    const client = Client(`http://127.0.0.1:${serverPort}`, {
      autoConnect: false,
      transports: ["websocket"],
      auth: authPayload,
      reconnection: false,
    });
    activeClients.push(client);
    return client;
  }

  function waitForConnect(socket: ClientSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", (err) => reject(err));
      socket.connect();
    });
  }

  function waitForConnectError(socket: ClientSocket): Promise<Error> {
    return new Promise((resolve, reject) => {
      socket.on("connect", () =>
        reject(new Error("Expected connection to fail, but it succeeded"))
      );
      socket.on("connect_error", (err) => resolve(err));
      socket.connect();
    });
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_socket_auth_test"
    );

    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Consultation.syncIndexes();

    // 1. Seed Users
    patient1 = await User.create({
      email: "patient1.m111@example.com",
      phone: "+919876550001",
      fullName: "Kiran Bedi",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patient1Token = tokenService.generateAccessToken(
      patient1._id.toString(),
      UserRole.PATIENT
    );

    patient2 = await User.create({
      email: "patient2.m111@example.com",
      phone: "+919876550002",
      fullName: "Sameer Joshi",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patient2Token = tokenService.generateAccessToken(
      patient2._id.toString(),
      UserRole.PATIENT
    );

    doctor1 = await User.create({
      email: "doctor1.m111@example.com",
      phone: "+919876550003",
      fullName: "Dr. Arvind Swamy",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctor1Profile = await DoctorProfile.create({
      userId: doctor1._id,
      specialization: "CARDIOLOGY",
      qualifications: ["MBBS", "MD"],
      experienceYears: 15,
      registrationNumber: "MCI-2026-M111-1",
      registrationCouncil: "Maharashtra Medical Council",
      consultationFee: 700,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctor1Token = tokenService.generateAccessToken(
      doctor1._id.toString(),
      UserRole.DOCTOR
    );

    doctor2 = await User.create({
      email: "doctor2.m111@example.com",
      phone: "+919876550004",
      fullName: "Dr. Sunita Rao",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctor2Profile = await DoctorProfile.create({
      userId: doctor2._id,
      specialization: "DERMATOLOGY",
      qualifications: ["MBBS", "MD"],
      experienceYears: 8,
      registrationNumber: "MCI-2026-M111-2",
      registrationCouncil: "Maharashtra Medical Council",
      consultationFee: 600,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctor2Token = tokenService.generateAccessToken(
      doctor2._id.toString(),
      UserRole.DOCTOR
    );

    suspendedUser = await User.create({
      email: "suspended.m111@example.com",
      phone: "+919876550005",
      fullName: "Suspended Account",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.SUSPENDED,
      emailVerified: true,
      phoneVerified: true,
    });
    suspendedToken = tokenService.generateAccessToken(
      suspendedUser._id.toString(),
      UserRole.PATIENT
    );

    deactivatedUser = await User.create({
      email: "deactivated.m111@example.com",
      phone: "+919876550006",
      fullName: "Deactivated Account",
      passwordHash: "$2a$10$abcdefghijklmnopqrstuvwx",
      role: UserRole.PATIENT,
      status: UserStatus.DEACTIVATED,
      emailVerified: true,
      phoneVerified: true,
    });
    deactivatedToken = tokenService.generateAccessToken(
      deactivatedUser._id.toString(),
      UserRole.PATIENT
    );

    adminUser = await User.create({
      email: "admin.m111@example.com",
      phone: "+919876550007",
      fullName: "Platform Admin",
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

    // 2. Seed Appointments
    appointment1 = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(Date.now() + 10 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 40 * 60 * 1000),
      status: AppointmentStatus.CONFIRMED,
      reason: "Cardiology follow up",
      fee: 700,
      currency: "INR",
      paymentStatus: "PAID",
    });

    appointment2 = await Appointment.create({
      patientId: patient2._id,
      doctorId: doctor2._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(Date.now() + 60 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 90 * 60 * 1000),
      status: AppointmentStatus.CONFIRMED,
      reason: "Skin allergy check",
      fee: 600,
      currency: "INR",
      paymentStatus: "PAID",
    });

    cancelledAppointment = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(Date.now() + 120 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 150 * 60 * 1000),
      status: AppointmentStatus.CANCELLED,
      reason: "Prior commitment",
      fee: 700,
      currency: "INR",
      paymentStatus: "REFUNDED",
    });

    rejectedAppointment = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: new Date(Date.now() + 180 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 210 * 60 * 1000),
      status: AppointmentStatus.REJECTED,
      reason: "Doctor unavailable",
      fee: 700,
      currency: "INR",
      paymentStatus: "REFUNDED",
    });

    // 3. Seed Consultations
    consultation1 = await Consultation.create({
      appointmentId: appointment1._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.ROOM_OPENED,
      roomId: "lifeline-room-m111-1",
      startedAt: new Date(),
    });

    cancelledConsultation = await Consultation.create({
      appointmentId: cancelledAppointment._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.ENDED,
      roomId: "lifeline-room-cancelled",
    });

    // 4. Start HTTP & Socket.IO server on ephemeral port
    server = http.createServer(app);
    initSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        serverPort =
          typeof address === "object" && address !== null
            ? address.port
            : 0;
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    // Disconnect active client sockets
    for (const client of activeClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    activeClients = [];

    // Close Socket.IO server
    await closeSocketServer();

    // Close HTTP Server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    // Clean up MongoDB test data
    await User.deleteMany({ email: { $regex: /@example\.com$/ } });
    await DoctorProfile.deleteMany({});
    await Appointment.deleteMany({});
    await Consultation.deleteMany({});
    await disconnectDatabase();
  });

  beforeEach(() => {
    // Disconnect previous clients
    for (const client of activeClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    activeClients = [];
  });

  // =========================================================================
  // 1. Handshake Authentication
  // =========================================================================
  describe("1. Handshake Authentication", () => {
    it("1. Connection without a token is rejected", async () => {
      const client = createClientSocket(); // no token
      const err = await waitForConnectError(client);
      expect(err.message).toBe("Authentication token is required");
      expect(client.connected).toBe(false);
    });

    it("2. Malformed token is rejected", async () => {
      const client = createClientSocket("not-a-valid-jwt-token");
      const err = await waitForConnectError(client);
      expect(err.message).toBe("Authentication token invalid");
      expect(client.connected).toBe(false);
    });

    it("3. Invalid-signature token is rejected", async () => {
      const fakeToken = jwt.sign(
        { sub: patient1._id.toString(), role: UserRole.PATIENT, type: "access" },
        "wrong-secret-key-123",
        { expiresIn: "15m", issuer: "lifeline-api" }
      );

      const client = createClientSocket(fakeToken);
      const err = await waitForConnectError(client);
      expect(err.message).toBe("Authentication token invalid");
      expect(client.connected).toBe(false);
    });

    it("4. Expired access token is rejected", async () => {
      const expiredToken = jwt.sign(
        {
          sub: patient1._id.toString(),
          role: UserRole.PATIENT,
          type: "access",
          jti: "test-expired",
        },
        env.JWT_ACCESS_SECRET,
        { expiresIn: "-10s", issuer: "lifeline-api" }
      );

      const client = createClientSocket(expiredToken);
      const err = await waitForConnectError(client);
      expect(err.message).toBe("Authentication token expired");
      expect(client.connected).toBe(false);
    });

    it("5. Refresh token is rejected when an access token is required", async () => {
      const refreshToken = tokenService.generateRefreshToken(
        patient1._id.toString(),
        UserRole.PATIENT,
        "family-1",
        "jti-1"
      );

      const client = createClientSocket(refreshToken);
      const err = await waitForConnectError(client);
      expect(err.message).toBe("Authentication token invalid");
      expect(client.connected).toBe(false);
    });

    it("6. Valid access token connects successfully", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);
      expect(client.connected).toBe(true);
    });

    it("7. Inactive, suspended, or deactivated users are rejected", async () => {
      // Suspended account
      const suspendedClient = createClientSocket(suspendedToken);
      const suspErr = await waitForConnectError(suspendedClient);
      expect(suspErr.message).toBe("Authentication failed: account is not active");
      expect(suspendedClient.connected).toBe(false);

      // Deactivated account
      const deactivatedClient = createClientSocket(deactivatedToken);
      const deactErr = await waitForConnectError(deactivatedClient);
      expect(deactErr.message).toBe("Authentication failed: account is not active");
      expect(deactivatedClient.connected).toBe(false);
    });

    it("8. Client-supplied identity or role cannot override verified token identity", async () => {
      // Client tries to spoof being a doctor with doctor1's ID
      const spoofClient = createClientSocket(patient1Token, {
        role: UserRole.DOCTOR,
        id: doctor1._id.toString(),
      });

      await waitForConnect(spoofClient);
      expect(spoofClient.connected).toBe(true);

      // The socket should still only have patient1's permissions; trying to join doctor2's appointment fails
      const joinRes = await new Promise<{ success: boolean; error?: string }>(
        (resolve) => {
          spoofClient.emit(
            "join_room",
            { room: `appointment:${appointment2._id}` },
            resolve
          );
        }
      );
      expect(joinRes.success).toBe(false);
      expect(joinRes.error).toContain("Access denied");
    });
  });

  // =========================================================================
  // 2. Room Authorization
  // =========================================================================
  describe("2. Room Authorization", () => {
    it("9. Authorized patient can join their eligible consultation room", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${consultation1._id}` },
          resolve
        );
      });

      expect(res.success).toBe(true);
      expect(res.room).toBe(`consultation:${consultation1._id}`);
    });

    it("10. Authorized assigned doctor can join their eligible consultation room", async () => {
      const client = createClientSocket(doctor1Token);
      await waitForConnect(client);

      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${consultation1._id}` },
          resolve
        );
      });

      expect(res.success).toBe(true);
      expect(res.room).toBe(`consultation:${consultation1._id}`);
    });

    it("11. Patient cannot join another patient's consultation room", async () => {
      const client = createClientSocket(patient2Token); // patient2 trying to join consultation1
      await waitForConnect(client);

      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${consultation1._id}` },
          resolve
        );
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Access denied: you are not a participant in this consultation"
      );
    });

    it("12. Unassigned doctor cannot join the consultation room", async () => {
      const client = createClientSocket(doctor2Token); // doctor2 trying to join consultation1
      await waitForConnect(client);

      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${consultation1._id}` },
          resolve
        );
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Access denied: you are not a participant in this consultation"
      );
    });

    it("13. Authorized appointment participant can join the appointment room", async () => {
      // Patient 1 joins appointment 1
      const client1 = createClientSocket(patient1Token);
      await waitForConnect(client1);

      const res1 = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client1.emit(
          "join_room",
          { room: `appointment:${appointment1._id}` },
          resolve
        );
      });

      expect(res1.success).toBe(true);
      expect(res1.room).toBe(`appointment:${appointment1._id}`);

      // Doctor 1 joins appointment 1
      const client2 = createClientSocket(doctor1Token);
      await waitForConnect(client2);

      const res2 = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client2.emit(
          "join_room",
          { room: `appointment:${appointment1._id}` },
          resolve
        );
      });

      expect(res2.success).toBe(true);
      expect(res2.room).toBe(`appointment:${appointment1._id}`);
    });

    it("14. Unrelated authenticated user cannot join the appointment room", async () => {
      const client = createClientSocket(patient2Token);
      await waitForConnect(client);

      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `appointment:${appointment1._id}` },
          resolve
        );
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe(
        "Access denied: you are not a participant in this appointment"
      );
    });

    it("15. Invalid resource IDs are rejected safely", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: "consultation:not-a-valid-hex-id" },
          resolve
        );
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Invalid resource identifier format");
    });

    it("16. Nonexistent resources are rejected without leaking unnecessary information", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await new Promise<{
        success: boolean;
        room?: string;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${nonExistentId}` },
          resolve
        );
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe("Consultation not found");
    });

    it("17. Unsupported room types and arbitrary room names are rejected", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      // Unmapped room type
      const res1 = await new Promise<{ success: boolean; error?: string }>(
        (resolve) => {
          client.emit(
            "join_room",
            { room: "admin:secrets" },
            resolve
          );
        }
      );
      expect(res1.success).toBe(false);
      expect(res1.error).toBe("Unsupported room type");

      // Arbitrary name
      const res2 = await new Promise<{ success: boolean; error?: string }>(
        (resolve) => {
          client.emit(
            "join_room",
            { room: "all_patients_broadcast" },
            resolve
          );
        }
      );
      expect(res2.success).toBe(false);
      expect(res2.error).toBe("Invalid or unsupported room format");
    });

    it("18. Ineligible consultation/appointment states are rejected", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      // Cancelled appointment
      const cancelRes = await new Promise<{
        success: boolean;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `appointment:${cancelledAppointment._id}` },
          resolve
        );
      });
      expect(cancelRes.success).toBe(false);
      expect(cancelRes.error).toContain("cancelled or rejected");

      // Rejected appointment
      const rejectRes = await new Promise<{
        success: boolean;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `appointment:${rejectedAppointment._id}` },
          resolve
        );
      });
      expect(rejectRes.success).toBe(false);
      expect(rejectRes.error).toContain("cancelled or rejected");

      // Consultation belonging to cancelled appointment
      const consultRes = await new Promise<{
        success: boolean;
        error?: string;
      }>((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${cancelledConsultation._id}` },
          resolve
        );
      });
      expect(consultRes.success).toBe(false);
      expect(consultRes.error).toContain("cancelled or rejected");
    });

    it("19. Leaving a room succeeds", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      // First join
      await new Promise((resolve) => {
        client.emit(
          "join_room",
          { room: `consultation:${consultation1._id}` },
          resolve
        );
      });

      // Then leave
      const leaveRes = await new Promise<{
        success: boolean;
        room?: string;
      }>((resolve) => {
        client.emit(
          "leave_room",
          { room: `consultation:${consultation1._id}` },
          resolve
        );
      });

      expect(leaveRes.success).toBe(true);
      expect(leaveRes.room).toBe(`consultation:${consultation1._id}`);
    });
  });

  // =========================================================================
  // 3. Lifecycle, Broadcasts & Regression
  // =========================================================================
  describe("3. Lifecycle, Broadcasts & Regression", () => {
    it("20. Server broadcast to user-scoped room reaches the authenticated client", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const receivedPromise = new Promise<{ eventData: string }>((resolve) => {
        client.on("NOTIFICATION_RECEIVED", (data) => resolve(data));
      });

      const { io } = await import("../src/server.js");
      io.to(`patient:${patient1._id}`).emit("NOTIFICATION_RECEIVED", {
        eventData: "Consultation room ready",
      });

      const received = await receivedPromise;
      expect(received.eventData).toBe("Consultation room ready");
    });

    it("21. Socket disconnection cleans up active connection", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);
      expect(client.connected).toBe(true);

      const disconnectPromise = new Promise<void>((resolve) => {
        client.on("disconnect", () => resolve());
      });

      client.disconnect();
      await disconnectPromise;
      expect(client.connected).toBe(false);
    });

    it("22. Repeated initSocketServer calls return the existing singleton instance", () => {
      const instance1 = initSocketServer(server);
      const instance2 = initSocketServer(server);
      expect(instance1).toBe(instance2);
    });

    it("23. Existing REST endpoints continue to behave normally", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("operational");
    });
  });
});
