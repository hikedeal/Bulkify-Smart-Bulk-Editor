import cron from "node-cron";
import { processPendingJobs, checkScheduledReverts } from "./bulk-update.server";

// Store the active cron job globally to allow for hot-reloading in development
declare global {
    var __active_cron_job__: any;
}

export function initScheduler() {
    // If a cron job is already running, stop it so we can start one with the latest code
    if (global.__active_cron_job__) {
        console.log("Stopping old cron job...");
        global.__active_cron_job__.stop();
    }

    console.log("Initializing Cron Scheduler (Latest)...");

    // Run every 5 seconds
    const job = cron.schedule("*/5 * * * * *", async () => {
        try {
            // Re-importing logic here is tricky, but by re-scheduling 
            // the dev server should update the closure if this file is re-run.
            await processPendingJobs();
            await checkScheduledReverts();
        } catch (error) {
            console.error("Error in generic scheduler:", error);
        }
    });

    global.__active_cron_job__ = job;
}
