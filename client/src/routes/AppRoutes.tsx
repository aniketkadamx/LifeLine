import { Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "../layouts/AppLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { ProtectedRoute, PublicRoute, isSafeRedirectPath } from "./ProtectedRoute";
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
 * Lightweight login screen placeholder for testing auth shell foundation.
 */
function LoginPage() {
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSimulateLogin = (role: UserRole) => {
    login(
      {
        id: `usr_${role.toLowerCase()}_123`,
        fullName: `Dr. / User (${role})`,
        email: `${role.toLowerCase()}@lifeline.org`,
        role,
        status: "ACTIVE",
      },
      `mock_access_token_${role.toLowerCase()}`
    );

    const rawFrom = (location.state as { from?: { pathname?: string } })?.from?.pathname;
    const destination = isSafeRedirectPath(rawFrom) ? rawFrom : `/${role.toLowerCase()}/dashboard`;
    navigate(destination, { replace: true });
  };

  return (
    <Card className="shadow-md border-border">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-xl">Sign in to LifeLine</CardTitle>
        <CardDescription>
          Access your clinical records, consultations, or healthcare portal
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border/80 bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Task 13.1 Shell Foundation Verification</p>
          <p>Select any role below to simulate instant authenticated session dispatch:</p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSimulateLogin("PATIENT")}
            className="border-emerald-200 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300"
          >
            Patient Session
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSimulateLogin("DOCTOR")}
            className="border-blue-200 text-blue-800 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300"
          >
            Doctor Session
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSimulateLogin("PHARMACY")}
            className="border-amber-200 text-amber-800 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300"
          >
            Pharmacy Session
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSimulateLogin("ADMIN")}
            className="border-purple-200 text-purple-800 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-300"
          >
            Admin Session
          </Button>
        </div>

        <div className="pt-2 text-center text-xs text-muted-foreground">
          Don't have an account?{" "}
          <Link to="/register" className="font-semibold text-primary underline underline-offset-4">
            Register here
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Lightweight registration view placeholder.
 */
function RegisterPage() {
  return (
    <Card className="shadow-md border-border">
      <CardHeader className="text-center pb-4">
        <CardTitle className="text-xl">Create your LifeLine Account</CardTitle>
        <CardDescription>Join our unified digital healthcare platform</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          Onboarding workflows will be implemented in Task 13.2.
        </p>
        <div className="text-center pt-2">
          <Link to="/login">
            <Button variant="outline" className="w-full">
              Back to Sign In
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
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
              <RoleDashboardPlaceholder role="PATIENT" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/patient/*"
          element={
            <ProtectedRoute allowedRoles={["PATIENT"]}>
              <RoleDashboardPlaceholder role="PATIENT" />
            </ProtectedRoute>
          }
        />

        {/* DOCTOR Portal Branch */}
        <Route
          path="/doctor/dashboard"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <RoleDashboardPlaceholder role="DOCTOR" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doctor/*"
          element={
            <ProtectedRoute allowedRoles={["DOCTOR"]}>
              <RoleDashboardPlaceholder role="DOCTOR" />
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
