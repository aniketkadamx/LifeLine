import * as React from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Stethoscope,
  FileText,
  Pill,
  Sparkles,
  ArrowRight,
  HeartPulse,
  Clock,
  Phone,
  User,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export interface PatientProfileData {
  _id?: string;
  userId: string;
  dateOfBirth?: string;
  gender?: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY";
  bloodGroup?: "A+" | "A-" | "B+" | "B-" | "AB+" | "AB-" | "O+" | "O-";
  allergies?: string[];
  chronicConditions?: string[];
  emergencyContact?: {
    name: string;
    relationship: string;
    phone: string;
  };
}

export interface PatientAppointmentItem {
  _id: string;
  doctorId: string;
  patientId: string;
  appointmentType: "VIDEO" | "AUDIO" | "CHAT" | "IN_PERSON";
  scheduledStart: string;
  scheduledEnd: string;
  status:
    | "PENDING_PAYMENT"
    | "CONFIRMED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "CANCELLED"
    | "REJECTED"
    | "RESCHEDULED"
    | "NO_SHOW";
  fee: number;
  currency: string;
  reason?: string;
}

export function PatientDashboard() {
  const { user } = useAuthStore();

  const [profile, setProfile] = React.useState<PatientProfileData | null>(null);
  const [appointments, setAppointments] = React.useState<PatientAppointmentItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const fetchDashboardData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Parallel fetch of real profile and authenticated appointments
      const [profileRes, appointmentsRes] = await Promise.allSettled([
        api.get<{ success: boolean; data: PatientProfileData }>("/patients/me/profile"),
        api.get<{ success: boolean; data: PatientAppointmentItem[] }>("/appointments", {
          params: { limit: 5, sort: "scheduledStart", order: "desc" },
        }),
      ]);

      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value.data || null);
      }

      if (appointmentsRes.status === "fulfilled") {
        setAppointments(appointmentsRes.value.data || []);
      }

      // If both failed, surface an error
      if (profileRes.status === "rejected" && appointmentsRes.status === "rejected") {
        const err = profileRes.reason;
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "Failed to load dashboard data. Please try again."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Filter upcoming appointments (scheduled in future or today and not cancelled/completed)
  const upcomingAppointments = appointments.filter(
    (a) =>
      ["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS"].includes(a.status) &&
      new Date(a.scheduledStart).getTime() >= Date.now() - 24 * 60 * 60 * 1000
  );

  return (
    <div className="space-y-6" data-testid="patient-dashboard">
      {/* WELCOME BANNER */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-background to-emerald-500/5 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="patient" className="text-xs uppercase font-bold tracking-wider">
                Patient Portal
              </Badge>
              <span className="text-xs text-muted-foreground font-medium">Session Active</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              Welcome back, {user?.fullName || "Patient"}
            </h1>
            <p className="text-sm text-muted-foreground max-w-xl">
              Access your scheduled consultations, clinical records, and prescription medicine orders in one unified portal.
            </p>
          </div>

          <Link to="/patient/doctors">
            <Button className="shrink-0" data-testid="dashboard-book-btn">
              <Stethoscope className="size-4 mr-1.5" /> Book Consultation
            </Button>
          </Link>
        </div>
      </div>

      {/* ERROR FEEDBACK */}
      {errorMsg && (
        <ErrorAlert
          title="Dashboard Sync Notice"
          message={errorMsg}
          onRetry={fetchDashboardData}
          data-testid="dashboard-error-alert"
        />
      )}

      {/* QUICK ACTIONS NAV CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link to="/patient/doctors" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Stethoscope className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">Find Specialists</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Search verified doctors, check slots, and schedule visits.
            </p>
          </Card>
        </Link>

        <Link to="/patient/medical-records" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <FileText className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">Medical Records</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Upload lab reports & download diagnostic scans securely.
            </p>
          </Card>
        </Link>

        <Link to="/patient/orders" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Pill className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">Medicine Orders</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Track prescription verification & pharmacy delivery status.
            </p>
          </Card>
        </Link>

        <Link to="/patient/ai-assistant" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="size-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <Sparkles className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">AI Health Navigator</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Safe guidance on medical terminology & specialist recommendations.
            </p>
          </Card>
        </Link>
      </div>

      {/* DASHBOARD CONTENT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* UPCOMING APPOINTMENTS SECTION */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Calendar className="size-4 text-primary" /> Upcoming Consultations
            </h2>
            <Link to="/patient/doctors" className="text-xs text-primary hover:underline font-medium">
              Explore Doctors
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-muted/60 animate-pulse border border-border" />
              ))}
            </div>
          ) : upcomingAppointments.length === 0 ? (
            <EmptyState
              title="No Upcoming Consultations"
              description="You have no pending or confirmed consultations scheduled at this time."
              icon={Calendar}
              actionLabel="Find a Doctor"
              onAction={() => {}}
              data-testid="no-appointments-empty"
            />
          ) : (
            <div className="space-y-3" data-testid="dashboard-appointments-list">
              {upcomingAppointments.map((appt) => (
                <Card key={appt._id} className="border border-border p-4 hover:shadow-xs transition-shadow">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase font-bold">
                          {appt.appointmentType}
                        </Badge>
                        <Badge
                          variant={appt.status === "CONFIRMED" ? "doctor" : "outline"}
                          className="text-[10px] uppercase"
                        >
                          {appt.status.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      <p className="text-sm font-semibold text-foreground pt-1">
                        Consultation Ref: {appt._id.slice(-8)}
                      </p>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5" />
                          {new Date(appt.scheduledStart).toLocaleDateString()} at{" "}
                          {new Date(appt.scheduledStart).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span>• Fee: ₹{appt.fee}</span>
                      </div>
                    </div>

                    {appt.status === "PENDING_PAYMENT" && (
                      <Link to="/patient/doctors">
                        <Button size="sm" variant="secondary" className="text-xs">
                          Complete Payment
                        </Button>
                      </Link>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* PERSONAL HEALTH PROFILE SUMMARY */}
        <div className="space-y-4">
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <HeartPulse className="size-4 text-emerald-600" /> Health Profile
          </h2>

          <Card className="border border-border p-5 space-y-4">
            {isLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-1/2 bg-muted rounded" />
                <div className="h-4 w-3/4 bg-muted/60 rounded" />
                <div className="h-10 w-full bg-muted/40 rounded-xl" />
              </div>
            ) : !profile ? (
              <div className="text-center py-4 space-y-2 text-xs text-muted-foreground">
                <User className="size-8 text-muted-foreground/50 mx-auto" />
                <p>Health profile has not been initialized yet.</p>
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center py-1 border-b border-border/60">
                  <span className="text-muted-foreground">Blood Group</span>
                  <Badge variant="outline" className="font-bold text-foreground">
                    {profile.bloodGroup || "Not Provided"}
                  </Badge>
                </div>

                <div className="flex justify-between items-center py-1 border-b border-border/60">
                  <span className="text-muted-foreground">Gender</span>
                  <span className="font-medium text-foreground">
                    {profile.gender ? profile.gender.replace(/_/g, " ") : "Not Specified"}
                  </span>
                </div>

                <div className="py-1 border-b border-border/60 space-y-1">
                  <span className="text-muted-foreground block">Known Allergies</span>
                  {profile.allergies && profile.allergies.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {profile.allergies.map((a, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-[11px]"
                        >
                          {a}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-muted-foreground italic">None Recorded</span>
                  )}
                </div>

                {profile.emergencyContact && (
                  <div className="py-1 space-y-1">
                    <span className="text-muted-foreground block">Emergency Contact</span>
                    <div className="flex items-center justify-between font-medium text-foreground">
                      <span>{profile.emergencyContact.name} ({profile.emergencyContact.relationship})</span>
                      <span className="font-mono text-[11px] flex items-center gap-1 text-muted-foreground">
                        <Phone className="size-3" /> {profile.emergencyContact.phone}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
