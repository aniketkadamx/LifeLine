import { Router } from "express";
import { createAppointmentHandler } from "../controllers/appointment.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { createAppointmentSchema } from "../validators/appointment.validator.js";
import { UserRole } from "../types/models.js";

export const appointmentRouter = Router();

/**
 * POST /api/v1/appointments
 * Slot reservation and 15-minute concurrency lock.
 * Role: PATIENT.
 * Source: docs/api/API_CONTRACT.md Section 6.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.1.
 */
appointmentRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(createAppointmentSchema),
  createAppointmentHandler
);
