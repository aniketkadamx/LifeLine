import * as React from "react";
import {
  ClipboardList,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Pill,
  MapPin,
  Loader2,
  AlertCircle,
  FileText,
  ShieldCheck,
  Truck,
  Package,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  History,
  Lock,
  RefreshCw,
  Info,
  FileImage,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { EmptyState, ErrorAlert } from "@/components/ui/feedback-states";

export type OrderStatus =
  | "PLACED"
  | "PRESCRIPTION_REVIEW"
  | "PHARMACY_ACCEPTED"
  | "PREPARING"
  | "READY_FOR_DELIVERY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED"
  | "REJECTED"
  | "FAILED"
  | "RETURNED";

export interface OrderItemSnapshot {
  medicineId: string;
  medicineName: string;
  dosageForm?: string;
  strength?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
}

export interface OrderPrescriptionReview {
  reviewedBy?: string;
  reviewedAt?: string;
  decision?: "APPROVE" | "REJECT";
  rejectionReason?: string;
}

export interface PharmacyOrder {
  _id: string;
  id?: string;
  patientId: string;
  pharmacyId: string;
  items: OrderItemSnapshot[];
  prescriptionId?: string;
  paymentId?: string;
  paymentStatus: "UNPAID" | "PENDING" | "PAID" | "REFUNDED" | "REFUND_PENDING";
  status: OrderStatus;
  deliveryAddress: {
    street?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  totals: OrderTotals;
  currency: string;
  deliveryNotes?: string;
  prescriptionReview?: OrderPrescriptionReview;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DigitalPrescriptionMedicine {
  medicineId: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  route: string;
  specialInstructions?: string;
}

export interface DigitalPrescription {
  _id: string;
  id?: string;
  patientId: string;
  doctorId: string;
  appointmentId?: string;
  status: string;
  diagnosis: string;
  medicines: DigitalPrescriptionMedicine[];
  additionalNotes?: string;
  issuedAt?: string;
  expiresAt: string;
  integrityChecksum?: string;
}

export interface DownloadUrlResponse {
  success: boolean;
  data: {
    downloadUrl: string;
    expiresInSeconds: number;
    recordId: string;
    fileName: string;
    fileType: string;
    sizeBytes: number;
  };
}

const SESSION_ORDERS_KEY = "lifeline_pharmacy_session_orders";

export function OrderReviewPage() {
  const [lookupOrderId, setLookupOrderId] = React.useState("");
  const [activeOrder, setActiveOrder] = React.useState<PharmacyOrder | null>(null);
  const [activePrescription, setActivePrescription] = React.useState<DigitalPrescription | null>(null);
  const [sessionOrderIds, setSessionOrderIds] = React.useState<string[]>(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_ORDERS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [isLoadingOrder, setIsLoadingOrder] = React.useState(false);
  const [isLoadingPrescription, setIsLoadingPrescription] = React.useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = React.useState(false);
  const [isSubmittingStatus, setIsSubmittingStatus] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = React.useState<string | null>(null);

  // Prescription Rejection Modal
  const [isRejectModalOpen, setIsRejectModalOpen] = React.useState(false);
  const [rejectionReason, setRejectionReason] = React.useState("");
  const [rejectionReasonError, setRejectionReasonError] = React.useState<string | null>(null);

  // Delivery OTP Modal
  const [isOtpModalOpen, setIsOtpModalOpen] = React.useState(false);
  const [deliveryOtp, setDeliveryOtp] = React.useState("");
  const [otpError, setOtpError] = React.useState<string | null>(null);

  // Medical Record Attachment Viewer Modal
  const [isAttachmentModalOpen, setIsAttachmentModalOpen] = React.useState(false);
  const [attachmentRecordId, setAttachmentRecordId] = React.useState("");
  const [attachmentDownloadUrl, setAttachmentDownloadUrl] = React.useState<string | null>(null);
  const [attachmentFileName, setAttachmentFileName] = React.useState<string | null>(null);
  const [attachmentFileType, setAttachmentFileType] = React.useState<string | null>(null);
  const [attachmentExpiresInSeconds, setAttachmentExpiresInSeconds] = React.useState<number | null>(null);
  const [isLoadingAttachment, setIsLoadingAttachment] = React.useState(false);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = React.useState(100);

  // Save session orders to sessionStorage
  const rememberOrder = (id: string) => {
    setSessionOrderIds((prev) => {
      const filtered = prev.filter((item) => item !== id);
      const updated = [id, ...filtered].slice(0, 15);
      try {
        sessionStorage.setItem(SESSION_ORDERS_KEY, JSON.stringify(updated));
      } catch {
        // Ignore storage exceptions
      }
      return updated;
    });
  };

  const clearSessionOrders = () => {
    try {
      sessionStorage.removeItem(SESSION_ORDERS_KEY);
    } catch {}
    setSessionOrderIds([]);
  };

  // Fetch Order by 24-char hex ID
  const fetchOrderById = async (orderId: string) => {
    const trimmed = orderId.trim();
    if (!trimmed) return;

    if (!/^[0-9a-fA-F]{24}$/.test(trimmed)) {
      setErrorMsg("Invalid order ID format. Order IDs must be 24-character hexadecimal strings.");
      return;
    }

    setIsLoadingOrder(true);
    setErrorMsg(null);
    setActionSuccessMsg(null);
    setActivePrescription(null);

    try {
      const res = await api.get<{ success: boolean; data: PharmacyOrder }>(`/orders/${trimmed}`);
      const order = res.data;
      setActiveOrder(order);
      rememberOrder(trimmed);

      // If prescription is attached, fetch structured digital prescription
      if (order.prescriptionId) {
        fetchPrescriptionById(order.prescriptionId);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setErrorMsg(`Medicine order '${trimmed}' was not found.`);
        } else if (err.status === 403) {
          setErrorMsg("Access Denied: You do not have permission to view this order. It belongs to a different pharmacy or tenant.");
        } else {
          setErrorMsg(err.message || "Failed to retrieve order details.");
        }
      } else {
        setErrorMsg("Network error connecting to order lookup service.");
      }
      setActiveOrder(null);
    } finally {
      setIsLoadingOrder(false);
    }
  };

  // Fetch Digital Prescription
  const fetchPrescriptionById = async (prescriptionId: string) => {
    setIsLoadingPrescription(true);
    try {
      const res = await api.get<{ success: boolean; data: DigitalPrescription }>(
        `/prescriptions/${prescriptionId}`
      );
      setActivePrescription(res.data);
    } catch (err: unknown) {
      // Non-fatal if prescription fails to load separately
      console.warn("Failed to load structured prescription:", err);
    } finally {
      setIsLoadingPrescription(false);
    }
  };

  const handleLookupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchOrderById(lookupOrderId);
  };

  // Prescription Review: APPROVE
  const handleApprovePrescription = async () => {
    if (!activeOrder || isSubmittingReview) return;

    setIsSubmittingReview(true);
    setErrorMsg(null);
    setActionSuccessMsg(null);

    try {
      const res = await api.patch<{ success: boolean; data: PharmacyOrder }>(
        `/orders/${activeOrder._id}/prescription-review`,
        { decision: "APPROVE" }
      );
      setActiveOrder(res.data);
      setActionSuccessMsg("Prescription verified and approved. Order status transitioned to PHARMACY_ACCEPTED.");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to approve prescription.");
      } else {
        setErrorMsg("Network error during prescription approval.");
      }
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Prescription Review: REJECT
  const handleRejectPrescription = async () => {
    if (!activeOrder || isSubmittingReview) return;

    const trimmedReason = rejectionReason.trim();
    if (!trimmedReason) {
      setRejectionReasonError("Rejection reason is strictly required.");
      return;
    }
    if (trimmedReason.length > 500) {
      setRejectionReasonError("Rejection reason cannot exceed 500 characters.");
      return;
    }

    setIsSubmittingReview(true);
    setRejectionReasonError(null);
    setErrorMsg(null);
    setActionSuccessMsg(null);

    try {
      const res = await api.patch<{ success: boolean; data: PharmacyOrder }>(
        `/orders/${activeOrder._id}/prescription-review`,
        { decision: "REJECT", rejectionReason: trimmedReason }
      );
      setActiveOrder(res.data);
      setIsRejectModalOpen(false);
      setRejectionReason("");
      setActionSuccessMsg("Prescription rejected. Order status set to REJECTED and reserved inventory released.");
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setRejectionReasonError(err.message || "Failed to reject prescription.");
      } else {
        setRejectionReasonError("Network error during prescription rejection.");
      }
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Advance Order Status along fulfillment state machine pipeline
  const handleAdvanceStatus = async (
    nextStatus: "PREPARING" | "READY_FOR_DELIVERY" | "OUT_FOR_DELIVERY" | "DELIVERED",
    otp?: string
  ) => {
    if (!activeOrder || isSubmittingStatus) return;

    setIsSubmittingStatus(true);
    setErrorMsg(null);
    setActionSuccessMsg(null);

    try {
      const payload: { status: string; deliveryOtp?: string } = { status: nextStatus };
      if (nextStatus === "DELIVERED" && otp) {
        payload.deliveryOtp = otp;
      }

      const res = await api.patch<{ success: boolean; data: PharmacyOrder }>(
        `/orders/${activeOrder._id}/status`,
        payload
      );
      setActiveOrder(res.data);
      if (nextStatus === "DELIVERED") {
        setIsOtpModalOpen(false);
        setDeliveryOtp("");
      }
      setActionSuccessMsg(`Order fulfillment updated to: ${nextStatus}`);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (nextStatus === "DELIVERED") {
          setOtpError(err.message || "Invalid delivery OTP. Please verify with patient.");
        } else {
          setErrorMsg(err.message || `Failed to update status to ${nextStatus}.`);
        }
      } else {
        if (nextStatus === "DELIVERED") {
          setOtpError("Network error verifying delivery OTP.");
        } else {
          setErrorMsg("Network error updating order status.");
        }
      }
    } finally {
      setIsSubmittingStatus(false);
    }
  };

  // Open Medical Record Attachment Viewer
  const handleOpenAttachmentViewer = async (recordId: string) => {
    const trimmed = recordId.trim();
    if (!trimmed) return;

    setAttachmentRecordId(trimmed);
    setIsAttachmentModalOpen(true);
    setIsLoadingAttachment(true);
    setAttachmentError(null);
    setAttachmentDownloadUrl(null);
    setZoomLevel(100);

    try {
      const res = await api.get<DownloadUrlResponse>(
        `/medical-records/${trimmed}/download-url`
      );
      setAttachmentDownloadUrl(res.data.downloadUrl);
      setAttachmentFileName(res.data.fileName);
      setAttachmentFileType(res.data.fileType);
      setAttachmentExpiresInSeconds(res.data.expiresInSeconds);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setAttachmentError("Access Denied: You do not have permission to view this medical record attachment.");
        } else if (err.status === 404) {
          setAttachmentError("Medical record attachment not found or archived.");
        } else {
          setAttachmentError(err.message || "Failed to load medical record attachment.");
        }
      } else {
        setAttachmentError("Network error requesting medical record attachment.");
      }
    } finally {
      setIsLoadingAttachment(false);
    }
  };

  // Helper for Order Status Badge
  const getStatusBadge = (status: OrderStatus) => {
    switch (status) {
      case "PLACED":
        return <Badge variant="outline" className="border-blue-400 text-blue-700 dark:text-blue-300">Placed</Badge>;
      case "PRESCRIPTION_REVIEW":
        return (
          <Badge
            variant="outline"
            className="border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 animate-pulse"
          >
            Prescription Review
          </Badge>
        );
      case "PHARMACY_ACCEPTED":
        return <Badge variant="secondary" className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">Accepted</Badge>;
      case "PREPARING":
        return <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300">Preparing</Badge>;
      case "READY_FOR_DELIVERY":
        return <Badge variant="secondary" className="bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300">Ready for Delivery</Badge>;
      case "OUT_FOR_DELIVERY":
        return <Badge variant="default" className="bg-amber-600 hover:bg-amber-600 text-white">Out for Delivery</Badge>;
      case "DELIVERED":
        return (
          <Badge
            variant="outline"
            className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          >
            Delivered
          </Badge>
        );
      case "REJECTED":
      case "CANCELLED":
      case "FAILED":
        return <Badge variant="destructive">{status}</Badge>;
      case "RETURNED":
        return <Badge variant="outline" className="border-amber-400 text-amber-700">Returned</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Zoom handlers
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 300));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 50));
  const handleZoomReset = () => setZoomLevel(100);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2.5">
              <ClipboardList className="size-8 text-primary shrink-0" />
              Prescription Review & Order Intake Queue
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Review patient orders, verify structured digital prescriptions with cryptographic integrity, and advance fulfillment.
          </p>
        </div>

        {activeOrder && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOrderById(activeOrder._id)}
            disabled={isLoadingOrder}
            className="self-start sm:self-auto gap-2"
          >
            <RefreshCw className={`size-3.5 ${isLoadingOrder ? "animate-spin" : ""}`} />
            Refresh Order
          </Button>
        )}
      </div>

      {/* Tenant Privacy & Architecture Callout */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 p-4 text-sm text-blue-900 dark:text-blue-200 flex items-start gap-3">
        <Info className="size-5 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">LifeLine Architecture Note: Strict Tenant & Patient Isolation</p>
          <p className="text-xs text-blue-800 dark:text-blue-300">
            In compliance with HIPAA and clinical confidentiality standards, LifeLine restricts patient orders directly to assigned pharmacies.
            Look up orders using their unique 24-character hexadecimal Order ID, or select from recent session-remembered orders below.
          </p>
        </div>
      </div>

      {/* Order Lookup Form */}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleLookupSubmit} className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="order-lookup-input"
                  type="text"
                  placeholder="Enter 24-character Order ID (e.g., 6614fa1bc48a8a3a0e1041ab)..."
                  value={lookupOrderId}
                  onChange={(e) => {
                    setLookupOrderId(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  className="pl-9 font-mono text-sm"
                  aria-label="Order ID lookup input"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoadingOrder || !lookupOrderId.trim()}
                className="gap-2 shrink-0"
              >
                {isLoadingOrder ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Search className="size-4" />
                )}
                Look Up Order
              </Button>
            </div>

            {/* Session-Remembered Orders */}
            {sessionOrderIds.length > 0 && (
              <div className="pt-2 border-t border-border flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mr-1">
                  <History className="size-3.5" />
                  Session-Remembered Orders:
                </span>
                {sessionOrderIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setLookupOrderId(id);
                      fetchOrderById(id);
                    }}
                    className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors border ${
                      activeOrder?._id === id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/60 hover:bg-muted text-foreground border-border"
                    }`}
                  >
                    #{id.substring(id.length - 8)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={clearSessionOrders}
                  className="text-xs text-muted-foreground hover:text-destructive underline ml-auto transition-colors"
                >
                  Clear History
                </button>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Feedback Alerts */}
      {errorMsg && (
        <ErrorAlert
          title="Order Review Notice"
          message={errorMsg}
          onRetry={() => activeOrder && fetchOrderById(activeOrder._id)}
        />
      )}

      {actionSuccessMsg && (
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionSuccessMsg(null)}
            className="text-xs hover:underline text-emerald-700 dark:text-emerald-300"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Order View */}
      {isLoadingOrder ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Retrieving order details and clinical records...</p>
        </div>
      ) : activeOrder ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Order Summary, Items Snapshot, Digital Prescription */}
          <div className="lg:col-span-2 space-y-6">
            {/* Order Identity & Delivery Snapshot */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                        Order Identifier
                      </span>
                      {getStatusBadge(activeOrder.status)}
                      <Badge
                        variant="outline"
                        className={
                          activeOrder.paymentStatus === "PAID"
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 text-xs"
                            : "text-xs"
                        }
                      >
                        Payment: {activeOrder.paymentStatus}
                      </Badge>
                    </div>
                    <CardTitle className="text-xl font-mono mt-1">
                      #{activeOrder._id}
                    </CardTitle>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Placed: {new Date(activeOrder.createdAt).toLocaleString()}</div>
                    <div>Updated: {new Date(activeOrder.updatedAt).toLocaleString()}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {/* Delivery Address & Customer Notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 rounded-lg bg-muted/40 border border-border text-sm">
                  <div>
                    <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1">
                      <MapPin className="size-3.5 text-primary" />
                      Delivery Address
                    </span>
                    <p className="font-medium text-foreground">
                      {activeOrder.deliveryAddress.street && `${activeOrder.deliveryAddress.street}, `}
                      {activeOrder.deliveryAddress.city}, {activeOrder.deliveryAddress.state} - {activeOrder.deliveryAddress.postalCode}
                    </p>
                    <p className="text-xs text-muted-foreground">{activeOrder.deliveryAddress.country}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1 mb-1">
                      <FileText className="size-3.5 text-primary" />
                      Delivery Notes
                    </span>
                    <p className="text-xs text-foreground italic">
                      {activeOrder.deliveryNotes || "No specific instructions provided by patient."}
                    </p>
                  </div>
                </div>

                {/* Ordered Medication Items Snapshot */}
                <div>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5 text-foreground">
                    <Pill className="size-4 text-primary" />
                    Ordered Medication Items ({activeOrder.items.length})
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-muted/60 text-xs uppercase text-muted-foreground font-semibold">
                        <tr>
                          <th className="px-4 py-2.5">Medication Name</th>
                          <th className="px-3 py-2.5">Strength / Form</th>
                          <th className="px-3 py-2.5 text-center">Quantity</th>
                          <th className="px-3 py-2.5 text-right">Unit Price</th>
                          <th className="px-4 py-2.5 text-right">Subtotal</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {activeOrder.items.map((item, index) => (
                          <tr key={`${item.medicineId}-${index}`} className="hover:bg-muted/20">
                            <td className="px-4 py-2.5 font-medium text-foreground">
                              {item.medicineName}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-muted-foreground">
                              {item.strength || "—"} / {item.dosageForm || "—"}
                            </td>
                            <td className="px-3 py-2.5 text-center font-semibold text-foreground">
                              {item.quantity}
                            </td>
                            <td className="px-3 py-2.5 text-right text-muted-foreground font-mono">
                              ₹{item.unitPrice.toFixed(2)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold font-mono text-foreground">
                              ₹{item.totalPrice.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-muted/30 text-xs font-medium">
                        <tr>
                          <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">
                            Subtotal:
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono">
                            ₹{activeOrder.totals.subtotal.toFixed(2)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={4} className="px-4 py-1.5 text-right text-muted-foreground">
                            Delivery Fee:
                          </td>
                          <td className="px-4 py-1.5 text-right font-mono">
                            ₹{activeOrder.totals.deliveryFee.toFixed(2)}
                          </td>
                        </tr>
                        <tr className="border-t border-border font-bold text-sm bg-muted/60">
                          <td colSpan={4} className="px-4 py-2.5 text-right text-foreground">
                            Total ({activeOrder.currency}):
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-primary text-base">
                            ₹{activeOrder.totals.totalAmount.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Structured Digital Prescription Inspection Card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-primary" />
                    <div>
                      <CardTitle className="text-lg">Prescription Verification</CardTitle>
                      <CardDescription>
                        Authentic clinical record verification and pharmaceutical review
                      </CardDescription>
                    </div>
                  </div>
                  {activeOrder.prescriptionId ? (
                    <Badge variant="outline" className="border-emerald-500 text-emerald-700 dark:text-emerald-300 font-mono text-xs">
                      Prescription Required (Rx)
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-blue-500 text-blue-700 dark:text-blue-300 text-xs">
                      Over-The-Counter (OTC)
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeOrder.prescriptionId ? (
                  isLoadingPrescription ? (
                    <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      Retrieving structured digital prescription...
                    </div>
                  ) : activePrescription ? (
                    <div className="space-y-4">
                      {/* Cryptographic Checksum & Meta */}
                      <div className="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                            <Lock className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                            Cryptographic Integrity Checksum Verified
                          </span>
                          <span className="font-mono text-emerald-700 dark:text-emerald-300 text-[11px] truncate max-w-xs" title={activePrescription.integrityChecksum}>
                            SHA-256: {activePrescription.integrityChecksum || "Immutable Signed Record"}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground pt-1 border-t border-emerald-200/60 dark:border-emerald-900/40">
                          <div>
                            <span className="font-medium text-foreground">Diagnosis:</span>{" "}
                            <span className="font-semibold text-primary">{activePrescription.diagnosis}</span>
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Prescription ID:</span>{" "}
                            <span className="font-mono">{activePrescription._id.substring(activePrescription._id.length - 8)}</span>
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Status:</span>{" "}
                            <span className="uppercase font-semibold">{activePrescription.status}</span>
                          </div>
                          <div>
                            <span className="font-medium text-foreground">Valid Until:</span>{" "}
                            <span>{new Date(activePrescription.expiresAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>

                      {/* Prescribed Regimen Table */}
                      <div>
                        <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">
                          Prescribed Medication Regimen
                        </h4>
                        <div className="overflow-x-auto rounded-lg border border-border">
                          <table className="w-full text-xs text-left">
                            <thead className="bg-muted/60 text-muted-foreground font-semibold">
                              <tr>
                                <th className="px-3 py-2">Medicine</th>
                                <th className="px-3 py-2">Dosage</th>
                                <th className="px-3 py-2">Frequency</th>
                                <th className="px-2 py-2 text-center">Route</th>
                                <th className="px-2 py-2 text-center">Duration</th>
                                <th className="px-2 py-2 text-center">Qty</th>
                                <th className="px-3 py-2">Special Instructions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {(activePrescription.medicines || []).map((m, idx) => (
                                <tr key={idx} className="hover:bg-muted/20">
                                  <td className="px-3 py-2 font-semibold text-foreground">{m.medicineName}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{m.dosage}</td>
                                  <td className="px-3 py-2 text-muted-foreground">{m.frequency}</td>
                                  <td className="px-2 py-2 text-center">
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                      {m.route}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-2 text-center text-muted-foreground">
                                    {m.durationDays}d
                                  </td>
                                  <td className="px-2 py-2 text-center font-bold text-foreground">
                                    {m.quantity}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground italic">
                                    {m.specialInstructions || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Doctor Notes */}
                      {activePrescription.additionalNotes && (
                        <div className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-md border border-border">
                          <span className="font-semibold text-foreground">Doctor Clinical Notes:</span>{" "}
                          {activePrescription.additionalNotes}
                        </div>
                      )}

                      {/* Associated Medical Record / Attachment Preview Option */}
                      <div className="pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                          Inspect signed clinical record or document attachment?
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenAttachmentViewer(activeOrder.prescriptionId!)}
                          className="gap-1.5 text-xs h-8"
                        >
                          <FileImage className="size-3.5" />
                          View Digital Record Attachment
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200">
                      Prescription attached (#{activeOrder.prescriptionId}) but digital details could not be retrieved directly.
                      Verify manually or inspect attached record.
                    </div>
                  )
                ) : (
                  <div className="p-4 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 text-sm text-blue-800 dark:text-blue-300 flex items-center gap-3">
                    <CheckCircle2 className="size-5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <div>
                      <p className="font-semibold">Over-The-Counter Order</p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                        This order contains non-prescription medications only. Clinical verification is pre-approved and does not require pharmacist sign-off.
                      </p>
                    </div>
                  </div>
                )}

                {/* Prescription Review Action History or Pending Action */}
                {activeOrder.prescriptionReview?.decision ? (
                  <div
                    className={`p-3.5 rounded-lg border text-sm ${
                      activeOrder.prescriptionReview.decision === "APPROVE"
                        ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                        : "bg-destructive/10 border-destructive/30 text-destructive"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold flex items-center gap-1.5">
                        {activeOrder.prescriptionReview.decision === "APPROVE" ? (
                          <CheckCircle2 className="size-4 text-emerald-600" />
                        ) : (
                          <XCircle className="size-4 text-destructive" />
                        )}
                        Prescription {activeOrder.prescriptionReview.decision === "APPROVE" ? "Approved" : "Rejected"}
                      </span>
                      {activeOrder.prescriptionReview.reviewedAt && (
                        <span className="text-xs opacity-80">
                          {new Date(activeOrder.prescriptionReview.reviewedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {activeOrder.prescriptionReview.rejectionReason && (
                      <p className="text-xs mt-1.5 font-medium">
                        Reason: {activeOrder.prescriptionReview.rejectionReason}
                      </p>
                    )}
                  </div>
                ) : activeOrder.status === "PRESCRIPTION_REVIEW" ? (
                  <div className="p-4 rounded-lg bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-3">
                    <div className="flex items-start gap-2.5">
                      <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                          Pharmacist Verification Required
                        </p>
                        <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                          Carefully inspect the patient medication regimen and diagnosis above. You must formally approve or reject this prescription to advance or cancel fulfillment.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <Button
                        size="sm"
                        onClick={handleApprovePrescription}
                        disabled={isSubmittingReview}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
                      >
                        {isSubmittingReview ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3.5" />
                        )}
                        Approve Prescription
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setRejectionReason("");
                          setRejectionReasonError(null);
                          setIsRejectModalOpen(true);
                        }}
                        disabled={isSubmittingReview}
                        className="gap-1.5"
                      >
                        <XCircle className="size-3.5" />
                        Reject Prescription...
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          {/* Right 1 Col: Fulfillment State Machine Workflow Pipeline */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Truck className="size-5 text-primary" />
                  Fulfillment Pipeline
                </CardTitle>
                <CardDescription>
                  Step-by-step dispatch and patient delivery workflow
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Visual Pipeline Steps */}
                <div className="space-y-3">
                  {[
                    { key: "PLACED", label: "Order Placed", icon: Package },
                    { key: "PRESCRIPTION_REVIEW", label: "Prescription Review", icon: ShieldCheck },
                    { key: "PHARMACY_ACCEPTED", label: "Pharmacy Accepted", icon: CheckCircle2 },
                    { key: "PREPARING", label: "Preparing Medication", icon: Pill },
                    { key: "READY_FOR_DELIVERY", label: "Ready for Delivery", icon: Clock },
                    { key: "OUT_FOR_DELIVERY", label: "Out for Delivery", icon: Truck },
                    { key: "DELIVERED", label: "Delivered to Patient", icon: CheckCircle2 },
                  ].map((step, idx) => {
                    const stepList = [
                      "PLACED",
                      "PRESCRIPTION_REVIEW",
                      "PHARMACY_ACCEPTED",
                      "PREPARING",
                      "READY_FOR_DELIVERY",
                      "OUT_FOR_DELIVERY",
                      "DELIVERED",
                    ];
                    const currentIdx = stepList.indexOf(activeOrder.status);
                    const stepIdx = stepList.indexOf(step.key);

                    const isDone = currentIdx >= stepIdx && currentIdx !== -1;
                    const isCurrent = activeOrder.status === step.key;
                    const isTerminal = ["CANCELLED", "REJECTED", "FAILED"].includes(activeOrder.status);

                    return (
                      <div key={step.key} className="flex items-center gap-3 text-xs">
                        <div
                          className={`size-6 rounded-full flex items-center justify-center shrink-0 border ${
                            isCurrent
                              ? "bg-primary text-primary-foreground border-primary font-bold shadow-xs"
                              : isDone && !isTerminal
                              ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800"
                              : "bg-muted text-muted-foreground border-border"
                          }`}
                        >
                          {isDone && !isCurrent && !isTerminal ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : (
                            <span>{idx + 1}</span>
                          )}
                        </div>
                        <span
                          className={`font-medium ${
                            isCurrent
                              ? "text-foreground font-bold"
                              : isDone && !isTerminal
                              ? "text-foreground"
                              : "text-muted-foreground"
                          }`}
                        >
                          {step.label}
                        </span>
                        {isCurrent && (
                          <Badge variant="secondary" className="ml-auto text-[10px] py-0 px-1.5 uppercase">
                            Active
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Fulfillment Action Buttons */}
                <div className="pt-4 border-t border-border space-y-3">
                  <h4 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
                    Next Fulfillment Action
                  </h4>

                  {activeOrder.status === "PHARMACY_ACCEPTED" && (
                    <Button
                      onClick={() => handleAdvanceStatus("PREPARING")}
                      disabled={isSubmittingStatus}
                      className="w-full gap-2"
                    >
                      {isSubmittingStatus ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Pill className="size-4" />
                      )}
                      Start Preparing Order
                    </Button>
                  )}

                  {activeOrder.status === "PREPARING" && (
                    <Button
                      onClick={() => handleAdvanceStatus("READY_FOR_DELIVERY")}
                      disabled={isSubmittingStatus}
                      className="w-full gap-2"
                    >
                      {isSubmittingStatus ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Clock className="size-4" />
                      )}
                      Mark Ready for Delivery
                    </Button>
                  )}

                  {activeOrder.status === "READY_FOR_DELIVERY" && (
                    <Button
                      onClick={() => handleAdvanceStatus("OUT_FOR_DELIVERY")}
                      disabled={isSubmittingStatus}
                      className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      {isSubmittingStatus ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Truck className="size-4" />
                      )}
                      Dispatch (Out for Delivery)
                    </Button>
                  )}

                  {activeOrder.status === "OUT_FOR_DELIVERY" && (
                    <Button
                      onClick={() => {
                        setDeliveryOtp("");
                        setOtpError(null);
                        setIsOtpModalOpen(true);
                      }}
                      disabled={isSubmittingStatus}
                      className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <CheckCircle2 className="size-4" />
                      Confirm Delivery (Enter OTP)...
                    </Button>
                  )}

                  {activeOrder.status === "DELIVERED" && (
                    <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center text-xs text-emerald-800 dark:text-emerald-300">
                      <CheckCircle2 className="size-6 text-emerald-600 mx-auto mb-1" />
                      <p className="font-bold text-sm">Order Completed</p>
                      <p className="mt-0.5">Delivered and confirmed via patient OTP verification.</p>
                    </div>
                  )}

                  {activeOrder.status === "PRESCRIPTION_REVIEW" && (
                    <p className="text-xs text-muted-foreground text-center">
                      Fulfillment pipeline is paused until prescription is approved by pharmacist.
                    </p>
                  )}

                  {["CANCELLED", "REJECTED", "FAILED"].includes(activeOrder.status) && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-center text-xs text-destructive">
                      <XCircle className="size-5 mx-auto mb-1" />
                      <p className="font-semibold">Order Terminal State</p>
                      <p className="mt-0.5">This order has been {activeOrder.status.toLowerCase()}. No further actions can be taken.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No Order Selected"
          description="Enter an Order ID above to inspect patient medication items, verify digital prescriptions, and manage fulfillment."
        />
      )}

      {/* Reject Prescription Reason Modal */}
      <Dialog open={isRejectModalOpen} onOpenChange={setIsRejectModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="size-5" />
              Reject Prescription
            </DialogTitle>
            <DialogDescription>
              State the clinical reason for rejecting this prescription. This reason will be logged in the audit trail and sent to the patient.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rejection-reason" className="text-sm font-semibold">
                Clinical Rejection Reason <span className="text-destructive">*</span>
              </Label>
              <textarea
                id="rejection-reason"
                rows={4}
                value={rejectionReason}
                onChange={(e) => {
                  setRejectionReason(e.target.value);
                  if (rejectionReasonError) setRejectionReasonError(null);
                }}
                placeholder="e.g., Unclear dosage instructions, potential drug-drug interaction with patient history, or expired prescription validity window..."
                className="w-full rounded-md border border-input bg-background p-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Required for audit compliance</span>
                <span>{rejectionReason.length} / 500</span>
              </div>
            </div>

            {rejectionReasonError && (
              <p className="text-xs text-destructive font-medium">{rejectionReasonError}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsRejectModalOpen(false)}
              disabled={isSubmittingReview}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectPrescription}
              disabled={isSubmittingReview || !rejectionReason.trim()}
              className="gap-2"
            >
              {isSubmittingReview && <Loader2 className="size-4 animate-spin" />}
              Confirm Rejection & Cancel Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delivery Confirmation OTP Modal */}
      <Dialog open={isOtpModalOpen} onOpenChange={setIsOtpModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <CheckCircle2 className="size-5 text-emerald-600" />
              Confirm Delivery with OTP
            </DialogTitle>
            <DialogDescription>
              Enter the delivery OTP code provided by the patient upon package receipt.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="delivery-otp" className="text-sm font-semibold">
                Patient Delivery OTP <span className="text-destructive">*</span>
              </Label>
              <Input
                id="delivery-otp"
                type="text"
                maxLength={10}
                placeholder="Enter 4-10 digit OTP..."
                value={deliveryOtp}
                onChange={(e) => {
                  setDeliveryOtp(e.target.value);
                  if (otpError) setOtpError(null);
                }}
                className="text-center font-mono text-lg tracking-widest"
              />
              <p className="text-xs text-muted-foreground text-center">
                The OTP is sent to the patient's registered mobile device for secure verification.
              </p>
            </div>

            {otpError && (
              <p className="text-xs text-destructive font-medium text-center">{otpError}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setIsOtpModalOpen(false)}
              disabled={isSubmittingStatus}
            >
              Cancel
            </Button>
            <Button
              onClick={() => handleAdvanceStatus("DELIVERED", deliveryOtp.trim())}
              disabled={isSubmittingStatus || !deliveryOtp.trim() || deliveryOtp.trim().length < 4}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              {isSubmittingStatus && <Loader2 className="size-4 animate-spin" />}
              Verify & Complete Delivery
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pre-signed Medical Record Attachment Viewer Modal */}
      <Dialog open={isAttachmentModalOpen} onOpenChange={setIsAttachmentModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div className="space-y-0.5">
              <DialogTitle className="text-base font-semibold flex items-center gap-2">
                <FileImage className="size-5 text-primary" />
                Medical Record Attachment Viewer
              </DialogTitle>
              <DialogDescription className="text-xs">
                {attachmentFileName || `Record ID: ${attachmentRecordId}`}
              </DialogDescription>
            </div>
            {/* Zoom Controls */}
            {attachmentDownloadUrl && (
              <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-md border border-border">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomOut}
                  disabled={zoomLevel <= 50}
                  className="h-7 w-7 p-0"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="size-3.5" />
                </Button>
                <span className="text-xs font-mono px-1 min-w-[45px] text-center font-medium">
                  {zoomLevel}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomIn}
                  disabled={zoomLevel >= 300}
                  className="h-7 w-7 p-0"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleZoomReset}
                  className="h-7 w-7 p-0"
                  aria-label="Reset Zoom"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Body Viewer */}
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-[350px] bg-muted/20">
            {isLoadingAttachment ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span>Requesting secure temporary pre-signed authorization...</span>
              </div>
            ) : attachmentError ? (
              <div className="text-center p-6 space-y-2">
                <AlertCircle className="size-8 text-destructive mx-auto" />
                <p className="text-sm font-semibold text-destructive">{attachmentError}</p>
                <p className="text-xs text-muted-foreground">
                  The document could not be rendered or is restricted.
                </p>
              </div>
            ) : attachmentDownloadUrl ? (
              attachmentFileType?.startsWith("image/") ? (
                <div className="overflow-auto max-h-[60vh] flex items-center justify-center">
                  <img
                    src={attachmentDownloadUrl}
                    alt="Clinical attachment"
                    style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "center center" }}
                    className="max-w-full max-h-[55vh] object-contain transition-transform duration-150 rounded shadow-sm"
                  />
                </div>
              ) : (
                <div className="text-center p-8 space-y-3">
                  <FileText className="size-12 text-primary mx-auto" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">
                      {attachmentFileName || "Clinical PDF Document"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Type: {attachmentFileType || "application/pdf"}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      if (attachmentDownloadUrl) {
                        window.open(attachmentDownloadUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    className="gap-2"
                  >
                    <ExternalLink className="size-4" />
                    Open Document in Secure Viewer
                  </Button>
                </div>
              )
            ) : null}
          </div>

          {/* Footer Notice */}
          <div className="px-6 py-3 border-t border-border bg-muted/40 flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Lock className="size-3.5 text-emerald-600" />
              Pre-signed link expires in {Math.round((attachmentExpiresInSeconds || 900) / 60)} minutes. Not persisted locally.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAttachmentModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
