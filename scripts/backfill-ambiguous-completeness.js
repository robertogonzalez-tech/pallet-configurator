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

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rangeThresholdArg = args.find((a) => a.startsWith('--range-threshold='));
const rangeThreshold = rangeThresholdArg ? Number(rangeThresholdArg.split('=')[1]) : 2;

function keyOf(row) {
  return String(row.sales_order_id || row.pick_ticket_id || '').trim().toUpperCase();
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchValidatedRows() {
  const pageSize = 1000;
  let from = 0;
  const all = [];

  while (true) {
    const { data, error } = await supabase
      .from('validations')
      .select('id,sales_order_id,pick_ticket_id,actual_pallets,shipment_completeness,status,validated_at,created_at')
      .eq('status', 'validated')
      .order('validated_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

function findAmbiguousGroups(rows) {
  const groups = new Map();

  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const ambiguous = [];
  for (const [key, group] of groups.entries()) {
    if (group.length < 2) continue;

    const values = group.map((r) => toNumber(r.actual_pallets)).filter((v) => v != null);
    if (values.length < 2) continue;

    const uniq = Array.from(new Set(values)).sort((a, b) => a - b);
    const min = uniq[0];
    const max = uniq[uniq.length - 1];
    const range = max - min;
    if (uniq.length >= 2 && range >= rangeThreshold) {
      ambiguous.push({
        key,
        count: group.length,
        uniq,
        range,
        rows: group,
      });
    }
  }

  return ambiguous.sort((a, b) => b.range - a.range || b.count - a.count);
}

async function applyUpdates(groups) {
  let updated = 0;
  for (const g of groups) {
    const ids = g.rows
      .filter((r) => (r.shipment_completeness || 'complete') === 'complete')
      .map((r) => r.id);
    if (!ids.length) continue;

    const { error } = await supabase
      .from('validations')
      .update({ shipment_completeness: 'unknown' })
      .in('id', ids);
    if (error) throw error;
    updated += ids.length;
  }
  return updated;
}

(async () => {
  const rows = await fetchValidatedRows();
  const ambiguous = findAmbiguousGroups(rows);

  const candidateRows = ambiguous.reduce(
    (sum, g) => sum + g.rows.filter((r) => (r.shipment_completeness || 'complete') === 'complete').length,
    0
  );

  console.log(`Validated rows scanned: ${rows.length}`);
  console.log(`Ambiguous duplicate SO groups: ${ambiguous.length}`);
  console.log(`Rows eligible for shipment_completeness='unknown': ${candidateRows}`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);

  for (const g of ambiguous.slice(0, 25)) {
    console.log(
      `- ${g.key}: rows=${g.count}, actuals=[${g.uniq.join(', ')}], range=${g.range}`
    );
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to update rows.');
    return;
  }

  const updated = await applyUpdates(ambiguous);
  console.log(`Updated rows: ${updated}`);
})();
