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
import { PharmacyDashboard } from "../features/pharmacies/pages/PharmacyDashboard";
import { InventoryPage } from "../features/pharmacies/pages/InventoryPage";
import { OrderReviewPage } from "../features/pharmacies/pages/OrderReviewPage";
import { AdminDashboard } from "../features/admin/pages/AdminDashboard";
import { VerificationQueuePage } from "../features/admin/pages/VerificationQueuePage";
import { ComplaintsPage } from "../features/admin/pages/ComplaintsPage";
import { AuditLogsPage } from "../features/admin/pages/AuditLogsPage";
import { ConsultationRoomPage } from "../features/consultations/pages/ConsultationRoomPage";
import { useAuthStore } from "../stores/auth.store";
import { Button } from "../components/ui/button";
import { Activity, ArrowRight } from "lucide-react";

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
              <PharmacyDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pharmacy/inventory"
          element={
            <ProtectedRoute allowedRoles={["PHARMACY"]}>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pharmacy/orders"
          element={
            <ProtectedRoute allowedRoles={["PHARMACY"]}>
              <OrderReviewPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/pharmacy/*"
          element={
            <ProtectedRoute allowedRoles={["PHARMACY"]}>
              <PharmacyDashboard />
            </ProtectedRoute>
          }
        />

        {/* ADMIN Portal Branch */}
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/verifications"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <VerificationQueuePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/complaints"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <ComplaintsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AuditLogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        {/* Telemedicine Video Consultation Rooms (Shared across authorized clinical roles) */}
        <Route
          path="/consultations/room/:roomId"
          element={
            <ProtectedRoute allowedRoles={["PATIENT", "DOCTOR", "ADMIN"]}>
              <ConsultationRoomPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/consultations/:id"
          element={
            <ProtectedRoute allowedRoles={["PATIENT", "DOCTOR", "ADMIN"]}>
              <ConsultationRoomPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* Global 404 Catch-All */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
