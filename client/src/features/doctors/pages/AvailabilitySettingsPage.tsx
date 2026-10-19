import * as React from "react";
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  CheckCircle2,
  Sliders,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { ErrorAlert } from "@/components/ui/feedback-states";

export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export const DAYS_ORDER: DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export interface WorkingShift {
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
}

export interface WeeklyScheduleDay {
  dayOfWeek: DayOfWeek;
  shifts: WorkingShift[];
}

export interface ScheduleException {
  date: string;
  isAvailable: boolean;
  reason?: string;
  shifts?: WorkingShift[];
}

export interface DoctorAvailability {
  _id?: string;
  doctorId?: string;
  slotDurationMinutes: 15 | 30 | 60;
  weeklySchedule: WeeklyScheduleDay[];
  exceptions?: ScheduleException[];
}

interface AvailabilityResponse {
  success: boolean;
  data: DoctorAvailability;
  message?: string;
}

// Convert "HH:mm" to total minutes since midnight
export function toMinutes(time: string): number {
  if (!time || !time.includes(":")) return 0;
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

// Detect whether shifts overlap (adjacent touchpoints like 09:00-13:00 and 13:00-17:00 do NOT overlap)
export function hasOverlappingShifts(shifts: WorkingShift[]): boolean {
  if (!shifts || shifts.length <= 1) return false;
  const sorted = [...shifts].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = toMinutes(sorted[i].endTime);
    const nextStart = toMinutes(sorted[i + 1].startTime);
    if (currentEnd > nextStart) {
      return true;
    }
  }
  return false;
}

export function AvailabilitySettingsPage() {
  const [serverAvailability, setServerAvailability] = React.useState<DoctorAvailability | null>(null);
  const [slotDuration, setSlotDuration] = React.useState<15 | 30 | 60>(30);
  const [schedule, setSchedule] = React.useState<Record<DayOfWeek, WorkingShift[]>>({
    MONDAY: [],
    TUESDAY: [],
    WEDNESDAY: [],
    THURSDAY: [],
    FRIDAY: [],
    SATURDAY: [],
    SUNDAY: [],
  });

  // Track draft inputs for adding shifts per day
  const [newShiftInputs, setNewShiftInputs] = React.useState<
    Record<DayOfWeek, { startTime: string; endTime: string }>
  >({
    MONDAY: { startTime: "09:00", endTime: "13:00" },
    TUESDAY: { startTime: "09:00", endTime: "13:00" },
    WEDNESDAY: { startTime: "09:00", endTime: "13:00" },
    THURSDAY: { startTime: "09:00", endTime: "13:00" },
    FRIDAY: { startTime: "09:00", endTime: "13:00" },
    SATURDAY: { startTime: "10:00", endTime: "14:00" },
    SUNDAY: { startTime: "10:00", endTime: "14:00" },
  });

  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);
  const [isDirty, setIsDirty] = React.useState(false);

  // Initialize schedule from server response
  const populateSchedule = (data: DoctorAvailability) => {
    setServerAvailability(data);
    setSlotDuration(data.slotDurationMinutes || 30);

    const initialSchedule: Record<DayOfWeek, WorkingShift[]> = {
      MONDAY: [],
      TUESDAY: [],
      WEDNESDAY: [],
      THURSDAY: [],
      FRIDAY: [],
      SATURDAY: [],
      SUNDAY: [],
    };

    if (data.weeklySchedule && Array.isArray(data.weeklySchedule)) {
      for (const day of data.weeklySchedule) {
        if (day.dayOfWeek && initialSchedule[day.dayOfWeek] !== undefined) {
          initialSchedule[day.dayOfWeek] = [...day.shifts];
        }
      }
    }

    setSchedule(initialSchedule);
    setIsDirty(false);
  };

  const fetchAvailability = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.get<AvailabilityResponse>("/doctors/me/availability");
      populateSchedule(res.data);
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to load doctor availability.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to load doctor availability schedule.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchAvailability();
  }, []);

  // Shift editing actions
  const handleAddShift = (day: DayOfWeek) => {
    setErrorMsg(null);
    const { startTime, endTime } = newShiftInputs[day];

    // 1. Time validity
    const startMins = toMinutes(startTime);
    const endMins = toMinutes(endTime);

    if (startMins >= endMins) {
      setErrorMsg(`Shift start time (${startTime}) must be earlier than end time (${endTime}) for ${day}.`);
      return;
    }

    // 2. Compatibility with slot duration
    const duration = endMins - startMins;
    if (duration < slotDuration) {
      setErrorMsg(
        `Shift duration (${duration} mins) must be at least the slot duration of ${slotDuration} minutes.`
      );
      return;
    }
    if (duration % slotDuration !== 0) {
      setErrorMsg(
        `Shift duration (${duration} mins) must be an integer multiple of ${slotDuration} minutes.`
      );
      return;
    }

    // 3. Overlap check with existing shifts on this day
    const candidateShifts = [...schedule[day], { startTime, endTime }];
    if (hasOverlappingShifts(candidateShifts)) {
      setErrorMsg(`New shift (${startTime} - ${endTime}) overlaps with an existing shift on ${day}.`);
      return;
    }

    // Add shift
    setSchedule((prev) => ({
      ...prev,
      [day]: [...prev[day], { startTime, endTime }].sort(
        (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
      ),
    }));
    setIsDirty(true);
  };

  const handleRemoveShift = (day: DayOfWeek, index: number) => {
    setErrorMsg(null);
    setSchedule((prev) => ({
      ...prev,
      [day]: prev[day].filter((_, i) => i !== index),
    }));
    setIsDirty(true);
  };

  const handleSlotDurationChange = (newDuration: 15 | 30 | 60) => {
    setErrorMsg(null);

    // Validate that all existing shifts remain divisible by the new slot duration
    for (const day of DAYS_ORDER) {
      for (const shift of schedule[day]) {
        const dur = toMinutes(shift.endTime) - toMinutes(shift.startTime);
        if (dur < newDuration || dur % newDuration !== 0) {
          setErrorMsg(
            `Cannot switch to ${newDuration}-minute slots: existing shift ${shift.startTime}-${shift.endTime} on ${day} (${dur} mins) is not evenly divisible.`
          );
          return;
        }
      }
    }

    setSlotDuration(newDuration);
    setIsDirty(true);
  };

  // Save changes
  const handleSaveChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    // Comprehensive client-side validation
    for (const day of DAYS_ORDER) {
      const dayShifts = schedule[day];
      if (hasOverlappingShifts(dayShifts)) {
        setErrorMsg(`Shifts on ${day} contain overlapping intervals. Please resolve before saving.`);
        return;
      }
      for (const s of dayShifts) {
        const dur = toMinutes(s.endTime) - toMinutes(s.startTime);
        if (dur < slotDuration || dur % slotDuration !== 0) {
          setErrorMsg(
            `Shift ${s.startTime}-${s.endTime} on ${day} must be at least ${slotDuration} mins and divisible by ${slotDuration} mins.`
          );
          return;
        }
      }
    }

    setIsSaving(true);

    try {
      const weeklySchedulePayload: WeeklyScheduleDay[] = DAYS_ORDER.map((day) => ({
        dayOfWeek: day,
        shifts: schedule[day],
      }));

      const payload = {
        slotDurationMinutes: slotDuration,
        weeklySchedule: weeklySchedulePayload,
        exceptions: serverAvailability?.exceptions || [],
      };

      const res = await api.put<AvailabilityResponse>("/doctors/me/availability", payload);

      populateSchedule(res.data);
      setSuccessMsg("Weekly schedule and slot configuration saved successfully.");
    } catch (err: unknown) {
      // NOTE: Unsaved changes in `schedule` state are intentionally preserved on failure
      if (err instanceof ApiError) {
        setErrorMsg(err.message || "Failed to update availability schedule.");
      } else if (err instanceof Error) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to save availability settings. Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    if (serverAvailability) {
      populateSchedule(serverAvailability);
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4" data-testid="availability-loading">
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-24 w-full rounded-xl bg-muted/40 animate-pulse border border-border/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="availability-settings-page">
      {/* HEADER BANNER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Calendar className="size-6 text-primary" /> Weekly Schedule & Availability Builder
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure your recurring weekly consultation shifts and slot durations for patient booking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && (
            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 dark:text-amber-400">
              Unsaved Changes
            </Badge>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!isDirty || isSaving}
            data-testid="reset-schedule-btn"
          >
            <RotateCcw className="size-3.5 mr-1.5" /> Reset
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSaveChanges}
            disabled={!isDirty || isSaving}
            data-testid="save-schedule-btn"
          >
            <Save className="size-3.5 mr-1.5" /> {isSaving ? "Saving..." : "Save Schedule"}
          </Button>
        </div>
      </div>

      {/* FEEDBACK ALERTS */}
      {errorMsg && (
        <ErrorAlert
          title="Availability Schedule Notice"
          message={errorMsg}
          onRetry={() => setErrorMsg(null)}
          data-testid="availability-error-alert"
        />
      )}

      {successMsg && (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-center justify-between"
          data-testid="availability-success-alert"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900 font-semibold"
            onClick={() => setSuccessMsg(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* GLOBAL SLOT DURATION SELECTOR */}
      <Card className="border border-border shadow-xs">
        <CardHeader className="p-4 sm:p-5 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Sliders className="size-4 text-primary" /> Appointment Slot Duration
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground mt-0.5">
                Appointments are generated in uniform discrete slot increments.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2" data-testid="slot-duration-selector">
              {[15, 30, 60].map((mins) => (
                <Button
                  key={mins}
                  type="button"
                  variant={slotDuration === mins ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleSlotDurationChange(mins as 15 | 30 | 60)}
                  disabled={isSaving}
                  className="text-xs font-semibold px-3 h-8"
                  data-testid={`slot-duration-${mins}`}
                >
                  {mins} min
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* 7-DAY RECURRING SCHEDULE BUILDER */}
      <div className="space-y-4" data-testid="weekly-schedule-grid">
        {DAYS_ORDER.map((day) => {
          const shifts = schedule[day] || [];
          const inputState = newShiftInputs[day];

          return (
            <Card key={day} className="border border-border hover:shadow-xs transition-shadow" data-testid={`schedule-day-${day.toLowerCase()}`}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  {/* Day Label & Shift Count */}
                  <div className="w-40 shrink-0">
                    <span className="text-sm font-bold capitalize text-foreground block">
                      {day.toLowerCase()}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {shifts.length === 0 ? "Off / No Shifts" : `${shifts.length} active shift(s)`}
                    </span>
                  </div>

                  {/* Active Shifts Chips */}
                  <div className="flex-1 space-y-2">
                    {shifts.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70 italic py-1">
                        No working hours configured for this day. Doctor is marked unavailable.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        {shifts.map((shift, idx) => (
                          <div
                            key={`${shift.startTime}-${shift.endTime}-${idx}`}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/5 text-xs font-medium text-foreground"
                            data-testid={`shift-chip-${day.toLowerCase()}-${idx}`}
                          >
                            <Clock className="size-3 text-primary" />
                            <span>
                              {shift.startTime} – {shift.endTime}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              ({toMinutes(shift.endTime) - toMinutes(shift.startTime)}m)
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveShift(day, idx)}
                              disabled={isSaving}
                              className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                              title="Remove Shift"
                              data-testid={`remove-shift-${day.toLowerCase()}-${idx}`}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Add Shift Inline Form */}
                  <div className="flex items-center gap-2 shrink-0 pt-1">
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="time"
                        value={inputState.startTime}
                        onChange={(e) =>
                          setNewShiftInputs((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], startTime: e.target.value },
                          }))
                        }
                        className="h-8 text-xs w-24"
                        disabled={isSaving}
                        data-testid={`shift-start-${day.toLowerCase()}`}
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={inputState.endTime}
                        onChange={(e) =>
                          setNewShiftInputs((prev) => ({
                            ...prev,
                            [day]: { ...prev[day], endTime: e.target.value },
                          }))
                        }
                        className="h-8 text-xs w-24"
                        disabled={isSaving}
                        data-testid={`shift-end-${day.toLowerCase()}`}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => handleAddShift(day)}
                      disabled={isSaving}
                      className="h-8 px-2.5 text-xs"
                      data-testid={`add-shift-btn-${day.toLowerCase()}`}
                    >
                      <Plus className="size-3 mr-1" /> Add Shift
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
