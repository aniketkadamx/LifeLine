import { Appointment } from "../models/appointment.model.js";
import { AppointmentStatus } from "../types/models.js";

export interface SlotCleanupResult {
  modifiedCount: number;
}

let cleanupTimer: NodeJS.Timeout | null = null;
let isExecutionInProgress = false;

/**
 * Releases expired appointment reservation locks by atomically transitioning
 * eligible appointments from PENDING_PAYMENT to CANCELLED.
 *
 * Query Boundary Conditions:
 * - status: PENDING_PAYMENT (strictly ignores CONFIRMED, COMPLETED, CANCELLED, etc.)
 * - lockExpiresAt < current time (strict expiration boundary)
 * - lockExpiresAt exists and is not null (safely ignores missing or null timestamps)
 *
 * Concurrency & Idempotency:
 * - Atomic bulk update guarantees that any concurrent status change (e.g. payment verified
 *   or user cancellation) will fail the filter and remain untouched.
 * - By transitioning status to CANCELLED, the appointment is automatically excluded from
 *   the active-slot unique index { doctorId: 1, scheduledStart: 1 }, immediately freeing
 *   the slot for other patients.
 * - Processing repeatedly is safe and idempotent.
 *
 * @param now Reference timestamp for expiration check (defaults to new Date())
 * @returns Object with count of released slots
 */
export async function releaseExpiredSlots(
  now: Date = new Date()
): Promise<SlotCleanupResult> {
  const result = await Appointment.updateMany(
    {
      status: AppointmentStatus.PENDING_PAYMENT,
      lockExpiresAt: { $lt: now, $exists: true, $ne: null },
    },
    {
      $set: {
        status: AppointmentStatus.CANCELLED,
        "cancellation.reason": "15-minute reservation lock expired without payment",
        "cancellation.cancelledAt": now,
      },
      $unset: {
        lockExpiresAt: 1,
      },
    }
  );

  return {
    modifiedCount: result.modifiedCount,
  };
}

/**
 * Executes a single cleanup run with error handling and concurrency overlap protection.
 * Ensures database failures do not crash the server and overlapping executions are skipped.
 */
async function executeCleanupRun(): Promise<void> {
  if (isExecutionInProgress) {
    console.warn(
      "[SlotCleanupJob] Previous cleanup execution still in progress. Skipping overlapping run."
    );
    return;
  }

  isExecutionInProgress = true;
  try {
    const result = await releaseExpiredSlots();
    if (result.modifiedCount > 0) {
      console.log(
        `[SlotCleanupJob] Released ${result.modifiedCount} expired appointment reservation lock(s)`
      );
    }
  } catch (error: unknown) {
    const errorMsg =
      error instanceof Error ? error.message : "Unknown database error";
    console.error(
      `[SlotCleanupJob] Error releasing expired reservation locks: ${errorMsg}`
    );
  } finally {
    isExecutionInProgress = false;
  }
}

/**
 * Starts the recurring scheduled slot cleanup worker.
 *
 * @param intervalMs Interval between executions in milliseconds (default: 60,000ms / 60s)
 * @param runImmediately Whether to execute an initial cleanup immediately upon startup (default: false)
 */
export function startSlotCleanupJob(
  intervalMs: number = 60000,
  runImmediately: boolean = false
): void {
  if (cleanupTimer) {
    console.warn("[SlotCleanupJob] Cleanup worker is already running. Ignoring duplicate start request.");
    return;
  }

  if (runImmediately) {
    void executeCleanupRun();
  }

  cleanupTimer = setInterval(() => {
    void executeCleanupRun();
  }, intervalMs);

  // Prevent background timer from blocking process exit if graceful shutdown initiates
  if (cleanupTimer && typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }

  console.log(
    `[SlotCleanupJob] Worker scheduled successfully (running every ${Math.round(intervalMs / 1000)}s)`
  );
}

/**
 * Stops the scheduled slot cleanup worker and cleans up resources.
 */
export function stopSlotCleanupJob(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
    isExecutionInProgress = false;
    console.log("[SlotCleanupJob] Worker stopped");
  }
}

/**
 * Checks whether the slot cleanup worker timer is currently active.
 */
export function isSlotCleanupJobActive(): boolean {
  return cleanupTimer !== null;
}
