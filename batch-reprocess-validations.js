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
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const startArg = args.find(a => a.startsWith('--start-from='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const startFrom = startArg ? startArg.split('=')[1].toUpperCase() : null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function soNorm(v) {
  return String(v || '').toUpperCase().replace(/^SO/i, 'SO');
}

function getPrediction(result) {
  const pallets = result?.prediction?.totalPallets ?? result?.predicted?.pallets ?? result?.predicted_pallets;
  const weight = result?.prediction?.totalWeight ?? result?.predicted?.weight ?? result?.predicted_weight;
  const breakdown = result?.prediction?.breakdown ?? result?.predicted?.breakdown ?? result?.predicted_breakdown;
  return { pallets, weight, breakdown };
}

async function fetchValidatedRows() {
  const pageSize = 1000;
  let from = 0;
  let all = [];

  while (true) {
    const { data, error } = await supabase
      .from('validations')
      .select('id,sales_order_id,pick_ticket_id,actual_pallets,actual_weight,predicted_pallets,predicted_weight,predicted_breakdown,status,validated_at')
      .eq('status', 'validated')
      .order('validated_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function fetchPrediction(soNumber) {
  const res = await fetch(`${API_BASE}/api/validate-shipment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salesOrderNumber: soNumber, skipSave: true })
  });

  let body = {};
  try { body = await res.json(); } catch (_) {}

  if (!res.ok || body.success === false) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const prediction = getPrediction(body);
  if (prediction.pallets == null || prediction.weight == null || !Array.isArray(prediction.breakdown)) {
    throw new Error('Prediction mapping failed: missing pallets/weight/breakdown in response');
  }

  return prediction;
}

function calcAccuracy(rows, useNew = false) {
  let exact = 0;
  let withinOne = 0;
  let totalAbsError = 0;
  let n = 0;

  for (const r of rows) {
    const actual = Number(r.actual_pallets);
    const predicted = Number(useNew ? r._new_predicted_pallets : r.predicted_pallets);
    if (!Number.isFinite(actual) || !Number.isFinite(predicted)) continue;
    const delta = Math.abs(actual - predicted);
    if (delta === 0) exact += 1;
    if (delta <= 1) withinOne += 1;
    totalAbsError += delta;
    n += 1;
  }

  return {
    n,
    exact,
    exactRate: n ? (exact / n) * 100 : 0,
    withinOne,
    withinOneRate: n ? (withinOne / n) * 100 : 0,
    mae: n ? totalAbsError / n : 0,
  };
}

(async () => {
  const startedAt = new Date().toISOString();
  console.log(`Starting batch reprocess ${dryRun ? '(DRY RUN)' : ''}`);
  console.log(`API: ${API_BASE}`);

  let rows = await fetchValidatedRows();
  rows = rows.filter(r => (r.sales_order_id || r.pick_ticket_id || '').toUpperCase().startsWith('SO'));

  if (startFrom) {
    const start = soNorm(startFrom);
    rows = rows.filter(r => soNorm(r.sales_order_id || r.pick_ticket_id) >= start);
  }

  if (limit && Number.isFinite(limit)) {
    rows = rows.slice(0, limit);
  }

  console.log(`Validated rows selected: ${rows.length}`);

  const oldAcc = calcAccuracy(rows, false);
  const successes = [];
  const errors = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const so = soNorm(row.sales_order_id || row.pick_ticket_id).replace(/^SO/, '');

    try {
      const prediction = await fetchPrediction(so);
      row._new_predicted_pallets = prediction.pallets;
      row._new_predicted_weight = prediction.weight;
      row._new_predicted_breakdown = prediction.breakdown;

      if (!dryRun) {
        const { error } = await supabase
          .from('validations')
          .update({
            predicted_pallets: prediction.pallets,
            predicted_weight: prediction.weight,
            predicted_breakdown: prediction.breakdown,
          })
          .eq('id', row.id);
        if (error) throw error;
      }

      successes.push({
        id: row.id,
        soNumber: `SO${so}`,
        oldPredictedPallets: row.predicted_pallets,
        newPredictedPallets: prediction.pallets,
        actualPallets: row.actual_pallets,
      });

      console.log(`[${i + 1}/${rows.length}] OK SO${so} (${row.predicted_pallets} -> ${prediction.pallets}, actual=${row.actual_pallets})`);
      await sleep(120);
    } catch (err) {
      const msg = err?.message || String(err);
      errors.push({ id: row.id, soNumber: `SO${so}`, error: msg });
      console.error(`[${i + 1}/${rows.length}] ERROR SO${so}: ${msg}`);
    }
  }

  const newAcc = calcAccuracy(rows, true);

  const log = {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    apiBase: API_BASE,
    totalSelected: rows.length,
    processed: successes.length + errors.length,
    succeeded: successes.length,
    failed: errors.length,
    oldAccuracy: oldAcc,
    newAccuracy: newAcc,
    improvements: {
      exactRateDelta: newAcc.exactRate - oldAcc.exactRate,
      withinOneRateDelta: newAcc.withinOneRate - oldAcc.withinOneRate,
      maeDelta: newAcc.mae - oldAcc.mae,
    },
    successes,
    errors,
  };

  const logName = `reprocess-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const logPath = path.join(process.cwd(), logName);
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  console.log('\n=== ACCURACY IMPACT ===');
  console.log(`Rows evaluated: ${oldAcc.n}`);
  console.log(`Exact match: ${oldAcc.exactRate.toFixed(1)}% -> ${newAcc.exactRate.toFixed(1)}% (${(newAcc.exactRate - oldAcc.exactRate).toFixed(1)} pts)`);
  console.log(`Within ±1 pallet: ${oldAcc.withinOneRate.toFixed(1)}% -> ${newAcc.withinOneRate.toFixed(1)}% (${(newAcc.withinOneRate - oldAcc.withinOneRate).toFixed(1)} pts)`);
  console.log(`MAE: ${oldAcc.mae.toFixed(2)} -> ${newAcc.mae.toFixed(2)} (${(newAcc.mae - oldAcc.mae).toFixed(2)})`);

  console.log('\n=== SUMMARY ===');
  console.log(`Succeeded: ${successes.length}`);
  console.log(`Failed: ${errors.length}`);
  console.log(`Log file: ${logPath}`);

  if (errors.length > 0) process.exitCode = 1;
})();
