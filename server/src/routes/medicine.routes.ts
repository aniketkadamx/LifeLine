import { Router } from "express";
import {
  createMedicineHandler,
  getMedicineByIdHandler,
  searchMedicinesHandler,
  updateMedicineHandler,
} from "../controllers/medicine.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  createMedicineSchema,
  medicineIdParamSchema,
  medicineSearchQuerySchema,
  updateMedicineSchema,
} from "../validators/medicine.validator.js";
import { UserRole } from "../types/models.js";

export const medicineRouter = Router();

/**
 * GET /api/v1/medicines
 * Public search and multi-filter discovery across master medicine catalog.
 * Access: Public (None).
 * Source: docs/api/API_CONTRACT.md Group 10.1 & docs/api/AUTHORIZATION_MATRIX.md Line 63.
 */
medicineRouter.get(
  "/",
  validateQuery(medicineSearchQuerySchema),
  searchMedicinesHandler
);

/**
 * GET /api/v1/medicines/:id
 * Public retrieval of a single master catalog medicine item by ID.
 * Access: Public (None).
 * Source: docs/api/API_CONTRACT.md Group 10 & docs/api/AUTHORIZATION_MATRIX.md Line 63.
 */
medicineRouter.get(
  "/:id",
  validateParams(medicineIdParamSchema),
  getMedicineByIdHandler
);

/**
 * POST /api/v1/medicines
 * Creates a new medicine entry in the master catalog.
 * Access: Restricted strictly to role ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 10.2 & docs/api/AUTHORIZATION_MATRIX.md Line 64.
 */
medicineRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.ADMIN),
  validateBody(createMedicineSchema),
  createMedicineHandler
);

/**
 * PATCH /api/v1/medicines/:id
 * Updates an existing medicine entry in the master catalog.
 * Access: Restricted strictly to role ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 10.2 & docs/api/AUTHORIZATION_MATRIX.md Line 64.
 */
medicineRouter.patch(
  "/:id",
  authenticate,
  authorizeRole(UserRole.ADMIN),
  validateParams(medicineIdParamSchema),
  validateBody(updateMedicineSchema),
  updateMedicineHandler
);

/**
 * PUT /api/v1/medicines/:id
 * Updates an existing medicine entry in the master catalog.
 * Access: Restricted strictly to role ADMIN.
 */
medicineRouter.put(
  "/:id",
  authenticate,
  authorizeRole(UserRole.ADMIN),
  validateParams(medicineIdParamSchema),
  validateBody(updateMedicineSchema),
  updateMedicineHandler
);
