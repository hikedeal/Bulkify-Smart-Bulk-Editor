import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = "https://cserrwlsgzgzaehmsigt.supabase.co";
const supabaseKey = "sb_publishable_V1IIW-V3A64WsC8KLjS9JQ_6X5svoMj";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log("🔍 Checking columns for 'price_jobs' table with shop context...");

    try {
        // 1. Get a shop domain from the table first (we need one that exists)
        // Actually, let's try to set a dummy one and use service role if we have it.
        // We don't have service role key in .env, so let's try to bypass RLS by using a known shop or just checking the schema.

        // Let's try to use the RCP if it exists, otherwise just try to select.
        // Since we don't have service role, we can't bypass RLS easily unless we know a shop domain.

        // Wait, I can just try to run a query that might fail but tell us the column names in the error?
        // Or I'll just try to update a non-existent row with the column.

        const { error: testError } = await supabase
            .from('price_jobs')
            .update({ completed_at: new Date().toISOString() })
            .eq('job_id', '00000000-0000-0000-0000-000000000000'); // Non-existent ID

        if (testError) {
            console.log("Test Update Result:", testError.message);
            if (testError.message.includes("column \"completed_at\" of relation \"price_jobs\" does not exist")) {
                console.log("❌ CONFIRMED: column 'completed_at' does NOT exist.");
            } else if (testError.message.includes("Could not find the 'completed_at' column")) {
                console.log("❌ CONFIRMED: Column is not in the schema cache (PostgREST doesn't see it).");
            } else {
                console.log("✅ Column 'completed_at' MIGHT exist (no 'column does not exist' error).");
                console.log("Full error:", JSON.stringify(testError, null, 2));
            }
        } else {
            console.log("✅ Column 'completed_at' exists (update successful, 0 rows affected).");
        }

    } catch (err) {
        console.error("💥 Unexpected error:", err);
    }
}

checkSchema().then(() => console.log("Verification finished."));
