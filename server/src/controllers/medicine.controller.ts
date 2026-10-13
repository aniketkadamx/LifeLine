import type { Request, Response, NextFunction } from "express";
import { medicineService } from "../services/medicine.service.js";
import { AppError } from "../utils/api-error.js";
import { sendPaginated, sendSuccess } from "../utils/api-response.js";
import type {
  CreateMedicineInput,
  MedicineSearchQuery,
  UpdateMedicineInput,
} from "../validators/medicine.validator.js";

/**
 * Handler: GET /api/v1/medicines
 *
 * Public search and filtering of the master medicine catalog:
 * - Publicly accessible (no authentication required).
 * - Multi-dimensional search (name, genericName, category, dosageForm, prescriptionRequired).
 * - Safe regex escaping and bounded pagination.
 * Source: docs/api/API_CONTRACT.md Group 10.1 & docs/api/AUTHORIZATION_MATRIX.md Line 63.
 */
export async function searchMedicinesHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = req.query as unknown as MedicineSearchQuery;
    const result = await medicineService.searchMedicines(query);

    sendPaginated(
      res,
      result.medicines,
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
        sort: (query.sort as string) || "name",
        order: (query.order as "asc" | "desc") || "asc",
      },
      "Medicine catalog retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/medicines/:id
 *
 * Public retrieval of a single master catalog medicine item by ID.
 * Source: docs/api/API_CONTRACT.md Group 10 & docs/api/AUTHORIZATION_MATRIX.md Line 63.
 */
export async function getMedicineByIdHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const medicine = await medicineService.getMedicineById(id);

    sendSuccess(res, medicine, "Medicine retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/medicines
 *
 * Adds a new pharmaceutical record to the master catalog.
 * Access: strictly restricted to role ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 10.2 & docs/api/AUTHORIZATION_MATRIX.md Line 64.
 */
export async function createMedicineHandler(
  req: Request<unknown, unknown, CreateMedicineInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const medicine = await medicineService.createMedicine(
      req.body,
      req.user,
      {
        ip: (req.headers["x-test-client-ip"] as string) || req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(
      res,
      medicine,
      "Medicine created successfully in master catalog",
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/medicines/:id
 *
 * Updates an existing pharmaceutical record in the master catalog.
 * Access: strictly restricted to role ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 10.2 & docs/api/AUTHORIZATION_MATRIX.md Line 64.
 */
export async function updateMedicineHandler(
  req: Request<{ id: string }, unknown, UpdateMedicineInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const medicine = await medicineService.updateMedicine(
      id,
      req.body,
      req.user,
      {
        ip: (req.headers["x-test-client-ip"] as string) || req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(
      res,
      medicine,
      "Medicine updated successfully in master catalog",
      200
    );
  } catch (error) {
    next(error);
  }
}
