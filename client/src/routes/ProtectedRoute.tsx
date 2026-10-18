import * as React from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/auth.store";
import type { UserRole } from "../types/auth";

export interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  children?: React.ReactNode;
}

/**
 * Returns canonical dashboard URL for a given authenticated user role.
 */
export function getRoleDashboardPath(role: UserRole): string {
  switch (role) {
    case "PATIENT":
      return "/patient/dashboard";
    case "DOCTOR":
      return "/doctor/dashboard";
    case "PHARMACY":
      return "/pharmacy/dashboard";
    case "ADMIN":
      return "/admin/dashboard";
    default:
      return "/login";
  }
}

/**
 * Validates whether a target redirect path is internal and safe to prevent open-redirect vulnerabilities.
 */
export function isSafeRedirectPath(path: unknown): path is string {
  if (typeof path !== "string" || path.trim().length === 0) return false;
  // Must be a relative path starting with single '/' and NOT starting with '//' (protocol-relative URL)
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * Route guard enforcing authentication and role authorization.
 *
 * Rules:
 * 1. Unauthenticated users are redirected to /login with attempted path saved in location.state.from.
 * 2. Authenticated users lacking required role are redirected to their assigned role dashboard.
 * 3. Authorized users render the nested Outlet or children.
 */
export function ProtectedRoute({ allowedRoles, children }: ProtectedRouteProps) {
  const { user, isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !user) {
    // Preserve attempted destination for post-login return
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    // Role mismatch: safely redirect to own role portal
    const targetDashboard = getRoleDashboardPath(user.role);
    return <Navigate to={targetDashboard} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}

/**
 * Route guard for unauthenticated-only pages (e.g., /login, /register).
 * Redirects already authenticated users to their designated role dashboard.
 */
export function PublicRoute({ children }: { children?: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore();
  const location = useLocation();

  if (isAuthenticated && user) {
    const rawFrom = (location.state as { from?: { pathname?: string } })?.from?.pathname;
    const destination = isSafeRedirectPath(rawFrom) ? rawFrom : getRoleDashboardPath(user.role);
    return <Navigate to={destination} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
