import mongoose from "mongoose";
import { Complaint } from "../models/complaint.model.js";
import {
  ComplaintCategory,
  ComplaintStatus,
  ComplaintPriority,
  UserRole,
  AuditAction,
  type IComplaint,
} from "../types/models.js";
import type { AuthenticatedUser } from "../types/express.js";
import type {
  CreateComplaintInput,
  ResolveComplaintInput,
  ListComplaintsQuery,
} from "../validators/complaint.validator.js";
import { AppError } from "../utils/api-error.js";
import { auditLogService } from "./audit-log.service.js";

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

export interface ListComplaintsResult {
  complaints: any[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class ComplaintService {
  /**
   * Files a platform dispute or service complaint on behalf of the authenticated user.
   *
   * Business & Security Rules:
   * 1. Complainant identity derived strictly from authenticated user context.
   * 2. Initial lifecycle state strictly set to OPEN on the server.
   * 3. Prohibits client-supplied resolution details or arbitrary status values.
   */
  public async createComplaint(
    user: AuthenticatedUser,
    input: CreateComplaintInput,
    meta?: RequestMetadata
  ): Promise<IComplaint> {
    if (!user || !user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const complainantObjectId = new mongoose.Types.ObjectId(user.id);
    const subject =
      input.subject?.trim() ||
      input.title?.trim() ||
      `${input.category.replace(/_/g, " ")} Dispute`;

    const relatedEntityId = input.relatedEntityId?.trim() || input.relatedId?.trim() || undefined;

    const complaint = await Complaint.create({
      complainantId: complainantObjectId,
      category: input.category,
      subject,
      description: input.description.trim(),
      relatedEntityId,
      relatedEntityType: input.relatedEntityType?.trim() || undefined,
      status: ComplaintStatus.OPEN,
      priority: ComplaintPriority.MEDIUM,
    });

    // Record audit trail entry for complaint creation (fail-safe)
    try {
      await auditLogService.log({
        actorId: user.id,
        actorRole: user.role,
        action: AuditAction.COMPLAINT_CREATED,
        resourceType: "COMPLAINT",
        resourceId: complaint._id.toString(),
        patientId: user.role === UserRole.PATIENT ? user.id : undefined,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        metadata: {
          category: complaint.category,
          subject: complaint.subject,
        },
      });
    } catch {}

    return complaint;
  }

  /**
   * Retrieves a single complaint by ID.
   * Enforces privacy: non-admin users may view only complaints they filed.
   */
  public async getComplaintById(
    user: AuthenticatedUser,
    complaintId: string
  ): Promise<IComplaint> {
    if (!user || !user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    if (!mongoose.Types.ObjectId.isValid(complaintId)) {
      throw AppError.badRequest("Invalid complaint identifier format", "BAD_REQUEST");
    }

    const complaint = await Complaint.findById(complaintId)
      .populate("complainantId", "fullName email role avatar")
      .populate("resolution.resolvedBy", "fullName role");

    if (!complaint) {
      throw new AppError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    }

    // Authorization: Owner or Admin
    const complainant = complaint.complainantId as any;
    const complainantIdStr = complainant?._id
      ? complainant._id.toString()
      : String(complainant || "");

    if (user.role !== UserRole.ADMIN && complainantIdStr !== user.id) {
      throw AppError.forbidden(
        "Access denied: you do not have permission to view this complaint",
        "AUTH_RESOURCE_ACCESS_DENIED"
      );
    }

    return complaint;
  }

  /**
   * Lists complaints with bounded pagination and deterministic ordering.
   * Scoping:
   * - Admin: Lists platform-wide complaints with optional status/category filtering.
   * - Non-admin: Strictly scoped to the authenticated user's complaints.
   */
  public async listComplaints(
    user: AuthenticatedUser,
    query: ListComplaintsQuery
  ): Promise<ListComplaintsResult> {
    if (!user || !user.id) {
      throw AppError.unauthorized("Authentication required", "AUTH_TOKEN_MISSING");
    }

    const page = Math.max(1, query.page ? Math.floor(query.page) : 1);
    const limit = Math.min(100, Math.max(1, query.limit ? Math.floor(query.limit) : 20));

    const filter: Record<string, unknown> = {};

    // Privacy & Authorization boundary: non-admins only see their own complaints
    if (user.role !== UserRole.ADMIN) {
      filter.complainantId = new mongoose.Types.ObjectId(user.id);
    }

    if (query.status) {
      filter.status = query.status;
    }

    if (query.category) {
      filter.category = query.category;
    }

    if (query.priority) {
      filter.priority = query.priority;
    }

    const total = await Complaint.countDocuments(filter);
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    const complaints = await Complaint.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("complainantId", "fullName email role avatar")
      .populate("resolution.resolvedBy", "fullName role");

    return {
      complaints,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Resolves or rejects an open complaint with mandatory administrative notes.
   *
   * Business & Security Rules:
   * 1. Requires Role ADMIN. Rejects non-admin callers with HTTP 403.
   * 2. Atomic status transition: prevents race conditions or double resolutions.
   * 3. Prevents overwriting already resolved or rejected complaints (HTTP 409).
   * 4. Persists resolution notes, resolver ID, and timestamp server-side.
   * 5. Emits safe, fail-safe audit log entry.
   */
  public async resolveComplaint(
    user: AuthenticatedUser,
    complaintId: string,
    input: ResolveComplaintInput,
    meta?: RequestMetadata
  ): Promise<IComplaint> {
    // 1. RBAC Check
    if (user.role !== UserRole.ADMIN) {
      throw AppError.forbidden(
        "Access denied: only administrators may resolve or reject complaints",
        "AUTH_INSUFFICIENT_PERMISSIONS"
      );
    }

    // 2. ID validation
    if (!mongoose.Types.ObjectId.isValid(complaintId)) {
      throw AppError.badRequest("Invalid complaint identifier format", "BAD_REQUEST");
    }

    // 3. Verify existence and current lifecycle state
    const existing = await Complaint.findById(complaintId);
    if (!existing) {
      throw new AppError(404, "COMPLAINT_NOT_FOUND", "Complaint not found");
    }

    if (
      existing.status === ComplaintStatus.RESOLVED ||
      existing.status === ComplaintStatus.REJECTED
    ) {
      throw new AppError(
        409,
        "COMPLAINT_ALREADY_RESOLVED",
        `Complaint has already been finalized with status '${existing.status}'`
      );
    }

    // 4. Atomic conditional update to guard against concurrent resolution requests
    const adminObjectId = new mongoose.Types.ObjectId(user.id);
    const resolvedAt = new Date();
    const resolutionNotes = input.resolutionNotes.trim();

    const updated = await Complaint.findOneAndUpdate(
      {
        _id: existing._id,
        status: { $in: [ComplaintStatus.OPEN, ComplaintStatus.UNDER_REVIEW] },
      },
      {
        $set: {
          status: input.status,
          assignedTo: adminObjectId,
          resolution: {
            resolvedBy: adminObjectId,
            resolvedAt,
            resolutionNotes,
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      // Race condition caught: another concurrent request finalized this complaint
      throw new AppError(
        409,
        "COMPLAINT_ALREADY_RESOLVED",
        "Complaint was already resolved by another administrator"
      );
    }

    // 5. Fail-safe audit logging
    const action =
      input.status === ComplaintStatus.RESOLVED
        ? AuditAction.COMPLAINT_RESOLVED
        : AuditAction.COMPLAINT_REJECTED;

    try {
      await auditLogService.log({
        actorId: user.id,
        actorRole: user.role,
        action,
        resourceType: "COMPLAINT",
        resourceId: updated._id.toString(),
        patientId: updated.complainantId,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        metadata: {
          previousStatus: existing.status,
          newStatus: input.status,
          category: updated.category,
          resolutionNotesPreview: resolutionNotes.slice(0, 100),
        },
      });
    } catch {}

    return updated;
  }
}

export const complaintService = new ComplaintService();
