import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase environment variables.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log("🔍 Checking columns for 'price_jobs' table...");

    try {
        const { data: row, error: selectError } = await supabase
            .from('price_jobs')
            .select('*')
            .limit(1);

        if (selectError) {
            console.error("❌ Error fetching data:", selectError.message);
            console.error("Error details:", JSON.stringify(selectError, null, 2));
            return;
        }

        if (row && row.length > 0) {
            const columns = Object.keys(row[0]);
            console.log("\n✅ Columns found in data row:");
            columns.forEach(col => console.log(` - ${col}`));

            if (columns.includes('completed_at')) {
                console.log("\n✨ 'completed_at' IS present!");
            } else {
                console.log("\n⚠️ 'completed_at' IS MISSING!");
            }
        } else {
            console.log("No data in table 'price_jobs' to inspect columns.");

            // Fallback: try to see if we can at least describe the table
            console.log("Attempting to insert a temporary row to see schema errors...");
            const { error: insertError } = await supabase
                .from('price_jobs')
                .insert({ name: 'Schema Test', status: 'failed' })
                .select();

            if (insertError) {
                console.error("Insert failed (this is expected if it hits constraints or missing columns):", insertError.message);
            }
        }
    } catch (err) {
        console.error("💥 Unexpected error:", err);
    }
}

checkSchema().then(() => console.log("Verification finished."));
