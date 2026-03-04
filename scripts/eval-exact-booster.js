#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const {
  chooseExactBoosterAdjustment,
  loadExactBoosterMap,
} = require('../api/lib/exactBooster');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function pct(n, d) {
  if (!d) return 0;
  return (n / d) * 100;
}

(async () => {
  const { data, error } = await supabase
    .from('validations')
    .select('id,sales_order_id,predicted_pallets,actual_pallets,predicted_breakdown,status')
    .eq('status', 'validated');
  if (error) throw error;

  const map = loadExactBoosterMap();
  const rows = (data || []).filter((row) =>
    Number.isFinite(Number(row.predicted_pallets)) &&
    Number.isFinite(Number(row.actual_pallets)) &&
    Array.isArray(row.predicted_breakdown)
  );

  let exactBefore = 0;
  let exactAfter = 0;
  let within1Before = 0;
  let within1After = 0;
  let changed = 0;

  const changedExamples = [];

  for (const row of rows) {
    const predicted = Number(row.predicted_pallets);
    const actual = Number(row.actual_pallets);

    if (Math.abs(predicted - actual) === 0) exactBefore += 1;
    if (Math.abs(predicted - actual) <= 1) within1Before += 1;

    const adjustment = chooseExactBoosterAdjustment({
      breakdown: row.predicted_breakdown,
      currentPallets: predicted,
      diagnostics: {
        confidenceScore: 100,
        unknownProducts: 0,
        suspiciousExcludedLines: [],
      },
      map,
    });

    const adjusted = Math.max(1, predicted + (adjustment.requestedDelta || 0));
    if (adjusted !== predicted) {
      changed += 1;
      if (changedExamples.length < 25) {
        changedExamples.push({
          sales_order_id: row.sales_order_id,
          predicted_before: predicted,
          predicted_after: adjusted,
          actual,
          source: adjustment.source,
          rule: adjustment.rule,
        });
      }
    }

    if (Math.abs(adjusted - actual) === 0) exactAfter += 1;
    if (Math.abs(adjusted - actual) <= 1) within1After += 1;
  }

  const report = {
    rows: rows.length,
    exact_before_pct: pct(exactBefore, rows.length),
    exact_after_pct: pct(exactAfter, rows.length),
    within1_before_pct: pct(within1Before, rows.length),
    within1_after_pct: pct(within1After, rows.length),
    changed_rows: changed,
    examples: changedExamples,
  };

  console.log(JSON.stringify(report, null, 2));
})().catch((err) => {
  console.error('eval-exact-booster failed:', err?.message || err);
  process.exit(1);
});
