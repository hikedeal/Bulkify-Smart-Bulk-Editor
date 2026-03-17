import { checkScheduledReverts } from "./bulk-update.server";

// Interval in milliseconds (2 minutes)
const CHECK_INTERVAL = 2 * 60 * 1000;

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Start the scheduled revert checker
 * This runs in the background and checks for scheduled reverts every 2 minutes
 */
export function startRevertScheduler() {
    if (schedulerInterval) {
        console.log("Revert scheduler is already running");
        return;
    }

    console.log("Starting revert scheduler...");

    // Run immediately on start
    checkScheduledReverts();

    // Then run every 2 minutes
    schedulerInterval = setInterval(() => {
        checkScheduledReverts();
    }, CHECK_INTERVAL);

    console.log(`Revert scheduler started (checking every ${CHECK_INTERVAL / 1000} seconds)`);
}

/**
 * Stop the scheduled revert checker
 */
export function stopRevertScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        console.log("Revert scheduler stopped");
    }
}

// Auto-start the scheduler when this module is imported
// This ensures it runs when the app starts
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
    startRevertScheduler();
}
