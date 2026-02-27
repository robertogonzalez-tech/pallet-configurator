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

const ALLOWED_COMPLETENESS = new Set(['complete', 'partial', 'unknown']);
const ALLOWED_BASIS = new Set(['package_count', 'pallet_positions', 'unknown']);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeLower(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidCompleteness(value) {
  return ALLOWED_COMPLETENESS.has(normalizeLower(value));
}

function isValidBasis(value) {
  return ALLOWED_BASIS.has(normalizeLower(value));
}

function hasDimensions(dimensions) {
  if (!Array.isArray(dimensions) || dimensions.length === 0) return false;
  return dimensions.some((pkg) => {
    const l = Number(pkg?.length);
    const w = Number(pkg?.width);
    const h = Number(pkg?.height);
    return Number.isFinite(l) && Number.isFinite(w) && Number.isFinite(h) && l > 0 && w > 0 && h > 0;
  });
}

function inferSemantics(row, soCounts) {
  const currentCompleteness = normalizeLower(row.shipment_completeness);
  const currentBasis = normalizeLower(row.actual_unit_basis);

  const so = String(row.sales_order_id || '').trim();
  const duplicateSo = !!so && (soCounts.get(so) || 0) > 1;
  const predictedWeight = Number(row.predicted_weight) || 0;
  const actualWeight = Number(row.actual_weight) || 0;
  const actualPallets = Number(row.actual_pallets) || 0;
  const dimsPresent = hasDimensions(row.actual_dimensions);

  const suspectedPartialByWeight =
    predictedWeight >= 500 &&
    actualWeight > 0 &&
    actualWeight < (predictedWeight * 0.25);

  let shipmentCompleteness = currentCompleteness;
  if (!isValidCompleteness(shipmentCompleteness) || shipmentCompleteness === 'unknown') {
    if (duplicateSo || suspectedPartialByWeight) {
      shipmentCompleteness = 'partial';
    } else if (actualPallets > 0) {
      shipmentCompleteness = 'complete';
    } else {
      shipmentCompleteness = 'unknown';
    }
  }

  let actualUnitBasis = currentBasis;
  if (!isValidBasis(actualUnitBasis) || actualUnitBasis === 'unknown') {
    if (dimsPresent && actualPallets > 0) {
      actualUnitBasis = 'package_count';
    } else {
      actualUnitBasis = 'unknown';
    }
  }

  let actualPositions = row.actual_positions == null ? null : Number(row.actual_positions);
  if (!Number.isInteger(actualPositions) || actualPositions <= 0) {
    actualPositions = null;
  }
  if (actualUnitBasis !== 'pallet_positions') {
    actualPositions = null;
  }

  return {
    shipmentCompleteness,
    actualUnitBasis,
    actualPositions,
    duplicateSo,
    suspectedPartialByWeight,
    dimsPresent,
  };
}

async function fetchValidatedRows() {
  const selectClause = 'id,sales_order_id,actual_pallets,predicted_weight,actual_weight,actual_dimensions,shipment_completeness,actual_unit_basis,actual_positions,status,validated_at';
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabase
      .from('validations')
      .select(selectClause)
      .eq('status', 'validated')
      .order('validated_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      if (/actual_unit_basis|actual_positions|shipment_completeness/i.test(error.message || '')) {
        throw new Error('Data contract columns are missing. Run npm run migrate:data-contract (or apply scripts/sql/*.sql manually) before backfill.');
      }
      throw error;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function updateRow(id, patch) {
  const { error } = await supabase.from('validations').update(patch).eq('id', id);
  if (error) throw error;
}

async function main() {
  const rows = await fetchValidatedRows();
  const scopedRows = limit ? rows.slice(0, limit) : rows;

  const soCounts = new Map();
  for (const row of scopedRows) {
    const so = String(row.sales_order_id || '').trim();
    if (!so) continue;
    soCounts.set(so, (soCounts.get(so) || 0) + 1);
  }

  const updates = [];
  const counters = {
    total_rows: scopedRows.length,
    rows_with_updates: 0,
    set_complete: 0,
    set_partial: 0,
    set_unknown: 0,
    set_package_count: 0,
    set_pallet_positions: 0,
    set_basis_unknown: 0,
    duplicate_so_rows: 0,
    suspected_partial_weight_rows: 0,
  };

  for (const row of scopedRows) {
    const inferred = inferSemantics(row, soCounts);
    if (inferred.duplicateSo) counters.duplicate_so_rows += 1;
    if (inferred.suspectedPartialByWeight) counters.suspected_partial_weight_rows += 1;

    const patch = {};
    if (normalizeLower(row.shipment_completeness) !== inferred.shipmentCompleteness) {
      patch.shipment_completeness = inferred.shipmentCompleteness;
    }
    if (normalizeLower(row.actual_unit_basis) !== inferred.actualUnitBasis) {
      patch.actual_unit_basis = inferred.actualUnitBasis;
    }

    const existingPositions = Number.isInteger(Number(row.actual_positions)) ? Number(row.actual_positions) : null;
    const nextPositions = inferred.actualPositions;
    if (existingPositions !== nextPositions) {
      patch.actual_positions = nextPositions;
    }

    if (Object.keys(patch).length > 0) {
      counters.rows_with_updates += 1;
      if (patch.shipment_completeness === 'complete') counters.set_complete += 1;
      if (patch.shipment_completeness === 'partial') counters.set_partial += 1;
      if (patch.shipment_completeness === 'unknown') counters.set_unknown += 1;
      if (patch.actual_unit_basis === 'package_count') counters.set_package_count += 1;
      if (patch.actual_unit_basis === 'pallet_positions') counters.set_pallet_positions += 1;
      if (patch.actual_unit_basis === 'unknown') counters.set_basis_unknown += 1;
      updates.push({
        id: row.id,
        sales_order_id: row.sales_order_id,
        patch,
        inferred,
      });
    }
  }

  if (apply) {
    for (const u of updates) {
      await updateRow(u.id, u.patch);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    apply,
    counters,
    update_preview: updates.slice(0, 50),
  };

  const docsDir = path.join(process.cwd(), 'docs', 'accuracy');
  fs.mkdirSync(docsDir, { recursive: true });
  const filePath = path.join(docsDir, `backfill-semantics-${nowStamp()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${filePath}`);
  if (!apply) {
    console.error('Dry-run mode. Re-run with --apply to persist updates.');
  }
}

main().catch((error) => {
  console.error('backfill-shipment-semantics failed:', error?.message || error);
  process.exit(1);
});
