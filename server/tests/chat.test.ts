import http from "node:http";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { app } from "../src/app.js";
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
  Message,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  DoctorVerificationStatus,
  ConsultationType,
  ConsultationStatus,
  AppointmentStatus,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { chatService } from "../src/services/chat.service.js";

describe("Milestone 11 - Task 11.2: Consultation Chat & Message Persistence", () => {
  let server: http.Server;
  let serverPort: number;
  let activeClients: ClientSocket[] = [];

  // Users
  let patient1: any;
  let patient1Token: string;

  let patient2: any;
  let patient2Token: string;

  let doctor1: any;
  let doctor1Token: string;

  let doctor2: any;
  let doctor2Token: string;

  // Domain resources
  let appointmentActive: any;
  let consultationActive: any;

  let appointmentFuture: any;
  let consultationFuture: any;

  let appointmentCompleted: any;
  let consultationCompleted: any;

  let appointmentExpired: any;
  let consultationExpired: any;

  let appointmentCancelled: any;
  let consultationCancelled: any;

  function createClientSocket(token?: string): ClientSocket {
    const authPayload: Record<string, unknown> = {};
    if (token !== undefined) {
      authPayload.token = token;
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

  function emitWithAck<T = any>(
    socket: ClientSocket,
    event: string,
    data: unknown
  ): Promise<T> {
    return new Promise((resolve) => {
      socket.emit(event, data, (response: T) => {
        resolve(response);
      });
    });
  }

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_chat_persistence_test"
    );
    await User.syncIndexes();
    await DoctorProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Consultation.syncIndexes();
    await Message.syncIndexes();

    server = http.createServer(app);
    initSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  }, 30000);

  afterAll(async () => {
    for (const client of activeClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    activeClients = [];

    await closeSocketServer();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
      await mongoose.connection.db.dropDatabase();
    }
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Reset database collections
    await Message.deleteMany({});
    await Consultation.deleteMany({});
    await Appointment.deleteMany({});
    await DoctorProfile.deleteMany({});
    await User.deleteMany({});

    // 1. Create Patient 1
    patient1 = await User.create({
      email: `patient1.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Patient One",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patient1Token = tokenService.generateAccessToken(patient1.id, patient1.role);

    // 2. Create Patient 2 (unrelated)
    patient2 = await User.create({
      email: `patient2.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Patient Two",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patient2Token = tokenService.generateAccessToken(patient2.id, patient2.role);

    // 3. Create Doctor 1
    doctor1 = await User.create({
      email: `doctor1.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Dr. Doctor One",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctor1Token = tokenService.generateAccessToken(doctor1.id, doctor1.role);

    const doc1Profile = await DoctorProfile.create({
      userId: doctor1._id,
      specialization: "General Practice",
      qualifications: ["MBBS"],
      experienceYears: 10,
      registrationNumber: `REG-1-${Date.now()}`,
      registrationCouncil: "State Medical Council",
      consultationFee: 500,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctor1.doctorProfile = doc1Profile._id;
    await doctor1.save();

    // 4. Create Doctor 2 (unrelated)
    doctor2 = await User.create({
      email: `doctor2.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Dr. Doctor Two",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctor2Token = tokenService.generateAccessToken(doctor2.id, doctor2.role);

    const doc2Profile = await DoctorProfile.create({
      userId: doctor2._id,
      specialization: "Cardiology",
      qualifications: ["MD"],
      experienceYears: 12,
      registrationNumber: `REG-2-${Date.now()}`,
      registrationCouncil: "State Medical Council",
      consultationFee: 1000,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctor2.doctorProfile = doc2Profile._id;
    await doctor2.save();

    // Reference time: current time
    const now = new Date();

    // Active Consultation: scheduled 5 minutes ago (within active window)
    const activeStart = new Date(now.getTime() - 5 * 60 * 1000);
    const activeEnd = new Date(now.getTime() + 25 * 60 * 1000);
    appointmentActive = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: activeStart,
      scheduledEnd: activeEnd,
      status: AppointmentStatus.CONFIRMED,
      reason: "Active Consultation Chat Test",
      fee: 500,
      currency: "INR",
    });
    consultationActive = await Consultation.create({
      appointmentId: appointmentActive._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.ROOM_OPENED,
      roomId: "room-active-1",
      startedAt: activeStart,
    });

    // Future Consultation: scheduled 1 hour in the future (window opens in 45m; currently closed)
    const futureStart = new Date(now.getTime() + 60 * 60 * 1000);
    const futureEnd = new Date(now.getTime() + 90 * 60 * 1000);
    appointmentFuture = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: futureStart,
      scheduledEnd: futureEnd,
      status: AppointmentStatus.CONFIRMED,
      reason: "Future Consultation Chat Test",
      fee: 500,
      currency: "INR",
    });
    consultationFuture = await Consultation.create({
      appointmentId: appointmentFuture._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.SCHEDULED,
      roomId: "room-future-1",
    });

    // Completed Consultation: completed 2 hours ago (within 24h grace window; active)
    const completedStart = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const completedEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    appointmentCompleted = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: completedStart,
      scheduledEnd: completedEnd,
      status: AppointmentStatus.COMPLETED,
      reason: "Completed Consultation Chat Test",
      fee: 500,
      currency: "INR",
    });
    consultationCompleted = await Consultation.create({
      appointmentId: appointmentCompleted._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.COMPLETED,
      roomId: "room-completed-1",
      startedAt: completedStart,
      endedAt: completedEnd,
      durationSeconds: 3600,
    });

    // Expired Consultation: completed 26 hours ago (> 24h grace window; closed)
    const expiredStart = new Date(now.getTime() - 28 * 60 * 60 * 1000);
    const expiredEnd = new Date(now.getTime() - 26 * 60 * 60 * 1000);
    appointmentExpired = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: expiredStart,
      scheduledEnd: expiredEnd,
      status: AppointmentStatus.COMPLETED,
      reason: "Expired Consultation Chat Test",
      fee: 500,
      currency: "INR",
    });
    consultationExpired = await Consultation.create({
      appointmentId: appointmentExpired._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.COMPLETED,
      roomId: "room-expired-1",
      startedAt: expiredStart,
      endedAt: expiredEnd,
      durationSeconds: 3600,
    });

    // Cancelled Consultation
    appointmentCancelled = await Appointment.create({
      patientId: patient1._id,
      doctorId: doctor1._id,
      appointmentType: ConsultationType.VIDEO,
      scheduledStart: activeStart,
      scheduledEnd: activeEnd,
      status: AppointmentStatus.CANCELLED,
      reason: "Cancelled Consultation Chat Test",
      fee: 500,
      currency: "INR",
    });
    consultationCancelled = await Consultation.create({
      appointmentId: appointmentCancelled._id,
      patientId: patient1._id,
      doctorId: doctor1._id,
      consultationType: ConsultationType.VIDEO,
      status: ConsultationStatus.ENDED,
      roomId: "room-cancelled-1",
    });
  });

  afterEach(() => {
    for (const client of activeClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    activeClients = [];
    vi.useRealTimers();
  });

  // =========================================================================
  // A. Message Persistence
  // =========================================================================
  describe("A. Message Persistence", () => {
    it("an authorized participant sends a valid message and it persists in MongoDB", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Hello Dr. One, I have a question regarding my medication.",
        clientMessageId: "msg-client-101",
      });

      expect(ack.success).toBe(true);
      expect(ack.data).toBeDefined();
      expect(ack.data.id).toBeDefined();
      expect(ack.data.consultationId).toBe(consultationActive._id.toString());
      expect(ack.data.senderId).toBe(patient1._id.toString());
      expect(ack.data.senderRole).toBe(UserRole.PATIENT);
      expect(ack.data.text).toBe("Hello Dr. One, I have a question regarding my medication.");
      expect(ack.data.clientMessageId).toBe("msg-client-101");
      expect(ack.data.createdAt).toBeDefined();

      // Verify directly in MongoDB
      const dbMessage = await Message.findById(ack.data.id);
      expect(dbMessage).not.toBeNull();
      expect(dbMessage!.consultationId.toString()).toBe(consultationActive._id.toString());
      expect(dbMessage!.senderId.toString()).toBe(patient1._id.toString());
      expect(dbMessage!.senderRole).toBe(UserRole.PATIENT);
      expect(dbMessage!.text).toBe("Hello Dr. One, I have a question regarding my medication.");
      expect(dbMessage!.clientMessageId).toBe("msg-client-101");
    });

    it("sender identity and role strictly derive from server context, ignoring client impersonation", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      // Attempt to spoof senderId and role as Doctor
      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Impersonation attempt",
        senderId: doctor1._id.toString(),
        senderRole: "DOCTOR",
      });

      expect(ack.success).toBe(true);
      expect(ack.data.senderId).toBe(patient1._id.toString());
      expect(ack.data.senderRole).toBe(UserRole.PATIENT);

      const dbMessage = await Message.findById(ack.data.id);
      expect(dbMessage!.senderId.toString()).toBe(patient1._id.toString());
      expect(dbMessage!.senderRole).toBe(UserRole.PATIENT);
    });

    it("no duplicate persistence occurs from a single event invocation", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Single execution test message",
      });

      expect(ack.success).toBe(true);
      const count = await Message.countDocuments({
        consultationId: consultationActive._id,
        text: "Single execution test message",
      });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // B. Socket Broadcast
  // =========================================================================
  describe("B. Socket Broadcast", () => {
    it("broadcasts persisted message to authorized counterpart in consultation room", async () => {
      const patientClient = createClientSocket(patient1Token);
      const doctorClient = createClientSocket(doctor1Token);

      await waitForConnect(patientClient);
      await waitForConnect(doctorClient);

      // Both join consultation room
      const roomName = `consultation:${consultationActive._id.toString()}`;
      const joinPatientAck = await emitWithAck(patientClient, "join_room", roomName);
      const joinDoctorAck = await emitWithAck(doctorClient, "join_room", roomName);

      expect(joinPatientAck.success).toBe(true);
      expect(joinDoctorAck.success).toBe(true);

      // Doctor listens for new_message
      const messagePromise = new Promise<any>((resolve) => {
        doctorClient.on("new_message", (msg) => {
          resolve(msg);
        });
      });

      // Patient sends message
      const sendAck = await emitWithAck(patientClient, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Doctor, can you see my latest test results?",
      });
      expect(sendAck.success).toBe(true);

      const receivedMsg = await messagePromise;
      expect(receivedMsg).toBeDefined();
      expect(receivedMsg.id).toBe(sendAck.data.id);
      expect(receivedMsg.consultationId).toBe(consultationActive._id.toString());
      expect(receivedMsg.senderId).toBe(patient1._id.toString());
      expect(receivedMsg.senderRole).toBe(UserRole.PATIENT);
      expect(receivedMsg.text).toBe("Doctor, can you see my latest test results?");
    });

    it("unrelated user or different room does NOT receive the broadcast message", async () => {
      const patientClient = createClientSocket(patient1Token);
      const unrelatedDoctorClient = createClientSocket(doctor2Token);

      await waitForConnect(patientClient);
      await waitForConnect(unrelatedDoctorClient);

      // Patient joins consultationActive room
      await emitWithAck(
        patientClient,
        "join_room",
        `consultation:${consultationActive._id.toString()}`
      );

      // Unrelated doctor listens
      let receivedByUnrelated = false;
      unrelatedDoctorClient.on("new_message", () => {
        receivedByUnrelated = true;
      });

      // Patient sends message in consultationActive
      const sendAck = await emitWithAck(patientClient, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Confidential message",
      });
      expect(sendAck.success).toBe(true);

      // Brief wait to ensure no leak
      await new Promise((r) => setTimeout(r, 100));
      expect(receivedByUnrelated).toBe(false);
    });

    it("invalid or unauthorized message is NOT broadcast", async () => {
      const patientClient = createClientSocket(patient1Token);
      const doctorClient = createClientSocket(doctor1Token);

      await waitForConnect(patientClient);
      await waitForConnect(doctorClient);

      await emitWithAck(
        doctorClient,
        "join_room",
        `consultation:${consultationActive._id.toString()}`
      );

      let broadcastReceived = false;
      doctorClient.on("new_message", () => {
        broadcastReceived = true;
      });

      // Send empty message (invalid)
      const ack = await emitWithAck(patientClient, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "   ",
      });
      expect(ack.success).toBe(false);
      expect(ack.code).toBe("VALIDATION_ERROR");

      await new Promise((r) => setTimeout(r, 100));
      expect(broadcastReceived).toBe(false);
    });
  });

  // =========================================================================
  // C. Authorization
  // =========================================================================
  describe("C. Authorization", () => {
    it("authorized doctor participant can send messages", async () => {
      const client = createClientSocket(doctor1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Hello patient, I am reviewing your chart now.",
      });

      expect(ack.success).toBe(true);
      expect(ack.data.senderRole).toBe(UserRole.DOCTOR);
      expect(ack.data.senderId).toBe(doctor1._id.toString());
    });

    it("authenticated nonparticipant cannot send messages (rejected with CHAT_ACCESS_DENIED)", async () => {
      // Patient 2 is not part of consultationActive
      const client = createClientSocket(patient2Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Intruding into another patient's consultation",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CHAT_ACCESS_DENIED");

      // Verify no message was persisted
      const count = await Message.countDocuments({
        consultationId: consultationActive._id,
        text: "Intruding into another patient's consultation",
      });
      expect(count).toBe(0);
    });

    it("unassigned doctor cannot send messages to another doctor's consultation", async () => {
      // Doctor 2 is not assigned to consultationActive
      const client = createClientSocket(doctor2Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Doctor 2 trying to message Doctor 1's patient",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CHAT_ACCESS_DENIED");
    });

    it("nonexistent consultation returns CONVERSATION_NOT_FOUND", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const fakeId = new mongoose.Types.ObjectId().toString();
      const ack = await emitWithAck(client, "send_message", {
        consultationId: fakeId,
        text: "Message to nowhere",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CONVERSATION_NOT_FOUND");
    });

    it("malformed consultation ID returns VALIDATION_ERROR", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: "not-an-objectid",
        text: "Malformed ID test",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("VALIDATION_ERROR");
    });
  });

  // =========================================================================
  // D. Time-Window Boundaries
  // =========================================================================
  describe("D. Time-Window Boundaries", () => {
    it("rejects message before opening window (before scheduledStart - 15m)", async () => {
      // Future consultation starts in 60m. Window opens in 45m.
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationFuture._id.toString(),
        text: "Too early to chat",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CHAT_ACCESS_DENIED");
      expect(ack.error).toContain("opens 15 minutes before");
    });

    it("allows message exactly at opening boundary (scheduledStart - 15m)", async () => {
      const scheduledStart = appointmentFuture.scheduledStart;
      const exactOpening = new Date(scheduledStart.getTime() - 15 * 60 * 1000);

      // Verify service layer directly with injected boundary time
      const result = await chatService.sendMessage(
        { id: patient1._id.toString(), role: UserRole.PATIENT },
        {
          consultationId: consultationFuture._id.toString(),
          text: "Message sent right as chat window opens",
          now: exactOpening,
        }
      );

      expect(result).toBeDefined();
      expect(result.text).toBe("Message sent right as chat window opens");
    });

    it("rejects message 1ms before opening boundary", async () => {
      const scheduledStart = appointmentFuture.scheduledStart;
      const oneMsBefore = new Date(scheduledStart.getTime() - 15 * 60 * 1000 - 1);

      await expect(
        chatService.sendMessage(
          { id: patient1._id.toString(), role: UserRole.PATIENT },
          {
            consultationId: consultationFuture._id.toString(),
            text: "Too early by 1ms",
            now: oneMsBefore,
          }
        )
      ).rejects.toMatchObject({
        code: "CHAT_ACCESS_DENIED",
      });
    });

    it("allows message inside the active consultation window", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Inside window message",
      });

      expect(ack.success).toBe(true);
    });

    it("allows message inside 24-hour post-completion window", async () => {
      // consultationCompleted ended 2 hours ago (within 24h window)
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationCompleted._id.toString(),
        text: "Post-consultation follow-up question within 24h",
      });

      expect(ack.success).toBe(true);
      expect(ack.data.text).toBe("Post-consultation follow-up question within 24h");
    });

    it("allows message exactly at closing boundary (completedAt + 24h)", async () => {
      const completedAt = consultationCompleted.endedAt;
      const exactClosing = new Date(completedAt.getTime() + 24 * 60 * 60 * 1000);

      const result = await chatService.sendMessage(
        { id: patient1._id.toString(), role: UserRole.PATIENT },
        {
          consultationId: consultationCompleted._id.toString(),
          text: "Message sent at exact 24h closing mark",
          now: exactClosing,
        }
      );

      expect(result).toBeDefined();
      expect(result.text).toBe("Message sent at exact 24h closing mark");
    });

    it("rejects message 1ms after closing boundary (completedAt + 24h + 1ms)", async () => {
      const completedAt = consultationCompleted.endedAt;
      const oneMsAfter = new Date(completedAt.getTime() + 24 * 60 * 60 * 1000 + 1);

      await expect(
        chatService.sendMessage(
          { id: patient1._id.toString(), role: UserRole.PATIENT },
          {
            consultationId: consultationCompleted._id.toString(),
            text: "Message after closing window",
            now: oneMsAfter,
          }
        )
      ).rejects.toMatchObject({
        code: "CHAT_ACCESS_DENIED",
      });
    });

    it("rejects message for expired consultation (> 24h completed)", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationExpired._id.toString(),
        text: "Follow-up question after 26 hours",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CHAT_ACCESS_DENIED");
      expect(ack.error).toContain("closed 24 hours after completion");
    });

    it("rejects message for cancelled consultation", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationCancelled._id.toString(),
        text: "Message for cancelled appointment",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CHAT_ACCESS_DENIED");
      expect(ack.error).toContain("cancelled or rejected");
    });
  });

  // =========================================================================
  // E. Validation and Sanitization
  // =========================================================================
  describe("E. Validation and Sanitization", () => {
    it("rejects empty or whitespace-only message with VALIDATION_ERROR", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "      ",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("VALIDATION_ERROR");
    });

    it("accepts message of exactly 2,000 characters", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const text2000 = "a".repeat(2000);
      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: text2000,
      });

      expect(ack.success).toBe(true);
      expect(ack.data.text.length).toBe(2000);
    });

    it("rejects message exceeding 2,000 characters with CHAT_MESSAGE_TOO_LONG", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const text2001 = "a".repeat(2001);
      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: text2001,
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("CHAT_MESSAGE_TOO_LONG");
    });

    it("sanitizes script tag payload and strips dangerous markup before persistence", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Hello Doctor! <script>alert('xss')</script> How are you?",
      });

      expect(ack.success).toBe(true);
      expect(ack.data.text).toBe("Hello Doctor!  How are you?");
      expect(ack.data.text).not.toContain("<script>");

      // Verify in DB
      const dbMsg = await Message.findById(ack.data.id);
      expect(dbMsg!.text).toBe("Hello Doctor!  How are you?");
    });

    it("sanitizes event-handler attributes (e.g. onerror, onclick)", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "Check this <img src=x onerror=alert(1)> and <b onclick=evil()>bold</b> text",
      });

      expect(ack.success).toBe(true);
      expect(ack.data.text).toBe("Check this  and bold text");
      expect(ack.data.text).not.toContain("onerror");
      expect(ack.data.text).not.toContain("onclick");
    });

    it("sanitizes dangerous javascript: URI links", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: '<a href="javascript:alert(1)">Click for report</a>',
      });

      expect(ack.success).toBe(true);
      expect(ack.data.text).toBe("Click for report");
      expect(ack.data.text).not.toContain("javascript:");
    });

    it("rejects messages when sanitization results in empty content", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: "<script>alert('xss')</script>",
      });

      expect(ack.success).toBe(false);
      expect(ack.code).toBe("VALIDATION_ERROR");
      expect(ack.error).toContain("Message cannot be empty or contain only invalid markup");
    });

    it("preserves legitimate punctuation, multilingual text, and Unicode emoji", async () => {
      const client = createClientSocket(patient1Token);
      await waitForConnect(client);

      const richText = "Bonjour docteur! नमस्ते! 😊 💊 What is the dosage?";
      const ack = await emitWithAck(client, "send_message", {
        consultationId: consultationActive._id.toString(),
        text: richText,
      });

      expect(ack.success).toBe(true);
      expect(ack.data.text).toBe(richText);

      const dbMsg = await Message.findById(ack.data.id);
      expect(dbMsg!.text).toBe(richText);
    });
  });

  // =========================================================================
  // F. REST Pagination (GET /api/v1/conversations/:id/messages)
  // =========================================================================
  describe("F. REST Pagination (GET /api/v1/conversations/:id/messages)", () => {
    it("authorized participant retrieves historical messages with default pagination", async () => {
      // Seed 5 messages
      for (let i = 1; i <= 5; i++) {
        await Message.create({
          consultationId: consultationActive._id,
          senderId: patient1._id,
          senderRole: UserRole.PATIENT,
          text: `Message number ${i}`,
          createdAt: new Date(Date.now() + i * 1000),
        });
      }

      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(5);
      expect(res.body.data[0].text).toBe("Message number 1");
      expect(res.body.data[4].text).toBe("Message number 5");
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.hasMore).toBe(false);
    });

    it("authorized doctor participant can also retrieve chat history", async () => {
      await Message.create({
        consultationId: consultationActive._id,
        senderId: patient1._id,
        senderRole: UserRole.PATIENT,
        text: "Doctor, here is my symptom history.",
      });

      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages`)
        .set("Authorization", `Bearer ${doctor1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].text).toBe("Doctor, here is my symptom history.");
    });

    it("unrelated user cannot retrieve another consultation's history (403 CHAT_ACCESS_DENIED)", async () => {
      await Message.create({
        consultationId: consultationActive._id,
        senderId: patient1._id,
        senderRole: UserRole.PATIENT,
        text: "Secret medical chat",
      });

      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages`)
        .set("Authorization", `Bearer ${patient2Token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CHAT_ACCESS_DENIED");
    });

    it("unauthenticated request returns 401 AUTH_TOKEN_MISSING", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("AUTH_TOKEN_MISSING");
    });

    it("oversized limit (> 100) is rejected with 400 VALIDATION_ERROR", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages?limit=250`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("cursor pagination with 'before' returns correct earlier messages", async () => {
      // Seed 10 messages with sequential timestamps
      const createdIds: string[] = [];
      const baseTime = Date.now();
      for (let i = 1; i <= 10; i++) {
        const msg = await Message.create({
          consultationId: consultationActive._id,
          senderId: patient1._id,
          senderRole: UserRole.PATIENT,
          text: `Sequential msg ${i}`,
          createdAt: new Date(baseTime + i * 1000),
        });
        createdIds.push(msg._id.toString());
      }

      // Page 1: limit 5 (should return latest 5: msgs 6..10)
      const res1 = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages?limit=5`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res1.status).toBe(200);
      expect(res1.body.data.length).toBe(5);
      expect(res1.body.data[0].text).toBe("Sequential msg 6");
      expect(res1.body.data[4].text).toBe("Sequential msg 10");
      expect(res1.body.meta.hasMore).toBe(true);
      expect(res1.body.meta.nextCursor).toBeDefined();

      const cursor = res1.body.meta.nextCursor;

      // Page 2: limit 5 before cursor (should return msgs 1..5)
      const res2 = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages?limit=5&before=${cursor}`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.length).toBe(5);
      expect(res2.body.data[0].text).toBe("Sequential msg 1");
      expect(res2.body.data[4].text).toBe("Sequential msg 5");
      expect(res2.body.meta.hasMore).toBe(false);
    });

    it("equal timestamps do not cause duplicate or skipped messages (compound sorting)", async () => {
      const fixedTime = new Date("2026-10-18T10:00:00.000Z");
      const msg1 = await Message.create({
        consultationId: consultationActive._id,
        senderId: patient1._id,
        senderRole: UserRole.PATIENT,
        text: "Tie msg 1",
        createdAt: fixedTime,
      });
      const msg2 = await Message.create({
        consultationId: consultationActive._id,
        senderId: patient1._id,
        senderRole: UserRole.PATIENT,
        text: "Tie msg 2",
        createdAt: fixedTime,
      });
      const msg3 = await Message.create({
        consultationId: consultationActive._id,
        senderId: patient1._id,
        senderRole: UserRole.PATIENT,
        text: "Tie msg 3",
        createdAt: fixedTime,
      });

      // Request limit 2
      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages?limit=2`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);

      const nextCursor = res.body.meta.nextCursor;
      expect(nextCursor).toBeDefined();

      const resNext = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages?limit=2&before=${nextCursor}`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(resNext.status).toBe(200);
      expect(resNext.body.data.length).toBe(1);

      // Verify all 3 unique IDs were received with 0 overlap
      const combinedIds = [...res.body.data, ...resNext.body.data].map((m: any) => m.id);
      expect(new Set(combinedIds).size).toBe(3);
    });

    it("empty history returns empty array with hasMore=false", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${consultationActive._id}/messages`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.hasMore).toBe(false);
      expect(res.body.meta.nextCursor).toBeNull();
    });

    it("REST history respects the chat time window (rejected if window closed)", async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${consultationExpired._id}/messages`)
        .set("Authorization", `Bearer ${patient1Token}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("CHAT_ACCESS_DENIED");
      expect(res.body.error.message).toContain("closed 24 hours after completion");
    });
  });
});
