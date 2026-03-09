#!/usr/bin/env node

const assert = require('assert');
const validateShipment = require('../api/validate-shipment');

const {
  predictPallets,
  applyPackageCountAdjustment,
} = validateShipment.__private__ || {};
if (typeof predictPallets !== 'function' || typeof applyPackageCountAdjustment !== 'function') {
  console.error('Required private helpers are not exported from api/validate-shipment.js');
  process.exit(1);
}

function findPackage(packages, type) {
  return (packages || []).find((pkg) => pkg.type === type);
}

function matchedQtyFromPackage(pkg, name) {
  return (pkg?.contents || []).reduce((sum, content) => (
    sum + (content?.name === name ? Number(content?.qty) || 0 : 0)
  ), 0);
}

function sumMatchedQty(packages, matched) {
  return (packages || []).reduce((sum, pkg) => sum + (pkg.contents || []).reduce((pkgSum, content) => (
    pkgSum + (content?.matched === matched ? Number(content?.qty) || 0 : 0)
  ), 0), 0);
}

function runQuo34277() {
  const result = predictPallets([
    { sku: '80101-0281-BLK06', name: '2UP Rack', qty: 40 },
    { sku: 'CS120-BLK13', name: 'CenterStage 120', qty: 1 },
  ], {
    orderRef: 'QUO34277',
    sourceType: 'quote',
  });

  assert.strictEqual(result.totalPallets, 3, 'QUO34277 should resolve to 3 packages');

  const stanchionPkg = findPackage(result.packages, 'base_station_stanchion');
  const tubePkg = findPackage(result.packages, 'long_tube');
  const twoUpPkg = findPackage(result.packages, 'standard_pallet');

  assert(stanchionPkg, 'Expected a Base Station stanchion pallet');
  assert(tubePkg, 'Expected a long-tube pallet');
  assert(twoUpPkg, 'Expected a standalone 2UP pallet');

  assert.deepStrictEqual(stanchionPkg.dims, { l: 84, w: 50, h: 32 }, 'Unexpected Base Station host pallet dims');
  assert.deepStrictEqual(tubePkg.dims, { l: 120, w: 8, h: 6 }, 'Unexpected long-tube dims');
  assert.deepStrictEqual(twoUpPkg.dims, { l: 46, w: 44, h: 49 }, 'Unexpected 2UP pallet dims');

  const shared2Up = (stanchionPkg.contents || []).find((c) => c.matched === '2UP');
  assert(shared2Up && shared2Up.qty === 8, 'Expected 8 2UPs to ride on the Base Station host pallet');
  assert.strictEqual((twoUpPkg.contents || [])[0]?.qty, 32, 'Expected 32 2UPs on the standalone pallet');
}

function runBundledBaseStationOnly() {
  const result = predictPallets([
    { sku: 'CS120-BLK13', name: 'CenterStage 120', qty: 1 },
  ], {
    orderRef: 'QUOTE-BASE-STATION',
    sourceType: 'quote',
  });

  assert.strictEqual(result.totalPallets, 2, 'Single CS120 should become 2 packages');
  const stanchionPkg = findPackage(result.packages, 'base_station_stanchion');
  const tubePkg = findPackage(result.packages, 'long_tube');
  assert(stanchionPkg, 'Expected a Base Station stanchion pallet');
  assert(tubePkg, 'Expected a long-tube pallet');
  assert.strictEqual(matchedQtyFromPackage(stanchionPkg, 'Base Station stanchions'), 2, 'CS/SS bundle should contribute 2 stanchions');
  assert.strictEqual(matchedQtyFromPackage(stanchionPkg, 'Base Station feet'), 2, 'CS/SS bundle should contribute 2 feet');
  assert.strictEqual((tubePkg.contents || [])[0]?.qty, 4, 'CS/SS bundle should contribute 4 tube pieces');
  assert.deepStrictEqual(tubePkg.dims, { l: 120, w: 8, h: 6 }, 'Bundled CS/SS tube pallet dims should match the warehouse template');
}

function runBundledBaseStationAddonOnly() {
  const result = predictPallets([
    { sku: 'SSA95-BLK13', name: 'SideStage Add-On 95', qty: 1 },
  ], {
    orderRef: 'QUOTE-BASE-STATION-ADDON',
    sourceType: 'quote',
  });

  assert.strictEqual(result.totalPallets, 2, 'Single SSA95 should become 2 packages');

  const stanchionPkg = findPackage(result.packages, 'base_station_stanchion');
  const tubePkg = findPackage(result.packages, 'long_tube');
  assert(stanchionPkg, 'Expected a Base Station stanchion pallet for SSA/CSA');
  assert(tubePkg, 'Expected a long-tube pallet for SSA/CSA');
  assert.strictEqual(matchedQtyFromPackage(stanchionPkg, 'Base Station stanchions'), 1, 'CSA/SSA bundle should contribute 1 stanchion');
  assert.strictEqual(matchedQtyFromPackage(stanchionPkg, 'Base Station feet'), 1, 'CSA/SSA bundle should contribute 1 foot');
  assert.strictEqual((tubePkg.contents || [])[0]?.qty, 4, 'CSA/SSA bundle should contribute 4 tube pieces');
  assert.deepStrictEqual(tubePkg.dims, { l: 95, w: 8, h: 6 }, 'Bundled CSA/SSA tube pallet dims should match the warehouse template');
}

function runMixedOrderKeeps2UpStandaloneWhenUncertain() {
  const result = predictPallets([
    { sku: '80101-0281-BLK06', name: '2UP Rack', qty: 40 },
    { sku: 'CS120-BLK13', name: 'CenterStage 120', qty: 1 },
    { sku: '80301-0166-BLK13', name: 'Hoop Runner', qty: 1 },
  ], {
    orderRef: 'QUOTE-BASE-2UP-MIXED',
    sourceType: 'quote',
  });

  assert.strictEqual(result.totalPallets, 4, 'Mixed Base Station + 2UP orders should stay conservative when another family is present');

  const stanchionPkg = findPackage(result.packages, 'base_station_stanchion');
  assert(stanchionPkg, 'Expected a Base Station stanchion pallet on mixed order');
  assert(!(stanchionPkg.contents || []).some((c) => c.matched === '2UP'), '2UP spillover should not attach on broader mixed orders');
  assert.strictEqual(sumMatchedQty(result.packages, '2UP'), 40, 'Expected all 2UP units to remain on standalone standard pallets');
}

function runBaseStationTrimProtection() {
  const result = predictPallets([
    { sku: '80101-0281-BLK06', name: '2UP Rack', qty: 40 },
    { sku: 'CS120-BLK13', name: 'CenterStage 120', qty: 1 },
  ], {
    orderRef: 'QUO34277',
    sourceType: 'quote',
  });

  const trimmed = applyPackageCountAdjustment(result.packages, -1);
  assert.strictEqual(trimmed.appliedDelta, 0, 'Bundled Base Station structure should block destructive negative trims');
  assert.strictEqual(trimmed.blockedReason, 'protected_bundled_base_station_structure', 'Expected trim protection reason for bundled Base Station');
  assert.deepStrictEqual(trimmed.packages.map((pkg) => pkg.type), result.packages.map((pkg) => pkg.type), 'Protected trim should preserve the original package structure');
}

function runBaseStationTrimCanRemoveSyntheticAdjustment() {
  const result = predictPallets([
    { sku: 'CS120-BLK13', name: 'CenterStage 120', qty: 1 },
  ], {
    orderRef: 'QUOTE-BASE-STATION-TRIM-SYNTHETIC',
    sourceType: 'quote',
  });

  const syntheticPkg = {
    id: result.packages.length + 1,
    type: 'unknown_pallet',
    family: 'CALIBRATION_ADJUSTMENT',
    dims: { l: 48, w: 40, h: 24 },
    weight: 120,
    mergeable: false,
    contents: [{
      sku: 'CALIBRATION-ADJUSTMENT',
      name: 'Calibration safety package',
      qty: 1,
      matched: 'CALIBRATION_ADJUSTMENT',
    }],
  };

  const trimmed = applyPackageCountAdjustment([...result.packages, syntheticPkg], -1);
  assert.strictEqual(trimmed.appliedDelta, -1, 'Synthetic calibration packages should remain removable');
  assert.strictEqual(trimmed.blockedReason, null, 'Synthetic-only trim should not trigger structural protection');
  assert.strictEqual(trimmed.packages.length, result.packages.length, 'Synthetic trim should remove only the placeholder package');
  assert(trimmed.packages.every((pkg) => pkg.type !== 'unknown_pallet'), 'Synthetic placeholder should be the package removed');
}

runQuo34277();
runBundledBaseStationOnly();
runBundledBaseStationAddonOnly();
runMixedOrderKeeps2UpStandaloneWhenUncertain();
runBaseStationTrimProtection();
runBaseStationTrimCanRemoveSyntheticAdjustment();

console.log('Package generation tests passed.');
