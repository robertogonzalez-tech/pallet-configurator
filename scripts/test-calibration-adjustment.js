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
  2,
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

run(
  'legacy_fc4_long_tube_base_hoop_extreme_plus3',
  {
    breakdown: [
      row('Base Station', 14),
      row('Hoop Runner', 15),
      row('VR2 Offset', 30),
      row('LONG_TUBE', 50),
    ],
    currentPallets: 4,
    orderRef: 'SO5501',
  },
  6,
  'legacy_fc4_long_tube_base_hoop_extreme_plus3'
);

run(
  'zero_floor_heavy_ride_along_plus1',
  {
    breakdown: [
      row('RIDE_ALONG', 351),
      row('ZERO_FLOOR', 1),
    ],
    currentPallets: 1,
    orderRef: 'SO7595',
  },
  1,
  'zero_floor_heavy_ride_along_plus1'
);

run(
  'legacy_dd_q42_high_minus3',
  {
    breakdown: [row('Double Docker', 42)],
    currentPallets: 6,
    orderRef: 'SO6764',
  },
  -3,
  'legacy_dd_q42_high_minus3'
);

run(
  'legacy_dd_q80plus_high_minus7',
  {
    breakdown: [row('Double Docker', 89)],
    currentPallets: 11,
    orderRef: 'SO6870',
  },
  -7,
  'legacy_dd_q80plus_high_minus7'
);

run(
  'fc2_hoop_saris_high_minus1',
  {
    breakdown: [row('Hoop Runner', 37), row('Saris', 28)],
    currentPallets: 4,
    orderRef: 'SO7065',
  },
  -2,
  'fc2_hoop_saris_high_minus1'
);

console.log('All calibration tests passed.');
