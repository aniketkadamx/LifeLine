import mongoose, { type FilterQuery } from "mongoose";
import { Inventory } from "../models/inventory.model.js";
import { PharmacyProfile } from "../models/pharmacy-profile.model.js";
import { Medicine } from "../models/medicine.model.js";
import { auditLogService } from "./audit-log.service.js";
import { escapeRegex } from "./medicine.service.js";
import {
  PharmacyVerificationStatus,
  UserRole,
  type IInventory,
  type IPharmacyProfile,
  type IMedicine,
} from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import { AppError } from "../utils/api-error.js";
import type {
  CreateInventoryInput,
  PublicInventoryQuery,
  UpdateInventoryInput,
} from "../validators/inventory.validator.js";

export interface RequestAuditContext {
  ip?: string;
  userAgent?: string;
}

export interface InventoryListResult<T = IInventory> {
  inventory: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PublicInventoryItem {
  id: string;
  pharmacyId: string;
  medicine: IMedicine;
  price: number;
  quantity: number;
  isAvailable: boolean;
  expiryDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Service managing pharmacy multi-tenant inventory stock, unit pricing,
 * batch tracking, expiration management, and public stock discovery.
 */
export class InventoryService {
  /**
   * Resolves the authenticated pharmacy profile and strictly verifies:
   * 1. Caller possesses role PHARMACY.
   * 2. Profile exists for caller.
   * 3. Profile status is APPROVED_VERIFIED.
   * 4. Multi-tenant ownership: if routeParamId is supplied, it must belong to this pharmacy.
   *
   * @param user Authenticated user context
   * @param routeParamId Target pharmacy parameter ("me" or ObjectId)
   * @throws AppError 403 or 404 on permission/tenant failure
   * @returns Authorized IPharmacyProfile document
   */
  public async resolveAuthorizedPharmacy(
    user: AuthenticatedUser,
    routeParamId: string
  ): Promise<IPharmacyProfile> {
    if (user.role !== UserRole.PHARMACY) {
      throw AppError.forbidden(
        "Access denied: only pharmacy accounts may manage inventory",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const pharmacyProfile = await PharmacyProfile.findOne({
      userId: new mongoose.Types.ObjectId(user.id),
    });

    if (!pharmacyProfile) {
      throw new AppError(
        404,
        "PHARMACY_NOT_FOUND",
        "Pharmacy profile not found for authenticated user"
      );
    }

    if (
      pharmacyProfile.verificationStatus !==
      PharmacyVerificationStatus.APPROVED_VERIFIED
    ) {
      throw new AppError(
        403,
        "PHARMACY_NOT_VERIFIED",
        "Pharmacy account is unverified or pending administrative license review"
      );
    }

    // Multi-tenant isolation: prevent Pharmacy A from modifying Pharmacy B's stock
    if (routeParamId !== "me") {
      const isOwner =
        routeParamId === pharmacyProfile._id.toString() ||
        routeParamId === pharmacyProfile.userId.toString();

      if (!isOwner) {
        throw AppError.forbidden(
          "Access denied: cannot modify or manage another pharmacy's inventory",
          "AUTH_INSUFFICIENT_PERMISSIONS"
        );
      }
    }

    return pharmacyProfile;
  }

  /**
   * Resolves a target pharmacy for public read-only discovery.
   * Enforces that the pharmacy exists and is currently APPROVED_VERIFIED.
   */
  public async resolvePublicPharmacy(
    pharmacyParamId: string
  ): Promise<IPharmacyProfile> {
    if (!mongoose.Types.ObjectId.isValid(pharmacyParamId)) {
      throw AppError.badRequest(
        "Invalid pharmacy identifier format",
        "BAD_REQUEST"
      );
    }

    const pharmacyObjectId = new mongoose.Types.ObjectId(pharmacyParamId);
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
        "Pharmacy is not currently approved for public medicine dispensing"
      );
    }

    return pharmacyProfile;
  }

  /**
   * Adds a master-catalog medicine to the pharmacy's inventory stock.
   *
   * Enforces:
   * - Caller is the verified owning pharmacy.
   * - Master medicine exists and is active.
   * - Non-negative stock quantity and positive selling price.
   * - Database-level compound uniqueness on { pharmacyId, medicineId }.
   */
  public async addMedicineToStock(
    user: AuthenticatedUser,
    routeParamId: string,
    input: CreateInventoryInput,
    context?: RequestAuditContext
  ): Promise<IInventory> {
    const pharmacyProfile = await this.resolveAuthorizedPharmacy(
      user,
      routeParamId
    );

    // Verify master catalog medicine
    const medicine = await Medicine.findById(input.medicineId);
    if (!medicine) {
      throw new AppError(
        404,
        "MEDICINE_NOT_FOUND",
        "Referenced medicine does not exist in master catalog"
      );
    }

    if (!medicine.isActive) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        "Cannot add an inactive catalog medicine to pharmacy inventory"
      );
    }

    let inventory: IInventory;
    try {
      inventory = await Inventory.create({
        pharmacyId: pharmacyProfile._id,
        medicineId: medicine._id,
        quantity: input.quantity,
        price: input.price,
        batchNumber: input.batchNumber?.trim() || undefined,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
        isAvailable: input.isAvailable !== undefined ? input.isAvailable : true,
        lowStockThreshold: input.lowStockThreshold ?? 10,
        reorderQuantity: input.reorderQuantity ?? 50,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new AppError(
          409,
          "RESOURCE_CONFLICT",
          "Medicine already exists in pharmacy inventory. Use update endpoint to modify stock or pricing."
        );
      }
      throw error;
    }

    // Fail-safe audit log
    void auditLogService
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: "INVENTORY_CREATED",
        resourceType: "Inventory",
        resourceId: inventory._id.toString(),
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        status: "SUCCESS",
        metadata: {
          pharmacyId: pharmacyProfile._id.toString(),
          medicineId: medicine._id.toString(),
          medicineName: medicine.name,
          quantity: input.quantity,
          price: input.price,
        },
      })
      .catch(() => {});

    return inventory;
  }

  /**
   * Updates an existing pharmacy inventory record atomically.
   *
   * Enforces:
   * - Caller is the verified owning pharmacy.
   * - Multi-tenant isolation: query filter strictly binds pharmacyId: profile._id.
   * - Atomic mutation: prevents negative stock or inconsistent concurrent states.
   */
  public async updateInventoryItem(
    user: AuthenticatedUser,
    routeParamId: string,
    inventoryId: string,
    input: UpdateInventoryInput,
    context?: RequestAuditContext
  ): Promise<IInventory> {
    const pharmacyProfile = await this.resolveAuthorizedPharmacy(
      user,
      routeParamId
    );

    if (!mongoose.Types.ObjectId.isValid(inventoryId)) {
      throw AppError.badRequest(
        "Invalid inventory identifier format",
        "BAD_REQUEST"
      );
    }

    // Tenant check: ensure item exists and belongs to this pharmacy
    const existing = await Inventory.findById(inventoryId);
    if (!existing) {
      throw new AppError(
        404,
        "INVENTORY_NOT_FOUND",
        "Inventory item not found"
      );
    }

    if (existing.pharmacyId.toString() !== pharmacyProfile._id.toString()) {
      throw AppError.forbidden(
        "Access denied: cannot modify another pharmacy's inventory item",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    const updateFields: Record<string, unknown> = {};
    if (input.quantity !== undefined) {
      updateFields.quantity = input.quantity;
    }
    if (input.price !== undefined) {
      updateFields.price = input.price;
    }
    if (input.batchNumber !== undefined) {
      updateFields.batchNumber = input.batchNumber.trim() || undefined;
    }
    if (input.expiryDate !== undefined) {
      updateFields.expiryDate = new Date(input.expiryDate);
    }
    if (input.isAvailable !== undefined) {
      updateFields.isAvailable = input.isAvailable;
    }
    if (input.lowStockThreshold !== undefined) {
      updateFields.lowStockThreshold = input.lowStockThreshold;
    }
    if (input.reorderQuantity !== undefined) {
      updateFields.reorderQuantity = input.reorderQuantity;
    }

    // Atomic conditional update scoped strictly to this pharmacy's tenant ID
    const updated = await Inventory.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(inventoryId),
        pharmacyId: pharmacyProfile._id,
      },
      { $set: updateFields },
      { new: true, runValidators: true }
    ).populate("medicineId");

    if (!updated) {
      throw new AppError(
        404,
        "INVENTORY_NOT_FOUND",
        "Inventory item not found"
      );
    }

    // Fail-safe audit log
    void auditLogService
      .log({
        actorId: user.id,
        actorRole: user.role,
        action: "INVENTORY_UPDATED",
        resourceType: "Inventory",
        resourceId: inventoryId,
        ipAddress: context?.ip,
        userAgent: context?.userAgent,
        status: "SUCCESS",
        metadata: {
          pharmacyId: pharmacyProfile._id.toString(),
          inventoryId,
          updatedFields: Object.keys(input),
        },
      })
      .catch(() => {});

    return updated;
  }

  /**
   * Retrieves full private management inventory for the owning pharmacy.
   * Contains sensitive operational fields (lowStockThreshold, batchNumber, etc.).
   */
  public async getPrivatePharmacyInventory(
    user: AuthenticatedUser,
    routeParamId: string,
    query: PublicInventoryQuery
  ): Promise<InventoryListResult<IInventory>> {
    const pharmacyProfile = await this.resolveAuthorizedPharmacy(
      user,
      routeParamId
    );

    const filter: FilterQuery<IInventory> = {
      pharmacyId: pharmacyProfile._id,
    };

    if (query.medicineId) {
      filter.medicineId = new mongoose.Types.ObjectId(query.medicineId);
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const sortField = query.sort || "createdAt";
    const sortOrder = query.order === "asc" ? 1 : -1;

    const [inventory, total] = await Promise.all([
      Inventory.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate("medicineId")
        .lean(),
      Inventory.countDocuments(filter),
    ]);

    return {
      inventory: inventory as IInventory[],
      total,
      page,
      limit,
    };
  }

  /**
   * Public read-only stock discovery endpoint for patients and general consumers.
   *
   * Protection Guarantees:
   * 1. Requires verified pharmacy status.
   * 2. Excludes expired batches (expiryDate strictly in future or unset).
   * 3. Excludes out-of-stock items (quantity > 0 and isAvailable = true).
   * 4. Hides internal operational data (batchNumber, lowStockThreshold, reorderQuantity).
   * 5. Populates public medicine catalog metadata.
   */
  public async getPublicPharmacyInventory(
    pharmacyParamId: string,
    query: PublicInventoryQuery
  ): Promise<InventoryListResult<PublicInventoryItem>> {
    const pharmacyProfile = await this.resolvePublicPharmacy(pharmacyParamId);

    const now = new Date();
    const filter: FilterQuery<IInventory> = {
      pharmacyId: pharmacyProfile._id,
      // Expiration check: never advertise expired drugs to patients
      $or: [
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        { expiryDate: { $gt: now } },
      ],
    };

    // Stock availability filter
    if (query.inStockOnly !== false) {
      filter.isAvailable = true;
      filter.quantity = { $gt: 0 };
    }

    if (query.medicineId) {
      filter.medicineId = new mongoose.Types.ObjectId(query.medicineId);
    }

    // Medicine catalog criteria (search term, category, dosageForm)
    if (query.search || query.category || query.dosageForm) {
      const medFilter: FilterQuery<IMedicine> = { isActive: true };

      if (query.dosageForm) {
        medFilter.dosageForm = query.dosageForm;
      }

      if (query.category) {
        medFilter.category = {
          $regex: `^${escapeRegex(query.category)}$`,
          $options: "i",
        };
      }

      if (query.search) {
        const escaped = escapeRegex(query.search);
        const searchRegex = { $regex: escaped, $options: "i" };
        medFilter.$or = [
          { name: searchRegex },
          { genericName: searchRegex },
          { brandName: searchRegex },
        ];
      }

      const matchingMedicines = await Medicine.find(medFilter)
        .select("_id")
        .lean();
      const matchingIds = matchingMedicines.map((m) => m._id);

      // If user queried specific medicine filters and none matched catalog
      if (matchingIds.length === 0) {
        return {
          inventory: [],
          total: 0,
          page: query.page || 1,
          limit: query.limit || 20,
        };
      }

      filter.medicineId = { $in: matchingIds };
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const sortField = query.sort || "createdAt";
    const sortOrder = query.order === "asc" ? 1 : -1;

    const [items, total] = await Promise.all([
      Inventory.find(filter)
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limit)
        .populate("medicineId")
        .lean(),
      Inventory.countDocuments(filter),
    ]);

    // Sanitize items: hide private internal fields from public patients
    const publicItems: PublicInventoryItem[] = items.map((doc: any) => ({
      id: doc._id.toString(),
      pharmacyId: doc.pharmacyId.toString(),
      medicine: doc.medicineId as IMedicine,
      price: doc.price,
      quantity: doc.quantity,
      isAvailable: Boolean(doc.isAvailable && doc.quantity > 0),
      expiryDate: doc.expiryDate,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }));

    return {
      inventory: publicItems,
      total,
      page,
      limit,
    };
  }
}

export const inventoryService = new InventoryService();
