import mongoose, { Types } from "mongoose";
import {
  Order,
  Inventory,
  Medicine,
  PharmacyProfile,
  Prescription,
} from "../models/index.js";
import {
  OrderStatus,
  UserRole,
  PharmacyVerificationStatus,
  PrescriptionStatus,
  AuditAction,
  type IOrder,
  type IOrderItemSnapshot,
  type IMedicine,
} from "../types/models.js";
import { verifyPrescriptionDigest } from "./prescription.service.js";
import { auditLogService } from "./audit-log.service.js";
import { AppError } from "../utils/api-error.js";
import type { AuthenticatedUser } from "../types/express.js";
import type { CreateOrderInput } from "../validators/order.validator.js";

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
}

export const orderService = new OrderService();
