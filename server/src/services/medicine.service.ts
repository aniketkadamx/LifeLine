import mongoose, { type FilterQuery } from "mongoose";
import { Medicine } from "../models/medicine.model.js";
import { auditLogService } from "./audit-log.service.js";
import {
  AuditAction,
  type IMedicine,
} from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import { AppError } from "../utils/api-error.js";
import type {
  CreateMedicineInput,
  MedicineSearchQuery,
  UpdateMedicineInput,
} from "../validators/medicine.validator.js";

/**
 * Escapes special regular-expression metacharacters to prevent ReDoS,
 * regex injection, and pathological query patterns.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface MedicineSearchResult {
  medicines: IMedicine[];
  total: number;
  page: number;
  limit: number;
}

export interface RequestAuditContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Service managing master medicine catalog search, retrieval,
 * and ADMIN-restricted catalog definition management.
 *
 * The master catalog represents central drug definitions and is kept
 * strictly separate from individual pharmacy inventories, stock, and pricing.
 */
export class MedicineService {
  /**
   * Searches the master medicine catalog with multi-dimensional filtering,
   * safe regex pattern construction, and bounded pagination.
   *
   * @param query Validated search and filter parameters
   * @returns Paginated medicine list and metadata
   */
  public async searchMedicines(
    query: MedicineSearchQuery
  ): Promise<MedicineSearchResult> {
    const filter: FilterQuery<IMedicine> = {};

    // 1. Catalog active status: default to active medicines for public catalog
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    } else {
      filter.isActive = true;
    }

    // 2. Prescription requirement filter
    if (query.prescriptionRequired !== undefined) {
      filter.prescriptionRequired = query.prescriptionRequired;
    }

    // 3. Dosage form filter
    if (query.dosageForm) {
      filter.dosageForm = query.dosageForm;
    }

    // 4. Category filter (case-insensitive exact match)
    if (query.category) {
      filter.category = {
        $regex: `^${escapeRegex(query.category)}$`,
        $options: "i",
      };
    }

    // 5. Explicit Name filter
    if (query.name) {
      filter.name = {
        $regex: escapeRegex(query.name),
        $options: "i",
      };
    }

    // 6. Explicit Generic Name filter
    if (query.genericName) {
      filter.genericName = {
        $regex: escapeRegex(query.genericName),
        $options: "i",
      };
    }

    // 7. General search term (matches across name, genericName, brandName, or manufacturer)
    if (query.search) {
      const escaped = escapeRegex(query.search);
      const searchRegex = { $regex: escaped, $options: "i" };
      filter.$or = [
        { name: searchRegex },
        { genericName: searchRegex },
        { brandName: searchRegex },
        { manufacturer: searchRegex },
      ];
    }

    // 8. Sorting mapping
    const sortFieldMap: Record<string, string> = {
      name: "name",
      genericName: "genericName",
      category: "category",
      manufacturer: "manufacturer",
      createdAt: "createdAt",
      updatedAt: "updatedAt",
    };

    const sortField = sortFieldMap[query.sort || "name"] || "name";
    const sortOrder = query.order === "desc" ? -1 : 1;
    const sortOptions: Record<string, 1 | -1> = { [sortField]: sortOrder };

    // 9. Pagination bounds
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    // 10. Execute parallel query and total count
    const [medicines, total] = await Promise.all([
      Medicine.find(filter).sort(sortOptions).skip(skip).limit(limit).lean(),
      Medicine.countDocuments(filter),
    ]);

    return {
      medicines: medicines as IMedicine[],
      total,
      page,
      limit,
    };
  }

  /**
   * Retrieves a single medicine document from the master catalog by ObjectId.
   *
   * @param id Valid 24-hex ObjectId string
   * @throws AppError 404 MEDICINE_NOT_FOUND if not present
   * @returns IMedicine document
   */
  public async getMedicineById(id: string): Promise<IMedicine> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw AppError.badRequest("Invalid medicine identifier format", "BAD_REQUEST");
    }

    const medicine = await Medicine.findById(id).lean();

    if (!medicine) {
      throw new AppError(
        404,
        "MEDICINE_NOT_FOUND",
        "Medicine catalog item not found"
      );
    }

    return medicine as IMedicine;
  }

  /**
   * Adds a new drug definition to the master medicine catalog.
   * Restricted strictly to administrative supervisors (Role ADMIN).
   *
   * @param input Validated medicine creation payload
   * @param actor Authenticated administrative user
   * @param context Optional request audit context (IP, user agent)
   * @returns Newly persisted IMedicine document
   */
  public async createMedicine(
    input: CreateMedicineInput,
    actor: AuthenticatedUser,
    context?: RequestAuditContext
  ): Promise<IMedicine> {
    let medicine: IMedicine;

    try {
      medicine = await Medicine.create({
        name: input.name.trim(),
        genericName: input.genericName.trim(),
        brandName: input.brandName?.trim() || undefined,
        manufacturer: input.manufacturer.trim(),
        dosageForm: input.dosageForm,
        strength: input.strength?.trim() || undefined,
        category: input.category?.trim() || undefined,
        description: input.description?.trim() || undefined,
        prescriptionRequired: input.prescriptionRequired,
        isActive: input.isActive !== undefined ? input.isActive : true,
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new AppError(
          409,
          "RESOURCE_CONFLICT",
          "A medicine entry with these unique parameters already exists in the catalog"
        );
      }
      throw error;
    }

    // Fail-safe audit logging
    void auditLogService.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.ADMIN_ACTION,
      resourceType: "Medicine",
      resourceId: medicine._id.toString(),
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
      status: "SUCCESS",
      metadata: {
        operation: "CREATE_MEDICINE",
        medicineName: medicine.name,
        genericName: medicine.genericName,
        manufacturer: medicine.manufacturer,
      },
    });

    return medicine;
  }

  /**
   * Updates an existing drug definition in the master medicine catalog.
   * Restricted strictly to administrative supervisors (Role ADMIN).
   *
   * @param id Valid 24-hex ObjectId string
   * @param input Validated medicine update payload
   * @param actor Authenticated administrative user
   * @param context Optional request audit context (IP, user agent)
   * @returns Updated IMedicine document
   */
  public async updateMedicine(
    id: string,
    input: UpdateMedicineInput,
    actor: AuthenticatedUser,
    context?: RequestAuditContext
  ): Promise<IMedicine> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw AppError.badRequest("Invalid medicine identifier format", "BAD_REQUEST");
    }

    const medicine = await Medicine.findById(id);

    if (!medicine) {
      throw new AppError(
        404,
        "MEDICINE_NOT_FOUND",
        "Medicine catalog item not found"
      );
    }

    // Apply only provided, legitimate catalog fields
    if (input.name !== undefined) medicine.name = input.name.trim();
    if (input.genericName !== undefined)
      medicine.genericName = input.genericName.trim();
    if (input.brandName !== undefined)
      medicine.brandName = input.brandName.trim() || undefined;
    if (input.manufacturer !== undefined)
      medicine.manufacturer = input.manufacturer.trim();
    if (input.dosageForm !== undefined) medicine.dosageForm = input.dosageForm;
    if (input.strength !== undefined)
      medicine.strength = input.strength.trim() || undefined;
    if (input.category !== undefined)
      medicine.category = input.category.trim() || undefined;
    if (input.description !== undefined)
      medicine.description = input.description.trim() || undefined;
    if (input.prescriptionRequired !== undefined)
      medicine.prescriptionRequired = input.prescriptionRequired;
    if (input.isActive !== undefined) medicine.isActive = input.isActive;

    try {
      await medicine.save();
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new AppError(
          409,
          "RESOURCE_CONFLICT",
          "A medicine entry with these unique parameters already exists in the catalog"
        );
      }
      throw error;
    }

    // Fail-safe audit logging
    void auditLogService.log({
      actorId: actor.id,
      actorRole: actor.role,
      action: AuditAction.ADMIN_ACTION,
      resourceType: "Medicine",
      resourceId: medicine._id.toString(),
      ipAddress: context?.ip,
      userAgent: context?.userAgent,
      status: "SUCCESS",
      metadata: {
        operation: "UPDATE_MEDICINE",
        medicineName: medicine.name,
        updatedFields: Object.keys(input),
      },
    });

    return medicine;
  }
}

export const medicineService = new MedicineService();
