import * as React from "react";
import { useParams, useSearchParams, useNavigate, Link } from "react-router-dom";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import { VideoGrid } from "../components/VideoGrid";
import { MediaControls } from "../components/MediaControls";
import { ConsultationChatPanel } from "../components/ConsultationChatPanel";
import { PrescriptionBuilderModal } from "@/features/prescriptions/components/PrescriptionBuilderModal";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/feedback-states";
import {
  Stethoscope,
  Clock,
  ShieldCheck,
  CheckCircle2,
  FileText,
  AlertCircle,
  FileCheck2,
  ArrowRight,
  RefreshCw,
  Loader2,
  User,
  HeartPulse,
} from "lucide-react";

export interface ApiResponse<T> {
  success: boolean;
  status?: string;
  data: T;
  message?: string;
}

export type ConsultationLifecycleStatus =
  | "SCHEDULED"
  | "ROOM_OPENED"
  | "IN_CONSULTATION"
  | "PAUSED"
  | "ENDED"
  | "COMPLETED"
  | "CANCELLED";

export interface ConsultationRecord {
  _id: string;
  id?: string;
  appointmentId: string | { _id: string; scheduledStart?: string; reason?: string };
  patientId: string | { _id: string; fullName?: string; email?: string };
  doctorId: string | { _id: string; fullName?: string; email?: string };
  consultationType: "VIDEO" | "AUDIO" | "CHAT" | "IN_PERSON";
  status: ConsultationLifecycleStatus;
  roomId: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  diagnosis?: string;
  clinicalNotes?: string;
  recommendedFollowUpDays?: number;
  prescriptionId?: string;
}

export interface ParticipantTokenResponse {
  consultationId: string;
  roomId: string;
  token: string;
  expiresInSeconds: number;
  status: ConsultationLifecycleStatus;
  livekitUrl?: string;
}

export interface InitiateSessionResponse {
  consultationId: string;
  appointmentId: string;
  roomId: string;
  roomUrl: string;
  status: ConsultationLifecycleStatus;
  token: string;
  expiresInSeconds: number;
  livekitUrl?: string;
}

/**
 * Resolves a 24-character hexadecimal consultation ID from route parameters.
 * Supports:
 * - Direct 24-character hex ID: "64b8e2f01a2b3c4d5e6f7a01"
 * - Server room-ID format: "consultation-64b8e2f01a2b3c4d5e6f7a01"
 */
export function resolveConsultationId(paramValue?: string): string | null {
  if (!paramValue) return null;
  const trimmed = paramValue.trim();

  // Standard 24-character Mongo ObjectId
  if (/^[0-9a-fA-F]{24}$/.test(trimmed)) {
    return trimmed;
  }

  // Canonical server roomId prefix: consultation-<id>
  if (trimmed.startsWith("consultation-")) {
    const candidate = trimmed.slice("consultation-".length);
    if (/^[0-9a-fA-F]{24}$/.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Master LiveKit Consultation Room Page.
 * Manages participant authentication, token acquisition, LiveKit WebRTC connection,
 * in-room media controls, DataChannel chat, clinical wrap-up, and summary display.
 */
export function ConsultationRoomPage() {
  const params = useParams<{ id?: string; roomId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const appointmentIdQuery = searchParams.get("appointmentId");
  const consultationId = resolveConsultationId(params.id || params.roomId);

  // Connection & Room state
  const [tokenData, setTokenData] = React.useState<ParticipantTokenResponse | null>(null);
  const [consultation, setConsultation] = React.useState<ConsultationRecord | null>(null);
  const [isLoadingToken, setIsLoadingToken] = React.useState(true);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [pageErrorCode, setPageErrorCode] = React.useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = React.useState<"connecting" | "connected" | "reconnecting" | "disconnected">("connecting");

  // In-room UI state
  const [isChatOpen, setIsChatOpen] = React.useState(false);
  const [isEndingSession, setIsEndingSession] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  // Doctor Clinical Wrap-up Dialog State
  const [isWrapUpOpen, setIsWrapUpOpen] = React.useState(false);
  const [diagnosisInput, setDiagnosisInput] = React.useState("");
  const [clinicalNotesInput, setClinicalNotesInput] = React.useState("");
  const [followUpDaysInput, setFollowUpDaysInput] = React.useState("");
  const [wrapUpErrors, setWrapUpErrors] = React.useState<{ diagnosis?: string; clinicalNotes?: string; general?: string }>({});
  const [isSubmittingNotes, setIsSubmittingNotes] = React.useState(false);

  // Prescription builder trigger
  const [isPrescriptionModalOpen, setIsPrescriptionModalOpen] = React.useState(false);

  // Timers & Token refresh refs
  const timerRef = React.useRef<NodeJS.Timeout | null>(null);
  const refreshTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const isRefreshingRef = React.useRef(false);

  // 1. INITIALIZE CONSULTATION ROOM OR RETRIEVE PARTICIPANT TOKEN
  const fetchRoomSession = React.useCallback(async () => {
    setIsLoadingToken(true);
    setPageError(null);
    setPageErrorCode(null);

    try {
      // Scenario A: Doctor entering from appointment context (or starting new session)
      if (user?.role === "DOCTOR" && appointmentIdQuery && !consultationId) {
        const initRes = await api.post<ApiResponse<InitiateSessionResponse>>(
          `/consultations/${appointmentIdQuery}/session`,
          {}
        );
        const data = initRes.data;
        setTokenData({
          consultationId: data.consultationId,
          roomId: data.roomId,
          token: data.token,
          expiresInSeconds: data.expiresInSeconds,
          status: data.status,
          livekitUrl: data.livekitUrl,
        });

        // Load full consultation metadata
        try {
          const detailRes = await api.get<ApiResponse<ConsultationRecord>>(`/consultations/${data.consultationId}`);
          setConsultation(detailRes.data);
        } catch {}

        setIsLoadingToken(false);
        return;
      }

      // Validate consultation ID
      if (!consultationId) {
        setPageError("Invalid consultation or room identifier. Please verify your consultation link.");
        setPageErrorCode("INVALID_IDENTIFIER");
        setIsLoadingToken(false);
        return;
      }

      // Load Consultation Details
      const detailRes = await api.get<ApiResponse<ConsultationRecord>>(`/consultations/${consultationId}`);
      const consultData = detailRes.data;
      setConsultation(consultData);

      // If consultation is already finalized, display summary directly
      if (consultData.status === "COMPLETED" || consultData.status === "ENDED") {
        setIsLoadingToken(false);
        return;
      }

      // Scenario B: Retrieve participant token for active room
      const tokenRes = await api.get<ApiResponse<ParticipantTokenResponse>>(`/consultations/${consultationId}/token`);
      const tData = tokenRes.data;
      setTokenData(tData);

      // Schedule token renewal (at 50 minutes / 3000 seconds before 3600-second TTL expires)
      const refreshDelayMs = Math.max(30000, (tData.expiresInSeconds - 600) * 1000);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        void handleSilentTokenRefresh(consultationId);
      }, refreshDelayMs);
    } catch (err: any) {
      if (err instanceof ApiError) {
        // If consultation session has closed, allow viewing summary
        if (err.code === "CONSULTATION_SESSION_CLOSED") {
          try {
            if (consultationId) {
              const detailRes = await api.get<ApiResponse<ConsultationRecord>>(`/consultations/${consultationId}`);
              setConsultation(detailRes.data);
            }
          } catch {}
          setIsLoadingToken(false);
          return;
        }

        setPageErrorCode(err.code || "API_ERROR");
        setPageError(err.message || "Failed to enter consultation room.");
      } else {
        setPageError("Network connection failure while connecting to consultation.");
        setPageErrorCode("NETWORK_ERROR");
      }
    } finally {
      setIsLoadingToken(false);
    }
  }, [consultationId, appointmentIdQuery, user?.role]);

  // Silent Token Refresh Coordinator
  const handleSilentTokenRefresh = async (cId: string) => {
    if (isRefreshingRef.current) return;
    try {
      isRefreshingRef.current = true;
      const res = await api.get<ApiResponse<ParticipantTokenResponse>>(`/consultations/${cId}/token`);
      setTokenData((prev) =>
        prev
          ? {
              ...prev,
              token: res.data.token,
              expiresInSeconds: res.data.expiresInSeconds,
            }
          : res.data
      );
    } catch {
      // Do not abort active room on background refresh warning; LiveKit will trigger reconnection if required
    } finally {
      isRefreshingRef.current = false;
    }
  };

  React.useEffect(() => {
    void fetchRoomSession();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchRoomSession]);

  // 2. LIVE SESSION TIMER (Tracks active duration from server startedAt)
  React.useEffect(() => {
    if (tokenData && consultation?.startedAt && consultation.status !== "COMPLETED" && consultation.status !== "ENDED") {
      const startMs = new Date(consultation.startedAt).getTime();

      const updateTimer = () => {
        const nowMs = Date.now();
        const diff = Math.max(0, Math.floor((nowMs - startMs) / 1000));
        setElapsedSeconds(diff);
      };

      updateTimer();
      timerRef.current = setInterval(updateTimer, 1000);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else if (consultation?.durationSeconds) {
      setElapsedSeconds(consultation.durationSeconds);
    }
  }, [tokenData, consultation?.startedAt, consultation?.status, consultation?.durationSeconds]);

  // Format Elapsed Time MM:SS
  const formatTimer = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  // 3. END CONSULTATION ACTION
  const handleEndConsultation = async () => {
    const targetId = consultation?._id || consultationId;
    if (!targetId || isEndingSession) return;

    try {
      setIsEndingSession(true);
      const res = await api.post<ApiResponse<ConsultationRecord>>(`/consultations/${targetId}/end`, {});
      const updatedConsult = res.data;
      setConsultation(updatedConsult);

      // If attending Doctor, launch mandatory clinical wrap-up form
      if (user?.role === "DOCTOR") {
        setIsWrapUpOpen(true);
      } else {
        // Patient / Admin: disconnect room view and display completed summary
        setTokenData(null);
      }
    } catch (err: any) {
      setPageError(err?.message || "Failed to end consultation session.");
    } finally {
      setIsEndingSession(false);
    }
  };

  // 4. SUBMIT CLINICAL NOTES (DOCTOR WRAP-UP)
  const handleSubmitClinicalNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetId = consultation?._id || consultationId;
    if (!targetId || isSubmittingNotes) return;

    // Client-side validation matching Zod schema
    const errors: { diagnosis?: string; clinicalNotes?: string; general?: string } = {};
    const trimmedDiagnosis = diagnosisInput.trim();
    const trimmedNotes = clinicalNotesInput.trim();

    if (!trimmedDiagnosis || trimmedDiagnosis.length < 3) {
      errors.diagnosis = "Diagnosis must be at least 3 characters long.";
    }
    if (!trimmedNotes || trimmedNotes.length < 5) {
      errors.clinicalNotes = "Clinical notes must be at least 5 characters long.";
    }

    if (Object.keys(errors).length > 0) {
      setWrapUpErrors(errors);
      return;
    }

    try {
      setIsSubmittingNotes(true);
      setWrapUpErrors({});

      const payload: {
        diagnosis: string;
        clinicalNotes: string;
        recommendedFollowUpDays?: number;
      } = {
        diagnosis: trimmedDiagnosis,
        clinicalNotes: trimmedNotes,
      };

      if (followUpDaysInput.trim() !== "") {
        const days = parseInt(followUpDaysInput, 10);
        if (!isNaN(days) && days >= 0) {
          payload.recommendedFollowUpDays = days;
        }
      }

      await api.post(`/consultations/${targetId}/notes`, payload);

      // Refresh final consultation record
      const refreshed = await api.get<ApiResponse<ConsultationRecord>>(`/consultations/${targetId}`);
      setConsultation(refreshed.data);

      setIsWrapUpOpen(false);
      setTokenData(null); // Conclude LiveKit room state
    } catch (err: any) {
      const msg = err?.message || "Failed to submit clinical documentation.";
      setWrapUpErrors({ general: msg });
    } finally {
      setIsSubmittingNotes(false);
    }
  };

  // -------------------------------------------------------------------------
  // VIEW A: LOADING STATE
  // -------------------------------------------------------------------------
  if (isLoadingToken) {
    return (
      <div
        className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center space-y-4"
        data-testid="consultation-room-loading"
      >
        <div className="size-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary animate-pulse">
          <Stethoscope className="size-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Entering Consultation Room</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Verifying participant authorization, room status, and issuing secure WebRTC session credentials...
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-primary" />
          <span>Negotiating media transport...</span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // VIEW B: ERROR STATE
  // -------------------------------------------------------------------------
  if (pageError && !tokenData && consultation?.status !== "COMPLETED" && consultation?.status !== "ENDED") {
    return (
      <div
        className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center space-y-4 max-w-lg mx-auto"
        data-testid="consultation-room-error"
      >
        <div className="size-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500">
          <AlertCircle className="size-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Unable to Join Consultation</h2>
          <p className="text-sm text-muted-foreground mt-1.5">{pageError}</p>
          {pageErrorCode && (
            <Badge variant="outline" className="mt-2 text-xs font-mono border-rose-200 text-rose-700 dark:text-rose-400">
              Error: {pageErrorCode}
            </Badge>
          )}
        </div>

        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <Button type="button" onClick={() => void fetchRoomSession()} className="gap-2">
            <RefreshCw className="size-4" /> Try Again
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(user?.role === "DOCTOR" ? "/doctor/appointments" : "/patient/dashboard")}
          >
            Return to Portal
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // VIEW C: CONSULTATION SUMMARY VIEW (When ENDED or COMPLETED)
  // -------------------------------------------------------------------------
  const isFinalized = consultation?.status === "COMPLETED" || (consultation?.status === "ENDED" && !tokenData);

  if (isFinalized && consultation) {
    const patientDisplay =
      typeof consultation.patientId === "object" && consultation.patientId?.fullName
        ? consultation.patientId.fullName
        : "Patient";

    const doctorDisplay =
      typeof consultation.doctorId === "object" && consultation.doctorId?.fullName
        ? `Dr. ${consultation.doctorId.fullName}`
        : "Attending Doctor";

    const appointmentContextId =
      typeof consultation.appointmentId === "object"
        ? consultation.appointmentId._id
        : consultation.appointmentId;

    return (
      <div
        className="max-w-3xl mx-auto py-8 px-4 space-y-6"
        data-testid="consultation-summary-view"
      >
        {/* SUCCESS SUMMARY CARD */}
        <div className="flex flex-col items-center text-center pb-4 border-b border-border">
          <div className="size-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-3 shadow-xs">
            <CheckCircle2 className="size-8" />
          </div>
          <Badge
            variant="outline"
            className="text-xs uppercase font-bold tracking-wider px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700"
          >
            {consultation.status}
          </Badge>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground mt-2">
            Consultation Session Concluded
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            The video consultation has successfully ended. Verified clinical records and summary metrics have been archived.
          </p>
        </div>

        {/* METRICS & OVERVIEW GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                <Clock className="size-5" />
              </div>
              <div>
                <span className="text-xs text-muted-foreground block font-medium">Session Duration</span>
                <span className="text-base font-bold text-foreground">
                  {consultation.durationSeconds ? `${Math.floor(consultation.durationSeconds / 60)}m ${consultation.durationSeconds % 60}s` : "0m 00s"}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                <Stethoscope className="size-5" />
              </div>
              <div className="overflow-hidden">
                <span className="text-xs text-muted-foreground block font-medium">Clinician</span>
                <span className="text-sm font-bold text-foreground truncate block">{doctorDisplay}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="size-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
                <User className="size-5" />
              </div>
              <div className="overflow-hidden">
                <span className="text-xs text-muted-foreground block font-medium">Patient</span>
                <span className="text-sm font-bold text-foreground truncate block">{patientDisplay}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* CLINICAL DOCUMENTATION DISPLAY */}
        <Card className="border-border shadow-xs">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-border">
              <FileText className="size-5 text-primary" />
              <h3 className="text-base font-bold text-foreground">Clinical Findings & Diagnosis</h3>
            </div>

            {consultation.diagnosis ? (
              <div className="space-y-3">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Primary Diagnosis</span>
                  <p className="text-sm font-medium text-foreground mt-0.5" data-testid="summary-diagnosis">
                    {consultation.diagnosis}
                  </p>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Clinical Notes</span>
                  <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap bg-muted/40 p-3 rounded-xl border border-border" data-testid="summary-notes">
                    {consultation.clinicalNotes}
                  </p>
                </div>

                {consultation.recommendedFollowUpDays !== undefined && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Follow-Up Recommended</span>
                    <p className="text-sm font-medium text-primary mt-0.5">
                      Return in {consultation.recommendedFollowUpDays} days for follow-up evaluation.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block">Pending Clinical Documentation</span>
                  <span>The attending doctor has concluded the video interaction and is finalizing formal diagnostic records.</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ROLE-SPECIFIC ACTION CONTROLS */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
          {user?.role === "DOCTOR" && (
            <>
              <Button
                type="button"
                onClick={() => setIsPrescriptionModalOpen(true)}
                className="w-full sm:w-auto gap-2"
                data-testid="summary-issue-rx-btn"
              >
                <FileCheck2 className="size-4" /> Issue Digital Prescription
              </Button>
              <Link to="/doctor/appointments">
                <Button variant="outline" className="w-full sm:w-auto">
                  Back to Appointments
                </Button>
              </Link>
            </>
          )}

          {user?.role === "PATIENT" && (
            <>
              <Link to="/patient/medical-records">
                <Button variant="outline" className="w-full sm:w-auto gap-2">
                  <FileText className="size-4" /> View Medical Records
                </Button>
              </Link>
              <Link to="/patient/dashboard">
                <Button className="w-full sm:w-auto gap-2">
                  Return to Dashboard <ArrowRight className="size-4" />
                </Button>
              </Link>
            </>
          )}

          {user?.role === "ADMIN" && (
            <Link to="/admin/dashboard">
              <Button className="w-full sm:w-auto">Return to Admin Operations</Button>
            </Link>
          )}
        </div>

        {/* PRESCRIPTION BUILDER MODAL (DOCTOR) */}
        {user?.role === "DOCTOR" && appointmentContextId && (
          <PrescriptionBuilderModal
            isOpen={isPrescriptionModalOpen}
            onClose={() => setIsPrescriptionModalOpen(false)}
            appointment={{
              id: appointmentContextId,
              patientId: typeof consultation.patientId === "object" ? consultation.patientId._id : consultation.patientId,
              patientName: patientDisplay,
              scheduledStart: new Date().toISOString(),
              reason: consultation.diagnosis,
            }}
            doctorName={user?.fullName}
            onPrescriptionIssued={() => {
              setIsPrescriptionModalOpen(false);
              void fetchRoomSession();
            }}
          />
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // VIEW D: LIVE CONSULTATION ROOM (Active WebRTC LiveKit Session)
  // -------------------------------------------------------------------------
  if (!tokenData || !tokenData.token || !tokenData.livekitUrl) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
        <ErrorAlert message="Session credentials could not be established." />
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col w-full h-[calc(100vh-4rem)] max-h-[1080px] bg-slate-950 text-slate-100 overflow-hidden select-none"
      data-testid="active-consultation-room"
    >
      {/* ROOM TOP HEADER BAR */}
      <header className="h-14 px-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0 z-10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <HeartPulse className="size-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white flex items-center gap-2">
              Virtual Consultation
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            </h1>
            <span className="text-[11px] text-slate-400 font-mono">
              Ref #{consultation?._id ? consultation._id.slice(-8).toUpperCase() : consultationId?.slice(-8).toUpperCase()}
            </span>
          </div>
        </div>

        {/* SESSION TIMER & ENCRYPTION BADGE */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center gap-1.5 bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 text-xs font-mono font-bold text-slate-200 shadow-inner"
            data-testid="consultation-timer"
          >
            <Clock className="size-3.5 text-primary" />
            <span>{formatTimer(elapsedSeconds)}</span>
          </div>

          <Badge
            variant="outline"
            className={`text-[11px] font-medium flex items-center gap-1.5 ${
              connectionStatus === "connected"
                ? "bg-slate-950 text-emerald-400 border-slate-800"
                : connectionStatus === "reconnecting"
                ? "bg-amber-950/60 text-amber-300 border-amber-800"
                : "bg-slate-950 text-slate-400 border-slate-800"
            }`}
            data-testid="connection-status-badge"
          >
            <span
              className={`size-1.5 rounded-full ${
                connectionStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : connectionStatus === "reconnecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-slate-500"
              }`}
            />
            {connectionStatus === "connected"
              ? "Connected"
              : connectionStatus === "reconnecting"
              ? "Reconnecting..."
              : "Connecting..."}
          </Badge>

          <Badge
            variant="outline"
            className="hidden sm:flex items-center gap-1 text-[11px] bg-slate-950 text-emerald-400 border-slate-800"
          >
            <ShieldCheck className="size-3" /> Encrypted WebRTC
          </Badge>
        </div>
      </header>

      {/* LIVEKIT ROOM WRAPPER & MAIN LAYOUT */}
      <LiveKitRoom
        serverUrl={tokenData.livekitUrl}
        token={tokenData.token}
        connect={true}
        video={true}
        audio={true}
        onConnected={() => setConnectionStatus("connected")}
        onDisconnected={() => {
          setConnectionStatus("disconnected");
          // If the server consultation has ended, trigger summary transition
          if (consultation?.status === "ENDED" || consultation?.status === "COMPLETED") {
            setTokenData(null);
          }
        }}
        onError={(err) => {
          setPageError(err.message || "LiveKit media provider error");
        }}
        className="flex-1 flex overflow-hidden relative"
        data-testid="livekit-room-container"
      >
        <RoomAudioRenderer />

        {/* CENTER VIDEO CANVAS */}
        <main className="flex-1 flex flex-col p-3 overflow-hidden relative">
          <VideoGrid
            doctorName={
              typeof consultation?.doctorId === "object"
                ? consultation.doctorId.fullName
                : undefined
            }
            patientName={
              typeof consultation?.patientId === "object"
                ? consultation.patientId.fullName
                : undefined
            }
            userRole={user?.role}
          />

          {/* DOCKED BOTTOM MEDIA CONTROLS */}
          <MediaControls
            onEndConsultation={handleEndConsultation}
            isEnding={isEndingSession}
            isChatOpen={isChatOpen}
            onToggleChat={() => setIsChatOpen(!isChatOpen)}
          />
        </main>

        {/* COLLAPSIBLE SIDE CHAT DRAWER */}
        <ConsultationChatPanel
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          currentUserId={user?.id}
          currentUserName={user?.fullName}
          userRole={user?.role}
        />
      </LiveKitRoom>

      {/* DOCTOR CLINICAL WRAP-UP FORM MODAL (TRIGGERED AFTER SESSION END) */}
      <Dialog open={isWrapUpOpen} onOpenChange={setIsWrapUpOpen}>
        <DialogContent
          className="max-w-xl bg-slate-900 border-slate-800 text-slate-100 shadow-2xl"
          data-testid="doctor-wrapup-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              Clinical Consultation Wrap-Up
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-xs mt-1">
              Finalize primary diagnosis and clinical consultation notes to complete this clinical encounter and unlock digital prescription generation.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitClinicalNotes} className="space-y-4 mt-2">
            {wrapUpErrors.general && (
              <div className="p-3 bg-rose-950/80 border border-rose-800 text-rose-200 text-xs rounded-lg flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0 text-rose-400" />
                <span>{wrapUpErrors.general}</span>
              </div>
            )}

            <div>
              <Label htmlFor="diagnosis" className="text-xs font-semibold text-slate-300">
                Primary Diagnosis *
              </Label>
              <Input
                id="diagnosis"
                value={diagnosisInput}
                onChange={(e) => setDiagnosisInput(e.target.value)}
                placeholder="e.g. Acute Upper Respiratory Tract Infection"
                maxLength={500}
                required
                className="mt-1 bg-slate-950 border-slate-800 text-slate-100 text-xs h-10"
                data-testid="wrapup-diagnosis-input"
              />
              {wrapUpErrors.diagnosis && (
                <span className="text-[11px] text-rose-400 mt-1 block">{wrapUpErrors.diagnosis}</span>
              )}
            </div>

            <div>
              <Label htmlFor="clinicalNotes" className="text-xs font-semibold text-slate-300">
                Clinical Observations & Treatment Plan *
              </Label>
              <textarea
                id="clinicalNotes"
                value={clinicalNotesInput}
                onChange={(e) => setClinicalNotesInput(e.target.value)}
                placeholder="Document clinical observations, patient symptoms, vital parameters, and recommended management..."
                rows={4}
                maxLength={5000}
                required
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 p-3 text-xs text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                data-testid="wrapup-notes-input"
              />
              {wrapUpErrors.clinicalNotes && (
                <span className="text-[11px] text-rose-400 mt-1 block">{wrapUpErrors.clinicalNotes}</span>
              )}
            </div>

            <div>
              <Label htmlFor="followUpDays" className="text-xs font-semibold text-slate-300">
                Recommended Follow-Up (Days)
              </Label>
              <Input
                id="followUpDays"
                type="number"
                min={0}
                max={365}
                value={followUpDaysInput}
                onChange={(e) => setFollowUpDaysInput(e.target.value)}
                placeholder="Optional (e.g. 7)"
                className="mt-1 bg-slate-950 border-slate-800 text-slate-100 text-xs h-10 w-40"
                data-testid="wrapup-followup-input"
              />
            </div>

            <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsWrapUpOpen(false)}
                className="border-slate-800 text-slate-300 hover:bg-slate-800 text-xs"
              >
                Skip for Now
              </Button>
              <Button
                type="submit"
                disabled={isSubmittingNotes}
                className="text-xs gap-2"
                data-testid="submit-wrapup-btn"
              >
                {isSubmittingNotes ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Finalizing Encounter...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-3.5" />
                    Finalize Clinical Notes
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
