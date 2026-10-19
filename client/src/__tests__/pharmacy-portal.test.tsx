import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { PharmacyDashboard } from "@/features/pharmacies/pages/PharmacyDashboard";
import { InventoryPage } from "@/features/pharmacies/pages/InventoryPage";
import { OrderReviewPage } from "@/features/pharmacies/pages/OrderReviewPage";
import { AppRoutes } from "@/routes/AppRoutes";

describe("Milestone 13 — Task 13.5: Pharmacy Portal Views", () => {
  const mockPharmacyUser = {
    id: "64b8e2f01a2b3c4d5e6f7a02",
    email: "care.pharmacy@lifeline.org",
    fullName: "Apex Care Chemist",
    role: "PHARMACY" as const,
    isEmailVerified: true,
  };

  const mockPharmacyProfile = {
    _id: "64b8e2f01a2b3c4d5e6f7b01",
    userId: "64b8e2f01a2b3c4d5e6f7a02",
    pharmacyName: "LifeLine Apex Care Chemist",
    licenseNumber: "DL-MH-2024-987654",
    address: {
      street: "Plot 42, Health City",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400012",
      country: "India",
    },
    verificationStatus: "APPROVED_VERIFIED",
    deliveryEnabled: true,
    operatingHours: "08:00 - 22:00",
    phone: "+91-9876543210",
  };

  const mockInventoryItems = [
    {
      _id: "64b8e2f01a2b3c4d5e6f7c01",
      pharmacyId: "64b8e2f01a2b3c4d5e6f7b01",
      medicineId: {
        _id: "64b8e2f01a2b3c4d5e6f7d01",
        name: "Paracetamol 650mg",
        genericName: "Acetaminophen",
        manufacturer: "GlaxoSmithKline",
        category: "ANALGESIC",
        dosageForm: "TABLET",
        strength: "650mg",
        prescriptionRequired: false,
      },
      batchNumber: "BATCH-PCM-001",
      expiryDate: new Date(Date.now() + 180 * 86400000).toISOString(),
      quantity: 50,
      reservedQuantity: 5,
      unitPrice: 35.5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      _id: "64b8e2f01a2b3c4d5e6f7c02",
      pharmacyId: "64b8e2f01a2b3c4d5e6f7b01",
      medicineId: {
        _id: "64b8e2f01a2b3c4d5e6f7d02",
        name: "Amoxicillin 500mg",
        genericName: "Amoxicillin Trihydrate",
        manufacturer: "Cipla",
        category: "ANTIBIOTIC",
        dosageForm: "CAPSULE",
        strength: "500mg",
        prescriptionRequired: true,
      },
      batchNumber: "BATCH-AMX-002",
      expiryDate: new Date(Date.now() + 90 * 86400000).toISOString(),
      quantity: 8, // Low stock (< 15)
      reservedQuantity: 2,
      unitPrice: 120.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      _id: "64b8e2f01a2b3c4d5e6f7c03",
      pharmacyId: "64b8e2f01a2b3c4d5e6f7b01",
      medicineId: {
        _id: "64b8e2f01a2b3c4d5e6f7d03",
        name: "Metformin 500mg",
        genericName: "Metformin HCl",
        manufacturer: "Sun Pharma",
        category: "ANTIDIABETIC",
        dosageForm: "TABLET",
        strength: "500mg",
        prescriptionRequired: true,
      },
      batchNumber: "BATCH-MET-003",
      expiryDate: new Date(Date.now() + 365 * 86400000).toISOString(),
      quantity: 0, // Out of stock
      reservedQuantity: 0,
      unitPrice: 45.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  const mockOrder = {
    _id: "6614fa1bc48a8a3a0e1041ab",
    patientId: "64b8e2f01a2b3c4d5e6f7a88",
    pharmacyId: "64b8e2f01a2b3c4d5e6f7b01",
    items: [
      {
        medicineId: "64b8e2f01a2b3c4d5e6f7d02",
        medicineName: "Amoxicillin 500mg",
        dosageForm: "CAPSULE",
        strength: "500mg",
        quantity: 2,
        unitPrice: 120.0,
        totalPrice: 240.0,
      },
    ],
    prescriptionId: "64b8e2f01a2b3c4d5e6f7e01",
    paymentStatus: "PAID" as const,
    status: "PRESCRIPTION_REVIEW" as const,
    deliveryAddress: {
      street: "Flat 402, Sunshine Apts",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400001",
      country: "India",
    },
    totals: {
      subtotal: 240.0,
      deliveryFee: 50.0,
      totalAmount: 290.0,
    },
    currency: "INR",
    deliveryNotes: "Leave at door if not reachable",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockPrescription = {
    _id: "64b8e2f01a2b3c4d5e6f7e01",
    patientId: "64b8e2f01a2b3c4d5e6f7a88",
    doctorId: "64b8e2f01a2b3c4d5e6f7a01",
    status: "FINALIZED_ISSUED",
    diagnosis: "Acute Bacterial Sinusitis",
    medicines: [
      {
        medicineId: "64b8e2f01a2b3c4d5e6f7d02",
        medicineName: "Amoxicillin 500mg",
        dosage: "500mg",
        frequency: "1-0-1 (After meals)",
        durationDays: 5,
        quantity: 10,
        route: "ORAL",
        specialInstructions: "Complete entire 5-day regimen",
      },
    ],
    additionalNotes: "Drink plenty of warm fluids.",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
    integrityChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    useAuthStore.setState({
      user: mockPharmacyUser,
      accessToken: "mock-pharmacy-jwt",
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. PHARMACY DASHBOARD TESTS
  // =========================================================================
  describe("Pharmacy Dashboard (PharmacyDashboard.tsx)", () => {
    it("1.1 renders pharmacy profile, verification status, and stock summary metrics on mount", async () => {
      vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes("/pharmacies/me/profile")) {
          return Promise.resolve({ success: true, data: mockPharmacyProfile });
        }
        if (url.includes("/pharmacies/me/inventory")) {
          return Promise.resolve({
            success: true,
            data: {
              items: mockInventoryItems,
              total: 3,
              page: 1,
              totalPages: 1,
            },
          });
        }
        return Promise.reject(new Error("Unexpected endpoint"));
      });

      render(
        <BrowserRouter>
          <PharmacyDashboard />
        </BrowserRouter>
      );

      // Verify profile header
      await waitFor(() => {
        expect(screen.getByText("LifeLine Apex Care Chemist")).toBeDefined();
      });
      expect(screen.getByText(/DL-MH-2024-987654/)).toBeDefined();
      expect(screen.getByText(/Verified Retail Pharmacy/i)).toBeDefined();

      // Verify stock metrics:
      expect(screen.getByText("Total Stock Items")).toBeDefined();
      expect(screen.getByText("Low Stock Alerts")).toBeDefined();
      expect(screen.getAllByText("Out of Stock").length).toBeGreaterThan(0);

      // Verify inventory table preview
      expect(screen.getByText("Paracetamol 650mg")).toBeDefined();
      expect(screen.getByText("Amoxicillin 500mg")).toBeDefined();
      expect(screen.getByText("Metformin 500mg")).toBeDefined();
    });

    it("1.2 handles profile load error and displays error alert with retry button", async () => {
      const getSpy = vi.spyOn(api, "get").mockRejectedValue(
        new ApiError("Failed to connect to pharmacy profile database", 500, "DATABASE_ERROR")
      );

      render(
        <BrowserRouter>
          <PharmacyDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("Pharmacy Workstation Notice")).toBeDefined();
      });
      expect(
        screen.getByText("Failed to connect to pharmacy profile database")
      ).toBeDefined();

      // Click Retry
      getSpy.mockResolvedValueOnce({ success: true, data: mockPharmacyProfile });
      getSpy.mockResolvedValueOnce({
        success: true,
        data: { items: [], total: 0, page: 1, totalPages: 1 },
      });

      const retryBtn = screen.getByRole("button", { name: /try again/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText("LifeLine Apex Care Chemist")).toBeDefined();
      });
    });

    it("1.3 allows manual sync via refresh button", async () => {
      const getSpy = vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes("/pharmacies/me/profile")) {
          return Promise.resolve({ success: true, data: mockPharmacyProfile });
        }
        return Promise.resolve({
          success: true,
          data: { items: mockInventoryItems, total: 3, page: 1, totalPages: 1 },
        });
      });

      render(
        <BrowserRouter>
          <PharmacyDashboard />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("LifeLine Apex Care Chemist")).toBeDefined();
      });

      const syncBtn = screen.getByRole("button", { name: /sync/i });
      fireEvent.click(syncBtn);

      expect(getSpy).toHaveBeenCalledTimes(4); // 2 on mount + 2 on sync
    });
  });

  // =========================================================================
  // 2. INVENTORY MANAGEMENT TESTS
  // =========================================================================
  describe("Inventory Management (InventoryPage.tsx)", () => {
    it("2.1 renders inventory table with batch numbers, expiry dates, and stock status", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          items: mockInventoryItems,
          total: 3,
          page: 1,
          totalPages: 1,
        },
      });

      render(
        <BrowserRouter>
          <InventoryPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Pharmaceutical Stock & Inventory Manager/i)).toBeDefined();
      });

      expect(screen.getByText("Paracetamol 650mg")).toBeDefined();
      expect(screen.getByText("BATCH-PCM-001")).toBeDefined();
      expect(screen.getByText("BATCH-AMX-002")).toBeDefined();
      expect(screen.getAllByText(/Low Stock/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText("Out of Stock").length).toBeGreaterThan(0);
    });

    it("2.2 supports searching inventory with search input filter", async () => {
      const getSpy = vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          items: [mockInventoryItems[0]],
          total: 1,
          page: 1,
          totalPages: 1,
        },
      });

      render(
        <BrowserRouter>
          <InventoryPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Pharmaceutical Stock & Inventory Manager/i)).toBeDefined();
      });

      const searchInput = screen.getByPlaceholderText(/search medicine name/i);
      fireEvent.change(searchInput, { target: { value: "Paracetamol" } });

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(
          "/pharmacies/me/inventory",
          expect.objectContaining({
            params: expect.objectContaining({ search: "Paracetamol" }),
          })
        );
      });
    });

    it("2.3 allows inline stock editing and updates stock via PATCH /pharmacies/me/inventory/:id", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          items: [mockInventoryItems[0]],
          total: 1,
          page: 1,
          totalPages: 1,
        },
      });

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          ...mockInventoryItems[0],
          quantity: 75,
        },
      });

      render(
        <BrowserRouter>
          <InventoryPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("BATCH-PCM-001")).toBeDefined();
      });

      // Click Edit on Stock cell
      const editStockBtn = screen.getByTestId(`edit-stock-btn-${mockInventoryItems[0]._id}`);
      fireEvent.click(editStockBtn);

      // Change input to 75
      const stockInput = screen.getByTestId(`edit-qty-input-${mockInventoryItems[0]._id}`);
      fireEvent.change(stockInput, { target: { value: "75" } });

      // Save
      const saveBtn = screen.getByTestId(`save-inline-btn-${mockInventoryItems[0]._id}`);
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/pharmacies/me/inventory/${mockInventoryItems[0]._id}`,
          expect.objectContaining({ quantity: 75 })
        );
      });
    });

    it("2.4 allows inline price editing and updates price via PATCH /pharmacies/me/inventory/:id", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: {
          items: [mockInventoryItems[0]],
          total: 1,
          page: 1,
          totalPages: 1,
        },
      });

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          ...mockInventoryItems[0],
          price: 42.0,
        },
      });

      render(
        <BrowserRouter>
          <InventoryPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText("BATCH-PCM-001")).toBeDefined();
      });

      // Click Edit on cell
      const editPriceBtn = screen.getByTestId(`edit-stock-btn-${mockInventoryItems[0]._id}`);
      fireEvent.click(editPriceBtn);

      // Change price input to 42
      const priceInput = screen.getByTestId(`edit-price-input-${mockInventoryItems[0]._id}`);
      fireEvent.change(priceInput, { target: { value: "42.00" } });

      // Save
      const saveBtn = screen.getByTestId(`save-inline-btn-${mockInventoryItems[0]._id}`);
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/pharmacies/me/inventory/${mockInventoryItems[0]._id}`,
          expect.objectContaining({ price: 42 })
        );
      });
    });

    it("2.5 opens 'Add Medicine to Stock' modal and adds new medicine item via POST", async () => {
      vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes("/medicines")) {
          return Promise.resolve({
            success: true,
            data: {
              items: [
                {
                  _id: "64b8e2f01a2b3c4d5e6f7d99",
                  name: "Azithromycin 500mg",
                  genericName: "Azithromycin",
                  dosageForm: "TABLET",
                  strength: "500mg",
                  category: "ANTIBIOTIC",
                  manufacturer: "Cipla",
                },
              ],
            },
          });
        }
        return Promise.resolve({
          success: true,
          data: { items: [], total: 0, page: 1, totalPages: 1 },
        });
      });

      const postSpy = vi.spyOn(api, "post").mockResolvedValue({
        success: true,
        data: {
          _id: "64b8e2f01a2b3c4d5e6f7c99",
          pharmacyId: "64b8e2f01a2b3c4d5e6f7b01",
          medicineId: "64b8e2f01a2b3c4d5e6f7d99",
          batchNumber: "AZ-2024-99",
          expiryDate: "2027-01-01T00:00:00.000Z",
          quantity: 100,
          price: 150.0,
        },
      });

      render(
        <BrowserRouter>
          <InventoryPage />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Pharmaceutical Stock & Inventory Manager/i)).toBeDefined();
      });

      // Open Add Medicine Modal
      const addBtn = screen.getByTestId("open-add-stock-modal-btn");
      fireEvent.click(addBtn);

      expect(screen.getByText(/Add Medicine to Pharmacy Inventory/i)).toBeDefined();

      // Search medicine catalog
      const catalogSearchInput = screen.getByTestId("catalog-search-input");
      fireEvent.change(catalogSearchInput, { target: { value: "Azithromycin" } });

      const findBtn = screen.getByTestId("catalog-search-btn");
      fireEvent.click(findBtn);

      await waitFor(() => {
        expect(screen.getByText("Azithromycin 500mg")).toBeDefined();
      });

      // Select Azithromycin
      const selectBtn = screen.getByTestId("catalog-item-64b8e2f01a2b3c4d5e6f7d99");
      fireEvent.click(selectBtn);

      // Enter stock fields
      const batchInput = screen.getByTestId("add-stock-batch-input");
      fireEvent.change(batchInput, { target: { value: "AZ-2024-99" } });

      const expiryInput = screen.getByTestId("add-stock-expiry-input");
      fireEvent.change(expiryInput, { target: { value: "2027-01-01" } });

      const qtyInput = screen.getByTestId("add-stock-quantity-input");
      fireEvent.change(qtyInput, { target: { value: "100" } });

      const priceInput = screen.getByTestId("add-stock-price-input");
      fireEvent.change(priceInput, { target: { value: "150.00" } });

      // Submit
      const submitBtn = screen.getByTestId("submit-add-stock-btn");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(postSpy).toHaveBeenCalledWith(
          "/pharmacies/me/inventory",
          expect.objectContaining({
            medicineId: "64b8e2f01a2b3c4d5e6f7d99",
            batchNumber: "AZ-2024-99",
            quantity: 100,
            price: 150,
          })
        );
      });
    });
  });

  // =========================================================================
  // 3. ORDER REVIEW & PRESCRIPTION QUEUE TESTS
  // =========================================================================
  describe("Order Review Queue (OrderReviewPage.tsx)", () => {
    it("3.1 rejects invalid order ID format and looks up order by 24-char hex ID", async () => {
      const getSpy = vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes(`/orders/${mockOrder._id}`)) {
          return Promise.resolve({ success: true, data: mockOrder });
        }
        if (url.includes(`/prescriptions/${mockPrescription._id}`)) {
          return Promise.resolve({ success: true, data: mockPrescription });
        }
        return Promise.reject(new Error("Unexpected endpoint"));
      });

      render(
        <BrowserRouter>
          <OrderReviewPage />
        </BrowserRouter>
      );

      const input = screen.getByLabelText(/order id lookup input/i);
      const submitBtn = screen.getByRole("button", { name: /look up order/i });

      // Enter invalid ID
      fireEvent.change(input, { target: { value: "invalid-id-123" } });
      fireEvent.click(submitBtn);

      expect(
        screen.getByText(/invalid order id format\. order ids must be 24-character hexadecimal/i)
      ).toBeDefined();
      expect(getSpy).not.toHaveBeenCalled();

      // Enter valid 24-character ID
      fireEvent.change(input, { target: { value: mockOrder._id } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(getSpy).toHaveBeenCalledWith(`/orders/${mockOrder._id}`);
      });

      // Verify order items snapshot & total breakdown
      await waitFor(() => {
        expect(screen.getByText(`#${mockOrder._id}`)).toBeDefined();
      });
      expect(screen.getAllByText("Amoxicillin 500mg").length).toBeGreaterThan(0);
      expect(screen.getByText("Flat 402, Sunshine Apts, Mumbai, Maharashtra - 400001")).toBeDefined();
      expect(screen.getByText("₹290.00")).toBeDefined();

      // Verify structured digital prescription is loaded
      await waitFor(() => {
        expect(screen.getByText("Acute Bacterial Sinusitis")).toBeDefined();
      });
      expect(screen.getByText(/Cryptographic Integrity Checksum Verified/i)).toBeDefined();
    });

    it("3.2 allows pharmacist to approve prescription via PATCH /orders/:id/prescription-review", async () => {
      vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes(`/orders/${mockOrder._id}`)) {
          return Promise.resolve({ success: true, data: mockOrder });
        }
        if (url.includes(`/prescriptions/${mockPrescription._id}`)) {
          return Promise.resolve({ success: true, data: mockPrescription });
        }
        return Promise.reject(new Error("Unexpected endpoint"));
      });

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          ...mockOrder,
          status: "PHARMACY_ACCEPTED",
          prescriptionReview: {
            decision: "APPROVE",
            reviewedAt: new Date().toISOString(),
          },
        },
      });

      render(
        <BrowserRouter>
          <OrderReviewPage />
        </BrowserRouter>
      );

      const input = screen.getByLabelText(/order id lookup input/i);
      fireEvent.change(input, { target: { value: mockOrder._id } });
      fireEvent.click(screen.getByRole("button", { name: /look up order/i }));

      await waitFor(() => {
        expect(screen.getByText("Pharmacist Verification Required")).toBeDefined();
      });

      const approveBtn = screen.getByRole("button", { name: /approve prescription/i });
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/orders/${mockOrder._id}/prescription-review`,
          { decision: "APPROVE" }
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/prescription verified and approved/i)).toBeDefined();
      });
    });

    it("3.3 requires rejection reason when rejecting prescription via modal", async () => {
      vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes(`/orders/${mockOrder._id}`)) {
          return Promise.resolve({ success: true, data: mockOrder });
        }
        if (url.includes(`/prescriptions/${mockPrescription._id}`)) {
          return Promise.resolve({ success: true, data: mockPrescription });
        }
        return Promise.reject(new Error("Unexpected endpoint"));
      });

      const patchSpy = vi.spyOn(api, "patch").mockResolvedValue({
        success: true,
        data: {
          ...mockOrder,
          status: "REJECTED",
          prescriptionReview: {
            decision: "REJECT",
            rejectionReason: "Contraindicated with patient allergy history",
          },
        },
      });

      render(
        <BrowserRouter>
          <OrderReviewPage />
        </BrowserRouter>
      );

      const input = screen.getByLabelText(/order id lookup input/i);
      fireEvent.change(input, { target: { value: mockOrder._id } });
      fireEvent.click(screen.getByRole("button", { name: /look up order/i }));

      await waitFor(() => {
        expect(screen.getByText("Pharmacist Verification Required")).toBeDefined();
      });

      // Open Rejection Dialog
      const rejectBtn = screen.getByRole("button", { name: /reject prescription\.\.\./i });
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(screen.getByText(/State the clinical reason for rejecting this prescription/i)).toBeDefined();
      });

      // Enter rejection reason
      const textarea = screen.getByLabelText(/clinical rejection reason/i);
      fireEvent.change(textarea, { target: { value: "Contraindicated with patient allergy history" } });

      // Confirm rejection
      const confirmRejectBtn = screen.getByRole("button", { name: /confirm rejection & cancel order/i });
      fireEvent.click(confirmRejectBtn);

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/orders/${mockOrder._id}/prescription-review`,
          {
            decision: "REJECT",
            rejectionReason: "Contraindicated with patient allergy history",
          }
        );
      });
    });

    it("3.4 advances fulfillment state machine and enforces OTP verification for DELIVERED status", async () => {
      const acceptedOrder = {
        ...mockOrder,
        status: "PHARMACY_ACCEPTED" as const,
      };

      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: acceptedOrder,
      });

      const patchSpy = vi.spyOn(api, "patch").mockImplementation((url: string, body: any) => {
        if (url.includes("/status")) {
          return Promise.resolve({
            success: true,
            data: {
              ...acceptedOrder,
              status: body.status,
            },
          });
        }
        return Promise.reject(new Error("Unexpected endpoint"));
      });

      render(
        <BrowserRouter>
          <OrderReviewPage />
        </BrowserRouter>
      );

      const input = screen.getByLabelText(/order id lookup input/i);
      fireEvent.change(input, { target: { value: mockOrder._id } });
      fireEvent.click(screen.getByRole("button", { name: /look up order/i }));

      await waitFor(() => {
        expect(screen.getByText("Start Preparing Order")).toBeDefined();
      });

      // Transition PHARMACY_ACCEPTED -> PREPARING
      fireEvent.click(screen.getByRole("button", { name: /start preparing order/i }));

      await waitFor(() => {
        expect(patchSpy).toHaveBeenCalledWith(
          `/orders/${mockOrder._id}/status`,
          { status: "PREPARING" }
        );
      });
    });

    it("3.5 opens pre-signed medical record attachment viewer with zoom controls", async () => {
      vi.spyOn(api, "get").mockImplementation((url: string) => {
        if (url.includes(`/orders/${mockOrder._id}`)) {
          return Promise.resolve({ success: true, data: mockOrder });
        }
        if (url.includes(`/prescriptions/${mockPrescription._id}`)) {
          return Promise.resolve({ success: true, data: mockPrescription });
        }
        if (url.includes("/medical-records/")) {
          return Promise.resolve({
            success: true,
            data: {
              downloadUrl: "https://cloud-storage.lifeline.org/secure-record.png?signature=xyz",
              expiresInSeconds: 900,
              recordId: mockPrescription._id,
              fileName: "signed-prescription-scan.png",
              fileType: "image/png",
              sizeBytes: 102400,
            },
          });
        }
        return Promise.reject(new Error("Unexpected endpoint"));
      });

      render(
        <BrowserRouter>
          <OrderReviewPage />
        </BrowserRouter>
      );

      const input = screen.getByLabelText(/order id lookup input/i);
      fireEvent.change(input, { target: { value: mockOrder._id } });
      fireEvent.click(screen.getByRole("button", { name: /look up order/i }));

      await waitFor(() => {
        expect(screen.getByText("View Digital Record Attachment")).toBeDefined();
      });

      // Click View Attachment
      fireEvent.click(screen.getByRole("button", { name: /view digital record attachment/i }));

      await waitFor(() => {
        expect(screen.getByText("signed-prescription-scan.png")).toBeDefined();
      });
      expect(screen.getByAltText("Clinical attachment")).toBeDefined();
      expect(screen.getByText("100%")).toBeDefined();

      // Test Zoom Controls
      const zoomInBtn = screen.getByRole("button", { name: /zoom in/i });
      fireEvent.click(zoomInBtn);
      expect(screen.getByText("125%")).toBeDefined();

      const zoomOutBtn = screen.getByRole("button", { name: /zoom out/i });
      fireEvent.click(zoomOutBtn);
      expect(screen.getByText("100%")).toBeDefined();
    });
  });

  // =========================================================================
  // 4. ROLE AUTHORIZATION & ROUTE GUARD TESTS
  // =========================================================================
  describe("Pharmacy Route Authorization", () => {
    it("4.1 redirects non-pharmacy roles away from pharmacy routes", async () => {
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
        <MemoryRouter initialEntries={["/pharmacy/inventory"]}>
          <AppRoutes />
        </MemoryRouter>
      );

      // Patient should be redirected to /patient/dashboard
      await waitFor(() => {
        expect(screen.getAllByText(/Patient Portal/i).length).toBeGreaterThan(0);
      });
    });

    it("4.2 allows authenticated PHARMACY role to access /pharmacy/inventory and /pharmacy/orders", async () => {
      vi.spyOn(api, "get").mockResolvedValue({
        success: true,
        data: { items: [], total: 0, page: 1, totalPages: 1 },
      });

      render(
        <MemoryRouter initialEntries={["/pharmacy/inventory"]}>
          <AppRoutes />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/Pharmaceutical Stock & Inventory Manager/i)).toBeDefined();
      });
    });
  });
});
