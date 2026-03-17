
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
    console.log("Checking Supabase connection to:", supabaseUrl);

    // 1. Fetch column list directly from Postgres
    console.log("\nFetching actual columns from information_schema...");
    const { data: columnData, error: columnError } = await supabase
        .from("columns") // This usually requires a view or RPC, but we can try a raw select via a trick or just assume PostgREST exposes it if RLS allows.
        // Actually, PostgREST doesn't expose information_schema by default.
        // Let's try to just select * and see if we can get anything.
        .select("*")
        .limit(1);

    // Fetch shop currency
    const testColumns = ["job_id", "shop_domain", "name", "status", "start_time", "end_time", "configuration", "original_data", "created_at", "updated_at"];
    console.log("\nTesting individual columns:");
    for (const col of testColumns) {
        const { error: colErr } = await supabase.from("price_jobs").select(col).limit(1);
        if (colErr) {
            console.log(`❌ Column '${col}': MISSING (${colErr.message})`);
        } else {
            console.log(`✅ Column '${col}': EXISTS`);
        }
    }

    // Check NEW columns from migration
    console.log("\n🔍 Checking NEW migration columns:");
    const newColumns = ["total_products", "processed_products", "preview_json", "result_json", "error"];
    let allPresent = true;
    for (const col of newColumns) {
        const { error: colErr } = await supabase.from("price_jobs").select(col).limit(1);
        if (colErr) {
            console.log(`❌ Column '${col}': MISSING`);
            allPresent = false;
        } else {
            console.log(`✅ Column '${col}': EXISTS`);
        }
    }

    if (allPresent) {
        console.log("\n🎉 Migration successful! All new columns are present.");
    } else {
        console.log("\n⚠️  Migration incomplete. Please run the SQL migration again.");
    }
}

checkSchema().then(async () => {
    console.log("\n--- Debugging Job Data ---");
    const { data, error } = await supabase
        .from('price_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Error fetching job:', error);
    } else if (data && data.length > 0) {
        const job = data[0];
        console.log('Latest Job ID:', job.job_id);
        console.log('Status:', job.status);
        console.log('Total Products (DB):', job.total_products);
        console.log('Processed Products (DB):', job.processed_products);
        console.log('Preview JSON Type:', typeof job.preview_json);
        console.log('Preview JSON Value:', JSON.stringify(job.preview_json, null, 2));

        // Check if columns actually exist in the returned object (if they are missing, select * might ignore them?)
        console.log('Keys in returned object:', Object.keys(job));
    } else {
        console.log('No jobs found.');
    }
});
