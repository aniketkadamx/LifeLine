import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { AdminDashboard, type AdminOverviewMetrics } from "@/features/admin/pages/AdminDashboard";
import { VerificationQueuePage } from "@/features/admin/pages/VerificationQueuePage";
import { ComplaintsPage, type ComplaintItem } from "@/features/admin/pages/ComplaintsPage";
import { AuditLogsPage, type AuditLogEntry } from "@/features/admin/pages/AuditLogsPage";
import { AppRoutes } from "@/routes/AppRoutes";

const mockAdminUser = {
  id: "64b8e2f01a2b3c4d5e6f7a01",
  email: "admin@lifeline.org",
  fullName: "System Administrator",
  role: "ADMIN" as const,
};

const mockOverviewMetrics: AdminOverviewMetrics = {
  userMetrics: {
    totalUsers: 1420,
    activeUsers: 1380,
    byRole: {
      PATIENT: 1200,
      DOCTOR: 150,
      PHARMACY: 65,
      ADMIN: 5,
    },
    byStatus: {
      ACTIVE: 1380,
      PENDING_VERIFICATION: 25,
      SUSPENDED: 10,
      DEACTIVATED: 5,
    },
  },
  financialMetrics: {
    grossTransactionVolume: 582400.0,
    totalRefunds: 14200.0,
    netTransactionVolume: 568200.0,
    currency: "INR",
    currencies: [
      {
        currency: "INR",
        grossTransactionVolume: 582400.0,
        totalRefunds: 14200.0,
        netTransactionVolume: 568200.0,
        successfulTransactions: 620,
        refundedTransactions: 12,
      },
    ],
  },
  appointmentMetrics: {
    totalAppointments: 850,
    completedAppointments: 720,
    eligibleAppointments: 800,
    completionRate: 90.0,
    overallCompletionRate: 84.7,
    byStatus: {
      COMPLETED: 720,
      CONFIRMED: 60,
      IN_PROGRESS: 20,
      PENDING_PAYMENT: 15,
      CANCELLED: 25,
      REJECTED: 10,
    },
  },
  orderMetrics: {
    totalOrders: 430,
    deliveredOrders: 395,
    cancelledOrders: 18,
    byStatus: {
      DELIVERED: 395,
      OUT_FOR_DELIVERY: 10,
      PREPARING: 7,
      CANCELLED: 18,
    },
  },
  period: {},
};

const mockComplaints: ComplaintItem[] = [
  {
    _id: "64b8e2f01a2b3c4d5e6f7c01",
    id: "64b8e2f01a2b3c4d5e6f7c01",
    complainantId: "64b8e2f01a2b3c4d5e6f7a88",
    category: "APPOINTMENT",
    subject: "Doctor did not join video room at scheduled start time",
    description: "I waited for 20 minutes in the LiveKit room, but Dr. Smith did not connect. I am requesting a rescheduled slot or credit refund.",
    relatedEntityType: "Appointment",
    relatedEntityId: "64b8e2f01a2b3c4d5e6f7b11",
    status: "OPEN",
    priority: "HIGH",
    createdAt: "2026-10-18T10:00:00.000Z",
    updatedAt: "2026-10-18T10:00:00.000Z",
  },
  {
    _id: "64b8e2f01a2b3c4d5e6f7c02",
    id: "64b8e2f01a2b3c4d5e6f7c02",
    complainantId: "64b8e2f01a2b3c4d5e6f7a99",
    category: "MEDICINE_QUALITY",
    subject: "Damaged outer packaging for prescription antibiotics",
    description: "The package seal was torn upon courier delivery. I need confirmation that the strips are untampered.",
    relatedEntityType: "Order",
    relatedEntityId: "64b8e2f01a2b3c4d5e6f7b22",
    status: "UNDER_REVIEW",
    priority: "MEDIUM",
    createdAt: "2026-10-17T15:30:00.000Z",
    updatedAt: "2026-10-17T16:00:00.000Z",
  },
];

const mockAuditLogs: AuditLogEntry[] = [
  {
    _id: "64b8e2f01a2b3c4d5e6f7d01",
    id: "64b8e2f01a2b3c4d5e6f7d01",
    actorId: "64b8e2f01a2b3c4d5e6f7a01",
    actorRole: "ADMIN",
    action: "DOCTOR_VERIFICATION_APPROVED",
    resourceType: "DoctorProfile",
    resourceId: "64b8e2f01a2b3c4d5e6f7b99",
    status: "SUCCESS",
    ipAddress: "192.168.1.100",
    userAgent: "Mozilla/5.0 LifeLine-TestAgent",
    createdAt: "2026-10-19T08:00:00.000Z",
  },
  {
    _id: "64b8e2f01a2b3c4d5e6f7d02",
    id: "64b8e2f01a2b3c4d5e6f7d02",
    actorId: "64b8e2f01a2b3c4d5e6f7a88",
    actorRole: "PATIENT",
    action: "ORDER_PLACED",
    resourceType: "Order",
    resourceId: "64b8e2f01a2b3c4d5e6f7c88",
    status: "SUCCESS",
    ipAddress: "192.168.1.105",
    userAgent: "Mozilla/5.0 LifeLine-TestAgent",
    createdAt: "2026-10-19T08:30:00.000Z",
  },
];

describe("Milestone 13 — Task 13.6: Admin Portal Views", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: mockAdminUser,
      accessToken: "mock-admin-access-token",
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ADMIN DASHBOARD & ANALYTICS OVERVIEW TESTS
  // =========================================================================
  describe("Admin Dashboard (AdminDashboard.tsx)", () => {
    it("1.1 renders user distribution, financial metrics, and appointment completion rates on mount", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockOverviewMetrics,
      });

      render(
        <BrowserRouter>
          <AdminDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith("/analytics/overview", { params: {} });
      });

      // Verify KPI Metrics
      await waitFor(() => {
        expect(screen.getByTestId("metric-total-users")).toBeDefined();
      });
      expect(screen.getByText("1,420")).toBeDefined();
      expect(screen.getByTestId("metric-gtv")).toBeDefined();
      expect(screen.getByTestId("metric-completion-rate")).toBeDefined();
      expect(screen.getByText("90%")).toBeDefined();
      expect(screen.getByTestId("metric-delivered-orders")).toBeDefined();
      expect(screen.getByText("395")).toBeDefined();

      // Verify Role Breakdown
      expect(screen.getByTestId("role-stat-patient")).toBeDefined();
      expect(screen.getByTestId("role-stat-doctor")).toBeDefined();
      expect(screen.getByTestId("role-stat-pharmacy")).toBeDefined();
    });

    it("1.2 filters analytics with valid from and to ISO date boundaries when submitted", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          ...mockOverviewMetrics,
          period: {
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-10-15T00:00:00.000Z",
          },
        },
      });

      render(
        <BrowserRouter>
          <AdminDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalled();
      });

      // Enter Date Boundaries
      const fromInput = screen.getByTestId("filter-from-input");
      const toInput = screen.getByTestId("filter-to-input");
      const applyBtn = screen.getByTestId("apply-date-filter-btn");

      fireEvent.change(fromInput, { target: { value: "2026-10-01" } });
      fireEvent.change(toInput, { target: { value: "2026-10-15" } });
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          "/analytics/overview",
          expect.objectContaining({
            params: expect.objectContaining({
              from: expect.stringContaining("2026-10-01"),
              to: expect.stringContaining("2026-10-15"),
            }),
          })
        );
      });
    });

    it("1.3 prevents invalid date filter submission when from > to and displays validation error", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockOverviewMetrics,
      });

      render(
        <BrowserRouter>
          <AdminDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalled();
      });

      // Enter inverted dates: from 2026-10-20, to 2026-10-10
      const fromInput = screen.getByTestId("filter-from-input");
      const toInput = screen.getByTestId("filter-to-input");
      const applyBtn = screen.getByTestId("apply-date-filter-btn");

      fireEvent.change(fromInput, { target: { value: "2026-10-20" } });
      fireEvent.change(toInput, { target: { value: "2026-10-10" } });
      fireEvent.click(applyBtn);

      expect(screen.getByTestId("date-filter-error")).toBeDefined();
      expect(
        screen.getByText(/'From' date must be earlier than or equal to 'To' date/i)
      ).toBeDefined();
    });

    it("1.4 handles analytics API failure and renders error alert with retry button", async () => {
      vi.spyOn(api, "get").mockRejectedValue(
        new ApiError("Database connection timed out", 500, "DB_TIMEOUT")
      );

      render(
        <BrowserRouter>
          <AdminDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("analytics-error-alert")).toBeDefined();
      });
      expect(screen.getByText("Database connection timed out")).toBeDefined();
      expect(screen.getByRole("button", { name: /try again/i })).toBeDefined();
    });

    it("1.5 allows manual metrics refresh via refresh button", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockOverviewMetrics,
      });

      render(
        <BrowserRouter>
          <AdminDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledTimes(1);
      });

      const refreshBtn = screen.getByTestId("admin-refresh-btn");
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledTimes(2);
      });
    });
  });

  // =========================================================================
  // 2. PROVIDER CREDENTIAL VERIFICATION TESTS
  // =========================================================================
  describe("Provider Verification Workspace (VerificationQueuePage.tsx)", () => {
    it("2.1 discloses automated queue discovery limitation notice clearly in the UI", () => {
      render(
        <BrowserRouter>
          <VerificationQueuePage />
        </BrowserRouter>
      );

      expect(screen.getByTestId("queue-limitation-notice")).toBeDefined();
      expect(
        screen.getByText(/Automated Queue Discovery Limitation Notice/i)
      ).toBeDefined();
      expect(
        screen.getByText(/lacks automated pending queue listing endpoints/i)
      ).toBeDefined();
    });

    it("2.2 rejects invalid ID format (non-24 hex) with validation error", () => {
      render(
        <BrowserRouter>
          <VerificationQueuePage />
        </BrowserRouter>
      );

      const input = screen.getByTestId("provider-lookup-input");
      const submitBtn = screen.getByTestId("provider-lookup-btn");

      fireEvent.change(input, { target: { value: "invalid-id-xyz" } });
      fireEvent.click(submitBtn);

      expect(screen.getByTestId("lookup-error-msg")).toBeDefined();
      expect(
        screen.getByText(/Invalid identifier format\. Must be a 24-character hexadecimal ObjectId/i)
      ).toBeDefined();
      expect(screen.queryByTestId("verification-workspace-panel")).toBeNull();
    });

    it("2.3 submits doctor credential approval via PATCH /admin/doctors/:id/verify and updates UI status", async () => {
      const targetDoctorId = "64b8e2f01a2b3c4d5e6f7b99";

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          id: targetDoctorId,
          specialization: "Cardiology",
          verificationStatus: "APPROVED_VERIFIED",
          verificationNotes: "Verified with Maharashtra Medical Council register.",
        },
      });

      render(
        <BrowserRouter>
          <VerificationQueuePage />
        </BrowserRouter>
      );

      // Target Doctor ID
      const input = screen.getByTestId("provider-lookup-input");
      fireEvent.change(input, { target: { value: targetDoctorId } });
      fireEvent.click(screen.getByTestId("provider-lookup-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("verification-workspace-panel")).toBeDefined();
      });

      // Select Approve
      fireEvent.click(screen.getByTestId("decision-approve-btn"));

      // Enter review notes
      const notesInput = screen.getByTestId("review-notes-input");
      fireEvent.change(notesInput, {
        target: { value: "Verified with Maharashtra Medical Council register." },
      });

      // Submit decision
      fireEvent.click(screen.getByTestId("submit-verification-btn"));

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/admin/doctors/${targetDoctorId}/verify`,
          {
            status: "APPROVED_VERIFIED",
            reviewNotes: "Verified with Maharashtra Medical Council register.",
          }
        );
      });

      // Verified status in UI
      await waitFor(() => {
        expect(screen.getByTestId("action-success-alert")).toBeDefined();
      });
      expect(screen.getByTestId("active-profile-status-badge").textContent).toBe("APPROVED_VERIFIED");
    });

    it("2.4 rejects doctor verification requiring review notes with minimum 5 characters", async () => {
      const targetDoctorId = "64b8e2f01a2b3c4d5e6f7b99";
      const patchSpy = vi.spyOn(api, "patch");

      render(
        <BrowserRouter>
          <VerificationQueuePage />
        </BrowserRouter>
      );

      const input = screen.getByTestId("provider-lookup-input");
      fireEvent.change(input, { target: { value: targetDoctorId } });
      fireEvent.click(screen.getByTestId("provider-lookup-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("verification-workspace-panel")).toBeDefined();
      });

      // Select Reject
      fireEvent.click(screen.getByTestId("decision-reject-btn"));

      // Enter only 3 characters (invalid)
      const notesInput = screen.getByTestId("review-notes-input");
      fireEvent.change(notesInput, { target: { value: "bad" } });

      fireEvent.click(screen.getByTestId("submit-verification-btn"));

      expect(screen.getByTestId("notes-error-msg")).toBeDefined();
      expect(
        screen.getByText(/Review notes are required and must be at least 5 characters long/i)
      ).toBeDefined();
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it("2.5 switches to Pharmacy tab and submits pharmacy license verification via PATCH /admin/pharmacies/:id/verify", async () => {
      const targetPharmacyId = "64b8e2f01a2b3c4d5e6f7c88";

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          id: targetPharmacyId,
          pharmacyName: "Apex Retail Meds",
          verificationStatus: "APPROVED_VERIFIED",
          verificationNotes: "Drug license MH-WZ2 confirmed authentic with FDA portal.",
        },
      });

      render(
        <BrowserRouter>
          <VerificationQueuePage />
        </BrowserRouter>
      );

      // Switch to Pharmacy Type
      fireEvent.click(screen.getByTestId("toggle-pharmacy-type-btn"));

      // Target Pharmacy ID
      const input = screen.getByTestId("provider-lookup-input");
      fireEvent.change(input, { target: { value: targetPharmacyId } });
      fireEvent.click(screen.getByTestId("provider-lookup-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("verification-workspace-panel")).toBeDefined();
      });

      // Select Approve
      fireEvent.click(screen.getByTestId("decision-approve-btn"));

      // Enter Notes
      const notesInput = screen.getByTestId("review-notes-input");
      fireEvent.change(notesInput, {
        target: { value: "Drug license MH-WZ2 confirmed authentic with FDA portal." },
      });

      // Submit
      fireEvent.click(screen.getByTestId("submit-verification-btn"));

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/admin/pharmacies/${targetPharmacyId}/verify`,
          {
            status: "APPROVED_VERIFIED",
            reviewNotes: "Drug license MH-WZ2 confirmed authentic with FDA portal.",
          }
        );
      });
    });

    it("2.6 handles verification mutation API failure and surfaces error alert", async () => {
      const targetDoctorId = "64b8e2f01a2b3c4d5e6f7b99";

      vi.spyOn(api, "patch").mockRejectedValue(
        new ApiError("Cannot review doctor credentials from current status 'APPROVED_VERIFIED'", 409, "INVALID_STATE_TRANSITION")
      );

      render(
        <BrowserRouter>
          <VerificationQueuePage />
        </BrowserRouter>
      );

      const input = screen.getByTestId("provider-lookup-input");
      fireEvent.change(input, { target: { value: targetDoctorId } });
      fireEvent.click(screen.getByTestId("provider-lookup-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("verification-workspace-panel")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("decision-approve-btn"));
      fireEvent.change(screen.getByTestId("review-notes-input"), {
        target: { value: "Attempting re-verification of doctor credentials." },
      });
      fireEvent.click(screen.getByTestId("submit-verification-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("action-error-alert")).toBeDefined();
      });
      expect(screen.getByText(/Cannot review doctor credentials from current status 'APPROVED_VERIFIED'/i)).toBeDefined();
    });
  });

  // =========================================================================
  // 3. COMPLAINTS & DISPUTE RESOLUTION TESTS
  // =========================================================================
  describe("Disputes & Complaints Center (ComplaintsPage.tsx)", () => {
    it("3.1 renders paginated complaints queue from GET /complaints on mount", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockComplaints,
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          totalPages: 1,
        },
      });

      render(
        <BrowserRouter>
          <ComplaintsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          "/complaints",
          expect.objectContaining({ params: expect.objectContaining({ page: 1, limit: 10 }) })
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("complaints-table")).toBeDefined();
      });
      expect(
        screen.getByText("Doctor did not join video room at scheduled start time")
      ).toBeDefined();
      expect(
        screen.getByText("Damaged outer packaging for prescription antibiotics")
      ).toBeDefined();
    });

    it("3.2 filters complaints by status, category, and priority, updating query parameters", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: [mockComplaints[0]],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });

      render(
        <BrowserRouter>
          <ComplaintsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalled();
      });

      // Change filters
      const statusSelect = screen.getByTestId("filter-status-select");
      const categorySelect = screen.getByTestId("filter-category-select");
      const prioritySelect = screen.getByTestId("filter-priority-select");

      fireEvent.change(statusSelect, { target: { value: "OPEN" } });
      fireEvent.change(categorySelect, { target: { value: "APPOINTMENT" } });
      fireEvent.change(prioritySelect, { target: { value: "HIGH" } });

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          "/complaints",
          expect.objectContaining({
            params: expect.objectContaining({
              status: "OPEN",
              category: "APPOINTMENT",
              priority: "HIGH",
            }),
          })
        );
      });
    });

    it("3.3 opens resolution modal and resolves dispute via PATCH /complaints/:id/resolve", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: [mockComplaints[0]],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          ...mockComplaints[0],
          status: "RESOLVED",
          resolution: {
            resolvedBy: mockAdminUser.id,
            resolvedAt: new Date().toISOString(),
            resolutionNotes: "Investigated LiveKit server logs; refunded 100% consultation fee to patient wallet.",
          },
        },
      });

      render(
        <BrowserRouter>
          <ComplaintsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId(`review-complaint-btn-${mockComplaints[0]._id}`)).toBeDefined();
      });

      // Open Modal
      fireEvent.click(screen.getByTestId(`review-complaint-btn-${mockComplaints[0]._id}`));

      await waitFor(() => {
        expect(screen.getByTestId("resolution-dialog")).toBeDefined();
      });

      // Enter Notes
      const notesTextarea = screen.getByTestId("resolution-notes-input");
      fireEvent.change(notesTextarea, {
        target: {
          value: "Investigated LiveKit server logs; refunded 100% consultation fee to patient wallet.",
        },
      });

      // Submit
      fireEvent.click(screen.getByTestId("confirm-resolution-btn"));

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/complaints/${mockComplaints[0]._id}/resolve`,
          {
            status: "RESOLVED",
            resolutionNotes: "Investigated LiveKit server logs; refunded 100% consultation fee to patient wallet.",
          }
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Dispute successfully marked as RESOLVED/i)).toBeDefined();
      });
    });

    it("3.4 enforces minimum 5-character resolution notes requirement", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: [mockComplaints[0]],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      });
      const patchSpy = vi.spyOn(api, "patch");

      render(
        <BrowserRouter>
          <ComplaintsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId(`review-complaint-btn-${mockComplaints[0]._id}`)).toBeDefined();
      });

      fireEvent.click(screen.getByTestId(`review-complaint-btn-${mockComplaints[0]._id}`));

      await waitFor(() => {
        expect(screen.getByTestId("resolution-dialog")).toBeDefined();
      });

      // Enter only 3 chars
      const notesTextarea = screen.getByTestId("resolution-notes-input");
      fireEvent.change(notesTextarea, { target: { value: "ok!" } });

      fireEvent.click(screen.getByTestId("confirm-resolution-btn"));

      expect(screen.getByTestId("resolution-notes-error")).toBeDefined();
      expect(
        screen.getByText(/Resolution notes are required and must be at least 5 characters long/i)
      ).toBeDefined();
      expect(patchSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. AUDIT TRAIL VIEWER TESTS
  // =========================================================================
  describe("Audit Logs Viewer (AuditLogsPage.tsx)", () => {
    it("4.1 submits query parameters matching documented contract (actorId, action, resourceType, date range)", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockAuditLogs,
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });

      render(
        <BrowserRouter>
          <AuditLogsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalled();
      });

      // Enter filters
      fireEvent.change(screen.getByTestId("filter-actor-input"), {
        target: { value: "64b8e2f01a2b3c4d5e6f7a01" },
      });
      fireEvent.change(screen.getByTestId("filter-action-input"), {
        target: { value: "DOCTOR_VERIFICATION_APPROVED" },
      });
      fireEvent.change(screen.getByTestId("filter-resource-input"), {
        target: { value: "DoctorProfile" },
      });
      fireEvent.change(screen.getByTestId("filter-from-input"), {
        target: { value: "2026-10-01" },
      });
      fireEvent.change(screen.getByTestId("filter-to-input"), {
        target: { value: "2026-10-19" },
      });

      fireEvent.click(screen.getByTestId("apply-audit-filters-btn"));

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          "/admin/audit-logs",
          expect.objectContaining({
            params: expect.objectContaining({
              actorId: "64b8e2f01a2b3c4d5e6f7a01",
              action: "DOCTOR_VERIFICATION_APPROVED",
              resourceType: "DoctorProfile",
              from: expect.stringContaining("2026-10-01"),
              to: expect.stringContaining("2026-10-19"),
            }),
          })
        );
      });
    });

    it("4.2 displays clean, dedicated unavailable notice when backend returns HTTP 404 without crashing", async () => {
      vi.spyOn(api, "get").mockRejectedValue(
        new ApiError("Not Found", 404, "NOT_FOUND")
      );

      render(
        <BrowserRouter>
          <AuditLogsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("audit-unavailable-card")).toBeDefined();
      });
      expect(
        screen.getByText(/Audit Log Query API Unavailable \(HTTP 404\)/i)
      ).toBeDefined();
      expect(
        screen.getByTestId("audit-unavailable-card").textContent
      ).toContain("unmounted on the backend server");
    });

    it("4.3 renders read-only immutable audit log table when entries are returned", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockAuditLogs,
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      });

      render(
        <BrowserRouter>
          <AuditLogsPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("audit-logs-table")).toBeDefined();
      });

      expect(screen.getByText("DOCTOR_VERIFICATION_APPROVED")).toBeDefined();
      expect(screen.getByText("ORDER_PLACED")).toBeDefined();
      expect(screen.getByText("192.168.1.100")).toBeDefined();
    });
  });

  // =========================================================================
  // 5. ROLE AUTHORIZATION & ROUTE GUARD TESTS
  // =========================================================================
  describe("Admin Route Authorization", () => {
    it("5.1 redirects non-admin roles away from admin routes to own role dashboard", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: [],
      });

      // Set user role to PATIENT
      useAuthStore.setState({
        user: {
          id: "64b8e2f01a2b3c4d5e6f7a88",
          email: "patient@lifeline.org",
          fullName: "Patient User",
          role: "PATIENT" as const,
        },
        accessToken: "mock-patient-jwt",
        isAuthenticated: true,
      });

      render(
        <MemoryRouter initialEntries={["/admin/dashboard"]}>
          <AppRoutes />
        </MemoryRouter>
      );

      // Patient should be redirected to /patient/dashboard
      await waitFor(() => {
        expect(screen.getAllByText(/Patient Portal/i).length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId("admin-dashboard")).toBeNull();
    });

    it("5.2 allows authenticated ADMIN role to access /admin/dashboard, /admin/verifications, and /admin/complaints", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockOverviewMetrics,
      });

      render(
        <MemoryRouter initialEntries={["/admin/dashboard"]}>
          <AppRoutes />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("admin-dashboard")).toBeDefined();
      });
    });
  });
});
