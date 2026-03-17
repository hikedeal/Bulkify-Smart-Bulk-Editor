
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLatestJob() {
  const { data, error } = await supabase
    .from('price_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('Error fetching job:', error);
    return;
  }

  if (data && data.length > 0) {
    const job = data[0];
    console.log('Latest Job ID:', job.job_id);
    console.log('Status:', job.status);
    console.log('Total Products:', job.total_products);
    console.log('Original Data Keys:', job.original_data ? Object.keys(job.original_data).length : 0);
    console.log('Preview JSON Type:', typeof job.preview_json);
    console.log('Preview JSON isArray:', Array.isArray(job.preview_json));
    console.log('Preview JSON Length:', Array.isArray(job.preview_json) ? job.preview_json.length : 'N/A');
    if (Array.isArray(job.preview_json) && job.preview_json.length > 0) {
        console.log('Sample Preview Item:', JSON.stringify(job.preview_json[0], null, 2));
    } else {
        console.log('Preview JSON content:', job.preview_json);
    }
  } else {
    console.log('No jobs found.');
  }
}

checkLatestJob();

