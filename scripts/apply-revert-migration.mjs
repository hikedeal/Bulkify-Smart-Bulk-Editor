import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationPath = path.join(__dirname, '../supabase/migrations/03_add_revert_scheduling.sql');
const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

console.log('\n==============================================');
console.log('📅 SCHEDULED REVERT MIGRATION');
console.log('==============================================\n');

console.log('This migration adds scheduled revert functionality to your app.\n');

console.log('📋 What this migration does:');
console.log('  • Adds scheduled_revert_at column (when to auto-revert)');
console.log('  • Adds reverted_at column (when revert happened)');
console.log('  • Adds completed_at column (when task completed)');
console.log('  • Adds revert_status column (scheduled/reverting/reverted/failed)');
console.log('  • Creates index for efficient scheduled revert queries\n');

console.log('🔗 Apply this migration in Supabase Dashboard:');
console.log('   https://supabase.com/dashboard/project/_/sql/new\n');

console.log('📝 Copy and paste this SQL:\n');
console.log('----------------------------------------');
console.log(migrationSQL);
console.log('----------------------------------------\n');

console.log('✅ After applying:');
console.log('  1. The migration will add the new columns');
console.log('  2. Restart your dev server (npm run dev)');
console.log('  3. Test scheduling a revert on a completed task\n');
