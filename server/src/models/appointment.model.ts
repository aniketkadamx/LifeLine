import { Schema, model, type Model } from "mongoose";
import {
  AppointmentStatus,
  ConsultationType,
  type IAppointment,
} from "../types/models.js";
import { toJSONPlugin } from "./plugins/toJSON.plugin.js";

const cancellationSchema = new Schema(
  {
    reason: { type: String, required: true, trim: true },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User" },
    cancelledAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const appointmentSchema = new Schema<IAppointment>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Patient ID is required"],
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Doctor ID is required"],
      index: true,
    },
    appointmentType: {
      type: String,
      enum: Object.values(ConsultationType),
      required: [true, "Appointment consultation type is required"],
    },
    scheduledStart: {
      type: Date,
      required: [true, "Scheduled start time is required"],
      index: true,
    },
    scheduledEnd: {
      type: Date,
      required: [true, "Scheduled end time is required"],
    },
    status: {
      type: String,
      enum: Object.values(AppointmentStatus),
      default: AppointmentStatus.PENDING_PAYMENT,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: [true, "Appointment reason is required"],
      trim: true,
      maxlength: [500, "Reason cannot exceed 500 characters"],
    },
    fee: {
      type: Number,
      required: [true, "Consultation fee is required"],
      min: [0, "Fee cannot be negative"],
    },
    currency: {
      type: String,
      default: "INR",
      uppercase: true,
      trim: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
    },
    paymentStatus: {
      type: String,
      enum: ["UNPAID", "PENDING", "PAID", "REFUNDED"],
      default: "UNPAID",
    },
    lockExpiresAt: {
      type: Date,
      index: true, // For 15-minute pending-payment lock release worker
    },
    consultationId: {
      type: Schema.Types.ObjectId,
      ref: "Consultation",
    },
    cancellation: {
      type: cancellationSchema,
    },
    rescheduledFrom: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    rescheduledTo: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
    },
    idempotencyKey: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * CRITICAL DOUBLE-BOOKING CONCURRENCY PROTECTION INDEX
 *
 * Partial unique index guaranteeing that no doctor can ever have two active
 * bookings at the exact same scheduled start timestamp.
 *
 * Active states: PENDING_PAYMENT, CONFIRMED, IN_PROGRESS.
 * Historical/Terminal states (CANCELLED, REJECTED, RESCHEDULED, NO_SHOW, COMPLETED)
 * are excluded from uniqueness so slots can be re-booked after cancellation.
 */
appointmentSchema.index(
  { doctorId: 1, scheduledStart: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: {
        $in: [
          AppointmentStatus.PENDING_PAYMENT,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.IN_PROGRESS,
        ],
      },
    },
  }
);

// Secondary operational indexes
appointmentSchema.index({ patientId: 1, scheduledStart: -1 });
appointmentSchema.index({ doctorId: 1, scheduledStart: -1 });

appointmentSchema.plugin(toJSONPlugin);

export const Appointment: Model<IAppointment> = model<IAppointment>(
  "Appointment",
  appointmentSchema
);
