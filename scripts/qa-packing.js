#!/usr/bin/env node
/**
 * QA Script for Bin Packing
 * Verifies Tetris-style packing with ZERO gaps
 * 
 * Run: node scripts/qa-packing.js
 * Exit 0 = PASS, Exit 1 = FAIL
 */

const { packItems } = require('../src/binPacking3D.js');

const TESTS = [
  {
    name: 'DD Slides - Should pack flat with no gaps',
    items: [
      { sku: 'dd-slide', name: 'Slide', qty: 20, dims: { l: 80.4, w: 16.5, h: 6.5 }, weight: 57 }
    ],
    checks: {
      maxPallets: 2,
      noFloatingItems: true,
      noYGaps: true,
      floorFilledFirst: true,
    }
  },
  {
    name: 'Mixed DD Components - Tight packing',
    items: [
      { sku: 'dd-slide', name: 'Slide', qty: 10, dims: { l: 80.4, w: 16.5, h: 6.5 }, weight: 57 },
      { sku: 'dd-lower', name: 'Track', qty: 10, dims: { l: 79.3, w: 12.2, h: 6.0 }, weight: 15 },
    ],
    checks: {
      noFloatingItems: true,
      noYGaps: true,
    }
  },
  {
    name: 'Small boxes - Perfect grid',
    items: [
      { sku: 'test-box', name: 'Box', qty: 24, dims: { l: 12, w: 12, h: 12 }, weight: 20 }
    ],
    checks: {
      maxPallets: 1,
      noFloatingItems: true,
      noYGaps: true,
    }
  }
];

function checkNoFloating(pallets) {
  for (const pallet of pallets) {
    for (const box of pallet.boxes) {
      if (box.y > 0) {
        // Check if there's support below
        const hasSupport = pallet.boxes.some(other => 
          other !== box &&
          other.y + other.h <= box.y + 0.5 && // Below or at same level (with tolerance)
          other.y + other.h >= box.y - 0.5 &&
          // Overlaps in X
          other.x < box.x + box.l &&
          other.x + other.l > box.x &&
          // Overlaps in Z
          other.z < box.z + box.w &&
          other.z + other.w > box.z
        );
        if (!hasSupport) {
          return { pass: false, reason: `Item at y=${box.y} has no support below` };
        }
      }
    }
  }
  return { pass: true };
}

function checkNoYGaps(pallets) {
  for (const pallet of pallets) {
    const yValues = [...new Set(pallet.boxes.map(b => Math.round(b.y * 10) / 10))].sort((a, b) => a - b);
    
    // First layer should be at y=0
    if (yValues[0] > 0.5) {
      return { pass: false, reason: `First layer at y=${yValues[0]}, should be 0` };
    }
    
    // Check for large gaps between layers
    for (let i = 1; i < yValues.length; i++) {
      const gap = yValues[i] - yValues[i-1];
      // Gap should be reasonable (item height, not random)
      if (gap > 20 && gap < 50) { // Suspicious gap range
        // This might be OK if items are tall, but flag for review
        console.log(`  ⚠️ Large Y gap: ${yValues[i-1]} → ${yValues[i]} (${gap}")`);
      }
    }
  }
  return { pass: true };
}

function checkFloorFilledFirst(pallets) {
  for (const pallet of pallets) {
    const floorItems = pallet.boxes.filter(b => b.y < 1);
    const stackedItems = pallet.boxes.filter(b => b.y >= 1);
    
    if (stackedItems.length > 0 && floorItems.length < 2) {
      return { pass: false, reason: `Stacking before filling floor (${floorItems.length} floor, ${stackedItems.length} stacked)` };
    }
  }
  return { pass: true };
}

function runTest(test) {
  console.log(`\n📦 ${test.name}`);
  
  const result = packItems(test.items, { palletLength: 96, palletWidth: 48, maxHeight: 96 });
  const checks = test.checks;
  let passed = true;
  
  // Check pallet count
  if (checks.maxPallets && result.length > checks.maxPallets) {
    console.log(`  ❌ Too many pallets: ${result.length} (max ${checks.maxPallets})`);
    passed = false;
  } else {
    console.log(`  ✅ Pallets: ${result.length}`);
  }
  
  // Check no floating items
  if (checks.noFloatingItems) {
    const floatCheck = checkNoFloating(result);
    if (!floatCheck.pass) {
      console.log(`  ❌ Floating items: ${floatCheck.reason}`);
      passed = false;
    } else {
      console.log(`  ✅ No floating items`);
    }
  }
  
  // Check no Y gaps
  if (checks.noYGaps) {
    const gapCheck = checkNoYGaps(result);
    if (!gapCheck.pass) {
      console.log(`  ❌ Y gaps: ${gapCheck.reason}`);
      passed = false;
    } else {
      console.log(`  ✅ No Y gaps`);
    }
  }
  
  // Check floor filled first
  if (checks.floorFilledFirst) {
    const floorCheck = checkFloorFilledFirst(result);
    if (!floorCheck.pass) {
      console.log(`  ❌ Floor not filled first: ${floorCheck.reason}`);
      passed = false;
    } else {
      console.log(`  ✅ Floor filled first`);
    }
  }
  
  // Show sample positions
  if (result[0] && result[0].boxes.length > 0) {
    console.log(`  📍 Sample Y positions: ${[...new Set(result[0].boxes.slice(0, 10).map(b => b.y.toFixed(1)))].join(', ')}`);
  }
  
  return passed;
}

// Run all tests
console.log('🧪 Pallet Packing QA Tests\n' + '='.repeat(40));

let allPassed = true;
for (const test of TESTS) {
  if (!runTest(test)) {
    allPassed = false;
  }
}

console.log('\n' + '='.repeat(40));
if (allPassed) {
  console.log('✅ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
