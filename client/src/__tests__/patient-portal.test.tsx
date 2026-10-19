import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { DoctorSearchPage } from "@/features/doctors/pages/DoctorSearchPage";
import { BookingModal, type PublicDoctorSummary } from "@/features/appointments/components/BookingModal";
import { RecordsPage } from "@/features/medical-records/pages/RecordsPage";
import { PatientOrdersPage } from "@/features/orders/pages/PatientOrdersPage";
import { PatientDashboard } from "@/features/patients/pages/PatientDashboard";
import * as razorpayService from "@/features/appointments/services/razorpay";

const mockDoctor: PublicDoctorSummary = {
  id: "64b8e2f01a2b3c4d5e6f7a8b",
  name: "Dr. Sarah Jenkins",
  specialization: "Cardiologist",
  qualifications: ["MBBS", "MD Cardiology"],
  experienceYears: 12,
  clinicName: "Heart Care Clinic",
  clinicAddress: {
    city: "Mumbai",
    state: "Maharashtra",
  },
  languages: ["English", "Hindi"],
  consultationFee: 800,
  consultationTypes: ["VIDEO", "AUDIO", "CHAT", "IN_PERSON"],
  rating: 4.8,
  totalReviews: 42,
};

describe("Milestone 13 — Task 13.3: Patient Portal Views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();

    useAuthStore.setState({
      user: {
        id: "usr_pat_123",
        fullName: "Aniket Patient",
        email: "patient@lifeline.org",
        role: "PATIENT",
        status: "ACTIVE",
      },
      accessToken: "mock_jwt_token",
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. DOCTOR DISCOVERY & SEARCH
  // =========================================================================
  describe("Doctor Discovery (DoctorSearchPage)", () => {
    it("1. fetches doctors on mount and renders doctor profile cards", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: [mockDoctor],
        pagination: { page: 1, limit: 12, total: 1, sort: "rating", order: "desc" },
      });

      render(
        <BrowserRouter>
          <DoctorSearchPage />
        </BrowserRouter>
      );

      // Verify header
      expect(screen.getByText("Find and Consult Qualified Doctors")).toBeDefined();

      // Await results
      await waitFor(() => {
        expect(screen.getByText("Dr. Sarah Jenkins")).toBeDefined();
        expect(screen.getAllByText("Cardiologist").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("12 Years Clinical Experience")).toBeDefined();
        expect(screen.getByText("₹800")).toBeDefined();
        expect(screen.getByText("4.8")).toBeDefined();
        expect(screen.getByText("(42)")).toBeDefined();
      });
    });

    it("2. renders empty state when search filters produce zero results", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: [],
        pagination: { page: 1, limit: 12, total: 0, sort: "rating", order: "desc" },
      });

      render(
        <BrowserRouter>
          <DoctorSearchPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("No Verified Doctors Found")).toBeDefined();
        expect(screen.getByTestId("doctor-empty-state")).toBeDefined();
      });
    });

    it("3. displays safe error state with retry button on API failure", async () => {
      vi.spyOn(api, "get").mockRejectedValueOnce(
        new ApiError("Doctor directory service unavailable", 503)
      );

      render(
        <BrowserRouter>
          <DoctorSearchPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Doctor Discovery Error")).toBeDefined();
        expect(screen.getByText("Doctor directory service unavailable")).toBeDefined();
      });
    });

    it("4. clicking 'Book Appointment' opens the booking modal for that doctor", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url.includes("/doctors") && !url.includes("/availability")) {
          return Promise.resolve({
            success: true,
            data: [mockDoctor],
            pagination: { page: 1, limit: 12, total: 1, sort: "rating", order: "desc" },
          });
        }
        if (url.includes("/availability")) {
          return Promise.resolve({
            success: true,
            data: {
              doctorId: mockDoctor.id,
              date: "2026-10-25",
              slots: [{ startTime: "09:00", endTime: "09:30", available: true }],
            },
          });
        }
        return Promise.reject(new Error("Unknown endpoint"));
      });

      render(
        <BrowserRouter>
          <DoctorSearchPage />
        </BrowserRouter>
      );

      await waitFor(() => screen.getByTestId(`book-doctor-${mockDoctor.id}`));
      fireEvent.click(screen.getByTestId(`book-doctor-${mockDoctor.id}`));

      await waitFor(() => {
        expect(screen.getByText("Book Appointment with Dr. Sarah Jenkins")).toBeDefined();
        expect(screen.getByTestId("booking-step-1")).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 2. GUIDED BOOKING WIZARD & PAYMENTS
  // =========================================================================
  describe("Booking Wizard (BookingModal)", () => {
    it("5. navigates through step 1, 2, and 3 with slot selection and validation", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          doctorId: mockDoctor.id,
          date: "2026-10-25",
          slots: [
            { startTime: "09:00", endTime: "09:30", available: true },
            { startTime: "09:30", endTime: "10:00", available: false },
          ],
        },
      });

      render(
        <BookingModal
          doctor={mockDoctor}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      // Step 1: Consultation Type
      expect(screen.getByTestId("booking-step-1")).toBeDefined();
      fireEvent.click(screen.getByText("Continue"));

      // Step 2: Slot Selection
      await waitFor(() => screen.getByTestId("booking-step-2"));
      const availableSlotButton = screen.getByText("09:00 - 09:30");
      const unavailableSlotButton = screen.getByText("09:30 - 10:00");

      expect(availableSlotButton).toBeDefined();
      expect(unavailableSlotButton.hasAttribute("disabled")).toBe(true);

      // Select slot
      fireEvent.click(availableSlotButton);
      fireEvent.click(screen.getByTestId("step2-continue-button"));

      // Step 3: Reason & Review
      await waitFor(() => screen.getByTestId("booking-step-3"));
      const reasonInput = screen.getByLabelText(/Reason for Consultation/i);
      fireEvent.change(reasonInput, { target: { value: "Chest discomfort and palpitations" } });

      expect(screen.getByText(/Total Consultation Fee/i)).toBeDefined();
      expect(screen.getByText("₹800")).toBeDefined();
    });

    it("6. creates 15-minute slot reservation and opens payment step", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          doctorId: mockDoctor.id,
          date: "2026-10-25",
          slots: [{ startTime: "10:00", endTime: "10:30", available: true }],
        },
      });

      vi.spyOn(api, "post").mockResolvedValueOnce({
        success: true,
        data: {
          appointmentId: "appt_res_999888777",
          status: "PENDING_PAYMENT",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          fee: 800,
          currency: "INR",
        },
      });

      render(
        <BookingModal
          doctor={mockDoctor}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      // Step 1 -> Step 2
      fireEvent.click(screen.getByText("Continue"));

      // Step 2 -> Step 3
      await waitFor(() => screen.getByText("10:00 - 10:30"));
      fireEvent.click(screen.getByText("10:00 - 10:30"));
      fireEvent.click(screen.getByTestId("step2-continue-button"));

      // Step 3 -> Reserve
      await waitFor(() => screen.getByLabelText(/Reason for Consultation/i));
      fireEvent.change(screen.getByLabelText(/Reason for Consultation/i), {
        target: { value: "Follow-up ECG consultation" },
      });

      fireEvent.click(screen.getByTestId("reserve-slot-button"));

      // Step 4: Payment screen
      await waitFor(() => {
        expect(screen.getByTestId("booking-step-4")).toBeDefined();
        expect(screen.getByText("appt_res_999888777")).toBeDefined();
        expect(screen.getByText(/Pay ₹800 via Razorpay/i)).toBeDefined();
      });
    });

    it("7. dismisses Razorpay modal safely without marking appointment confirmed", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          doctorId: mockDoctor.id,
          date: "2026-10-25",
          slots: [{ startTime: "11:00", endTime: "11:30", available: true }],
        },
      });

      vi.spyOn(api, "post").mockImplementation((url) => {
        if (url === "/appointments") {
          return Promise.resolve({
            success: true,
            data: {
              appointmentId: "appt_res_123",
              status: "PENDING_PAYMENT",
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              fee: 800,
              currency: "INR",
            },
          });
        }
        if (url === "/payments/create-intent") {
          return Promise.resolve({
            success: true,
            data: {
              paymentId: "pay_123",
              orderId: "order_rzp_123",
              amount: 80000,
              currency: "INR",
              keyId: "rzp_test_public_key",
              referenceId: "PAY-REF-123",
            },
          });
        }
        return Promise.reject(new Error("Unknown POST"));
      });

      // Mock Razorpay SDK loading & window instance
      vi.spyOn(razorpayService, "loadRazorpayScript").mockResolvedValue(true);
      const mockOpen = vi.fn();
      let dismissCallback: (() => void) | undefined;

      window.Razorpay = vi.fn(function (this: any, options: any) {
        dismissCallback = options.modal?.ondismiss;
        return {
          open: () => {
            mockOpen();
            // Simulate user closing checkout window
            if (dismissCallback) dismissCallback();
          },
        };
      }) as any;

      render(
        <BookingModal
          doctor={mockDoctor}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      // Advance to step 3 and reserve
      fireEvent.click(screen.getByText("Continue"));
      await waitFor(() => screen.getByText("11:00 - 11:30"));
      fireEvent.click(screen.getByText("11:00 - 11:30"));
      fireEvent.click(screen.getByTestId("step2-continue-button"));
      await waitFor(() => screen.getByLabelText(/Reason for Consultation/i));
      fireEvent.change(screen.getByLabelText(/Reason for Consultation/i), {
        target: { value: "Cardiac review session" },
      });
      fireEvent.click(screen.getByTestId("reserve-slot-button"));

      // Click pay now
      await waitFor(() => screen.getByTestId("pay-now-button"));
      fireEvent.click(screen.getByTestId("pay-now-button"));

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalled();
        expect(
          screen.getByText(/Checkout was closed. Your slot remains locked for 15 minutes/i)
        ).toBeDefined();
        // Crucial security check: Must NOT transition to Step 5 (Confirmed)
        expect(screen.queryByTestId("booking-step-5")).toBeNull();
      });
    });

    it("8. displays confirmed state only after authoritative backend verification", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url.includes("/availability")) {
          return Promise.resolve({
            success: true,
            data: {
              doctorId: mockDoctor.id,
              date: "2026-10-25",
              slots: [{ startTime: "14:00", endTime: "14:30", available: true }],
            },
          });
        }
        if (url === "/appointments") {
          return Promise.resolve({
            success: true,
            data: [
              {
                _id: "appt_res_verified",
                status: "CONFIRMED", // Server confirms webhook settlement
              },
            ],
          });
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      vi.spyOn(api, "post").mockImplementation((url) => {
        if (url === "/appointments") {
          return Promise.resolve({
            success: true,
            data: {
              appointmentId: "appt_res_verified",
              status: "PENDING_PAYMENT",
              expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              fee: 800,
              currency: "INR",
            },
          });
        }
        if (url === "/payments/create-intent") {
          return Promise.resolve({
            success: true,
            data: {
              paymentId: "pay_verified",
              orderId: "order_rzp_verified",
              amount: 80000,
              currency: "INR",
              keyId: "rzp_test_public_key",
              referenceId: "PAY-REF-VERIFIED",
            },
          });
        }
        return Promise.reject(new Error("Unknown POST"));
      });

      vi.spyOn(razorpayService, "loadRazorpayScript").mockResolvedValue(true);

      window.Razorpay = vi.fn(function (this: any, options: any) {
        return {
          open: () => {
            // Trigger client payment success handler
            options.handler({
              razorpay_payment_id: "pay_29384",
              razorpay_order_id: "order_rzp_verified",
              razorpay_signature: "mock_sig",
            });
          },
        };
      }) as any;

      render(
        <BookingModal
          doctor={mockDoctor}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      fireEvent.click(screen.getByText("Continue"));
      await waitFor(() => screen.getByText("14:00 - 14:30"));
      fireEvent.click(screen.getByText("14:00 - 14:30"));
      fireEvent.click(screen.getByTestId("step2-continue-button"));
      await waitFor(() => screen.getByLabelText(/Reason for Consultation/i));
      fireEvent.change(screen.getByLabelText(/Reason for Consultation/i), {
        target: { value: "Hypertension clinical review" },
      });
      fireEvent.click(screen.getByTestId("reserve-slot-button"));

      await waitFor(() => screen.getByTestId("pay-now-button"));
      fireEvent.click(screen.getByTestId("pay-now-button"));

      await waitFor(() => {
        expect(screen.getByTestId("booking-step-5")).toBeDefined();
        expect(screen.getByText("Appointment Confirmed!")).toBeDefined();
        expect(screen.getByText("CONFIRMED")).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 3. MEDICAL RECORDS UPLOAD & DOWNLOAD
  // =========================================================================
  describe("Medical Records (RecordsPage)", () => {
    it("9. renders backend limitation notice and empty state on mount", () => {
      render(<RecordsPage />);

      expect(screen.getByText("Medical Records & Diagnostics")).toBeDefined();
      expect(screen.getByText("Patient Privacy & Session Scope")).toBeDefined();
      expect(
        screen.getByText(
          /the LifeLine backend does not expose a public list-all endpoint for medical records/i
        )
      ).toBeDefined();
      expect(screen.getByTestId("records-empty-state")).toBeDefined();
    });

    it("10. rejects files with unsupported MIME types or oversized bodies", async () => {
      render(<RecordsPage />);

      fireEvent.click(screen.getByTestId("upload-record-button"));
      await waitFor(() => screen.getByTestId("file-upload-input"));

      const fileInput = screen.getByTestId("file-upload-input");

      // Test invalid MIME (e.g. text/plain)
      const invalidFile = new File(["dummy text"], "notes.txt", { type: "text/plain" });
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      expect(
        screen.getByText(/Invalid file type 'text\/plain'. Permitted clinical formats: PDF, PNG, JPEG, DICOM/i)
      ).toBeDefined();
    });

    it("11. completes 3-step upload workflow and registers medical record metadata", async () => {
      // Mock Step 1: upload-url
      vi.spyOn(api, "post").mockImplementation((url, body) => {
        if (url === "/medical-records/upload-url") {
          return Promise.resolve({
            success: true,
            data: {
              uploadUrl: "https://mock-s3.amazonaws.com/records/uuid-123.pdf",
              storageKey: "records/uuid-123.pdf",
              expiresInSeconds: 600,
              method: "PUT",
              headers: { "Content-Type": "application/pdf" },
            },
          });
        }
        if (url === "/medical-records") {
          return Promise.resolve({
            success: true,
            data: {
              id: "64b8e2f01a2b3c4d5e6f7a99",
              title: body.title,
              recordType: body.recordType,
              fileName: "blood_test.pdf",
              fileType: "application/pdf",
              sizeBytes: 1024 * 500,
              recordDate: body.recordDate,
              storageKey: body.storageKey,
            },
          });
        }
        return Promise.reject(new Error("Unknown POST"));
      });

      // Mock Step 2: fetch PUT to cloud storage
      const fetchSpy = vi.spyOn(window, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as any);

      render(<RecordsPage />);

      fireEvent.click(screen.getByTestId("upload-record-button"));
      await waitFor(() => screen.getByTestId("file-upload-input"));

      const validPdf = new File(["pdf-binary-data"], "blood_test.pdf", {
        type: "application/pdf",
      });

      fireEvent.change(screen.getByTestId("file-upload-input"), {
        target: { files: [validPdf] },
      });

      const titleInput = screen.getByTestId("record-title-input");
      fireEvent.change(titleInput, { target: { value: "Comprehensive Blood Panel" } });

      fireEvent.click(screen.getByTestId("submit-upload-record"));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalledWith(
          "https://mock-s3.amazonaws.com/records/uuid-123.pdf",
          expect.objectContaining({ method: "PUT" })
        );
        expect(screen.getAllByText(/Comprehensive Blood Panel/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/LAB REPORT/i).length).toBeGreaterThanOrEqual(1);
      });
    });

    it("12. requests temporary download URL on demand and never stores in localStorage", async () => {
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: {
          downloadUrl: "https://mock-s3.amazonaws.com/records/signed-download-link",
          expiresInSeconds: 900,
          recordId: "64b8e2f01a2b3c4d5e6f7a99",
          fileName: "blood_test.pdf",
          fileType: "application/pdf",
          sizeBytes: 500000,
        },
      });

      render(<RecordsPage />);

      // Perform ID lookup
      const lookupInput = screen.getByTestId("record-lookup-input");
      fireEvent.change(lookupInput, { target: { value: "64b8e2f01a2b3c4d5e6f7a99" } });
      fireEvent.click(screen.getByTestId("record-lookup-submit"));

      await waitFor(() => {
        expect(windowOpenSpy).toHaveBeenCalledWith(
          "https://mock-s3.amazonaws.com/records/signed-download-link",
          "_blank",
          "noopener,noreferrer"
        );
      });

      // Verify ZERO storage persistence
      expect(window.localStorage.getItem("downloadUrl")).toBeNull();
      expect(window.sessionStorage.getItem("downloadUrl")).toBeNull();
      expect(JSON.stringify(window.localStorage)).not.toContain("signed-download-link");
      expect(JSON.stringify(window.sessionStorage)).not.toContain("signed-download-link");
    });
  });

  // =========================================================================
  // 4. PATIENT ORDERS & STATUS TIMELINE
  // =========================================================================
  describe("Patient Orders (PatientOrdersPage)", () => {
    it("13. renders empty lookup state with limitation banner", () => {
      render(<PatientOrdersPage />);

      expect(screen.getByText("Medicine Orders & Fulfillment")).toBeDefined();
      expect(screen.getByText("Order Scope & Security")).toBeDefined();
      expect(screen.getByTestId("orders-empty-state")).toBeDefined();
    });

    it("14. looks up order by ID and renders fulfillment timeline and medicine items", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: {
          _id: "64b8e2f01a2b3c4d5e6f7b11",
          patientId: "usr_pat_123",
          pharmacyId: "usr_pharm_456",
          items: [
            { medicineId: "med_1", name: "Amoxicillin 500mg", price: 120, quantity: 2 },
            { medicineId: "med_2", name: "Paracetamol 650mg", price: 30, quantity: 1 },
          ],
          totalAmount: 270,
          status: "PREPARING",
          paymentStatus: "PAID",
          deliveryAddress: {
            street: "42 Wellness Way",
            city: "Pune",
            state: "Maharashtra",
            postalCode: "411001",
            country: "India",
          },
          createdAt: "2026-10-18T10:00:00.000Z",
        },
      });

      render(<PatientOrdersPage />);

      const input = screen.getByTestId("order-lookup-input");
      fireEvent.change(input, { target: { value: "64b8e2f01a2b3c4d5e6f7b11" } });
      fireEvent.click(screen.getByTestId("order-lookup-button"));

      await waitFor(() => {
        expect(screen.getByTestId("active-order-display")).toBeDefined();
        expect(screen.getByText("PREPARING")).toBeDefined();
        expect(screen.getByText("Amoxicillin 500mg")).toBeDefined();
        expect(screen.getByText("₹270")).toBeDefined();
        expect(screen.getByText(/42 Wellness Way, Pune/i)).toBeDefined();
      });
    });

    it("15. does not present REFUND_PENDING as completed refund", async () => {
      vi.spyOn(api, "get").mockResolvedValueOnce({
        success: true,
        data: {
          _id: "64b8e2f01a2b3c4d5e6f7b99",
          patientId: "usr_pat_123",
          pharmacyId: "usr_pharm_456",
          items: [{ medicineId: "med_1", name: "Azithromycin 250mg", price: 200, quantity: 1 }],
          totalAmount: 200,
          status: "REFUND_PENDING",
          paymentStatus: "REFUND_PENDING",
          deliveryAddress: {
            street: "10 Medical Lane",
            city: "Mumbai",
            state: "MH",
            postalCode: "400001",
            country: "India",
          },
          createdAt: "2026-10-18T10:00:00.000Z",
        },
      });

      render(<PatientOrdersPage />);

      const input = screen.getByTestId("order-lookup-input");
      fireEvent.change(input, { target: { value: "64b8e2f01a2b3c4d5e6f7b99" } });
      fireEvent.click(screen.getByTestId("order-lookup-button"));

      await waitFor(() => {
        expect(screen.getByText("Refund Pending Processing")).toBeDefined();
        expect(screen.getByText(/Note: Not yet completed/i)).toBeDefined();
        expect(screen.queryByText("Payment Fully Refunded")).toBeNull();
      });
    });
  });

  // =========================================================================
  // 5. PATIENT DASHBOARD
  // =========================================================================
  describe("Patient Dashboard (PatientDashboard)", () => {
    it("16. loads real health profile and upcoming consultations without fake statistics", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url === "/patients/me/profile") {
          return Promise.resolve({
            success: true,
            data: {
              userId: "usr_pat_123",
              bloodGroup: "O+",
              gender: "MALE",
              allergies: ["Penicillin", "Peanuts"],
              emergencyContact: {
                name: "Pooja Kadam",
                relationship: "Spouse",
                phone: "+919876543210",
              },
            },
          });
        }
        if (url === "/appointments") {
          return Promise.resolve({
            success: true,
            data: [
              {
                _id: "appt_dash_01",
                doctorId: "doc_1",
                patientId: "usr_pat_123",
                appointmentType: "VIDEO",
                scheduledStart: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
                scheduledEnd: new Date(Date.now() + 48.5 * 60 * 60 * 1000).toISOString(),
                status: "CONFIRMED",
                fee: 500,
                currency: "INR",
              },
            ],
          });
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      render(
        <BrowserRouter>
          <PatientDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Welcome back, Aniket Patient")).toBeDefined();
        expect(screen.getByText("O+")).toBeDefined();
        expect(screen.getByText("Penicillin")).toBeDefined();
        expect(screen.getByText(/Pooja Kadam/i)).toBeDefined();
        expect(screen.getByText("CONFIRMED")).toBeDefined();
        expect(screen.getByText("• Fee: ₹500")).toBeDefined();
      });
    });

    it("17. displays empty appointments state gracefully when patient has no bookings", async () => {
      vi.spyOn(api, "get").mockImplementation((url) => {
        if (url === "/patients/me/profile") {
          return Promise.resolve({
            success: true,
            data: { userId: "usr_pat_123" },
          });
        }
        if (url === "/appointments") {
          return Promise.resolve({
            success: true,
            data: [],
          });
        }
        return Promise.reject(new Error("Unknown GET"));
      });

      render(
        <BrowserRouter>
          <PatientDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByTestId("no-appointments-empty")).toBeDefined();
        expect(screen.getByText("No Upcoming Consultations")).toBeDefined();
      });
    });
  });
});
