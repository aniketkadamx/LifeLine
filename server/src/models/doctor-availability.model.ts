import { Schema, model, type Model } from "mongoose";
import {
  DayOfWeek,
  type IDoctorAvailability,
  type IWorkingShift,
  type IWeeklyScheduleDay,
  type IScheduleException,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const workingShiftSchema = new Schema<IWorkingShift>(
  {
    startTime: {
      type: String,
      required: [true, "Shift start time is required"],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Shift start time must be in HH:mm format"],
      trim: true,
    },
    endTime: {
      type: String,
      required: [true, "Shift end time is required"],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Shift end time must be in HH:mm format"],
      trim: true,
    },
  },
  { _id: false }
);

const weeklyScheduleDaySchema = new Schema<IWeeklyScheduleDay>(
  {
    dayOfWeek: {
      type: String,
      enum: Object.values(DayOfWeek),
      required: [true, "Day of week is required"],
    },
    shifts: {
      type: [workingShiftSchema],
      default: [],
    },
  },
  { _id: false }
);

const scheduleExceptionSchema = new Schema<IScheduleException>(
  {
    date: {
      type: String,
      required: [true, "Exception date is required"],
      match: [/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Date must be in YYYY-MM-DD format"],
      trim: true,
    },
    isAvailable: {
      type: Boolean,
      default: false,
    },
    reason: {
      type: String,
      trim: true,
    },
    shifts: {
      type: [workingShiftSchema],
      default: [],
    },
  },
  { _id: true }
);

scheduleExceptionSchema.plugin(toJSONPlugin);

const doctorAvailabilitySchema = new Schema<IDoctorAvailability>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: [true, "Doctor profile ID is required"],
      unique: true,
      index: true,
    },
    slotDurationMinutes: {
      type: Number,
      enum: [15, 30, 60],
      default: 30,
      required: [true, "Slot duration is required"],
    },
    weeklySchedule: {
      type: [weeklyScheduleDaySchema],
      default: [],
    },
    exceptions: {
      type: [scheduleExceptionSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Index for fast lookup of doctor date exceptions
doctorAvailabilitySchema.index({ doctorId: 1, "exceptions.date": 1 });

doctorAvailabilitySchema.plugin(toJSONPlugin);

export const DoctorAvailability: Model<IDoctorAvailability> = model<IDoctorAvailability>(
  "DoctorAvailability",
  doctorAvailabilitySchema
);
