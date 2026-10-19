import * as React from "react";
import { Link } from "react-router-dom";
import {
  Pill,
  ClipboardList,
  AlertTriangle,
  Building2,
  ShieldCheck,
  Clock,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Truck,
  PackageX,
} from "lucide-react";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export type PharmacyVerificationStatus =
  | "UNSUBMITTED"
  | "PENDING_REVIEW"
  | "APPROVED_VERIFIED"
  | "REJECTED"
  | "SUSPENDED";

export interface PharmacyProfileData {
  _id?: string;
  id?: string;
  userId: string;
  pharmacyName: string;
  ownerName: string;
  licenseNumber: string;
  phone: string;
  email?: string;
  address?: {
    street?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  openingHours?: {
    openTime: string;
    closeTime: string;
    closedDays?: string[];
  };
  verificationStatus: PharmacyVerificationStatus;
  deliveryAvailable: boolean;
  serviceArea: string[];
  rating: number;
  totalReviews: number;
}

export interface InventoryItemSummary {
  _id: string;
  pharmacyId: string;
  medicineId: {
    _id: string;
    name: string;
    genericName?: string;
    dosageForm?: string;
    strength?: string;
    manufacturer?: string;
    prescriptionRequired?: boolean;
  };
  quantity: number;
  reservedQuantity: number;
  price?: number;
  unitPrice?: number;
  batchNumber?: string;
  expiryDate?: string;
  isAvailable: boolean;
  lowStockThreshold: number;
  reorderQuantity: number;
  updatedAt?: string;
}

export interface InventoryResponseData {
  inventory: InventoryItemSummary[];
  total: number;
  page: number;
  limit: number;
}

export function PharmacyDashboard() {
  const { user } = useAuthStore();

  const [profile, setProfile] = React.useState<PharmacyProfileData | null>(null);
  const [recentItems, setRecentItems] = React.useState<InventoryItemSummary[]>([]);
  const [totalInventoryCount, setTotalInventoryCount] = React.useState<number | null>(null);
  const [lowStockCount, setLowStockCount] = React.useState<number>(0);
  const [outOfStockCount, setOutOfStockCount] = React.useState<number>(0);
  const [lastRefreshedAt, setLastRefreshedAt] = React.useState<Date>(new Date());

  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const fetchDashboardData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);

    try {
      // Parallel fetch of real pharmacy profile and inventory list
      const [profileRes, inventoryRes] = await Promise.allSettled([
        api.get<{ success: boolean; data: PharmacyProfileData }>("/pharmacies/me/profile"),
        api.get<{ success: boolean; data: InventoryResponseData }>("/pharmacies/me/inventory", {
          params: {
            limit: 50,
            sort: "updatedAt",
            order: "desc",
          },
        }),
      ]);

      if (profileRes.status === "fulfilled") {
        const val = profileRes.value;
        const profileData = (val as any)?.data !== undefined ? (val as any).data : val;
        setProfile(profileData || null);
      }

      if (inventoryRes.status === "fulfilled") {
        const val = inventoryRes.value;
        const invData = (val as any)?.data !== undefined ? (val as any).data : val;
        const items: InventoryItemSummary[] = Array.isArray(invData)
          ? invData
          : Array.isArray(invData?.inventory)
          ? invData.inventory
          : Array.isArray(invData?.items)
          ? invData.items
          : [];

        setTotalInventoryCount((val as any)?.meta?.total ?? invData?.total ?? items.length);
        setRecentItems(items.slice(0, 5));

        // Derive authoritative stock thresholds
        const lowStock = items.filter(
          (item) => item.quantity > 0 && item.quantity <= (item.lowStockThreshold || 10)
        ).length;
        const outOfStock = items.filter((item) => item.quantity === 0).length;

        setLowStockCount(lowStock);
        setOutOfStockCount(outOfStock);
      }

      if (profileRes.status === "rejected" || inventoryRes.status === "rejected") {
        const err =
          profileRes.status === "rejected"
            ? profileRes.reason
            : (inventoryRes as PromiseRejectedResult).reason;
        setErrorMsg(
          (err && typeof err === "object" && "message" in err && typeof (err as any).message === "string")
            ? (err as any).message
            : "Failed to load pharmacy workstation data. Please try again."
        );
      }

      setLastRefreshedAt(new Date());
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await fetchDashboardData();
  };

  const getVerificationBadge = (status?: PharmacyVerificationStatus) => {
    switch (status) {
      case "APPROVED_VERIFIED":
        return (
          <Badge variant="default" className="text-xs bg-emerald-600 hover:bg-emerald-600 font-semibold gap-1">
            <ShieldCheck className="size-3.5" /> Verified Retail Pharmacy
          </Badge>
        );
      case "PENDING_REVIEW":
        return (
          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400 gap-1">
            <Clock className="size-3.5" /> License Under Review
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge variant="destructive" className="text-xs font-semibold gap-1">
            <AlertCircle className="size-3.5" /> License Rejected
          </Badge>
        );
      case "SUSPENDED":
        return (
          <Badge variant="destructive" className="text-xs font-semibold gap-1">
            <AlertTriangle className="size-3.5" /> Account Suspended
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
            Unsubmitted License
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6" data-testid="pharmacy-dashboard">
      {/* PHARMACY WELCOME BANNER */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-amber-500/10 via-background to-primary/5 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge variant="pharmacy" className="text-xs uppercase font-bold tracking-wider">
                Pharmacy Workstation
              </Badge>
              {getVerificationBadge(profile?.verificationStatus)}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {profile?.pharmacyName || user?.fullName || "LifeLine Partner Pharmacy"}
            </h1>

            <p className="text-sm text-muted-foreground max-w-xl">
              {profile?.licenseNumber ? `Retail License: ${profile.licenseNumber} · ` : ""}
              {profile?.ownerName ? `Owner: ${profile.ownerName} · ` : ""}
              {profile?.address?.city ? `${profile.address.city}, ${profile.address.state}` : "Registered Dispensing Center"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/pharmacy/orders">
              <Button size="sm" className="h-8 text-xs gap-1.5" data-testid="dashboard-orders-btn">
                <ClipboardList className="size-3.5" /> Order Queue
              </Button>
            </Link>
            <Link to="/pharmacy/inventory">
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" data-testid="dashboard-inventory-btn">
                <Pill className="size-3.5" /> Manage Inventory
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              data-testid="dashboard-refresh-btn"
              title="Refresh pharmacy data"
            >
              <RefreshCw className={`size-3.5 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
              Sync
            </Button>
          </div>
        </div>
      </div>

      {/* ERROR ALERT */}
      {errorMsg && (
        <ErrorAlert
          title="Pharmacy Workstation Notice"
          message={errorMsg}
          onRetry={fetchDashboardData}
          data-testid="pharmacy-dashboard-error-alert"
        />
      )}

      {/* LOADING STATE */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="pharmacy-dashboard-loading">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-28 rounded-xl bg-muted/40 animate-pulse border border-border/50" />
          ))}
        </div>
      ) : (
        /* METRIC CARDS */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="pharmacy-metrics-grid">
          {/* Card 1: Total Stocked Items */}
          <Card className="border border-border shadow-xs">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Total Stock Items
              </CardTitle>
              <Pill className="size-4 text-primary" />
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <div className="text-2xl font-black tracking-tight text-foreground" data-testid="metric-total-items">
                {totalInventoryCount !== null ? totalInventoryCount : "—"}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Active catalog SKUs in local storage
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Low Stock Alerts */}
          <Card className="border border-border shadow-xs">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Low Stock Alerts
              </CardTitle>
              <AlertTriangle className="size-4 text-amber-500" />
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <div
                className={`text-2xl font-black tracking-tight ${lowStockCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}
                data-testid="metric-low-stock"
              >
                {lowStockCount}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                At or below reorder threshold
              </p>
            </CardContent>
          </Card>

          {/* Card 3: Out of Stock */}
          <Card className="border border-border shadow-xs">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Out of Stock
              </CardTitle>
              <PackageX className="size-4 text-destructive" />
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <div
                className={`text-2xl font-black tracking-tight ${outOfStockCount > 0 ? "text-destructive" : "text-foreground"}`}
                data-testid="metric-out-of-stock"
              >
                {outOfStockCount}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Zero inventory available
              </p>
            </CardContent>
          </Card>

          {/* Card 4: Delivery Capability */}
          <Card className="border border-border shadow-xs">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Fulfillment Delivery
              </CardTitle>
              <Truck className="size-4 text-emerald-600 dark:text-emerald-400" />
            </CardHeader>
            <CardContent className="p-4 pt-1">
              <div className="text-lg font-bold tracking-tight text-foreground flex items-center gap-1.5" data-testid="metric-delivery-status">
                {profile?.deliveryAvailable ? (
                  <Badge variant="default" className="bg-emerald-600 text-[11px]">
                    Active Delivery
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[11px]">
                    Pickup Only
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {profile?.serviceArea && profile.serviceArea.length > 0
                  ? `${profile.serviceArea.length} delivery pin code zone(s)`
                  : "Local counter dispensing"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* QUICK WORKSTATION ACTIONS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link to="/pharmacy/inventory" className="block group">
          <Card className="h-full border border-border hover:border-primary/40 transition-all hover:shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-2">
                <Pill className="size-5" />
              </div>
              <CardTitle className="text-base font-bold text-foreground group-hover:text-primary transition-colors flex items-center justify-between">
                Drug Inventory Manager <ChevronRight className="size-4" />
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Search stock, adjust quantities, update unit retail prices, and track batches and expiration dates.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link to="/pharmacy/orders" className="block group">
          <Card className="h-full border border-border hover:border-amber-500/40 transition-all hover:shadow-xs">
            <CardHeader className="p-5 pb-3">
              <div className="size-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-2">
                <ClipboardList className="size-5" />
              </div>
              <CardTitle className="text-base font-bold text-foreground group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors flex items-center justify-between">
                Order Intake & Rx Review <ChevronRight className="size-4" />
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Look up incoming orders, review digital prescriptions with checksums, approve dispensing, and update delivery statuses.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* RECENT STOCK PREVIEW */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <Building2 className="size-5 text-primary" /> Stock Inventory Snapshot
            </h2>
            <p className="text-xs text-muted-foreground">
              Recently updated pharmaceutical items in your pharmacy catalog
            </p>
          </div>

          <Link to="/pharmacy/inventory">
            <Button variant="ghost" size="sm" className="text-xs">
              View Full Inventory <ChevronRight className="size-3.5 ml-1" />
            </Button>
          </Link>
        </div>

        {recentItems.length === 0 && !isLoading ? (
          <EmptyState
            title="No Inventory Recorded"
            description="Your pharmacy currently has no medicines registered in local stock. Use the inventory manager to stock catalog medicines."
            icon={Pill}
            actionLabel="Add Medicine to Inventory"
            onAction={() => window.location.assign("/pharmacy/inventory")}
            data-testid="dashboard-empty-inventory"
          />
        ) : (
          <Card className="border border-border shadow-xs overflow-hidden" data-testid="dashboard-inventory-table">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                  <tr>
                    <th className="p-3">Medicine</th>
                    <th className="p-3">Dosage / Form</th>
                    <th className="p-3">Available Stock</th>
                    <th className="p-3">Unit Price</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recentItems.map((item) => {
                    const isLow = item.quantity > 0 && item.quantity <= (item.lowStockThreshold || 10);
                    const isOut = item.quantity === 0;

                    return (
                      <tr key={item._id} className="hover:bg-muted/20" data-testid={`inventory-row-${item._id}`}>
                        <td className="p-3">
                          <div className="font-semibold text-foreground">
                            {item.medicineId?.name || "Medicine Item"}
                          </div>
                          {item.batchNumber && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Batch: {item.batchNumber}
                            </span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="capitalize">{item.medicineId?.dosageForm?.toLowerCase() || "—"}</span>
                          {item.medicineId?.strength && (
                            <span className="text-muted-foreground"> · {item.medicineId.strength}</span>
                          )}
                        </td>
                        <td className="p-3 font-semibold">
                          <span className={isOut ? "text-destructive" : isLow ? "text-amber-600 dark:text-amber-400" : "text-foreground"}>
                            {item.quantity} units
                          </span>
                          {item.reservedQuantity > 0 && (
                            <span className="text-[10px] text-muted-foreground ml-1.5">
                              ({item.reservedQuantity} reserved)
                            </span>
                          )}
                        </td>
                        <td className="p-3 font-semibold text-foreground">
                          ₹{(item.unitPrice ?? item.price ?? 0).toFixed(2)}
                        </td>
                        <td className="p-3">
                          {isOut ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Out of Stock
                            </Badge>
                          ) : isLow ? (
                            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 dark:text-amber-400">
                              Low Stock ({item.quantity})
                            </Badge>
                          ) : (
                            <Badge variant="default" className="text-[10px] bg-emerald-600">
                              In Stock
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <Link to="/pharmacy/inventory">
                            <Button variant="ghost" size="sm" className="h-7 text-xs">
                              Manage
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* FOOTER SYNC STATUS */}
      <div className="text-[11px] text-muted-foreground flex items-center justify-between pt-2 border-t border-border">
        <span>Pharmacy Workspace · Derived from authenticated session</span>
        <span>Last synchronized: {lastRefreshedAt.toLocaleTimeString()}</span>
      </div>
    </div>
  );
}
