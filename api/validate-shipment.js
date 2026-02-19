const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const { createClient } = require('@supabase/supabase-js');
const { sendValidationEmail, saveToGoogleSheets } = require('./lib/notifications');
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
// (these are manufacturing intermediates / unassembled parts, never finished goods)
const ALWAYS_SUPPRESS_PREFIXES = [
  '80301-0088', '80301-0287',  // Varsity DV215 unassembled parts
  '80101-0088', '80101-0287',  // Varsity assembled sub-parts
  '80101-0050',                 // DD sub-part
  '80301-0250', '80301-0252', '80301-0253', '80301-0257', '80301-0258', // DD manifold/rail parts
  '80101-0257', '80101-0258',  // DD kit parts
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
    'dd-ss-04': 'Double Docker', 'dd-ss-06': 'Double Docker',
    'dd-ds-04': 'Double Docker', 'dd-ds-06': 'Double Docker',
    '90101-2287': 'Varsity', '90101-0172': 'VR2 Offset',
    'vr-vr2': 'VR2 Offset',
    '89901-2050': 'Dismount', '89901-121': 'Skatedock',
    'sm10x': 'Skatedock', 'sd6x': 'Skatedock',
    '80101-1210': 'Skatedock',
    'ss120': 'Base Station', 'ss95': 'Base Station', 'ss66': 'Base Station', 'ss38': 'Base Station',
    'cs120': 'Base Station', 'cs95': 'Base Station', 'cs66': 'Base Station', 'cs38': 'Base Station',
    'ssa': 'Base Station', 'csa': 'Base Station',
    '80301-0166': 'Hoop Runner', '80301-0151': 'Circle Series (Omega)',
    '89901-0163': 'Hoop Runner', '80101-0163': 'Hoop Runner',
    'visi2': 'Metal Bike Vault / VisiLocker', 'mbv2': 'Metal Bike Vault / VisiLocker',
    '89901-0418': 'Metal Bike Vault / VisiLocker',
    'mbv1': 'MBA', '89901-0407': 'MBA',
    '80101-0370': 'Undergrad', '80101-0363': 'Undergrad', '80101-0364': 'Undergrad',
    '80101-0365': 'Undergrad', '80101-0366': 'Undergrad', '80101-0368': 'Undergrad',
    '80101-0281': '2UP',
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
  'Skatedock': 16, 'Dismount': 15, 'Base Station': 6,
  'Wave Runner': 4, 'Circle Series (Omega)': 10,
  'Metal Bike Vault / VisiLocker': 2, 'MBA': 2,
  'Pump & Repair': 10, 'Cane Detection': 10, '2UP': 24,
  'Strut Install Kit': 20, 'Saris': 10, 'Fiberglass Bike Vault': 2,
  'Radius': 6, 'Guardian': 6,
};

function estimateDDPallets(qty, bikeCount) {
  if (bikeCount === 4) {
    return Math.ceil((qty * 2) / 21) + Math.ceil(qty / 32) + Math.ceil(qty / 40);
  } else if (bikeCount === 6) {
    return Math.ceil((qty * 2) / 14) + Math.ceil(qty / 20) + Math.ceil(qty / 30);
  }
  return Math.ceil(qty * 4 / 10);
}

function predictPallets(items) {
  // Identify parent products on the order
  const orderHasParents = new Set();
  for (const item of items) {
    const skuLower = (item.sku || '').toLowerCase();
    for (const parentPrefix of Object.keys(COMPONENT_SUPPRESSION)) {
      if (skuLower.startsWith(parentPrefix) || skuLower.includes(parentPrefix)) {
        orderHasParents.add(parentPrefix);
      }
    }
  }

  // STEP 1: Classify and aggregate by SKU
  // Multiple fulfillment lines for the same SKU get combined
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

  const aggregated = {};
  for (const item of items) {
    if (!item.qty || item.qty === 0) {
      diagnostics.filteredNonShippable++;
      continue;
    }

    const classification = classifyItem(item.sku, item.name, orderHasParents);
    if (classification === 'non_shippable') { diagnostics.filteredNonShippable++; continue; }
    if (classification === 'hardware') { diagnostics.filteredHardware++; continue; }
    if (classification === 'packaging') { diagnostics.filteredPackaging++; continue; }
    if (classification === 'component_of_parent') { diagnostics.filteredComponents++; continue; }

    // Normalize SKU for aggregation (strip parenthetical suffixes)
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
    const product = lookupProduct(item.sku);
    let pallets, weight, matched;

    if (product) {
      diagnostics.knownProducts++;
      matched = product.family;
      const upp = UNITS_PER_PALLET[product.family] || 10;
      const wpu = product.weight || 50;

      if (product.family === 'Double Docker') {
        const bikeCount = (item.sku || '').includes('04') ? 4 : 6;
        pallets = estimateDDPallets(item.qty, bikeCount);
        weight = item.qty * wpu;
      } else {
        pallets = Math.ceil(item.qty / upp);
        weight = item.qty * wpu;
      }
    } else {
      diagnostics.unknownProducts++;
      diagnostics.unknownSkus.push(item.sku);
      matched = null;
      pallets = Math.ceil(item.qty / 10);
      weight = item.qty * 25;
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

  const itemsQuery = `
    SELECT i.itemid AS sku, i.displayname AS name, tl.quantity
    FROM transactionline tl
    LEFT JOIN item i ON i.id = tl.item
    WHERE tl.transaction = ${soId} AND tl.mainline = 'F' AND tl.item IS NOT NULL
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
    qty: Math.abs(parseInt(row.quantity, 10) || 0)
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
    const { soNumber, pallets, validatedBy, notes } = req.body;
    console.log('=== VALIDATE SO' + soNumber + ' ===');

    if (!soNumber || !pallets || !validatedBy) {
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

    // 5. Save to Supabase
    let validationId = null;
    if (supabase) {
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
    Promise.all([
      sendValidationEmail({ soNumber: `SO${soNumber}`, validatedBy, notes, predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight }, actual: { pallets: actualPallets, weight: actualWeight }, variance: { pallets: palletVariance, weight: weightVariance } }).catch(() => {}),
      saveToGoogleSheets({ soNumber: `SO${soNumber}`, validatedBy, notes, predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight }, actual: { pallets: actualPallets, weight: actualWeight }, variance: { pallets: palletVariance, weight: weightVariance } }).catch(() => {})
    ]);

    // 7. Response
    return res.status(200).json({
      success: true,
      validationId,
      soNumber: `SO${soNumber}`,
      predicted: {
        pallets: prediction.totalPallets,
        weight: prediction.totalWeight,
        breakdown: prediction.breakdown
      },
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
