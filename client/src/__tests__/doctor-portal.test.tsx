import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { DoctorDashboard } from "@/features/doctors/pages/DoctorDashboard";
import { AvailabilitySettingsPage } from "@/features/doctors/pages/AvailabilitySettingsPage";
import { DoctorAppointmentsPage } from "@/features/doctors/pages/DoctorAppointmentsPage";
import { PrescriptionBuilderModal } from "@/features/prescriptions/components/PrescriptionBuilderModal";

describe("Milestone 13 — Task 13.4: Doctor Portal Views", () => {
  const mockDoctorUser = {
    id: "64b8e2f01a2b3c4d5e6f7a01",
    email: "doctor.sharma@lifeline.org",
    fullName: "Dr. Rajesh Sharma",
    role: "DOCTOR" as const,
    isEmailVerified: true,
  };

  const mockDoctorProfile = {
    userId: "64b8e2f01a2b3c4d5e6f7a01",
    specialization: "Cardiology",
    experienceYears: 12,
    qualifications: ["MBBS", "MD (Cardiology)"],
    clinicName: "LifeLine Heart & Vascular Clinic",
    clinicAddress: {
      street: "101 Medical Enclave",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400001",
      country: "India",
    },
    languages: ["English", "Hindi", "Marathi"],
    consultationFee: 1200,
    consultationTypes: ["VIDEO", "IN_PERSON"],
    bio: "Interventional cardiologist specializing in preventive cardiology.",
    verificationStatus: "APPROVED_VERIFIED",
    rating: 4.9,
    totalReviews: 84,
  };

  const mockTodayAppointments = [
    {
      _id: "64b8e2f01a2b3c4d5e6f7a11",
      patientId: "64b8e2f01a2b3c4d5e6f7a88",
      doctorId: "64b8e2f01a2b3c4d5e6f7a01",
      appointmentType: "VIDEO",
      scheduledStart: new Date(Date.now() + 3600000).toISOString(),
      scheduledEnd: new Date(Date.now() + 5400000).toISOString(),
      status: "CONFIRMED",
      reason: "Post-angioplasty follow-up consultation",
      fee: 1200,
      currency: "INR",
      paymentStatus: "PAID",
    },
    {
      _id: "64b8e2f01a2b3c4d5e6f7a12",
      patientId: "64b8e2f01a2b3c4d5e6f7a99",
      doctorId: "64b8e2f01a2b3c4d5e6f7a01",
      appointmentType: "IN_PERSON",
      scheduledStart: new Date(Date.now() + 7200000).toISOString(),
      scheduledEnd: new Date(Date.now() + 9000000).toISOString(),
      status: "PENDING_PAYMENT",
      reason: "Chronic hypertension monitoring",
      fee: 1200,
      currency: "INR",
      paymentStatus: "PENDING",
    },
  ];

  const mockAvailability = {
    _id: "64b8e2f01a2b3c4d5e6f7a33",
    doctorId: "64b8e2f01a2b3c4d5e6f7a01",
    slotDurationMinutes: 30,
    weeklySchedule: [
      {
        dayOfWeek: "MONDAY",
        shifts: [{ startTime: "09:00", endTime: "13:00" }],
      },
      {
        dayOfWeek: "WEDNESDAY",
        shifts: [{ startTime: "14:00", endTime: "18:00" }],
      },
    ],
    exceptions: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: mockDoctorUser,
      accessToken: "mock-doctor-token",
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. DOCTOR DASHBOARD TESTS
  // =========================================================================
  describe("Doctor Dashboard (DoctorDashboard)", () => {
    it("1. fetches doctor profile and today's consultation queue on mount", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url === "/doctors/me/profile") {
          return Promise.resolve({ success: true, data: mockDoctorProfile });
        }
        if (url === "/appointments") {
          return Promise.resolve({ success: true, data: mockTodayAppointments });
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      render(
        <BrowserRouter>
          <DoctorDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Dr\. Rajesh Sharma/i)).toBeDefined();
        expect(screen.getByText(/Verified Practitioner/i)).toBeDefined();
        expect(screen.getAllByText(/Cardiology/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/12 Years Clinical Experience/i)).toBeDefined();
        expect(screen.getByText(/Post-angioplasty follow-up consultation/i)).toBeDefined();
        expect(screen.getByText(/Chronic hypertension monitoring/i)).toBeDefined();
      });
    });

    it("2. renders empty state when doctor has zero appointments scheduled today", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url === "/doctors/me/profile") {
          return Promise.resolve({ success: true, data: mockDoctorProfile });
        }
        if (url === "/appointments") {
          return Promise.resolve({ success: true, data: [] });
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      render(
        <BrowserRouter>
          <DoctorDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("dashboard-empty-appointments")).toBeDefined();
        expect(screen.getByText(/No Consultations Scheduled for Today/i)).toBeDefined();
      });
    });

    it("3. displays error notice when workstation APIs fail with retry action", async () => {
      vi.spyOn(api, "get").mockRejectedValue(new ApiError("Database offline", 500, "DATABASE_ERROR"));

      render(
        <BrowserRouter>
          <DoctorDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("doctor-dashboard-error-alert")).toBeDefined();
        expect(screen.getByText(/Database offline/i)).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 2. AVAILABILITY SETTINGS TESTS
  // =========================================================================
  describe("Weekly Availability Settings (AvailabilitySettingsPage)", () => {
    it("4. loads existing weekly shifts and slot duration on mount", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability,
      });

      render(<AvailabilitySettingsPage />);

      await waitFor(() => {
        expect(screen.getByTestId("shift-chip-monday-0")).toBeDefined();
        expect(screen.getByText(/09:00 – 13:00/)).toBeDefined();
        expect(screen.getByTestId("shift-chip-wednesday-0")).toBeDefined();
        expect(screen.getByText(/14:00 – 18:00/)).toBeDefined();
      });
    });

    it("5. adding a valid shift updates the schedule draft and marks unsaved changes", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability,
      });

      render(<AvailabilitySettingsPage />);

      await waitFor(() => screen.getByTestId("shift-chip-monday-0"));

      // Add second shift on Monday: 14:00 to 18:00 (compatible with 30m slot, non-overlapping)
      const startInput = screen.getByTestId("shift-start-monday");
      const endInput = screen.getByTestId("shift-end-monday");

      fireEvent.change(startInput, { target: { value: "14:00" } });
      fireEvent.change(endInput, { target: { value: "18:00" } });

      fireEvent.click(screen.getByTestId("add-shift-btn-monday"));

      await waitFor(() => {
        expect(screen.getByTestId("shift-chip-monday-1")).toBeDefined();
        expect(screen.getByText(/Unsaved Changes/i)).toBeDefined();
      });
    });

    it("6. rejects shift where start time is not earlier than end time", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability,
      });

      render(<AvailabilitySettingsPage />);

      await waitFor(() => screen.getByTestId("shift-chip-monday-0"));

      const startInput = screen.getByTestId("shift-start-tuesday");
      const endInput = screen.getByTestId("shift-end-tuesday");

      fireEvent.change(startInput, { target: { value: "15:00" } });
      fireEvent.change(endInput, { target: { value: "12:00" } }); // Invalid: start >= end

      fireEvent.click(screen.getByTestId("add-shift-btn-tuesday"));

      await waitFor(() => {
        expect(screen.getByTestId("availability-error-alert")).toBeDefined();
        expect(screen.getByText(/must be earlier than end time/i)).toBeDefined();
      });
    });

    it("7. rejects overlapping shifts on the same day", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability, // Monday has 09:00 - 13:00
      });

      render(<AvailabilitySettingsPage />);

      await waitFor(() => screen.getByTestId("shift-chip-monday-0"));

      const startInput = screen.getByTestId("shift-start-monday");
      const endInput = screen.getByTestId("shift-end-monday");

      fireEvent.change(startInput, { target: { value: "11:00" } }); // Overlaps with 09:00-13:00
      fireEvent.change(endInput, { target: { value: "15:00" } });

      fireEvent.click(screen.getByTestId("add-shift-btn-monday"));

      await waitFor(() => {
        expect(screen.getByTestId("availability-error-alert")).toBeDefined();
        expect(screen.getByText(/overlaps with an existing shift/i)).toBeDefined();
      });
    });

    it("8. rejects shift duration that is not divisible by slotDurationMinutes", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability, // slotDuration is 30m
      });

      render(<AvailabilitySettingsPage />);

      await waitFor(() => screen.getByTestId("shift-chip-monday-0"));

      const startInput = screen.getByTestId("shift-start-thursday");
      const endInput = screen.getByTestId("shift-end-thursday");

      fireEvent.change(startInput, { target: { value: "09:00" } });
      fireEvent.change(endInput, { target: { value: "09:45" } }); // 45 mins is not divisible by 30 mins

      fireEvent.click(screen.getByTestId("add-shift-btn-thursday"));

      await waitFor(() => {
        expect(screen.getByTestId("availability-error-alert")).toBeDefined();
        expect(screen.getByText(/must be an integer multiple of 30 minutes/i)).toBeDefined();
      });
    });

    it("9. removing a shift updates the draft and marks dirty", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability,
      });

      render(<AvailabilitySettingsPage />);

      await waitFor(() => screen.getByTestId("shift-chip-monday-0"));

      fireEvent.click(screen.getByTestId("remove-shift-monday-0"));

      await waitFor(() => {
        expect(screen.queryByTestId("shift-chip-monday-0")).toBeNull();
        expect(screen.getByText(/Unsaved Changes/i)).toBeDefined();
      });
    });

    it("10. failed save preserves user draft edits and surfaces error message", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: mockAvailability,
      });

      const putSpy = vi.spyOn(api, "put").mockRejectedValueOnce(
        new ApiError("Server rejected schedule payload", 400, "VALIDATION_ERROR")
      );

      render(<AvailabilitySettingsPage />);

      await waitFor(() => screen.getByTestId("shift-chip-monday-0"));

      // Add shift on Tuesday
      const startInput = screen.getByTestId("shift-start-tuesday");
      const endInput = screen.getByTestId("shift-end-tuesday");
      fireEvent.change(startInput, { target: { value: "10:00" } });
      fireEvent.change(endInput, { target: { value: "12:00" } });
      fireEvent.click(screen.getByTestId("add-shift-btn-tuesday"));

      await waitFor(() => screen.getByTestId("shift-chip-tuesday-0"));

      // Click save
      fireEvent.click(screen.getByTestId("save-schedule-btn"));

      await waitFor(() => {
        expect(putSpy).toHaveBeenCalled();
        expect(screen.getByTestId("availability-error-alert")).toBeDefined();
        expect(screen.getByText(/Server rejected schedule payload/i)).toBeDefined();
        // Draft edit remains preserved
        expect(screen.getByTestId("shift-chip-tuesday-0")).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 3. DOCTOR APPOINTMENTS & CLINICAL HISTORY DRAWER
  // =========================================================================
  describe("Doctor Appointments & Clinical Drawer (DoctorAppointmentsPage)", () => {
    it("11. loads appointments and allows filtering by status", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: mockTodayAppointments,
      });

      render(<DoctorAppointmentsPage />);

      await waitFor(() => {
        expect(screen.getByTestId("appointment-row-64b8e2f01a2b3c4d5e6f7a11")).toBeDefined();
        expect(screen.getByText(/Post-angioplasty follow-up consultation/i)).toBeDefined();
      });

      // Filter by confirmed
      const filterSelect = screen.getByTestId("status-filter-select");
      fireEvent.change(filterSelect, { target: { value: "CONFIRMED" } });

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          "/appointments",
          expect.objectContaining({
            params: expect.objectContaining({ status: "CONFIRMED" }),
          })
        );
      });
    });

    it("12. opening clinical history drawer retrieves authorized patient profile", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url === "/appointments") {
          return Promise.resolve({ success: true, data: mockTodayAppointments });
        }
        if (url === "/patients/64b8e2f01a2b3c4d5e6f7a88/profile") {
          return Promise.resolve({
            success: true,
            data: {
              userId: "64b8e2f01a2b3c4d5e6f7a88",
              bloodGroup: "O+",
              gender: "MALE",
              allergies: ["Penicillin", "Sulfa drugs"],
              chronicConditions: ["Hypertension", "Dyslipidemia"],
              emergencyContact: {
                name: "Anita Sharma",
                relationship: "Spouse",
                phone: "+91 98765 43210",
              },
            },
          });
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      render(<DoctorAppointmentsPage />);

      await waitFor(() => screen.getByTestId("open-patient-history-64b8e2f01a2b3c4d5e6f7a11"));

      fireEvent.click(screen.getByTestId("open-patient-history-64b8e2f01a2b3c4d5e6f7a11"));

      await waitFor(() => {
        expect(screen.getByTestId("patient-clinical-drawer")).toBeDefined();
        expect(screen.getByText("O+")).toBeDefined();
        expect(screen.getByText("Penicillin")).toBeDefined();
        expect(screen.getByText("Hypertension")).toBeDefined();
        expect(screen.getByText("Anita Sharma")).toBeDefined();
        expect(screen.getByText(/Zero-Trust Clinical Records Architecture/i)).toBeDefined();
      });
    });

    it("13. handles unauthorized clinical history access (HTTP 403) with safe notice", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url === "/appointments") {
          return Promise.resolve({ success: true, data: mockTodayAppointments });
        }
        if (url.includes("/patients/")) {
          return Promise.reject(
            new ApiError("Active clinical relationship required", 403, "FORBIDDEN")
          );
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      render(<DoctorAppointmentsPage />);

      await waitFor(() => screen.getByTestId("open-patient-history-64b8e2f01a2b3c4d5e6f7a11"));

      fireEvent.click(screen.getByTestId("open-patient-history-64b8e2f01a2b3c4d5e6f7a11"));

      await waitFor(() => {
        expect(screen.getByText(/An active clinical consultation relationship is required/i)).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 4. DIGITAL PRESCRIPTION BUILDER TESTS
  // =========================================================================
  describe("Digital Prescription Builder (PrescriptionBuilderModal)", () => {
    const mockAppointmentContext = {
      id: "64b8e2f01a2b3c4d5e6f7a11",
      patientId: "64b8e2f01a2b3c4d5e6f7a88",
      patientName: "Aarav Patel",
      scheduledStart: "2026-10-25T10:00:00.000Z",
      reason: "Hypertension review",
    };

    it("14. searches master medicine catalog and populates medicine details", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: [
          {
            _id: "64b8e2f01a2b3c4d5e6f7b99",
            name: "Telmisartan 40mg",
            genericName: "Telmisartan",
            strength: "40mg",
            dosageForm: "TABLET",
          },
        ],
      });

      render(
        <PrescriptionBuilderModal
          isOpen={true}
          onClose={() => {}}
          appointment={mockAppointmentContext}
          doctorName="Dr. Rajesh Sharma"
        />
      );

      const searchInput = screen.getByTestId("medicine-search-input");
      fireEvent.change(searchInput, { target: { value: "Telmi" } });

      await waitFor(() => {
        expect(screen.getByTestId("catalog-item-64b8e2f01a2b3c4d5e6f7b99")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("catalog-item-64b8e2f01a2b3c4d5e6f7b99"));

      expect(screen.getByTestId("item-name-input")).toHaveProperty("value", "Telmisartan 40mg");
      expect(screen.getByTestId("item-id-input")).toHaveProperty("value", "64b8e2f01a2b3c4d5e6f7b99");
      expect(screen.getByTestId("item-dosage-input")).toHaveProperty("value", "40mg");
    });

    it("15. cannot proceed to review if prescription contains zero medicines", async () => {
      render(
        <PrescriptionBuilderModal
          isOpen={true}
          onClose={() => {}}
          appointment={mockAppointmentContext}
          doctorName="Dr. Rajesh Sharma"
        />
      );

      const diagnosisInput = screen.getByTestId("prescription-diagnosis-input");
      fireEvent.change(diagnosisInput, { target: { value: "Essential Hypertension" } });

      const proceedBtn = screen.getByTestId("proceed-to-review-btn");
      expect(proceedBtn).toHaveProperty("disabled", true);
    });

    it("16. print preview reflects current draft and is explicitly marked DRAFT — NOT ISSUED", async () => {
      render(
        <PrescriptionBuilderModal
          isOpen={true}
          onClose={() => {}}
          appointment={mockAppointmentContext}
          doctorName="Dr. Rajesh Sharma"
        />
      );

      // Set diagnosis
      fireEvent.change(screen.getByTestId("prescription-diagnosis-input"), {
        target: { value: "Essential Hypertension (Stage 1)" },
      });

      // Fill medicine item
      fireEvent.change(screen.getByTestId("item-id-input"), {
        target: { value: "64b8e2f01a2b3c4d5e6f7b99" },
      });
      fireEvent.change(screen.getByTestId("item-name-input"), {
        target: { value: "Telmisartan 40mg" },
      });
      fireEvent.change(screen.getByTestId("item-dosage-input"), {
        target: { value: "40mg" },
      });
      fireEvent.change(screen.getByTestId("item-frequency-input"), {
        target: { value: "1-0-0 (Morning after food)" },
      });
      fireEvent.change(screen.getByTestId("item-duration-input"), {
        target: { value: "30" },
      });

      fireEvent.click(screen.getByTestId("add-medicine-item-btn"));

      // Click proceed to review
      fireEvent.click(screen.getByTestId("proceed-to-review-btn"));

      await waitFor(() => {
        expect(screen.getByTestId("prescription-step-2")).toBeDefined();
        expect(screen.getByText(/DRAFT — NOT ISSUED/i)).toBeDefined();
        expect(screen.getByText("Essential Hypertension (Stage 1)")).toBeDefined();
        expect(screen.getByText("Telmisartan 40mg")).toBeDefined();
        expect(screen.getByText(/Physician Confirmation Required Before Issuance/i)).toBeDefined();
      });
    });

    it("17. requires explicit confirmation to issue prescription and displays official status", async () => {
      const postSpy = vi.spyOn(api, "post").mockResolvedValueOnce({
        success: true,
        data: {
          _id: "64b8e2f01a2b3c4d5e6f7c11",
          appointmentId: mockAppointmentContext.id,
          patientId: mockAppointmentContext.patientId,
          doctorId: "64b8e2f01a2b3c4d5e6f7a01",
          diagnosis: "Essential Hypertension",
          medicines: [
            {
              medicineId: "64b8e2f01a2b3c4d5e6f7b99",
              medicineName: "Telmisartan 40mg",
              dosage: "40mg",
              frequency: "1-0-0",
              durationDays: 30,
              quantity: 1,
              route: "ORAL",
            },
          ],
          status: "ACTIVE",
          issuedAt: new Date().toISOString(),
        },
        message: "Prescription issued successfully",
      });

      render(
        <PrescriptionBuilderModal
          isOpen={true}
          onClose={() => {}}
          appointment={mockAppointmentContext}
          doctorName="Dr. Rajesh Sharma"
        />
      );

      // Step 1: fill form
      fireEvent.change(screen.getByTestId("prescription-diagnosis-input"), {
        target: { value: "Essential Hypertension" },
      });
      fireEvent.change(screen.getByTestId("item-id-input"), {
        target: { value: "64b8e2f01a2b3c4d5e6f7b99" },
      });
      fireEvent.change(screen.getByTestId("item-name-input"), {
        target: { value: "Telmisartan 40mg" },
      });
      fireEvent.change(screen.getByTestId("item-dosage-input"), {
        target: { value: "40mg" },
      });
      fireEvent.change(screen.getByTestId("item-frequency-input"), {
        target: { value: "1-0-0" },
      });
      fireEvent.click(screen.getByTestId("add-medicine-item-btn"));

      fireEvent.click(screen.getByTestId("proceed-to-review-btn"));

      // In Step 2: verify post was NOT called yet
      expect(postSpy).not.toHaveBeenCalled();

      // Explicit confirmation
      fireEvent.click(screen.getByTestId("confirm-issue-prescription-btn"));

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          "/prescriptions",
          expect.objectContaining({
            appointmentId: mockAppointmentContext.id,
            diagnosis: "Essential Hypertension",
            medicines: expect.arrayContaining([
              expect.objectContaining({
                medicineId: "64b8e2f01a2b3c4d5e6f7b99",
                medicineName: "Telmisartan 40mg",
              }),
            ]),
          })
        );
        expect(screen.getByTestId("prescription-step-3")).toBeDefined();
        expect(screen.getByText(/Prescription Issued Successfully/i)).toBeDefined();
        expect(screen.getByText(/64b8e2f01a2b3c4d5e6f7c11/)).toBeDefined();
      });
    });
  });
});
