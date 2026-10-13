import { Router } from "express";
import {
  createOrderHandler,
  getOrderByIdHandler,
} from "../controllers/order.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { validateBody } from "../validators/auth.validator.js";
import { createOrderSchema } from "../validators/order.validator.js";
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
 * GET /api/v1/orders/:id
 * Retrieves order details for owning patient, assigned pharmacy, or admin.
 */
orderRouter.get("/:id", authenticate, getOrderByIdHandler);
