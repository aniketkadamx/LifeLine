import { Routes, Route, Link } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { ProtectedRoute, PublicRoute } from "./ProtectedRoute";
import { LoginPage } from "../features/auth/pages/LoginPage";
import { RegisterPage } from "../features/auth/pages/RegisterPage";
import { PatientDashboard } from "../features/patients/pages/PatientDashboard";
import { DoctorSearchPage } from "../features/doctors/pages/DoctorSearchPage";
import { RecordsPage } from "../features/medical-records/pages/RecordsPage";
import { PatientOrdersPage } from "../features/orders/pages/PatientOrdersPage";
import { DoctorDashboard } from "../features/doctors/pages/DoctorDashboard";
import { AvailabilitySettingsPage } from "../features/doctors/pages/AvailabilitySettingsPage";
import { DoctorAppointmentsPage } from "../features/doctors/pages/DoctorAppointmentsPage";
import { useAuthStore } from "../stores/auth.store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Activity, ArrowRight, UserCheck } from "lucide-react";
import type { UserRole } from "../types/auth";

/**
 * Lightweight placeholder for Landing Page in Task 13.1 foundation.
 */
function LandingPage() {
  const { user, isAuthenticated } = useAuthStore();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background flex flex-col justify-center items-center p-6 text-center">
      <div className="max-w-2xl w-full bg-card rounded-2xl shadow-sm border border-border p-8 space-y-6">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-xs">
          <Activity className="size-8" />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            LifeLine Healthcare Platform
          </h1>
          <p className="mt-2 text-muted-foreground text-sm max-w-md mx-auto">
            Secure, interconnected digital healthcare and telemedicine network connecting patients, clinicians, and pharmacies.
          </p>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          {isAuthenticated && user ? (
            <Link to={`/${user.role.toLowerCase()}/dashboard`}>
              <Button className="w-full sm:w-auto">
                Go to {user.role} Dashboard
                <ArrowRight className="size-4 ml-1.5" />
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/login">
                <Button className="w-full sm:w-auto">Sign In</Button>
              </Link>
              <Link to="/register">
                <Button variant="outline" className="w-full sm:w-auto">
                  Create Account
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


/**
 * Generic placeholder component for role dashboards.
 */
function RoleDashboardPlaceholder({ role }: { role: UserRole }) {
  const { user } = useAuthStore();

  return (
    <div className="space-y-6" data-testid={`${role.toLowerCase()}-dashboard`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {role} Workspace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Welcome back, {user?.fullName || user?.email}. LifeLine {role} portal session active.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={role.toLowerCase() as "patient" | "doctor" | "pharmacy" | "admin"}
            className="uppercase tracking-wider"
          >
            {role} Active
          </Badge>
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-800">
            <UserCheck className="size-3.5" />
            Verified
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Role Portal Shell Initialized</CardTitle>
          <CardDescription>
            Foundation layout, route guard, and in-memory authorization confirmed for {role}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Business views, data tables, booking wizards, and clinical modules will be populated in upcoming milestone tasks (Tasks 13.3 - 13.7).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Accessible 404 Not Found Page.
 */
function NotFoundPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-4">
        <div className="text-6xl font-extrabold text-primary">404</div>
        <h2 className="text-2xl font-bold text-foreground">Page Not Found</h2>
        <p className="text-sm text-muted-foreground">
          The requested page or healthcare portal resource does not exist.
        </p>
        <div className="pt-2">
          <Link to="/">
            <Button>Return to Home</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Root Router Tree for LifeLine Frontend.
 */
export function AppRoutes() {
  return (
    <Routes>
      {/* Public Landing */}
      <Route path="/" element={<LandingPage />} />

      {/* Public Authentication Shell (Redirects if already authenticated) */}
      <Route element={<AuthLayout />}>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicRoute>
              <RegisterPage />
            </PublicRoute>
          }
        />
      </Route>

      {/* Protected Healthcare Role Routes (Rendered inside responsive AppLayout) */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        {/* PATIENT Portal Branch */}
        <Route
          path="/patient/dashboard"
          element={
            <ProtectedRoute allowedRoles={["PATIENT"]}>
              <PatientDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/doctors"
          element={
            <ProtectedRoute allowedRoles={["PATIENT"]}>
              <DoctorSearchPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/medical-records"
          element={
            <ProtectedRoute allowedRoles={["PATIENT"]}>
              <RecordsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/orders"
          element={
            <ProtectedRoute allowedRoles={["PATIENT"]}>
              <PatientOrdersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/*"
          element={
            <ProtectedRoute allowedRoles={["PATIENT"]}>
              <PatientDashboard />
            </ProtectedRoute>
          }
        />

        {/* DOCTOR Portal Branch */}
        <Route
          path="/doctor/dashboard"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <DoctorDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor/schedule"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <AvailabilitySettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor/availability"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <AvailabilitySettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor/appointments"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <DoctorAppointmentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor/*"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <DoctorDashboard />
            </ProtectedRoute>
          }
        />

        {/* PHARMACY Portal Branch */}
        <Route
          path="/pharmacy/dashboard"
          element={
            <ProtectedRoute allowedRoles={["PHARMACY"]}>
              <RoleDashboardPlaceholder role="PHARMACY" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pharmacy/*"
          element={
            <ProtectedRoute allowedRoles={["PHARMACY"]}>
              <RoleDashboardPlaceholder role="PHARMACY" />
            </ProtectedRoute>
          }
        />

        {/* ADMIN Portal Branch */}
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <RoleDashboardPlaceholder role="ADMIN" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <RoleDashboardPlaceholder role="ADMIN" />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Global 404 Catch-All */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
