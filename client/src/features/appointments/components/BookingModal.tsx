import * as React from "react";
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  Phone,
  MessageSquare,
  Building,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorAlert } from "@/components/ui/feedback-states";
import { loadRazorpayScript } from "../services/razorpay";

export type ConsultationType = "VIDEO" | "AUDIO" | "CHAT" | "IN_PERSON";

export interface PublicDoctorSummary {
  id: string;
  name: string;
  avatar?: string;
  specialization: string;
  qualifications: string[];
  experienceYears: number;
  clinicName?: string;
  clinicAddress?: {
    street?: string;
    city: string;
    state: string;
    postalCode?: string;
    country?: string;
  };
  languages: string[];
  consultationFee: number;
  consultationTypes: ConsultationType[];
  rating: number;
  totalReviews: number;
}

export interface ComputedAvailabilitySlot {
  startTime: string; // "09:00"
  endTime: string; // "09:30"
  available: boolean;
}

export interface DoctorAvailabilityResponse {
  success: boolean;
  data: {
    doctorId: string;
    date: string;
    slots: ComputedAvailabilitySlot[];
  };
}

export interface AppointmentReservationResponse {
  success: boolean;
  data: {
    appointmentId: string;
    status: string;
    expiresAt: string;
    fee: number;
    currency: string;
  };
}

export interface PaymentIntentResponse {
  success: boolean;
  data: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
    referenceId: string;
  };
}

export interface BookingModalProps {
  doctor: PublicDoctorSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onBookingSuccess?: (appointmentId: string) => void;
}

export function BookingModal({
  doctor,
  isOpen,
  onClose,
  onBookingSuccess,
}: BookingModalProps) {
  const { user } = useAuthStore();

  const [step, setStep] = React.useState<number>(1);
  const [consultationType, setConsultationType] = React.useState<ConsultationType>("VIDEO");
  const [selectedDate, setSelectedDate] = React.useState<string>(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  });
  const [availableSlots, setAvailableSlots] = React.useState<ComputedAvailabilitySlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = React.useState<boolean>(false);
  const [selectedSlot, setSelectedSlot] = React.useState<ComputedAvailabilitySlot | null>(null);
  const [reason, setReason] = React.useState<string>("");
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  // Post-reservation & payment state
  const [reservedAppointment, setReservedAppointment] = React.useState<{
    appointmentId: string;
    fee: number;
    currency: string;
    expiresAt: string;
    status: string;
  } | null>(null);
  const [isVerifyingPayment, setIsVerifyingPayment] = React.useState<boolean>(false);
  const [paymentNotice, setPaymentNotice] = React.useState<string | null>(null);

  // Reset state when doctor changes or modal closes
  React.useEffect(() => {
    if (isOpen && doctor) {
      setStep(1);
      setErrorMsg(null);
      setPaymentNotice(null);
      setReservedAppointment(null);
      setSelectedSlot(null);
      setReason("");
      if (doctor.consultationTypes && doctor.consultationTypes.length > 0) {
        setConsultationType(doctor.consultationTypes[0]);
      } else {
        setConsultationType("VIDEO");
      }
    }
  }, [isOpen, doctor]);

  // Fetch slots when date or doctor changes
  React.useEffect(() => {
    if (!isOpen || !doctor || !selectedDate) return;

    let isMounted = true;
    const fetchSlots = async () => {
      setIsLoadingSlots(true);
      setErrorMsg(null);
      setSelectedSlot(null);

      try {
        const res = await api.get<DoctorAvailabilityResponse>(
          `/doctors/${doctor.id}/availability`,
          { params: { date: selectedDate } }
        );
        if (isMounted) {
          setAvailableSlots(res.data.slots || []);
        }
      } catch (err: unknown) {
        if (isMounted) {
          if (err instanceof ApiError) {
            setErrorMsg(err.message || "Failed to load doctor's availability slots.");
          } else {
            setErrorMsg("Network error loading availability.");
          }
          setAvailableSlots([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingSlots(false);
        }
      }
    };

    fetchSlots();
    return () => {
      isMounted = false;
    };
  }, [isOpen, doctor, selectedDate]);

  if (!doctor) return null;

  // Icons for consultation types
  const typeIcons: Record<ConsultationType, React.ReactNode> = {
    VIDEO: <Video className="size-4" />,
    AUDIO: <Phone className="size-4" />,
    CHAT: <MessageSquare className="size-4" />,
    IN_PERSON: <Building className="size-4" />,
  };

  const handleCreateReservation = async () => {
    if (!selectedSlot) {
      setErrorMsg("Please select an available appointment slot.");
      return;
    }
    if (reason.trim().length < 5) {
      setErrorMsg("Please provide a consultation reason of at least 5 characters.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      // scheduledStart ISO string combining selectedDate and slot startTime
      const [hours, minutes] = selectedSlot.startTime.split(":");
      const startDateTime = new Date(`${selectedDate}T00:00:00Z`);
      startDateTime.setUTCHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

      const idempotencyKey = crypto.randomUUID();

      const res = await api.post<AppointmentReservationResponse>(
        "/appointments",
        {
          doctorId: doctor.id,
          appointmentType: consultationType,
          scheduledStart: startDateTime.toISOString(),
          reason: reason.trim(),
        },
        {
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        }
      );

      setReservedAppointment(res.data);
      setStep(4); // Move to Payment / Checkout step
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setErrorMsg("This time slot was just reserved or is no longer available. Please select another slot.");
        } else {
          setErrorMsg(err.message || "Failed to reserve appointment slot. Please try again.");
        }
      } else {
        setErrorMsg("Network failure during slot reservation.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLaunchRazorpayCheckout = async () => {
    if (!reservedAppointment) return;

    setIsSubmitting(true);
    setErrorMsg(null);
    setPaymentNotice(null);

    try {
      // 1. Request Payment Intent from Backend
      const intentRes = await api.post<PaymentIntentResponse>("/payments/create-intent", {
        targetType: "APPOINTMENT",
        targetId: reservedAppointment.appointmentId,
      });

      const intent = intentRes.data;

      // 2. Load Razorpay Script dynamically on demand
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        throw new Error("Unable to load Razorpay Checkout gateway. Please check your internet connection.");
      }

      // 3. Launch Checkout Window
      const rzp = new window.Razorpay({
        key: intent.keyId,
        amount: intent.amount,
        currency: intent.currency,
        name: "LifeLine Healthcare Platform",
        description: `Consultation with Dr. ${doctor.name}`,
        order_id: intent.orderId,
        prefill: {
          name: user?.fullName || "",
          email: user?.email || "",
        },
        theme: {
          color: "#0284c7",
        },
        handler: async (_response) => {
          // Note: Razorpay client callback alone NEVER authorizes booking.
          // We immediately query backend for authoritative state.
          await verifyAppointmentStatus(reservedAppointment.appointmentId);
        },
        modal: {
          ondismiss: () => {
            setPaymentNotice(
              "Checkout was closed. Your slot remains locked for 15 minutes. You can complete payment before lock expires."
            );
            setIsSubmitting(false);
          },
        },
      });

      rzp.open();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to initiate payment intent with payment gateway.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to initiate payment. Please try again.");
      }
      setIsSubmitting(false);
    }
  };

  const verifyAppointmentStatus = async (appointmentId: string) => {
    setIsVerifyingPayment(true);
    setErrorMsg(null);

    try {
      // Poll/Check authoritative appointment status from server
      const res = await api.get<{
        success: boolean;
        data: Array<{
          _id: string;
          status: string;
        }>;
      }>("/appointments");

      const currentAppt = res.data?.find((a) => a._id === appointmentId);

      if (currentAppt && currentAppt.status === "CONFIRMED") {
        setReservedAppointment((prev) => (prev ? { ...prev, status: "CONFIRMED" } : null));
        setStep(5); // Success step
        if (onBookingSuccess) {
          onBookingSuccess(appointmentId);
        }
      } else {
        // Payment might still be settling via webhook
        setPaymentNotice(
          "Payment processing. Your appointment is awaiting webhook settlement confirmation. Please refresh in a moment."
        );
      }
    } catch {
      setPaymentNotice(
        "Payment submitted. Final status confirmation will appear in your Appointments dashboard once settled."
      );
    } finally {
      setIsVerifyingPayment(false);
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-0 overflow-hidden border border-border shadow-2xl rounded-2xl">
        <DialogHeader className="p-6 pb-4 bg-muted/30 border-b border-border">
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider text-primary border-primary/30">
              Step {step} of 5
            </Badge>
            <span className="text-xs text-muted-foreground font-medium">
              Consultation Fee: ₹{doctor.consultationFee}
            </span>
          </div>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground mt-2">
            Book Appointment with Dr. {doctor.name.replace(/^Dr\.\s*/i, "")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {doctor.specialization} • {doctor.experienceYears} Years Experience • {doctor.clinicAddress?.city || "Online"}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {errorMsg && (
            <ErrorAlert
              title="Booking Notice"
              message={errorMsg}
              onRetry={() => setErrorMsg(null)}
              data-testid="booking-error-alert"
            />
          )}

          {paymentNotice && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2">
              <AlertCircle className="size-4 shrink-0 text-amber-600 mt-0.5" />
              <p>{paymentNotice}</p>
            </div>
          )}

          {/* STEP 1: CONSULTATION TYPE */}
          {step === 1 && (
            <div className="space-y-4" data-testid="booking-step-1">
              <div>
                <Label className="text-sm font-semibold">1. Choose Consultation Medium</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select how you would like to connect with Dr. {doctor.name}.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                {(["VIDEO", "AUDIO", "CHAT", "IN_PERSON"] as ConsultationType[]).map((type) => {
                  const isSupported =
                    !doctor.consultationTypes ||
                    doctor.consultationTypes.length === 0 ||
                    doctor.consultationTypes.includes(type);

                  const isSelected = consultationType === type;

                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={!isSupported}
                      onClick={() => setConsultationType(type)}
                      className={`flex flex-col items-start p-3.5 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-2 ring-primary/20 text-foreground"
                          : isSupported
                          ? "border-border hover:border-border/80 bg-card text-muted-foreground hover:text-foreground"
                          : "border-border/40 bg-muted/20 opacity-40 cursor-not-allowed text-muted-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1.5 font-semibold text-sm">
                        {typeIcons[type]}
                        <span>{type.replace("_", " ")}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {type === "VIDEO" && "High-definition encrypted teleconsult"}
                        {type === "AUDIO" && "Direct telephone / VOIP voice call"}
                        {type === "CHAT" && "Real-time interactive messaging"}
                        {type === "IN_PERSON" && "Clinic visit at doctor's facility"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: DATE & TIME SLOT SELECTION */}
          {step === 2 && (
            <div className="space-y-4" data-testid="booking-step-2">
              <div>
                <Label className="text-sm font-semibold">2. Select Consultation Date & Available Slot</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Available slots are dynamically computed from Dr. {doctor.name}'s schedule.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="booking-date" className="text-xs font-medium">
                  Appointment Date
                </Label>
                <div className="relative">
                  <CalendarIcon className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="booking-date"
                    type="date"
                    className="pl-9"
                    value={selectedDate}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-foreground">Available Time Slots</span>
                  {isLoadingSlots && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Loader2 className="size-3 animate-spin" /> Checking slots...
                    </span>
                  )}
                </div>

                {isLoadingSlots ? (
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div key={i} className="h-10 rounded-lg bg-muted/60 animate-pulse" />
                    ))}
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-1">
                    <Clock className="size-6 text-muted-foreground mx-auto mb-1.5" />
                    <p className="text-sm font-semibold text-foreground">No slots available on this date</p>
                    <p className="text-xs text-muted-foreground">
                      The doctor has no scheduled working shifts or all slots are booked. Please choose another date.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {availableSlots.map((slot) => {
                      const isSelected =
                        selectedSlot?.startTime === slot.startTime &&
                        selectedSlot?.endTime === slot.endTime;

                      return (
                        <button
                          key={slot.startTime}
                          type="button"
                          disabled={!slot.available}
                          onClick={() => setSelectedSlot(slot)}
                          className={`p-2.5 rounded-lg text-xs font-medium border text-center transition-all ${
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary shadow-xs"
                              : slot.available
                              ? "bg-card border-border hover:border-primary/50 text-foreground hover:bg-primary/5"
                              : "bg-muted/30 border-border/40 text-muted-foreground/50 cursor-not-allowed line-through"
                          }`}
                        >
                          {slot.startTime} - {slot.endTime}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: REASON & SUMMARY REVIEW */}
          {step === 3 && (
            <div className="space-y-4" data-testid="booking-step-3">
              <div>
                <Label className="text-sm font-semibold">3. Chief Concern & Booking Review</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Briefly explain your health concerns to assist Dr. {doctor.name} in preparing.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="booking-reason" className="text-xs font-medium">
                  Reason for Consultation (min. 5 characters) *
                </Label>
                <textarea
                  id="booking-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Describe symptoms, duration, or questions for the doctor..."
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Doctor</span>
                  <span className="font-semibold text-foreground">Dr. {doctor.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Type</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {consultationType}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Date & Slot</span>
                  <span className="font-medium text-foreground">
                    {selectedDate} at {selectedSlot?.startTime} - {selectedSlot?.endTime}
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-border">
                  <span className="font-semibold text-foreground">Total Consultation Fee</span>
                  <span className="text-sm font-bold text-primary">₹{doctor.consultationFee}</span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Upon proceeding, this appointment slot will be locked for 15 minutes to allow secure payment completion.
              </p>
            </div>
          )}

          {/* STEP 4: PAYMENT CHECKOUT */}
          {step === 4 && reservedAppointment && (
            <div className="space-y-4" data-testid="booking-step-4">
              <div className="text-center space-y-1 pb-2">
                <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  <CreditCard className="size-5" />
                </div>
                <h3 className="text-base font-bold text-foreground">Complete Consultation Payment</h3>
                <p className="text-xs text-muted-foreground">
                  Your appointment slot is locked. Please complete checkout before the lock expires.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Appointment Reference</span>
                  <span className="font-mono text-foreground">{reservedAppointment.appointmentId}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Lock Expiration</span>
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {new Date(reservedAppointment.expiresAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="flex justify-between text-xs pt-2 border-t border-border">
                  <span className="font-bold text-foreground">Amount Payable</span>
                  <span className="text-base font-extrabold text-primary">
                    ₹{reservedAppointment.fee}
                  </span>
                </div>
              </div>

              <Button
                className="w-full h-11"
                disabled={isSubmitting || isVerifyingPayment}
                onClick={handleLaunchRazorpayCheckout}
                data-testid="pay-now-button"
              >
                {isSubmitting || isVerifyingPayment ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Opening Secure Gateway...
                  </>
                ) : (
                  <>
                    <CreditCard className="size-4 mr-2" />
                    Pay ₹{reservedAppointment.fee} via Razorpay
                  </>
                )}
              </Button>

              <div className="text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => verifyAppointmentStatus(reservedAppointment.appointmentId)}
                >
                  Already paid? Check Confirmation Status
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: CONFIRMATION OUTCOME */}
          {step === 5 && (
            <div className="text-center space-y-4 py-4" data-testid="booking-step-5">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <CheckCircle2 className="size-8" />
              </div>

              <div>
                <h3 className="text-xl font-bold text-foreground">Appointment Confirmed!</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Your appointment with Dr. {doctor.name} has been verified and confirmed by the LifeLine platform.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs space-y-2 text-left">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Booking ID</span>
                  <span className="font-mono font-semibold text-foreground">{reservedAppointment?.appointmentId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Doctor</span>
                  <span className="font-medium text-foreground">Dr. {doctor.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Schedule</span>
                  <span className="font-medium text-foreground">
                    {selectedDate} ({selectedSlot?.startTime} - {selectedSlot?.endTime})
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="doctor" className="uppercase text-[10px]">
                    CONFIRMED
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="p-4 bg-muted/20 border-t border-border flex items-center justify-between">
          {step > 1 && step < 4 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={() => setStep((prev) => Math.max(1, prev - 1))}
            >
              <ArrowLeft className="size-4 mr-1.5" /> Back
            </Button>
          ) : (
            <div />
          )}

          {step === 1 && (
            <Button size="sm" onClick={() => setStep(2)}>
              Continue <ArrowRight className="size-4 ml-1.5" />
            </Button>
          )}

          {step === 2 && (
            <Button
              size="sm"
              disabled={!selectedSlot}
              onClick={() => setStep(3)}
              data-testid="step2-continue-button"
            >
              Select Details <ArrowRight className="size-4 ml-1.5" />
            </Button>
          )}

          {step === 3 && (
            <Button
              size="sm"
              disabled={isSubmitting || reason.trim().length < 5}
              onClick={handleCreateReservation}
              data-testid="reserve-slot-button"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" /> Locking Slot...
                </>
              ) : (
                <>
                  Reserve Slot & Pay <ArrowRight className="size-4 ml-1.5" />
                </>
              )}
            </Button>
          )}

          {step >= 4 && (
            <Button
              variant={step === 5 ? "default" : "outline"}
              size="sm"
              onClick={onClose}
              data-testid="booking-modal-close"
            >
              {step === 5 ? "Done" : "Close"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
