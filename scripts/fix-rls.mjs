import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL || "";
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

console.log("\n🔧 RLS POLICY FIX REQUIRED\n");
console.log("The task creation is failing due to Row-Level Security policy.\n");
console.log("📋 Follow these steps:\n");
console.log("1. Open Supabase Dashboard:");
console.log(`   https://supabase.com/dashboard/project/${projectRef}/sql\n`);
console.log("2. Click 'New Query'\n");
console.log("3. Copy and paste this SQL:\n");

const migrationPath = path.join(__dirname, "../supabase/migrations/02_fix_rls_policy.sql");
const migrationSQL = fs.readFileSync(migrationPath, "utf-8");

console.log("─".repeat(80));
console.log(migrationSQL);
console.log("─".repeat(80));

console.log("\n4. Click 'Run'");
console.log("5. You should see 'Success. No rows returned'\n");
console.log("✅ After running, try creating a task again!\n");
