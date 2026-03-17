import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
    console.log("🔄 Applying database migration...\n");

    // Read the migration file
    const migrationPath = path.join(__dirname, "../supabase/migrations/01_add_job_columns.sql");
    const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

    console.log("📄 Migration SQL:");
    console.log(migrationSQL);
    console.log("\n");

    try {
        // Execute the SQL via RPC or direct query
        // Note: Supabase client doesn't directly support DDL, so we'll use the REST API
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({ query: migrationSQL })
        });

        if (!response.ok) {
            // If RPC doesn't work, try alternative approach
            console.log("⚠️  Direct SQL execution not available via REST API.");
            console.log("📋 Please copy the SQL above and run it manually in Supabase Dashboard → SQL Editor\n");
            console.log("Alternative: Use Supabase CLI:");
            console.log("  npx supabase db push\n");
            return;
        }

        const result = await response.json();
        console.log("✅ Migration applied successfully!");
        console.log(result);

    } catch (error) {
        console.error("❌ Error applying migration:", error.message);
        console.log("\n📋 Manual Steps:");
        console.log("1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql");
        console.log("2. Copy the SQL from: supabase/migrations/01_add_job_columns.sql");
        console.log("3. Paste and run in SQL Editor");
    }
}

// Verify columns after migration
async function verifyColumns() {
    console.log("\n🔍 Verifying new columns...\n");

    const columnsToCheck = [
        "total_products",
        "processed_products",
        "preview_json",
        "result_json",
        "error"
    ];

    for (const col of columnsToCheck) {
        const { error } = await supabase.from("price_jobs").select(col).limit(1);
        if (error) {
            console.log(`❌ Column '${col}': MISSING`);
        } else {
            console.log(`✅ Column '${col}': EXISTS`);
        }
    }
}

applyMigration().then(() => {
    setTimeout(verifyColumns, 2000);
});
