import * as React from "react";
import { Link } from "react-router-dom";
import {
  Users,
  DollarSign,
  CalendarCheck,
  PackageCheck,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  FileCheck2,
  Calendar,
  ArrowRight,
  Filter,
  X,
  Building2,
  Stethoscope,
  HeartPulse,
} from "lucide-react";
import { api } from "@/services/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/ui/feedback-states";

export interface CurrencyFinancialAggregate {
  currency: string;
  grossTransactionVolume: number;
  totalRefunds: number;
  netTransactionVolume: number;
  successfulTransactions: number;
  refundedTransactions: number;
}

export interface AdminOverviewMetrics {
  userMetrics: {
    totalUsers: number;
    activeUsers: number;
    byRole: Record<string, number>;
    byStatus: Record<string, number>;
  };
  financialMetrics: {
    grossTransactionVolume: number;
    totalRefunds: number;
    netTransactionVolume: number;
    currency: string;
    currencies: CurrencyFinancialAggregate[];
  };
  appointmentMetrics: {
    totalAppointments: number;
    completedAppointments: number;
    eligibleAppointments: number;
    completionRate: number;
    overallCompletionRate: number;
    byStatus: Record<string, number>;
  };
  orderMetrics: {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    byStatus: Record<string, number>;
  };
  period: {
    from?: string;
    to?: string;
  };
}

export function AdminDashboard() {
  const [metrics, setMetrics] = React.useState<AdminOverviewMetrics | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Date boundary filters
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [appliedFrom, setAppliedFrom] = React.useState<string | undefined>(undefined);
  const [appliedTo, setAppliedTo] = React.useState<string | undefined>(undefined);
  const [dateFilterError, setDateFilterError] = React.useState<string | null>(null);

  const fetchOverview = React.useCallback(
    async (from?: string, to?: string) => {
      setIsLoading(true);
      setErrorMsg(null);

      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;

      try {
        const res = await api.get<any>("/analytics/overview", { params });
        const data = res?.data !== undefined ? res.data : res;
        setMetrics(data || null);
      } catch (err: any) {
        setErrorMsg(
          err?.message || "Failed to load platform overview metrics. Please check connection and try again."
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  React.useEffect(() => {
    fetchOverview(appliedFrom, appliedTo);
  }, [fetchOverview, appliedFrom, appliedTo]);

  const handleApplyFilter = (e: React.FormEvent) => {
    e.preventDefault();
    setDateFilterError(null);

    if (fromDate && toDate) {
      const fromTime = new Date(fromDate).getTime();
      const toTime = new Date(toDate).getTime();
      if (fromTime > toTime) {
        setDateFilterError("'From' date must be earlier than or equal to 'To' date.");
        return;
      }
    }

    setAppliedFrom(fromDate ? new Date(fromDate).toISOString() : undefined);
    setAppliedTo(toDate ? new Date(toDate).toISOString() : undefined);
  };

  const handleResetFilter = () => {
    setFromDate("");
    setToDate("");
    setDateFilterError(null);
    setAppliedFrom(undefined);
    setAppliedTo(undefined);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchOverview(appliedFrom, appliedTo);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12" data-testid="admin-dashboard">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
              <ShieldCheck className="size-8 text-primary shrink-0" />
              Platform Operations Command Center
            </h1>
            <Badge variant="admin" className="uppercase font-semibold tracking-wider text-[10px]">
              ADMIN
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            System health, financial aggregations, user distribution, and clinical completion metrics.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading || isRefreshing}
            className="gap-2"
            data-testid="admin-refresh-btn"
          >
            <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Refresh Metrics
          </Button>
        </div>
      </div>

      {/* Date Filter Bar */}
      <Card className="border-border">
        <CardContent className="p-4">
          <form onSubmit={handleApplyFilter} className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="filter-from-date" className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-muted-foreground" />
                  From Date
                </Label>
                <Input
                  id="filter-from-date"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="text-xs h-8"
                  data-testid="filter-from-input"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="filter-to-date" className="text-xs font-semibold flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-muted-foreground" />
                  To Date
                </Label>
                <Input
                  id="filter-to-date"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="text-xs h-8"
                  data-testid="filter-to-input"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 sm:pt-0">
              <Button type="submit" size="sm" className="h-8 gap-1.5 text-xs" data-testid="apply-date-filter-btn">
                <Filter className="size-3.5" />
                Apply Filter
              </Button>

              {(fromDate || toDate || appliedFrom || appliedTo) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetFilter}
                  className="h-8 gap-1 text-xs text-muted-foreground"
                  data-testid="reset-date-filter-btn"
                >
                  <X className="size-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </form>

          {dateFilterError && (
            <p className="text-xs text-destructive mt-2 font-medium" data-testid="date-filter-error">
              {dateFilterError}
            </p>
          )}

          {(appliedFrom || appliedTo) && !dateFilterError && (
            <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
              <span>Active Period Filter:</span>
              <span className="font-medium text-foreground">
                {appliedFrom ? new Date(appliedFrom).toLocaleDateString() : "Beginning"} —{" "}
                {appliedTo ? new Date(appliedTo).toLocaleDateString() : "Now"}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Alert */}
      {errorMsg && (
        <ErrorAlert
          title="Analytics Overview Sync Error"
          message={errorMsg}
          onRetry={() => fetchOverview(appliedFrom, appliedTo)}
          data-testid="analytics-error-alert"
        />
      )}

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link to="/admin/verifications" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="size-9 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <FileCheck2 className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">Provider Verifications</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review credential documents & certify doctors and pharmacies.
            </p>
          </Card>
        </Link>

        <Link to="/admin/complaints" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="size-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <AlertTriangle className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">Disputes & Complaints</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Triage user grievances and record formal administrative resolutions.
            </p>
          </Card>
        </Link>

        <Link to="/admin/audit-logs" className="group">
          <Card className="h-full border-border hover:border-primary/50 transition-all hover:shadow-xs p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="size-9 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                <ShieldCheck className="size-5" />
              </div>
              <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-0.5" />
            </div>
            <h3 className="font-bold text-sm text-foreground">Audit Log Viewer</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Inspect immutable system audit trail and compliance history.
            </p>
          </Card>
        </Link>
      </div>

      {/* Main Metrics KPI Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-5 animate-pulse">
              <div className="h-4 w-24 bg-muted rounded mb-3" />
              <div className="h-8 w-32 bg-muted rounded mb-2" />
              <div className="h-3 w-40 bg-muted/60 rounded" />
            </Card>
          ))}
        </div>
      ) : metrics ? (
        <div className="space-y-6">
          {/* Top 4 Primary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Users */}
            <Card className="border-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Total Users
                  </span>
                  <div className="size-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <Users className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-extrabold text-foreground" data-testid="metric-total-users">
                    {metrics.userMetrics.totalUsers.toLocaleString()}
                  </span>
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    {metrics.userMetrics.activeUsers.toLocaleString()} active
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">Platform registered user accounts</p>
              </CardContent>
            </Card>

            {/* Gross Transaction Volume */}
            <Card className="border-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Gross Volume (GTV)
                  </span>
                  <div className="size-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <DollarSign className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-extrabold text-foreground" data-testid="metric-gtv">
                    ₹{metrics.financialMetrics.grossTransactionVolume.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Net: ₹{metrics.financialMetrics.netTransactionVolume.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (₹{metrics.financialMetrics.totalRefunds.toLocaleString("en-IN", { minimumFractionDigits: 2 })} refunds)
                </p>
              </CardContent>
            </Card>

            {/* Consultations Completion Rate */}
            <Card className="border-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Consultation Rate
                  </span>
                  <div className="size-8 rounded-lg bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <CalendarCheck className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-extrabold text-foreground" data-testid="metric-completion-rate">
                    {metrics.appointmentMetrics.completionRate}%
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({metrics.appointmentMetrics.completedAppointments}/{metrics.appointmentMetrics.eligibleAppointments})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {metrics.appointmentMetrics.totalAppointments} total scheduled consultations
                </p>
              </CardContent>
            </Card>

            {/* Medicine Orders Delivered */}
            <Card className="border-border">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Orders Fulfilled
                  </span>
                  <div className="size-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                    <PackageCheck className="size-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl sm:text-3xl font-extrabold text-foreground" data-testid="metric-delivered-orders">
                    {metrics.orderMetrics.deliveredOrders.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    of {metrics.orderMetrics.totalOrders.toLocaleString()} total
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {metrics.orderMetrics.cancelledOrders} cancelled / returned
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Categorical Breakdown Grids */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* User Breakdown by Role */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="size-4 text-primary" />
                  User Account Distribution by Role
                </CardTitle>
                <CardDescription>
                  Registered healthcare providers, consumers, and administrative actors
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                {Object.entries({
                  PATIENT: { label: "Patients", count: metrics.userMetrics.byRole?.PATIENT || 0, color: "bg-blue-500", icon: HeartPulse },
                  DOCTOR: { label: "Doctors", count: metrics.userMetrics.byRole?.DOCTOR || 0, color: "bg-emerald-500", icon: Stethoscope },
                  PHARMACY: { label: "Pharmacies", count: metrics.userMetrics.byRole?.PHARMACY || 0, color: "bg-amber-500", icon: Building2 },
                  ADMIN: { label: "Administrators", count: metrics.userMetrics.byRole?.ADMIN || 0, color: "bg-purple-500", icon: ShieldCheck },
                }).map(([role, data]) => {
                  const total = metrics.userMetrics.totalUsers || 1;
                  const pct = Math.round((data.count / total) * 100);
                  const Icon = data.icon;

                  return (
                    <div key={role} className="space-y-1.5" data-testid={`role-stat-${role.toLowerCase()}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground flex items-center gap-1.5">
                          <Icon className="size-3.5 text-muted-foreground" />
                          {data.label}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {data.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${data.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Appointment Consultation Status Breakdown */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="size-4 text-primary" />
                  Consultation Lifecycle Statuses
                </CardTitle>
                <CardDescription>
                  Real-time status breakdown across all platform appointments
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-1">
                {Object.entries({
                  COMPLETED: { label: "Completed", count: metrics.appointmentMetrics.byStatus?.COMPLETED || 0, color: "bg-emerald-500" },
                  CONFIRMED: { label: "Confirmed / Scheduled", count: metrics.appointmentMetrics.byStatus?.CONFIRMED || 0, color: "bg-blue-500" },
                  IN_PROGRESS: { label: "In Progress", count: metrics.appointmentMetrics.byStatus?.IN_PROGRESS || 0, color: "bg-purple-500" },
                  PENDING_PAYMENT: { label: "Pending Payment", count: metrics.appointmentMetrics.byStatus?.PENDING_PAYMENT || 0, color: "bg-amber-500" },
                  CANCELLED: { label: "Cancelled", count: metrics.appointmentMetrics.byStatus?.CANCELLED || 0, color: "bg-zinc-400" },
                  REJECTED: { label: "Rejected / Declined", count: metrics.appointmentMetrics.byStatus?.REJECTED || 0, color: "bg-rose-500" },
                }).map(([statusKey, data]) => {
                  const total = metrics.appointmentMetrics.totalAppointments || 1;
                  const pct = Math.round((data.count / total) * 100);

                  return (
                    <div key={statusKey} className="space-y-1.5" data-testid={`appt-stat-${statusKey.toLowerCase()}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">{data.label}</span>
                        <span className="font-mono text-muted-foreground">
                          {data.count.toLocaleString()} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full ${data.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
}
