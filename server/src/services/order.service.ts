import crypto from "node:crypto";
import mongoose, { Types } from "mongoose";
import {
  Order,
  Inventory,
  Medicine,
  PharmacyProfile,
  Prescription,
  Notification,
} from "../models/index.js";
import {
  OrderStatus,
  UserRole,
  PharmacyVerificationStatus,
  PrescriptionStatus,
  AuditAction,
  NotificationType,
  type IOrder,
  type IOrderItemSnapshot,
  type IMedicine,
  type IPharmacyProfile,
} from "../types/models.js";
import { verifyPrescriptionDigest } from "./prescription.service.js";
import { paymentService } from "./payment.service.js";
import { auditLogService } from "./audit-log.service.js";
import { notificationService } from "./notification.service.js";
import { AppError } from "../utils/api-error.js";
import type { AuthenticatedUser } from "../types/express.js";
import type {
  CreateOrderInput,
  PrescriptionReviewInput,
  UpdateOrderStatusInput,
} from "../validators/order.validator.js";

export interface RequestAuditContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Service managing medicine order creation, clinical prescription attachment,
 * price snapshot persistence, and atomic stock reservation.
 * Source: docs/api/API_CONTRACT.md Group 12 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.3.
 */
export class OrderService {
  /**
   * Creates a new medicine order for an authenticated patient.
   *
   * Orchestration & Invariants:
   * 1. Patient Authorization: Only authenticated PATIENT accounts may place orders.
   * 2. Verified Pharmacy: Target pharmacy must exist and hold APPROVED_VERIFIED status.
   * 3. Authoritative Catalog & Inactive Protection: Resolves Master Medicine catalog entries; rejects inactive items.
   * 4. Prescription Enforcement: If ANY item has prescriptionRequired === true, a valid, unexpired,
   *    tamper-evident prescription belonging to the patient is strictly required and must cover the medications.
   * 5. Price Snapshots: Unit prices read from pharmacy inventory; subtotal/total calculated server-side.
   * 6. Atomic Stock Reservation: Atomically checks available stock (quantity - reservedQuantity >= requestedQty)
   *    and increments reservedQuantity. Employs multi-doc transactions where supported and safe conditional
   *    compensation on standalone MongoDB.
   * 7. State Machine Routing:
   *    - OTC-only orders transition directly to PHARMACY_ACCEPTED.
   *    - Orders containing prescription-required items transition to PRESCRIPTION_REVIEW.
   *
   * @param user Authenticated user context
   * @param input Validated order creation input
   * @param context Optional request audit context
   * @returns Persisted IOrder document
   */
  public async createOrder(
    user: AuthenticatedUser,
    input: CreateOrderInput,
    context?: RequestAuditContext
  ): Promise<IOrder> {
    // 1. Patient Role Check
    if (user.role !== UserRole.PATIENT) {
      throw AppError.forbidden(
        "Access denied: only patients may place medicine orders",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // 2. Resolve Pharmacy Profile and Verification Status
    if (!mongoose.Types.ObjectId.isValid(input.pharmacyId)) {
      throw AppError.badRequest("Invalid pharmacy ID format", "BAD_REQUEST");
    }

    const pharmacyObjectId = new mongoose.Types.ObjectId(input.pharmacyId);
    const pharmacyProfile = await PharmacyProfile.findOne({
      $or: [{ _id: pharmacyObjectId }, { userId: pharmacyObjectId }],
    });

    if (!pharmacyProfile) {
      throw new AppError(404, "PHARMACY_NOT_FOUND", "Pharmacy profile not found");
    }

    if (
      pharmacyProfile.verificationStatus !==
      PharmacyVerificationStatus.APPROVED_VERIFIED
    ) {
      throw new AppError(
        403,
        "PHARMACY_NOT_VERIFIED",
        "Pharmacy is not approved to fulfill medicine orders"
      );
    }

    // 3. Resolve Master Catalog Medicines
    const medicineObjectIds = input.items.map(
      (item) => new mongoose.Types.ObjectId(item.medicineId)
    );

    const catalogMedicines = await Medicine.find({
      _id: { $in: medicineObjectIds },
    });

    const medicineMap = new Map<string, IMedicine>();
    for (const med of catalogMedicines) {
      medicineMap.set(med._id.toString(), med);
    }

    // Ensure all requested medicines exist in master catalog
    for (const item of input.items) {
      const med = medicineMap.get(item.medicineId);
      if (!med) {
        throw new AppError(
          404,
          "MEDICINE_NOT_FOUND",
          `Medicine with ID '${item.medicineId}' not found in master catalog`
        );
      }
      if (!med.isActive) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          `Cannot order inactive or discontinued catalog medicine: ${med.name}`
        );
      }
    }

    // Determine prescription requirement across all ordered items
    const rxItems: Array<{ medicineId: string; medicineName: string }> = [];
    for (const item of input.items) {
      const med = medicineMap.get(item.medicineId)!;
      if (med.prescriptionRequired) {
        rxItems.push({ medicineId: item.medicineId, medicineName: med.name });
      }
    }

    const hasRxItems = rxItems.length > 0;

    // 4. Clinical Prescription Verification
    let validatedPrescriptionId: Types.ObjectId | undefined = undefined;

    if (hasRxItems && !input.prescriptionId) {
      throw new AppError(
        422,
        "ORDER_PRESCRIPTION_MISSING",
        "Prescription required for scheduled drugs in order"
      );
    }

    if (input.prescriptionId) {
      if (!mongoose.Types.ObjectId.isValid(input.prescriptionId)) {
        throw AppError.badRequest("Invalid prescription ID format", "BAD_REQUEST");
      }

      const prescription = await Prescription.findById(input.prescriptionId);
      if (!prescription) {
        throw new AppError(
          404,
          "PRESCRIPTION_NOT_FOUND",
          "Prescription not found"
        );
      }

      // Check ownership: must belong to the authenticated patient
      if (prescription.patientId.toString() !== user.id) {
        throw AppError.forbidden(
          "Access denied: prescription does not belong to the authenticated patient",
          "AUTH_RESOURCE_ACCESS_DENIED"
        );
      }

      // Check issuance status
      if (prescription.status !== PrescriptionStatus.FINALIZED_ISSUED) {
        throw new AppError(
          422,
          "PRESCRIPTION_INVALID_STATUS",
          `Prescription is in '${prescription.status}' status and cannot be used for order fulfillment`
        );
      }

      // Check validity window (expiration)
      const now = Date.now();
      if (new Date(prescription.expiresAt).getTime() <= now) {
        throw new AppError(
          422,
          "PRESCRIPTION_EXPIRED",
          "Prescription has passed its validity window"
        );
      }

      // Cryptographic integrity checksum check
      if (prescription.integrityChecksum) {
        const isUntampered = verifyPrescriptionDigest(prescription);
        if (!isUntampered) {
          throw new AppError(
            422,
            "PRESCRIPTION_INTEGRITY_FAILED",
            "Prescription cryptographic checksum verification failed"
          );
        }
      }

      // Verify prescription coverage for all prescription-required medicines
      if (hasRxItems) {
        const prescribedMedicineIds = new Set(
          prescription.medicines.map((m) => m.medicineId.toString())
        );

        for (const rxItem of rxItems) {
          if (!prescribedMedicineIds.has(rxItem.medicineId)) {
            throw new AppError(
              422,
              "ORDER_PRESCRIPTION_REJECTED",
              `Attached prescription does not cover required medicine: ${rxItem.medicineName}`
            );
          }
        }
      }

      validatedPrescriptionId = prescription._id;
    }

    // 5. Inventory Verification & Authoritative Price Snapshots
    const itemSnapshots: IOrderItemSnapshot[] = [];
    const now = new Date();

    for (const item of input.items) {
      const med = medicineMap.get(item.medicineId)!;
      const inventoryDoc = await Inventory.findOne({
        pharmacyId: pharmacyProfile._id,
        medicineId: med._id,
      });

      if (!inventoryDoc) {
        throw new AppError(
          404,
          "INVENTORY_NOT_FOUND",
          `Medicine '${med.name}' is not stocked by the selected pharmacy`
        );
      }

      if (!inventoryDoc.isAvailable) {
        throw new AppError(
          422,
          "INVENTORY_ITEM_EXPIRED",
          `Medicine '${med.name}' is currently unavailable at this pharmacy`
        );
      }

      if (
        inventoryDoc.expiryDate &&
        new Date(inventoryDoc.expiryDate).getTime() <= now.getTime()
      ) {
        throw new AppError(
          422,
          "INVENTORY_ITEM_EXPIRED",
          `Cannot dispense expired stock for medicine: ${med.name}`
        );
      }

      const availableStock =
        inventoryDoc.quantity - inventoryDoc.reservedQuantity;
      if (availableStock < item.quantity) {
        throw new AppError(
          409,
          "INVENTORY_INSUFFICIENT_STOCK",
          `Quantity requested (${item.quantity}) exceeds available pharmacy stock (${Math.max(0, availableStock)}) for medicine: ${med.name}`
        );
      }

      // Immutable price snapshot calculated from pharmacy inventory
      const unitPrice = inventoryDoc.price;
      const totalPrice = Math.round(unitPrice * item.quantity * 100) / 100;

      itemSnapshots.push({
        medicineId: med._id,
        medicineName: med.name,
        dosageForm: med.dosageForm,
        strength: med.strength,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      });
    }

    // Calculate order totals
    const subtotal =
      Math.round(
        itemSnapshots.reduce((acc, item) => acc + item.totalPrice, 0) * 100
      ) / 100;
    const deliveryFee = 0; // Standard free delivery for order creation milestone
    const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

    // 6. Atomic Stock Reservation & Coordinated Order Creation
    let isReplicaSet = false;
    try {
      const topology = (mongoose.connection.db?.client as any)?.topology;
      isReplicaSet =
        topology?.description?.type === "ReplicaSetWithPrimary" ||
        topology?.description?.type === "Sharded" ||
        topology?.type === "ReplicaSetWithPrimary" ||
        topology?.type === "Sharded" ||
        Boolean(topology?.setName);
    } catch {
      isReplicaSet = false;
    }

    let session: mongoose.ClientSession | undefined = undefined;
    if (isReplicaSet) {
      try {
        session = await mongoose.startSession();
        session.startTransaction();
      } catch {
        session = undefined;
      }
    }

    const reservedTrackers: Array<{
      inventoryId: Types.ObjectId;
      quantity: number;
    }> = [];

    let createdOrder: IOrder;

    try {
      // Step A: Atomically reserve stock for each requested item
      for (const item of input.items) {
        const currentDate = new Date();
        const updatedInventory = await Inventory.findOneAndUpdate(
          {
            pharmacyId: pharmacyProfile._id,
            medicineId: new mongoose.Types.ObjectId(item.medicineId),
            isAvailable: true,
            $expr: {
              $gte: [
                { $subtract: ["$quantity", "$reservedQuantity"] },
                item.quantity,
              ],
            },
            $or: [
              { expiryDate: { $exists: false } },
              { expiryDate: null },
              { expiryDate: { $gt: currentDate } },
            ],
          },
          {
            $inc: { reservedQuantity: item.quantity },
          },
          { new: true, ...(session ? { session } : {}) }
        );

        if (!updatedInventory) {
          throw new AppError(
            409,
            "INVENTORY_INSUFFICIENT_STOCK",
            "Quantity requested exceeds available stock"
          );
        }

        reservedTrackers.push({
          inventoryId: updatedInventory._id,
          quantity: item.quantity,
        });
      }

      // Step B: Determine initial order status based on prescription requirement
      // OTC-only -> PHARMACY_ACCEPTED
      // Rx drugs present -> PRESCRIPTION_REVIEW
      const initialStatus = hasRxItems
        ? OrderStatus.PRESCRIPTION_REVIEW
        : OrderStatus.PHARMACY_ACCEPTED;

      // Step C: Persist Order Document
      const [orderDoc] = await Order.create(
        [
          {
            patientId: new mongoose.Types.ObjectId(user.id),
            pharmacyId: pharmacyProfile._id,
            items: itemSnapshots,
            prescriptionId: validatedPrescriptionId,
            paymentStatus: "UNPAID",
            status: initialStatus,
            deliveryAddress: input.deliveryAddress,
            totals: {
              subtotal,
              deliveryFee,
              totalAmount,
            },
            currency: "INR",
            deliveryNotes: input.deliveryNotes,
          },
        ],
        session ? { session } : {}
      );

      createdOrder = orderDoc;

      if (session) {
        await session.commitTransaction();
      }
    } catch (error) {
      if (session) {
        try {
          await session.abortTransaction();
        } catch {}
      } else {
        // Safe conditional compensation on standalone MongoDB:
        // Reverse only the reservations made in this transaction without overwriting concurrent updates
        for (const tracker of reservedTrackers) {
          try {
            await Inventory.updateOne(
              {
                _id: tracker.inventoryId,
                reservedQuantity: { $gte: tracker.quantity },
              },
              {
                $inc: { reservedQuantity: -tracker.quantity },
              }
            );
          } catch {}
        }
      }
      throw error;
    } finally {
      if (session) {
        await session.endSession();
      }
    }

    // 7. Fail-safe Asynchronous Audit Log
    void auditLogService
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.ORDER_CREATED,
        resourceType: "Order",
        resourceId: createdOrder._id.toString(),
        patientId: user.id,
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        status: "SUCCESS",
        metadata: {
          pharmacyId: pharmacyProfile._id.toString(),
          itemCount: itemSnapshots.length,
          totalAmount,
          initialStatus: createdOrder.status,
          hasPrescription: Boolean(validatedPrescriptionId),
        },
      })
      .catch(() => {});

    return createdOrder;
  }

  /**
   * Retrieves an order by identifier with role-based access control.
   */
  public async getOrderById(
    user: AuthenticatedUser,
    orderId: string
  ): Promise<IOrder> {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw AppError.badRequest("Invalid order identifier format", "BAD_REQUEST");
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    const isPatientOwner =
      user.role === UserRole.PATIENT && order.patientId.toString() === user.id;

    let isAssignedPharmacy = false;
    if (user.role === UserRole.PHARMACY) {
      const profile = await PharmacyProfile.findOne({
        userId: new mongoose.Types.ObjectId(user.id),
      });
      if (profile) {
        isAssignedPharmacy =
          order.pharmacyId.toString() === profile._id.toString();
      }
    }

    const isAdmin = user.role === UserRole.ADMIN;

    if (!isPatientOwner && !isAssignedPharmacy && !isAdmin) {
      throw AppError.forbidden(
        "Access denied: you do not have permission to view this order",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    return order;
  }

  /**
   * Resolves the assigned pharmacy profile for an authenticated pharmacist.
   * Enforces verified status and strict assignment to the target order.
   */
  private async resolveAssignedPharmacyProfile(
    user: AuthenticatedUser,
    order: IOrder
  ): Promise<IPharmacyProfile> {
    if (user.role !== UserRole.PHARMACY) {
      throw AppError.forbidden(
        "Access denied: only pharmacy accounts may perform pharmacist operations",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const profile = await PharmacyProfile.findOne({
      userId: new mongoose.Types.ObjectId(user.id),
    });

    if (!profile) {
      throw new AppError(
        404,
        "PHARMACY_NOT_FOUND",
        "Pharmacy profile not found for authenticated user"
      );
    }

    if (
      profile.verificationStatus !==
      PharmacyVerificationStatus.APPROVED_VERIFIED
    ) {
      throw new AppError(
        403,
        "PHARMACY_NOT_VERIFIED",
        "Pharmacy account is unverified or pending administrative license review"
      );
    }

    if (order.pharmacyId.toString() !== profile._id.toString()) {
      throw AppError.forbidden(
        "Access denied: you do not have permission to manage this order",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    return profile;
  }

  /**
   * Pharmacist reviews attached prescription (APPROVE or REJECT).
   * Source: docs/api/API_CONTRACT.md Group 12.2 & docs/api/STATE_MACHINES.md Group 4.
   */
  public async reviewOrderPrescription(
    user: AuthenticatedUser,
    orderId: string,
    input: PrescriptionReviewInput,
    context?: RequestAuditContext
  ): Promise<IOrder> {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw AppError.badRequest(
        "Invalid order identifier format",
        "BAD_REQUEST"
      );
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    // Authorization: only assigned, verified pharmacy can review
    const pharmacyProfile = await this.resolveAssignedPharmacyProfile(
      user,
      order
    );

    // State Guard: Order must be in PRESCRIPTION_REVIEW state
    if (order.status !== OrderStatus.PRESCRIPTION_REVIEW) {
      throw new AppError(
        409,
        "ORDER_INVALID_TRANSITION",
        `Cannot perform prescription review on order in '${order.status}' status. Order must be in PRESCRIPTION_REVIEW state.`
      );
    }

    if (input.decision === "APPROVE") {
      // Validate attached prescription
      if (order.prescriptionId) {
        const prescription = await Prescription.findById(order.prescriptionId);
        if (!prescription) {
          throw new AppError(
            422,
            "PRESCRIPTION_NOT_FOUND",
            "Prescription attached to order could not be found"
          );
        }

        if (prescription.patientId.toString() !== order.patientId.toString()) {
          throw new AppError(
            422,
            "PRESCRIPTION_PATIENT_MISMATCH",
            "Prescription patient does not match order recipient"
          );
        }

        if (
          prescription.status !== PrescriptionStatus.FINALIZED_ISSUED &&
          prescription.status !== PrescriptionStatus.FULFILLED_PARTIAL
        ) {
          throw new AppError(
            422,
            "PRESCRIPTION_INVALID_STATUS",
            `Prescription is in '${prescription.status}' status and cannot be approved for dispensing`
          );
        }

        if (new Date(prescription.expiresAt).getTime() <= Date.now()) {
          throw new AppError(
            422,
            "PRESCRIPTION_EXPIRED",
            "Prescription has passed its validity window"
          );
        }

        if (
          prescription.integrityChecksum &&
          !verifyPrescriptionDigest(prescription)
        ) {
          throw new AppError(
            422,
            "PRESCRIPTION_INTEGRITY_FAILED",
            "Prescription cryptographic checksum verification failed"
          );
        }

        // Verify medication coverage for prescription-required items
        const medicineDocs = await Medicine.find({
          _id: { $in: order.items.map((i) => i.medicineId) },
        });
        const rxMedicineIds = new Set(
          medicineDocs
            .filter((m) => m.prescriptionRequired)
            .map((m) => m._id.toString())
        );
        const rxMedicineNames = new Set(
          medicineDocs
            .filter((m) => m.prescriptionRequired)
            .map((m) => m.name.toLowerCase().trim())
        );

        const prescribedMedicineIds = new Set(
          prescription.medicines.map((m) => m.medicineId.toString())
        );
        const prescribedNames = new Set(
          prescription.medicines.map((m) => m.medicineName.toLowerCase().trim())
        );

        for (const item of order.items) {
          const isRx =
            rxMedicineIds.has(item.medicineId.toString()) ||
            rxMedicineNames.has(item.medicineName.toLowerCase().trim());
          if (isRx) {
            const matchesId = prescribedMedicineIds.has(
              item.medicineId.toString()
            );
            const matchesName = prescribedNames.has(
              item.medicineName.toLowerCase().trim()
            );
            if (!matchesId && !matchesName) {
              throw new AppError(
                422,
                "ORDER_PRESCRIPTION_REJECTED",
                `Attached prescription does not cover required medicine: ${item.medicineName}`
              );
            }
          }
        }
      }

      // Transition order atomically to PHARMACY_ACCEPTED
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: OrderStatus.PRESCRIPTION_REVIEW,
        },
        {
          $set: {
            status: OrderStatus.PHARMACY_ACCEPTED,
            prescriptionReview: {
              decision: "APPROVED",
              reviewedBy: new mongoose.Types.ObjectId(user.id),
              reviewedAt: new Date(),
            },
          },
        },
        { new: true }
      );

      if (!updatedOrder) {
        throw new AppError(
          409,
          "ORDER_INVALID_TRANSITION",
          "Order has already been reviewed or state changed concurrently"
        );
      }

      // Fail-safe Audit Log
      void auditLogService
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ORDER_PRESCRIPTION_VERIFIED,
          resourceType: "Order",
          resourceId: updatedOrder._id.toString(),
          patientId: updatedOrder.patientId.toString(),
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          status: "SUCCESS",
          metadata: {
            decision: "APPROVED",
            reviewerId: user.id,
            pharmacyId: pharmacyProfile._id.toString(),
            orderId: updatedOrder._id.toString(),
            prescriptionId: updatedOrder.prescriptionId?.toString(),
          },
        })
        .catch(() => {});

      // Fail-safe In-App Notification
      try {
        await Notification.create({
          userId: updatedOrder.patientId,
          type: NotificationType.ORDER_ACCEPTED,
          title: "Prescription Verified & Approved",
          message:
            "The pharmacy has verified your prescription. Your order is now accepted and being prepared.",
          relatedEntityType: "Order",
          relatedEntityId: updatedOrder._id,
          metadata: {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.PHARMACY_ACCEPTED,
          },
        });
      } catch {}

      // Socket.IO event
      try {
        const { io } = await import("../server.js");
        if (io) {
          io.to(`patient:${updatedOrder.patientId}`).emit(
            "order:prescription-reviewed",
            {
              orderId: updatedOrder._id.toString(),
              decision: "APPROVED",
              status: OrderStatus.PHARMACY_ACCEPTED,
            }
          );
          io.to(`order:${updatedOrder._id}`).emit("order:status-updated", {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.PHARMACY_ACCEPTED,
          });
        }
      } catch {}

      return updatedOrder;
    } else {
      // Rejection decision
      const updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: OrderStatus.PRESCRIPTION_REVIEW,
        },
        {
          $set: {
            status: OrderStatus.REJECTED,
            prescriptionReview: {
              decision: "REJECTED",
              reviewedBy: new mongoose.Types.ObjectId(user.id),
              reviewedAt: new Date(),
              rejectionReason: input.rejectionReason,
            },
          },
        },
        { new: true }
      );

      if (!updatedOrder) {
        throw new AppError(
          409,
          "ORDER_INVALID_TRANSITION",
          "Order has already been reviewed or state changed concurrently"
        );
      }

      // Idempotently release reserved inventory stock
      if (!updatedOrder.stockReleased) {
        for (const item of updatedOrder.items) {
          try {
            await Inventory.updateOne(
              {
                pharmacyId: updatedOrder.pharmacyId,
                medicineId: item.medicineId,
                reservedQuantity: { $gte: item.quantity },
              },
              {
                $inc: { reservedQuantity: -item.quantity },
              }
            );
          } catch {}
        }
        await Order.updateOne(
          { _id: updatedOrder._id },
          { $set: { stockReleased: true } }
        );
        updatedOrder.stockReleased = true;
      }

      // Automated Refund initiation if order was paid
      if (updatedOrder.paymentStatus === "PAID" && updatedOrder.paymentId) {
        try {
          const refundResult = await paymentService.processRefund(
            updatedOrder.paymentId.toString(),
            updatedOrder.totals.totalAmount,
            input.rejectionReason || "Prescription rejected by pharmacist",
            user
          );
          if (
            refundResult.status === "PROCESSED" ||
            refundResult.status === "ALREADY_REFUNDED"
          ) {
            await Order.updateOne(
              { _id: updatedOrder._id },
              { $set: { paymentStatus: "REFUNDED" } }
            );
            updatedOrder.paymentStatus = "REFUNDED";
          } else if (refundResult.status === "PENDING") {
            await Order.updateOne(
              { _id: updatedOrder._id },
              { $set: { paymentStatus: "REFUND_PENDING" } }
            );
            updatedOrder.paymentStatus = "REFUND_PENDING";
          }
        } catch (refundError) {
          // Do not mark fully refunded on failure. Order remains rejected.
          console.error(
            `[OrderService] Refund failed during prescription rejection for order ${updatedOrder._id}:`,
            refundError
          );
        }
      }

      // Fail-safe Audit Log
      void auditLogService
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ORDER_PRESCRIPTION_REJECTED,
          resourceType: "Order",
          resourceId: updatedOrder._id.toString(),
          patientId: updatedOrder.patientId.toString(),
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          status: "SUCCESS",
          metadata: {
            decision: "REJECTED",
            reviewerId: user.id,
            pharmacyId: pharmacyProfile._id.toString(),
            orderId: updatedOrder._id.toString(),
            rejectionReason: input.rejectionReason,
          },
        })
        .catch(() => {});

      // Fail-safe In-App Notification
      try {
        await Notification.create({
          userId: updatedOrder.patientId,
          type: NotificationType.ORDER_REJECTED,
          title: "Prescription Rejected",
          message: `Your prescription was not approved by the pharmacy: ${input.rejectionReason}. Any payment will be refunded.`,
          relatedEntityType: "Order",
          relatedEntityId: updatedOrder._id,
          metadata: {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.REJECTED,
            rejectionReason: input.rejectionReason,
          },
        });
      } catch {}

      // Socket.IO event
      try {
        const { io } = await import("../server.js");
        if (io) {
          io.to(`patient:${updatedOrder.patientId}`).emit(
            "order:prescription-reviewed",
            {
              orderId: updatedOrder._id.toString(),
              decision: "REJECTED",
              status: OrderStatus.REJECTED,
              rejectionReason: input.rejectionReason,
            }
          );
          io.to(`order:${updatedOrder._id}`).emit("order:status-updated", {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.REJECTED,
          });
        }
      } catch {}

      return updatedOrder;
    }
  }

  /**
   * Advances order status along fulfillment state machine pipeline.
   * Source: docs/api/API_CONTRACT.md Group 12.3 & docs/api/STATE_MACHINES.md Group 4.
   */
  public async updateOrderStatus(
    user: AuthenticatedUser,
    orderId: string,
    input: UpdateOrderStatusInput,
    context?: RequestAuditContext
  ): Promise<IOrder> {
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      throw AppError.badRequest(
        "Invalid order identifier format",
        "BAD_REQUEST"
      );
    }

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found");
    }

    // Authorization: Assigned verified Pharmacy or Admin
    if (user.role === UserRole.PHARMACY) {
      await this.resolveAssignedPharmacyProfile(user, order);
    } else if (user.role !== UserRole.ADMIN) {
      throw AppError.forbidden(
        "Access denied: you do not have permission to update fulfillment status",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // State Machine Transition Rules
    if (order.status === input.status) {
      throw new AppError(
        409,
        "ORDER_INVALID_TRANSITION",
        `Order is already in '${order.status}' status`
      );
    }

    const ALLOWED_FULFILLMENT_TRANSITIONS: Record<string, OrderStatus> = {
      [OrderStatus.PHARMACY_ACCEPTED]: OrderStatus.PREPARING,
      [OrderStatus.PREPARING]: OrderStatus.READY_FOR_DELIVERY,
      [OrderStatus.READY_FOR_DELIVERY]: OrderStatus.OUT_FOR_DELIVERY,
      [OrderStatus.OUT_FOR_DELIVERY]: OrderStatus.DELIVERED,
    };

    const expectedNextStatus = ALLOWED_FULFILLMENT_TRANSITIONS[order.status];
    if (!expectedNextStatus || expectedNextStatus !== input.status) {
      throw new AppError(
        409,
        "ORDER_INVALID_TRANSITION",
        `Cannot transition order from '${order.status}' to '${input.status}'. Allowed next status is '${expectedNextStatus || "NONE"}'.`
      );
    }

    let updatedOrder: IOrder | null = null;

    if (input.status === OrderStatus.PREPARING) {
      updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: OrderStatus.PHARMACY_ACCEPTED,
        },
        {
          $set: {
            status: OrderStatus.PREPARING,
          },
        },
        { new: true }
      );

      if (!updatedOrder) {
        throw new AppError(
          409,
          "ORDER_INVALID_TRANSITION",
          "Order status was changed concurrently"
        );
      }

      // Permanently decrement physical quantity and clear reservation
      if (!updatedOrder.stockConsumed) {
        for (const item of updatedOrder.items) {
          try {
            await Inventory.updateOne(
              {
                pharmacyId: updatedOrder.pharmacyId,
                medicineId: item.medicineId,
                quantity: { $gte: item.quantity },
                reservedQuantity: { $gte: item.quantity },
              },
              {
                $inc: {
                  quantity: -item.quantity,
                  reservedQuantity: -item.quantity,
                },
              }
            );
          } catch {}
        }
        await Order.updateOne(
          { _id: updatedOrder._id },
          { $set: { stockConsumed: true } }
        );
        updatedOrder.stockConsumed = true;
      }

      void auditLogService
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ORDER_STATUS_CHANGED,
          resourceType: "Order",
          resourceId: updatedOrder._id.toString(),
          patientId: updatedOrder.patientId.toString(),
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          status: "SUCCESS",
          metadata: {
            from: OrderStatus.PHARMACY_ACCEPTED,
            to: OrderStatus.PREPARING,
            pharmacyId: updatedOrder.pharmacyId.toString(),
          },
        })
        .catch(() => {});

      try {
        await Notification.create({
          userId: updatedOrder.patientId,
          type: NotificationType.ORDER_STATUS_UPDATED,
          title: "Order Packaging Started",
          message:
            "Your medicine order is now being packed and prepared by the pharmacy.",
          relatedEntityType: "Order",
          relatedEntityId: updatedOrder._id,
          metadata: { status: OrderStatus.PREPARING },
        });
      } catch {}
    } else if (input.status === OrderStatus.READY_FOR_DELIVERY) {
      updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: OrderStatus.PREPARING,
        },
        {
          $set: {
            status: OrderStatus.READY_FOR_DELIVERY,
          },
        },
        { new: true }
      );

      if (!updatedOrder) {
        throw new AppError(
          409,
          "ORDER_INVALID_TRANSITION",
          "Order status was changed concurrently"
        );
      }

      void auditLogService
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ORDER_STATUS_CHANGED,
          resourceType: "Order",
          resourceId: updatedOrder._id.toString(),
          patientId: updatedOrder.patientId.toString(),
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          status: "SUCCESS",
          metadata: {
            from: OrderStatus.PREPARING,
            to: OrderStatus.READY_FOR_DELIVERY,
            pharmacyId: updatedOrder.pharmacyId.toString(),
          },
        })
        .catch(() => {});

      try {
        await Notification.create({
          userId: updatedOrder.patientId,
          type: NotificationType.ORDER_STATUS_UPDATED,
          title: "Order Ready for Pickup",
          message:
            "Your medicine order has been packed and is ready for courier pickup.",
          relatedEntityType: "Order",
          relatedEntityId: updatedOrder._id,
          metadata: { status: OrderStatus.READY_FOR_DELIVERY },
        });
      } catch {}
    } else if (input.status === OrderStatus.OUT_FOR_DELIVERY) {
      // Generate secure 6-digit random OTP
      const plaintextOtp = crypto.randomInt(100000, 1000000).toString();
      const hashedOtp = crypto
        .createHash("sha256")
        .update(plaintextOtp)
        .digest("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours expiry

      updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: OrderStatus.READY_FOR_DELIVERY,
        },
        {
          $set: {
            status: OrderStatus.OUT_FOR_DELIVERY,
            deliveryOtp: hashedOtp,
            deliveryOtpExpiresAt: expiresAt,
            deliveryOtpAttempts: 0,
          },
        },
        { new: true }
      );

      if (!updatedOrder) {
        throw new AppError(
          409,
          "ORDER_INVALID_TRANSITION",
          "Order status was changed concurrently"
        );
      }

      // Audit log (MUST NOT log plaintext or hashed OTP)
      void auditLogService
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ORDER_STATUS_CHANGED,
          resourceType: "Order",
          resourceId: updatedOrder._id.toString(),
          patientId: updatedOrder.patientId.toString(),
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          status: "SUCCESS",
          metadata: {
            from: OrderStatus.READY_FOR_DELIVERY,
            to: OrderStatus.OUT_FOR_DELIVERY,
            pharmacyId: updatedOrder.pharmacyId.toString(),
          },
        })
        .catch(() => {});

      // Notify patient with plaintext OTP
      try {
        await Notification.create({
          userId: updatedOrder.patientId,
          type: NotificationType.ORDER_STATUS_UPDATED,
          title: "Order Out for Delivery",
          message: `Your medicine order is out for delivery! Share delivery code ${plaintextOtp} with the courier upon arrival.`,
          relatedEntityType: "Order",
          relatedEntityId: updatedOrder._id,
          metadata: {
            status: OrderStatus.OUT_FOR_DELIVERY,
          },
        });
      } catch {}

      // Socket.IO event to patient
      try {
        const { io } = await import("../server.js");
        if (io) {
          io.to(`patient:${updatedOrder.patientId}`).emit(
            "order:out-for-delivery",
            {
              orderId: updatedOrder._id.toString(),
              status: OrderStatus.OUT_FOR_DELIVERY,
              deliveryOtp: plaintextOtp,
            }
          );
          io.to(`order:${updatedOrder._id}`).emit("order:status-updated", {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.OUT_FOR_DELIVERY,
          });
        }
      } catch {}
    } else if (input.status === OrderStatus.DELIVERED) {
      if (!input.deliveryOtp) {
        throw new AppError(
          422,
          "DELIVERY_OTP_REQUIRED",
          "Delivery OTP is required to mark order as delivered"
        );
      }

      if (!order.deliveryOtp) {
        throw new AppError(
          422,
          "DELIVERY_OTP_INVALID",
          "Delivery verification OTP has not been generated for this order"
        );
      }

      if ((order.deliveryOtpAttempts || 0) >= 5) {
        throw new AppError(
          422,
          "DELIVERY_OTP_MAX_ATTEMPTS_EXCEEDED",
          "Maximum OTP verification attempts exceeded for this order. Please contact support."
        );
      }

      if (
        order.deliveryOtpExpiresAt &&
        new Date(order.deliveryOtpExpiresAt).getTime() < Date.now()
      ) {
        throw new AppError(
          422,
          "DELIVERY_OTP_EXPIRED",
          "Delivery verification OTP has expired"
        );
      }

      // Verify OTP using constant-time comparison
      const inputHash = crypto
        .createHash("sha256")
        .update(input.deliveryOtp.trim())
        .digest("hex");
      const storedBuffer = Buffer.from(order.deliveryOtp, "hex");
      const inputBuffer = Buffer.from(inputHash, "hex");
      const isMatch =
        storedBuffer.length === inputBuffer.length &&
        crypto.timingSafeEqual(storedBuffer, inputBuffer);

      if (!isMatch) {
        await Order.updateOne(
          { _id: order._id },
          { $inc: { deliveryOtpAttempts: 1 } }
        );
        throw new AppError(
          422,
          "DELIVERY_OTP_INVALID",
          "Invalid delivery verification code"
        );
      }

      // Atomically mark delivered and consume OTP
      updatedOrder = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: OrderStatus.OUT_FOR_DELIVERY,
        },
        {
          $set: {
            status: OrderStatus.DELIVERED,
            deliveredAt: new Date(),
          },
          $unset: {
            deliveryOtp: 1,
            deliveryOtpExpiresAt: 1,
          },
        },
        { new: true }
      );

      if (!updatedOrder) {
        throw new AppError(
          409,
          "ORDER_INVALID_TRANSITION",
          "Order delivery was confirmed concurrently or status is no longer OUT_FOR_DELIVERY"
        );
      }

      void auditLogService
        .log({
          actorId: user.id,
          actorRole: user.role,
          action: AuditAction.ORDER_STATUS_CHANGED,
          resourceType: "Order",
          resourceId: updatedOrder._id.toString(),
          patientId: updatedOrder.patientId.toString(),
          ipAddress: context?.ip,
          userAgent: context?.userAgent,
          status: "SUCCESS",
          metadata: {
            status: OrderStatus.DELIVERED,
            deliveredAt: updatedOrder.deliveredAt,
            pharmacyId: updatedOrder.pharmacyId.toString(),
          },
        })
        .catch(() => {});

      void notificationService
        .dispatch({
          userId: updatedOrder.patientId,
          type: NotificationType.ORDER_DELIVERED,
          title: "Order Delivered",
          message:
            "Your medicine order has been successfully delivered. Thank you for choosing LifeLine!",
          relatedEntityType: "Order",
          relatedEntityId: updatedOrder._id,
          metadata: {
            status: OrderStatus.DELIVERED,
            deliveredAt: updatedOrder.deliveredAt,
          },
        })
        .catch(() => {});

      try {
        const { io } = await import("../server.js");
        if (io) {
          io.to(`patient:${updatedOrder.patientId}`).emit("order:delivered", {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.DELIVERED,
            deliveredAt: updatedOrder.deliveredAt,
          });
          io.to(`order:${updatedOrder._id}`).emit("order:status-updated", {
            orderId: updatedOrder._id.toString(),
            status: OrderStatus.DELIVERED,
          });
        }
      } catch {}
    }

    return updatedOrder!;
  }
}

export const orderService = new OrderService();
