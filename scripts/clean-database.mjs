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

async function cleanDatabase() {
    console.log("Cleaning database storage (clearing all price jobs)...");

    const { error } = await supabase.from("price_jobs").delete().neq("job_id", "00000000-0000-0000-0000-000000000000"); // Delete everything

    if (error) {
        console.error("Cleanup failed:", error);
    } else {
        console.log("Cleanup successful. All tasks have been removed.");
    }
}

cleanDatabase();
