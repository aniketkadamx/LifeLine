import type { Request, Response, NextFunction } from "express";
import { appointmentService } from "../services/appointment.service.js";
import { UserRole } from "../types/models.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess } from "../utils/api-response.js";
import {
  idempotencyKeyHeaderSchema,
  type CreateAppointmentInput,
} from "../validators/appointment.validator.js";

/**
 * Handler: POST /api/v1/appointments
 *
 * Reserves an appointment slot with a 15-minute concurrency lock.
 * Role: PATIENT.
 * Headers: Optional Idempotency-Key (UUIDv4).
 * Source: docs/api/API_CONTRACT.md Section 6.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 6.1.
 */
export async function createAppointmentHandler(
  req: Request<unknown, unknown, CreateAppointmentInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (req.user.role !== UserRole.PATIENT) {
      throw AppError.forbidden(
        "Access denied: only patients may book appointments",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // Optional Idempotency-Key validation
    const rawIdempotencyKey = req.headers["idempotency-key"] as
      | string
      | undefined;
    let idempotencyKey: string | undefined = undefined;

    if (rawIdempotencyKey) {
      const parsed = idempotencyKeyHeaderSchema.safeParse(rawIdempotencyKey);
      if (!parsed.success) {
        throw new AppError(
          422,
          "VALIDATION_ERROR",
          "Idempotency-Key header must be a valid UUIDv4",
          [
            {
              field: "Idempotency-Key",
              issue: "Idempotency-Key header must be a valid UUIDv4",
            },
          ]
        );
      }
      idempotencyKey = parsed.data;
    }

    const ipAddress = (req.headers["x-test-client-ip"] as string) || req.ip;
    const userAgent = req.headers["user-agent"];

    const result = await appointmentService.createReservation(
      req.user.id,
      req.body,
      idempotencyKey,
      { ipAddress, userAgent }
    );

    sendSuccess(
      res,
      result,
      "Slot reserved for 15 minutes. Please complete payment.",
      201
    );
  } catch (error) {
    next(error);
  }
}
