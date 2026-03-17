import { processPendingJobs } from "../services/bulk-update.server";

export async function loader({ request }: { request: Request }) {
    try {
        console.log("Cron API triggered");
        await processPendingJobs();
        return Response.json({ success: true, timestamp: new Date().toISOString() });
    } catch (error: any) {
        console.error("Cron API error:", error);
        return Response.json({ success: false, error: error.message }, { status: 500 });
    }
}
