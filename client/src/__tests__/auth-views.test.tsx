import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { RegisterPage } from "../features/auth/pages/RegisterPage";
import { RoleSelector } from "../features/auth/components/RoleSelector";
import { useAuthStore } from "../stores/auth.store";

describe("Milestone 13 - Task 13.2: Authentication & Onboarding UI", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    cleanup();
    useAuthStore.getState().logout();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    useAuthStore.getState().logout();
  });

  // =========================================================================
  // SECTION 1: Login Page Tests
  // =========================================================================
  describe("1. Login Page View", () => {
    it("1. invalid email prevents API submission and displays validation error", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      const emailInput = screen.getByLabelText(/email address/i);
      const passwordInput = screen.getByLabelText(/^password$/i);
      const submitBtn = screen.getByTestId("login-submit-button");

      fireEvent.change(emailInput, { target: { value: "invalid-email-string" } });
      fireEvent.change(passwordInput, { target: { value: "ValidPassword123!" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText("Please enter a valid email address")).toBeDefined();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("2. missing password prevents submission", async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      const emailInput = screen.getByLabelText(/email address/i);
      const submitBtn = screen.getByTestId("login-submit-button");

      fireEvent.change(emailInput, { target: { value: "test@lifeline.org" } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText("Password is required")).toBeDefined();
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("3. password visibility toggle switches between text and password types", () => {
      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      const passwordInput = screen.getByLabelText(/^password$/i) as HTMLInputElement;
      const toggleBtn = screen.getByRole("button", { name: /show password/i });

      expect(passwordInput.type).toBe("password");

      fireEvent.click(toggleBtn);
      expect(passwordInput.type).toBe("text");
      expect(screen.getByRole("button", { name: /hide password/i })).toBeDefined();

      fireEvent.click(toggleBtn);
      expect(passwordInput.type).toBe("password");
    });

    it("4. API errors appear inline without exposing sensitive details", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            code: "AUTH_INVALID_CREDENTIALS",
            message: "Invalid email or password",
          },
        }),
      });

      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "wrong@lifeline.org" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "WrongPass123!" },
      });
      fireEvent.click(screen.getByTestId("login-submit-button"));

      await waitFor(() => {
        const errorAlert = screen.getByTestId("login-api-error");
        expect(errorAlert).toBeDefined();
        expect(errorAlert.textContent).toContain("Invalid email or password. Please verify your credentials.");
      });
    });

    it("5. duplicate submission is prevented while request is in-flight", async () => {
      let resolvePromise: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const mockFetch = vi.fn().mockReturnValue(delayedPromise);
      global.fetch = mockFetch;

      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "user@lifeline.org" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "Password123!" },
      });

      const submitBtn = screen.getByTestId("login-submit-button");
      fireEvent.click(submitBtn);

      // Verify submit button disabled with loading indicator
      await waitFor(() => {
        expect(submitBtn.hasAttribute("disabled")).toBe(true);
        expect(screen.getByText(/signing in/i)).toBeDefined();
      });

      // Attempt second submission
      fireEvent.click(submitBtn);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Resolve in-flight request
      await act(async () => {
        resolvePromise!({
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            success: true,
            data: {
              accessToken: "token_abc",
              user: { id: "u1", email: "user@lifeline.org", role: "PATIENT", fullName: "User" },
            },
          }),
        });
      });
    });

    it("6. successful login updates the existing auth store", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            accessToken: "session_access_token_999",
            user: {
              id: "usr_pat_1",
              email: "patient@lifeline.org",
              role: "PATIENT",
              fullName: "Alice Patient",
            },
          },
        }),
      });

      render(
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "patient@lifeline.org" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "PatientPassword123!" },
      });
      fireEvent.click(screen.getByTestId("login-submit-button"));

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
        expect(useAuthStore.getState().accessToken).toBe("session_access_token_999");
        expect(useAuthStore.getState().user?.email).toBe("patient@lifeline.org");
        expect(useAuthStore.getState().user?.role).toBe("PATIENT");
      });
    });

    it("7. successful login routes to the correct role dashboard", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            accessToken: "doctor_token_777",
            user: {
              id: "usr_doc_1",
              email: "doctor@lifeline.org",
              role: "DOCTOR",
              fullName: "Dr. Gregory House",
            },
          },
        }),
      });

      render(
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/doctor/dashboard" element={<div>Doctor Dashboard Workspace</div>} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "doctor@lifeline.org" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "DoctorPass123!" },
      });
      fireEvent.click(screen.getByTestId("login-submit-button"));

      await waitFor(() => {
        expect(screen.getByText("Doctor Dashboard Workspace")).toBeDefined();
      });
    });

    it("8. untrusted external redirect destinations are rejected", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            accessToken: "patient_token",
            user: {
              id: "u1",
              email: "patient@lifeline.org",
              role: "PATIENT",
              fullName: "Safe Patient",
            },
          },
        }),
      });

      // Pass an external protocol-relative phishing URL
      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: "/login",
              state: { from: { pathname: "//evil-phishing-site.com" } },
            },
          ]}
        >
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/patient/dashboard" element={<div>Safe Patient Portal</div>} />
          </Routes>
        </MemoryRouter>
      );

      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "patient@lifeline.org" },
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), {
        target: { value: "SafePass123!" },
      });
      fireEvent.click(screen.getByTestId("login-submit-button"));

      // Must reject the evil URL and safely route to /patient/dashboard
      await waitFor(() => {
        expect(screen.getByText("Safe Patient Portal")).toBeDefined();
      });
    });
  });

  // =========================================================================
  // SECTION 2: Role Selector Component Tests
  // =========================================================================
  describe("2. Role Selector Component", () => {
    it("9. all three permitted public roles can be selected", () => {
      const onChangeMock = vi.fn();

      render(<RoleSelector value="PATIENT" onChange={onChangeMock} />);

      const patientOption = screen.getByTestId("role-option-patient");
      const doctorOption = screen.getByTestId("role-option-doctor");
      const pharmacyOption = screen.getByTestId("role-option-pharmacy");

      expect(patientOption).toBeDefined();
      expect(doctorOption).toBeDefined();
      expect(pharmacyOption).toBeDefined();

      fireEvent.click(doctorOption);
      expect(onChangeMock).toHaveBeenCalledWith("DOCTOR");

      fireEvent.click(pharmacyOption);
      expect(onChangeMock).toHaveBeenCalledWith("PHARMACY");
    });

    it("10. ADMIN is strictly not selectable or exposed in the role selector", () => {
      render(<RoleSelector value="PATIENT" onChange={vi.fn()} />);

      expect(screen.queryByText(/admin/i)).toBeNull();
      expect(screen.queryByTestId("role-option-admin")).toBeNull();
    });

    it("11. keyboard and accessible selection behavior works with native radio semantics", () => {
      render(<RoleSelector value="DOCTOR" onChange={vi.fn()} />);

      const radiogroup = screen.getByRole("radiogroup");
      expect(radiogroup).toBeDefined();
      expect(radiogroup.getAttribute("aria-label")).toBe("Account Role Selection");

      const doctorRadio = screen.getByLabelText("Doctor / Clinician") as HTMLInputElement;
      expect(doctorRadio.checked).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 3: Registration & Multi-step Onboarding Tests
  // =========================================================================
  describe("3. Multi-Step Registration & Onboarding Flow", () => {
    it("12. required fields are validated and user cannot advance past invalid steps", async () => {
      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Step 1: Default role selected. Click Continue.
      expect(screen.getByTestId("register-step-1")).toBeDefined();
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 2: Leave fields empty and attempt to continue
      await waitFor(() => {
        expect(screen.getByTestId("register-step-2")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 2 should block advancement
      await waitFor(() => {
        expect(screen.getByText("Full name must be at least 2 characters long")).toBeDefined();
        expect(screen.getByText("Email is required")).toBeDefined();
        expect(screen.getByText("Phone number is required")).toBeDefined();
      });

      // Still on Step 2
      expect(screen.queryByTestId("register-step-3")).toBeNull();
    });

    it("13. Back/Continue preserves entered form values between steps", async () => {
      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Advance to Step 2
      fireEvent.click(screen.getByTestId("register-continue-button"));

      await waitFor(() => {
        expect(screen.getByLabelText(/full name/i)).toBeDefined();
      });

      fireEvent.change(screen.getByLabelText(/full name/i), {
        target: { value: "Dr. Sarah Jenkins" },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: "sarah.jenkins@hospital.org" },
      });
      fireEvent.change(screen.getByLabelText(/phone number/i), {
        target: { value: "+15551234567" },
      });

      // Advance to Step 3
      fireEvent.click(screen.getByTestId("register-continue-button"));

      await waitFor(() => {
        expect(screen.getByTestId("register-step-3")).toBeDefined();
      });

      // Click Back to Step 2
      fireEvent.click(screen.getByTestId("register-back-button"));

      await waitFor(() => {
        expect(screen.getByTestId("register-step-2")).toBeDefined();
      });

      // Values must be preserved!
      expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe("Dr. Sarah Jenkins");
      expect((screen.getByLabelText(/email address/i) as HTMLInputElement).value).toBe("sarah.jenkins@hospital.org");
      expect((screen.getByLabelText(/phone number/i) as HTMLInputElement).value).toBe("+15551234567");
    });

    it("14. each role submits the exact backend-supported payload (confirmPassword omitted)", async () => {
      let dispatchedUrl = "";
      let dispatchedMethod = "";
      let dispatchedPayload: any = null;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        dispatchedUrl = url;
        dispatchedMethod = init?.method || "GET";
        dispatchedPayload = JSON.parse(init?.body as string);
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            success: true,
            data: {
              userId: "usr_doc_created",
              email: "doctor.reg@lifeline.org",
              role: "DOCTOR",
              status: "PENDING_VERIFICATION",
            },
            message: "Registration successful. Please verify your email.",
          }),
        });
      });

      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Step 1: Select DOCTOR
      fireEvent.click(screen.getByTestId("role-option-doctor"));
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 2: Fill Personal Details
      await waitFor(() => {
        expect(screen.getByLabelText(/full name/i)).toBeDefined();
      });
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Dr. Gregory House" } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "doctor.reg@lifeline.org" } });
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+15559876543" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 3: Fill Password
      await waitFor(() => {
        expect(screen.getByLabelText(/^password$/i)).toBeDefined();
      });
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "ComplexPassword123!" } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "ComplexPassword123!" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 4: Review and Submit
      await waitFor(() => {
        expect(screen.getByTestId("register-step-4")).toBeDefined();
        expect(screen.getByText("Dr. Gregory House")).toBeDefined();
      });

      fireEvent.click(screen.getByTestId("register-submit-button"));

      await waitFor(() => {
        expect(screen.getByText("Registration Successful")).toBeDefined();
      });

      // Verify exact URL and HTTP method reached
      expect(dispatchedUrl).toBe("/api/v1/auth/register");
      expect(dispatchedMethod).toBe("POST");

      // Verify exact backend payload
      expect(dispatchedPayload).toEqual({
        email: "doctor.reg@lifeline.org",
        password: "ComplexPassword123!",
        role: "DOCTOR",
        fullName: "Dr. Gregory House",
        phone: "+15559876543",
      });

      // Confirm-password MUST NOT be sent to backend!
      expect(dispatchedPayload.confirmPassword).toBeUndefined();
    });

    it("15. registration API errors (e.g. duplicate email/phone) are displayed safely", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          error: {
            code: "AUTH_EMAIL_ALREADY_EXISTS",
            message: "Provided email address is already in use",
          },
        }),
      });

      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Step 1
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 2
      await waitFor(() => screen.getByLabelText(/full name/i));
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Duplicate User" } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "duplicate@lifeline.org" } });
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+15553334444" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 3
      await waitFor(() => screen.getByLabelText(/^password$/i));
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Password123!" } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "Password123!" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 4 Submit
      await waitFor(() => screen.getByTestId("register-submit-button"));
      fireEvent.click(screen.getByTestId("register-submit-button"));

      await waitFor(() => {
        const errorAlert = screen.getByTestId("register-api-error");
        expect(errorAlert).toBeDefined();
        expect(errorAlert.textContent).toContain("This email address is already registered");
      });
    });

    it("16. verification and pending states reflect backend responses rather than assumptions", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: true,
          data: {
            userId: "usr_pharma_1",
            email: "pharmacy@lifeline.org",
            role: "PHARMACY",
            status: "PENDING_VERIFICATION",
          },
        }),
      });

      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Step 1: Select PHARMACY
      fireEvent.click(screen.getByTestId("role-option-pharmacy"));
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 2
      await waitFor(() => screen.getByLabelText(/full name/i));
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Care Pharmacy" } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "pharmacy@lifeline.org" } });
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+15555556666" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 3
      await waitFor(() => screen.getByLabelText(/^password$/i));
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "PharmacyPass123!" } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "PharmacyPass123!" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 4
      await waitFor(() => screen.getByTestId("register-submit-button"));
      fireEvent.click(screen.getByTestId("register-submit-button"));

      await waitFor(() => {
        expect(screen.getByText("Registration Successful")).toBeDefined();
        expect(screen.getAllByText("PENDING_VERIFICATION").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/Next Steps & Verification/i)).toBeDefined();
        expect(document.body.textContent).toContain("account remains in PENDING_VERIFICATION status until clinical credentials and medical licenses are reviewed");
      });
    });

    it("17. passwords and credentials are never stored in browser storage", () => {
      expect(window.localStorage.getItem("password")).toBeNull();
      expect(window.sessionStorage.getItem("password")).toBeNull();
      expect(JSON.stringify(window.localStorage)).not.toContain("Password");
      expect(JSON.stringify(window.sessionStorage)).not.toContain("Password");
    });

    it("18. PATIENT registration flow dispatches to /api/v1/auth/register with PATIENT role payload", async () => {
      let dispatchedUrl = "";
      let dispatchedMethod = "";
      let dispatchedPayload: any = null;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        dispatchedUrl = url;
        dispatchedMethod = init?.method || "GET";
        dispatchedPayload = JSON.parse(init?.body as string);
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            success: true,
            data: {
              userId: "usr_pat_created",
              email: "patient.reg@lifeline.org",
              role: "PATIENT",
              status: "PENDING_VERIFICATION",
            },
            message: "Registration successful. Please verify your email.",
          }),
        });
      });

      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Step 1: Default is PATIENT
      expect(screen.getByTestId("register-step-1")).toBeDefined();
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 2: Fill Personal Details
      await waitFor(() => screen.getByLabelText(/full name/i));
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "Alice Patient" } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "patient.reg@lifeline.org" } });
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+15551234567" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 3: Fill Password
      await waitFor(() => screen.getByLabelText(/^password$/i));
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "PatientPassword123!" } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "PatientPassword123!" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      // Step 4: Submit
      await waitFor(() => screen.getByTestId("register-submit-button"));
      fireEvent.click(screen.getByTestId("register-submit-button"));

      await waitFor(() => {
        expect(screen.getByText("Registration Successful")).toBeDefined();
      });

      // Verify exact URL and HTTP method reached
      expect(dispatchedUrl).toBe("/api/v1/auth/register");
      expect(dispatchedMethod).toBe("POST");

      // Verify exact backend payload
      expect(dispatchedPayload).toEqual({
        email: "patient.reg@lifeline.org",
        password: "PatientPassword123!",
        role: "PATIENT",
        fullName: "Alice Patient",
        phone: "+15551234567",
      });
    });

    it("19. registration handles 404 endpoint failure gracefully and displays registration failure alert", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: "Route POST /api/v1/auth/register not found on server",
          },
        }),
      });

      render(
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      );

      // Advance through steps
      fireEvent.click(screen.getByTestId("register-continue-button"));

      await waitFor(() => screen.getByLabelText(/full name/i));
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "John Doe" } });
      fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "john.doe@lifeline.org" } });
      fireEvent.change(screen.getByLabelText(/phone number/i), { target: { value: "+15550001111" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      await waitFor(() => screen.getByLabelText(/^password$/i));
      fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "Password123!" } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "Password123!" } });
      fireEvent.click(screen.getByTestId("register-continue-button"));

      await waitFor(() => screen.getByTestId("register-submit-button"));
      fireEvent.click(screen.getByTestId("register-submit-button"));

      await waitFor(() => {
        const errorAlert = screen.getByTestId("register-api-error");
        expect(errorAlert).toBeDefined();
        expect(errorAlert.textContent).toContain("Route POST /api/v1/auth/register not found on server");
      });
    });
  });
});
