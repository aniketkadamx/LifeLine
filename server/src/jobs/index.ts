import {
  startSlotCleanupJob,
  stopSlotCleanupJob,
  releaseExpiredSlots,
  isSlotCleanupJobActive,
} from "./slot-cleanup.job.js";

/**
 * Initializes and starts all background maintenance workers.
 */
export function startAllJobs(): void {
  console.log("[Jobs] Initializing background workers...");
  startSlotCleanupJob();
  console.log("[Jobs] Background workers initialized");
}

/**
 * Gracefully terminates all background maintenance workers.
 */
export function stopAllJobs(): void {
  console.log("[Jobs] Stopping background workers...");
  stopSlotCleanupJob();
  console.log("[Jobs] All background workers stopped cleanly");
}

export {
  startSlotCleanupJob,
  stopSlotCleanupJob,
  releaseExpiredSlots,
  isSlotCleanupJobActive,
};
