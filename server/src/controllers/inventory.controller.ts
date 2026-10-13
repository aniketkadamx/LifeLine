import type { Request, Response, NextFunction } from "express";
import { inventoryService } from "../services/inventory.service.js";
import { AppError } from "../utils/api-error.js";
import { sendPaginated, sendSuccess } from "../utils/api-response.js";
import { UserRole } from "../types/models.js";
import type {
  CreateInventoryInput,
  PublicInventoryQuery,
  UpdateInventoryInput,
} from "../validators/inventory.validator.js";

/**
 * Handler: GET /api/v1/pharmacies/:id/inventory
 *
 * Dual-behavior inventory list endpoint:
 * 1. If caller is the verified owning pharmacy (or :id is "me"), returns private management view.
 * 2. If caller is public/patient, returns public stock discovery view (hiding sensitive batch/threshold fields).
 * Source: docs/api/API_CONTRACT.md Group 11.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
export async function getPharmacyInventoryHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const query = req.query as unknown as PublicInventoryQuery;

    // If :id is "me", return private management view for authenticated owning pharmacy
    if (id === "me") {
      if (!req.user || !req.user.id) {
        throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
      }

      const result = await inventoryService.getPrivatePharmacyInventory(
        req.user,
        id,
        query
      );

      sendPaginated(
        res,
        result.inventory,
        {
          page: result.page,
          limit: result.limit,
          total: result.total,
          sort: (query.sort as string) || "createdAt",
          order: (query.order as "asc" | "desc") || "desc",
        },
        "Pharmacy inventory retrieved successfully",
        200
      );
      return;
    }

    // Default: Public read-only stock discovery
    const result = await inventoryService.getPublicPharmacyInventory(id, query);

    sendPaginated(
      res,
      result.inventory,
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
        sort: (query.sort as string) || "createdAt",
        order: (query.order as "asc" | "desc") || "desc",
      },
      "Public pharmacy stock retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/pharmacies/:id/inventory
 *
 * Adds a master-catalog medicine to pharmacy inventory with quantity, pricing, batch, and expiry.
 * Access: Restricted strictly to the authenticated, verified owning pharmacy.
 * Source: docs/api/API_CONTRACT.md Group 11 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
export async function addMedicineToStockHandler(
  req: Request<{ id: string }, unknown, CreateInventoryInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const inventory = await inventoryService.addMedicineToStock(
      req.user,
      id,
      req.body,
      {
        ip: (req.headers["x-test-client-ip"] as string) || req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(
      res,
      inventory,
      "Medicine added to pharmacy inventory successfully",
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/pharmacies/:id/inventory/:inventoryId
 *
 * Updates stock quantity, unit price, batch number, or expiry date.
 * Access: Restricted strictly to the authenticated, verified owning pharmacy.
 * Source: docs/api/API_CONTRACT.md Group 11.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
export async function updateInventoryItemHandler(
  req: Request<{ id: string; inventoryId: string }, unknown, UpdateInventoryInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id, inventoryId } = req.params;
    const updated = await inventoryService.updateInventoryItem(
      req.user,
      id,
      inventoryId,
      req.body,
      {
        ip: (req.headers["x-test-client-ip"] as string) || req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(res, updated, "Inventory item updated successfully", 200);
  } catch (error) {
    next(error);
  }
}
