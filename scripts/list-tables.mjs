import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function listTables() {
    // Query to list tables in public schema
    const { data, error } = await supabase
        .from('price_jobs')
        .select('*')
        .limit(0);

    if (error) {
        console.log('PRICE_JOBS_ERROR: ' + error.message);
    } else {
        console.log('PRICE_JOBS_ACCESS_OK');
    }

    // Try to find what tables exist
    const { data: tables, error: tableError } = await supabase.rpc('get_tables'); // likely missing
    if (tableError) {
        console.log('RPC_GET_TABLES_FAILED');
    } else {
        console.log('TABLES: ' + JSON.stringify(tables));
    }
}

listTables();
