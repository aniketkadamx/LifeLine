import { Router } from "express";
import {
  getAdminOverviewHandler,
  getDoctorMetricsHandler,
  getPharmacyMetricsHandler,
} from "../controllers/analytics.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { UserRole } from "../types/models.js";
import { validateQuery } from "../validators/auth.validator.js";
import { analyticsDateFilterSchema } from "../validators/analytics.validator.js";

export const analyticsRouter = Router();

/**
 * GET /api/v1/analytics/overview
 * GET /api/v1/analytics/admin/overview (API Contract 19.1 alias)
 *
 * Platform administration overview metrics:
 * - Total users and active users
 * - Gross transaction volume, total refunds, net volume
 * - Appointment completion rate and breakdown
 *
 * Auth: Role ADMIN only.
 */
analyticsRouter.get(
  "/overview",
  authenticate,
  authorizeRole(UserRole.ADMIN),
  validateQuery(analyticsDateFilterSchema),
  getAdminOverviewHandler
);

analyticsRouter.get(
  "/admin/overview",
  authenticate,
  authorizeRole(UserRole.ADMIN),
  validateQuery(analyticsDateFilterSchema),
  getAdminOverviewHandler
);

/**
 * GET /api/v1/analytics/doctor
 * GET /api/v1/analytics/doctor/earnings (API Contract 19.2 alias)
 *
 * Doctor consultation and earnings metrics:
 * - Completed consultation count
 * - Earnings summary from completed, paid appointments
 *
 * Auth: Role DOCTOR only (strictly scoped to own authenticated identity).
 */
analyticsRouter.get(
  "/doctor",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateQuery(analyticsDateFilterSchema),
  getDoctorMetricsHandler
);

analyticsRouter.get(
  "/doctor/earnings",
  authenticate,
  authorizeRole(UserRole.DOCTOR),
  validateQuery(analyticsDateFilterSchema),
  getDoctorMetricsHandler
);

/**
 * GET /api/v1/analytics/pharmacy
 *
 * Pharmacy operational and sales metrics:
 * - Order fulfillment volume and fulfillment rate
 * - Revenue summary from delivered, paid orders
 *
 * Auth: Role PHARMACY only (strictly scoped to own authenticated pharmacy).
 */
analyticsRouter.get(
  "/pharmacy",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateQuery(analyticsDateFilterSchema),
  getPharmacyMetricsHandler
);
