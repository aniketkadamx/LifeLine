import http from "node:http";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
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
  Notification,
  DoctorProfile,
  Appointment,
  Consultation,
  Prescription,
  Order,
  Medicine,
  Inventory,
  Payment,
  PharmacyProfile,
} from "../src/models/index.js";
import {
  UserRole,
  UserStatus,
  NotificationType,
  DoctorVerificationStatus,
  PharmacyVerificationStatus,
  AppointmentStatus,
  ConsultationType,
  ConsultationStatus,
  OrderStatus,
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  DosageForm,
  MedicineRoute,
} from "../src/types/models.js";
import { tokenService } from "../src/services/token.service.js";
import { notificationService } from "../src/services/notification.service.js";
import {
  resendClient,
  escapeHtml,
  generateNotificationEmailHtml,
} from "../src/integrations/email/resend.client.js";
import { orderService } from "../src/services/order.service.js";
import { prescriptionService } from "../src/services/prescription.service.js";
import { paymentService } from "../src/services/payment.service.js";

describe("Milestone 11 - Task 11.3: Multi-Channel Notification Dispatcher", () => {
  let server: http.Server;
  let serverPort: number;
  let activeClients: ClientSocket[] = [];

  // Test users
  let patientUser: any;
  let patientToken: string;

  let otherPatientUser: any;
  let otherPatientToken: string;

  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  let pharmacistUser: any;
  let pharmacyProfile: any;
  let pharmacistToken: string;

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

  beforeAll(async () => {
    await connectDatabase(
      "mongodb://127.0.0.1:27017/lifeline_notification_dispatcher_test"
    );
    await User.syncIndexes();
    await Notification.syncIndexes();
    await DoctorProfile.syncIndexes();
    await PharmacyProfile.syncIndexes();
    await Appointment.syncIndexes();
    await Consultation.syncIndexes();
    await Prescription.syncIndexes();
    await Order.syncIndexes();
    await Payment.syncIndexes();

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
    // Disconnect any active sockets from previous test
    for (const client of activeClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    activeClients = [];

    // Reset database collections
    await Notification.deleteMany({});
    await Payment.deleteMany({});
    await Order.deleteMany({});
    await Prescription.deleteMany({});
    await Consultation.deleteMany({});
    await Appointment.deleteMany({});
    await Medicine.deleteMany({});
    await Inventory.deleteMany({});
    await DoctorProfile.deleteMany({});
    await PharmacyProfile.deleteMany({});
    await User.deleteMany({});

    // 1. Create Patient User
    patientUser = await User.create({
      email: `patient.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Alice Patient",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    patientToken = tokenService.generateAccessToken(patientUser.id, patientUser.role);

    // 2. Create Unrelated Second Patient User
    otherPatientUser = await User.create({
      email: `other.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Bob Unrelated",
      role: UserRole.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    otherPatientToken = tokenService.generateAccessToken(otherPatientUser.id, otherPatientUser.role);

    // 3. Create Doctor User & Profile
    doctorUser = await User.create({
      email: `doctor.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "Dr. Gregory House",
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    doctorToken = tokenService.generateAccessToken(doctorUser.id, doctorUser.role);

    doctorProfile = await DoctorProfile.create({
      userId: doctorUser._id,
      specialization: "General Practice",
      qualifications: ["MBBS"],
      experienceYears: 10,
      registrationNumber: `REG-${Date.now()}`,
      registrationCouncil: "State Medical Council",
      consultationFee: 75,
      verificationStatus: DoctorVerificationStatus.APPROVED_VERIFIED,
    });
    doctorUser.doctorProfile = doctorProfile._id;
    await doctorUser.save();

    // 4. Create Pharmacist User & Profile
    pharmacistUser = await User.create({
      email: `pharmacy.${Date.now()}.${Math.random()}@example.com`,
      phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      passwordHash: "$2b$12$DummyPasswordHashValueForTestPurposesOnly1234567890",
      fullName: "City Pharmacy Staff",
      role: UserRole.PHARMACY,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });
    pharmacistToken = tokenService.generateAccessToken(pharmacistUser.id, pharmacistUser.role);

    pharmacyProfile = await PharmacyProfile.create({
      userId: pharmacistUser._id,
      pharmacyName: "City Care Pharmacy",
      ownerName: "Pharmacist Staff",
      licenseNumber: `DL-${Date.now()}`,
      address: {
        street: "456 Market St",
        city: "New York",
        state: "NY",
        postalCode: "10002",
        country: "US",
      },
      phone: "+15559876543",
      verificationStatus: PharmacyVerificationStatus.APPROVED_VERIFIED,
    });
    pharmacistUser.pharmacyProfile = pharmacyProfile._id;
    await pharmacistUser.save();
  });

  describe("Section 1: Notification Persistence", () => {
    it("should persist an in-app notification in MongoDB with all required fields", async () => {
      const relatedId = new mongoose.Types.ObjectId();
      const notification = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Appointment Confirmed",
        message: "Your consultation with Dr. House is scheduled.",
        relatedEntityType: "Appointment",
        relatedEntityId: relatedId,
        metadata: { appointmentId: relatedId.toString() },
      });

      expect(notification).toBeDefined();
      expect(notification._id).toBeDefined();
      expect(notification.userId.toString()).toBe(patientUser._id.toString());
      expect(notification.type).toBe(NotificationType.APPOINTMENT_CONFIRMED);
      expect(notification.title).toBe("Appointment Confirmed");
      expect(notification.message).toBe("Your consultation with Dr. House is scheduled.");
      expect(notification.isRead).toBe(false);
      expect(notification.readAt).toBeUndefined();
      expect(notification.relatedEntityType).toBe("Appointment");
      expect(notification.relatedEntityId?.toString()).toBe(relatedId.toString());

      // Verify in MongoDB
      const found = await Notification.findById(notification._id);
      expect(found).not.toBeNull();
      expect(found?.userId.toString()).toBe(patientUser._id.toString());
      expect(found?.isRead).toBe(false);
    });

    it("should reject dispatch if recipient does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      await expect(
        notificationService.dispatch({
          userId: nonExistentId,
          type: NotificationType.PRESCRIPTION_ISSUED,
          title: "Prescription Ready",
          message: "A new prescription has been issued.",
        })
      ).rejects.toThrow(/not found/i);

      const count = await Notification.countDocuments();
      expect(count).toBe(0);
    });

    it("should reject dispatch if recipient ID format is invalid", async () => {
      await expect(
        notificationService.dispatch({
          userId: "invalid-hex-id",
          type: NotificationType.ORDER_DELIVERED,
          title: "Delivered",
          message: "Delivered",
        })
      ).rejects.toThrow(/invalid recipient/i);
    });
  });

  describe("Section 2: Private Socket.IO Channel Delivery", () => {
    it("should emit notification:new to exactly the recipient's private user:<id> room", async () => {
      const recipientSocket = createClientSocket(patientToken);
      const unrelatedSocket = createClientSocket(otherPatientToken);

      await waitForConnect(recipientSocket);
      await waitForConnect(unrelatedSocket);

      const recipientEvents: any[] = [];
      const unrelatedEvents: any[] = [];

      recipientSocket.on("notification:new", (data) => recipientEvents.push(data));
      unrelatedSocket.on("notification:new", (data) => unrelatedEvents.push(data));

      await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Private Notice",
        message: "Only Alice should see this.",
      });

      // Wait briefly for socket delivery
      await new Promise((r) => setTimeout(r, 200));

      expect(recipientEvents.length).toBe(1);
      expect(recipientEvents[0].title).toBe("Private Notice");
      expect(recipientEvents[0].userId).toBe(patientUser._id.toString());
      expect(recipientEvents[0].type).toBe(NotificationType.APPOINTMENT_CONFIRMED);

      // Unrelated user must receive 0 events
      expect(unrelatedEvents.length).toBe(0);
    });

    it("should ensure socket delivery failure does not roll back or disrupt persistence", async () => {
      // Disconnect all sockets to simulate disconnected state
      for (const client of activeClients) {
        client.disconnect();
      }

      const notification = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.PRESCRIPTION_ISSUED,
        title: "Prescription Issued Offline",
        message: "Patient is offline right now.",
      });

      expect(notification).toBeDefined();
      const inDb = await Notification.findById(notification._id);
      expect(inDb).not.toBeNull();
      expect(inDb?.title).toBe("Prescription Issued Offline");
    });
  });

  describe("Section 3: Email Delivery Integration (Resend Client)", () => {
    it("should escape HTML tags in untrusted user strings to prevent XSS in email templates", () => {
      const malicious = '<script>alert("xss")</script> & "quotes" \'apostrophe\'';
      const safe = escapeHtml(malicious);
      expect(safe).not.toContain("<script>");
      expect(safe).toContain("&lt;script&gt;");
      expect(safe).toContain("&amp;");
      expect(safe).toContain("&quot;");
      expect(safe).toContain("&#39;");

      const emailHtml = generateNotificationEmailHtml({
        title: malicious,
        message: "<b>Bold message</b>",
      });
      expect(emailHtml).not.toContain("<script>");
      expect(emailHtml).toContain("&lt;b&gt;Bold message&lt;/b&gt;");
    });

    it("should trigger async email delivery via Resend client without blocking the caller", async () => {
      const sendEmailSpy = vi.spyOn(resendClient, "sendEmail").mockResolvedValue({
        success: true,
        messageId: "mock_resend_msg_123",
      });

      const notification = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.ORDER_DELIVERED,
        title: "Order Delivered",
        message: "Your medicines have arrived at your door.",
        channels: ["IN_APP", "EMAIL"],
      });

      expect(notification).toBeDefined();

      // Wait a tick for async dispatch to execute
      await new Promise((r) => setTimeout(r, 100));

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      const callArgs = sendEmailSpy.mock.calls[0][0];
      expect(callArgs.to).toBe(patientUser.email);
      expect(callArgs.subject).toContain("Order Delivered");
      expect(callArgs.text).toBe("Your medicines have arrived at your door.");
      expect(callArgs.html).toContain("Your medicines have arrived at your door.");

      sendEmailSpy.mockRestore();
    });

    it("should ensure email delivery failure does not fail or rollback the business notification", async () => {
      const sendEmailSpy = vi.spyOn(resendClient, "sendEmail").mockRejectedValue(
        new Error("Resend network timeout / rate limited")
      );

      const notification = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Appointment Notice",
        message: "Network might be down but in-app notification should persist.",
        channels: ["IN_APP", "EMAIL"],
      });

      expect(notification).toBeDefined();
      const inDb = await Notification.findById(notification._id);
      expect(inDb).not.toBeNull();
      expect(inDb?.title).toBe("Appointment Notice");

      sendEmailSpy.mockRestore();
    });

    it("should skip email delivery gracefully if Resend credentials are not configured", async () => {
      // By default in test environment without RESEND_API_KEY, isReady() is false
      const result = await resendClient.sendEmail({
        to: "someone@example.com",
        subject: "Test",
        text: "Test content",
      });

      if (!resendClient.isReady()) {
        expect(result.success).toBe(false);
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe("RESEND_NOT_CONFIGURED");
      }
    });
  });

  describe("Section 4: REST API (GET /api/v1/notifications & PATCH /api/v1/notifications/:id/read)", () => {
    it("should return 401 for unauthenticated requests", async () => {
      const getRes = await request(app).get("/api/v1/notifications");
      expect(getRes.status).toBe(401);

      const patchRes = await request(app)
        .patch(`/api/v1/notifications/${new mongoose.Types.ObjectId()}/read`);
      expect(patchRes.status).toBe(401);
    });

    it("should allow an authenticated user to list only their own notifications in reverse chronological order", async () => {
      // Create 3 notifications for patientUser
      const notif1 = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "First Notification",
        message: "First message",
      });

      const notif2 = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.PRESCRIPTION_ISSUED,
        title: "Second Notification",
        message: "Second message",
      });

      // Create 1 notification for otherPatientUser
      await notificationService.dispatch({
        userId: otherPatientUser._id.toString(),
        type: NotificationType.ORDER_DELIVERED,
        title: "Other User Notice",
        message: "Secret for Bob",
      });

      const res = await request(app)
        .get("/api/v1/notifications")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta.total).toBe(2);

      // Verify reverse chronological order (newest first)
      const firstId = res.body.data[0].id || res.body.data[0]._id;
      const secondId = res.body.data[1].id || res.body.data[1]._id;
      expect(firstId).toBe(notif2._id.toString());
      expect(secondId).toBe(notif1._id.toString());

      // Ensure Bob's notification is not present
      const hasOther = res.body.data.some(
        (n: any) =>
          n.userId === otherPatientUser._id.toString() ||
          n.title === "Other User Notice"
      );
      expect(hasOther).toBe(false);
    });

    it("should support filtering by unreadOnly=true", async () => {
      const notif1 = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Read Notice",
        message: "This will be read",
      });
      await notificationService.markAsRead(patientUser._id.toString(), notif1._id.toString());

      await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.PRESCRIPTION_ISSUED,
        title: "Unread Notice",
        message: "Still unread",
      });

      const res = await request(app)
        .get("/api/v1/notifications?unreadOnly=true")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].title).toBe("Unread Notice");
      expect(res.body.data[0].isRead).toBe(false);
    });

    it("should support bounded pagination parameters", async () => {
      // Create 5 notifications
      for (let i = 1; i <= 5; i++) {
        await notificationService.dispatch({
          userId: patientUser._id.toString(),
          type: NotificationType.SYSTEM_ALERT,
          title: `Alert ${i}`,
          message: `Alert content ${i}`,
        });
      }

      const resPage1 = await request(app)
        .get("/api/v1/notifications?page=1&limit=2")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data.length).toBe(2);
      expect(resPage1.body.meta.page).toBe(1);
      expect(resPage1.body.meta.limit).toBe(2);
      expect(resPage1.body.meta.total).toBe(5);

      const resPage2 = await request(app)
        .get("/api/v1/notifications?page=2&limit=2")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data.length).toBe(2);
      expect(resPage2.body.meta.page).toBe(2);
    });

    it("should reject invalid pagination parameters with validation error", async () => {
      const res = await request(app)
        .get("/api/v1/notifications?limit=500")
        .set("Authorization", `Bearer ${patientToken}`);

      expect([400, 422]).toContain(res.status);
    });

    it("should allow owner to mark notification as read and ensure idempotency", async () => {
      const notif = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.PRESCRIPTION_ISSUED,
        title: "Prescription Ready",
        message: "Take 1 pill daily",
      });

      expect(notif.isRead).toBe(false);
      expect(notif.readAt).toBeUndefined();

      // First call: mark as read
      const patchRes1 = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(patchRes1.status).toBe(200);
      expect(patchRes1.body.success).toBe(true);
      expect(patchRes1.body.data.isRead).toBe(true);
      expect(patchRes1.body.data.readAt).toBeDefined();

      const firstReadAt = patchRes1.body.data.readAt;

      // Second call: idempotent, retains existing readAt
      const patchRes2 = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(patchRes2.status).toBe(200);
      expect(patchRes2.body.data.isRead).toBe(true);
      expect(patchRes2.body.data.readAt).toBe(firstReadAt);
    });

    it("should deny access with 403 Forbidden when a user tries to mark another user's notification as read", async () => {
      const notif = await notificationService.dispatch({
        userId: patientUser._id.toString(),
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Alice's Notice",
        message: "Confidential appointment info",
      });

      // otherPatient tries to mark Alice's notification as read
      const res = await request(app)
        .patch(`/api/v1/notifications/${notif._id}/read`)
        .set("Authorization", `Bearer ${otherPatientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);

      // Verify the notification remains unread in the database
      const inDb = await Notification.findById(notif._id);
      expect(inDb?.isRead).toBe(false);
    });

    it("should return 404 when notification ID does not exist", async () => {
      const nonExistentId = new mongoose.Types.ObjectId();
      const res = await request(app)
        .patch(`/api/v1/notifications/${nonExistentId}/read`)
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(404);
    });

    it("should return 400 when notification ID is malformed", async () => {
      const res = await request(app)
        .patch("/api/v1/notifications/not-a-valid-mongo-id/read")
        .set("Authorization", `Bearer ${patientToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe("Section 5: Business Event Integrations", () => {
    it("should trigger ORDER_DELIVERED notification upon successful OTP delivery verification", async () => {
      // Create medicine & inventory
      const medicine = await Medicine.create({
        name: "Amoxicillin 500mg",
        brandName: "Amoxil",
        genericName: "Amoxicillin",
        category: "Antibiotics",
        strength: "500mg",
        dosageForm: DosageForm.CAPSULE,
        manufacturer: "GlaxoSmithKline",
        prescriptionRequired: false,
        isActive: true,
      });

      const inventory = await Inventory.create({
        pharmacyId: pharmacyProfile._id,
        medicineId: medicine._id,
        quantity: 100,
        reservedQuantity: 0,
        batchNumber: "BAT-101",
        expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
        price: 20,
        isActive: true,
      });

      // Create an order in OUT_FOR_DELIVERY state with an OTP
      const plainOtp = "456789";
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plainOtp)
        .digest("hex");

      const order = await Order.create({
        patientId: patientUser._id,
        pharmacyId: pharmacyProfile._id,
        items: [
          {
            medicineId: medicine._id,
            medicineName: medicine.name,
            quantity: 2,
            unitPrice: 20.0,
            totalPrice: 40.0,
          },
        ],
        paymentStatus: "PAID",
        status: OrderStatus.OUT_FOR_DELIVERY,
        deliveryAddress: {
          recipientName: "Alice Patient",
          phone: "+15551234567",
          street: "123 Main St",
          city: "New York",
          state: "NY",
          postalCode: "10001",
          country: "US",
        },
        totals: { subtotal: 40, deliveryFee: 0, totalAmount: 40 },
        currency: "INR",
        deliveryOtp: hashedOtp,
        deliveryOtpExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        deliveryOtpAttempts: 0,
      });

      // Dispatch spy to verify notificationService.dispatch is called
      const dispatchSpy = vi.spyOn(notificationService, "dispatch");

      const deliveredOrder = await orderService.updateOrderStatus(
        {
          id: pharmacistUser.id,
          role: UserRole.PHARMACY,
          email: pharmacistUser.email,
        } as any,
        order._id.toString(),
        {
          status: OrderStatus.DELIVERED,
          deliveryOtp: plainOtp,
        }
      );

      expect(deliveredOrder.status).toBe(OrderStatus.DELIVERED);

      // Await brief microtask tick for fire-and-forget dispatch to finish persistence
      await new Promise((r) => setTimeout(r, 100));

      // Verify notification was dispatched for ORDER_DELIVERED
      expect(dispatchSpy).toHaveBeenCalled();
      const lastCall = dispatchSpy.mock.calls.find(
        (c) => c[0].type === NotificationType.ORDER_DELIVERED
      );
      expect(lastCall).toBeDefined();
      expect(lastCall![0].userId.toString()).toBe(patientUser._id.toString());
      expect(lastCall![0].title).toBe("Order Delivered");

      // Verify notification persisted in database for patient
      const notif = await Notification.findOne({
        userId: patientUser._id,
        type: NotificationType.ORDER_DELIVERED,
      });
      expect(notif).not.toBeNull();
      expect(notif?.relatedEntityId?.toString()).toBe(order._id.toString());

      dispatchSpy.mockRestore();
    });

    it("should trigger PRESCRIPTION_ISSUED notification upon doctor issuing prescription", async () => {
      // Create scheduled appointment & consultation
      const appointment = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        scheduledStart: new Date(Date.now() - 30 * 60 * 1000),
        scheduledEnd: new Date(Date.now() + 30 * 60 * 1000),
        appointmentType: ConsultationType.VIDEO,
        status: AppointmentStatus.CONFIRMED,
        reason: "Clinical Follow-up",
        fee: 75,
      });

      const consultation = await Consultation.create({
        appointmentId: appointment._id,
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        consultationType: ConsultationType.VIDEO,
        status: ConsultationStatus.IN_CONSULTATION,
        roomId: "room_test_123",
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
      });

      const medicine = await Medicine.create({
        name: "Azithromycin 500mg",
        genericName: "Azithromycin",
        brandName: "Zithromax",
        manufacturer: "Pfizer",
        dosageForm: DosageForm.TABLET,
        strength: "500mg",
        category: "Antibiotics",
        prescriptionRequired: true,
        isActive: true,
      });

      const dispatchSpy = vi.spyOn(notificationService, "dispatch");

      const prescription = await prescriptionService.issuePrescription(
        {
          id: doctorUser.id,
          role: UserRole.DOCTOR,
          email: doctorUser.email,
        } as any,
        {
          appointmentId: appointment._id.toString(),
          consultationId: consultation._id.toString(),
          diagnosis: "Acute Bronchitis",
          medicines: [
            {
              medicineId: medicine._id.toString(),
              medicineName: "Azithromycin 500mg",
              dosage: "500mg",
              frequency: "Once daily",
              durationDays: 5,
              quantity: 5,
              route: MedicineRoute.ORAL,
              specialInstructions: "Take with food",
            },
          ],
        }
      );

      expect(prescription).toBeDefined();

      // Await brief microtask tick for fire-and-forget dispatch to finish persistence
      await new Promise((r) => setTimeout(r, 100));

      // Verify notificationService.dispatch was called with PRESCRIPTION_ISSUED
      expect(dispatchSpy).toHaveBeenCalled();
      const lastCall = dispatchSpy.mock.calls.find(
        (c) => c[0].type === NotificationType.PRESCRIPTION_ISSUED
      );
      expect(lastCall).toBeDefined();
      expect(lastCall![0].userId.toString()).toBe(patientUser._id.toString());
      expect(lastCall![0].title).toBe("Digital Prescription Issued");

      // Verify notification persisted in DB
      const notif = await Notification.findOne({
        userId: patientUser._id,
        type: NotificationType.PRESCRIPTION_ISSUED,
      });
      expect(notif).not.toBeNull();
      expect(notif?.relatedEntityId?.toString()).toBe(prescription._id.toString());

      dispatchSpy.mockRestore();
    });

    it("should trigger APPOINTMENT_CONFIRMED notification upon appointment payment confirmation", async () => {
      const scheduledStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const scheduledEnd = new Date(scheduledStart.getTime() + 30 * 60 * 1000);

      const appointment = await Appointment.create({
        patientId: patientUser._id,
        doctorId: doctorUser._id,
        scheduledStart,
        scheduledEnd,
        appointmentType: ConsultationType.VIDEO,
        status: AppointmentStatus.PENDING_PAYMENT,
        reason: "General Consultation",
        fee: 75,
        currency: "INR",
        lockExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      const orderId = `order_test_${Date.now()}`;
      await Payment.create({
        userId: patientUser._id,
        targetType: PaymentTargetType.APPOINTMENT,
        targetId: appointment._id,
        amount: appointment.fee,
        currency: appointment.currency,
        status: PaymentStatus.CREATED,
        provider: PaymentProvider.RAZORPAY,
        referenceId: `PAY-${Date.now()}-TEST`,
        providerOrderId: orderId,
      });

      const webhookSecret = "test_webhook_secret_key_1234567890";
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const payloadString = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_test_capture_123",
              order_id: orderId,
              amount: 7500, // 75 * 100 subunits for INR
              currency: "INR",
              status: "captured",
            },
          },
        },
      });
      const rawBody = Buffer.from(payloadString);
      const signature = crypto
        .createHmac("sha256", webhookSecret)
        .update(rawBody)
        .digest("hex");

      const dispatchSpy = vi.spyOn(notificationService, "dispatch");

      await paymentService.handleRazorpayWebhook(rawBody, signature);

      // Await brief microtask tick for fire-and-forget dispatch to finish persistence
      await new Promise((r) => setTimeout(r, 100));

      // Verify appointment is now CONFIRMED
      const updatedAppt = await Appointment.findById(appointment._id);
      expect(updatedAppt?.status).toBe(AppointmentStatus.CONFIRMED);

      // Verify notification was dispatched for APPOINTMENT_CONFIRMED
      expect(dispatchSpy).toHaveBeenCalled();
      const lastCall = dispatchSpy.mock.calls.find(
        (c) => c[0].type === NotificationType.APPOINTMENT_CONFIRMED
      );
      expect(lastCall).toBeDefined();
      expect(lastCall![0].userId.toString()).toBe(patientUser._id.toString());
      expect(lastCall![0].title).toBe("Appointment Confirmed");

      // Verify notification persisted in DB
      const notif = await Notification.findOne({
        userId: patientUser._id,
        type: NotificationType.APPOINTMENT_CONFIRMED,
      });
      expect(notif).not.toBeNull();
      expect(notif?.relatedEntityId?.toString()).toBe(appointment._id.toString());

      dispatchSpy.mockRestore();
    });
  });
});
