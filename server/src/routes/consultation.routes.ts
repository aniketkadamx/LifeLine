import { Router } from "express";
import {
  initiateSessionHandler,
  getConsultationHandler,
  getParticipantTokenHandler,
  endSessionHandler,
  submitClinicalNotesHandler,
} from "../controllers/consultation.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody, validateParams } from "../validators/auth.validator.js";
import {
  appointmentIdParamSchema,
  consultationIdParamSchema,
  submitClinicalNotesSchema,
} from "../validators/consultation.validator.js";
import { UserRole } from "../types/models.js";

export const consultationRouter = Router();

/**
 * POST /api/v1/consultations/:appointmentId/session
 * Doctor starts or enters the virtual consultation room.
 * Role: DOCTOR.
 * Source: docs/api/API_CONTRACT.md Group 7.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 8.1.
 */
consultationRouter.post(
  "/:appointmentId/session",
  authenticate,
  authorizeRole(UserRole.DOCTOR, UserRole.ADMIN),
  validateParams(appointmentIdParamSchema),
  initiateSessionHandler
);

/**
 * POST /api/v1/consultations/appointments/:appointmentId/session
 * Explicit subpath alias for initiating room session by appointment ID.
 */
consultationRouter.post(
  "/appointments/:appointmentId/session",
  authenticate,
  authorizeRole(UserRole.DOCTOR, UserRole.ADMIN),
  validateParams(appointmentIdParamSchema),
  initiateSessionHandler
);

/**
 * GET /api/v1/consultations/:id
 * Retrieves consultation details with participant authorization.
 * Role: DOCTOR, PATIENT, ADMIN.
 */
consultationRouter.get(
  "/:id",
  authenticate,
  validateParams(consultationIdParamSchema),
  getConsultationHandler
);

/**
 * GET /api/v1/consultations/:id/token
 * Participant retrieves temporary token to enter active video room.
 * Role: PATIENT or DOCTOR (Verified participants).
 * Source: docs/api/API_CONTRACT.md Group 7.2.
 */
consultationRouter.get(
  "/:id/token",
  authenticate,
  validateParams(consultationIdParamSchema),
  getParticipantTokenHandler
);

/**
 * POST /api/v1/consultations/:id/end
 * Concludes live call interaction and transitions status to ENDED.
 * Role: DOCTOR, PATIENT, ADMIN.
 * Source: docs/api/STATE_MACHINES.md Section 2.2.
 */
consultationRouter.post(
  "/:id/end",
  authenticate,
  validateParams(consultationIdParamSchema),
  endSessionHandler
);

consultationRouter.patch(
  "/:id/end",
  authenticate,
  validateParams(consultationIdParamSchema),
  endSessionHandler
);

/**
 * POST /api/v1/consultations/:id/notes
 * Doctor finalizes clinical consultation notes and diagnosis.
 * Role: DOCTOR.
 * Source: docs/api/API_CONTRACT.md Group 7.3 & STATE_MACHINES.md Section 2.2.
 */
consultationRouter.post(
  "/:id/notes",
  authenticate,
  authorizeRole(UserRole.DOCTOR, UserRole.ADMIN),
  validateParams(consultationIdParamSchema),
  validateBody(submitClinicalNotesSchema),
  submitClinicalNotesHandler
);
