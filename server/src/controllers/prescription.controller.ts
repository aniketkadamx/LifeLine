import type { Request, Response, NextFunction } from "express";
import { prescriptionService } from "../services/prescription.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { IssuePrescriptionInput } from "../validators/prescription.validator.js";

/**
 * Handler: POST /api/v1/prescriptions
 *
 * Attending verified doctor issues an immutable digital prescription
 * for an active or concluded consultation encounter.
 * Role: DOCTOR (VERIFIED).
 * Source: docs/api/API_CONTRACT.md Group 9.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 9.3.
 */
export async function issuePrescriptionHandler(
  req: Request<unknown, unknown, IssuePrescriptionInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const prescription = await prescriptionService.issuePrescription(
      req.user,
      req.body
    );

    sendSuccess(
      res,
      prescription,
      "Digital prescription issued successfully with 90-day validity",
      201
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/prescriptions/:id
 *
 * Authorized participant (Patient owner, Issuing doctor, Assigned pharmacy, or Admin)
 * retrieves the digital prescription document.
 * Role: PATIENT (owner), DOCTOR (issuing), PHARMACY, ADMIN.
 * Source: docs/api/AUTHORIZATION_MATRIX.md Table line 62.
 */
export async function getPrescriptionByIdHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const prescription = await prescriptionService.getPrescriptionById(
      req.user,
      id
    );

    sendSuccess(res, prescription, "Prescription retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/prescriptions/:id & PUT /api/v1/prescriptions/:id
 *
 * Explicitly rejects any mutation attempt on an issued prescription.
 * Issued digital prescriptions are immutable legal records per task specification.
 * Status: 409 Conflict.
 */
export async function modifyPrescriptionHandler(
  _req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    prescriptionService.rejectMutationOnFinalizedPrescription();
  } catch (error) {
    next(error);
  }
}
