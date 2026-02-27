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
const args = process.argv.slice(2);
const writeReport = args.includes('--write-report');
const reportTagArg = args.find((a) => a.startsWith('--tag='));
const reportTag = reportTagArg ? reportTagArg.split('=')[1] : null;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function toPercent(num, den) {
  if (!den) return 0;
  return (num / den) * 100;
}

function familyCountFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return 0;
  const ignored = new Set(['UNKNOWN', 'SKU_OVERRIDE', 'RIDE_ALONG', 'LONG_TUBE_TRIGGER', 'UNKNOWN_FALLBACK']);
  const families = new Set();
  for (const row of breakdown) {
    const family = String(row?.matched || '').trim();
    if (!family || ignored.has(family)) continue;
    families.add(family);
  }
  return families.size;
}

function familySetFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return [];
  const ignored = new Set(['UNKNOWN', 'SKU_OVERRIDE', 'RIDE_ALONG', 'LONG_TUBE_TRIGGER', 'UNKNOWN_FALLBACK']);
  const families = new Set();
  for (const row of breakdown) {
    const family = String(row?.matched || '').trim();
    if (!family || ignored.has(family)) continue;
    families.add(family);
  }
  return Array.from(families);
}

function hasSentinelFallback(breakdown) {
  if (!Array.isArray(breakdown)) return false;
  return breakdown.some((row) => {
    const matched = String(row?.matched || '').trim();
    return matched === 'ZERO_FLOOR' || matched === 'UNKNOWN_FALLBACK';
  });
}

function isLegacySo(row) {
  const so = String(row?.sales_order_id || row?.pick_ticket_id || '').toUpperCase();
  return /^SO[56]/.test(so);
}

function bucketFamilyCount(count) {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count === 2) return '2';
  if (count === 3) return '3';
  return '4+';
}

function initMetricBucket() {
  return {
    rows: 0,
    exact: 0,
    within1: 0,
    within2: 0,
    maeSum: 0,
    biasSum: 0,
    severeUnder: 0,
    severeOver: 0,
  };
}

function addMetric(bucket, predicted, actual) {
  const delta = predicted - actual;
  const absDelta = Math.abs(delta);
  bucket.rows += 1;
  bucket.maeSum += absDelta;
  bucket.biasSum += delta;
  if (absDelta === 0) bucket.exact += 1;
  if (absDelta <= 1) bucket.within1 += 1;
  if (absDelta <= 2) bucket.within2 += 1;
  if (actual - predicted >= 2) bucket.severeUnder += 1;
  if (predicted - actual >= 2) bucket.severeOver += 1;
}

function finalizeMetricBucket(bucket) {
  const n = bucket.rows || 1;
  return {
    rows: bucket.rows,
    exact_pct: toPercent(bucket.exact, n),
    within_1_pct: toPercent(bucket.within1, n),
    within_2_pct: toPercent(bucket.within2, n),
    mae: bucket.maeSum / n,
    bias: bucket.biasSum / n,
    severe_under_rate: toPercent(bucket.severeUnder, n),
    severe_over_rate: toPercent(bucket.severeOver, n),
  };
}

function computeMetrics(rows) {
  const overall = initMetricBucket();
  const byType = {
    single: initMetricBucket(),
    multi: initMetricBucket(),
    unknown: initMetricBucket(),
  };
  const familyBuckets = {
    '0': initMetricBucket(),
    '1': initMetricBucket(),
    '2': initMetricBucket(),
    '3': initMetricBucket(),
    '4+': initMetricBucket(),
  };
  const familyMissCounts = new Map();
  const skuMissCounts = new Map();

  for (const row of rows) {
    const predicted = Number(row.predicted_pallets);
    const actual = Number(row.actual_pallets);
    if (!Number.isFinite(predicted) || !Number.isFinite(actual)) continue;

    addMetric(overall, predicted, actual);

    const famCount = familyCountFromBreakdown(row.predicted_breakdown);
    const bucket = famCount === 0 ? 'unknown' : famCount === 1 ? 'single' : 'multi';
    addMetric(byType[bucket], predicted, actual);
    addMetric(familyBuckets[bucketFamilyCount(famCount)], predicted, actual);

    const absDelta = Math.abs(predicted - actual);
    if (absDelta > 1) {
      const fams = familySetFromBreakdown(row.predicted_breakdown);
      for (const family of fams) {
        familyMissCounts.set(family, (familyMissCounts.get(family) || 0) + 1);
      }
      if (Array.isArray(row.predicted_breakdown)) {
        for (const line of row.predicted_breakdown) {
          const sku = String(line?.sku || '').trim();
          if (!sku) continue;
          skuMissCounts.set(sku, (skuMissCounts.get(sku) || 0) + 1);
        }
      }
    }
  }

  return {
    rows: overall.rows,
    overall: finalizeMetricBucket(overall),
    by_type: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, finalizeMetricBucket(v)])),
    by_family_count: Object.fromEntries(Object.entries(familyBuckets).map(([k, v]) => [k, finalizeMetricBucket(v)])),
    top_family_error_buckets: Array.from(familyMissCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([family, count]) => ({ family, count })),
    top_sku_error_buckets: Array.from(skuMissCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([sku, count]) => ({ sku, count })),
  };
}

function dedupeCleanRows(rows) {
  const bySo = new Map();
  for (const row of rows) {
    const key = String(row.sales_order_id || row.pick_ticket_id || row.id);
    const existing = bySo.get(key);
    if (!existing) {
      bySo.set(key, row);
      continue;
    }
    const tsA = new Date(existing.validated_at || existing.created_at || 0).getTime();
    const tsB = new Date(row.validated_at || row.created_at || 0).getTime();
    if (tsB > tsA) bySo.set(key, row);
  }
  return Array.from(bySo.values());
}

async function fetchValidatedRows() {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabase
      .from('validations')
      .select('id,sales_order_id,pick_ticket_id,status,shipment_completeness,predicted_pallets,actual_pallets,predicted_breakdown,validated_at,created_at')
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

function toMarkdown(report) {
  const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
  const md = [];
  md.push(`# Accuracy Baseline ${report.generated_at}`);
  md.push('');
  md.push('## Dataset');
  md.push(`- validated rows: ${report.dataset.validated_rows}`);
  md.push(`- clean rows (complete + deduped): ${report.dataset.clean_rows}`);
  if (typeof report.dataset.consistent_rows === 'number') {
    md.push(`- consistent clean rows (clean - legacy ambiguity - sentinel fallback): ${report.dataset.consistent_rows}`);
  }
  md.push(`- shipment completeness counts: \`${JSON.stringify(report.dataset.shipment_completeness_counts)}\``);
  md.push('');
  md.push('## Metrics');
  md.push('');
  md.push('| Slice | Rows | Exact % | Within ±1 % | Within ±2 % | MAE | Bias | Severe Under % | Severe Over % |');
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  const row = (name, m) => `| ${name} | ${m.rows} | ${fmt(m.exact_pct)} | ${fmt(m.within_1_pct)} | ${fmt(m.within_2_pct)} | ${fmt(m.mae)} | ${fmt(m.bias)} | ${fmt(m.severe_under_rate)} | ${fmt(m.severe_over_rate)} |`;
  md.push(row('all', report.metrics_all.overall));
  md.push(row('clean', report.metrics_clean.overall));
  if (report.metrics_consistent?.overall) {
    md.push(row('consistent_clean', report.metrics_consistent.overall));
  }
  md.push('');
  md.push('## Clean Slice Breakdown');
  for (const [k, v] of Object.entries(report.metrics_clean.by_type)) {
    md.push(`- ${k}: exact ${fmt(v.exact_pct)}%, within±1 ${fmt(v.within_1_pct)}%, MAE ${fmt(v.mae)}`);
  }
  md.push('');
  md.push('### By Family Count (Clean)');
  for (const [k, v] of Object.entries(report.metrics_clean.by_family_count)) {
    md.push(`- families=${k}: rows ${v.rows}, exact ${fmt(v.exact_pct)}%, within±1 ${fmt(v.within_1_pct)}%, MAE ${fmt(v.mae)}`);
  }
  md.push('');
  md.push('### Top 20 Family Error Buckets (outside ±1, clean)');
  for (const b of report.metrics_clean.top_family_error_buckets) {
    md.push(`- ${b.family}: ${b.count}`);
  }
  md.push('');
  md.push('### Top 20 SKU Error Buckets (outside ±1, clean)');
  for (const b of report.metrics_clean.top_sku_error_buckets) {
    md.push(`- ${b.sku}: ${b.count}`);
  }
  md.push('');
  md.push('## SQL Used (Reference)');
  md.push('```sql');
  md.push(`SELECT id, sales_order_id, pick_ticket_id, status, shipment_completeness, predicted_pallets, actual_pallets, predicted_breakdown, validated_at, created_at`);
  md.push(`FROM validations`);
  md.push(`WHERE status = 'validated';`);
  md.push('```');
  return md.join('\n');
}

(async () => {
  const rows = await fetchValidatedRows();
  const completenessCounts = rows.reduce((acc, row) => {
    const key = row.shipment_completeness || 'null';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const completeRows = rows.filter((row) => String(row.shipment_completeness || '').toLowerCase() === 'complete');
  const cleanRows = dedupeCleanRows(completeRows);
  const consistentRows = cleanRows.filter((row) => !isLegacySo(row) && !hasSentinelFallback(row.predicted_breakdown));

  const report = {
    generated_at: new Date().toISOString(),
    dataset: {
      validated_rows: rows.length,
      clean_rows: cleanRows.length,
      consistent_rows: consistentRows.length,
      shipment_completeness_counts: completenessCounts,
    },
    metrics_all: computeMetrics(rows),
    metrics_clean: computeMetrics(cleanRows),
    metrics_consistent: computeMetrics(consistentRows),
  };

  console.log(JSON.stringify(report, null, 2));

  if (writeReport) {
    const docsDir = path.join(process.cwd(), 'docs', 'accuracy');
    fs.mkdirSync(docsDir, { recursive: true });
    const tag = reportTag || new Date().toISOString().slice(0, 10);
    const jsonPath = path.join(docsDir, `baseline-${tag}.json`);
    const mdPath = path.join(docsDir, `baseline-${tag}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, toMarkdown(report));
    console.error(`Wrote ${jsonPath}`);
    console.error(`Wrote ${mdPath}`);
  }
})().catch((error) => {
  console.error('eval-accuracy failed:', error?.message || error);
  process.exit(1);
});
