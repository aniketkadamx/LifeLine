import * as React from "react";
import {
  Calendar,
  Clock,
  User,
  Video,
  Phone,
  MessageSquare,
  Building,
  FileText,
  XCircle,
  Filter,
  ShieldAlert,
  Download,
  Loader2,
  FileCheck2,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";
import { PrescriptionBuilderModal } from "@/features/prescriptions/components/PrescriptionBuilderModal";

export type AppointmentStatus =
  | "PENDING_PAYMENT"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "RESCHEDULED"
  | "NO_SHOW";

export type ConsultationType = "VIDEO" | "AUDIO" | "CHAT" | "IN_PERSON";

export interface DoctorAppointmentItem {
  _id: string;
  patientId: string;
  doctorId: string;
  appointmentType: ConsultationType;
  scheduledStart: string;
  scheduledEnd: string;
  status: AppointmentStatus;
  reason?: string;
  fee: number;
  currency: string;
  paymentStatus?: string;
}

export interface PatientHealthProfile {
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

export function DoctorAppointmentsPage() {
  const [appointments, setAppointments] = React.useState<DoctorAppointmentItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [successNotice, setSuccessNotice] = React.useState<string | null>(null);

  // Filters
  const [filterDateMode, setFilterDateMode] = React.useState<"today" | "all" | "custom">("today");
  const [selectedDate, setSelectedDate] = React.useState(new Date().toISOString().split("T")[0]);
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");

  // Patient Clinical History Drawer State
  const [activePatientDrawer, setActivePatientDrawer] = React.useState<{
    patientId: string;
    appointmentId: string;
    scheduledStart: string;
  } | null>(null);

  const [patientProfile, setPatientProfile] = React.useState<PatientHealthProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = React.useState(false);
  const [profileError, setProfileError] = React.useState<string | null>(null);

  // Record Download Lookup State inside Drawer
  const [recordLookupId, setRecordLookupId] = React.useState("");
  const [isLookingUpRecord, setIsLookingUpRecord] = React.useState(false);

  // Cancellation Modal State
  const [cancellingAppointmentId, setCancellingAppointmentId] = React.useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = React.useState("");
  const [isCancelling, setIsCancelling] = React.useState(false);

  // Prescription Builder Modal State
  const [selectedAppointmentForRx, setSelectedAppointmentForRx] = React.useState<{
    id: string;
    patientId: string;
    scheduledStart: string;
    reason?: string;
  } | null>(null);

  // Fetch Appointments
  const fetchAppointments = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const queryParams: Record<string, string | number> = {
      limit: 50,
      sort: "scheduledStart",
      order: "asc",
    };

    if (statusFilter !== "ALL") {
      queryParams.status = statusFilter;
    }

    if (filterDateMode === "today") {
      const today = new Date().toISOString().split("T")[0];
      queryParams.from = `${today}T00:00:00.000Z`;
      queryParams.to = `${today}T23:59:59.999Z`;
    } else if (filterDateMode === "custom" && selectedDate) {
      queryParams.from = `${selectedDate}T00:00:00.000Z`;
      queryParams.to = `${selectedDate}T23:59:59.999Z`;
    }

    try {
      const res = await api.get<{
        success: boolean;
        data: DoctorAppointmentItem[];
      }>("/appointments", {
        params: queryParams,
      });

      setAppointments(res.data || []);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to load doctor appointments.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to load appointments schedule.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [filterDateMode, selectedDate, statusFilter]);

  React.useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Open Clinical History Drawer & Fetch Profile
  const handleOpenPatientHistory = async (appt: DoctorAppointmentItem) => {
    setActivePatientDrawer({
      patientId: appt.patientId,
      appointmentId: appt._id,
      scheduledStart: appt.scheduledStart,
    });
    setPatientProfile(null);
    setProfileError(null);
    setIsLoadingProfile(true);

    try {
      const res = await api.get<{
        success: boolean;
        data: PatientHealthProfile;
      }>(`/patients/${appt.patientId}/profile`);

      setPatientProfile(res.data);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setProfileError("Access restricted: An active clinical consultation relationship is required to access patient history.");
        } else {
          setProfileError(err.message || "Unable to retrieve patient health profile.");
        }
      } else {
        setProfileError("Failed to retrieve patient profile data.");
      }
    } finally {
      setIsLoadingProfile(false);
    }
  };

  // On-demand Medical Record Download Lookup from inside Clinical Drawer
  const handleDownloadRecordById = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recordLookupId.trim();
    if (!trimmed || !/^[0-9a-fA-F]{24}$/.test(trimmed)) {
      setProfileError("Please enter a valid 24-character hexadecimal Medical Record ID.");
      return;
    }

    setIsLookingUpRecord(true);
    setProfileError(null);

    try {
      const res = await api.get<{
        success: boolean;
        data: { downloadUrl: string; expiresInSeconds: number };
      }>(`/medical-records/${trimmed}/download-url`);

      window.open(res.data.downloadUrl, "_blank", "noopener,noreferrer");
      setSuccessNotice(`Temporary download link opened for Record #${trimmed.slice(-6)}.`);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setProfileError(err.message || "Failed to generate temporary download URL.");
      } else {
        setProfileError("Failed to resolve medical record download URL.");
      }
    } finally {
      setIsLookingUpRecord(false);
    }
  };

  // Appointment Cancellation
  const handleCancelAppointment = async () => {
    if (!cancellingAppointmentId) return;
    if (cancellationReason.trim().length < 5) {
      setErrorMsg("Cancellation reason must be at least 5 characters long.");
      return;
    }

    setIsCancelling(true);
    setErrorMsg(null);

    try {
      await api.patch(`/appointments/${cancellingAppointmentId}/cancel`, {
        reason: cancellationReason.trim(),
      });

      setSuccessNotice("Appointment cancelled successfully.");
      setCancellingAppointmentId(null);
      setCancellationReason("");
      fetchAppointments();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to cancel appointment.");
      } else {
        setErrorMsg("Failed to cancel appointment.");
      }
    } finally {
      setIsCancelling(false);
    }
  };

  const getStatusBadgeVariant = (status: AppointmentStatus) => {
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

  const getTypeIcon = (type: ConsultationType) => {
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

  return (
    <div className="space-y-6" data-testid="doctor-appointments-page">
      {/* HEADER BANNER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Calendar className="size-6 text-primary" /> Clinical Appointments & Consultations
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your patient consultation schedule, access clinical history, and issue digital prescriptions.
          </p>
        </div>
      </div>

      {/* FEEDBACK ALERTS */}
      {errorMsg && (
        <ErrorAlert
          title="Clinical Appointment Notice"
          message={errorMsg}
          onRetry={() => setErrorMsg(null)}
          data-testid="appointments-error-alert"
        />
      )}

      {successNotice && (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-center justify-between"
          data-testid="appointments-success-alert"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <span>{successNotice}</span>
          </div>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900 font-semibold"
            onClick={() => setSuccessNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* FILTER CONTROLS BAR */}
      <Card className="border border-border shadow-xs">
        <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
            <Button
              type="button"
              variant={filterDateMode === "today" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterDateMode("today")}
              className="text-xs h-8"
              data-testid="filter-date-today"
            >
              Today's Schedule
            </Button>
            <Button
              type="button"
              variant={filterDateMode === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterDateMode("all")}
              className="text-xs h-8"
              data-testid="filter-date-all"
            >
              All Dates
            </Button>
            <Button
              type="button"
              variant={filterDateMode === "custom" ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterDateMode("custom")}
              className="text-xs h-8"
              data-testid="filter-date-custom"
            >
              Select Date
            </Button>

            {filterDateMode === "custom" && (
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 text-xs w-36 ml-1"
                data-testid="custom-date-picker"
              />
            )}
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <Filter className="size-3.5 text-muted-foreground" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex h-8 w-full md:w-44 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="status-filter-select"
            >
              <option value="ALL">All Statuses</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="PENDING_PAYMENT">Pending Payment</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* APPOINTMENTS LIST OR EMPTY STATE */}
      {isLoading ? (
        <div className="space-y-3" data-testid="appointments-loading">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-28 w-full rounded-xl bg-muted/40 animate-pulse border border-border/50" />
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <EmptyState
          title="No Appointments Found"
          description={
            filterDateMode === "today"
              ? "You have no consultations scheduled for today. Check other dates or update your weekly availability."
              : "No appointments match your current filter parameters."
          }
          icon={Calendar}
          actionLabel="View All Appointments"
          onAction={() => {
            setFilterDateMode("all");
            setStatusFilter("ALL");
          }}
          data-testid="appointments-empty-state"
        />
      ) : (
        <div className="space-y-3" data-testid="appointments-list">
          {appointments.map((appt) => (
            <Card
              key={appt._id}
              className="border border-border hover:shadow-xs transition-shadow overflow-hidden"
              data-testid={`appointment-row-${appt._id}`}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left: Time & Patient Context */}
                  <div className="flex items-start gap-3.5">
                    <div className="size-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <User className="size-5" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-foreground">
                          Patient ID: {appt.patientId.slice(-8).toUpperCase()}
                        </span>
                        <Badge
                          variant={getStatusBadgeVariant(appt.status)}
                          className="text-[10px] font-bold uppercase tracking-wider"
                          data-testid={`badge-status-${appt._id}`}
                        >
                          {appt.status.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                        <span className="flex items-center gap-1">
                          <Calendar className="size-3" />
                          {new Date(appt.scheduledStart).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1 capitalize">
                          {getTypeIcon(appt.appointmentType)}
                          {appt.appointmentType.toLowerCase()}
                        </span>
                        <span>Fee: ₹{appt.fee}</span>
                      </div>

                      {appt.reason && (
                        <p className="text-xs text-muted-foreground line-clamp-1 pt-0.5">
                          <span className="font-semibold text-foreground">Reason: </span>
                          {appt.reason}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-border/50">
                    {/* Patient Clinical Profile Drawer Trigger */}
                    {["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(appt.status) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenPatientHistory(appt)}
                        className="text-xs h-8"
                        data-testid={`open-patient-history-${appt._id}`}
                      >
                        <FileText className="size-3.5 mr-1 text-primary" /> Clinical History
                      </Button>
                    )}

                    {/* Prescription Builder Launcher */}
                    {["CONFIRMED", "IN_PROGRESS", "COMPLETED"].includes(appt.status) && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          setSelectedAppointmentForRx({
                            id: appt._id,
                            patientId: appt.patientId,
                            scheduledStart: appt.scheduledStart,
                            reason: appt.reason,
                          })
                        }
                        className="text-xs h-8"
                        data-testid={`prescribe-btn-${appt._id}`}
                      >
                        <FileCheck2 className="size-3.5 mr-1" /> Prescribe
                      </Button>
                    )}

                    {/* Cancellation Trigger */}
                    {["CONFIRMED", "PENDING_PAYMENT"].includes(appt.status) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCancellingAppointmentId(appt._id)}
                        className="text-xs h-8 text-destructive hover:bg-destructive/10"
                        data-testid={`cancel-appt-btn-${appt._id}`}
                      >
                        <XCircle className="size-3.5 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* PATIENT CLINICAL HISTORY DRAWER / MODAL */}
      <Dialog
        open={Boolean(activePatientDrawer)}
        onOpenChange={(open) => !open && setActivePatientDrawer(null)}
      >
        <DialogContent className="max-w-2xl p-0 overflow-hidden border border-border shadow-2xl rounded-2xl">
          <DialogHeader className="p-6 pb-4 bg-muted/30 border-b border-border">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs font-semibold uppercase text-primary border-primary/30">
                Authorized Clinical Profile
              </Badge>
              <span className="text-xs font-mono text-muted-foreground">
                Patient #{activePatientDrawer?.patientId.slice(-8).toUpperCase()}
              </span>
            </div>
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground mt-2">
              Patient Clinical History & Health Profile
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Retrieved under authorized doctor-patient clinical relationship.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6" data-testid="patient-clinical-drawer">
            {isLoadingProfile ? (
              <div className="space-y-3" data-testid="drawer-loading">
                <div className="h-20 w-full rounded-xl bg-muted/40 animate-pulse border border-border/50" />
                <div className="h-32 w-full rounded-xl bg-muted/40 animate-pulse border border-border/50" />
              </div>
            ) : profileError ? (
              <ErrorAlert
                title="Clinical Authorization Notice"
                message={profileError}
                onRetry={() => activePatientDrawer && handleOpenPatientHistory(appointments.find(a => a._id === activePatientDrawer.appointmentId)!)}
              />
            ) : patientProfile ? (
              <div className="space-y-6">
                {/* General Health Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/20 p-4 rounded-xl border border-border">
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Blood Group</span>
                    <span className="text-sm font-bold text-foreground">
                      {patientProfile.bloodGroup || "Not Recorded"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Gender</span>
                    <span className="text-sm font-bold capitalize text-foreground">
                      {patientProfile.gender?.toLowerCase() || "Not Specified"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Date of Birth</span>
                    <span className="text-sm font-bold text-foreground">
                      {patientProfile.dateOfBirth
                        ? new Date(patientProfile.dateOfBirth).toLocaleDateString()
                        : "Not Recorded"}
                    </span>
                  </div>
                  <div>
                    <span className="text-[11px] text-muted-foreground block">Emergency Contact</span>
                    <span className="text-sm font-bold text-foreground truncate block">
                      {patientProfile.emergencyContact?.name || "None"}
                    </span>
                  </div>
                </div>

                {/* Allergies & Chronic Conditions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Card className="border border-border">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
                        Documented Allergies
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1 text-xs">
                      {patientProfile.allergies && patientProfile.allergies.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {patientProfile.allergies.map((allergy, i) => (
                            <Badge key={i} variant="destructive" className="text-[11px]">
                              {allergy}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic">No allergies documented.</p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border border-border">
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-xs font-bold uppercase text-muted-foreground">
                        Chronic Conditions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1 text-xs">
                      {patientProfile.chronicConditions && patientProfile.chronicConditions.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {patientProfile.chronicConditions.map((condition, i) => (
                            <Badge key={i} variant="outline" className="text-[11px]">
                              {condition}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground italic">No chronic conditions recorded.</p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* ZERO-TRUST MEDICAL RECORDS ACCESS LIMITATION & ON-DEMAND LOOKUP */}
                <div className="rounded-xl border border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/30 p-4 text-xs text-blue-900 dark:text-blue-200 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldAlert className="size-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
                    <div>
                      <p className="font-bold">Zero-Trust Clinical Records Architecture</p>
                      <p className="text-blue-800/90 dark:text-blue-300/90 text-[11px] mt-0.5">
                        For data privacy, the backend does not expose a list-all endpoint for medical records. To review clinical diagnostics, enter the known 24-character Medical Record ID below to generate a temporary 15-minute download URL.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleDownloadRecordById} className="flex items-center gap-2 pt-1">
                    <Input
                      placeholder="Enter 24-hex Medical Record ID..."
                      className="h-8 text-xs font-mono flex-1 bg-background"
                      value={recordLookupId}
                      onChange={(e) => setRecordLookupId(e.target.value)}
                      data-testid="record-id-lookup-input"
                    />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={isLookingUpRecord || !recordLookupId.trim()}
                      className="h-8 px-3 text-xs"
                      data-testid="record-id-lookup-btn"
                    >
                      {isLookingUpRecord ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <>
                          <Download className="size-3.5 mr-1" /> Download
                        </>
                      )}
                    </Button>
                  </form>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* CANCELLATION MODAL */}
      <Dialog
        open={Boolean(cancellingAppointmentId)}
        onOpenChange={(open) => !open && !isCancelling && setCancellingAppointmentId(null)}
      >
        <DialogContent className="max-w-md p-6 border border-border shadow-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Cancel Scheduled Appointment</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Please state the clinical or operational reason for cancelling this appointment. The patient will be notified.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label htmlFor="cancel-reason" className="text-xs font-semibold">
                Cancellation Reason *
              </label>
              <textarea
                id="cancel-reason"
                rows={3}
                placeholder="e.g. Emergency surgery schedule conflict, physician unavailable."
                value={cancellationReason}
                onChange={(e) => setCancellationReason(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                disabled={isCancelling}
                data-testid="cancellation-reason-input"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCancellingAppointmentId(null)}
                disabled={isCancelling}
              >
                Keep Appointment
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleCancelAppointment}
                disabled={isCancelling || cancellationReason.trim().length < 5}
                data-testid="confirm-cancel-appointment-btn"
              >
                {isCancelling ? "Cancelling..." : "Confirm Cancellation"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PRESCRIPTION BUILDER MODAL */}
      {selectedAppointmentForRx && (
        <PrescriptionBuilderModal
          isOpen={Boolean(selectedAppointmentForRx)}
          onClose={() => setSelectedAppointmentForRx(null)}
          appointment={selectedAppointmentForRx}
          onPrescriptionIssued={(rxId) => {
            setSuccessNotice(`Digital prescription #${rxId.slice(-6)} successfully issued.`);
            setSelectedAppointmentForRx(null);
            fetchAppointments();
          }}
        />
      )}
    </div>
  );
}
