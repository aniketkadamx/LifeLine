import * as React from "react";
import {
  FileText,
  Plus,
  Trash2,
  Search,
  CheckCircle2,
  Printer,
  ChevronRight,
  ChevronLeft,
  Loader2,
  AlertCircle,
  Pill,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ErrorAlert } from "@/components/ui/feedback-states";

export type MedicineRoute = "ORAL" | "TOPICAL" | "INJECTION" | "DROPS" | "INHALATION";

export interface PrescriptionMedicineItemDraft {
  id: string; // client temporary ID for keys
  medicineId: string;
  medicineName: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  route: MedicineRoute;
  specialInstructions?: string;
}

export interface CatalogMedicineOption {
  _id: string;
  name: string;
  genericName?: string;
  category?: string;
  strength?: string;
  dosageForm?: string;
}

export interface PrescriptionAppointmentContext {
  id: string;
  patientId: string;
  patientName?: string;
  scheduledStart: string;
  reason?: string;
}

export interface PrescriptionBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: PrescriptionAppointmentContext | null;
  doctorName?: string;
  onPrescriptionIssued?: (prescriptionId: string) => void;
}

interface IssuePrescriptionResponse {
  success: boolean;
  data: {
    _id?: string;
    id?: string;
    appointmentId: string;
    patientId: string;
    doctorId: string;
    diagnosis: string;
    medicines: Array<{
      medicineId: string;
      medicineName: string;
      dosage: string;
      frequency: string;
      durationDays: number;
      quantity: number;
      route: MedicineRoute;
      specialInstructions?: string;
    }>;
    status: string;
    issuedAt: string;
  };
  message: string;
}

export function PrescriptionBuilderModal({
  isOpen,
  onClose,
  appointment,
  doctorName,
  onPrescriptionIssued,
}: PrescriptionBuilderModalProps) {
  // Wizard Steps: 1 = Edit Draft, 2 = Final Review & Doctor Confirmation, 3 = Confirmed
  const [step, setStep] = React.useState<1 | 2 | 3>(1);

  // Form State
  const [diagnosis, setDiagnosis] = React.useState("");
  const [additionalNotes, setAdditionalNotes] = React.useState("");
  const [medicines, setMedicines] = React.useState<PrescriptionMedicineItemDraft[]>([]);

  // Current item being added or drafted
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchResults, setSearchResults] = React.useState<CatalogMedicineOption[]>([]);
  const [isSearchingCatalog, setIsSearchingCatalog] = React.useState(false);

  const [activeItem, setActiveItem] = React.useState<Partial<PrescriptionMedicineItemDraft>>({
    medicineId: "",
    medicineName: "",
    dosage: "",
    frequency: "",
    durationDays: 5,
    quantity: 1,
    route: "ORAL",
    specialInstructions: "",
  });

  // Submission State
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [issuedPrescription, setIssuedPrescription] = React.useState<IssuePrescriptionResponse["data"] | null>(null);

  // Reset or initialize on open
  React.useEffect(() => {
    if (isOpen) {
      setStep(1);
      setErrorMsg(null);
      setIssuedPrescription(null);
      if (medicines.length === 0) {
        setMedicines([]);
      }
    }
  }, [isOpen]);

  // Debounced search for master medicine catalog
  React.useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingCatalog(true);
      try {
        const res = await api.get<{
          success: boolean;
          data: CatalogMedicineOption[];
        }>("/medicines", {
          params: { search: trimmed, limit: 6 },
        });
        setSearchResults(res.data || []);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearchingCatalog(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectCatalogMedicine = (med: CatalogMedicineOption) => {
    setActiveItem((prev) => ({
      ...prev,
      medicineId: med._id,
      medicineName: med.name,
      dosage: med.strength || prev.dosage || "",
    }));
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleAddMedicineItem = () => {
    setErrorMsg(null);

    if (!activeItem.medicineId || !activeItem.medicineName) {
      setErrorMsg("Please select or specify a valid medicine from the catalog.");
      return;
    }
    if (!/^[0-9a-fA-F]{24}$/.test(activeItem.medicineId)) {
      setErrorMsg("Medicine ID must be a valid 24-character hex catalog identifier.");
      return;
    }
    if (!activeItem.dosage || !activeItem.dosage.trim()) {
      setErrorMsg("Dosage specification is required (e.g., '500mg').");
      return;
    }
    if (!activeItem.frequency || !activeItem.frequency.trim()) {
      setErrorMsg("Frequency is required (e.g., '1-0-1 (After food)').");
      return;
    }
    if (!activeItem.durationDays || activeItem.durationDays < 1) {
      setErrorMsg("Duration must be at least 1 day.");
      return;
    }
    if (!activeItem.quantity || activeItem.quantity < 1) {
      setErrorMsg("Quantity must be at least 1 unit.");
      return;
    }

    const newItem: PrescriptionMedicineItemDraft = {
      id: crypto.randomUUID(),
      medicineId: activeItem.medicineId,
      medicineName: activeItem.medicineName.trim(),
      dosage: activeItem.dosage.trim(),
      frequency: activeItem.frequency.trim(),
      durationDays: Number(activeItem.durationDays),
      quantity: Number(activeItem.quantity),
      route: (activeItem.route as MedicineRoute) || "ORAL",
      specialInstructions: activeItem.specialInstructions?.trim() || undefined,
    };

    setMedicines((prev) => [...prev, newItem]);

    // Reset active item
    setActiveItem({
      medicineId: "",
      medicineName: "",
      dosage: "",
      frequency: "",
      durationDays: 5,
      quantity: 1,
      route: "ORAL",
      specialInstructions: "",
    });
  };

  const handleRemoveMedicineItem = (id: string) => {
    setMedicines((prev) => prev.filter((m) => m.id !== id));
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!diagnosis.trim() || diagnosis.trim().length < 3) {
      setErrorMsg("Clinical diagnosis is required and must be at least 3 characters.");
      return;
    }

    if (medicines.length === 0) {
      setErrorMsg("Prescription must contain at least 1 valid prescribed medicine item.");
      return;
    }

    setStep(2);
  };

  // Authoritative Submission after Doctor Confirmation
  const handleConfirmAndIssuePrescription = async () => {
    if (!appointment) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const payload = {
        appointmentId: appointment.id,
        diagnosis: diagnosis.trim(),
        medicines: medicines.map((m) => ({
          medicineId: m.medicineId,
          medicineName: m.medicineName,
          dosage: m.dosage,
          frequency: m.frequency,
          durationDays: m.durationDays,
          quantity: m.quantity,
          route: m.route,
          specialInstructions: m.specialInstructions || undefined,
        })),
        additionalNotes: additionalNotes.trim() || undefined,
      };

      const res = await api.post<IssuePrescriptionResponse>("/prescriptions", payload);

      setIssuedPrescription(res.data);
      setStep(3);

      const issuedId = res.data._id || res.data.id || "";
      if (onPrescriptionIssued && issuedId) {
        onPrescriptionIssued(issuedId);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to issue prescription. Your draft has been preserved.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to issue digital prescription. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!appointment) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden border border-border shadow-2xl rounded-2xl">
        <DialogHeader className="p-6 pb-4 bg-muted/30 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wider text-primary border-primary/30">
                Prescription Studio
              </Badge>
              <span className="text-xs text-muted-foreground font-medium">
                Step {step} of 3
              </span>
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              Appt #{appointment.id.slice(-8).toUpperCase()}
            </span>
          </div>

          <DialogTitle className="text-xl font-bold tracking-tight text-foreground mt-2">
            Digital Prescription for {appointment.patientName || `Patient (${appointment.patientId.slice(-6)})`}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Legally binding clinical record. Once issued by the attending physician, prescriptions are immutable.
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="px-6 pt-4">
            <ErrorAlert
              title="Prescription Validation Notice"
              message={errorMsg}
              onRetry={() => setErrorMsg(null)}
              data-testid="prescription-error-alert"
            />
          </div>
        )}

        <div className="p-6 max-h-[75vh] overflow-y-auto space-y-6">
          {/* STEP 1: DRAFTING & MEDICINES */}
          {step === 1 && (
            <form onSubmit={handleProceedToReview} className="space-y-6" data-testid="prescription-step-1">
              {/* Clinical Diagnosis Input */}
              <div className="space-y-1.5">
                <Label htmlFor="rx-diagnosis" className="text-xs font-semibold text-foreground">
                  Clinical Diagnosis *
                </Label>
                <Input
                  id="rx-diagnosis"
                  placeholder="e.g. Acute Pharyngitis, Type 2 Diabetes Mellitus with peripheral neuropathy"
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  className="text-sm font-medium"
                  data-testid="prescription-diagnosis-input"
                  required
                />
              </div>

              {/* Medicines Builder Section */}
              <div className="rounded-xl border border-border p-4 bg-muted/20 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Pill className="size-4 text-primary" /> Add Medication Item
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {medicines.length} item(s) in prescription
                  </span>
                </div>

                {/* Catalog Search Bar */}
                <div className="relative">
                  <Label htmlFor="catalog-search" className="text-xs font-semibold mb-1 block">
                    Search Master Medicine Catalog
                  </Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground pointer-events-none" />
                    <Input
                      id="catalog-search"
                      placeholder="Type medicine name or generic composition (e.g. Paracetamol, Amoxicillin)..."
                      className="pl-9 text-xs"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      data-testid="medicine-search-input"
                    />
                    {isSearchingCatalog && (
                      <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {/* Search Results Dropdown */}
                  {searchResults.length > 0 && (
                    <div
                      className="absolute z-50 left-0 right-0 mt-1 rounded-lg border border-border bg-popover text-popover-foreground shadow-lg overflow-hidden max-h-48 overflow-y-auto"
                      data-testid="medicine-search-results"
                    >
                      {searchResults.map((item) => (
                        <button
                          key={item._id}
                          type="button"
                          onClick={() => handleSelectCatalogMedicine(item)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 transition-colors flex items-center justify-between border-b border-border/40 last:border-b-0"
                          data-testid={`catalog-item-${item._id}`}
                        >
                          <div>
                            <span className="font-semibold text-foreground block">{item.name}</span>
                            {item.genericName && (
                              <span className="text-[11px] text-muted-foreground">{item.genericName}</span>
                            )}
                          </div>
                          {item.dosageForm && (
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {item.dosageForm}
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active Medicine Item Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Medicine Name *</Label>
                    <Input
                      placeholder="Medicine name"
                      value={activeItem.medicineName || ""}
                      onChange={(e) => setActiveItem({ ...activeItem, medicineName: e.target.value })}
                      className="text-xs"
                      data-testid="item-name-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Dosage *</Label>
                    <Input
                      placeholder="e.g. 500mg, 1 tablet"
                      value={activeItem.dosage || ""}
                      onChange={(e) => setActiveItem({ ...activeItem, dosage: e.target.value })}
                      className="text-xs"
                      data-testid="item-dosage-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Frequency *</Label>
                    <Input
                      placeholder="e.g. 1-0-1 (After food)"
                      value={activeItem.frequency || ""}
                      onChange={(e) => setActiveItem({ ...activeItem, frequency: e.target.value })}
                      className="text-xs"
                      data-testid="item-frequency-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Duration (Days) *</Label>
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={activeItem.durationDays || 5}
                      onChange={(e) => setActiveItem({ ...activeItem, durationDays: parseInt(e.target.value, 10) || 1 })}
                      className="text-xs"
                      data-testid="item-duration-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Quantity *</Label>
                    <Input
                      type="number"
                      min={1}
                      value={activeItem.quantity || 1}
                      onChange={(e) => setActiveItem({ ...activeItem, quantity: parseInt(e.target.value, 10) || 1 })}
                      className="text-xs"
                      data-testid="item-quantity-input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px] font-semibold">Route *</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={activeItem.route || "ORAL"}
                      onChange={(e) => setActiveItem({ ...activeItem, route: e.target.value as MedicineRoute })}
                      data-testid="item-route-select"
                    >
                      <option value="ORAL">ORAL</option>
                      <option value="TOPICAL">TOPICAL</option>
                      <option value="INJECTION">INJECTION</option>
                      <option value="DROPS">DROPS</option>
                      <option value="INHALATION">INHALATION</option>
                    </select>
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-[11px] font-semibold">Special Instructions (Optional)</Label>
                    <Input
                      placeholder="e.g. Take with warm water before bedtime"
                      value={activeItem.specialInstructions || ""}
                      onChange={(e) => setActiveItem({ ...activeItem, specialInstructions: e.target.value })}
                      className="text-xs"
                      data-testid="item-instructions-input"
                    />
                  </div>
                </div>

                {/* Direct 24-char ObjectId specification fallback */}
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground font-mono">
                    Catalog Medicine ID (24-hex ObjectId) *
                  </Label>
                  <Input
                    placeholder="e.g. 64b8e2f01a2b3c4d5e6f7a88"
                    value={activeItem.medicineId || ""}
                    onChange={(e) => setActiveItem({ ...activeItem, medicineId: e.target.value.trim() })}
                    className="font-mono text-[11px] h-8"
                    data-testid="item-id-input"
                  />
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleAddMedicineItem}
                  className="w-full sm:w-auto"
                  data-testid="add-medicine-item-btn"
                >
                  <Plus className="size-3.5 mr-1.5" /> Add Medicine to Prescription
                </Button>
              </div>

              {/* Added Medicines Table */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Prescribed Medication Regimen ({medicines.length})
                </h4>

                {medicines.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    No medication items added yet. Search the catalog above or input medicine details to prescribe.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                        <tr>
                          <th className="p-3">Medicine</th>
                          <th className="p-3">Dosage</th>
                          <th className="p-3">Frequency</th>
                          <th className="p-3">Duration</th>
                          <th className="p-3">Qty</th>
                          <th className="p-3">Route</th>
                          <th className="p-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {medicines.map((item, idx) => (
                          <tr key={item.id} className="hover:bg-muted/20">
                            <td className="p-3 font-semibold text-foreground">
                              {item.medicineName}
                              {item.specialInstructions && (
                                <p className="text-[11px] text-muted-foreground font-normal">
                                  {item.specialInstructions}
                                </p>
                              )}
                            </td>
                            <td className="p-3">{item.dosage}</td>
                            <td className="p-3">{item.frequency}</td>
                            <td className="p-3">{item.durationDays} days</td>
                            <td className="p-3 font-mono">{item.quantity}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-[10px]">
                                {item.route}
                              </Badge>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveMedicineItem(item.id)}
                                className="text-muted-foreground hover:text-destructive p-1 rounded-md transition-colors"
                                data-testid={`remove-medicine-${idx}`}
                                title="Remove item"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Additional Physician Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="rx-notes" className="text-xs font-semibold text-foreground">
                  Physician Advice & General Instructions (Optional)
                </Label>
                <textarea
                  id="rx-notes"
                  rows={2}
                  placeholder="e.g. Return for review in 7 days if fever persists. Maintain hydration."
                  value={additionalNotes}
                  onChange={(e) => setAdditionalNotes(e.target.value)}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="prescription-notes-input"
                />
              </div>

              {/* Step 1 Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={medicines.length === 0 || !diagnosis.trim()}
                  data-testid="proceed-to-review-btn"
                >
                  Review Prescription <ChevronRight className="size-4 ml-1.5" />
                </Button>
              </div>
            </form>
          )}

          {/* STEP 2: MANDATORY FINAL REVIEW & EXPLICIT DOCTOR CONFIRMATION */}
          {step === 2 && (
            <div className="space-y-6" data-testid="prescription-step-2">
              <div className="rounded-xl border border-amber-300 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30 p-4 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
                <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold">Physician Confirmation Required Before Issuance</p>
                  <p>
                    Please inspect all medication dosages, quantities, and administration routes. Once confirmed, this digital prescription will be cryptographically locked into the patient record and cannot be edited.
                  </p>
                </div>
              </div>

              {/* Print-Friendly Clinical Rx Preview Card */}
              <div className="rounded-2xl border-2 border-border p-6 sm:p-8 bg-card shadow-sm space-y-6 relative print:border-none print:shadow-none" data-testid="prescription-preview-card">
                {/* DRAFT WATERMARK BANNER */}
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div>
                    <h2 className="text-xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
                      <FileText className="size-5 text-primary" /> LifeLine Digital Prescription
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Attending Physician: {doctorName || "Verified LifeLine Medical Practitioner"}
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="destructive" className="uppercase font-mono text-[10px] tracking-widest px-2.5 py-1">
                      DRAFT — NOT ISSUED
                    </Badge>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Date: {new Date().toLocaleDateString()}
                    </p>
                  </div>
                </div>

                {/* Patient Summary Snapshot */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-muted/20 p-3.5 rounded-xl border border-border/60">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Patient Name</span>
                    <span className="font-semibold text-foreground">
                      {appointment.patientName || `Patient (${appointment.patientId.slice(-6)})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Appointment ID</span>
                    <span className="font-mono font-semibold text-foreground">
                      #{appointment.id.slice(-8).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Consultation Date</span>
                    <span className="font-semibold text-foreground">
                      {new Date(appointment.scheduledStart).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Reason for Visit</span>
                    <span className="font-semibold text-foreground truncate block">
                      {appointment.reason || "General Consultation"}
                    </span>
                  </div>
                </div>

                {/* Diagnosis Section */}
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Clinical Diagnosis (Rx)
                  </h4>
                  <p className="text-sm font-semibold text-foreground p-3 rounded-lg bg-primary/5 border border-primary/20">
                    {diagnosis}
                  </p>
                </div>

                {/* Medicines List */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Prescribed Medicines ({medicines.length})
                  </h4>

                  <div className="rounded-xl border border-border overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 border-b border-border text-muted-foreground font-semibold">
                        <tr>
                          <th className="p-3">#</th>
                          <th className="p-3">Medication</th>
                          <th className="p-3">Dosage</th>
                          <th className="p-3">Frequency</th>
                          <th className="p-3">Duration</th>
                          <th className="p-3">Qty</th>
                          <th className="p-3">Route</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {medicines.map((m, idx) => (
                          <tr key={m.id}>
                            <td className="p-3 text-muted-foreground font-mono">{idx + 1}</td>
                            <td className="p-3 font-bold text-foreground">
                              {m.medicineName}
                              {m.specialInstructions && (
                                <p className="text-[11px] font-normal text-muted-foreground">
                                  {m.specialInstructions}
                                </p>
                              )}
                            </td>
                            <td className="p-3">{m.dosage}</td>
                            <td className="p-3">{m.frequency}</td>
                            <td className="p-3">{m.durationDays} days</td>
                            <td className="p-3 font-mono">{m.quantity}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="text-[10px]">
                                {m.route}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Additional Clinical Notes */}
                {additionalNotes && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Physician Remarks & Patient Instructions
                    </h4>
                    <p className="text-xs text-muted-foreground bg-muted/10 p-3 rounded-lg border border-border">
                      {additionalNotes}
                    </p>
                  </div>
                )}
              </div>

              {/* Step 2 Actions */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-border">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={isSubmitting}
                  data-testid="back-to-edit-btn"
                >
                  <ChevronLeft className="size-4 mr-1.5" /> Back to Edit
                </Button>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handlePrint}
                    data-testid="print-draft-preview-btn"
                  >
                    <Printer className="size-4 mr-1.5" /> Print Preview
                  </Button>

                  <Button
                    type="button"
                    variant="default"
                    onClick={handleConfirmAndIssuePrescription}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto"
                    data-testid="confirm-issue-prescription-btn"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="size-4 mr-1.5 animate-spin" /> Issuing Digital Rx...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="size-4 mr-1.5" /> Confirm and Issue Prescription
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: OFFICIAL AUTHORITATIVE CONFIRMATION */}
          {step === 3 && issuedPrescription && (
            <div className="space-y-6 text-center py-6" data-testid="prescription-step-3">
              <div className="size-16 rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="size-8" />
              </div>

              <div className="space-y-1">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">
                  Prescription Issued Successfully
                </h3>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  The digital prescription is now official and attached to the patient's record. Patients and partner pharmacies can access this document.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20 text-xs inline-block text-left font-mono space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Prescription ID:</span>
                  <span className="font-bold text-emerald-900 dark:text-emerald-300">
                    {issuedPrescription._id || issuedPrescription.id}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge variant="default" className="text-[10px]">
                    {issuedPrescription.status || "ACTIVE"}
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Issued At:</span>
                  <span>{new Date(issuedPrescription.issuedAt || Date.now()).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={handlePrint} data-testid="print-issued-rx-btn">
                  <Printer className="size-4 mr-1.5" /> Print Official Rx
                </Button>
                <Button type="button" onClick={onClose} data-testid="close-prescription-modal-btn">
                  Close Studio
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
