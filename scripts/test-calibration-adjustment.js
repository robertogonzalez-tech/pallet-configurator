#!/usr/bin/env node

const assert = require('assert');
const validate = require('../api/validate-shipment');

const { computeCalibrationAdjustment } = validate.__private__ || {};

if (typeof computeCalibrationAdjustment !== 'function') {
  console.error('computeCalibrationAdjustment is not exported from api/validate-shipment.js');
  process.exit(1);
}

function row(matched, qty = 1) {
  return { matched, qty };
}

function run(name, input, expectedDelta, expectedRule) {
  const result = computeCalibrationAdjustment(input);
  try {
    assert.strictEqual(result.delta, expectedDelta, `${name}: expected delta ${expectedDelta}, got ${result.delta}`);
    if (expectedRule) {
      assert(result.firedRules.includes(expectedRule), `${name}: expected rule ${expectedRule} to fire`);
    }
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.message);
    console.error('Result:', JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

run(
  'legacy_vr1xl_single_plus3',
  {
    breakdown: [row('VR1 XL', 12)],
    currentPallets: 2,
    orderRef: 'SO5602',
  },
  3,
  'legacy_vr1xl_single_plus3'
);

run(
  'legacy_dd_q25_plus2',
  {
    breakdown: [row('Double Docker', 25)],
    currentPallets: 4,
    orderRef: 'SO6675',
  },
  2,
  'legacy_dd_single_q25_q30_plus2'
);

run(
  'vr2_long_tube_fc2_plus1',
  {
    breakdown: [row('VR2 Offset', 25), row('LONG_TUBE', 95)],
    currentPallets: 2,
    orderRef: 'SO6910',
  },
  1,
  'fc2_vr2_long_tube_high_qty_plus1'
);

run(
  'zero_floor_high_minus2',
  {
    breakdown: [row('ZERO_FLOOR', 1)],
    currentPallets: 4,
    orderRef: 'SO7405',
  },
  -2,
  'zero_floor_high_minus2'
);

run(
  'legacy_fc4plus_vr2_long_tube_mid_qty_plus1',
  {
    breakdown: [
      row('Varsity', 120),
      row('Circle Series (Omega)', 2),
      row('VR2 Offset', 10),
      row('LONG_TUBE', 95),
    ],
    currentPallets: 2,
    orderRef: 'SO5724',
  },
  1,
  'legacy_fc4plus_vr2_long_tube_mid_qty_plus1'
);

console.log('All calibration tests passed.');
