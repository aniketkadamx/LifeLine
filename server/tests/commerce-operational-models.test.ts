import { describe, it, expect } from "vitest";
import mongoose from "mongoose";
import {
  Medicine,
  Inventory,
  Order,
  Payment,
  AuditLog,
  Notification,
  Review,
  Complaint,
  DosageForm,
  OrderStatus,
  PaymentStatus,
  PaymentTargetType,
  PaymentProvider,
  AuditAction,
  NotificationType,
  ReviewStatus,
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
} from "../src/models/index.js";

describe("Commerce & Operational Mongoose Models (Task 1.4)", () => {
  describe("Medicine Model", () => {
    it("should instantiate a valid Medicine document with expected defaults", () => {
      const medicine = new Medicine({
        name: "Amoxicillin 500mg",
        genericName: "Amoxicillin Trihydrate",
        brandName: "Amoxil",
        manufacturer: "GlaxoSmithKline",
        dosageForm: DosageForm.CAPSULE,
        strength: "500mg",
        category: "ANTIBIOTICS",
        description: "Broad-spectrum penicillin antibiotic",
        prescriptionRequired: true,
      });

      expect(medicine.name).toBe("Amoxicillin 500mg");
      expect(medicine.dosageForm).toBe(DosageForm.CAPSULE);
      expect(medicine.prescriptionRequired).toBe(true);
      expect(medicine.isActive).toBe(true); // default

      const err = medicine.validateSync();
      expect(err).toBeUndefined();
    });

    it("should provide default values for prescriptionRequired and isActive", () => {
      const medicine = new Medicine({
        name: "Paracetamol 650mg",
        genericName: "Acetaminophen",
        manufacturer: "Cipla Ltd",
        dosageForm: DosageForm.TABLET,
      });

      expect(medicine.prescriptionRequired).toBe(false);
      expect(medicine.isActive).toBe(true);
      const err = medicine.validateSync();
      expect(err).toBeUndefined();
    });

    it("should reject documents missing required fields", () => {
      const invalid = new Medicine({});
      const err = invalid.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors["name"]).toBeDefined();
      expect(err?.errors["genericName"]).toBeDefined();
      expect(err?.errors["manufacturer"]).toBeDefined();
      expect(err?.errors["dosageForm"]).toBeDefined();
    });

    it("should reject invalid dosageForm enum values", () => {
      const invalid = new Medicine({
        name: "Test Med",
        genericName: "Test Generic",
        manufacturer: "Test Pharma",
        dosageForm: "INVALID_FORM" as unknown as DosageForm,
      });

      const err = invalid.validateSync();
      expect(err?.errors["dosageForm"]).toBeDefined();
    });

    it("should define full-text search and catalog filtering indexes", () => {
      const indexes = Medicine.schema.indexes();

      // Full-text index on catalog fields
      const textIndex = indexes.find(
        ([idx]) =>
          idx["name"] === "text" &&
          idx["genericName"] === "text" &&
          idx["brandName"] === "text" &&
          idx["manufacturer"] === "text"
      );
      expect(textIndex).toBeDefined();

      // Compound catalog filtering indexes
      const activeCategoryIndex = indexes.find(
        ([idx]) => idx["isActive"] === 1 && idx["category"] === 1
      );
      expect(activeCategoryIndex).toBeDefined();

      const activeRxIndex = indexes.find(
        ([idx]) => idx["isActive"] === 1 && idx["prescriptionRequired"] === 1
      );
      expect(activeRxIndex).toBeDefined();
    });
  });

  describe("Inventory Model", () => {
    it("should instantiate a valid Inventory document with expected defaults", () => {
      const pharmacyId = new mongoose.Types.ObjectId();
      const medicineId = new mongoose.Types.ObjectId();

      const inventory = new Inventory({
        pharmacyId,
        medicineId,
        quantity: 150,
        price: 45.5,
        batchNumber: "BAT-2026-X1",
        expiryDate: new Date("2028-12-31"),
      });

      expect(inventory.pharmacyId).toEqual(pharmacyId);
      expect(inventory.medicineId).toEqual(medicineId);
      expect(inventory.quantity).toBe(150);
      expect(inventory.reservedQuantity).toBe(0); // default
      expect(inventory.isAvailable).toBe(true); // default
      expect(inventory.lowStockThreshold).toBe(10); // default
      expect(inventory.reorderQuantity).toBe(50); // default

      const err = inventory.validateSync();
      expect(err).toBeUndefined();
    });

    it("should reject documents missing required fields", () => {
      const invalid = new Inventory({});
      const err = invalid.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors["pharmacyId"]).toBeDefined();
      expect(err?.errors["medicineId"]).toBeDefined();
      expect(err?.errors["price"]).toBeDefined();
    });

    it("CRITICAL STOCK CONSTRAINT: should reject negative stock quantity", () => {
      const invalid = new Inventory({
        pharmacyId: new mongoose.Types.ObjectId(),
        medicineId: new mongoose.Types.ObjectId(),
        quantity: -10,
        price: 25.0,
      });

      const err = invalid.validateSync();
      expect(err?.errors["quantity"]).toBeDefined();
    });

    it("should reject negative reservedQuantity and invalid non-positive prices", () => {
      const invalid = new Inventory({
        pharmacyId: new mongoose.Types.ObjectId(),
        medicineId: new mongoose.Types.ObjectId(),
        quantity: 50,
        reservedQuantity: -5,
        price: 0,
      });

      const err = invalid.validateSync();
      expect(err?.errors["reservedQuantity"]).toBeDefined();
      expect(err?.errors["price"]).toBeDefined();
    });

    it("should reject non-integer quantities", () => {
      const invalid = new Inventory({
        pharmacyId: new mongoose.Types.ObjectId(),
        medicineId: new mongoose.Types.ObjectId(),
        quantity: 12.5,
        price: 20,
      });

      const err = invalid.validateSync();
      expect(err?.errors["quantity"]).toBeDefined();
    });

    it("CRITICAL UNIQUENESS: should enforce unique compound index on pharmacyId + medicineId", () => {
      const indexes = Inventory.schema.indexes();

      const uniqueCompoundIndex = indexes.find(
        ([idx]) => idx["pharmacyId"] === 1 && idx["medicineId"] === 1
      );
      expect(uniqueCompoundIndex).toBeDefined();
      expect(uniqueCompoundIndex![1]?.unique).toBe(true);
    });

    it("should define availability and search indexes", () => {
      const indexes = Inventory.schema.indexes();

      const pharmacyAvailIndex = indexes.find(
        ([idx]) => idx["pharmacyId"] === 1 && idx["isAvailable"] === 1
      );
      expect(pharmailIndex => pharmacyAvailIndex).toBeDefined();

      const medicineAvailIndex = indexes.find(
        ([idx]) =>
          idx["medicineId"] === 1 &&
          idx["isAvailable"] === 1 &&
          idx["quantity"] === 1
      );
      expect(medicineAvailIndex).toBeDefined();
    });
  });

  describe("Order Model", () => {
    const validOrderData = () => ({
      patientId: new mongoose.Types.ObjectId(),
      pharmacyId: new mongoose.Types.ObjectId(),
      items: [
        {
          medicineId: new mongoose.Types.ObjectId(),
          medicineName: "Amoxicillin 500mg",
          dosageForm: "CAPSULE",
          strength: "500mg",
          quantity: 2,
          unitPrice: 50,
          totalPrice: 100,
        },
      ],
      deliveryAddress: {
        street: "123 Health Ave",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      totals: {
        subtotal: 100,
        deliveryFee: 20,
        totalAmount: 120,
      },
      currency: "INR",
      deliveryOtp: "839210",
    });

    it("should instantiate a valid Order document with embedded snapshot and defaults", () => {
      const order = new Order(validOrderData());

      expect(order.status).toBe(OrderStatus.PLACED);
      expect(order.paymentStatus).toBe("UNPAID");
      expect(order.currency).toBe("INR");
      expect(order.items.length).toBe(1);
      expect(order.items[0].medicineName).toBe("Amoxicillin 500mg");

      const err = order.validateSync();
      expect(err).toBeUndefined();
    });

    it("should accept all 11 valid OrderStatus lifecycle states", () => {
      const allStates = Object.values(OrderStatus);
      expect(allStates.length).toBe(11);

      allStates.forEach((st) => {
        const order = new Order({
          ...validOrderData(),
          status: st,
        });
        const err = order.validateSync();
        expect(err).toBeUndefined();
      });
    });

    it("should reject invalid OrderStatus values", () => {
      const invalid = new Order({
        ...validOrderData(),
        status: "INVALID_ORDER_STATE" as unknown as OrderStatus,
      });

      const err = invalid.validateSync();
      expect(err?.errors["status"]).toBeDefined();
    });

    it("should reject orders with empty items array", () => {
      const invalid = new Order({
        ...validOrderData(),
        items: [],
      });

      const err = invalid.validateSync();
      expect(err?.errors["items"]).toBeDefined();
    });

    it("HISTORICAL SNAPSHOT: should validate embedded item snapshot required fields and price constraints", () => {
      const invalid = new Order({
        ...validOrderData(),
        items: [
          {
            medicineId: new mongoose.Types.ObjectId(),
            // missing medicineName snapshot
            quantity: 0, // invalid quantity
            unitPrice: -5, // negative price
            totalPrice: -10, // negative price
          } as any,
        ],
      });

      const err = invalid.validateSync();
      expect(err).toBeDefined();
      expect(err?.errors["items.0.medicineName"]).toBeDefined();
      expect(err?.errors["items.0.quantity"]).toBeDefined();
      expect(err?.errors["items.0.unitPrice"]).toBeDefined();
      expect(err?.errors["items.0.totalPrice"]).toBeDefined();
    });

    it("should strip private deliveryOtp on JSON serialization", () => {
      const order = new Order(validOrderData());
      const json = order.toJSON();

      expect(json.id).toBeDefined();
      expect(json._id).toBeUndefined();
      expect(json.__v).toBeUndefined();
      expect(json.deliveryOtp).toBeUndefined();
      expect(json.items[0].medicineName).toBe("Amoxicillin 500mg");
    });

    it("should define query and queue management indexes", () => {
      const indexes = Order.schema.indexes();

      const patientOrderIndex = indexes.find(
        ([idx]) => idx["patientId"] === 1 && idx["createdAt"] === -1
      );
      expect(patientOrderIndex).toBeDefined();

      const pharmacyStatusIndex = indexes.find(
        ([idx]) =>
          idx["pharmacyId"] === 1 &&
          idx["status"] === 1 &&
          idx["createdAt"] === -1
      );
      expect(pharmacyStatusIndex).toBeDefined();

      const statusOrderIndex = indexes.find(
        ([idx]) => idx["status"] === 1 && idx["createdAt"] === -1
      );
      expect(statusOrderIndex).toBeDefined();
    });
  });

  describe("Payment Model", () => {
    const validPaymentData = () => ({
      userId: new mongoose.Types.ObjectId(),
      targetType: PaymentTargetType.ORDER,
      targetId: new mongoose.Types.ObjectId(),
      amount: 450.0,
      currency: "INR",
      referenceId: "pay_ref_test_12345",
      provider: PaymentProvider.RAZORPAY,
      providerOrderId: "order_rzp_67890",
      providerSignature: "cryptographic_mock_sig_abc",
      gatewayMetadata: { internalRoute: "rzp_gateway_direct" },
    });

    it("should instantiate a valid Payment document with expected defaults", () => {
      const payment = new Payment(validPaymentData());

      expect(payment.status).toBe(PaymentStatus.CREATED);
      expect(payment.provider).toBe(PaymentProvider.RAZORPAY);
      expect(payment.amount).toBe(450.0);
      expect(payment.currency).toBe("INR");

      const err = payment.validateSync();
      expect(err).toBeUndefined();
    });

    it("should accept all 8 valid PaymentStatus lifecycle states", () => {
      const states = Object.values(PaymentStatus);
      expect(states.length).toBe(8);

      states.forEach((st) => {
        const payment = new Payment({
          ...validPaymentData(),
          referenceId: `pay_ref_${st}`,
          status: st,
        });
        const err = payment.validateSync();
        expect(err).toBeUndefined();
      });
    });

    it("should reject invalid PaymentStatus and PaymentTargetType", () => {
      const invalid = new Payment({
        ...validPaymentData(),
        status: "BOGUS_STATUS" as unknown as PaymentStatus,
        targetType: "BOGUS_TARGET" as unknown as PaymentTargetType,
      });

      const err = invalid.validateSync();
      expect(err?.errors["status"]).toBeDefined();
      expect(err?.errors["targetType"]).toBeDefined();
    });

    it("should reject non-positive amounts", () => {
      const invalid = new Payment({
        ...validPaymentData(),
        amount: 0,
      });

      const err = invalid.validateSync();
      expect(err?.errors["amount"]).toBeDefined();
    });

    it("SECURITY & PRIVACY: should strip private gateway provider credentials on JSON serialization", () => {
      const payment = new Payment(validPaymentData());
      const json = payment.toJSON();

      expect(json.id).toBeDefined();
      expect(json._id).toBeUndefined();
      expect(json.__v).toBeUndefined();
      expect(json.providerSignature).toBeUndefined();
      expect(json.gatewayMetadata).toBeUndefined();
      expect(json.amount).toBe(450.0);
    });

    it("should define transaction tracking and reconciliation indexes", () => {
      const indexes = Payment.schema.indexes();

      const userPaymentIndex = indexes.find(
        ([idx]) => idx["userId"] === 1 && idx["createdAt"] === -1
      );
      expect(userPaymentIndex).toBeDefined();

      const targetLookupIndex = indexes.find(
        ([idx]) => idx["targetType"] === 1 && idx["targetId"] === 1
      );
      expect(targetLookupIndex).toBeDefined();

      const providerOrderIndex = indexes.find(
        ([idx]) => idx["providerOrderId"] === 1
      );
      expect(providerOrderIndex).toBeDefined();
      expect(providerOrderIndex![1]?.sparse).toBe(true);
    });
  });

  describe("AuditLog Model", () => {
    it("should instantiate a valid AuditLog document with defaults", () => {
      const actorId = new mongoose.Types.ObjectId();
      const resourceId = new mongoose.Types.ObjectId().toString();

      const auditLog = new AuditLog({
        actorId,
        actorRole: "ADMIN",
        action: AuditAction.DOCTOR_VERIFICATION_APPROVED,
        resourceType: "DOCTOR_VERIFICATION",
        resourceId,
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        metadata: { previousStatus: "PENDING_REVIEW", verifiedBy: "Admin1" },
      });

      expect(auditLog.status).toBe("SUCCESS");
      expect(auditLog.createdAt).toBeDefined();

      const err = auditLog.validateSync();
      expect(err).toBeUndefined();
    });

    it("should reject documents missing required audit fields", () => {
      const invalid = new AuditLog({});
      const err = invalid.validateSync();

      expect(err).toBeDefined();
      expect(err?.errors["actorId"]).toBeDefined();
      expect(err?.errors["actorRole"]).toBeDefined();
      expect(err?.errors["action"]).toBeDefined();
      expect(err?.errors["resourceType"]).toBeDefined();
      expect(err?.errors["resourceId"]).toBeDefined();
    });

    it("SECURITY & PRIVACY: should strip internal audit metadata from JSON representation", () => {
      const auditLog = new AuditLog({
        actorId: new mongoose.Types.ObjectId(),
        actorRole: "DOCTOR",
        action: AuditAction.PRESCRIPTION_ISSUED,
        resourceType: "PRESCRIPTION",
        resourceId: new mongoose.Types.ObjectId().toString(),
        metadata: { internalPayloadHash: "xyz987" },
      });

      const json = auditLog.toJSON();
      expect(json.id).toBeDefined();
      expect(json.metadata).toBeUndefined();
    });

    it("should define audit trail chronological and actor history indexes", () => {
      const indexes = AuditLog.schema.indexes();

      const actorHistoryIndex = indexes.find(
        ([idx]) => idx["actorId"] === 1 && idx["createdAt"] === -1
      );
      expect(actorHistoryIndex).toBeDefined();

      const resourceHistoryIndex = indexes.find(
        ([idx]) =>
          idx["resourceType"] === 1 &&
          idx["resourceId"] === 1 &&
          idx["createdAt"] === -1
      );
      expect(resourceHistoryIndex).toBeDefined();

      const chronologicalIndex = indexes.find(
        ([idx]) => idx["createdAt"] === -1
      );
      expect(chronologicalIndex).toBeDefined();
    });
  });

  describe("Notification Model", () => {
    it("should instantiate a valid Notification document with defaults", () => {
      const userId = new mongoose.Types.ObjectId();

      const notification = new Notification({
        userId,
        type: NotificationType.APPOINTMENT_CONFIRMED,
        title: "Appointment Confirmed",
        message: "Your appointment with Dr. Sharma has been confirmed.",
      });

      expect(notification.isRead).toBe(false);
      expect(notification.channels).toEqual(["IN_APP"]);

      const err = notification.validateSync();
      expect(err).toBeUndefined();
    });

    it("should reject invalid notification type enum values", () => {
      const invalid = new Notification({
        userId: new mongoose.Types.ObjectId(),
        type: "NOT_A_REAL_TYPE" as unknown as NotificationType,
        title: "Title",
        message: "Message",
      });

      const err = invalid.validateSync();
      expect(err?.errors["type"]).toBeDefined();
    });

    it("should reject missing required notification fields", () => {
      const invalid = new Notification({});
      const err = invalid.validateSync();

      expect(err?.errors["userId"]).toBeDefined();
      expect(err?.errors["type"]).toBeDefined();
      expect(err?.errors["title"]).toBeDefined();
      expect(err?.errors["message"]).toBeDefined();
    });

    it("should define inbox polling and unread badge indexes", () => {
      const indexes = Notification.schema.indexes();

      const unreadBadgeIndex = indexes.find(
        ([idx]) =>
          idx["userId"] === 1 && idx["isRead"] === 1 && idx["createdAt"] === -1
      );
      expect(unreadBadgeIndex).toBeDefined();

      const userInboxIndex = indexes.find(
        ([idx]) => idx["userId"] === 1 && idx["createdAt"] === -1
      );
      expect(userInboxIndex).toBeDefined();
    });
  });

  describe("Review Model", () => {
    it("should instantiate a valid doctor Review document", () => {
      const patientId = new mongoose.Types.ObjectId();
      const doctorId = new mongoose.Types.ObjectId();
      const appointmentId = new mongoose.Types.ObjectId();

      const review = new Review({
        patientId,
        doctorId,
        appointmentId,
        rating: 5,
        comment: "Excellent and attentive doctor, resolved all concerns.",
      });

      expect(review.rating).toBe(5);
      expect(review.status).toBe(ReviewStatus.PUBLISHED);

      const err = review.validateSync();
      expect(err).toBeUndefined();
    });

    it("should instantiate a valid pharmacy Review document", () => {
      const review = new Review({
        patientId: new mongoose.Types.ObjectId(),
        pharmacyId: new mongoose.Types.ObjectId(),
        orderId: new mongoose.Types.ObjectId(),
        rating: 4,
        comment: "Fast delivery and well-packaged medications.",
      });

      const err = review.validateSync();
      expect(err).toBeUndefined();
    });

    it("should reject review without doctorId or pharmacyId target", () => {
      const invalid = new Review({
        patientId: new mongoose.Types.ObjectId(),
        rating: 4,
        comment: "Great experience overall with no target.",
      });

      const err = invalid.validateSync();
      expect(err?.errors["doctorId"]).toBeDefined();
    });

    it("should reject invalid ratings below 1, above 5, or non-integer", () => {
      const invalidLow = new Review({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        rating: 0,
        comment: "Very poor consultation.",
      });
      expect(invalidLow.validateSync()?.errors["rating"]).toBeDefined();

      const invalidHigh = new Review({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        rating: 6,
        comment: "Extraordinary consultation.",
      });
      expect(invalidHigh.validateSync()?.errors["rating"]).toBeDefined();

      const invalidFloat = new Review({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        rating: 4.5,
        comment: "Decent consultation.",
      });
      expect(invalidFloat.validateSync()?.errors["rating"]).toBeDefined();
    });

    it("should reject comments that are too short (< 5 chars)", () => {
      const invalid = new Review({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId(),
        rating: 5,
        comment: "Good",
      });

      const err = invalid.validateSync();
      expect(err?.errors["comment"]).toBeDefined();
    });

    it("CRITICAL UNIQUENESS: should enforce unique sparse index on appointmentId", () => {
      const indexes = Review.schema.indexes();

      const apptUniqueIndex = indexes.find(
        ([idx]) => idx["appointmentId"] === 1
      );
      expect(apptUniqueIndex).toBeDefined();
      expect(apptUniqueIndex![1]?.unique).toBe(true);
      expect(apptUniqueIndex![1]?.sparse).toBe(true);
    });
  });

  describe("Complaint Model", () => {
    it("should instantiate a valid Complaint document with defaults", () => {
      const complaint = new Complaint({
        complainantId: new mongoose.Types.ObjectId(),
        category: ComplaintCategory.MEDICINE_QUALITY,
        subject: "Damaged seal on prescription syrup",
        description:
          "The package was delivered with a broken tamper-evident safety seal.",
      });

      expect(complaint.status).toBe(ComplaintStatus.OPEN);
      expect(complaint.priority).toBe(ComplaintPriority.MEDIUM);

      const err = complaint.validateSync();
      expect(err).toBeUndefined();
    });

    it("should accept resolution subschema details", () => {
      const adminId = new mongoose.Types.ObjectId();
      const complaint = new Complaint({
        complainantId: new mongoose.Types.ObjectId(),
        category: ComplaintCategory.PAYMENT,
        subject: "Double deduction during checkout",
        description: "My bank account was debited twice for a single order.",
        status: ComplaintStatus.RESOLVED,
        priority: ComplaintPriority.HIGH,
        assignedTo: adminId,
        resolution: {
          resolvedBy: adminId,
          resolvedAt: new Date(),
          resolutionNotes: "Duplicate charge refunded via payment gateway.",
        },
      });

      const err = complaint.validateSync();
      expect(err).toBeUndefined();
      expect(complaint.resolution?.resolutionNotes).toContain("refunded");
    });

    it("should reject invalid category, status, and priority enum values", () => {
      const invalid = new Complaint({
        complainantId: new mongoose.Types.ObjectId(),
        category: "INVALID_CAT" as unknown as ComplaintCategory,
        status: "INVALID_STAT" as unknown as ComplaintStatus,
        priority: "INVALID_PRIOR" as unknown as ComplaintPriority,
        subject: "Test Complaint",
        description: "Valid long description of the complaint.",
      });

      const err = invalid.validateSync();
      expect(err?.errors["category"]).toBeDefined();
      expect(err?.errors["status"]).toBeDefined();
      expect(err?.errors["priority"]).toBeDefined();
    });

    it("should reject complaints with descriptions shorter than 10 characters", () => {
      const invalid = new Complaint({
        complainantId: new mongoose.Types.ObjectId(),
        category: ComplaintCategory.OTHER,
        subject: "Short bug",
        description: "Too short",
      });

      const err = invalid.validateSync();
      expect(err?.errors["description"]).toBeDefined();
    });

    it("should define admin queue filtering and user history indexes", () => {
      const indexes = Complaint.schema.indexes();

      const userComplaintIndex = indexes.find(
        ([idx]) => idx["complainantId"] === 1 && idx["createdAt"] === -1
      );
      expect(userComplaintIndex).toBeDefined();

      const adminQueueIndex = indexes.find(
        ([idx]) =>
          idx["status"] === 1 &&
          idx["priority"] === 1 &&
          idx["createdAt"] === -1
      );
      expect(adminQueueIndex).toBeDefined();
    });
  });
});
