import * as React from "react";
import {
  FileCheck2,
  Stethoscope,
  Building2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  Search,
  ShieldCheck,
  Info,
  Clock,
  FileText,
} from "lucide-react";
import { api } from "@/services/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/ui/feedback-states";

export type ProviderType = "DOCTOR" | "PHARMACY";

export interface VerificationDocumentMeta {
  documentType: string;
  uploadedAt?: string;
}

export interface ReviewedProviderProfile {
  id: string;
  userId?: string;
  name?: string;
  specialization?: string;
  pharmacyName?: string;
  ownerName?: string;
  licenseNumber?: string;
  registrationNumber?: string;
  registrationCouncil?: string;
  verificationStatus: string;
  verificationNotes?: string;
  verificationDocuments?: VerificationDocumentMeta[];
  licenseDocuments?: VerificationDocumentMeta[];
}

export function VerificationQueuePage() {
  const [providerType, setProviderType] = React.useState<ProviderType>("DOCTOR");
  const [lookupId, setLookupId] = React.useState("");
  const [lookupError, setLookupError] = React.useState<string | null>(null);

  const [activeProfile, setActiveProfile] = React.useState<ReviewedProviderProfile | null>(null);
  const [isSubmittingDecision, setIsSubmittingDecision] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = React.useState<string | null>(null);

  // Decision Form Fields
  const [selectedDecision, setSelectedDecision] = React.useState<string>("");
  const [reviewNotes, setReviewNotes] = React.useState("");
  const [notesError, setNotesError] = React.useState<string | null>(null);

  const validateLookupId = (id: string): boolean => {
    const trimmed = id.trim();
    if (!trimmed) {
      setLookupError("Provider identifier is required.");
      return false;
    }
    if (!/^[0-9a-fA-F]{24}$/.test(trimmed)) {
      setLookupError("Invalid identifier format. Must be a 24-character hexadecimal ObjectId.");
      return false;
    }
    setLookupError(null);
    return true;
  };

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateLookupId(lookupId)) return;

    setActionError(null);
    setActionSuccess(null);
    setSelectedDecision("");
    setReviewNotes("");
    setNotesError(null);

    // Initial placeholder container to inspect target ID
    setActiveProfile({
      id: lookupId.trim(),
      verificationStatus: "PENDING_REVIEW",
    });
  };

  const handleDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setActionSuccess(null);
    setNotesError(null);

    if (!activeProfile?.id) {
      setActionError("No provider selected for credential review.");
      return;
    }

    if (!selectedDecision) {
      setActionError("Please select a formal review decision.");
      return;
    }

    const trimmedNotes = reviewNotes.trim();
    if (trimmedNotes.length < 5) {
      setNotesError("Review notes are required and must be at least 5 characters long for audit compliance.");
      return;
    }

    setIsSubmittingDecision(true);

    try {
      if (providerType === "DOCTOR") {
        const res = await api.patch<any>(`/admin/doctors/${activeProfile.id}/verify`, {
          status: selectedDecision,
          reviewNotes: trimmedNotes,
        });
        const updated = res?.data !== undefined ? res.data : res;

        setActiveProfile((prev) => ({
          ...prev,
          ...updated,
          id: updated?.id || prev?.id || activeProfile.id,
          verificationStatus: updated?.verificationStatus || selectedDecision,
          verificationNotes: trimmedNotes,
        }));

        setActionSuccess(`Doctor credential status successfully updated to '${selectedDecision}'. Audit log recorded.`);
      } else {
        const res = await api.patch<any>(`/admin/pharmacies/${activeProfile.id}/verify`, {
          status: selectedDecision,
          reviewNotes: trimmedNotes,
        });
        const updated = res?.data !== undefined ? res.data : res;

        setActiveProfile((prev) => ({
          ...prev,
          ...updated,
          id: updated?.id || prev?.id || activeProfile.id,
          verificationStatus: updated?.verificationStatus || selectedDecision,
          verificationNotes: trimmedNotes,
        }));

        setActionSuccess(`Pharmacy retail license status successfully updated to '${selectedDecision}'. Audit log recorded.`);
      }
    } catch (err: any) {
      setActionError(
        err?.message || "Verification transition failed. Please ensure the provider is in PENDING_REVIEW state."
      );
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12" data-testid="verification-queue-page">
      {/* Header */}
      <div className="border-b border-border pb-5">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
            <FileCheck2 className="size-8 text-primary shrink-0" />
            Healthcare Provider Credential Verification
          </h1>
          <Badge variant="admin" className="uppercase font-semibold tracking-wider text-[10px]">
            ADMIN
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Review medical practitioner licenses and retail pharmacy permits, enforce state machine transitions, and record compliance audit entries.
        </p>
      </div>

      {/* Mandatory Architecture Limitation Notice */}
      <div
        className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3"
        data-testid="queue-limitation-notice"
      >
        <Info className="size-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-sm">Automated Queue Discovery Limitation Notice</p>
          <p>
            The backend currently supports verification review transitions via{" "}
            <code className="font-mono font-semibold">PATCH /api/v1/admin/doctors/:id/verify</code> and{" "}
            <code className="font-mono font-semibold">PATCH /api/v1/admin/pharmacies/:id/verify</code>, but lacks automated pending queue listing endpoints.
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            Use the targeted Provider Profile ID lookup below to inspect and certify pending provider credentials.
          </p>
        </div>
      </div>

      {/* Provider Type Selection & ID Lookup */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="size-4 text-primary" />
            1. Select Provider Type & Target Identifier
          </CardTitle>
          <CardDescription>
            Target a specific doctor profile or retail pharmacy profile awaiting certification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          {/* Provider Type Tabs */}
          <div className="flex rounded-lg bg-muted p-1 max-w-sm">
            <button
              type="button"
              onClick={() => {
                setProviderType("DOCTOR");
                setActiveProfile(null);
                setActionError(null);
                setActionSuccess(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
                providerType === "DOCTOR"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="toggle-doctor-type-btn"
            >
              <Stethoscope className="size-3.5" />
              Doctor Medical License
            </button>
            <button
              type="button"
              onClick={() => {
                setProviderType("PHARMACY");
                setActiveProfile(null);
                setActionError(null);
                setActionSuccess(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-semibold transition-all ${
                providerType === "PHARMACY"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="toggle-pharmacy-type-btn"
            >
              <Building2 className="size-3.5" />
              Pharmacy Drug License
            </button>
          </div>

          {/* Identifier Input Form */}
          <form onSubmit={handleLookup} className="flex flex-col sm:flex-row sm:items-end gap-3 pt-1">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="provider-lookup-id" className="text-xs font-semibold">
                Target {providerType === "DOCTOR" ? "Doctor" : "Pharmacy"} Profile ID *
              </Label>
              <Input
                id="provider-lookup-id"
                placeholder="Enter 24-character hex ID (e.g., 64b8e2f01a2b3c4d5e6f7a01)..."
                value={lookupId}
                onChange={(e) => {
                  setLookupId(e.target.value);
                  if (lookupError) setLookupError(null);
                }}
                className="font-mono text-xs"
                data-testid="provider-lookup-input"
              />
            </div>
            <Button type="submit" size="sm" className="gap-2 h-9" data-testid="provider-lookup-btn">
              <Search className="size-3.5" />
              Inspect Target
            </Button>
          </form>

          {lookupError && (
            <p className="text-xs text-destructive font-medium" data-testid="lookup-error-msg">
              {lookupError}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Feedback Messages */}
      {actionError && (
        <ErrorAlert
          title="Verification Action Error"
          message={actionError}
          data-testid="action-error-alert"
        />
      )}

      {actionSuccess && (
        <div
          className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2.5"
          data-testid="action-success-alert"
        >
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-medium">{actionSuccess}</span>
        </div>
      )}

      {/* Verification Decision Workspace Panel */}
      {activeProfile && (
        <div className="space-y-6" data-testid="verification-workspace-panel">
          {/* Profile Overview Card */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                      Provider Record
                    </span>
                    <Badge
                      variant={
                        activeProfile.verificationStatus === "APPROVED_VERIFIED"
                          ? "admin"
                          : activeProfile.verificationStatus === "REJECTED"
                          ? "destructive"
                          : "outline"
                      }
                      className="text-[10px] font-bold uppercase tracking-wider"
                      data-testid="active-profile-status-badge"
                    >
                      {activeProfile.verificationStatus}
                    </Badge>
                  </div>
                  <CardTitle className="text-lg font-mono mt-1">
                    #{activeProfile.id}
                  </CardTitle>
                </div>
                <div className="text-xs text-muted-foreground text-right">
                  Provider Type: <span className="font-semibold text-foreground">{providerType}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <div className="p-3.5 rounded-lg bg-muted/40 border border-border text-xs space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="font-semibold text-muted-foreground block">
                      Target Entity ID:
                    </span>
                    <span className="font-mono text-foreground">{activeProfile.id}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-muted-foreground block">
                      Verification State:
                    </span>
                    <span className="font-bold text-primary">{activeProfile.verificationStatus}</span>
                  </div>
                </div>

                {activeProfile.verificationNotes && (
                  <div className="pt-2 border-t border-border/60">
                    <span className="font-semibold text-muted-foreground block">Previous Review Notes:</span>
                    <p className="text-foreground italic mt-0.5">{activeProfile.verificationNotes}</p>
                  </div>
                )}
              </div>

              {/* Document Privacy Notice */}
              <div className="p-3 rounded-lg bg-muted/20 border border-border text-xs text-muted-foreground flex items-start gap-2">
                <FileText className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
                <div>
                  <span className="font-semibold text-foreground">Storage Security Policy: </span>
                  Internal document storage keys (<code className="font-mono">fileKey</code>) are sanitized by backend privacy filters. Raw credential files are kept in private cloud buckets.
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Decision Mutation Form */}
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary" />
                2. Formulate Administrative Decision
              </CardTitle>
              <CardDescription>
                Select a valid state machine transition and record clinical or regulatory review notes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDecisionSubmit} className="space-y-4">
                {/* Decision Radio/Button Group */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold block">Decision Action *</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Decision Option 1: APPROVE */}
                    <button
                      type="button"
                      onClick={() => setSelectedDecision("APPROVED_VERIFIED")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selectedDecision === "APPROVED_VERIFIED"
                          ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 shadow-xs"
                          : "border-border hover:bg-muted/40 text-foreground"
                      }`}
                      data-testid="decision-approve-btn"
                    >
                      <div className="flex items-center gap-2 font-bold text-xs">
                        <CheckCircle2 className="size-4 text-emerald-600" />
                        Approve & Certify
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Credentials verified. Activates provider directory listing.
                      </p>
                    </button>

                    {/* Decision Option 2: REQUEST INFO or UNDER REVIEW */}
                    {providerType === "DOCTOR" ? (
                      <button
                        type="button"
                        onClick={() => setSelectedDecision("INFO_REQUESTED")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selectedDecision === "INFO_REQUESTED"
                            ? "border-amber-500 bg-amber-50/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 shadow-xs"
                            : "border-border hover:bg-muted/40 text-foreground"
                        }`}
                        data-testid="decision-info-requested-btn"
                      >
                        <div className="flex items-center gap-2 font-bold text-xs">
                          <HelpCircle className="size-4 text-amber-600" />
                          Request More Info
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Requests license clarification from doctor.
                        </p>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedDecision("LICENSE_VERIFYING")}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          selectedDecision === "LICENSE_VERIFYING"
                            ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-xs"
                            : "border-border hover:bg-muted/40 text-foreground"
                        }`}
                        data-testid="decision-license-verifying-btn"
                      >
                        <div className="flex items-center gap-2 font-bold text-xs">
                          <Clock className="size-4 text-blue-600" />
                          Mark Under Review
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Begins active state pharmacy license verification.
                        </p>
                      </button>
                    )}

                    {/* Decision Option 3: REJECT */}
                    <button
                      type="button"
                      onClick={() => setSelectedDecision("REJECTED")}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        selectedDecision === "REJECTED"
                          ? "border-destructive bg-destructive/10 text-destructive shadow-xs"
                          : "border-border hover:bg-muted/40 text-foreground"
                      }`}
                      data-testid="decision-reject-btn"
                    >
                      <div className="flex items-center gap-2 font-bold text-xs">
                        <XCircle className="size-4 text-destructive" />
                        Reject Credentials
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Disqualifies credentials with documented reason.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Review Notes Textarea */}
                <div className="space-y-1.5">
                  <Label htmlFor="verification-notes" className="text-xs font-semibold">
                    Review Notes (Mandatory for Audit Trail) *
                  </Label>
                  <textarea
                    id="verification-notes"
                    rows={4}
                    value={reviewNotes}
                    onChange={(e) => {
                      setReviewNotes(e.target.value);
                      if (notesError) setNotesError(null);
                    }}
                    placeholder="Provide specific justification (minimum 5 characters). Example: Verified registration number with State Medical Council database on official register..."
                    className="w-full rounded-md border border-input bg-background p-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    data-testid="review-notes-input"
                  />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>Enforced min length: 5 characters</span>
                    <span>{reviewNotes.length} chars</span>
                  </div>

                  {notesError && (
                    <p className="text-xs text-destructive font-medium" data-testid="notes-error-msg">
                      {notesError}
                    </p>
                  )}
                </div>

                {/* Submit Action */}
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isSubmittingDecision || !selectedDecision}
                    className="gap-2"
                    data-testid="submit-verification-btn"
                  >
                    {isSubmittingDecision && <Loader2 className="size-3.5 animate-spin" />}
                    Confirm & Submit Decision
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
