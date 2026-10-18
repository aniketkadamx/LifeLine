import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { render, screen, cleanup, act } from "@testing-library/react";

import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

import { useAuthStore } from "../stores/auth.store";
import { api, silentRefreshToken, setOnAuthFailure, ApiError } from "../services/api";
import { ProtectedRoute, PublicRoute } from "../routes/ProtectedRoute";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { Card, CardHeader, CardTitle, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../components/ui/table";
import { EmptyState, ErrorAlert } from "../components/ui/feedback-states";
import type { AuthUser } from "../types/auth";

describe("Milestone 13 - Task 13.1: Frontend Design System, Shell Layouts & Routing", () => {
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
    setOnAuthFailure(null);
    useAuthStore.getState().logout();
  });

  // =========================================================================
  // SECTION 1: Route Protection & Destination Preservation
  // =========================================================================
  describe("1. Route Protection & Role Redirection", () => {
    it("1. unauthenticated protected-route access redirects to /login", () => {
      render(
        <MemoryRouter initialEntries={["/patient/dashboard"]}>
          <Routes>
            <Route
              path="/patient/dashboard"
              element={
                <ProtectedRoute allowedRoles={["PATIENT"]}>
                  <div>Secret Patient Dashboard</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>Login Page Screen</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByText("Secret Patient Dashboard")).toBeNull();
      expect(screen.getByText("Login Page Screen")).toBeDefined();
    });

    it("2. preserves the requested destination in router location state", () => {
      let preservedPath = "";

      function LoginInspector() {
        const location = useLocation();
        preservedPath = (location.state as any)?.from?.pathname;
        return <div>Login Inspector: {preservedPath}</div>;
      }

      render(
        <MemoryRouter initialEntries={["/patient/medical-records"]}>
          <Routes>
            <Route
              path="/patient/medical-records"
              element={
                <ProtectedRoute allowedRoles={["PATIENT"]}>
                  <div>Records</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<LoginInspector />} />
          </Routes>
        </MemoryRouter>
      );

      expect(preservedPath).toBe("/patient/medical-records");
      expect(screen.getByText("Login Inspector: /patient/medical-records")).toBeDefined();
    });


    it("3. role mismatch redirects authenticated users to their own role dashboard", () => {
      // Authenticate as a PATIENT
      const patientUser: AuthUser = {
        id: "p_1",
        fullName: "Alice Patient",
        email: "alice@lifeline.org",
        role: "PATIENT",
        status: "ACTIVE",
      };
      useAuthStore.getState().login(patientUser, "token_patient");

      render(
        <MemoryRouter initialEntries={["/doctor/dashboard"]}>
          <Routes>
            {/* Doctor route that Patient is attempting to enter */}
            <Route
              path="/doctor/dashboard"
              element={
                <ProtectedRoute allowedRoles={["DOCTOR"]}>
                  <div>Doctor Portal Screen</div>
                </ProtectedRoute>
              }
            />
            {/* Patient's own dashboard */}
            <Route
              path="/patient/dashboard"
              element={<div>Alice's Patient Dashboard</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByText("Doctor Portal Screen")).toBeNull();
      expect(screen.getByText("Alice's Patient Dashboard")).toBeDefined();
    });

    it("4. authenticated users visiting /login or /register are redirected to their dashboard", () => {
      const doctorUser: AuthUser = {
        id: "doc_1",
        fullName: "Dr. House",
        email: "greg@lifeline.org",
        role: "DOCTOR",
        status: "ACTIVE",
      };
      useAuthStore.getState().login(doctorUser, "token_doc");

      render(
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicRoute>
                  <div>Public Login Screen</div>
                </PublicRoute>
              }
            />
            <Route
              path="/doctor/dashboard"
              element={<div>Dr. House Workspace</div>}
            />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.queryByText("Public Login Screen")).toBeNull();
      expect(screen.getByText("Dr. House Workspace")).toBeDefined();
    });
  });

  // =========================================================================
  // SECTION 2: API Client, Bearer Tokens & Silent Refresh
  // =========================================================================
  describe("2. API Client, Bearer Tokens & Silent Refresh", () => {
    it("5. attaches the current in-memory access token as Authorization: Bearer", async () => {
      const testUser: AuthUser = {
        id: "u_1",
        fullName: "John Doe",
        email: "john@lifeline.org",
        role: "PATIENT",
      };
      useAuthStore.getState().login(testUser, "secret_access_jwt_xyz");

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: { status: "ok" } }),
      });
      global.fetch = mockFetch;

      await api.get("/users/me");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callOptions = mockFetch.mock.calls[0][1];
      const authHeader = callOptions.headers.get("Authorization");
      expect(authHeader).toBe("Bearer secret_access_jwt_xyz");
    });

    it("6. performs successful silent refresh and re是可以 request replay on HTTP 401", async () => {
      useAuthStore.getState().login(
        { id: "u_1", fullName: "User", email: "u@test.org", role: "PATIENT" },
        "expired_jwt_token"
      );

      let requestCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        requestCount++;

        // Initial call: 401 expired
        if (url.includes("/patient/records") && requestCount === 1) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ error: { code: "AUTH_TOKEN_EXPIRED" } }),
          });
        }

        // Silent refresh call
        if (url.includes("/auth/refresh-token")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              success: true,
              data: {
                accessToken: "new_refreshed_jwt_token_999",
                user: { id: "u_1", role: "PATIENT" },
              },
            }),
          });
        }

        // Replayed original call with fresh token
        if (url.includes("/patient/records") && requestCount === 3) {
          const authHeader = (init?.headers as Headers).get("Authorization");
          expect(authHeader).toBe("Bearer new_refreshed_jwt_token_999");

          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              success: true,
              data: [{ id: "record-123", diagnosis: "Healthy" }],
            }),
          });
        }

        return Promise.reject(new Error("Unexpected endpoint call: " + url));
      });

      const res = await api.get("/patient/records");

      expect(res.data).toEqual([{ id: "record-123", diagnosis: "Healthy" }]);
      expect(useAuthStore.getState().accessToken).toBe("new_refreshed_jwt_token_999");
      expect(requestCount).toBe(3); // 1. Original 401 -> 2. Refresh -> 3. Replay
    });

    it("7. coalesces multiple simultaneous 401 responses into a single refresh operation", async () => {
      useAuthStore.getState().login(
        { id: "u_1", fullName: "User", email: "u@test.org", role: "PATIENT" },
        "expired_token_abc"
      );

      let refreshCalls = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/refresh-token")) {
          refreshCalls++;
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                headers: new Headers({ "content-type": "application/json" }),
                json: async () => ({
                  success: true,
                  data: {
                    accessToken: "coalesced_token_555",
                    user: { id: "u_1", role: "PATIENT" },
                  },
                }),
              });
            }, 20);
          });
        }

        // Return 401 first, then 200 on replay
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: { code: "AUTH_TOKEN_EXPIRED" } }),
        });
      });

      // Fire 3 simultaneous requests to trigger refresh
      const [token1, token2, token3] = await Promise.all([
        silentRefreshToken(),
        silentRefreshToken(),
        silentRefreshToken(),
      ]);

      expect(refreshCalls).toBe(1); // Single coalesced refresh!
      expect(token1).toBe("coalesced_token_555");
      expect(token2).toBe("coalesced_token_555");
      expect(token3).toBe("coalesced_token_555");
    });

    it("8. clears authentication state and triggers auth failure handler when refresh fails", async () => {
      const authFailureSpy = vi.fn();
      setOnAuthFailure(authFailureSpy);

      useAuthStore.getState().login(
        { id: "u_1", fullName: "User", email: "u@test.org", role: "PATIENT" },
        "invalid_token"
      );

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/refresh-token")) {
          return Promise.resolve({
            ok: false,
            status: 401,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({ error: { code: "AUTH_REFRESH_TOKEN_EXPIRED" } }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: { code: "AUTH_TOKEN_EXPIRED" } }),
        });
      });

      await expect(api.get("/protected-resource")).rejects.toThrow(ApiError);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(authFailureSpy).toHaveBeenCalledTimes(1);
    });

    it("9. retried request failing with 401 does not cause an infinite refresh loop", async () => {
      useAuthStore.getState().login(
        { id: "u_1", fullName: "User", email: "u@test.org", role: "PATIENT" },
        "token_1"
      );

      let refreshCount = 0;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/refresh-token")) {
          refreshCount++;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => ({
              data: { accessToken: "token_2", user: { id: "u_1", role: "PATIENT" } },
            }),
          });
        }

        // Endpoint continuously returns 401 even after retry
        return Promise.resolve({
          ok: false,
          status: 401,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ error: { code: "UNAUTHORIZED_PERMANENT" } }),
        });
      });

      await expect(api.get("/failing-route")).rejects.toThrow(ApiError);
      // Refresh should be attempted only ONCE, avoiding infinite loop
      expect(refreshCount).toBe(1);
    });

    it("10. logout racing with an outstanding refresh response never restores session", async () => {
      useAuthStore.getState().login(
        { id: "u_1", fullName: "User", email: "u@test.org", role: "PATIENT" },
        "token_pre_logout"
      );

      // Refresh takes 30ms to resolve
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/auth/refresh-token")) {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 200,
                headers: new Headers({ "content-type": "application/json" }),
                json: async () => ({
                  data: { accessToken: "late_token_after_logout", user: { id: "u_1" } },
                }),
              });
            }, 30);
          });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      // Launch refresh in-flight
      const refreshCall = silentRefreshToken();

      // Immediately log out while refresh is in-flight!
      useAuthStore.getState().logout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);

      // Wait for late refresh to complete
      const result = await refreshCall;

      // The late refresh must be discarded; session must NOT be restored!
      expect(result).toBeNull();
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("11. access tokens and session data are strictly never persisted in browser storage", () => {
      const user: AuthUser = {
        id: "usr_secure_99",
        fullName: "Secure User",
        email: "secure@lifeline.org",
        role: "DOCTOR",
      };
      useAuthStore.getState().login(user, "top_secret_jwt_payload_999");

      // Verify localStorage is completely empty of tokens
      expect(window.localStorage.getItem("accessToken")).toBeNull();
      expect(window.localStorage.getItem("token")).toBeNull();
      expect(window.localStorage.getItem("auth-storage")).toBeNull();
      expect(JSON.stringify(window.localStorage)).not.toContain("top_secret_jwt_payload_999");

      // Verify sessionStorage is completely empty
      expect(window.sessionStorage.getItem("accessToken")).toBeNull();
      expect(JSON.stringify(window.sessionStorage)).not.toContain("top_secret_jwt_payload_999");
    });
  });

  // =========================================================================
  // SECTION 3: Global Layouts & UI Primitives
  // =========================================================================
  describe("3. Global Layouts & Design System Primitives", () => {
    it("12. renders AppLayout with role navigation, active badges, and logout action", async () => {
      const adminUser: AuthUser = {
        id: "adm_1",
        fullName: "Super Admin",
        email: "admin@lifeline.org",
        role: "ADMIN",
      };
      useAuthStore.getState().login(adminUser, "token_admin");

      await act(async () => {
        render(
          <MemoryRouter initialEntries={["/admin/dashboard"]}>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/admin/dashboard" element={<div>Admin Workspace Content</div>} />
              </Route>
            </Routes>
          </MemoryRouter>
        );
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(screen.getByText("LifeLine")).toBeDefined();
      expect(screen.getByText("ADMIN Portal")).toBeDefined();
      expect(screen.getByText("Provider Verification")).toBeDefined();
      expect(screen.getByText("Admin Workspace Content")).toBeDefined();
      expect(screen.getByRole("button", { name: /log out/i })).toBeDefined();
    });

    it("13. renders AuthLayout with HIPAA compliance badge and centered shell", () => {
      render(
        <MemoryRouter>
          <Routes>
            <Route element={<AuthLayout />}>
              <Route path="/" element={<div>Auth Form Child Content</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText("HIPAA & FHIR Ready Platform")).toBeDefined();
      expect(screen.getByText("Auth Form Child Content")).toBeDefined();
    });

    it("14. renders core UI components (Card, Badge, Button, Table, Feedback States)", () => {
      render(
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Test Card Title</CardTitle>
            </CardHeader>
            <CardContent>Test Content</CardContent>
          </Card>

          <Badge variant="doctor">Doctor Role Badge</Badge>
          <Badge variant="patient">Patient Role Badge</Badge>
          <Button variant="default">Primary Action</Button>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Header Col</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Cell Value</TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <EmptyState title="No Records Found" description="Try adjusting search" />
          <ErrorAlert title="Network Timeout" message="Server connection timed out" />
        </div>
      );

      expect(screen.getByText("Test Card Title")).toBeDefined();
      expect(screen.getByText("Doctor Role Badge")).toBeDefined();
      expect(screen.getByText("Patient Role Badge")).toBeDefined();
      expect(screen.getByText("Header Col")).toBeDefined();
      expect(screen.getByText("Cell Value")).toBeDefined();
      expect(screen.getByText("No Records Found")).toBeDefined();
      expect(screen.getByText("Network Timeout")).toBeDefined();
    });
  });
});
