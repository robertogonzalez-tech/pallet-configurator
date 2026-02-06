/**
 * Product 3D Models & Accurate Dimensions
 * Generated from STEP files provided by Chad (2026-01-30)
 * 
 * All dimensions in inches, weights in lbs
 */

export const PRODUCT_MODELS = {
  // === VARSITY ===
  'dv215': {
    name: 'Varsity 2-Pack',
    model: '/models/varsity-double-pack.glb',
    dims: { l: 34.5, w: 11.0, h: 13.5 },
    weight: 30, // estimated per 2-pack
    type: 'box',
    stackable: true,
    unitsPerPallet: 70, // Very efficient flat pack
  },
  
  // === VR2 ===
  'vr2': {
    name: 'VR2 2-Pack',
    model: '/models/vr2-two-pack.glb',
    dims: { l: 42.8, w: 24.9, h: 13.4 }, // Note: reordered for packing (longest = L)
    weight: 62, // 31 lbs each x 2
    type: 'box',
    stackable: true,
    unitsPerPallet: 50,
  },
  
  // === HOOP RUNNER (verified by Chad 2026-02-03) ===
  // Individual: 28" × 32" × 6"
  // Stacked height: First = 6", each additional = +2"
  // Formula: 6 + ((qty - 1) × 2)
  'hr101': {
    name: 'HR101 Hoop Runner',
    model: '/models/hr101-unboxed.glb',
    dims: { l: 32.0, w: 28.0, h: 6.0 }, // Verified: 28" × 32" × 6"
    weight: 14,
    type: 'product',
    stackable: true,
    nestable: true,
    nestingFormula: 'first + ((qty - 1) * increment)', // 6 + ((qty-1) * 2)
    nestingFirst: 6,
    nestingIncrement: 2,
    unitsPerPallet: 60,
    note: 'Nested stacking: first=6", each additional=+2"',
  },
  
  // === CIRCLE SERIES ===
  'cs200': {
    name: 'CS200 Circle Series',
    model: '/models/cs200.glb',
    dims: { l: 34.7, w: 31.3, h: 6.0 },
    weight: 40,
    type: 'product',
    stackable: true,
    unitsPerPallet: 15,
  },
  
  // === UNDERGRAD (verified by Chad 2026-02-02) ===
  // Single-sided (3/4/5 bike): lay flat, stack 5-10/pallet, max 148"L × 48"W × 36"H
  // Double-sided: stack max 3, up to 160"L × 48"W × 40"H
  // ⚠️ OVERSIZED - requires special pallets (148-160" length)
  
  // === UNDERGRAD SINGLE-SIDED (verified by Chad 2026-02-03) ===
  // Base footprints (perpendicular entry):
  //   3-bike: 48" × 63.5"
  //   4-bike: 40" × 87.5"
  //   5-bike: 40" × 111.5"
  // Right/Left entry: Add 35" to length
  // Nesting: First unit 12", each additional +2.5" height, +2.5" length
  // Max per pallet: ~10 units, max height: 36"
  'undergrad-ss-3': {
    name: 'Undergrad 3-Bike (Single-Sided)',
    model: null,
    dims: { l: 63.5, w: 48.0, h: 12.0 }, // Base footprint (perpendicular entry)
    weight: 55,
    type: 'product',
    stackable: true,
    nestable: true,
    maxStack: 10,
    unitsPerPallet: 10,
    palletType: 'oversized',
    baseFootprint: { l: 63.5, w: 48.0 }, // Perpendicular entry
    entryAdder: 35, // Add 35" for left/right entry
    nestingFirst: 12, // First unit height
    nestingIncrement: 2.5, // Each additional unit height
    lengthGrowth: 2.5, // Length growth per additional unit
    maxHeight: 36, // Max stacked height
    note: 'Verified Feb 3: perpendicular entry 48"×63.5", +35" for L/R entry',
  },
  'undergrad-ss-4': {
    name: 'Undergrad 4-Bike (Single-Sided)',
    model: null,
    dims: { l: 87.5, w: 40.0, h: 12.0 }, // Base footprint (perpendicular entry)
    weight: 70,
    type: 'product',
    stackable: true,
    nestable: true,
    maxStack: 10,
    unitsPerPallet: 10,
    palletType: 'oversized',
    baseFootprint: { l: 87.5, w: 40.0 }, // Perpendicular entry
    entryAdder: 35, // Add 35" for left/right entry
    nestingFirst: 12, // First unit height
    nestingIncrement: 2.5, // Each additional unit height
    lengthGrowth: 2.5, // Length growth per additional unit
    maxHeight: 36, // Max stacked height
    note: 'Verified Feb 3: perpendicular entry 40"×87.5", +35" for L/R entry',
  },
  'undergrad-ss-5': {
    name: 'Undergrad 5-Bike (Single-Sided)',
    model: null,
    dims: { l: 111.5, w: 40.0, h: 12.0 }, // Base footprint (perpendicular entry)
    weight: 85,
    type: 'product',
    stackable: true,
    nestable: true,
    maxStack: 10,
    unitsPerPallet: 10,
    palletType: 'oversized',
    baseFootprint: { l: 111.5, w: 40.0 }, // Perpendicular entry
    entryAdder: 35, // Add 35" for left/right entry
    nestingFirst: 12, // First unit height
    nestingIncrement: 2.5, // Each additional unit height
    lengthGrowth: 2.5, // Length growth per additional unit
    maxHeight: 36, // Max stacked height
    note: 'Verified Feb 3: perpendicular entry 40"×111.5", +35" for L/R entry',
  },
  // === UNDERGRAD DOUBLE-SIDED (verified by Chad 2026-02-03) ===
  // Max 3 per pallet, dims up to 160" × 48" × 40"
  'undergrad-ds-6': {
    name: 'Undergrad 6-Bike (Double-Sided)',
    model: null,
    dims: { l: 110.0, w: 48.0, h: 13.0 }, // Double-sided, can't lay flat same way
    weight: 100,
    type: 'product',
    stackable: true,
    maxStack: 3,           // Verified: max 3 per pallet
    unitsPerPallet: 3,
    palletType: 'oversized',
    maxStackedDims: { l: 160, w: 48, h: 40 }, // Verified max dims
    note: 'Double-sided, max 3 stacked, up to 160"×48"×40"',
  },
  'undergrad-ds-8': {
    name: 'Undergrad 8-Bike (Double-Sided)',
    model: null,
    dims: { l: 140.0, w: 48.0, h: 13.0 },
    weight: 130,
    type: 'product',
    stackable: true,
    maxStack: 3,           // Verified: max 3 per pallet
    unitsPerPallet: 3,
    palletType: 'oversized',
    maxStackedDims: { l: 160, w: 48, h: 40 }, // Verified max dims
    note: 'Double-sided, max 3 stacked, up to 160"×48"×40"',
  },
  'undergrad-ds-10': {
    name: 'Undergrad 10-Bike (Double-Sided)',
    model: null,
    dims: { l: 160.0, w: 48.0, h: 13.0 }, // Max length per Chad
    weight: 167,
    type: 'product',
    stackable: true,
    maxStack: 3,           // Verified: max 3 per pallet
    unitsPerPallet: 3,
    palletType: 'oversized',
    maxStackedDims: { l: 160, w: 48, h: 40 }, // Verified max dims
    note: 'Double-sided, max 3 stacked, up to 160"×48"×40"',
  },
  
  // === SKATEDOCK ===
  'sm10x': {
    name: 'SkateDock Box',
    model: '/models/skatedock-box.glb',
    dims: { l: 73.0, w: 14.0, h: 13.0 }, // Long narrow box
    weight: 28,
    type: 'box',
    stackable: true,
    unitsPerPallet: 16,
    note: 'Tops ship separately',
  },
  
  // === DOUBLE DOCKER COMPONENTS (verified by Chad 2026-02-03) ===
  // DD4 Components per unit: 2 slides, 2 tracks, 1 manifold, 1 leg
  // DD6 component counts: TODO - needs verification
  
  // Individual component dimensions (for reference)
  'dd-slide': {
    name: 'DD Slide Assembly (Upper Tray)',
    model: '/models/dd-slide-assembly.glb',
    dims: { l: 80.4, w: 16.5, h: 6.5 },
    weight: null, // ⚠️ UNVERIFIED per-unit weight
    type: 'component',
    parent: 'dd',
    perDD4: 2, // Verified Feb 2
    perDD6: 3, // Verified Feb 3 (Chad + NetSuite)
  },
  'dd-lower': {
    name: 'DD Lower Track',
    model: '/models/dd-lower-track.glb',
    dims: { l: 79.3, w: 12.2, h: 6.0 },
    weight: null, // ⚠️ UNVERIFIED per-unit weight
    type: 'component',
    parent: 'dd',
    perDD4: 2, // Verified Feb 2
    perDD6: 3, // Verified Feb 3 (Chad + NetSuite)
    note: 'Slides and tracks nest inside each other',
  },
  'dd-leg': {
    name: 'DD Support Leg',
    model: '/models/dd-support-leg.glb',
    dims: { l: 43.7, w: 24.9, h: 7.0 },
    weight: null, // ⚠️ UNVERIFIED per-unit weight
    type: 'component',
    parent: 'dd',
    perDD4: 1, // Verified Feb 2
    perDD6: 1, // Verified Feb 3
  },
  'dd-manifold': {
    name: 'DD Manifold',
    model: '/models/dd-manifold.glb',
    dims: { l: 29.7, w: 12.3, h: 11.8 },
    weight: null, // ⚠️ UNVERIFIED per-unit weight
    type: 'component',
    parent: 'dd',
    perDD4: 1, // Verified Feb 2
    perDD6: 1, // Verified Feb 3 (DD6 manifolds are larger, don't nest well)
    note: 'DD6 manifolds are larger - ride along on existing pallets (adds weight, not space)',
  },
  
  // === DD CRATE SPECIFICATIONS (verified by Chad 2026-02-03) ===
  'dd-slide-track-crate': {
    name: 'DD Slide/Track Crate',
    dims: { l: 80, w: 43, h: 56 }, // Verified: 80" × 43" × 56"
    weight: 1510, // Full crate weight
    type: 'crate',
    capacity: 21, // 21 nested sets (7 per layer × 3 layers)
    layersPerCrate: 3,
    setsPerLayer: 7,
    note: 'Slides and tracks nest inside each other',
  },
  'dd-manifold-crate': {
    name: 'DD Manifold Crate',
    dims: { l: 54, w: 28, h: 55 }, // Verified: 54" × 28" × 55"
    weight: null, // ⚠️ UNVERIFIED full crate weight
    type: 'crate',
    capacity: 40, // 40 manifolds (10 per layer × 4 layers)
    layersPerCrate: 4,
    unitsPerLayer: 10,
  },
  'dd-legs-pallet': {
    name: 'DD Legs Pallet',
    palletDims: { l: 48, w: 40 }, // Standard pallet
    footprintWithOverhang: { l: 48, w: 45 }, // With overhang
    heightAt30Legs: 53, // ~53" at 30 legs
    heightAtCapacity: null, // ⚠️ Height at 40 legs unverified
    type: 'pallet',
    capacityMin: 30,
    capacityMax: 40,
    note: 'Height varies by quantity; ~53" at 30 legs',
  },
  
  // DD as assembled unit (for weight/pallet calc reference)
  'dd4': {
    name: 'Double Docker 4',
    model: null, // Uses component models
    dims: { l: 80, w: 48, h: 72 }, // Approx assembled/crated
    weight: 206,
    type: 'assembly',
    stackable: false,
    unitsPerPallet: 12,
    components: ['dd-slide', 'dd-lower', 'dd-leg', 'dd-manifold'],
    // Verified component counts per DD4 unit:
    componentCounts: { slide: 2, track: 2, manifold: 1, leg: 1 },
  },
  'dd6': {
    name: 'Double Docker 6',
    model: null,
    dims: { l: 80, w: 60, h: 72 },
    weight: 260,
    type: 'assembly',
    stackable: false,
    unitsPerPallet: 8,
    components: ['dd-slide', 'dd-lower', 'dd-leg', 'dd-manifold'],
    // Verified Feb 3 (Chad + NetSuite)
    componentCounts: { slide: 3, track: 3, manifold: 1, leg: 1 },
    note: 'DD6 manifolds are larger than DD4 - typically ride along on existing pallets',
  },
  
  // === LOCKERS - 1 BIKE (VISI1 / MBV1) (verified by Chad 2026-02-03) ===
  // Each locker = 2 boxes
  // Package A (side panels): 81" × 26" × 5"
  // Package B (top/doors): 82" × 32" × 8"
  'locker-1-box-a': {
    name: 'Locker 1-Bike Box A (Side Panels)',
    model: '/models/locker-1bike-box-a.glb',
    dims: { l: 81.0, w: 26.0, h: 5.0 }, // Verified: 81" × 26" × 5"
    weight: null, // ⚠️ UNVERIFIED - needs confirmation
    type: 'box',
    parent: 'locker-1',
    note: 'Weight unverified',
  },
  'locker-1-box-b': {
    name: 'Locker 1-Bike Box B (Top & Doors)',
    model: '/models/locker-1bike-box-b.glb',
    dims: { l: 82.0, w: 32.0, h: 8.0 }, // Verified: 82" × 32" × 8"
    weight: null, // ⚠️ UNVERIFIED - needs confirmation
    type: 'box',
    parent: 'locker-1',
    note: 'Weight unverified',
  },
  'mbv1': {
    name: 'Metal Bike Vault 1',
    model: null,
    dims: { l: 82.3, w: 31.9, h: 13.4 }, // Combined boxes
    weight: 312,
    type: 'assembly',
    stackable: false,
    unitsPerPallet: 4,
    boxes: ['locker-1-box-a', 'locker-1-box-b'],
  },
  'visi1': {
    name: 'VisiLocker 1',
    model: null,
    dims: { l: 82.3, w: 31.9, h: 13.4 },
    weight: 280,
    type: 'assembly',
    stackable: false,
    unitsPerPallet: 6,
    boxes: ['locker-1-box-a', 'locker-1-box-b'],
  },
  
  // === LOCKERS - 2 BIKE (VISI2 / MBV2) ===
  'locker-2-box-a': {
    name: 'Locker 2-Bike Box A (Side Panels)',
    model: '/models/locker-2bike-box-a.glb',
    dims: { l: 80.7, w: 26.0, h: 5.1 },
    weight: 80,
    type: 'box',
    parent: 'locker-2',
  },
  'locker-2-box-b': {
    name: 'Locker 2-Bike Box B (Doors)',
    model: '/models/locker-2bike-box-b.glb',
    dims: { l: 49.2, w: 40.0, h: 9.6 },
    weight: 90,
    type: 'box',
    parent: 'locker-2',
  },
  'locker-2-box-c': {
    name: 'Locker 2-Bike Box C (Top & Divider)',
    model: '/models/locker-2bike-box-c.glb',
    dims: { l: 82.3, w: 37.8, h: 4.1 },
    weight: 60,
    type: 'box',
    parent: 'locker-2',
  },
  'mbv2': {
    name: 'Metal Bike Vault 2',
    model: null,
    dims: { l: 82.3, w: 40.0, h: 18.8 }, // Combined boxes
    weight: 420,
    type: 'assembly',
    stackable: false,
    unitsPerPallet: 2,
    boxes: ['locker-2-box-a', 'locker-2-box-b', 'locker-2-box-c'],
  },
  'visi2': {
    name: 'VisiLocker 2',
    model: null,
    dims: { l: 82.3, w: 40.0, h: 18.8 },
    weight: 375,
    type: 'assembly',
    stackable: false,
    unitsPerPallet: 3,
    boxes: ['locker-2-box-a', 'locker-2-box-b', 'locker-2-box-c'],
  },
}

/**
 * Map SKU patterns to product keys
 * Handles all color variants (GAV, BLK, GRY) → same model
 */
export function getProductModelKey(sku, family) {
  const skuLower = (sku || '').toLowerCase()
  const familyLower = (family || '').toLowerCase()
  
  // === VARSITY ===
  // Patterns: DV215, 90101-2287-*, 80101-008*, 80301-008*, 80101-028*, 80301-028*
  if (skuLower.includes('dv215') || skuLower.includes('varsity')) return 'dv215'
  if (skuLower.startsWith('90101-2287')) return 'dv215'
  if (skuLower.startsWith('80101-008') || skuLower.startsWith('80301-008')) return 'dv215'
  if (skuLower.startsWith('80101-028') || skuLower.startsWith('80301-028')) return 'dv215'
  if (familyLower === 'varsity') return 'dv215'
  
  // === VR2 ===
  // Patterns: VR2, VR-VR2, 90101-0172-*, 80101-0172-*
  if (skuLower.includes('vr2') || skuLower.includes('vr-vr2')) return 'vr2'
  if (skuLower.startsWith('90101-0172') || skuLower.startsWith('80101-0172')) return 'vr2'
  if (familyLower.includes('vr2')) return 'vr2'
  
  // === DOUBLE DOCKER ===
  // Main SKUs: DD-SS-04-*, DD-SS-06-*, DD-DS-08-*, DD-DS-12-*
  // Kit SKUs: 80101-0257-*-KIT (DD4), 80101-0258-*-KIT (DD6)
  if (skuLower.includes('dd-ss-04') || skuLower.includes('dd-04') || skuLower.includes('dd4')) return 'dd4'
  if (skuLower.includes('dd-ss-06') || skuLower.includes('dd-06') || skuLower.includes('dd6')) return 'dd6'
  if (skuLower.includes('dd-ds-08') || skuLower.includes('dd8')) return 'dd4' // DS-08 uses DD4 components
  if (skuLower.includes('dd-ds-12') || skuLower.includes('dd12')) return 'dd6' // DS-12 uses DD6 components
  if (skuLower.startsWith('80101-0257')) return 'dd4' // DD4 kit
  if (skuLower.startsWith('80101-0258')) return 'dd6' // DD6 kit
  if (familyLower.includes('double docker')) return 'dd4' // Default to DD4
  
  // === LOCKERS ===
  // MBV1, MBV2, VISI1, VISI2
  if (skuLower.includes('mbv1') || skuLower.includes('mbv-1')) return 'mbv1'
  if (skuLower.includes('mbv2') || skuLower.includes('mbv-2')) return 'mbv2'
  if (skuLower.includes('visi1') || skuLower.includes('visi-1')) return 'visi1'
  if (skuLower.includes('visi2') || skuLower.includes('visi-2')) return 'visi2'
  if (familyLower.includes('metal bike vault') || familyLower.includes('visilocker')) {
    // Try to determine 1 vs 2 bike from description
    if (skuLower.includes('1') || skuLower.includes('-1-')) return 'mbv1'
    if (skuLower.includes('2') || skuLower.includes('-2-')) return 'mbv2'
    return 'mbv1' // Default
  }
  
  // === SKATEDOCK ===
  // SM10x, SD6x, 89901-121*, 89901-140*
  if (skuLower.includes('sm10') || skuLower.includes('sd6')) return 'sm10x'
  if (skuLower.includes('skatedock')) return 'sm10x'
  if (skuLower.startsWith('89901-121') || skuLower.startsWith('89901-140')) return 'sm10x'
  if (familyLower.includes('skatedock')) return 'sm10x'
  
  // === HOOP RUNNER ===
  // HR101, HR-101, SM-HR101-*, 80301-0165-*, 80301-0166-*
  if (skuLower.includes('hr101') || skuLower.includes('hr-101')) return 'hr101'
  if (skuLower.includes('sm-hr101')) return 'hr101'
  if (skuLower.startsWith('80301-0165') || skuLower.startsWith('80301-0166')) return 'hr101'
  if (familyLower.includes('hoop runner')) return 'hr101'
  
  // === CIRCLE SERIES ===
  // CS200, CS-200, 80301-0151-*
  if (skuLower.includes('cs200') || skuLower.includes('cs-200')) return 'cs200'
  if (skuLower.startsWith('80301-0151')) return 'cs200'
  if (familyLower.includes('circle series')) return 'cs200'
  
  // === UNDERGRAD (verified dims from Chad 2026-02-02) ===
  // Single-sided: 3/4/5 bike - lay flat, stack 5-10/pallet
  // Double-sided: 6/8/10 bike - stack max 3/pallet
  // All are OVERSIZED (148-160" length) - need special handling
  if (skuLower.includes('undergrad') || familyLower.includes('undergrad')) {
    // Check for double-sided first (DS in name or even bike counts 6/8/10)
    const isDoubleSided = skuLower.includes('ds') || skuLower.includes('double')
    
    // Extract bike count from SKU or name
    const bikeMatch = sku.match(/(\d+)\s*-?\s*bike/i) || sku.match(/-(\d+)-/) || sku.match(/(\d+)$/)
    const bikeCount = bikeMatch ? parseInt(bikeMatch[1]) : null
    
    if (isDoubleSided || (bikeCount && bikeCount >= 6)) {
      // Double-sided
      if (bikeCount === 6) return 'undergrad-ds-6'
      if (bikeCount === 8) return 'undergrad-ds-8'
      if (bikeCount === 10 || bikeCount > 8) return 'undergrad-ds-10'
      return 'undergrad-ds-6' // Default DS
    } else {
      // Single-sided
      if (bikeCount === 3) return 'undergrad-ss-3'
      if (bikeCount === 4) return 'undergrad-ss-4'
      if (bikeCount === 5 || bikeCount > 4) return 'undergrad-ss-5'
      return 'undergrad-ss-5' // Default SS
    }
  }
  // Legacy SKU pattern - assume 10-bike double-sided
  if (skuLower.startsWith('80101-0370')) return 'undergrad-ds-10'
  
  return null
}

/**
 * Get product model data
 */
export function getProductModel(sku) {
  const key = getProductModelKey(sku)
  return key ? PRODUCT_MODELS[key] : null
}

/**
 * Get accurate dimensions for a product
 */
export function getProductDims(sku) {
  const model = getProductModel(sku)
  if (model && model.dims) {
    return {
      length: model.dims.l,
      width: model.dims.w,
      height: model.dims.h,
      weight: model.weight || 50,
    }
  }
  return null
}

/**
 * DD Component Packing Logic (verified by Chad 2026-02-03)
 * Double Dockers ship as separate components, consolidated by type
 * 
 * Per DD4 unit (VERIFIED):
 * - 2x Slides
 * - 2x Tracks (nest inside slides)
 * - 1x Manifold
 * - 1x Leg
 * 
 * Per DD6 unit: TODO - component counts need verification
 * 
 * CRATE SPECIFICATIONS (VERIFIED):
 * - Slide/Track Crate: 80" × 43" × 56", 21 nested sets (7/layer × 3 layers), 1510 lbs full
 * - Manifold Crate: 54" × 28" × 55", 40 manifolds (10/layer × 4 layers)
 * - Legs Pallet: 48" × 40" (48" × 45" with overhang), 30-40 legs, ~53" at 30 legs
 * 
 * PACKING RULES (VERIFIED):
 * - ≤2 DD units: All components on single pallet (combined)
 * - 3+ DD units: Split by component type (separate crates)
 */
export const DD_COMPONENTS = {
  'dd-slide': {
    name: 'Upper Slide Assembly',
    perDD4: 2, // Verified Feb 2
    perDD6: 3, // Verified Feb 3 (Chad + NetSuite)
    dims: { l: 80.4, w: 16.5, h: 6.5 },
    weight: null, // ⚠️ Per-unit weight unverified
    note: 'Slides and tracks nest inside each other in crate',
  },
  'dd-lower': {
    name: 'Lower Track',
    perDD4: 2, // Verified Feb 2
    perDD6: 3, // Verified Feb 3 (Chad + NetSuite)
    dims: { l: 79.3, w: 12.2, h: 6.0 },
    weight: null, // ⚠️ Per-unit weight unverified
    note: 'Nests inside slides',
  },
  'dd-leg': {
    name: 'Support Leg',
    perDD4: 1, // Verified Feb 2
    perDD6: 1, // Verified Feb 3
    dims: { l: 43.7, w: 24.9, h: 7.0 },
    weight: null, // ⚠️ Per-unit weight unverified
  },
  'dd-manifold': {
    name: 'Manifold',
    perDD4: 1, // Verified Feb 2
    perDD6: 1, // Verified Feb 3 (larger than DD4, doesn't nest well)
    dims: { l: 29.7, w: 12.3, h: 11.8 },
    weight: null, // ⚠️ Per-unit weight unverified
    note: 'DD6 manifolds are larger and ride along on existing pallets (adds weight, not space)',
  },
}

/**
 * DD Crate Specifications (verified by Chad 2026-02-03)
 */
export const DD_CRATES = {
  slideTrackCrate: {
    name: 'DD Slide/Track Crate',
    dims: { l: 80, w: 43, h: 56 },
    capacity: 21, // nested sets
    setsPerLayer: 7,
    layers: 3,
    weight: 1510, // Full crate weight
    note: 'Slides and tracks nest inside each other',
  },
  manifoldCrate: {
    name: 'DD Manifold Crate',
    dims: { l: 54, w: 28, h: 55 },
    capacity: 40,
    unitsPerLayer: 10,
    layers: 4,
    weight: null, // ⚠️ Full crate weight unverified
  },
  legsPallet: {
    name: 'DD Legs Pallet',
    palletDims: { l: 48, w: 40 },
    footprintWithOverhang: { l: 48, w: 45 },
    capacityMin: 30,
    capacityMax: 40,
    heightAt30Legs: 53,
    heightAtCapacity: null, // ⚠️ Height at 40 legs unverified
  },
}

/**
 * Calculate DD pallet breakdown by component
 * 
 * Dynamic Packing Rule (verified by Chad 2026-02-03):
 * - ≤2 DD units: All components on single pallet (combined)
 * - 3+ DD units: Split by component type (separate crates)
 * 
 * Component counts (verified Feb 3):
 * - DD4: 2 slides, 2 tracks, 1 manifold, 1 leg
 * - DD6: 3 slides, 3 tracks, 1 manifold, 1 leg
 * 
 * DD6 Manifold Rule (verified Feb 3):
 * - DD6 manifolds are larger and don't nest well
 * - Typically ride along on existing pallets (adds weight, not space)
 * - Only create separate crate for rare large DD6-only orders
 */
export function calculateDDPallets(dd4Qty = 0, dd6Qty = 0) {
  const warnings = []
  
  // Calculate DD4 components (verified Feb 2)
  const dd4Components = {
    slides: dd4Qty * 2,
    tracks: dd4Qty * 2,
    manifolds: dd4Qty * 1,
    legs: dd4Qty * 1,
  }
  
  // Calculate DD6 components (verified Feb 3)
  const dd6Components = {
    slides: dd6Qty * 3,
    tracks: dd6Qty * 3,
    manifolds: dd6Qty * 1, // Larger than DD4, handled separately
    legs: dd6Qty * 1,
  }
  
  const totalComponents = {
    slides: dd4Components.slides + dd6Components.slides,
    tracks: dd4Components.tracks + dd6Components.tracks,
    dd4Manifolds: dd4Components.manifolds, // DD4 manifolds nest well
    dd6Manifolds: dd6Components.manifolds, // DD6 manifolds ride along
    legs: dd4Components.legs + dd6Components.legs,
  }
  
  // Nested sets = min(slides, tracks) since they nest together
  const nestedSets = Math.min(totalComponents.slides, totalComponents.tracks)
  
  const totalUnits = dd4Qty + dd6Qty
  
  // Dynamic packing rule (verified)
  if (totalUnits <= 2) {
    // ≤2 DD units: All components on single pallet (combined)
    return {
      method: 'combined',
      totalPallets: 1,
      components: {
        slides: totalComponents.slides,
        tracks: totalComponents.tracks,
        manifolds: totalComponents.dd4Manifolds + totalComponents.dd6Manifolds,
        legs: totalComponents.legs,
      },
      dd6ManifoldNote: dd6Qty > 0 ? 'DD6 manifolds included on combined pallet' : null,
      crates: null, // No separate crates needed
      warnings,
      note: '≤2 units: all components ship on single combined pallet',
    }
  }
  
  // 3+ DD units: Split by component type (separate crates)
  const slideTrackCrates = Math.ceil(nestedSets / DD_CRATES.slideTrackCrate.capacity)
  
  // DD4 manifolds go in standard manifold crates
  const dd4ManifoldCrates = Math.ceil(totalComponents.dd4Manifolds / DD_CRATES.manifoldCrate.capacity)
  
  // DD6 manifolds: ride along on slide/track crates (adds weight, not space)
  // Only create separate crate if this is a DD6-only order with no other pallets
  let dd6ManifoldHandling = 'ride-along'
  let dd6ManifoldCrates = 0
  
  if (dd6Qty > 0) {
    if (slideTrackCrates > 0) {
      // DD6 manifolds ride along on slide/track crates
      dd6ManifoldHandling = 'ride-along'
      warnings.push(`DD6 manifolds (${totalComponents.dd6Manifolds}) ride along on slide/track crate(s) - adds weight, not space`)
    } else if (dd4ManifoldCrates > 0) {
      // Rare: DD6-only but somehow have DD4 manifold crates? Ride along there
      dd6ManifoldHandling = 'ride-along-manifold'
      warnings.push(`DD6 manifolds (${totalComponents.dd6Manifolds}) added to manifold crate(s)`)
    } else {
      // Very rare: Large DD6-only order with no other pallets - need separate crate
      dd6ManifoldHandling = 'separate'
      dd6ManifoldCrates = 1 // DD6 manifolds don't nest well, single crate
      warnings.push(`DD6-only order: manifolds (${totalComponents.dd6Manifolds}) require separate handling`)
    }
  }
  
  const legsPallets = Math.ceil(totalComponents.legs / DD_CRATES.legsPallet.capacityMax)
  
  // Calculate partial crate info
  const partialSlideTrack = nestedSets % DD_CRATES.slideTrackCrate.capacity
  const partialDD4Manifold = totalComponents.dd4Manifolds % DD_CRATES.manifoldCrate.capacity
  const partialLegs = totalComponents.legs % DD_CRATES.legsPallet.capacityMax
  
  // Add warnings for partial fills where height is unknown
  if (partialSlideTrack > 0 && partialSlideTrack < DD_CRATES.slideTrackCrate.capacity) {
    warnings.push(`Partial slide/track crate (${partialSlideTrack}/${DD_CRATES.slideTrackCrate.capacity} sets) - height unverified`)
  }
  if (partialDD4Manifold > 0 && partialDD4Manifold < DD_CRATES.manifoldCrate.capacity) {
    warnings.push(`Partial DD4 manifold crate (${partialDD4Manifold}/${DD_CRATES.manifoldCrate.capacity}) - height unverified`)
  }
  if (partialLegs > 0) {
    warnings.push(`Legs pallet has ${totalComponents.legs} legs - height varies (verified ~53" at 30 legs)`)
  }
  
  const totalPallets = slideTrackCrates + dd4ManifoldCrates + dd6ManifoldCrates + legsPallets
  
  return {
    method: 'by-component',
    totalPallets,
    components: {
      slides: totalComponents.slides,
      tracks: totalComponents.tracks,
      dd4Manifolds: totalComponents.dd4Manifolds,
      dd6Manifolds: totalComponents.dd6Manifolds,
      legs: totalComponents.legs,
    },
    crates: {
      slideTrack: {
        count: slideTrackCrates,
        nestedSets: nestedSets,
        dims: DD_CRATES.slideTrackCrate.dims,
        fullCrateWeight: DD_CRATES.slideTrackCrate.weight,
        dd6ManifoldsRidingAlong: dd6ManifoldHandling === 'ride-along' ? totalComponents.dd6Manifolds : 0,
      },
      dd4Manifold: {
        count: dd4ManifoldCrates,
        manifolds: totalComponents.dd4Manifolds,
        dims: DD_CRATES.manifoldCrate.dims,
        fullCrateWeight: null, // ⚠️ Unverified
      },
      dd6Manifold: {
        count: dd6ManifoldCrates,
        manifolds: dd6ManifoldCrates > 0 ? totalComponents.dd6Manifolds : 0,
        handling: dd6ManifoldHandling,
        note: dd6ManifoldHandling === 'ride-along' 
          ? 'DD6 manifolds ride along on slide/track crate (adds weight, not space)'
          : dd6ManifoldHandling === 'separate'
            ? 'Large DD6-only order requires separate manifold handling'
            : null,
      },
      legs: {
        count: legsPallets,
        legs: totalComponents.legs,
        palletDims: DD_CRATES.legsPallet.palletDims,
        footprint: DD_CRATES.legsPallet.footprintWithOverhang,
        heightEstimate: totalComponents.legs <= 30 ? '~53"' : 'unknown (>30 legs)',
      },
    },
    warnings,
    note: '3+ units: components split into dedicated crates by type. DD6 manifolds ride along on existing pallets.',
  }
}

/**
 * Calculate Hoop Runner nested stacking height (verified by Chad 2026-02-03)
 * 
 * Individual dimensions: 28" × 32" × 6"
 * Stacked height formula: 6 + ((qty - 1) × 2)
 * - First unit: 6"
 * - Each additional: +2"
 * 
 * @param {number} qty - Number of hoop runners stacked
 * @returns {object} - { height, formula, dims }
 */
export function calculateHoopRunnerStackHeight(qty) {
  if (qty <= 0) return { height: 0, formula: 'N/A', dims: null }
  
  const height = 6 + ((qty - 1) * 2)
  
  return {
    height,
    formula: `6 + ((${qty} - 1) × 2) = ${height}"`,
    dims: {
      l: 32, // Individual length
      w: 28, // Individual width
      h: height, // Stacked height
    },
    note: 'Verified by Chad 2026-02-03: nested stacking, first=6", each additional=+2"',
  }
}

/**
 * Calculate locker boxes for a given quantity
 * Each locker = 2 boxes (verified by Chad 2026-02-03)
 * 
 * Package A (side panels): 81" × 26" × 5"
 * Package B (top/doors): 82" × 32" × 8"
 * 
 * @param {number} qty - Number of lockers
 * @returns {object} - { boxA, boxB, totalBoxes, warnings }
 */
export function calculateLockerBoxes(qty) {
  if (qty <= 0) return { boxA: 0, boxB: 0, totalBoxes: 0, warnings: [] }
  
  const warnings = []
  
  // Per-box weights are unverified
  warnings.push('⚠️ Individual box weights unverified - using total locker weight for estimates')
  
  return {
    boxA: {
      count: qty,
      dims: { l: 81, w: 26, h: 5 }, // Verified
      contents: 'Side panels',
      weight: null, // Unverified
    },
    boxB: {
      count: qty,
      dims: { l: 82, w: 32, h: 8 }, // Verified
      contents: 'Top & doors',
      weight: null, // Unverified
    },
    totalBoxes: qty * 2,
    note: 'Each locker ships as 2 boxes (verified by Chad 2026-02-03)',
    warnings,
  }
}

/**
 * Calculate Undergrad Single-Sided stacking dimensions (verified by Chad 2026-02-03)
 * 
 * Base Footprints (Perpendicular Entry):
 * - 3-bike: 48" × 63.5"
 * - 4-bike: 40" × 87.5"
 * - 5-bike: 40" × 111.5"
 * 
 * Entry Adjustments:
 * - Perpendicular: Base dimensions (no adjustment)
 * - Right/Left entry: Add 35" to length
 * 
 * Nesting Rules:
 * - First unit height: 12"
 * - Each additional unit: +2.5" height
 * - Length growth: +2.5" per additional unit (average of 2-3")
 * - Max per pallet: ~10 units
 * - Max height: 36"
 * 
 * @param {number} qty - Number of units to stack
 * @param {number} bikeCount - Bike capacity (3, 4, or 5)
 * @param {string} entryType - Entry type: 'perpendicular', 'left', or 'right'
 * @returns {object} - { dims, instructions, warnings }
 */
export function calcUndergradSingleStack(qty, bikeCount = 5, entryType = 'perpendicular') {
  const warnings = []
  
  // Validate inputs
  if (qty <= 0) {
    return { dims: null, instructions: null, warnings: ['Invalid quantity'] }
  }
  
  // Base footprints (perpendicular entry) - verified Feb 3
  const baseFootprints = {
    3: { l: 63.5, w: 48.0 },
    4: { l: 87.5, w: 40.0 },
    5: { l: 111.5, w: 40.0 },
  }
  
  const base = baseFootprints[bikeCount]
  if (!base) {
    warnings.push(`Unknown bike count: ${bikeCount}. Using 5-bike specs.`)
  }
  const baseL = base?.l || 111.5
  const baseW = base?.w || 40.0
  
  // Entry type adjustment (right/left adds 35" to length)
  const entryAdder = (entryType === 'left' || entryType === 'right') ? 35 : 0
  
  // Nesting calculations
  const nestingFirst = 12      // First unit height
  const nestingIncrement = 2.5 // Each additional unit height
  const lengthGrowth = 2.5     // Length growth per additional unit (average of 2-3")
  const maxPerPallet = 10
  const maxHeight = 36
  
  // Calculate stacked dimensions
  const height = nestingFirst + ((qty - 1) * nestingIncrement)
  const length = baseL + entryAdder + ((qty - 1) * lengthGrowth)
  const width = baseW
  
  // Check constraints
  if (qty > maxPerPallet) {
    warnings.push(`Quantity ${qty} exceeds recommended max of ${maxPerPallet} per pallet`)
  }
  if (height > maxHeight) {
    warnings.push(`Stacked height ${height}" exceeds max of ${maxHeight}"`)
  }
  
  // Calculate how many pallets needed
  const palletsNeeded = Math.ceil(qty / maxPerPallet)
  const unitsPerPallet = palletsNeeded > 1 
    ? Math.ceil(qty / palletsNeeded) 
    : qty
  
  // Recalculate dims for actual units per pallet
  const actualHeight = nestingFirst + ((unitsPerPallet - 1) * nestingIncrement)
  const actualLength = baseL + entryAdder + ((unitsPerPallet - 1) * lengthGrowth)
  
  return {
    qty,
    bikeCount,
    entryType,
    dims: {
      l: Math.round(length * 10) / 10,
      w: width,
      h: Math.round(height * 10) / 10,
    },
    perPalletDims: palletsNeeded > 1 ? {
      l: Math.round(actualLength * 10) / 10,
      w: width,
      h: Math.round(actualHeight * 10) / 10,
    } : null,
    palletsNeeded,
    unitsPerPallet: palletsNeeded > 1 ? unitsPerPallet : qty,
    formulas: {
      height: `12 + ((${qty} - 1) × 2.5) = ${height}"`,
      length: `${baseL} + ${entryAdder} + ((${qty} - 1) × 2.5) = ${length}"`,
    },
    instructions: [
      `Stack ${bikeCount}-bike single-sided units flat`,
      entryAdder > 0 
        ? `${entryType.charAt(0).toUpperCase() + entryType.slice(1)} entry: base ${baseL}" + ${entryAdder}" = ${baseL + entryAdder}" starting length`
        : `Perpendicular entry: ${baseL}" base length`,
      `First unit: 12" height`,
      `Each additional: +2.5" height, +2.5" length`,
      qty > maxPerPallet
        ? `Split into ${palletsNeeded} pallets (~${unitsPerPallet} units each)`
        : `All ${qty} units fit on single pallet`,
    ],
    constraints: {
      maxPerPallet,
      maxHeight,
      exceedsMax: qty > maxPerPallet || height > maxHeight,
    },
    warnings,
    note: 'Verified by Chad 2026-02-03',
  }
}
