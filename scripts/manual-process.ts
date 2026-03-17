import { processPendingJobs } from "../app/services/bulk-update.server";
import dotenv from "dotenv";

dotenv.config();

console.log("Starting manual job processing...");
processPendingJobs().then(() => {
    console.log("Processing finished.");
}).catch(err => {
    console.error("Processing failed:", err);
});
