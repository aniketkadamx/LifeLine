import { Router } from "express";
import {
  createAppointmentHandler,
  listAppointmentsHandler,
  cancelAppointmentHandler,
  rejectAppointmentHandler,
  rescheduleAppointmentHandler,
} from "../controllers/appointment.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { authorizeOwnership } from "../middlewares/ownership.middleware.js";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../validators/auth.validator.js";
import {
  createAppointmentSchema,
  listAppointmentsQuerySchema,
  appointmentIdParamSchema,
  cancelAppointmentSchema,
  rejectAppointmentSchema,
  rescheduleAppointmentSchema,
} from "../validators/appointment.validator.js";
import { Appointment } from "../models/appointment.model.js";
import { DoctorProfile } from "../models/doctor-profile.model.js";
import { UserRole, type IAppointment } from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import { AppError } from "../utils/api-error.js";

export const appointmentRouter = Router();

/**
 * Predicate to evaluate appointment ownership:
 * - Admin can access all appointments.
 * - Patient can access only appointments belonging to them.
 * - Doctor can access only appointments assigned to them (by user ID or DoctorProfile ID).
 */
const appointmentOwnershipPredicate = (
  resource: IAppointment,
  user: AuthenticatedUser
): boolean => {
  if (user.role === UserRole.ADMIN) {
    return true;
  }
  if (user.role === UserRole.PATIENT) {
    return resource.patientId.toString() === user.id;
  }
  if (user.role === UserRole.DOCTOR) {
    const docId = resource.doctorId.toString();
    if (docId === user.id) {
      return true;
    }
    const profileId = (resource as any)._doctorProfileId;
    if (profileId && docId === profileId) {
      return true;
    }
    return false;
  }
  return false;
};

/**
 * Resource finder for appointment by route param :id.
 * If caller is DOCTOR, attaches verified doctorProfileId to prevent identifier mismatch.
 */
const appointmentResourceFinder = async (req: any): Promise<IAppointment> => {
  const appt = await Appointment.findById(req.params.id);
  if (!appt) {
    throw new AppError(404, "APPOINTMENT_NOT_FOUND", "Appointment not found");
  }
  if (req.user && req.user.role === UserRole.DOCTOR) {
    const profile = await DoctorProfile.findOne({ userId: req.user.id });
    if (profile) {
      (appt as any)._doctorProfileId = profile._id.toString();
    }
  }
  return appt;
};

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

/**
 * GET /api/v1/appointments
 * List authenticated caller's appointments with role-based scoping and pagination.
 * Roles: PATIENT, DOCTOR, ADMIN.
 * Source: docs/api/API_CONTRACT.md Section 6.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
 */
appointmentRouter.get(
  "/",
  authenticate,
  authorizeRole(UserRole.PATIENT, UserRole.DOCTOR, UserRole.ADMIN),
  validateQuery(listAppointmentsQuerySchema),
  listAppointmentsHandler
);

/**
 * PATCH /api/v1/appointments/:id/cancel
 * Cancel a scheduled appointment under the 2-hour policy rule.
 * Roles: PATIENT (owner), DOCTOR (assigned), ADMIN.
 * Source: docs/api/API_CONTRACT.md Section 6.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
 */
appointmentRouter.patch(
  "/:id/cancel",
  authenticate,
  authorizeRole(UserRole.PATIENT, UserRole.DOCTOR, UserRole.ADMIN),
  validateParams(appointmentIdParamSchema),
  validateBody(cancelAppointmentSchema),
  authorizeOwnership(appointmentResourceFinder, appointmentOwnershipPredicate),
  cancelAppointmentHandler
);

/**
 * PATCH /api/v1/appointments/:id/reject
 * Reject a scheduled appointment (Doctor or Admin) and initiate automated refund.
 * Roles: DOCTOR (assigned), ADMIN.
 * Source: docs/api/STATE_MACHINES.md Section 1.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 7.3.
 */
appointmentRouter.patch(
  "/:id/reject",
  authenticate,
  authorizeRole(UserRole.DOCTOR, UserRole.ADMIN),
  validateParams(appointmentIdParamSchema),
  validateBody(rejectAppointmentSchema),
  authorizeOwnership(appointmentResourceFinder, appointmentOwnershipPredicate),
  rejectAppointmentHandler
);

/**
 * PATCH /api/v1/appointments/:id/reschedule
 * Reschedule an appointment to a new slot with atomic slot shifting.
 * Roles: PATIENT (owner), DOCTOR (assigned), ADMIN.
 * Source: docs/api/API_CONTRACT.md & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.2.
 */
appointmentRouter.patch(
  "/:id/reschedule",
  authenticate,
  authorizeRole(UserRole.PATIENT, UserRole.DOCTOR, UserRole.ADMIN),
  validateParams(appointmentIdParamSchema),
  validateBody(rescheduleAppointmentSchema),
  authorizeOwnership(appointmentResourceFinder, appointmentOwnershipPredicate),
  rescheduleAppointmentHandler
);
