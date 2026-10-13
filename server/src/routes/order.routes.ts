import { Router } from "express";
import {
  createOrderHandler,
  getOrderByIdHandler,
  reviewOrderPrescriptionHandler,
  updateOrderStatusHandler,
} from "../controllers/order.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody, validateParams } from "../validators/auth.validator.js";
import {
  createOrderSchema,
  orderIdParamSchema,
  prescriptionReviewSchema,
  updateOrderStatusSchema,
} from "../validators/order.validator.js";
import { UserRole } from "../types/models.js";

export const orderRouter = Router();

/**
 * POST /api/v1/orders
 * Places a medicine order with price snapshots and atomic stock reservation.
 * Access: Authenticated patients only.
 * Source: docs/api/API_CONTRACT.md Group 12.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.3.
 */
orderRouter.post(
  "/",
  authenticate,
  authorizeRole(UserRole.PATIENT),
  validateBody(createOrderSchema),
  createOrderHandler
);

/**
 * PATCH /api/v1/orders/:id/prescription-review
 * Pharmacist approves or rejects attached prescription.
 * Access: Authenticated PHARMACY (assigned only).
 * Source: docs/api/API_CONTRACT.md Group 12.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.4.
 */
orderRouter.patch(
  "/:id/prescription-review",
  authenticate,
  authorizeRole(UserRole.PHARMACY),
  validateParams(orderIdParamSchema),
  validateBody(prescriptionReviewSchema),
  reviewOrderPrescriptionHandler
);

/**
 * PATCH /api/v1/orders/:id/status
 * Advances order status along fulfillment state machine pipeline.
 * Access: Authenticated PHARMACY (assigned only) or ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 12.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.4.
 */
orderRouter.patch(
  "/:id/status",
  authenticate,
  authorizeRole(UserRole.PHARMACY, UserRole.ADMIN),
  validateParams(orderIdParamSchema),
  validateBody(updateOrderStatusSchema),
  updateOrderStatusHandler
);

/**
 * GET /api/v1/orders/:id
 * Retrieves order details for owning patient, assigned pharmacy, or admin.
 */
orderRouter.get(
  "/:id",
  authenticate,
  validateParams(orderIdParamSchema),
  getOrderByIdHandler
);
