#!/usr/bin/env node
const assert = require('assert');
const validateShipment = require('../api/validate-shipment');

const { predictPallets } = validateShipment.__private__ || {};
if (typeof predictPallets !== 'function') {
  console.error('predictPallets is not exported from api/validate-shipment.js');
  process.exit(1);
}

function flattenReasons(diag) {
  const included = (diag.included_lines || diag.includedLines || []).map((x) => x.reason);
  const excluded = (diag.excluded_lines || diag.excludedLines || []).map((x) => x.reason);
  return { included, excluded };
}

(() => {
  // Quote/direct lines can omit NetSuite flags; they must stay classifiable.
  const missingFlags = predictPallets([
    { sku: '90101-0172-BLK13', name: 'VR2 Offset Rack', qty: 3 },
  ]);
  const r0 = flattenReasons(missingFlags.diagnostics);
  assert(r0.included.includes('PRODUCT_FAMILY'), 'Expected PRODUCT_FAMILY inclusion for lines without NetSuite flags');

  // Long-tube trigger should be included with explicit reason.
  const longTube = predictPallets([
    { sku: '50801-0012-GAV-120', name: 'UNISTRUT 120"', qty: 6, fulfillable: false, assemblyComponent: true, kitComponent: false, itemType: 'InvtPart' },
  ]);
  const r1 = flattenReasons(longTube.diagnostics);
  assert(r1.included.includes('LONG_TUBE_TRIGGER'), 'Expected LONG_TUBE_TRIGGER inclusion reason');

  // Non-physical service line should be excluded.
  const nonPhysical = predictPallets([
    { sku: 'Installation Service', name: 'Installation Service', qty: 1, fulfillable: false, assemblyComponent: false, kitComponent: false, itemType: 'Service' },
  ]);
  const r2 = flattenReasons(nonPhysical.diagnostics);
  assert(r2.excluded.includes('NON_PHYSICAL') || r2.excluded.includes('NETSUITE_FLAGGED'), 'Expected NON_PHYSICAL or NETSUITE_FLAGGED exclusion reason');

  // Unknown SKU should not be silently dropped and must be marked UNKNOWN.
  const unknown = predictPallets([
    { sku: 'MYSTERY-UNMAPPED-SKU', name: 'Mystery Widget', qty: 3, fulfillable: true, assemblyComponent: false, kitComponent: false, itemType: 'InvtPart' },
  ]);
  const r3 = flattenReasons(unknown.diagnostics);
  assert(r3.included.includes('UNKNOWN'), 'Expected UNKNOWN inclusion reason');
  assert((unknown.diagnostics.unknown_skus || []).length >= 1, 'Expected unknown_skus to contain entry');
})();

console.log('Classifier contract tests passed.');
