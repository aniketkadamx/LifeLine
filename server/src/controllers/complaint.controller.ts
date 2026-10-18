import type { Request, Response, NextFunction } from "express";
import { complaintService } from "../services/complaint.service.js";
import { AppError } from "../utils/api-error.js";
import { sendSuccess, sendPaginated } from "../utils/api-response.js";
import type {
  CreateComplaintInput,
  ResolveComplaintInput,
  ListComplaintsQuery,
} from "../validators/complaint.validator.js";

/**
 * Controller handler: POST /api/v1/complaints
 *
 * Submits a new platform complaint or dispute.
 * Accessible to any authenticated user.
 * Source: docs/api/API_CONTRACT.md Group 17.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.2.
 */
export async function createComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const complaint = await complaintService.createComplaint(
      req.user,
      req.body as CreateComplaintInput,
      {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(res, complaint, "Complaint submitted successfully", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: GET /api/v1/complaints/:id
 *
 * Retrieves details for a specific complaint.
 * Non-admin callers may only retrieve their own complaints.
 */
export async function getComplaintByIdHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params as { id: string };
    const complaint = await complaintService.getComplaintById(req.user, id);

    sendSuccess(res, complaint, "Complaint retrieved successfully", 200);
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: GET /api/v1/complaints
 *
 * Lists complaints with bounded pagination.
 * Scoped automatically to complainant for non-admins, platform-wide for administrators.
 */
export async function listComplaintsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const query = req.query as unknown as ListComplaintsQuery;
    const result = await complaintService.listComplaints(req.user, query);

    sendPaginated(
      res,
      result.complaints,
      {
        page: result.page,
        limit: result.limit,
        total: result.total,
      },
      "Complaints retrieved successfully",
      200
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Controller handler: PATCH /api/v1/complaints/:id/resolve
 *
 * Resolves or rejects a platform complaint with administrative resolution notes.
 * Restricted strictly to users with role ADMIN.
 * Source: docs/api/API_CONTRACT.md Group 17.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.2.
 */
export async function resolveComplaintHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user || !req.user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const { id } = req.params as { id: string };
    const input = req.body as ResolveComplaintInput;

    const updated = await complaintService.resolveComplaint(
      req.user,
      id,
      input,
      {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      }
    );

    sendSuccess(
      res,
      updated,
      `Complaint ${input.status.toLowerCase()} successfully`,
      200
    );
  } catch (error) {
    next(error);
  }
}
