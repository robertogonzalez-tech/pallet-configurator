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

const SQL_FILES = [
  {
    label: 'shipment semantics columns/checks',
    file: path.join(process.cwd(), 'scripts', 'sql', 'ensure-shipment-completeness.sql'),
  },
  {
    label: 'validations_eval_clean view',
    file: path.join(process.cwd(), 'scripts', 'sql', 'create-validations-eval-clean-view.sql'),
  },
];

async function executeSql(sql) {
  // Primary path: database helper function present in some environments.
  const { error } = await supabase.rpc('exec_sql', { sql });
  return { ok: !error, error };
}

async function verifyColumns() {
  const requiredColumns = [
    'shipment_completeness',
    'shipment_completeness_reason',
    'actual_unit_basis',
    'actual_positions',
  ];
  for (const column of requiredColumns) {
    const { error } = await supabase.from('validations').select(column).limit(1);
    if (error) {
      return { ok: false, missing: column, error };
    }
  }
  return { ok: true };
}

async function verifyView() {
  const { error } = await supabase.from('validations_eval_clean').select('id').limit(1);
  if (error) return { ok: false, error };
  return { ok: true };
}

function printManualInstructions(failedFile, err) {
  console.error('\nAutomatic SQL execution is unavailable in this environment.');
  console.error(`Failed while applying: ${failedFile.label}`);
  console.error(`Error: ${err?.message || 'unknown error'}`);
  console.error('\nRun these SQL files manually in Supabase SQL Editor (in order):');
  for (const file of SQL_FILES) {
    console.error(`- ${file.file}`);
  }
  console.error('\nAfter running manually, re-run: npm run eval:accuracy -- --tag=post-data-contract --write-report');
}

async function main() {
  for (const file of SQL_FILES) {
    const sql = fs.readFileSync(file.file, 'utf8');
    const result = await executeSql(sql);
    if (!result.ok) {
      printManualInstructions(file, result.error);
      process.exit(1);
    }
    console.log(`Applied: ${file.label}`);
  }

  const columns = await verifyColumns();
  if (!columns.ok) {
    console.error(`Column verification failed: ${columns.missing}`);
    console.error(columns.error?.message || columns.error);
    process.exit(1);
  }

  const view = await verifyView();
  if (!view.ok) {
    console.error('View verification failed for validations_eval_clean');
    console.error(view.error?.message || view.error);
    process.exit(1);
  }

  console.log('Data contract migration applied and verified.');
}

main().catch((error) => {
  console.error('apply-data-contract failed:', error?.message || error);
  process.exit(1);
});
