#!/bin/bash

# Suppress warnings and show progress
set -e

echo "🚀 Starting Supabase to VPS PostgreSQL Migration Utility"

# 1. Configuration
# Fill these in or use an .env file
SUPABASE_DB_URL="db.PROJECT_REF.supabase.co"
SUPABASE_USER="postgres"
SUPABASE_DB="postgres"
DUMP_FILE="supabase_dump_$(date +%Y%m%d_%H%M%S).sql"

VPS_HOST="YOUR_VPS_IP"
VPS_USER="postgres"
VPS_DB="axiom_editor"

read -p "Have you configured the variables in this script? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# 2. Exporting Schema
echo "📦 Step 1: Exporting 'public' schema from Supabase..."
pg_dump -h "$SUPABASE_DB_URL" -U "$SUPABASE_USER" -d "$SUPABASE_DB" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  --file="$DUMP_FILE"

echo "✅ Export complete: $DUMP_FILE"

# 3. Importing to VPS
echo "📥 Step 2: Importing to VPS PostgreSQL..."
echo "WARNING: This will apply the schema to $VPS_DB on $VPS_HOST."
read -p "Proceed with import? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

psql -h "$VPS_HOST" -U "$VPS_USER" -d "$VPS_DB" -f "$DUMP_FILE"

echo "🎉 Migration Finished!"

# 4. Verification Instructions
echo "--------------------------------------------------"
echo "🔍 VERIFICATION STEPS:"
echo "1. Table Counts:"
echo "   SELECT count(*) FROM shop_settings;"
echo "2. Enums:"
echo "   SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'revert_status';"
echo "3. Triggers:"
echo "   SELECT tgname FROM pg_trigger WHERE tgname LIKE '%updated_at%';"
echo "--------------------------------------------------"
