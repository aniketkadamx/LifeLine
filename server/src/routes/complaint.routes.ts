import { Router } from "express";
import {
  createComplaintHandler,
  getComplaintByIdHandler,
  listComplaintsHandler,
  resolveComplaintHandler,
} from "../controllers/complaint.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authorizeRole } from "../middlewares/role.middleware.js";
import { UserRole } from "../types/models.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../validators/auth.validator.js";
import {
  createComplaintSchema,
  resolveComplaintSchema,
  complaintIdParamSchema,
  listComplaintsQuerySchema,
} from "../validators/complaint.validator.js";

export const complaintRouter = Router();

/**
 * POST /api/v1/complaints
 * Submits a new dispute or complaint.
 * Auth: Any authenticated user.
 * Source: docs/api/API_CONTRACT.md Group 17.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.2.
 */
complaintRouter.post(
  "/",
  authenticate,
  validateBody(createComplaintSchema),
  createComplaintHandler
);

/**
 * GET /api/v1/complaints
 * Lists complaints with bounded pagination.
 * Auth: Authenticated (scoped to user for non-admins, platform-wide for ADMIN).
 */
complaintRouter.get(
  "/",
  authenticate,
  validateQuery(listComplaintsQuerySchema as any),
  listComplaintsHandler
);

/**
 * GET /api/v1/complaints/:id
 * Retrieves details for a specific complaint.
 * Auth: Authenticated (Owner or ADMIN).
 */
complaintRouter.get(
  "/:id",
  authenticate,
  validateParams(complaintIdParamSchema),
  getComplaintByIdHandler
);

/**
 * PATCH /api/v1/complaints/:id/resolve
 * Resolves or rejects a complaint with administrative notes.
 * Auth: Role ADMIN only.
 * Source: docs/api/API_CONTRACT.md Group 17.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 12.2.
 */
complaintRouter.patch(
  "/:id/resolve",
  authenticate,
  authorizeRole(UserRole.ADMIN),
  validateParams(complaintIdParamSchema),
  validateBody(resolveComplaintSchema),
  resolveComplaintHandler
);
