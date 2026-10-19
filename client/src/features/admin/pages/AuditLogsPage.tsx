import * as React from "react";
import {
  ShieldCheck,
  Filter,
  X,
  Lock,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Info,
} from "lucide-react";
import { api } from "@/services/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export interface AuditLogEntry {
  _id: string;
  id?: string;
  actorId?: string;
  actorRole: "PATIENT" | "DOCTOR" | "PHARMACY" | "ADMIN" | "SYSTEM";
  action: string;
  resourceType: string;
  resourceId: string;
  patientId?: string;
  ipAddress?: string;
  userAgent?: string;
  status: "SUCCESS" | "FAILURE";
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogsPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function AuditLogsPage() {
  const [logs, setLogs] = React.useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = React.useState<AuditLogsPagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  const [isLoading, setIsLoading] = React.useState(true);
  const [isEndpointUnavailable, setIsEndpointUnavailable] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Filters
  const [actorId, setActorId] = React.useState("");
  const [action, setAction] = React.useState("");
  const [resourceType, setResourceType] = React.useState("");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [currentPage, setCurrentPage] = React.useState<number>(1);
  const [dateFilterError, setDateFilterError] = React.useState<string | null>(null);

  const fetchAuditLogs = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    setIsEndpointUnavailable(false);
    setDateFilterError(null);

    if (fromDate && toDate) {
      if (new Date(fromDate).getTime() > new Date(toDate).getTime()) {
        setDateFilterError("'From' date must be earlier than or equal to 'To' date.");
        setIsLoading(false);
        return;
      }
    }

    const params: Record<string, any> = {
      page: currentPage,
      limit: 20,
    };

    if (actorId.trim()) params.actorId = actorId.trim();
    if (action.trim()) params.action = action.trim();
    if (resourceType.trim()) params.resourceType = resourceType.trim();
    if (fromDate.trim()) params.from = new Date(fromDate).toISOString();
    if (toDate.trim()) params.to = new Date(toDate).toISOString();

    try {
      const res = await api.get<any>("/admin/audit-logs", { params });
      const data = res?.data !== undefined ? res.data : res;
      const items: AuditLogEntry[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.logs)
        ? data.logs
        : Array.isArray(data?.items)
        ? data.items
        : [];

      setLogs(items);

      const pag = res?.pagination || data?.pagination;
      if (pag) {
        setPagination({
          page: pag.page || currentPage,
          limit: pag.limit || 20,
          total: pag.total ?? items.length,
          totalPages: pag.totalPages || Math.ceil((pag.total || items.length) / (pag.limit || 20)) || 1,
        });
      } else {
        setPagination({
          page: currentPage,
          limit: 20,
          total: items.length,
          totalPages: 1,
        });
      }
    } catch (err: any) {
      // Check if backend returned HTTP 404 (endpoint unmounted)
      if (err?.status === 404 || err?.statusCode === 404 || err?.message?.includes("404")) {
        setIsEndpointUnavailable(true);
      } else {
        setErrorMsg(
          err?.message || "Failed to query system audit logs. Please check connection and try again."
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [actorId, action, resourceType, fromDate, toDate, currentPage]);

  React.useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchAuditLogs();
  };

  const handleResetFilters = () => {
    setActorId("");
    setAction("");
    setResourceType("");
    setFromDate("");
    setToDate("");
    setDateFilterError(null);
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12" data-testid="audit-logs-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldCheck className="size-8 text-primary shrink-0" />
              Administrative Audit Trail & Compliance Log
            </h1>
            <Badge variant="admin" className="uppercase font-semibold tracking-wider text-[10px]">
              ADMIN
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Immutable, append-only chronological log of security events, administrative certifications, and regulated healthcare transactions.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchAuditLogs}
          disabled={isLoading}
          className="gap-2 self-start sm:self-auto"
          data-testid="refresh-audit-logs-btn"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh Audit Trail
        </Button>
      </div>

      {/* Filter Toolbar Card */}
      <Card className="border-border">
        <CardContent className="p-4">
          <form onSubmit={handleApplyFilters} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {/* Actor ID Input */}
              <div className="space-y-1">
                <Label htmlFor="audit-actor-id" className="text-xs font-semibold">
                  Actor Identifier
                </Label>
                <Input
                  id="audit-actor-id"
                  placeholder="e.g. 64b8e2f0..."
                  value={actorId}
                  onChange={(e) => setActorId(e.target.value)}
                  className="text-xs h-8 font-mono"
                  data-testid="filter-actor-input"
                />
              </div>

              {/* Action Filter */}
              <div className="space-y-1">
                <Label htmlFor="audit-action" className="text-xs font-semibold">
                  Action Event
                </Label>
                <Input
                  id="audit-action"
                  placeholder="e.g. DOCTOR_VERIFICATION_APPROVED"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="text-xs h-8 font-mono"
                  data-testid="filter-action-input"
                />
              </div>

              {/* Resource Type */}
              <div className="space-y-1">
                <Label htmlFor="audit-resource" className="text-xs font-semibold">
                  Resource Type
                </Label>
                <Input
                  id="audit-resource"
                  placeholder="e.g. DoctorProfile, Order"
                  value={resourceType}
                  onChange={(e) => setResourceType(e.target.value)}
                  className="text-xs h-8"
                  data-testid="filter-resource-input"
                />
              </div>

              {/* Date From */}
              <div className="space-y-1">
                <Label htmlFor="audit-from" className="text-xs font-semibold">
                  From Date
                </Label>
                <Input
                  id="audit-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="text-xs h-8"
                  data-testid="filter-from-input"
                />
              </div>

              {/* Date To */}
              <div className="space-y-1">
                <Label htmlFor="audit-to" className="text-xs font-semibold">
                  To Date
                </Label>
                <Input
                  id="audit-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="text-xs h-8"
                  data-testid="filter-to-input"
                />
              </div>
            </div>

            {dateFilterError && (
              <p className="text-xs text-destructive font-medium" data-testid="audit-date-error">
                {dateFilterError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
              {(actorId || action || resourceType || fromDate || toDate) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilters}
                  className="h-8 text-xs text-muted-foreground gap-1"
                  data-testid="reset-audit-filters-btn"
                >
                  <X className="size-3.5" />
                  Clear Filters
                </Button>
              )}
              <Button type="submit" size="sm" className="h-8 gap-1.5 text-xs" data-testid="apply-audit-filters-btn">
                <Filter className="size-3.5" />
                Query Audit Trail
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Endpoint Unavailable Alert (HTTP 404 Disclosed Accurately) */}
      {isEndpointUnavailable && (
        <div
          className="rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/40 p-5 text-amber-900 dark:text-amber-200 space-y-2"
          data-testid="audit-unavailable-card"
        >
          <div className="flex items-center gap-2 font-bold text-sm">
            <Info className="size-5 text-amber-600 dark:text-amber-400 shrink-0" />
            Audit Log Query API Unavailable (HTTP 404)
          </div>
          <p className="text-xs leading-relaxed">
            The platform audit logging ingestion service (<code className="font-mono">auditLogService.log</code>) is actively recording immutable security entries in MongoDB, but the administrative query route{" "}
            <code className="font-mono font-semibold">GET /api/v1/admin/audit-logs</code> specified in API Contract Section 18.4 is currently unmounted on the backend server.
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            No production records could be displayed. Audit logs remain securely preserved in database storage and are accessible via command-line audit export tools.
          </p>
        </div>
      )}

      {/* Generic Error Alert */}
      {errorMsg && !isEndpointUnavailable && (
        <ErrorAlert
          title="Audit Log Query Error"
          message={errorMsg}
          onRetry={fetchAuditLogs}
          data-testid="audit-error-alert"
        />
      )}

      {/* Audit Log Table (Rendered when data is available) */}
      {!isEndpointUnavailable && (
        <Card className="border-border">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-3">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Querying append-only audit trail...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={Lock}
                title="No Audit Records Found"
                description="No system audit log entries matched your filter parameters."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs" data-testid="audit-logs-table">
                <thead className="bg-muted/60 text-muted-foreground font-semibold uppercase text-[11px] border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Timestamp (UTC)</th>
                    <th className="px-3 py-3">Actor (ID & Role)</th>
                    <th className="px-3 py-3">Action Event</th>
                    <th className="px-3 py-3">Resource Target</th>
                    <th className="px-3 py-3 text-center">Outcome</th>
                    <th className="px-4 py-3">Client IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.map((entry) => {
                    const id = entry.id || entry._id;
                    return (
                      <tr key={id} className="hover:bg-muted/20 transition-colors" data-testid={`audit-row-${id}`}>
                        <td className="px-4 py-3 font-mono text-muted-foreground whitespace-nowrap">
                          {new Date(entry.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-semibold text-foreground flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[10px] px-1 py-0 uppercase">
                              {entry.actorRole}
                            </Badge>
                          </div>
                          {entry.actorId && (
                            <div className="text-[11px] font-mono text-muted-foreground truncate max-w-[140px]">
                              {entry.actorId}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 font-mono font-medium text-foreground">
                          {entry.action}
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-foreground">{entry.resourceType}</div>
                          <div className="text-[11px] font-mono text-muted-foreground truncate max-w-[120px]">
                            #{entry.resourceId}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Badge
                            variant={entry.status === "SUCCESS" ? "admin" : "destructive"}
                            className="text-[10px]"
                          >
                            {entry.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground text-[11px]">
                          {entry.ipAddress || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Footer */}
          {!isLoading && logs.length > 0 && (
            <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <div>
                Showing <span className="font-semibold text-foreground">{logs.length}</span> of{" "}
                <span className="font-semibold text-foreground">{pagination.total}</span> audit records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  disabled={pagination.page <= 1}
                  className="h-7 px-2.5 text-xs gap-1"
                >
                  <ChevronLeft className="size-3.5" /> Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, pagination.totalPages))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="h-7 px-2.5 text-xs gap-1"
                >
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
