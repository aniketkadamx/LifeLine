import type { Request, Response, NextFunction } from "express";
import { consultationService } from "../services/consultation.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { SubmitClinicalNotesInput } from "../validators/consultation.validator.js";

/**
 * Handler: POST /api/v1/consultations/:appointmentId/session
 *
 * Attending doctor initiates or re-enters the virtual consultation room.
 * Role: DOCTOR.
 * Source: docs/api/API_CONTRACT.md Group 7.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 8.1.
 */
export async function initiateSessionHandler(
  req: Request<{ appointmentId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { appointmentId } = req.params;
    const result = await consultationService.initiateSession(req.user, appointmentId);

    sendSuccess(res, result, "Consultation room initialized successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/consultations/:id
 *
 * Retrieves consultation record with participant authorization.
 * Role: DOCTOR, PATIENT, or ADMIN.
 */
export async function getConsultationHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const result = await consultationService.getConsultation(req.user, id);

    sendSuccess(res, result, "Consultation details retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/consultations/:id/token
 *
 * Verified participant retrieves temporary video room authorization token.
 * Role: DOCTOR, PATIENT, or ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 7.2.
 */
export async function getParticipantTokenHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const result = await consultationService.getParticipantToken(req.user, id);

    sendSuccess(res, result, "Participant token retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/consultations/:id/end
 *
 * Concludes live call interaction and transitions status to ENDED.
 * Role: DOCTOR, PATIENT, or ADMIN.
 * Source: docs/api/STATE_MACHINES.md Section 2.2.
 */
export async function endSessionHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const result = await consultationService.endSession(req.user, id);

    sendSuccess(res, result, "Consultation session ended successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: POST /api/v1/consultations/:id/notes
 *
 * Attending doctor submits clinical diagnosis and notes, concluding consultation.
 * Role: DOCTOR.
 * Source: docs/api/API_CONTRACT.md Group 7.3 & STATE_MACHINES.md Section 2.2.
 */
export async function submitClinicalNotesHandler(
  req: Request<{ id: string }, unknown, SubmitClinicalNotesInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const result = await consultationService.submitClinicalNotes(
      req.user,
      id,
      req.body
    );

    sendSuccess(
      res,
      result,
      "Clinical notes submitted and consultation completed successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}
