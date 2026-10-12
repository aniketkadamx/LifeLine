import { z } from "zod";
import { DayOfWeek } from "../types/models.js";

/**
 * Converts "HH:mm" time string into total minutes since midnight.
 */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Converts total minutes from midnight into "HH:mm" 24-hour string.
 */
export function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

/**
 * Resolves day of week in UTC for YYYY-MM-DD date string.
 */
export function getDayOfWeekFromDateString(dateStr: string): DayOfWeek {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  const days: DayOfWeek[] = [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ];
  return days[dt.getUTCDay()];
}

/**
 * Checks whether an array of shifts contains any intersecting or overlapping time intervals.
 * Returns true if any two shifts overlap; false otherwise.
 * Touching adjacent shifts (e.g. 09:00-13:00 and 13:00-17:00) do NOT overlap.
 */
export function hasOverlappingShifts(
  shifts: Array<{ startTime: string; endTime: string }>
): boolean {
  if (!shifts || shifts.length <= 1) return false;

  const sorted = [...shifts].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)
  );

  for (let i = 0; i < sorted.length - 1; i++) {
    const currentEnd = toMinutes(sorted[i].endTime);
    const nextStart = toMinutes(sorted[i + 1].startTime);
    if (currentEnd > nextStart) {
      return true; // Overlap detected
    }
  }

  return false;
}

/**
 * Checks whether a shift's total duration is at least slotDurationMinutes
 * and evenly divisible by slotDurationMinutes.
 */
export function isShiftCompatibleWithSlotDuration(
  shift: { startTime: string; endTime: string },
  slotDuration: number
): boolean {
  const duration = toMinutes(shift.endTime) - toMinutes(shift.startTime);
  return duration >= slotDuration && duration % slotDuration === 0;
}

/**
 * Strict time format validation: HH:mm in 24-hour notation (00:00 - 23:59).
 */
export const timeStringSchema = z
  .string({ required_error: "Time string is required" })
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in HH:mm 24-hour format (e.g. 09:00)");

/**
 * Zod schema for a single working shift with start and end times.
 */
export const workingShiftSchema = z
  .object({
    startTime: timeStringSchema,
    endTime: timeStringSchema,
  })
  .strict()
  .refine(
    (shift) => toMinutes(shift.startTime) < toMinutes(shift.endTime),
    {
      message: "Shift start time must precede end time",
      path: ["startTime"],
    }
  );

export type WorkingShiftInput = z.infer<typeof workingShiftSchema>;

/**
 * Zod schema for a daily recurring shift configuration.
 */
export const weeklyScheduleDaySchema = z
  .object({
    dayOfWeek: z.nativeEnum(DayOfWeek, {
      errorMap: () => ({
        message:
          "dayOfWeek must be one of: MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY",
      }),
    }),
    shifts: z.array(workingShiftSchema, {
      required_error: "Shifts array is required",
    }),
  })
  .strict()
  .refine(
    (day) => !hasOverlappingShifts(day.shifts),
    {
      message: "Shifts cannot overlap on the same day",
      path: ["shifts"],
    }
  );

export type WeeklyScheduleDayInput = z.infer<typeof weeklyScheduleDaySchema>;

/**
 * Calendar date string validation: YYYY-MM-DD.
 */
export const dateStringSchema = z
  .string({ required_error: "Date is required" })
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date must be in YYYY-MM-DD format")
  .refine(
    (val) => {
      const [year, month, day] = val.split("-").map(Number);
      const dt = new Date(Date.UTC(year, month - 1, day));
      return (
        dt.getUTCFullYear() === year &&
        dt.getUTCMonth() === month - 1 &&
        dt.getUTCDate() === day
      );
    },
    { message: "Date must be a valid calendar date" }
  );

/**
 * Zod validation schema for date-specific schedule exceptions and leave.
 */
export const scheduleExceptionSchema = z
  .object({
    date: dateStringSchema,
    isAvailable: z.boolean({ required_error: "isAvailable boolean is required" }),
    reason: z
      .string()
      .trim()
      .max(500, "Reason cannot exceed 500 characters")
      .optional(),
    shifts: z.array(workingShiftSchema).optional(),
  })
  .strict()
  .refine(
    (data) => {
      // If isAvailable === false (leave exception), shifts must not be provided or must be empty
      if (!data.isAvailable && data.shifts && data.shifts.length > 0) {
        return false;
      }
      return true;
    },
    {
      message: "Leave exceptions (isAvailable: false) must not specify working shifts",
      path: ["shifts"],
    }
  )
  .refine(
    (data) => {
      // If isAvailable === true (working exception), at least one shift must be provided
      if (data.isAvailable && (!data.shifts || data.shifts.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: "Working exceptions (isAvailable: true) must specify at least one shift",
      path: ["shifts"],
    }
  )
  .refine(
    (data) => {
      if (data.isAvailable && data.shifts) {
        return !hasOverlappingShifts(data.shifts);
      }
      return true;
    },
    {
      message: "Exception working shifts cannot overlap",
      path: ["shifts"],
    }
  );

export type ScheduleExceptionInput = z.infer<typeof scheduleExceptionSchema>;

/**
 * Supported slot durations specified by the roadmap: 15, 30, or 60 minutes.
 */
export const slotDurationSchema = z.union(
  [z.literal(15), z.literal(30), z.literal(60)],
  {
    errorMap: () => ({
      message: "slotDurationMinutes must be one of: 15, 30, 60",
    }),
  }
);

/**
 * Zod validation schema for updating doctor availability schedule.
 * Endpoint: PUT /api/v1/doctors/me/availability.
 * Source: docs/api/API_CONTRACT.md Section 5.2 & MASTER_IMPLEMENTATION_ROADMAP.md Task 5.2.
 */
export const updateAvailabilitySchema = z
  .object({
    slotDurationMinutes: slotDurationSchema,
    weeklySchedule: z.array(weeklyScheduleDaySchema, {
      required_error: "weeklySchedule array is required",
    }),
    exceptions: z.array(scheduleExceptionSchema).optional(),
  })
  .strict()
  .refine(
    (data) => {
      // Reject duplicate days of week in weeklySchedule
      const days = data.weeklySchedule.map((d) => d.dayOfWeek);
      return new Set(days).size === days.length;
    },
    {
      message: "weeklySchedule cannot contain duplicate dayOfWeek entries",
      path: ["weeklySchedule"],
    }
  )
  .refine(
    (data) => {
      // Ensure all shift lengths are integer multiples of slotDurationMinutes and >= slotDurationMinutes
      for (const day of data.weeklySchedule) {
        for (const shift of day.shifts) {
          if (!isShiftCompatibleWithSlotDuration(shift, data.slotDurationMinutes)) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message:
        "All shift durations must be at least slotDurationMinutes and divisible by slotDurationMinutes",
      path: ["weeklySchedule"],
    }
  );

export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;

/**
 * Route parameter validation schema for deleting an exception by date.
 */
export const exceptionDateParamSchema = z.object({
  date: dateStringSchema,
});

/**
 * Query parameter validation schema for public doctor slot computation.
 * Endpoint: GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD
 * Source: docs/api/API_CONTRACT.md Section 5.1 & MASTER_IMPLEMENTATION_ROADMAP.md Task 5.3.
 */
export const getDoctorAvailabilityQuerySchema = z
  .object({
    date: dateStringSchema,
  })
  .strict();

export type GetDoctorAvailabilityQuery = z.infer<
  typeof getDoctorAvailabilityQuerySchema
>;
