const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const { createClient } = require('@supabase/supabase-js');
let sendValidationEmail = async () => {};
let saveToGoogleSheets = async () => {};
try {
  ({ sendValidationEmail, saveToGoogleSheets } = require('./lib/notifications'));
} catch (e) {
  console.warn('[NOTIFICATIONS] Optional notifications module unavailable:', e.message);
}
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG
// ============================================================
const config = {
  accountId: process.env.NETSUITE_ACCOUNT_ID?.trim(),
  consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim(),
  consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim(),
  tokenId: process.env.NETSUITE_TOKEN_ID?.trim(),
  tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim(),
  restletUrl: process.env.NETSUITE_RESTLET_URL?.trim()
};

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ============================================================
// PRODUCT CATALOG — loaded from products.json
// ============================================================
let PRODUCT_CATALOG = null;

function loadProductCatalog() {
  if (PRODUCT_CATALOG) return PRODUCT_CATALOG;
  try {
    // Try multiple paths — Vercel serverless functions have different CWDs
    let data;
    const paths = [
      path.join(process.cwd(), 'public', 'products.json'),
      path.join(__dirname, '..', 'public', 'products.json'),
      path.join(__dirname, 'public', 'products.json'),
    ];
    for (const p of paths) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        data = JSON.parse(raw);
        console.log(`[CATALOG] Loaded from ${p}`);
        break;
      } catch (e) { /* try next path */ }
    }
    if (!data) {
      console.error('[CATALOG] products.json not found at any path');
      return {};
    }
    PRODUCT_CATALOG = {};
    for (const p of (data.products || [])) {
      PRODUCT_CATALOG[p.sku.toUpperCase()] = {
        sku: p.sku,
        family: p.family,
        name: p.displayName,
        weight: p.packaged?.weight_lbs || 50,
        length: p.packaged?.length_in || 24,
        width: p.packaged?.width_in || 18,
        height: p.packaged?.height_in || 12,
      };
    }
    console.log(`[CATALOG] Loaded ${Object.keys(PRODUCT_CATALOG).length} products`);
    return PRODUCT_CATALOG;
  } catch (err) {
    console.error('[CATALOG] Failed to load products.json:', err.message);
    return {};
  }
}

// ============================================================
// SKU CLASSIFICATION
// ============================================================

// Non-physical line items (fees, services, notes)
const NON_SHIPPABLE_EXACT = new Set([
  'credit card fee', 'installation service', 'installation labor',
  'installation mobilization - add/alt', 'installation overhead',
  'installation note', 'discount', 'royalty fee - skatedock',
  'misc-non-inv-sale', 'misc-non-inv-sale terms', 'change order amount',
  'shipping', 'shipping note', 'price escalation - add/alt',
  'contract notes', 'change order request', 'change order summary',
  'add/alternate', 'sales order discounts - line level', 'desc',
  'product summary', 'lead time', 'installation mobilization',
  'freight', 'change order note',
  // Additional non-physical lines from warehouse validation review
  'custom color set up fee', 'packing materials',
  'sidestage price adjustment', 'sidestage addon price adjustment',
  'cc reader', '25974',
  // Pallet/material adjunct lines that should never count as product pallets
  'epoxy epopro', '99100-0009-050',
  '4-way pallet', '85001-4840',
]);

const NON_SHIPPABLE_STARTSWITH = [
  'installation ', 'royalty fee', 'misc-non-inv',
  'change order', 'shipping note', 'price escalation',
  'contract note', 'sales order discount',
];

// Hardware / fastener prefixes — these ship WITH main products, not as own pallets
const HARDWARE_PREFIXES = [
  // Fasteners / screws / bolts (3xxxx series — catch-all for 3000x)
  '3000', '30006-', '30008-', '30012-', '30016-', '30017-',
  '31000-', '31005-',
  '32000-', '32001-', '32004-', '32019-',
  '34000-', '34002-', '34010-', '34051-',
  // Misc hardware
  '39000-', '39010-', '39100-',
  // Plastic parts / caps / guards (4xxxx series — assembly sub-components)
  '40103-', '40108-', '40110-', '40111-', '40304-',
  '40501-', '40602-', '40802-', '41002-',
  // Structural sub-components
  '50101-', '50301-', '50801-',
  // Assembly intermediates
  '71003-',
  // All DD/general hardware kits (81000 series)
  '81000-', '81004-',
  // Packaging / label items
  '91000-',
];

const HARDWARE_STARTSWITH = ['sik', 'wak', 'locker stacking'];
const HARDWARE_CONTAINS = [
  'anchor kit', 'polybag', 'trident nut driver',
  'hardware kit', 'install kit', 'hardware,',
  'toggle bolt', 'channel nut', 'carriage bolt kit',
  'u-bolt kit', 'anchoring kit', 'stacking hardware',
  'flat washer', 'flange nut', 'wedge anchor',
  'hex-head bolt', 'lag screw', 'cap screw', 'end cap,',
];

// Service / coating lines — these are work orders, not physical products
const SERVICE_COATING_PREFIXES = ['60900-'];

// Component suppression: parent prefix → child prefixes to skip
const COMPONENT_SUPPRESSION = {
  'dd-': [
    '80101-0050', '80101-0258', '80301-0250', '80301-0252', '80301-0253',
    '80301-0257', '80301-0258', '50101-0256', '80101-0257',
  ],
  '90101-2287': [
    '80101-0088', '80101-0287', '80301-0088', '80301-0287',
    '61211-0002', '61211-0004', '61211-0005',
    '71003-0088',
  ],
  '90101-0172': ['80101-0172'],
  '89901-0163': ['80301-0163'],
  '80101-0202': ['80301-0202'],
  '89901-2050': [
    '80301-2048', '80301-2049', '80301-2050', '80301-2051', '80301-2052', '80101-2050',
  ],
  '80101-0281': ['80301-0281'],
  '89901-0418': ['90101-0418'],
  '90101-1172': ['80301-1172'],
  '89901-1172': ['80301-1172'],
  '80101-1172': ['80301-1172'],
};

// Sub-component SKUs that should ALWAYS be filtered regardless of parent presence
// NOTE: With pick ticket filter (fulfillable=T, assemblyComponent=F, kitComponent check),
// most of these are already filtered at the SuiteQL or kitComponent level.
// This list is kept as a safety net for edge cases.
// IMPORTANT: Do NOT include Kit parent prefixes (80101-0257, 80101-0258) — those are
// now the product-level DD items returned by the pick ticket filter.
const ALWAYS_SUPPRESS_PREFIXES = [
  '80301-0088', '80301-0287',  // Varsity DV215 unassembled parts
  '80101-0088', '80101-0287',  // Varsity assembled sub-parts
  '80101-0050',                 // DD slide assembly (kitComponent=T catches this, but just in case)
  '80301-0250', '80301-0252', '80301-0253', // DD manifold/rail/leg parts
  '80301-0257', '80301-0258',  // DD manifold weldments (NOT the -KIT variants!)
  '80301-2048', '80301-2049', '80301-2050', '80301-2051', '80301-2052', // Dismount welded assemblies
  '80101-2050',                 // Dismount head
  '80301-1172',                 // VR1 raw
  '80301-0281',                 // 2UP raw
  '80301-0202',                 // Radius raw
  '80301-0163',                 // Hoop Runner raw
  '90101-0418', '90101-0407',   // VISI2/MBA box sub-components
];

// Packaging prefixes
const PACKAGING_PREFIXES = ['61211-', '60905-', '60913-', '60923-'];

function classifyItem(sku, name, orderHasParents) {
  const skuLower = (sku || '').toLowerCase().trim();
  const nameLower = (name || '').toLowerCase().trim();

  // 1. Non-shippable (fees, services, notes)
  if (NON_SHIPPABLE_EXACT.has(skuLower) || NON_SHIPPABLE_EXACT.has(nameLower)) return 'non_shippable';
  for (const prefix of NON_SHIPPABLE_STARTSWITH) {
    if (skuLower.startsWith(prefix) || nameLower.startsWith(prefix)) return 'non_shippable';
  }
  if (skuLower === 'unknown' && nameLower === 'unknown item') return 'non_shippable';

  // 2. RAW manufacturing intermediates — never ship as finished goods
  if (skuLower.endsWith('-raw') || skuLower.includes('-raw ') || skuLower.includes('-raw(')) return 'hardware';

  // 3. Service / coating lines (60900- series)
  for (const prefix of SERVICE_COATING_PREFIXES) {
    if (skuLower.startsWith(prefix)) return 'hardware';
  }
  if (nameLower.includes('service, coating') || nameLower.includes('service,  coating')) return 'hardware';

  // 4. Hardware / fastener prefixes
  for (const prefix of HARDWARE_PREFIXES) {
    if (skuLower.startsWith(prefix)) return 'hardware';
  }
  for (const sw of HARDWARE_STARTSWITH) {
    if (skuLower.startsWith(sw)) return 'hardware';
  }
  for (const kw of HARDWARE_CONTAINS) {
    if (nameLower.includes(kw)) return 'hardware';
  }

  // 5. Packaging
  for (const prefix of PACKAGING_PREFIXES) {
    if (skuLower.startsWith(prefix)) return 'packaging';
  }

  // 5.5. Always-suppress sub-components (manufacturing intermediates)
  for (const prefix of ALWAYS_SUPPRESS_PREFIXES) {
    if (skuLower.startsWith(prefix.toLowerCase())) return 'component_of_parent';
  }

  // 6. Component suppression (child parts when parent is on the order)
  for (const [parentPrefix, componentPrefixes] of Object.entries(COMPONENT_SUPPRESSION)) {
    if (orderHasParents.has(parentPrefix)) {
      for (const compPrefix of componentPrefixes) {
        if (skuLower.startsWith(compPrefix.toLowerCase())) return 'component_of_parent';
      }
    }
  }

  return 'product';
}

function detectOrderParents(items) {
  const parents = new Set();
  for (const item of items) {
    const skuLower = String(item?.sku || '').toLowerCase().trim();
    for (const parentPrefix of Object.keys(COMPONENT_SUPPRESSION)) {
      if (skuLower.startsWith(parentPrefix)) {
        parents.add(parentPrefix);
      }
    }
  }
  return parents;
}

// ============================================================
// PRODUCT LOOKUP
// ============================================================
function lookupProduct(sku) {
  const catalog = loadProductCatalog();
  const skuUpper = (sku || '').toUpperCase().trim();

  // Exact match
  if (catalog[skuUpper]) return catalog[skuUpper];

  // Try without color suffix (-BLK13, -GAV, -GRY14, -RED, etc.)
  const baseSku = skuUpper.replace(/-[A-Z]{2,}[0-9]*$/, '');
  for (const [catSku, product] of Object.entries(catalog)) {
    if (catSku.replace(/-[A-Z]{2,}[0-9]*$/, '') === baseSku && baseSku.length > 4) {
      return product;
    }
  }

  // Family-based prefix matching
  const skuLower = (sku || '').toLowerCase();
  const familyPrefixes = {
    // DD Group parents (legacy — these won't appear with pick ticket filter,
    // but kept for backward compatibility if items are passed without filter)
    'dd-ss-04': 'Double Docker', 'dd-ss-06': 'Double Docker',
    'dd-ds-04': 'Double Docker', 'dd-ds-06': 'Double Docker',
    // DD Kit parents (NEW — these replace Group parents with pick ticket filter)
    '80101-0257': 'Double Docker',  // DD 4-bike kit
    '80101-0258': 'Double Docker',  // DD 6-bike kit
    // Varsity
    '90101-2287': 'Varsity', '90101-0172': 'VR2 Offset',
    'vr-vr2': 'VR2 Offset',
    // Dismount / Skatedock / Snowdock
    '89901-2050': 'Dismount', '89901-121': 'Skatedock',
    'sm10x': 'Skatedock', 'sd6x': 'Skatedock',
    '80101-1210': 'Skatedock',
    '89901-1406': 'Snowdock', '80101-1406': 'Snowdock',
    // Base Station
    'ss120': 'Base Station', 'ss95': 'Base Station', 'ss66': 'Base Station', 'ss38': 'Base Station',
    'cs120': 'Base Station', 'cs95': 'Base Station', 'cs66': 'Base Station', 'cs38': 'Base Station',
    'ssa': 'Base Station', 'csa': 'Base Station',
    // Hoop Runner / Circle Series
    '80301-0166': 'Hoop Runner', '80301-0151': 'Circle Series (Omega)',
    '89901-0163': 'Hoop Runner', '80101-0163': 'Hoop Runner',
    // Lockers / Vaults
    'visi2': 'Metal Bike Vault / VisiLocker', 'mbv2': 'Metal Bike Vault / VisiLocker',
    '89901-0418': 'Metal Bike Vault / VisiLocker',
    'mbv1': 'MBA', '89901-0407': 'MBA',
    // Undergrad
    '80101-0370': 'Undergrad', '80101-0363': 'Undergrad', '80101-0364': 'Undergrad',
    '80101-0365': 'Undergrad', '80101-0366': 'Undergrad', '80101-0368': 'Undergrad',
    '80301-0363': 'Undergrad', '80301-0364': 'Undergrad', '80301-0365': 'Undergrad',
    '80301-0368': 'Undergrad',
    // Other
    '80101-0281': '2UP', '80301-0281': '2UP',
    'sm-wave': 'Wave Runner',
    '26302c': 'Pump & Repair',
    '26246': 'Pump & Repair',
    '89904': 'Skatedock',
    '89901-1210': 'Skatedock',
    '90101-1172': 'VR1 XL', '89901-1172': 'VR1 XL', '80101-1172': 'VR1 XL',
    '80101-0230': 'Base Station',
    '80101-0232': 'Base Station',
    '80101-0202': 'Radius',
    '80101-0335': 'Guardian',
    '90101-0335': 'Guardian', // legacy/discontinued Guardian prefix
    '89901-0172': 'VR2 Offset', // duraplas/discontinued alias
    '89901-2287': 'Varsity', // duraplas/discontinued alias
  };

  for (const [prefix, family] of Object.entries(familyPrefixes)) {
    if (skuLower.startsWith(prefix)) {
      for (const product of Object.values(catalog)) {
        if (product.family === family) return product;
      }
    }
  }

  return null;
}

// ============================================================
// PALLET PREDICTION
// ============================================================
const UNITS_PER_PALLET = {
  'Varsity': 70, 'VR2 Offset': 40, 'VR1 XL': 40,
  'Double Docker': 1, 'Hoop Runner': 60, 'Undergrad': 2,
  'Skatedock': 16, 'Dismount': 15,
  // Chad warehouse guidance: base-station struts fit ~50 pieces/pallet
  'Base Station': 50,
  'Wave Runner': 4, 'Circle Series (Omega)': 10,
  'Metal Bike Vault / VisiLocker': 2, 'MBA': 2,
  'Pump & Repair': 10, 'Cane Detection': 10, '2UP': 24,
  'Strut Install Kit': 20, 'Saris': 10, 'Fiberglass Bike Vault': 2,
  'Radius': 6, 'Guardian': 6, 'Snowdock': 8,
};

// Explicit SKU-level overrides from Chad's validation review
const SKU_UNITS_PER_PALLET = {
  '89905-0003-08BLK': 10, // MBA Base 8#
  '80301-0093-C-ZRP': 50, // Varsity Stinger ZRP
  'DV215-CUST13': 25,
  '89901-0417-GRY14-KIT': 7, // VISI1 approx 6-7 per large crate
  '89901-0408-GRY14-KIT': 5, // MBV2 approx 4-5 per large crate
  '90101-0151-SS': 15,
  '80301-0207-GAV': 10,
  '80301-0205-GAV': 10,
  '89901-0166-BLK23': 20,
};

const RIDE_ALONG_SKUS = new Set([
  '26246', // HSO pump
  '26248', // HSI pump (legacy)
  '26302C', // work stand
  '25974', // CC reader
  '99100-0009-050', // epoxy epopro
  '80301-0254-GAV', // DD lower track extension legacy
  '80301-0254-BLK13',
]);

function normalizeSku(sku) {
  return String(sku || '')
    .toUpperCase()
    .replace(/\s*\([^)]*\)/g, '') // remove parenthetical descriptors
    .trim();
}

function isRideAlongItem(item) {
  const rawSku = String(item?.sku || '').toUpperCase();
  const normSku = normalizeSku(item?.sku);
  const name = String(item?.name || '').toLowerCase();

  if (RIDE_ALONG_SKUS.has(rawSku) || RIDE_ALONG_SKUS.has(normSku)) return true;
  if (rawSku.includes('26246') || rawSku.includes('26248') || rawSku.includes('26302C')) return true;
  if (name.includes('pump') || name.includes('work stand') || name.includes('epopro') || name.includes('cc reader')) return true;
  return false;
}

function parseLengthFromSkuOrName(item) {
  const normSku = normalizeSku(item?.sku);
  const name = String(item?.name || '').toUpperCase();

  // 50801-0012-GAV-120 -> 120
  const railSuffix = normSku.match(/-(\d{2,3})$/);
  if (railSuffix) return parseInt(railSuffix[1], 10);

  // SIK120-3R-METAL -> 120
  const sikLen = normSku.match(/^SIK(\d{2,3})/);
  if (sikLen) return parseInt(sikLen[1], 10);

  // Name fallback: "... 120\" ..."
  const nameLen = name.match(/\b(\d{2,3})\s*"/);
  if (nameLen) return parseInt(nameLen[1], 10);

  return 0;
}

function isLongTubeTriggerItem(item) {
  const normSku = normalizeSku(item?.sku);
  const name = String(item?.name || '').toUpperCase();
  return (
    normSku.startsWith('50801-') ||
    normSku.startsWith('SIK') ||
    name.includes('UNISTRUT') ||
    (name.includes('STRUT') && name.includes('KIT'))
  );
}

function estimateLongTubePallets(state) {
  // Conservative rule:
  // - any 100\"+ rail/tube bundle creates a dedicated long-tube package
  // - shorter rails can still ride with host pallets
  if (!state || state.triggerLines === 0) return 0;
  if (state.maxLength >= 100) return 1;
  return 0;
}

function estimateDDPallets(qty, bikeCount) {
  if (bikeCount === 4) {
    const trays = Math.ceil((qty * 2) / 21);
    const legs = Math.ceil(qty / 32);
    const manifolds = Math.ceil(qty / 40);
    return { total: trays + legs + manifolds, trays, legs, manifolds };
  } else if (bikeCount === 6) {
    const trays = Math.ceil((qty * 2) / 14);
    const legs = Math.ceil(qty / 20);
    const manifolds = Math.ceil(qty / 30);
    return { total: trays + legs + manifolds, trays, legs, manifolds };
  }
  const total = Math.ceil(qty * 4 / 10);
  return { total, trays: total, legs: 0, manifolds: 0 };
}

function varsityMode(sku, name) {
  const s = (sku || '').toUpperCase();
  const n = (name || '').toUpperCase();
  if (n.includes('HEAD') && n.includes('MBA')) return 'heads';
  if (s.includes('CUST') || s.includes('USA') || n.includes('CUSTOM') || n.includes('USA')) return 'loose';
  if (s.includes('GAV') || s.includes('BLK') || s.includes('-T')) return 'boxed';
  return 'boxed';
}

function computePalletsForFamily(family, qty, sku, name, familyState = {}) {
  if (qty <= 0) return 0;
  switch (family) {
    case 'Hoop Runner': return qty <= 20 ? 1 : Math.ceil(qty / 20);
    case 'Dismount': return qty <= 10 ? 1 : Math.ceil(qty / 6);
    case 'Radius': return qty <= 24 ? 1 : Math.ceil(qty / 25);
    case 'MBA': return qty <= 3 ? 1 : qty <= 8 ? 2 : Math.ceil(qty / 4);
    case 'Undergrad': return Math.ceil(qty / 2);
    case '2UP': return qty <= 36 ? 1 : Math.ceil(qty / 36);
    case 'Metal Bike Vault / VisiLocker': {
      if (qty <= 3) return 1;
      if (qty <= 6) return 2;
      if (qty <= 9) return 3;
      if (qty <= 12) return 4;
      return Math.ceil(qty / 3);
    }
    case 'VR1 XL': {
      if (qty <= 9) return 1;
      if (qty <= 30) return 2;
      if (qty <= 80) return 4;
      return Math.ceil(qty / 56);
    }
    case 'VR2 Offset': return Math.ceil(qty / 10);
    case 'Skatedock': {
      if (qty <= 2) return qty;
      if (qty <= 10) return 1;
      return Math.ceil(qty / 8);
    }
    case 'Base Station': return 1; // dedicated long-tube pallet in nearly all real shipments
    case 'Varsity': {
      const mode = varsityMode(sku, name);
      if (mode === 'heads') return Math.ceil(qty / 50);
      if (mode === 'loose') return Math.ceil(qty / 17);
      return Math.ceil(qty / 42);
    }
    case 'Double Docker': {
      // Use component-aware state when available
      const units = Math.max(
        Math.round(qty),
        Math.round((familyState.legs || 0)),
        Math.round((familyState.manifolds || 0)),
        Math.round((familyState.trays || 0) / 2)
      );
      if (units <= 0) return 0;
      if (units <= 2) return 1;
      if (units <= 4) return 2;

      const s = (sku || '').toUpperCase();
      const isGalv = s.includes('GAV') || s.includes('GALV');

      if (units <= 10) {
        if (isGalv) {
          const tray = Math.ceil((units * 2) / 35);
          const legs = Math.ceil(units / 50);
          return tray + legs; // manifolds ride with legs for medium orders
        }
        const upper = Math.ceil(units / 28);
        const lower = Math.ceil(units / 50);
        const legs = Math.ceil(units / 50);
        return upper + lower + legs;
      }

      if (isGalv) {
        const tray = Math.ceil((units * 2) / 35);
        const legs = Math.ceil(units / 50);
        const manifolds = Math.ceil(units / 30);
        return tray + legs + manifolds;
      }
      const upper = Math.ceil(units / 28);
      const lower = Math.ceil(units / 50);
      const legs = Math.ceil(units / 50);
      const manifolds = Math.ceil(units / 30);
      return upper + lower + legs + manifolds;
    }
    default:
      return Math.ceil(qty / (UNITS_PER_PALLET[family] || 10));
  }
}

function predictPallets(items) {
  const diagnostics = {
    totalLines: items.length,
    rawLinesCount: items.length,
    filteredNonShippable: 0,
    filteredHardware: 0,
    filteredPackaging: 0,
    filteredComponents: 0,
    knownProducts: 0,
    unknownProducts: 0,
    unknownSkus: [],
    longTubeTriggerLines: 0,
    longTubePallets: 0,
    includedLines: [],
    excludedLines: [],
  };

  const families = {};
  const breakdown = [];
  const orderHasParents = detectOrderParents(items);
  const longTubeState = {
    triggerLines: 0,
    totalQty: 0,
    maxLength: 0,
    estimatedWeight: 0,
    sources: new Set(),
  };

  for (const item of items) {
    if (!item.qty || item.qty === 0) {
      diagnostics.filteredNonShippable++;
      diagnostics.excludedLines.push({
        sku: normalizeSku(item.sku || 'UNKNOWN'),
        name: item.name || 'Unknown Item',
        qty: item.qty || 0,
        reason: 'qty_zero',
        flags: {
          fulfillable: !!item.fulfillable,
          assemblyComponent: !!item.assemblyComponent,
          kitComponent: !!item.kitComponent,
          itemType: item.itemType || '',
        },
      });
      continue;
    }

    const normSku = normalizeSku(item.sku || 'UNKNOWN');
    const classification = classifyItem(item.sku, item.name, orderHasParents);

    if (classification === 'non_shippable') {
      diagnostics.filteredNonShippable++;
      diagnostics.excludedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        reason: 'non_shippable',
        classification,
        flags: {
          fulfillable: !!item.fulfillable,
          assemblyComponent: !!item.assemblyComponent,
          kitComponent: !!item.kitComponent,
          itemType: item.itemType || '',
        },
      });
      continue;
    }
    if (classification === 'packaging') {
      diagnostics.filteredPackaging++;
      diagnostics.excludedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        reason: 'packaging',
        classification,
        flags: {
          fulfillable: !!item.fulfillable,
          assemblyComponent: !!item.assemblyComponent,
          kitComponent: !!item.kitComponent,
          itemType: item.itemType || '',
        },
      });
      continue;
    }
    if (classification === 'component_of_parent') {
      diagnostics.filteredComponents++;
      diagnostics.excludedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        reason: 'component_of_parent',
        classification,
        flags: {
          fulfillable: !!item.fulfillable,
          assemblyComponent: !!item.assemblyComponent,
          kitComponent: !!item.kitComponent,
          itemType: item.itemType || '',
        },
      });
      continue;
    }

    if (isLongTubeTriggerItem(item)) {
      const lengthIn = parseLengthFromSkuOrName(item);
      diagnostics.longTubeTriggerLines++;
      longTubeState.triggerLines += 1;
      longTubeState.totalQty += Math.max(0, item.qty || 0);
      longTubeState.maxLength = Math.max(longTubeState.maxLength, lengthIn);
      longTubeState.sources.add(normSku);
      const perPieceWeight = lengthIn >= 114 ? 8 : lengthIn >= 100 ? 7 : lengthIn >= 86 ? 6 : 5;
      longTubeState.estimatedWeight += (Math.max(0, item.qty || 0) * perPieceWeight);

      diagnostics.includedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        mode: 'long_tube_trigger',
        classification,
        meta: { lengthIn },
        flags: {
          fulfillable: !!item.fulfillable,
          assemblyComponent: !!item.assemblyComponent,
          kitComponent: !!item.kitComponent,
          itemType: item.itemType || '',
        },
      });
      breakdown.push({
        sku: normSku,
        name: item.name,
        qty: item.qty,
        pallets: 0,
        weight: 0,
        matched: 'LONG_TUBE_TRIGGER',
      });
      continue;
    }

    const rideAlong = isRideAlongItem(item) || classification === 'hardware';
    const product = lookupProduct(item.sku);

    if (rideAlong) {
      diagnostics.filteredHardware++;
      diagnostics.includedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        mode: 'ride_along',
        classification,
        flags: {
          fulfillable: !!item.fulfillable,
          assemblyComponent: !!item.assemblyComponent,
          kitComponent: !!item.kitComponent,
          itemType: item.itemType || '',
        },
      });
      breakdown.push({ sku: normSku, name: item.name, qty: item.qty, pallets: 0, weight: 0, matched: 'RIDE_ALONG' });
      continue;
    }

    if (!product) {
      const overrideUpp = SKU_UNITS_PER_PALLET[normSku];
      if (overrideUpp) {
        const pallets = Math.ceil(item.qty / overrideUpp);
        diagnostics.knownProducts++;
        diagnostics.includedLines.push({
          sku: normSku,
          name: item.name || 'Unknown Item',
          qty: item.qty,
          mode: 'sku_override',
          classification: 'product',
          flags: {
            fulfillable: !!item.fulfillable,
            assemblyComponent: !!item.assemblyComponent,
            kitComponent: !!item.kitComponent,
            itemType: item.itemType || '',
          },
        });
        breakdown.push({ sku: normSku, name: item.name, qty: item.qty, pallets, weight: Math.round(item.qty * 50), matched: 'SKU_OVERRIDE' });
      } else {
        diagnostics.unknownProducts++;
        diagnostics.unknownSkus.push(item.sku);
        diagnostics.includedLines.push({
          sku: normSku,
          name: item.name || 'Unknown Item',
          qty: item.qty,
          mode: 'unknown_fallback',
          classification: 'product',
          flags: {
            fulfillable: !!item.fulfillable,
            assemblyComponent: !!item.assemblyComponent,
            kitComponent: !!item.kitComponent,
            itemType: item.itemType || '',
          },
        });
        const pallets = Math.ceil(item.qty / 10);
        breakdown.push({ sku: normSku, name: item.name, qty: item.qty, pallets, weight: Math.round(item.qty * 25), matched: 'UNKNOWN' });
      }
      continue;
    }

    diagnostics.knownProducts++;
    diagnostics.includedLines.push({
      sku: normSku,
      name: item.name || 'Unknown Item',
      qty: item.qty,
      mode: 'family_recipe',
      family: product.family,
      classification: 'product',
      flags: {
        fulfillable: !!item.fulfillable,
        assemblyComponent: !!item.assemblyComponent,
        kitComponent: !!item.kitComponent,
        itemType: item.itemType || '',
      },
    });
    const family = product.family;
    if (!families[family]) {
      families[family] = { qty: 0, skuSample: normSku, nameSample: item.name, weightPerUnit: product.weight || 50, trays: 0, legs: 0, manifolds: 0 };
    }
    families[family].qty += item.qty;

    const s = normSku.toUpperCase();
    const n = (item.name || '').toUpperCase();
    if (family === 'Double Docker') {
      if (n.includes('TRAY') || s.includes('1210') || s.includes('SLIDE')) families[family].trays += item.qty;
      if (n.includes('LEG')) families[family].legs += item.qty;
      if (n.includes('MANIFOLD') || s.includes('2014')) families[family].manifolds += item.qty;
    }
  }

  let totalPallets = 0;
  let totalWeight = 0;

  for (const [family, data] of Object.entries(families)) {
    const pallets = computePalletsForFamily(family, data.qty, data.skuSample, data.nameSample, data);
    const weight = Math.round(data.qty * data.weightPerUnit);
    totalPallets += pallets;
    totalWeight += weight;
    breakdown.push({
      sku: data.skuSample,
      name: `${family} (recipe)` ,
      qty: data.qty,
      pallets,
      weight,
      matched: family,
    });
  }

  const longTubePallets = estimateLongTubePallets(longTubeState);
  if (longTubePallets > 0) {
    const longTubeWeight = Math.max(40, Math.min(500, Math.round(longTubeState.estimatedWeight)));
    diagnostics.longTubePallets = longTubePallets;
    totalPallets += longTubePallets;
    totalWeight += longTubeWeight;
    breakdown.push({
      sku: 'LONG-TUBE',
      name: `Long tube bundle (${longTubeState.maxLength || 'unknown'}")`,
      qty: longTubeState.totalQty,
      pallets: longTubePallets,
      weight: longTubeWeight,
      matched: 'LONG_TUBE',
      sources: Array.from(longTubeState.sources),
    });
  }

  // Include unknown/override/ride-along lines already appended above
  for (const row of breakdown) {
    if (row.matched === 'UNKNOWN' || row.matched === 'SKU_OVERRIDE') {
      totalPallets += row.pallets;
      totalWeight += row.weight;
    }
  }

  const productLines = diagnostics.knownProducts + diagnostics.unknownProducts;
  const confidenceScore = productLines > 0 ? Math.round((diagnostics.knownProducts / productLines) * 100) : 100;
  const confidenceLevel = confidenceScore >= 90 ? 'high' : confidenceScore >= 60 ? 'medium' : 'low';

  return {
    totalPallets,
    totalWeight: Math.round(totalWeight),
    breakdown,
    diagnostics: { ...diagnostics, productLines, confidenceScore, confidenceLevel },
  };
}

// ============================================================
// NETSUITE OAUTH
// ============================================================
function createOAuthClient() {
  return OAuth({
    consumer: { key: config.consumerKey, secret: config.consumerSecret },
    signature_method: 'HMAC-SHA256',
    hash_function(base_string, key) {
      return crypto.createHmac('sha256', key).update(base_string).digest('base64');
    }
  });
}

async function getSalesOrderViaSuiteQL(soNumber) {
  const soQuery = `SELECT id, tranid, type FROM transaction WHERE tranid IN ('SO${soNumber}', '${soNumber}') AND type = 'SalesOrd' ORDER BY id DESC`;
  const soUrl = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=10&offset=0`;

  const oauth = createOAuthClient();
  const token = { key: config.tokenId, secret: config.tokenSecret };
  const authHeader = oauth.toHeader(oauth.authorize({ url: soUrl, method: 'POST' }, token));
  authHeader.Authorization = authHeader.Authorization.replace('OAuth ', `OAuth realm="${config.accountId.toUpperCase()}", `);

  const soResponse = await fetch(soUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader.Authorization,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'transient'
    },
    body: JSON.stringify({ q: soQuery })
  });

  const soData = await soResponse.json();

  if (!soData.items || soData.items.length === 0) {
    return { success: false, error: `Sales order SO${soNumber} not found` };
  }

  const soId = soData.items[0].id;

  // Gate 1 input completeness:
  // Pull all non-main physical item lines, then let classification decide what
  // contributes to pallets. This keeps shippable rails/kits visible even when
  // NetSuite flags them as assembly components or non-fulfillable.
  const itemsQuery = `
    SELECT i.itemid AS sku, i.displayname AS name, tl.quantity,
           tl.kitComponent, tl.itemType, tl.fulfillable, tl.assemblyComponent
    FROM transactionline tl
    LEFT JOIN item i ON i.id = tl.item
    WHERE tl.transaction = ${soId}
      AND tl.mainLine = 'F'
      AND tl.item IS NOT NULL
      AND tl.itemType NOT IN ('Service', 'ShipItem', 'TaxGroup')
      AND COALESCE(tl.quantity, 0) <> 0
  `;

  const itemsUrl = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0`;
  const itemsAuthHeader = oauth.toHeader(oauth.authorize({ url: itemsUrl, method: 'POST' }, token));
  itemsAuthHeader.Authorization = itemsAuthHeader.Authorization.replace('OAuth ', `OAuth realm="${config.accountId.toUpperCase()}", `);

  const itemsResponse = await fetch(itemsUrl, {
    method: 'POST',
    headers: {
      'Authorization': itemsAuthHeader.Authorization,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'transient'
    },
    body: JSON.stringify({ q: itemsQuery })
  });

  const itemsData = await itemsResponse.json();

  if (!itemsData.items || itemsData.items.length === 0) {
    return { success: false, error: `No items found for SO${soNumber}` };
  }

  const items = itemsData.items.map(row => ({
    sku: row.sku || row.itemid || 'UNKNOWN',
    name: row.name || row.displayname || 'Unknown Item',
    qty: Math.abs(parseInt(row.quantity, 10) || 0),
    kitComponent: row.kitcomponent === 'T',
    fulfillable: row.fulfillable === 'T',
    assemblyComponent: row.assemblycomponent === 'T',
    itemType: row.itemtype || '',
  }));

  return { success: true, items };
}

// ============================================================
// API HANDLER
// ============================================================
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const soInput = body.soNumber || body.salesOrderNumber || body.sales_order_id;
    const soNumber = String(soInput || '').replace(/^SO/i, '');
    const skipSave = body.skipSave === true;
    const pallets = Array.isArray(body.pallets) ? body.pallets : [];
    const validatedBy = body.validatedBy || 'batch-reprocess';
    const notes = body.notes;

    console.log('=== VALIDATE SO' + soNumber + ` (skipSave=${skipSave}) ===`);

    if (!soNumber) {
      return res.status(400).json({ success: false, error: 'Missing required field: soNumber or salesOrderNumber' });
    }

    if (!skipSave && (!Array.isArray(body.pallets) || !body.validatedBy)) {
      return res.status(400).json({ success: false, error: 'Missing required fields: soNumber, pallets, validatedBy' });
    }

    // 1. NetSuite lookup
    const soData = await getSalesOrderViaSuiteQL(soNumber);
    if (!soData.success || !soData.items?.length) {
      return res.status(404).json({ success: false, error: `Sales order SO${soNumber} not found or has no items` });
    }

    // 2. Predict
    const prediction = predictPallets(soData.items);
    const d = prediction.diagnostics;
    console.log(`[PREDICT] ${prediction.totalPallets} pallets | confidence=${d.confidenceLevel} (${d.confidenceScore}%) | filtered: ${d.filteredNonShippable}ns ${d.filteredHardware}hw ${d.filteredComponents}comp ${d.filteredPackaging}pkg | unknown: ${d.unknownProducts}`);

    // 3. Actuals
    const actualPallets = pallets.length;
    const actualWeight = pallets.reduce((sum, p) => sum + (p.weight || 0), 0);

    // 4. Variance
    const palletVariance = actualPallets - prediction.totalPallets;
    const weightVariance = actualWeight - prediction.totalWeight;
    const absDelta = Math.abs(palletVariance);
    const severity = absDelta === 0 ? 'exact' : absDelta <= 1 ? 'low' : absDelta <= 2 ? 'medium' : 'high';

    // 5. Save to Supabase (skip for batch reprocessing)
    let validationId = null;
    if (!skipSave && supabase) {
      const result = await supabase.from('validations').insert({
        pick_ticket_id: `SO${soNumber}`,
        sales_order_id: `SO${soNumber}`,
        predicted_pallets: prediction.totalPallets,
        predicted_weight: prediction.totalWeight,
        predicted_breakdown: prediction.breakdown,
        actual_pallets: actualPallets,
        actual_weight: actualWeight,
        actual_dimensions: pallets,
        actual_notes: notes || null,
        validated_by: validatedBy,
        validated_at: new Date().toISOString(),
        status: 'validated'
      }).select('id');

      if (result.error) {
        console.error('Supabase error:', result.error);
      } else {
        validationId = result.data?.[0]?.id;
      }
    }

    // 6. Notifications (non-blocking)
    if (!skipSave) {
      Promise.all([
        sendValidationEmail({ soNumber: `SO${soNumber}`, validatedBy, notes, predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight }, actual: { pallets: actualPallets, weight: actualWeight }, variance: { pallets: palletVariance, weight: weightVariance } }).catch(() => {}),
        saveToGoogleSheets({ soNumber: `SO${soNumber}`, validatedBy, notes, predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight }, actual: { pallets: actualPallets, weight: actualWeight }, variance: { pallets: palletVariance, weight: weightVariance } }).catch(() => {})
      ]);
    }

    // 7. Response
    return res.status(200).json({
      success: true,
      validationId,
      soNumber: `SO${soNumber}`,
      skipSave,
      predicted: {
        pallets: prediction.totalPallets,
        weight: prediction.totalWeight,
        breakdown: prediction.breakdown
      },
      prediction: {
        totalPallets: prediction.totalPallets,
        totalWeight: prediction.totalWeight,
        breakdown: prediction.breakdown
      },
      predicted_pallets: prediction.totalPallets,
      predicted_weight: prediction.totalWeight,
      predicted_breakdown: prediction.breakdown,
      actual: { pallets: actualPallets, weight: actualWeight, dimensions: pallets },
      variance: {
        pallets: palletVariance,
        weight: weightVariance,
        palletAccurate: palletVariance === 0,
        withinOnePallet: absDelta <= 1,
        severity,
      },
      diagnostics: prediction.diagnostics,
      items: soData.items
    });

  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
