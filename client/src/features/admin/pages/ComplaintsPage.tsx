import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
  FileText,
} from "lucide-react";
import { api } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export type ComplaintCategory =
  | "APPOINTMENT"
  | "DOCTOR_CONDUCT"
  | "MEDICINE_QUALITY"
  | "DELIVERY"
  | "PAYMENT"
  | "OTHER";

export type ComplaintStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";

export type ComplaintPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface ComplaintResolution {
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
}

export interface ComplaintItem {
  _id: string;
  id?: string;
  complainantId: string;
  category: ComplaintCategory;
  subject: string;
  description: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  assignedTo?: string;
  resolution?: ComplaintResolution;
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function ComplaintsPage() {
  const [complaints, setComplaints] = React.useState<ComplaintItem[]>([]);
  const [pagination, setPagination] = React.useState<ComplaintsPagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });

  const [isLoading, setIsLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = React.useState<string>("ALL");
  const [priorityFilter, setPriorityFilter] = React.useState<string>("ALL");
  const [currentPage, setCurrentPage] = React.useState<number>(1);

  // Resolution Modal State
  const [selectedComplaint, setSelectedComplaint] = React.useState<ComplaintItem | null>(null);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [resolutionStatus, setResolutionStatus] = React.useState<"RESOLVED" | "REJECTED">("RESOLVED");
  const [resolutionNotes, setResolutionNotes] = React.useState("");
  const [notesError, setNotesError] = React.useState<string | null>(null);
  const [isSubmittingResolution, setIsSubmittingResolution] = React.useState(false);
  const [resolutionSuccessMsg, setResolutionSuccessMsg] = React.useState<string | null>(null);

  const fetchComplaints = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    const params: Record<string, any> = {
      page: currentPage,
      limit: 10,
    };

    if (statusFilter !== "ALL") params.status = statusFilter;
    if (categoryFilter !== "ALL") params.category = categoryFilter;
    if (priorityFilter !== "ALL") params.priority = priorityFilter;

    try {
      const res = await api.get<any>("/complaints", { params });
      const data = res?.data !== undefined ? res.data : res;
      const items: ComplaintItem[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.complaints)
        ? data.complaints
        : [];

      setComplaints(items);

      const pag = res?.pagination || data?.pagination;
      if (pag) {
        setPagination({
          page: pag.page || currentPage,
          limit: pag.limit || 10,
          total: pag.total ?? items.length,
          totalPages: pag.totalPages || Math.ceil((pag.total || items.length) / (pag.limit || 10)) || 1,
        });
      } else {
        setPagination({
          page: currentPage,
          limit: 10,
          total: items.length,
          totalPages: 1,
        });
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message || "Failed to retrieve platform complaints list. Please check connection and try again."
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, statusFilter, categoryFilter, priorityFilter]);

  React.useEffect(() => {
    fetchComplaints();
  }, [fetchComplaints]);

  const handleOpenDetailModal = (complaint: ComplaintItem) => {
    setSelectedComplaint(complaint);
    setResolutionStatus("RESOLVED");
    setResolutionNotes(complaint.resolution?.resolutionNotes || "");
    setNotesError(null);
    setResolutionSuccessMsg(null);
    setIsModalOpen(true);
  };

  const handleConfirmResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedComplaint) return;

    const trimmedNotes = resolutionNotes.trim();
    if (trimmedNotes.length < 5) {
      setNotesError("Resolution notes are required and must be at least 5 characters long for audit trail.");
      return;
    }

    setIsSubmittingResolution(true);
    setNotesError(null);

    try {
      const complaintId = selectedComplaint.id || selectedComplaint._id;
      const res = await api.patch<any>(`/complaints/${complaintId}/resolve`, {
        status: resolutionStatus,
        resolutionNotes: trimmedNotes,
      });

      const updated = res?.data !== undefined ? res.data : res;

      // Update in active modal
      setSelectedComplaint((prev) =>
        prev
          ? {
              ...prev,
              ...updated,
              status: resolutionStatus,
              resolution: {
                resolvedAt: new Date().toISOString(),
                resolutionNotes: trimmedNotes,
              },
            }
          : null
      );

      // Update in complaints table list
      setComplaints((prev) =>
        prev.map((c) =>
          (c.id || c._id) === complaintId
            ? {
                ...c,
                ...updated,
                status: resolutionStatus,
                resolution: {
                  resolvedAt: new Date().toISOString(),
                  resolutionNotes: trimmedNotes,
                },
              }
            : c
        )
      );

      setResolutionSuccessMsg(`Dispute successfully marked as ${resolutionStatus}.`);
    } catch (err: any) {
      setNotesError(err?.message || "Failed to resolve complaint. Please try again.");
    } finally {
      setIsSubmittingResolution(false);
    }
  };

  const getStatusBadge = (status: ComplaintStatus) => {
    switch (status) {
      case "OPEN":
        return <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-300 text-[10px]">OPEN</Badge>;
      case "UNDER_REVIEW":
        return <Badge variant="secondary" className="bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 text-[10px]">UNDER REVIEW</Badge>;
      case "RESOLVED":
        return <Badge variant="admin" className="text-[10px]">RESOLVED</Badge>;
      case "REJECTED":
        return <Badge variant="destructive" className="text-[10px]">REJECTED</Badge>;
      default:
        return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: ComplaintPriority) => {
    switch (priority) {
      case "URGENT":
        return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">URGENT</span>;
      case "HIGH":
        return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">HIGH</span>;
      case "MEDIUM":
        return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">MEDIUM</span>;
      case "LOW":
        return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">LOW</span>;
      default:
        return <span className="text-[10px]">{priority}</span>;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12" data-testid="complaints-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
              <AlertTriangle className="size-8 text-amber-600 shrink-0" />
              Disputes & Complaints Resolution Center
            </h1>
            <Badge variant="admin" className="uppercase font-semibold tracking-wider text-[10px]">
              ADMIN
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Platform-wide triage and resolution workflow for patient consultations, pharmacy quality, and payment grievances.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchComplaints}
          disabled={isLoading}
          className="gap-2 self-start sm:self-auto"
          data-testid="refresh-complaints-btn"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh Queue
        </Button>
      </div>

      {/* Filter Toolbar */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            {/* Status Filter */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Resolution Status</Label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="filter-status-select"
              >
                <option value="ALL">All Statuses</option>
                <option value="OPEN">Open (Unresolved)</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="RESOLVED">Resolved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            {/* Category Filter */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Complaint Category</Label>
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="filter-category-select"
              >
                <option value="ALL">All Categories</option>
                <option value="APPOINTMENT">Appointment & Timing</option>
                <option value="DOCTOR_CONDUCT">Doctor Professional Conduct</option>
                <option value="MEDICINE_QUALITY">Medicine Quality & Dispensing</option>
                <option value="DELIVERY">Delivery & Courier</option>
                <option value="PAYMENT">Payment & Billing</option>
                <option value="OTHER">Other Issue</option>
              </select>
            </div>

            {/* Priority Filter */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Priority Level</Label>
              <select
                value={priorityFilter}
                onChange={(e) => {
                  setPriorityFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="filter-priority-select"
              >
                <option value="ALL">All Priorities</option>
                <option value="URGENT">Urgent</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>

            {/* Reset Filters */}
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter("ALL");
                  setCategoryFilter("ALL");
                  setPriorityFilter("ALL");
                  setCurrentPage(1);
                }}
                className="h-8 w-full text-xs text-muted-foreground gap-1.5"
                data-testid="reset-filters-btn"
              >
                <X className="size-3.5" />
                Reset Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Alert */}
      {errorMsg && (
        <ErrorAlert
          title="Disputes Query Notice"
          message={errorMsg}
          onRetry={fetchComplaints}
          data-testid="complaints-error-alert"
        />
      )}

      {/* Complaints Data Table */}
      <Card className="border-border">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Retrieving platform disputes queue...</p>
          </div>
        ) : complaints.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={AlertTriangle}
              title="No Complaints Found"
              description="No grievances match your selected filter criteria. All platform operations are currently within SLA thresholds."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" data-testid="complaints-table">
              <thead className="bg-muted/60 text-muted-foreground font-semibold uppercase text-[11px] border-b border-border">
                <tr>
                  <th className="px-4 py-3">Dispute Subject & ID</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3 text-center">Priority</th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-3 py-3">Date Reported</th>
                  <th className="px-4 py-3 text-right">Administrative Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {complaints.map((c) => {
                  const id = c.id || c._id;
                  return (
                    <tr key={id} className="hover:bg-muted/30 transition-colors" data-testid={`complaint-row-${id}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{c.subject}</div>
                        <div className="text-[11px] font-mono text-muted-foreground">#{id.slice(-8)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-medium text-foreground">{c.category.replace(/_/g, " ")}</span>
                      </td>
                      <td className="px-3 py-3 text-center">{getPriorityBadge(c.priority)}</td>
                      <td className="px-3 py-3 text-center">{getStatusBadge(c.status)}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenDetailModal(c)}
                          className="h-7 text-xs px-2.5"
                          data-testid={`review-complaint-btn-${id}`}
                        >
                          Review Dispute
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {!isLoading && complaints.length > 0 && (
          <div className="p-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
            <div>
              Showing <span className="font-semibold text-foreground">{complaints.length}</span> of{" "}
              <span className="font-semibold text-foreground">{pagination.total}</span> disputes (Page {pagination.page} of {pagination.totalPages})
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={pagination.page <= 1}
                className="h-7 px-2.5 text-xs gap-1"
                data-testid="prev-page-btn"
              >
                <ChevronLeft className="size-3.5" /> Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(p + 1, pagination.totalPages))}
                disabled={pagination.page >= pagination.totalPages}
                className="h-7 px-2.5 text-xs gap-1"
                data-testid="next-page-btn"
              >
                Next <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Dispute Review & Resolution Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden" data-testid="resolution-dialog">
          {selectedComplaint && (
            <>
              <DialogHeader className="p-5 pb-3 border-b border-border bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <DialogTitle className="text-base font-bold flex items-center gap-2">
                      <FileText className="size-4 text-primary" />
                      Dispute Investigation & Resolution
                    </DialogTitle>
                    {getStatusBadge(selectedComplaint.status)}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    #{selectedComplaint.id || selectedComplaint._id}
                  </span>
                </div>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  Examine the filed grievance, inspect related transaction details, and record a binding resolution.
                </DialogDescription>
              </DialogHeader>

              <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto text-xs">
                {resolutionSuccessMsg && (
                  <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                    <span>{resolutionSuccessMsg}</span>
                  </div>
                )}

                {/* Dispute Metadata Details */}
                <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-2">
                  <div>
                    <span className="font-semibold text-muted-foreground block">Subject:</span>
                    <span className="text-sm font-bold text-foreground">{selectedComplaint.subject}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-border/60">
                    <div>
                      <span className="text-muted-foreground block font-medium">Category:</span>
                      <span className="font-semibold text-foreground">{selectedComplaint.category.replace(/_/g, " ")}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-medium">Priority:</span>
                      <div>{getPriorityBadge(selectedComplaint.priority)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground block font-medium">Reported Date:</span>
                      <span className="text-foreground">{new Date(selectedComplaint.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {selectedComplaint.relatedEntityType && (
                    <div className="pt-1 text-[11px] text-muted-foreground">
                      Related: <span className="font-mono text-foreground">{selectedComplaint.relatedEntityType} #{selectedComplaint.relatedEntityId}</span>
                    </div>
                  )}
                </div>

                {/* Complainant Statement */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Complainant Narrative / Description</Label>
                  <div className="p-3 rounded-md bg-muted/20 border border-border text-foreground leading-relaxed whitespace-pre-wrap">
                    {selectedComplaint.description}
                  </div>
                </div>

                {/* Prior Resolution If Available */}
                {selectedComplaint.resolution?.resolutionNotes && (
                  <div className="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 space-y-1">
                    <span className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                      Recorded Administrative Resolution ({selectedComplaint.status})
                    </span>
                    <p className="text-foreground italic">{selectedComplaint.resolution.resolutionNotes}</p>
                    {selectedComplaint.resolution.resolvedAt && (
                      <p className="text-[10px] text-muted-foreground">
                        Resolved on {new Date(selectedComplaint.resolution.resolvedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}

                {/* Administrative Resolution Form */}
                <form onSubmit={handleConfirmResolution} className="space-y-3 pt-2 border-t border-border">
                  <Label className="text-xs font-semibold text-foreground block">
                    Record Formal Administrative Decision *
                  </Label>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setResolutionStatus("RESOLVED")}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        resolutionStatus === "RESOLVED"
                          ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-bold"
                          : "border-border hover:bg-muted/40 text-foreground font-medium"
                      }`}
                      data-testid="status-resolve-radio"
                    >
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                        Resolve Dispute
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setResolutionStatus("REJECTED")}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        resolutionStatus === "REJECTED"
                          ? "border-destructive bg-destructive/10 text-destructive font-bold"
                          : "border-border hover:bg-muted/40 text-foreground font-medium"
                      }`}
                      data-testid="status-reject-radio"
                    >
                      <div className="flex items-center gap-1.5">
                        <XCircle className="size-3.5 text-destructive" />
                        Reject Dispute
                      </div>
                    </button>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="resolution-notes" className="text-xs font-semibold">
                      Resolution Notes (Mandatory for Audit Trail) *
                    </Label>
                    <textarea
                      id="resolution-notes"
                      rows={3}
                      value={resolutionNotes}
                      onChange={(e) => {
                        setResolutionNotes(e.target.value);
                        if (notesError) setNotesError(null);
                      }}
                      placeholder="Detail the investigative outcome and corrective actions taken (min 5 characters)..."
                      className="w-full rounded-md border border-input bg-background p-2.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid="resolution-notes-input"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Min length: 5 characters</span>
                      <span>{resolutionNotes.length} chars</span>
                    </div>

                    {notesError && (
                      <p className="text-xs text-destructive font-medium" data-testid="resolution-notes-error">
                        {notesError}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsModalOpen(false)}
                      disabled={isSubmittingResolution}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSubmittingResolution}
                      className="gap-2"
                      data-testid="confirm-resolution-btn"
                    >
                      {isSubmittingResolution && <Loader2 className="size-3.5 animate-spin" />}
                      Confirm Resolution & Update Status
                    </Button>
                  </div>
                </form>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
