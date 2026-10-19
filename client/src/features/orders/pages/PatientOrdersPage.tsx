import * as React from "react";
import {
  Package,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  Pill,
  MapPin,
  Loader2,
  Info,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export type OrderStatus =
  | "PLACED"
  | "PRESCRIPTION_REVIEW"
  | "PREPARING"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "REJECTED"
  | "REFUND_PENDING"
  | "REFUNDED";

export interface OrderItem {
  medicineId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface PatientOrder {
  _id: string;
  patientId: string;
  pharmacyId: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  paymentStatus: "PENDING" | "PAID" | "REFUND_PENDING" | "REFUNDED" | "FAILED";
  prescriptionReviewStatus?: "PENDING" | "APPROVED" | "REJECTED" | "NOT_REQUIRED";
  deliveryAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface OrderResponse {
  success: boolean;
  data: PatientOrder;
}

const ORDER_TIMELINE_STEPS: OrderStatus[] = [
  "PLACED",
  "PRESCRIPTION_REVIEW",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export function PatientOrdersPage() {
  const [lookupOrderId, setLookupOrderId] = React.useState("");
  const [activeOrder, setActiveOrder] = React.useState<PatientOrder | null>(null);
  const [sessionOrderIds, setSessionOrderIds] = React.useState<string[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const fetchOrderById = async (orderId: string) => {
    const trimmed = orderId.trim();
    if (!trimmed) return;

    if (!/^[0-9a-fA-F]{24}$/.test(trimmed)) {
      setErrorMsg("Invalid order ID format. Order IDs must be 24-character hexadecimal strings.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await api.get<OrderResponse>(`/orders/${trimmed}`);
      setActiveOrder(res.data);
      // Add to session list if not already recorded
      setSessionOrderIds((prev) => {
        if (prev.includes(trimmed)) return prev;
        return [trimmed, ...prev];
      });
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setErrorMsg(`Medicine order '${trimmed}' was not found.`);
        } else if (err.status === 403) {
          setErrorMsg("Access Denied: You do not have permission to view this order.");
        } else {
          setErrorMsg(err.message || "Failed to retrieve order details.");
        }
      } else {
        setErrorMsg("Network error retrieving order details.");
      }
      setActiveOrder(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrderById(lookupOrderId);
  };

  // Helper to determine step status in visual pipeline
  const getStepState = (
    stepName: OrderStatus,
    currentStatus: OrderStatus
  ): "completed" | "current" | "upcoming" | "inactive" => {
    // If order was cancelled, rejected, or refunded, pipeline stops
    if (["CANCELLED", "REJECTED", "REFUND_PENDING", "REFUNDED"].includes(currentStatus)) {
      return "inactive";
    }

    const currentIndex = ORDER_TIMELINE_STEPS.indexOf(currentStatus);
    const stepIndex = ORDER_TIMELINE_STEPS.indexOf(stepName);

    if (stepIndex < currentIndex) return "completed";
    if (stepIndex === currentIndex) return "current";
    return "upcoming";
  };

  return (
    <div className="space-y-6" data-testid="patient-orders-page">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Medicine Orders & Fulfillment
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track pharmacy prescription reviews, medication preparation, and delivery progress.
          </p>
        </div>
      </div>

      {/* SESSION & BACKEND CONTRACT LIMITATION NOTICE */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/30 p-4 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-3">
        <Info className="size-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Order Scope & Security</p>
          <p className="text-blue-800/90 dark:text-blue-300/90">
            The LifeLine API supports single-order lookups (`GET /api/v1/orders/:id`) without a public collection endpoint. Orders tracked below represent lookups performed during your active session.
          </p>
        </div>
      </div>

      {/* LOOKUP SEARCH BAR */}
      <Card className="border border-border shadow-xs">
        <CardContent className="p-4 sm:p-5">
          <form onSubmit={handleLookupSubmit} className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Enter 24-character Order ID (e.g. 64b8e2f01a...)"
                className="pl-9 font-mono text-xs"
                value={lookupOrderId}
                onChange={(e) => setLookupOrderId(e.target.value)}
                data-testid="order-lookup-input"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={isLoading || !lookupOrderId.trim()}
              className="w-full sm:w-auto"
              data-testid="order-lookup-button"
            >
              {isLoading ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Tracking...
                </>
              ) : (
                <>
                  <Package className="size-3.5 mr-1.5" /> Track Order
                </>
              )}
            </Button>
          </form>

          {/* Quick-select chips for session order IDs */}
          {sessionOrderIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-3 mt-3 border-t border-border/60 text-xs">
              <span className="text-muted-foreground">Recent Lookups:</span>
              {sessionOrderIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setLookupOrderId(id);
                    fetchOrderById(id);
                  }}
                  className={`font-mono px-2 py-0.5 rounded-md border text-[11px] transition-colors ${
                    activeOrder?._id === id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/40 hover:bg-muted text-foreground border-border"
                  }`}
                >
                  {id.slice(-8)}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ERROR FEEDBACK */}
      {errorMsg && (
        <ErrorAlert
          title="Order Tracking Error"
          message={errorMsg}
          onRetry={() => lookupOrderId && fetchOrderById(lookupOrderId)}
          data-testid="order-error-alert"
        />
      )}

      {/* LOADING SKELETON */}
      {isLoading && (
        <Card className="border border-border p-6 space-y-4 animate-pulse">
          <div className="h-6 w-1/3 bg-muted rounded" />
          <div className="h-20 w-full bg-muted/60 rounded-xl" />
          <div className="h-40 w-full bg-muted/40 rounded-xl" />
        </Card>
      )}

      {/* ACTIVE ORDER DETAILS */}
      {!isLoading && activeOrder && (
        <div className="space-y-6" data-testid="active-order-display">
          {/* ORDER SUMMARY BANNER */}
          <Card className="border border-border shadow-xs overflow-hidden">
            <CardHeader className="bg-muted/20 p-5 border-b border-border">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg font-bold">
                      Order #{activeOrder._id.slice(-8).toUpperCase()}
                    </CardTitle>
                    <Badge
                      variant={
                        activeOrder.status === "DELIVERED"
                          ? "default"
                          : ["CANCELLED", "REJECTED"].includes(activeOrder.status)
                          ? "destructive"
                          : "outline"
                      }
                      className="uppercase text-[10px] font-bold tracking-wider"
                      data-testid="order-status-badge"
                    >
                      {activeOrder.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-muted-foreground mt-0.5">
                    Placed on {new Date(activeOrder.createdAt).toLocaleString()}
                  </CardDescription>
                </div>

                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Payment</span>
                    <span className="font-semibold text-foreground">
                      {activeOrder.paymentStatus}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-muted-foreground block text-[11px]">Total</span>
                    <span className="text-base font-extrabold text-primary">
                      ₹{activeOrder.totalAmount}
                    </span>
                  </div>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-6">
              {/* TERMINAL STATUS ALERTS */}
              {activeOrder.status === "CANCELLED" && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-center gap-3">
                  <XCircle className="size-5 shrink-0 text-rose-600" />
                  <div>
                    <p className="font-semibold">Order Cancelled</p>
                    <p>This order was cancelled and is no longer being processed.</p>
                  </div>
                </div>
              )}

              {activeOrder.status === "REJECTED" && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200 flex items-center gap-3">
                  <XCircle className="size-5 shrink-0 text-rose-600" />
                  <div>
                    <p className="font-semibold">Prescription Rejected</p>
                    <p>The dispensing pharmacy rejected the attached prescription.</p>
                  </div>
                </div>
              )}

              {activeOrder.status === "REFUND_PENDING" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200 flex items-center gap-3">
                  <Clock className="size-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold">Refund Pending Processing</p>
                    <p>
                      Your refund has been registered and is pending gateway batch settlement. (Note: Not yet completed).
                    </p>
                  </div>
                </div>
              )}

              {activeOrder.status === "REFUNDED" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-center gap-3">
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                  <div>
                    <p className="font-semibold">Payment Fully Refunded</p>
                    <p>The total order amount of ₹{activeOrder.totalAmount} was refunded to original payment method.</p>
                  </div>
                </div>
              )}

              {/* FULFILLMENT TIMELINE PIPELINE */}
              {!["CANCELLED", "REJECTED", "REFUND_PENDING", "REFUNDED"].includes(activeOrder.status) && (
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Fulfillment Progress
                  </h4>

                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                    {ORDER_TIMELINE_STEPS.map((stepName, idx) => {
                      const state = getStepState(stepName, activeOrder.status);

                      return (
                        <div
                          key={stepName}
                          className={`p-2.5 rounded-lg border text-center transition-all ${
                            state === "completed"
                              ? "bg-emerald-50/50 border-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                              : state === "current"
                              ? "bg-primary/10 border-primary text-primary font-bold shadow-xs"
                              : "bg-muted/20 border-border/50 text-muted-foreground/60"
                          }`}
                        >
                          <div className="text-[10px] text-muted-foreground mb-0.5">
                            Step {idx + 1}
                          </div>
                          <div className="text-xs font-medium capitalize">
                            {stepName.toLowerCase().replace(/_/g, " ")}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ORDER ITEMS TABLE */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Prescription & Medicine Items
                </h4>

                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                      <tr>
                        <th className="p-3">Medicine Description</th>
                        <th className="p-3 text-center">Qty</th>
                        <th className="p-3 text-right">Price Snapshot</th>
                        <th className="p-3 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {activeOrder.items?.map((item, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-3 font-medium text-foreground flex items-center gap-2">
                            <Pill className="size-3.5 text-primary shrink-0" />
                            <span>{item.name}</span>
                          </td>
                          <td className="p-3 text-center">{item.quantity}</td>
                          <td className="p-3 text-right">₹{item.price}</td>
                          <td className="p-3 text-right font-semibold text-foreground">
                            ₹{item.price * item.quantity}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* DELIVERY ADDRESS */}
              {activeOrder.deliveryAddress && (
                <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs space-y-1">
                  <span className="font-semibold text-foreground flex items-center gap-1.5 mb-1">
                    <MapPin className="size-3.5 text-primary" /> Delivery Destination
                  </span>
                  <p className="text-muted-foreground">
                    {activeOrder.deliveryAddress.street}, {activeOrder.deliveryAddress.city},{" "}
                    {activeOrder.deliveryAddress.state} - {activeOrder.deliveryAddress.postalCode},{" "}
                    {activeOrder.deliveryAddress.country}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* EMPTY STATE WHEN NO ORDER SELECTED */}
      {!isLoading && !activeOrder && (
        <EmptyState
          title="No Order Selected for Tracking"
          description="Enter an order reference identifier above to view fulfillment stage, prescription review verification, and delivery timelines."
          icon={Package}
          data-testid="orders-empty-state"
        />
      )}
    </div>
  );
}
