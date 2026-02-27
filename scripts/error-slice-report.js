#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function uniqueFamiliesFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return [];
  const families = new Set();
  for (const row of breakdown) {
    const family = String(row?.matched || '').trim();
    if (!family) continue;
    if (['UNKNOWN', 'SKU_OVERRIDE', 'RIDE_ALONG', 'LONG_TUBE_TRIGGER'].includes(family)) continue;
    families.add(family);
  }
  return Array.from(families);
}

function bucketLabel(delta) {
  if (delta <= -2) return '<=-2';
  if (delta === -1) return '-1';
  if (delta === 0) return '0';
  if (delta === 1) return '+1';
  return '>=+2';
}

async function fetchValidatedRows() {
  const pageSize = 1000;
  let from = 0;
  const all = [];

  while (true) {
    const { data, error } = await supabase
      .from('validations')
      .select('id,sales_order_id,predicted_pallets,actual_pallets,predicted_breakdown,status')
      .eq('status', 'validated')
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

(async () => {
  const rows = await fetchValidatedRows();
  const valid = rows.filter((r) =>
    Number.isFinite(Number(r.actual_pallets)) &&
    Number.isFinite(Number(r.predicted_pallets))
  );

  const slices = {
    single: { total: 0, exact: 0, withinOne: 0 },
    multi: { total: 0, exact: 0, withinOne: 0 },
    unknown: { total: 0, exact: 0, withinOne: 0 },
  };
  const deltaBuckets = { '<=-2': 0, '-1': 0, '0': 0, '+1': 0, '>=+2': 0 };
  const familyMisses = new Map();

  for (const row of valid) {
    const actual = Number(row.actual_pallets);
    const predicted = Number(row.predicted_pallets);
    const delta = predicted - actual;
    const abs = Math.abs(delta);
    const families = uniqueFamiliesFromBreakdown(row.predicted_breakdown);

    const key = families.length === 0 ? 'unknown' : families.length === 1 ? 'single' : 'multi';
    slices[key].total += 1;
    if (abs === 0) slices[key].exact += 1;
    if (abs <= 1) slices[key].withinOne += 1;

    deltaBuckets[bucketLabel(delta)] += 1;

    if (abs > 1) {
      for (const family of families) {
        familyMisses.set(family, (familyMisses.get(family) || 0) + 1);
      }
    }
  }

  const pct = (num, den) => (den ? ((num / den) * 100).toFixed(1) : '0.0');
  const topMissFamilies = Array.from(familyMisses.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log('\n=== ERROR SLICE REPORT ===');
  console.log(`Rows: ${valid.length}`);
  console.log('\nBy order type:');
  for (const [name, stats] of Object.entries(slices)) {
    console.log(
      `- ${name}: ${stats.total} rows | exact ${pct(stats.exact, stats.total)}% | within ±1 ${pct(stats.withinOne, stats.total)}%`
    );
  }

  console.log('\nDelta distribution (predicted - actual):');
  for (const [bucket, count] of Object.entries(deltaBuckets)) {
    console.log(`- ${bucket}: ${count}`);
  }

  console.log('\nTop miss families (outside ±1):');
  if (topMissFamilies.length === 0) {
    console.log('- none');
  } else {
    for (const [family, count] of topMissFamilies) {
      console.log(`- ${family}: ${count}`);
    }
  }
})().catch((err) => {
  console.error('Failed to generate error-slice report:', err.message || err);
  process.exit(1);
});
