import type { Request, Response, NextFunction } from "express";
import { orderService } from "../services/order.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import type {
  CreateOrderInput,
  PrescriptionReviewInput,
  UpdateOrderStatusInput,
} from "../validators/order.validator.js";

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

/**
 * Handler: PATCH /api/v1/orders/:id/prescription-review
 *
 * Pharmacist reviews attached prescription (APPROVE or REJECT).
 * Access: Restricted strictly to assigned verified pharmacy.
 * Source: docs/api/API_CONTRACT.md Group 12.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.4.
 */
export async function reviewOrderPrescriptionHandler(
  req: Request<{ id: string }, unknown, PrescriptionReviewInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const order = await orderService.reviewOrderPrescription(
      req.user,
      id,
      req.body,
      {
        ip: (req.headers["x-test-client-ip"] as string) || req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(
      res,
      order,
      req.body.decision === "APPROVE"
        ? "Prescription approved successfully"
        : "Prescription rejected and order cancelled",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Handler: PATCH /api/v1/orders/:id/status
 *
 * Advances order status along fulfillment state machine pipeline.
 * Access: Assigned verified pharmacy or admin.
 * Source: docs/api/API_CONTRACT.md Group 12.3 & MASTER_IMPLEMENTATION_ROADMAP.md Task 10.4.
 */
export async function updateOrderStatusHandler(
  req: Request<{ id: string }, unknown, UpdateOrderStatusInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params;
    const order = await orderService.updateOrderStatus(
      req.user,
      id,
      req.body,
      {
        ip: (req.headers["x-test-client-ip"] as string) || req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(res, order, `Order status updated to ${req.body.status}`, 200);
  } catch (error) {
    next(error);
  }
}
