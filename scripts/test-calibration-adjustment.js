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

run(
  'exact_fc2_vr2_1_longtube_5_minus1',
  {
    breakdown: [row('VR2 Offset', 1), row('LONG_TUBE', 5)],
    currentPallets: 2,
    orderRef: 'SO7287',
  },
  -1,
  'exact_fc2_vr2_1_longtube_5_minus1'
);

run(
  'exact_single_dismount_1_minus1',
  {
    breakdown: [row('Dismount', 1)],
    currentPallets: 2,
    orderRef: 'SO7572',
  },
  -1,
  'exact_single_dismount_1_minus1'
);

run(
  'exact_legacy_vr1xl168_longtube231_plus1',
  {
    breakdown: [row('VR1 XL', 168), row('LONG_TUBE', 231)],
    currentPallets: 5,
    orderRef: 'SO6571',
  },
  1,
  'exact_legacy_vr1xl168_longtube231_plus1'
);

run(
  'exact_single_dismount12_grey14_plus1',
  {
    breakdown: [
      row('RIDE_ALONG', 168),
      { matched: 'Dismount', qty: 12, sku: '89901-2050-GRY14' },
    ],
    currentPallets: 2,
    orderRef: 'SO7021',
  },
  1,
  'exact_single_dismount12_grey14_plus1'
);

run(
  'exact_legacy_vr2_12_blk13_minus1',
  {
    breakdown: [
      row('RIDE_ALONG', 25),
      { matched: 'VR2 Offset', qty: 12, sku: '90101-0172-BLK13' },
    ],
    currentPallets: 2,
    orderRef: 'SO6575',
  },
  -1,
  'exact_legacy_vr2_12_blk13_minus1'
);

run(
  'exact_fc4plus_base_vr2_longtube_20_minus1',
  {
    breakdown: [
      row('RIDE_ALONG', 1896),
      row('LONG_TUBE_TRIGGER', 35),
      row('Base Station', 3),
      row('Hoop Runner', 40),
      row('VR2 Offset', 48),
      row('LONG_TUBE', 17),
    ],
    currentPallets: 7,
    orderRef: 'SO7482',
  },
  -1,
  'exact_fc4plus_base_vr2_longtube_20_minus1'
);

run(
  'exact_dd_varsity_small_no_longtube_minus1_not_overbroad',
  {
    breakdown: [
      row('RIDE_ALONG', 1127),
      row('VR2 Offset', 24),
      row('Varsity', 30),
      row('Double Docker', 8),
    ],
    currentPallets: 5,
    orderRef: 'SO7464',
  },
  0,
  null
);

run(
  'exact_dd_varsity_small_no_longtube_minus1',
  {
    breakdown: [
      row('RIDE_ALONG', 111),
      row('SKU_OVERRIDE', 2),
      row('Varsity', 2),
      row('Double Docker', 10),
    ],
    currentPallets: 5,
    orderRef: 'SO7464',
  },
  -1,
  'exact_dd_varsity_small_no_longtube_minus1'
);

run(
  'exact_fc2_hoop_vr2_10_11_minus1',
  {
    breakdown: [
      row('RIDE_ALONG', 118),
      row('Hoop Runner', 1),
      row('VR2 Offset', 10),
    ],
    currentPallets: 2,
    orderRef: 'SO6518',
  },
  -1,
  'exact_fc2_hoop_vr2_10_11_minus1'
);

run(
  'exact_fc3_vr2_varsity_longtube15_20_minus1',
  {
    breakdown: [
      row('RIDE_ALONG', 245),
      row('LONG_TUBE_TRIGGER', 7),
      row('VR2 Offset', 10),
      row('Varsity', 1),
      row('LONG_TUBE', 18),
    ],
    currentPallets: 3,
    orderRef: 'SO7751',
  },
  -1,
  'exact_fc3_vr2_varsity_longtube15_20_minus1'
);

run(
  'exact_fc2_hoop_visilocker_qty3_plus1',
  {
    breakdown: [
      row('Hoop Runner', 3),
      row('Metal Bike Vault / VisiLocker', 3),
    ],
    currentPallets: 2,
    orderRef: 'SO7446',
  },
  0,
  'exact_fc2_hoop_visilocker_qty3_plus1'
);

run(
  'exact_fc2_hoop_visilocker_qty3_plus1_not_overbroad',
  {
    breakdown: [
      row('Hoop Runner', 4),
      row('Metal Bike Vault / VisiLocker', 4),
    ],
    currentPallets: 2,
    orderRef: 'SO7042',
  },
  -1,
  null
);

run(
  'exact_fc4_base_hoop_vr2_longtube_p4_plus1',
  {
    breakdown: [
      row('Base Station', 17),
      row('Hoop Runner', 5),
      row('VR2 Offset', 23),
      row('LONG_TUBE', 26),
    ],
    currentPallets: 4,
    orderRef: 'SO7023',
  },
  1,
  'exact_fc4_base_hoop_vr2_longtube_p4_plus1'
);

run(
  'exact_fc4_base_hoop_vr2_longtube_p4_plus1_not_overbroad',
  {
    breakdown: [
      row('Base Station', 35),
      row('Hoop Runner', 1),
      row('VR2 Offset', 51),
      row('LONG_TUBE', 82),
    ],
    currentPallets: 6,
    orderRef: 'SO7337',
  },
  0,
  null
);

run(
  'exact_fc2_vr2_longtube_vr2_30plus_minus1',
  {
    breakdown: [
      row('VR2 Offset', 35),
      row('LONG_TUBE', 72),
    ],
    currentPallets: 5,
    orderRef: 'SO7029',
  },
  -1,
  'exact_fc2_vr2_longtube_vr2_30plus_minus1'
);

run(
  'exact_fc2_vr2_longtube_vr2_30plus_minus1_not_overbroad',
  {
    breakdown: [
      row('VR2 Offset', 12),
      row('LONG_TUBE', 68),
    ],
    currentPallets: 3,
    orderRef: 'SO7469',
  },
  0,
  null
);

console.log('All calibration tests passed.');
