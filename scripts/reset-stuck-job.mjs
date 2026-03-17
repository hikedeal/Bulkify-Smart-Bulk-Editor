import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetJob() {
    // Target the specific job from the screenshot/logs
    const jobId = "4b74bf9c-9124-4b7b-9a39-9d438116442e";

    console.log(`Resetting job ${jobId} to revert_pending...`);

    const { error } = await supabase.from("price_jobs").update({
        status: "running",
        revert_status: "revert_pending",
        processed_products: 0 // Start from fresh
    }).eq("job_id", jobId);

    if (error) {
        console.error("Reset failed:", error);
    } else {
        console.log("Reset successful. User should refresh and it will auto-start.");
    }
}

resetJob();
