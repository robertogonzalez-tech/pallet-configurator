#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = process.env.REPROCESS_API_BASE || 'https://pallet-configurator.vercel.app';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;
const writeReport = args.includes('--write-report');

function isLikelyPhysical(line) {
  const sku = String(line?.sku || '').toUpperCase();
  if (!sku) return false;
  if (sku.startsWith('50801-') || sku.startsWith('SIK')) return true;
  if (/^\d{5,}-/.test(sku)) return true;
  if (sku.includes('KIT')) return true;
  return false;
}

async function fetchRows() {
  const { data, error } = await supabase
    .from('validations')
    .select('id,sales_order_id,actual_pallets,predicted_pallets,status,shipment_completeness')
    .eq('status', 'validated')
    .order('validated_at', { ascending: true })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

async function fetchDebugPrediction(so) {
  const body = {
    salesOrderNumber: String(so || '').replace(/^SO/i, ''),
    skipSave: true,
    debug: true,
  };
  const response = await fetch(`${API_BASE}/api/validate-shipment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok || json.success === false) {
    return { error: json.error || `HTTP ${response.status}` };
  }
  return json;
}

function toMarkdown(report) {
  const lines = [];
  lines.push(`# Blindness Report ${report.generated_at}`);
  lines.push('');
  lines.push(`- API base: ${report.api_base}`);
  lines.push(`- rows analyzed: ${report.rows_analyzed}`);
  lines.push(`- likely physical excluded lines detected: ${report.total_likely_physical_excluded}`);
  lines.push('');
  lines.push('| SO | Pred | Actual | Delta | Raw | Included | Excluded | Likely Physical Excluded |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of report.rows) {
    lines.push(`| ${row.sales_order_id} | ${row.predicted} | ${row.actual} | ${row.delta} | ${row.raw_lines_count} | ${row.included_count} | ${row.excluded_count} | ${row.likely_physical_excluded_count} |`);
  }
  lines.push('');
  lines.push('## Top Excluded Likely-Physical SKUs');
  for (const sku of report.top_excluded_likely_physical_skus) {
    lines.push(`- ${sku.sku}: ${sku.count}`);
  }
  lines.push('');
  lines.push('## Details');
  for (const row of report.rows) {
    lines.push(`### ${row.sales_order_id}`);
    lines.push(`- delta: ${row.delta}`);
    lines.push(`- likely physical excluded: ${row.likely_physical_excluded_count}`);
    for (const ex of row.likely_physical_excluded.slice(0, 15)) {
      lines.push(`  - ${ex.sku} qty ${ex.qty} reason ${ex.reason}`);
    }
  }
  return lines.join('\n');
}

(async () => {
  const all = await fetchRows();
  const ranked = all
    .map((row) => {
      const predicted = Number(row.predicted_pallets);
      const actual = Number(row.actual_pallets);
      const delta = predicted - actual;
      return {
        ...row,
        predicted,
        actual,
        delta,
        absDelta: Math.abs(delta),
      };
    })
    .filter((row) => Number.isFinite(row.predicted) && Number.isFinite(row.actual))
    .sort((a, b) => b.absDelta - a.absDelta)
    .slice(0, limit);

  const outRows = [];
  const skuCounts = new Map();
  let totalLikelyPhysicalExcluded = 0;

  for (const row of ranked) {
    const so = row.sales_order_id;
    if (!so) continue;
    const prediction = await fetchDebugPrediction(so);
    if (prediction.error) {
      outRows.push({
        sales_order_id: so,
        predicted: row.predicted,
        actual: row.actual,
        delta: row.delta,
        error: prediction.error,
      });
      continue;
    }
    const diagnostics = prediction.diagnostics || {};
    const rawLines = diagnostics.raw_lines || diagnostics.rawLines || [];
    const included = diagnostics.included_lines || diagnostics.includedLines || [];
    const excluded = diagnostics.excluded_lines || diagnostics.excludedLines || [];
    const likelyPhysicalExcluded = excluded.filter(isLikelyPhysical);
    totalLikelyPhysicalExcluded += likelyPhysicalExcluded.length;
    for (const ex of likelyPhysicalExcluded) {
      const sku = String(ex.sku || '').toUpperCase();
      skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
    }

    outRows.push({
      sales_order_id: so,
      predicted: row.predicted,
      actual: row.actual,
      delta: row.delta,
      raw_lines_count: rawLines.length,
      included_count: included.length,
      excluded_count: excluded.length,
      likely_physical_excluded_count: likelyPhysicalExcluded.length,
      likely_physical_excluded: likelyPhysicalExcluded.map((ex) => ({
        sku: ex.sku,
        qty: ex.qty,
        reason: ex.reason,
      })),
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    api_base: API_BASE,
    rows_analyzed: outRows.length,
    total_likely_physical_excluded: totalLikelyPhysicalExcluded,
    top_excluded_likely_physical_skus: Array.from(skuCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([sku, count]) => ({ sku, count })),
    rows: outRows,
  };

  console.log(JSON.stringify(report, null, 2));

  if (writeReport) {
    const docsDir = path.join(process.cwd(), 'docs', 'accuracy');
    fs.mkdirSync(docsDir, { recursive: true });
    const tag = new Date().toISOString().slice(0, 10);
    const jsonPath = path.join(docsDir, `blindness-report-${tag}.json`);
    const mdPath = path.join(docsDir, `blindness-report-${tag}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(mdPath, toMarkdown(report));
    console.error(`Wrote ${jsonPath}`);
    console.error(`Wrote ${mdPath}`);
  }
})().catch((error) => {
  console.error('blindness-report failed:', error?.message || error);
  process.exit(1);
});
