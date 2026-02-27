#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const SQL_FILE = path.join(process.cwd(), 'scripts', 'sql', 'create-validations-eval-consistent-view.sql');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const { error } = await supabase.rpc('exec_sql', { sql });
  if (error) {
    console.error('Failed to apply consistent eval view via RPC:', error.message || error);
    console.error(`Run this SQL manually in Supabase SQL editor: ${SQL_FILE}`);
    process.exit(1);
  }

  let verifyData = null;
  let verifyError = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const result = await supabase
      .from('validations_eval_consistent')
      .select('id')
      .limit(1);
    verifyData = result.data;
    verifyError = result.error;
    if (!verifyError) break;
    // Supabase PostgREST schema cache can lag immediately after DDL.
    if (attempt < 6 && /schema cache|could not find the table/i.test(String(verifyError.message || ''))) {
      await sleep(1500);
      continue;
    }
    break;
  }

  if (verifyError) {
    console.error('View verification failed for validations_eval_consistent:', verifyError.message || verifyError);
    process.exit(1);
  }

  console.log(`Applied and verified validations_eval_consistent (sample rows=${(verifyData || []).length})`);
}

main().catch((error) => {
  console.error('apply-consistent-eval-view failed:', error?.message || error);
  process.exit(1);
});
