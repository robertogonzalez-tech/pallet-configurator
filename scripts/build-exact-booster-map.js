#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  buildLineSignatureFromBreakdown,
  buildFamilySignatureFromBreakdown,
  buildPatternSignatureFromBreakdown,
} = require('../api/lib/exactBooster');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const OUTPUT_FILE = path.join(process.cwd(), 'config', 'exact-booster-map.json');
const args = process.argv.slice(2);
const sourceArg = args.find((a) => a.startsWith('--source='));
const sourceOverride = sourceArg ? String(sourceArg.split('=')[1] || '').trim() : '';

const MIN_LINE_EXACT = 2;
const MIN_LINE_BIAS = 3;
const MIN_FAMILY_EXACT = 4;
const MIN_FAMILY_BIAS = 6;
const MIN_PATTERN_EXACT = 6;
const MIN_PATTERN_BIAS = 8;

function modeAndPct(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = null;
  let bestCount = 0;
  for (const [v, c] of counts.entries()) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return {
    mode: Number(best),
    modeCount: bestCount,
    modePct: values.length ? bestCount / values.length : 0,
    uniqueCount: counts.size,
  };
}

function summarizeBucket(bucket, minExact, minBias) {
  const n = bucket.count;
  const actualMode = modeAndPct(bucket.actualValues);
  const deltaMode = modeAndPct(bucket.deltaValues);
  const sortedActual = [...bucket.actualValues].sort((a, b) => a - b);
  const medianActual = sortedActual[Math.floor(sortedActual.length / 2)] || 0;
  const exactOverride =
    n >= minExact &&
    actualMode.uniqueCount === 1 &&
    actualMode.modePct === 1;

  let recommendedDelta = 0;
  if (
    n >= minBias &&
    actualMode.modePct >= 0.7 &&
    Number.isInteger(deltaMode.mode) &&
    Math.abs(deltaMode.mode) <= 1 &&
    deltaMode.mode !== 0 &&
    deltaMode.modePct >= 0.8
  ) {
    recommendedDelta = deltaMode.mode;
  }

  return {
    count: n,
    modeActual: actualMode.mode,
    modeActualPct: Number(actualMode.modePct.toFixed(4)),
    medianActual,
    minActual: sortedActual[0] ?? 0,
    maxActual: sortedActual[sortedActual.length - 1] ?? 0,
    exactOverride,
    recommendedDelta,
    deltaModePct: Number(deltaMode.modePct.toFixed(4)),
    sourceRows: bucket.sourceRows.slice(0, 20),
  };
}

function createBucketStore() {
  return { count: 0, actualValues: [], deltaValues: [], sourceRows: [] };
}

function addToBucket(map, signature, row) {
  if (!signature) return;
  if (!map.has(signature)) map.set(signature, createBucketStore());
  const b = map.get(signature);
  const actual = Number(row.actual_pallets);
  const predicted = Number(row.predicted_pallets);
  const delta = actual - predicted;
  b.count += 1;
  b.actualValues.push(actual);
  b.deltaValues.push(delta);
  b.sourceRows.push(String(row.sales_order_id || row.pick_ticket_id || row.id));
}

async function fetchRowsFromView(viewName) {
  const all = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(viewName)
      .select('id,sales_order_id,pick_ticket_id,predicted_pallets,actual_pallets,predicted_breakdown')
      .range(from, from + pageSize - 1);
    if (error) return { rows: null, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return { rows: all, error: null };
}

function toRecordMap(sourceMap, minExact, minBias) {
  const out = {};
  for (const [signature, bucket] of sourceMap.entries()) {
    const record = summarizeBucket(bucket, minExact, minBias);
    if (!record.exactOverride && !record.recommendedDelta) continue;
    out[signature] = record;
  }
  return out;
}

(async () => {
  const preferredView = sourceOverride || 'validations_eval_clean';
  const fallbackView = preferredView === 'validations_eval_clean'
    ? 'validations_eval_consistent'
    : 'validations_eval_clean';

  let viewName = preferredView;
  let viewResult = await fetchRowsFromView(viewName);
  if (viewResult.error) {
    viewName = fallbackView;
    viewResult = await fetchRowsFromView(viewName);
  }
  if (viewResult.error) {
    throw new Error(`Unable to load eval rows from ${preferredView} or ${fallbackView}: ${viewResult.error.message || viewResult.error}`);
  }

  const rows = (viewResult.rows || []).filter((row) =>
    Number.isFinite(Number(row.actual_pallets)) &&
    Number.isFinite(Number(row.predicted_pallets)) &&
    Array.isArray(row.predicted_breakdown)
  );

  const lineBuckets = new Map();
  const familyBuckets = new Map();
  const patternBuckets = new Map();
  for (const row of rows) {
    const lineSignature = buildLineSignatureFromBreakdown(row.predicted_breakdown);
    const familySignature = buildFamilySignatureFromBreakdown(row.predicted_breakdown);
    const patternSignature = buildPatternSignatureFromBreakdown(row.predicted_breakdown);
    addToBucket(lineBuckets, lineSignature, row);
    addToBucket(familyBuckets, familySignature, row);
    addToBucket(patternBuckets, patternSignature, row);
  }

  const map = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceView: viewName,
    sourceRows: rows.length,
    config: {
      minLineExact: MIN_LINE_EXACT,
      minLineBias: MIN_LINE_BIAS,
      minFamilyExact: MIN_FAMILY_EXACT,
      minFamilyBias: MIN_FAMILY_BIAS,
      minPatternExact: MIN_PATTERN_EXACT,
      minPatternBias: MIN_PATTERN_BIAS,
    },
    lineSignatures: toRecordMap(lineBuckets, MIN_LINE_EXACT, MIN_LINE_BIAS),
    familySignatures: toRecordMap(familyBuckets, MIN_FAMILY_EXACT, MIN_FAMILY_BIAS),
    patternSignatures: toRecordMap(patternBuckets, MIN_PATTERN_EXACT, MIN_PATTERN_BIAS),
  };

  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(map, null, 2)}\n`);

  const lineCount = Object.keys(map.lineSignatures).length;
  const familyCount = Object.keys(map.familySignatures).length;
  const patternCount = Object.keys(map.patternSignatures).length;
  console.log(`Exact booster map generated from ${viewName}:`);
  console.log(`- Source rows: ${rows.length}`);
  console.log(`- Line-signature rules: ${lineCount}`);
  console.log(`- Family-signature rules: ${familyCount}`);
  console.log(`- Pattern-signature rules: ${patternCount}`);
  console.log(`- Output: ${OUTPUT_FILE}`);
})().catch((error) => {
  console.error('build-exact-booster-map failed:', error?.message || error);
  process.exit(1);
});
