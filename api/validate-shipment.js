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
  '80301-0254-GAV', // DD lower track extension legacy
  '80301-0254-BLK13',
]);

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

function predictPallets(items) {
  // With the pick ticket filter (fulfillable=T, assemblyComponent=F),
  // items are already pre-filtered by NetSuite. We now split by kitComponent:
  // - kitComponent=false → product-level items (what we predict pallets for)
  // - kitComponent=true → kit sub-components (ship inside kit parents, no extra pallets)

  const diagnostics = {
    totalLines: items.length,
    filteredNonShippable: 0,
    filteredHardware: 0,
    filteredPackaging: 0,
    filteredComponents: 0,
    knownProducts: 0,
    unknownProducts: 0,
    unknownSkus: [],
  };

  // STEP 1: Classify and aggregate product-level items
  const aggregated = {};
  for (const item of items) {
    if (!item.qty || item.qty === 0) {
      diagnostics.filteredNonShippable++;
      continue;
    }

    // Kit components (manifolds, slides, legs, individual hardware) ship
    // inside their kit parents — don't count separately for pallets
    if (item.kitComponent) {
      diagnostics.filteredComponents++;
      continue;
    }

    // Lightweight classification for remaining edge cases
    // (SuiteQL filter already removed ~80% of noise)
    const classification = classifyItem(item.sku, item.name, new Set());
    if (classification === 'non_shippable') { diagnostics.filteredNonShippable++; continue; }
    if (classification === 'hardware') { diagnostics.filteredHardware++; continue; }
    if (classification === 'packaging') { diagnostics.filteredPackaging++; continue; }
    if (classification === 'component_of_parent') { diagnostics.filteredComponents++; continue; }

    // Normalize SKU for aggregation
    const skuKey = (item.sku || 'UNKNOWN').toUpperCase().trim();
    if (!aggregated[skuKey]) {
      aggregated[skuKey] = { sku: item.sku, name: item.name, qty: 0 };
    }
    aggregated[skuKey].qty += item.qty;
  }

  // STEP 2: Calculate pallets per aggregated product
  let totalPallets = 0;
  let totalWeight = 0;
  const breakdown = [];

  for (const item of Object.values(aggregated)) {
    const skuUpper = (item.sku || '').toUpperCase().trim();

    // Ride-along items should never force their own pallet; they piggyback on order pallets
    if (RIDE_ALONG_SKUS.has(skuUpper)) {
      diagnostics.filteredHardware++;
      continue;
    }

    const product = lookupProduct(item.sku);
    let pallets, weight, matched;

    if (product) {
      diagnostics.knownProducts++;
      matched = product.family;
      const upp = SKU_UNITS_PER_PALLET[skuUpper] || UNITS_PER_PALLET[product.family] || 10;
      const wpu = product.weight || 50;

      if (product.family === 'Double Docker') {
        // Detect bike count from SKU pattern:
        // Group parents: DD-SS-04-GAV (contains '04'), DD-SS-06-GAV (contains '06')
        // Kit parents: 80101-0257-GAV-KIT (0257=4-bike), 80101-0258-GAV-KIT (0258=6-bike)
        const skuLower = (item.sku || '').toLowerCase();
        let bikeCount = 4; // default
        if (skuLower.includes('06') || skuLower.includes('0258')) {
          bikeCount = 6;
        }
        const dd = estimateDDPallets(item.qty, bikeCount);
        pallets = dd.total;
        weight = item.qty * wpu;

        // Push component-level breakdown for DD
        totalPallets += pallets;
        totalWeight += weight;
        const trayWeight = Math.round(weight * 0.5);
        const legWeight = Math.round(weight * 0.3);
        const manifoldWeight = Math.round(weight * 0.2);
        breakdown.push({
          sku: item.sku, name: `${item.name} — Trays`,
          qty: item.qty * 2, pallets: dd.trays,
          weight: trayWeight, matched: 'Double Docker',
        });
        breakdown.push({
          sku: item.sku, name: `${item.name} — Legs`,
          qty: item.qty, pallets: dd.legs,
          weight: legWeight, matched: 'Double Docker',
        });
        breakdown.push({
          sku: item.sku, name: `${item.name} — Manifolds`,
          qty: item.qty, pallets: dd.manifolds,
          weight: manifoldWeight, matched: 'Double Docker',
        });
        continue; // skip the generic push below
      } else {
        // Locker crate approximations from warehouse guidance:
        // VISI2/MBV2 are 3-box systems, VISI1/MBV1 are 2-box systems.
        // Chad guidance: ~15 mixed boxes per large crate (tetris packed).
        const skuLower = (item.sku || '').toLowerCase();
        if (skuLower.includes('89901-0418') || skuLower.includes('89901-0408')) {
          pallets = Math.ceil((item.qty * 3) / 15); // ~5 units per crate
        } else if (skuLower.includes('89901-0417') || skuLower.includes('89901-0407')) {
          pallets = Math.ceil((item.qty * 2) / 15); // ~7.5 units per crate
        } else {
          pallets = Math.ceil(item.qty / upp);
        }
        weight = item.qty * wpu;
      }
    } else {
      // Unknown SKU fallback with explicit warehouse overrides first
      const overrideUpp = SKU_UNITS_PER_PALLET[skuUpper];
      if (overrideUpp) {
        diagnostics.knownProducts++;
        matched = 'SKU_OVERRIDE';
        pallets = Math.ceil(item.qty / overrideUpp);
        weight = item.qty * 50;
      } else {
        diagnostics.unknownProducts++;
        diagnostics.unknownSkus.push(item.sku);
        matched = null;
        pallets = Math.ceil(item.qty / 10);
        weight = item.qty * 25;
      }
    }

    totalPallets += pallets;
    totalWeight += weight;
    breakdown.push({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      pallets,
      weight: Math.round(weight),
      matched: matched || 'UNKNOWN',
    });
  }

  const productLines = diagnostics.knownProducts + diagnostics.unknownProducts;
  const confidenceScore = productLines > 0
    ? Math.round((diagnostics.knownProducts / productLines) * 100)
    : 100; // No products = nothing to be wrong about
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

  // Pick ticket filter: only items that appear on physical pick tickets
  // fulfillable=T excludes Group headers, services, shipping
  // assemblyComponent=F excludes BOM components (raw materials, coating services)
  // itemType filter excludes non-physical line types
  const itemsQuery = `
    SELECT i.itemid AS sku, i.displayname AS name, tl.quantity,
           tl.kitComponent, tl.itemType
    FROM transactionline tl
    LEFT JOIN item i ON i.id = tl.item
    WHERE tl.transaction = ${soId}
      AND tl.mainLine = 'F'
      AND tl.item IS NOT NULL
      AND tl.fulfillable = 'T'
      AND tl.assemblyComponent = 'F'
      AND tl.itemType NOT IN ('Service', 'ShipItem', 'TaxGroup')
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
