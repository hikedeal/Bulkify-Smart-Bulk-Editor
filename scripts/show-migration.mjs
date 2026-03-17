import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || "";
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

console.log("\n🔧 DATABASE MIGRATION REQUIRED\n");
console.log("📋 Follow these steps to apply the migration:\n");
console.log("1. Open Supabase Dashboard:");
console.log(`   https://supabase.com/dashboard/project/${projectRef}/sql\n`);
console.log("2. Click 'New Query' button\n");
console.log("3. Copy and paste this SQL:\n");

const migrationPath = path.join(__dirname, "../supabase/migrations/01_add_job_columns.sql");
const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

console.log("─".repeat(80));
console.log(migrationSQL);
console.log("─".repeat(80));

console.log("\n4. Click 'Run' to execute");
console.log("5. You should see 'Success. No rows returned'\n");
console.log("✅ After running, delete the stuck task and create a new one!\n");
