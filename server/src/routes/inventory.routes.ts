import { Router } from "express";
import {
  addMedicineToStockHandler,
  getPharmacyInventoryHandler,
  updateInventoryItemHandler,
} from "../controllers/inventory.controller.js";
import {
  authenticate,
  optionalAuthenticate,
} from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  createInventorySchema,
  inventoryIdParamSchema,
  pharmacyIdParamSchema,
  publicInventoryQuerySchema,
  updateInventorySchema,
} from "../validators/inventory.validator.js";
import { UserRole } from "../types/models.js";

/**
 * Inventory router mounted with mergeParams: true so that parent route parameters
 * (:id from /pharmacies/:id/inventory) are accessible to all handlers.
 */
export const inventoryRouter = Router({ mergeParams: true });

/**
 * GET /api/v1/pharmacies/:id/inventory
 * Public discovery of available stock or private management view for verified owner.
 * Access: Public read-only / Authenticated owning pharmacy for full management details.
 * Source: docs/api/API_CONTRACT.md Group 11.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
inventoryRouter.get(
  "/",
  optionalAuthenticate,
  validateParams(pharmacyIdParamSchema),
  validateQuery(publicInventoryQuerySchema),
  getPharmacyInventoryHandler
);

/**
 * POST /api/v1/pharmacies/:id/inventory
 * Adds a master-catalog medicine to pharmacy inventory with quantity, pricing, batch, and expiry.
 * Access: Authenticated, verified owning pharmacy.
 * Source: docs/api/API_CONTRACT.md Group 11 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
inventoryRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateParams(pharmacyIdParamSchema),
  validateBody(createInventorySchema),
  addMedicineToStockHandler
);

/**
 * PATCH /api/v1/pharmacies/:id/inventory/:inventoryId
 * Updates stock quantity, unit price, batch number, or expiry date.
 * Access: Authenticated, verified owning pharmacy.
 * Source: docs/api/API_CONTRACT.md Group 11.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.2.
 */
inventoryRouter.patch(
  "/:inventoryId",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateParams(inventoryIdParamSchema),
  validateBody(updateInventorySchema),
  updateInventoryItemHandler
);

/**
 * PUT /api/v1/pharmacies/:id/inventory/:inventoryId
 * Updates stock quantity, unit price, batch number, or expiry date.
 * Access: Authenticated, verified owning pharmacy.
 */
inventoryRouter.put(
  "/:inventoryId",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateParams(inventoryIdParamSchema),
  validateBody(updateInventorySchema),
  updateInventoryItemHandler
);
