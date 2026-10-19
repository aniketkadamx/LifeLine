import * as React from "react";
import { Link } from "react-router-dom";
import {
  Stethoscope,
  Calendar,
  Clock,
  User,
  Video,
  Phone,
  MessageSquare,
  Building,
  ShieldCheck,
  AlertCircle,
  FileCheck2,
  ChevronRight,
  Sliders,
  Star,
  MapPin,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export type DoctorVerificationStatus =
  | "UNSUBMITTED"
  | "PENDING_REVIEW"
  | "INFO_REQUESTED"
  | "APPROVED_VERIFIED"
  | "REJECTED";

export interface DoctorProfileData {
  _id?: string;
  userId: string;
  specialization?: string;
  experienceYears?: number;
  qualifications?: string[];
  clinicName?: string;
  clinicAddress?: {
    street?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  languages?: string[];
  consultationFee?: number;
  consultationTypes?: ("VIDEO" | "AUDIO" | "CHAT" | "IN_PERSON")[];
  bio?: string;
  verificationStatus: DoctorVerificationStatus;
  rating?: number;
  totalReviews?: number;
}

export interface TodayAppointmentItem {
  _id: string;
  patientId: string;
  doctorId: string;
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
  reason?: string;
  fee: number;
  currency: string;
}

export function DoctorDashboard() {
  const { user } = useAuthStore();

  const [profile, setProfile] = React.useState<DoctorProfileData | null>(null);
  const [todayAppointments, setTodayAppointments] = React.useState<TodayAppointmentItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const fetchDashboardData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const todayStr = new Date().toISOString().split("T")[0];

    try {
      // Parallel fetch of real doctor profile and today's appointments
      const [profileRes, apptsRes] = await Promise.allSettled([
        api.get<{ success: boolean; data: DoctorProfileData }>("/doctors/me/profile"),
        api.get<{ success: boolean; data: TodayAppointmentItem[] }>("/appointments", {
          params: {
            from: `${todayStr}T00:00:00.000Z`,
            to: `${todayStr}T23:59:59.999Z`,
            limit: 20,
            sort: "scheduledStart",
            order: "asc",
          },
        }),
      ]);

      if (profileRes.status === "fulfilled") {
        setProfile(profileRes.value.data || null);
      }

      if (apptsRes.status === "fulfilled") {
        setTodayAppointments(apptsRes.value.data || []);
      }

      // If both calls rejected, show error
      if (profileRes.status === "rejected" && apptsRes.status === "rejected") {
        const err = profileRes.reason;
        setErrorMsg(
          err instanceof ApiError
            ? err.message
            : "Failed to load clinical workstation data. Please try again."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const getVerificationBadge = (status?: DoctorVerificationStatus) => {
    switch (status) {
      case "APPROVED_VERIFIED":
        return (
          <Badge variant="default" className="text-xs bg-emerald-600 hover:bg-emerald-600 font-semibold gap-1">
            <ShieldCheck className="size-3.5" /> Verified Practitioner
          </Badge>
        );
      case "PENDING_REVIEW":
        return (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 gap-1">
            <Clock className="size-3.5" /> Credentials Under Review
          </Badge>
        );
      case "INFO_REQUESTED":
        return (
          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 dark:text-blue-400 gap-1">
            <AlertCircle className="size-3.5" /> Info Requested
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="destructive" className="text-xs font-semibold gap-1">
            <AlertCircle className="size-3.5" /> Verification Rejected
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
            Unsubmitted Credentials
          </Badge>
        );
    }
  };

  const getTypeIcon = (type: TodayAppointmentItem["appointmentType"]) => {
    switch (type) {
      case "VIDEO":
        return <Video className="size-3.5" />;
      case "AUDIO":
        return <Phone className="size-3.5" />;
      case "CHAT":
        return <MessageSquare className="size-3.5" />;
      case "IN_PERSON":
        return <Building className="size-3.5" />;
    }
  };

  const getStatusBadgeVariant = (status: TodayAppointmentItem["status"]) => {
    switch (status) {
      case "CONFIRMED":
        return "default";
      case "IN_PROGRESS":
        return "outline";
      case "COMPLETED":
        return "default";
      case "CANCELLED":
      case "REJECTED":
        return "destructive";
      default:
        return "outline";
    }
  };


  return (
    <div className="space-y-6" data-testid="doctor-dashboard">
      {/* CLINICAL WELCOME BANNER */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-background to-blue-500/5 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="doctor" className="text-xs uppercase font-bold tracking-wider">
                Doctor Workstation
              </Badge>
              {getVerificationBadge(profile?.verificationStatus)}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {`Dr. ${user?.fullName?.replace(/^Dr\.\s*/i, "") || "Clinician"}`}
            </h1>

            <p className="text-sm text-muted-foreground max-w-xl">
              {profile?.specialization ? `${profile.specialization} · ` : ""}
              {profile?.experienceYears ? `${profile.experienceYears} Years Clinical Experience` : "Registered Medical Practitioner"}
              {profile?.clinicName ? ` · ${profile.clinicName}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/doctor/appointments">
              <Button size="sm" data-testid="dashboard-appointments-btn">
                <Calendar className="size-4 mr-1.5" /> View Appointments
              </Button>
            </Link>
            <Link to="/doctor/schedule">
              <Button variant="outline" size="sm" data-testid="dashboard-schedule-btn">
                <Sliders className="size-4 mr-1.5" /> Manage Schedule
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ERROR FEEDBACK */}
      {errorMsg && (
        <ErrorAlert
          title="Clinical Workstation Notice"
          message={errorMsg}
          onRetry={fetchDashboardData}
          data-testid="doctor-dashboard-error-alert"
        />
      )}

      {/* QUICK ACTIONS NAV CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="doctor-quick-actions">
        <Link to="/doctor/appointments" className="block group">
          <Card className="h-full border border-border hover:border-primary/40 transition-all hover:shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                <Calendar className="size-5" />
              </div>
              <CardTitle className="text-base font-bold text-foreground group-hover:text-primary transition-colors flex items-center justify-between">
                Today's Consultations <ChevronRight className="size-4" />
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Review scheduled patient queue, patient history, and appointment statuses.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/doctor/schedule" className="block group">
          <Card className="h-full border border-border hover:border-primary/40 transition-all hover:shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="size-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-2">
                <Clock className="size-5" />
              </div>
              <CardTitle className="text-base font-bold text-foreground group-hover:text-emerald-600 transition-colors flex items-center justify-between">
                Weekly Schedule Builder <ChevronRight className="size-4" />
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Configure your recurring working shifts, slot durations, and consultation exceptions.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/doctor/appointments" className="block group">
          <Card className="h-full border border-border hover:border-primary/40 transition-all hover:shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="size-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-2">
                <FileCheck2 className="size-5" />
              </div>
              <CardTitle className="text-base font-bold text-foreground group-hover:text-blue-600 transition-colors flex items-center justify-between">
                Prescription Studio <ChevronRight className="size-4" />
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Issue immutable digital prescriptions with catalog verification and print preview.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* TODAY'S CONSULTATION QUEUE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Clock className="size-5 text-primary" /> Today's Consultation Schedule
            </h2>
            <p className="text-xs text-muted-foreground">
              Patient consultations scheduled for {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>

          <Link to="/doctor/appointments">
            <Button variant="ghost" size="sm" className="text-xs">
              View All Appointments <ChevronRight className="size-3.5 ml-1" />
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-2.5" data-testid="dashboard-loading">
            {[1, 2].map((n) => (
              <div key={n} className="h-20 w-full rounded-xl bg-muted/40 animate-pulse border border-border/50" />
            ))}
          </div>
        ) : todayAppointments.length === 0 ? (
          <EmptyState
            title="No Consultations Scheduled for Today"
            description="You have zero patient appointments on today's calendar. Review upcoming bookings in the appointments manager or adjust your weekly availability shifts."
            icon={Calendar}
            actionLabel="Review Schedule Settings"
            onAction={() => window.location.assign("/doctor/schedule")}
            data-testid="dashboard-empty-appointments"
          />
        ) : (
          <div className="space-y-2.5" data-testid="dashboard-appointments-list">
            {todayAppointments.map((appt) => (
              <Card
                key={appt._id}
                className="border border-border hover:shadow-xs transition-shadow overflow-hidden"
                data-testid={`today-appt-${appt._id}`}
              >
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <User className="size-4" />
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">
                          Patient ID: {appt.patientId.slice(-8).toUpperCase()}
                        </span>
                        <Badge
                          variant={getStatusBadgeVariant(appt.status)}
                          className="text-[10px] uppercase font-bold"
                        >
                          {appt.status.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 font-semibold text-foreground">
                          <Clock className="size-3 text-primary" />
                          {new Date(appt.scheduledStart).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" – "}
                          {new Date(appt.scheduledEnd).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="flex items-center gap-1 capitalize">
                          {getTypeIcon(appt.appointmentType)}
                          {appt.appointmentType.toLowerCase()}
                        </span>
                        <span>Fee: ₹{appt.fee}</span>
                      </div>

                      {appt.reason && (
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          <span className="font-semibold text-foreground">Reason: </span>
                          {appt.reason}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link to="/doctor/appointments">
                      <Button variant="outline" size="sm" className="h-8 text-xs">
                        Open in Appointments
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* PRACTITIONER PROFILE CREDENTIALS SUMMARY */}
      {profile && (
        <Card className="border border-border shadow-xs" data-testid="doctor-profile-card">
          <CardHeader className="p-4 sm:p-5 pb-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Stethoscope className="size-4 text-primary" /> Professional Profile & Credentials
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Clinical registration details verified by the LifeLine medical administration panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 sm:p-5 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground block text-[11px]">Specialization</span>
                <span className="font-semibold text-foreground">
                  {profile.specialization || "General Practice"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Consultation Fee</span>
                <span className="font-semibold text-foreground">
                  ₹{profile.consultationFee ?? "Not Configured"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Experience</span>
                <span className="font-semibold text-foreground">
                  {profile.experienceYears ? `${profile.experienceYears} Years` : "Not Specified"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Rating</span>
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <Star className="size-3 text-amber-500 fill-amber-500" />
                  {profile.rating ? profile.rating.toFixed(1) : "New Practitioner"}
                  {profile.totalReviews ? ` (${profile.totalReviews} reviews)` : ""}
                </span>
              </div>
            </div>

            {profile.clinicAddress && (
              <div className="mt-3 pt-3 border-t border-border/60 text-xs text-muted-foreground flex items-center gap-1.5">
                <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                <span>
                  {profile.clinicName ? `${profile.clinicName}: ` : ""}
                  {[
                    profile.clinicAddress.street,
                    profile.clinicAddress.city,
                    profile.clinicAddress.state,
                    profile.clinicAddress.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
