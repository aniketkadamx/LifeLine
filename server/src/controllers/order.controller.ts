import type { Request, Response, NextFunction } from "express";
import { orderService } from "../services/order.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type { CreateOrderInput } from "../validators/order.validator.js";

/**
 * Handler: POST /api/v1/orders
 *
 * Places a medicine order with authoritative price snapshots, atomic stock reservation,
 * and clinical prescription validation.
 * Access: Restricted strictly to authenticated patients.
 * Source: docs/api/API_CONTRACT.md Group 12.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.3.
 */
export async function createOrderHandler(
  req: Request<unknown, unknown, CreateOrderInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const order = await orderService.createOrder(req.user, req.body, {
      ip: (req.headers["x-test-client-ip"] as string) || req.ip,
      userAgent: req.headers["user-agent"],
    });

    sendSuccess(res, order, "Medicine order placed successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: GET /api/v1/orders/:id
 *
 * Retrieves order details for the owning patient, assigned pharmacy, or platform admin.
 */
export async function getOrderByIdHandler(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const order = await orderService.getOrderById(req.user, id);

    sendSuccess(res, order, "Order retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}
