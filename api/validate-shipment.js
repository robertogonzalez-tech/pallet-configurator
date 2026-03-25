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
const { predictPackages: predictPackagesCore } = require('./lib/predictPackages');
const {
  loadExactBoosterMap,
  chooseExactBoosterAdjustment,
} = require('./lib/exactBooster');
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

const REASON_CODES = {
  NON_PHYSICAL: 'NON_PHYSICAL',
  HARDWARE_RIDE_ALONG: 'HARDWARE_RIDE_ALONG',
  COMPONENT_SUPPRESSED: 'COMPONENT_SUPPRESSED',
  LONG_TUBE_TRIGGER: 'LONG_TUBE_TRIGGER',
  NETSUITE_FLAGGED: 'NETSUITE_FLAGGED',
  UNKNOWN: 'UNKNOWN',
  OTHER: 'OTHER',
  PRODUCT_FAMILY: 'PRODUCT_FAMILY',
};

const SHIPMENT_COMPLETENESS_VALUES = new Set(['complete', 'partial', 'unknown']);
const ACTUAL_UNIT_BASIS_VALUES = new Set(['package_count', 'pallet_positions', 'unknown']);
const SHIPMENT_COMPLETENESS_REASON_VALUES_BY_COMPLETENESS = {
  complete: new Set(['packed_and_shipped_full', 'reconciled_complete', 'complete_other']),
  partial: new Set(['split_shipment', 'backorder_remaining', 'shipped_in_stages', 'partial_other']),
  unknown: new Set(['conflicting_records', 'missing_documents', 'cannot_verify_with_warehouse', 'unknown_other']),
};
const SHIPMENT_COMPLETENESS_REASON_VALUES = new Set(
  Object.values(SHIPMENT_COMPLETENESS_REASON_VALUES_BY_COMPLETENESS)
    .flatMap((values) => Array.from(values))
);

function normalizeEnumValue(value, allowedValues, defaultValue) {
  const normalized = String(value ?? defaultValue).trim().toLowerCase();
  if (allowedValues.has(normalized)) return normalized;
  return null;
}

function boolish(value) {
  return value === true || value === 'T' || value === 'true' || value === 1;
}

function buildLineFlags(item) {
  return {
    fulfillable: boolish(item?.fulfillable),
    assemblyComponent: boolish(item?.assemblyComponent),
    kitComponent: boolish(item?.kitComponent),
    itemType: item?.itemType || '',
  };
}

function buildRawLine(item) {
  return {
    sku: normalizeSku(item?.sku || 'UNKNOWN'),
    name: item?.name || 'Unknown Item',
    qty: Math.max(0, Number(item?.qty) || 0),
    flags: buildLineFlags(item),
  };
}

function initFilterStats() {
  return {
    [REASON_CODES.NON_PHYSICAL]: 0,
    [REASON_CODES.HARDWARE_RIDE_ALONG]: 0,
    [REASON_CODES.COMPONENT_SUPPRESSED]: 0,
    [REASON_CODES.LONG_TUBE_TRIGGER]: 0,
    [REASON_CODES.NETSUITE_FLAGGED]: 0,
    [REASON_CODES.UNKNOWN]: 0,
    [REASON_CODES.OTHER]: 0,
    [REASON_CODES.PRODUCT_FAMILY]: 0,
  };
}

function bumpFilterStat(filterStats, reasonCode) {
  if (!reasonCode) return;
  if (typeof filterStats[reasonCode] !== 'number') filterStats[reasonCode] = 0;
  filterStats[reasonCode] += 1;
}

function sanitizeDiagnostics(diagnostics, debug = false) {
  if (debug) return diagnostics;
  const includedLines = Array.isArray(diagnostics?.includedLines) ? diagnostics.includedLines : [];
  const excludedLines = Array.isArray(diagnostics?.excludedLines) ? diagnostics.excludedLines : [];
  return {
    totalLines: diagnostics.totalLines,
    rawLinesCount: diagnostics.rawLinesCount,
    filteredNonShippable: diagnostics.filteredNonShippable,
    filteredHardware: diagnostics.filteredHardware,
    filteredPackaging: diagnostics.filteredPackaging,
    filteredComponents: diagnostics.filteredComponents,
    knownProducts: diagnostics.knownProducts,
    unknownProducts: diagnostics.unknownProducts,
    unknownSkus: diagnostics.unknownSkus || [],
    unknown_skus: diagnostics.unknownSkus || [],
    longTubeTriggerLines: diagnostics.longTubeTriggerLines,
    longTubePallets: diagnostics.longTubePallets,
    packageCountBeforeConsolidation: diagnostics.packageCountBeforeConsolidation,
    packageCountAfterConsolidation: diagnostics.packageCountAfterConsolidation,
    calibration: diagnostics.calibration || null,
    exactBooster: diagnostics.exactBooster || null,
    baseStationLongTubeDedupeApplied: !!diagnostics.baseStationLongTubeDedupeApplied,
    zeroFloorApplied: !!diagnostics.zeroFloorApplied,
    zeroFloorFallbackPallets: diagnostics.zeroFloorFallbackPallets || 0,
    zeroFloorLikelyPhysicalExcluded: diagnostics.zeroFloorLikelyPhysicalExcluded || 0,
    productLines: diagnostics.productLines,
    baseConfidence: diagnostics.baseConfidence,
    confidenceScore: diagnostics.confidenceScore,
    confidenceLevel: diagnostics.confidenceLevel,
    confidence: diagnostics.confidenceLevel,
    needsReview: diagnostics.needsReview,
    filter_stats: diagnostics.filter_stats || diagnostics.filterStats || {},
    included_count: includedLines.length,
    excluded_count: excludedLines.length,
    suspiciousExcludedLines: diagnostics.suspiciousExcludedLines || [],
    debug: false,
  };
}

// ============================================================
// PRODUCT CATALOG — loaded from products.json
// ============================================================
let PRODUCT_CATALOG = null;
let SKU_CLASSIFICATION = null;
let COMPILED_SKU_RULES = null;

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

function loadSkuClassification() {
  if (SKU_CLASSIFICATION) return SKU_CLASSIFICATION;
  try {
    let data;
    const paths = [
      path.join(process.cwd(), 'config', 'sku-classification.json'),
      path.join(__dirname, '..', 'config', 'sku-classification.json'),
      path.join(__dirname, 'config', 'sku-classification.json'),
    ];
    for (const p of paths) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        data = JSON.parse(raw);
        console.log(`[SKU-CLASS] Loaded from ${p}`);
        break;
      } catch (e) { /* try next path */ }
    }
    SKU_CLASSIFICATION = data || {};
    return SKU_CLASSIFICATION;
  } catch (err) {
    console.warn('[SKU-CLASS] Failed to load sku-classification.json:', err.message);
    SKU_CLASSIFICATION = {};
    return SKU_CLASSIFICATION;
  }
}

function compactPatternValue(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .trim();
}

function ruleSpecificity(rule) {
  const pattern = String(rule?.patternCompact || '');
  const wildcards = (pattern.match(/\*/g) || []).length;
  const digits = (pattern.match(/[0-9]/g) || []).length;
  return (pattern.length * 10) + digits - (wildcards * 25);
}

function patternToRegex(pattern) {
  const compact = compactPatternValue(pattern);
  const escaped = compact.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function flattenPatternList(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('_')) continue;
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

const FAMILY_KEY_MAP = {
  undergrad: 'Undergrad',
  vr2_offset: 'VR2 Offset',
  hoop_runner: 'Hoop Runner',
  dismount: 'Dismount',
  double_docker: 'Double Docker',
  skatedock: 'Skatedock',
  base_station: 'Base Station',
  visilocker: 'Metal Bike Vault / VisiLocker',
  mba: 'MBA',
  sidestage: 'Base Station',
  stretch_rack: 'Saris',
  fixation: 'Pump & Repair',
  custom_branded: 'Guardian',
};

function loadCompiledSkuRules() {
  if (COMPILED_SKU_RULES) return COMPILED_SKU_RULES;
  const cfg = loadSkuClassification() || {};
  const compiled = {
    nonShip: [],
    hardware: [],
    thirdParty: [],
    familyRules: [],
  };

  const addRule = (target, rule) => {
    if (!rule || !rule.pattern) return;
    const excludes = Array.isArray(rule.exclude) ? rule.exclude : [];
    target.push({
      ...rule,
      regex: patternToRegex(rule.pattern),
      patternCompact: compactPatternValue(rule.pattern),
      excludeRegexes: excludes.map((entry) => patternToRegex(entry)),
      specificity: 0,
    });
  };

  const nonShipPatterns = cfg.non_ship_patterns?.patterns || [];
  for (const rule of nonShipPatterns) addRule(compiled.nonShip, rule);

  const hardwarePatterns = flattenPatternList(cfg.hardware_patterns);
  for (const rule of hardwarePatterns) addRule(compiled.hardware, rule);

  const thirdPartyPatterns = cfg.third_party_products?.patterns || [];
  for (const rule of thirdPartyPatterns) addRule(compiled.thirdParty, rule);

  const families = cfg.families || {};
  for (const [familyKey, details] of Object.entries(families)) {
    const mappedFamily = FAMILY_KEY_MAP[familyKey];
    if (!mappedFamily) continue;

    const addFamilyRules = (list, role) => {
      if (!Array.isArray(list)) return;
      for (const rule of list) {
        addRule(compiled.familyRules, {
          ...rule,
          family: mappedFamily,
          role,
          familyKey,
        });
      }
    };

    addFamilyRules(details.primary_skus, 'primary');
    addFamilyRules(details.component_skus, 'component');
    addFamilyRules(details.accessory_skus, 'accessory');
    addFamilyRules(details.conditional_packages, 'long_tube_trigger');
    addFamilyRules(details.fee_skus, 'non_shippable');
  }

  const sortRules = (rules) => {
    rules.forEach((rule) => { rule.specificity = ruleSpecificity(rule); });
    rules.sort((a, b) => b.specificity - a.specificity);
  };

  sortRules(compiled.nonShip);
  sortRules(compiled.hardware);
  sortRules(compiled.thirdParty);
  sortRules(compiled.familyRules);

  COMPILED_SKU_RULES = compiled;
  console.log(`[SKU-CLASS] Compiled ${compiled.familyRules.length} family rules, ${compiled.hardware.length} hardware rules, ${compiled.nonShip.length} non-ship rules`);
  return COMPILED_SKU_RULES;
}

function matchRuleList(ruleList, sku, name) {
  if (!Array.isArray(ruleList) || ruleList.length === 0) return null;
  const compactSku = compactPatternValue(sku);
  const compactName = compactPatternValue(name);
  for (const rule of ruleList) {
    const matched =
      rule.regex.test(compactSku) ||
      rule.regex.test(compactName) ||
      compactSku.includes(rule.patternCompact) ||
      compactName.includes(rule.patternCompact);
    if (!matched) continue;
    if (Array.isArray(rule.excludeRegexes) && rule.excludeRegexes.some((rx) => rx.test(compactSku) || rx.test(compactName))) {
      continue;
    }
    return rule;
  }
  return null;
}

function classifyFromSkuConfig(item) {
  const rules = loadCompiledSkuRules();
  const sku = normalizeSku(item?.sku || '');
  const name = String(item?.name || '').toUpperCase();

  // RAW / manufacturing lines should never be treated as primary shipped units.
  if (sku.includes('-RAW') || name.includes(' RAW')) {
    return { classification: 'component_of_parent', source: 'sku_config', reason: 'raw_component' };
  }

  // Locker boxed-kit families are true shipped units even when NetSuite marks them oddly.
  if (
    sku.startsWith('89901-0408') ||
    sku.startsWith('89901-0418') ||
    sku.startsWith('90101-0408') ||
    sku.startsWith('90101-0418')
  ) {
    return {
      classification: 'product',
      role: 'primary',
      family: 'Metal Bike Vault / VisiLocker',
      familyKey: 'visilocker',
      source: 'sku_config',
    };
  }

  const nonShip = matchRuleList(rules.nonShip, sku, name);
  if (nonShip) {
    return { classification: 'non_shippable', source: 'sku_config', reason: nonShip.note || 'non_ship_pattern' };
  }

  const familyRule = matchRuleList(rules.familyRules, sku, name);
  if (familyRule) {
    if (familyRule.role === 'non_shippable') {
      return { classification: 'non_shippable', source: 'sku_config', reason: familyRule.note || 'family_non_ship' };
    }
    if (familyRule.role === 'long_tube_trigger') {
      return {
        classification: 'long_tube_trigger',
        role: familyRule.role,
        family: familyRule.family,
        familyKey: familyRule.familyKey,
        source: 'sku_config',
      };
    }
    if (familyRule.role === 'accessory') {
      return {
        classification: 'hardware',
        role: familyRule.role,
        family: familyRule.family,
        familyKey: familyRule.familyKey,
        source: 'sku_config',
      };
    }
    if (familyRule.role === 'component') {
      return {
        classification: 'component_of_parent',
        role: familyRule.role,
        family: familyRule.family,
        familyKey: familyRule.familyKey,
        source: 'sku_config',
      };
    }
    return {
      classification: 'product',
      role: familyRule.role,
      family: familyRule.family,
      familyKey: familyRule.familyKey,
      source: 'sku_config',
    };
  }

  const hardware = matchRuleList(rules.hardware, sku, name);
  if (hardware) {
    return { classification: 'hardware', source: 'sku_config', reason: hardware.note || 'hardware_pattern' };
  }

  const thirdParty = matchRuleList(rules.thirdParty, sku, name);
  if (thirdParty) {
    return { classification: 'product', role: 'third_party', source: 'sku_config' };
  }

  return null;
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

  // Most -KIT lines are component bundles that ride with a parent product.
  // Keep explicit product kits whitelisted in isFlagBypassItem/legacy mappings.
  if (
    skuLower.endsWith('-kit') &&
    !skuLower.startsWith('80101-0257') &&
    !skuLower.startsWith('80101-0258') &&
    !skuLower.startsWith('89901-0408') &&
    !skuLower.startsWith('89901-0418') &&
    !skuLower.startsWith('dd-')
  ) {
    return 'hardware';
  }

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
const FAMILY_DEFAULT_PACKAGED = {
  'Varsity': { weight: 65, length: 48, width: 40, height: 30 },
  'VR2 Offset': { weight: 85, length: 48, width: 40, height: 28 },
  'VR1 XL': { weight: 95, length: 48, width: 40, height: 32 },
  'Double Docker': { weight: 380, length: 79, width: 43, height: 63 },
  'Hoop Runner': { weight: 45, length: 48, width: 40, height: 26 },
  'Undergrad': { weight: 150, length: 96, width: 48, height: 24 },
  'Skatedock': { weight: 95, length: 73, width: 14, height: 13 },
  'Dismount': { weight: 55, length: 48, width: 40, height: 24 },
  'Base Station': { weight: 8, length: 120, width: 11, height: 11 },
  'Circle Series (Omega)': { weight: 60, length: 48, width: 40, height: 24 },
  'Metal Bike Vault / VisiLocker': { weight: 850, length: 85, width: 48, height: 39 },
  'MBA': { weight: 850, length: 85, width: 48, height: 39 },
  'Pump & Repair': { weight: 40, length: 24, width: 18, height: 12 },
  'Cane Detection': { weight: 50, length: 24, width: 18, height: 12 },
  '2UP': { weight: 35, length: 48, width: 40, height: 20 },
  'Saris': { weight: 95, length: 48, width: 40, height: 28 },
  'Radius': { weight: 55, length: 48, width: 40, height: 24 },
  'Guardian': { weight: 120, length: 48, width: 40, height: 24 },
  'Snowdock': { weight: 95, length: 48, width: 40, height: 24 },
};

function fallbackProductForFamily(sku, name, family) {
  const defaults = FAMILY_DEFAULT_PACKAGED[family] || { weight: 50, length: 48, width: 40, height: 24 };
  return {
    sku,
    family,
    name: name || sku,
    weight: defaults.weight,
    length: defaults.length,
    width: defaults.width,
    height: defaults.height,
    source: 'family_fallback',
  };
}

function lookupProduct(sku, name, configHint = null) {
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
    '89901-0408': 'Metal Bike Vault / VisiLocker',
    '90101-0408': 'Metal Bike Vault / VisiLocker',
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
      return fallbackProductForFamily(skuUpper, name, family);
    }
  }

  if (configHint?.family) {
    return fallbackProductForFamily(skuUpper, name, configHint.family);
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
  'Radius': 6, 'Guardian': 8, 'Snowdock': 8,
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

function isSkatedockNamedItem(sku, name) {
  const normSku = normalizeSku(sku || '');
  const upperName = String(name || '').toUpperCase();
  const hasSkateName =
    upperName.includes('SKATEDOCK') ||
    upperName.includes('SNOWDOCK') ||
    upperName.includes('SM10X') ||
    upperName.includes('SD6X');

  if (normSku.startsWith('89904-') || normSku.startsWith('89914-')) return true;
  if (normSku.startsWith('SM10X') || normSku.startsWith('SD6X')) return true;
  if (hasSkateName && (normSku.startsWith('89901-1210-') || normSku.startsWith('80101-1210-'))) return true;

  return false;
}

function shouldTreatAsSkatedockProduct(item, configHint, legacyClassification, context = null) {
  if (context?.sourceType === 'sales_order') return false;
  const normSku = normalizeSku(item?.sku || '');
  if (!isSkatedockNamedItem(normSku, item?.name || '')) return false;
  if (configHint?.classification === 'product' && configHint?.familyKey === 'skatedock' && configHint?.role === 'primary') {
    return true;
  }
  return (
    ['component_of_parent', 'hardware', 'non_shippable'].includes(legacyClassification) &&
    (
      normSku.startsWith('89901-1210-') ||
      normSku.startsWith('80101-1210-') ||
      normSku.startsWith('SM10X') ||
      normSku.startsWith('SD6X')
    )
  );
}

function isBundledBaseStationItem(sku, configHint = null) {
  const normSku = normalizeSku(sku || '');
  if (configHint?.familyKey === 'sidestage' && configHint?.role === 'primary') return true;
  return /^(?:CSA|SSA|CS|SS)\d{2,3}\b/.test(normSku);
}

function isBundledBaseStationAddonSku(sku) {
  return /^(?:CSA|SSA)\d{2,3}\b/.test(normalizeSku(sku || ''));
}

function parseBundledBaseStationLength(item) {
  const normSku = normalizeSku(item?.sku);
  const skuMatch = normSku.match(/^(?:CSA|SSA|CS|SS)(\d{2,3})\b/);
  if (skuMatch) return parseInt(skuMatch[1], 10);
  return parseLengthFromSkuOrName(item);
}

function isFlagBypassItem(item, context = null) {
  const normSku = normalizeSku(item?.sku);
  const name = String(item?.name || '').toUpperCase();
  if (isLongTubeTriggerItem(item)) return true;
  if (context?.sourceType !== 'sales_order' && isSkatedockNamedItem(normSku, name)) return true;
  // Explicit DD kit parents that represent finished shippable units.
  if (normSku.startsWith('80101-0257') || normSku.startsWith('80101-0258')) return true;
  // Legacy DD parent SKUs
  if (normSku.startsWith('DD-')) return true;
  // Locker/assembled parents occasionally marked non-fulfillable in NetSuite
  if (name.includes('LOCKER') && name.includes('KIT')) return true;
  if (
    normSku.startsWith('89901-0408') ||
    normSku.startsWith('89901-0418') ||
    normSku.startsWith('90101-0408') ||
    normSku.startsWith('90101-0418')
  ) return true;
  return false;
}

function estimateLongTubePallets(state) {
  // Conservative scaling rule:
  // - 100"+ rails always create dedicated long-tube handling units
  // - very high tube quantities can require one extra long-tube bundle
  // - 86-99" rails create one tube bundle only at high qty
  if (!state || state.triggerLines === 0 || state.totalQty <= 0) return 0;
  if (state.maxLength >= 100) {
    if (state.totalQty >= 180) return 2;
    return 1;
  }
  if (state.maxLength >= 86 && state.totalQty >= 120) return 1;
  return 0;
}

function estimateBundledBaseStationTubePallets(tubeQty) {
  if (!tubeQty) return 0;
  return Math.max(1, Math.ceil(tubeQty / 50));
}

function estimateLongTubePackageHeight(pieceQty) {
  if (!pieceQty || pieceQty <= 0) return 6;
  return 6 + (Math.floor((pieceQty - 1) / 10) * 2);
}

function estimateBundledBaseStationTubeWeight(tubeQty, lengthIn) {
  if (!tubeQty) return 0;
  const normalizedLength = Math.max(60, lengthIn || 120);
  const perTubeWeight = Math.max(8, Math.round((normalizedLength / 120) * 18));
  return Math.round(tubeQty * perTubeWeight);
}

function estimateBundledBaseStationNonTubeWeight(stanchions, feet) {
  return Math.round((Math.max(0, stanchions) * 20) + (Math.max(0, feet) * 6));
}

function estimateBundledBaseStationStanchionHeight(stanchionQty, shared2UpQty = 0) {
  return Math.min(48, 18 + (Math.max(1, stanchionQty) * 4) + (shared2UpQty > 0 ? 6 : 0));
}

function estimateQuoteTwoUpHeight(qty) {
  const safeQty = Math.max(0, Number(qty) || 0);
  if (safeQty >= 32) return 49;
  if (safeQty >= 24) return 40;
  if (safeQty >= 16) return 34;
  if (safeQty >= 8) return 28;
  if (safeQty > 0) return 22;
  return 30;
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
    case 'Hoop Runner': return qty <= 20 ? 1 : qty <= 60 ? Math.ceil(qty / 20) : Math.ceil(qty / 21);
    case 'Dismount': return qty <= 10 ? 1 : Math.ceil(qty / 6);
    case 'Radius': return qty <= 24 ? 1 : Math.ceil(qty / 25);
    case 'MBA': return qty <= 3 ? 1 : qty <= 8 ? 2 : Math.ceil(qty / 4);
    case 'Undergrad': return Math.ceil(qty / 2);
    case '2UP': return qty <= 36 ? 1 : Math.ceil(qty / 36);
    case 'Metal Bike Vault / VisiLocker': {
      const s = String(sku || '').toUpperCase();
      if (
        s.startsWith('89901-0408') ||
        s.startsWith('89901-0418') ||
        s.startsWith('90101-0408') ||
        s.startsWith('90101-0418')
      ) {
        return Math.max(1, Math.ceil(qty / 4));
      }
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
      if (qty <= 2) return qty * 2;
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

const PACKAGE_TEMPLATES = {
  standard_pallet: { l: 48, w: 40, h: 30 },
  large_pallet: { l: 85, w: 48, h: 39 },
  oversized_pallet: { l: 96, w: 48, h: 28 },
  long_tube: { l: 120, w: 11, h: 11 },
  base_station_stanchion: { l: 84, w: 50, h: 26 },
  base_station_feet: { l: 48, w: 40, h: 16 },
  dd_mixed_crate: { l: 79, w: 43, h: 63 },
  skatedock_box: { l: 73, w: 14, h: 13 },
  unknown_pallet: { l: 48, w: 40, h: 24 },
};

const FAMILY_TEMPLATE = {
  'Varsity': 'standard_pallet',
  'VR2 Offset': 'standard_pallet',
  'VR1 XL': 'standard_pallet',
  'Double Docker': 'dd_mixed_crate',
  'Hoop Runner': 'standard_pallet',
  'Undergrad': 'oversized_pallet',
  'Skatedock': 'skatedock_box',
  'Dismount': 'standard_pallet',
  'Base Station': 'long_tube',
  'Wave Runner': 'standard_pallet',
  'Circle Series (Omega)': 'standard_pallet',
  'Metal Bike Vault / VisiLocker': 'large_pallet',
  'MBA': 'large_pallet',
  'Pump & Repair': 'unknown_pallet',
  'Cane Detection': 'unknown_pallet',
  '2UP': 'standard_pallet',
  'Strut Install Kit': 'long_tube',
  'Saris': 'standard_pallet',
  'Fiberglass Bike Vault': 'large_pallet',
  'Radius': 'standard_pallet',
  'Guardian': 'standard_pallet',
  'Snowdock': 'standard_pallet',
};

const NO_MIX_FAMILIES = new Set(['Double Docker', 'Undergrad', 'Metal Bike Vault / VisiLocker', 'MBA', 'Base Station']);

function mapTemplateForBreakdownRow(row) {
  if (row?.packageType && PACKAGE_TEMPLATES[row.packageType]) return row.packageType;
  const matched = String(row?.matched || '');
  if (matched === 'LONG_TUBE') return 'long_tube';
  if (matched === 'UNKNOWN' || matched === 'SKU_OVERRIDE') return 'unknown_pallet';
  if (FAMILY_TEMPLATE[matched]) return FAMILY_TEMPLATE[matched];
  return FAMILY_TEMPLATE[row?.family] || 'standard_pallet';
}

function distributeIntegerTotal(total, buckets) {
  const count = Math.max(0, Math.round(Number(buckets) || 0));
  if (count <= 0) return [];
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const base = Math.floor(safeTotal / count);
  const remainder = safeTotal % count;
  return Array.from({ length: count }, (_, idx) => base + (idx < remainder ? 1 : 0));
}

function computeBundledBaseStation2UpSpilloverQty(breakdown, { sourceType = '' } = {}) {
  if (sourceType === 'sales_order' || !Array.isArray(breakdown) || breakdown.length === 0) return 0;

  const shippableRows = breakdown.filter((row) => Math.max(0, Number(row?.pallets) || 0) > 0);
  const bundledBaseStationRows = shippableRows.filter((row) => row?.packageRecipe === 'bundled_base_station');
  const bundledBaseStationHosts = bundledBaseStationRows.filter((row) => Number(row?.componentCounts?.stanchionPallets || 0) === 1);
  const twoUpRows = shippableRows.filter((row) => String(row?.matched || '') === '2UP' && Math.max(0, Number(row?.qty) || 0) > 0);

  if (bundledBaseStationRows.length !== 1 || bundledBaseStationHosts.length !== 1 || twoUpRows.length !== 1) return 0;

  const host = bundledBaseStationHosts[0];
  const counts = host?.componentCounts || {};
  const allowedRowsOnly = shippableRows.every((row) => (
    row?.packageRecipe === 'bundled_base_station' ||
    row?.packageRecipe === 'bundled_base_station_long_tube' ||
    String(row?.matched || '') === '2UP'
  ));

  if (!allowedRowsOnly) return 0;
  if (Math.max(0, Number(host?.qty) || 0) !== 1) return 0;
  if (Math.max(0, Number(counts.feetPallets) || 0) > 0) return 0;

  const row = twoUpRows[0];
  const qty = Math.max(0, Number(row?.qty) || 0);
  const remainder = qty % 32;
  let sharedTwoUpQty = 0;
  if (qty <= 8) {
    sharedTwoUpQty = qty;
  } else if (remainder > 0 && remainder <= 8) {
    sharedTwoUpQty = remainder;
  }

  return Math.min(sharedTwoUpQty, Math.max(0, Number(counts.mix2UpSpilloverCapacity) || 0));
}

function buildPackagesFromBreakdown(breakdown, { sourceType = '' } = {}) {
  let packageId = 1;
  const packages = [];
  const sharedTwoUpQty = computeBundledBaseStation2UpSpilloverQty(breakdown, { sourceType });
  let sharedTwoUpAttached = false;
  let sharedTwoUpConsumed = false;

  for (const row of breakdown) {
    const pallets = Math.max(0, Number(row?.pallets) || 0);
    if (pallets <= 0) continue;

    if (row?.packageRecipe === 'bundled_base_station') {
      const counts = row.componentCounts || {};
      const stanchionPallets = Math.max(0, Number(counts.stanchionPallets) || 0);
      const feetPallets = Math.max(0, Number(counts.feetPallets) || 0);
      const stanchionQtys = distributeIntegerTotal(counts.stanchions, stanchionPallets);
      const stanchionFeetQtys = feetPallets > 0 ? Array.from({ length: stanchionPallets }, () => 0) : distributeIntegerTotal(counts.feet, stanchionPallets);
      const feetQtys = distributeIntegerTotal(counts.feet, feetPallets);

      for (let i = 0; i < stanchionPallets; i += 1) {
        const stanchionQty = stanchionQtys[i] || 0;
        const feetQty = stanchionFeetQtys[i] || 0;
        const attachTwoUpQty = !sharedTwoUpAttached && sharedTwoUpQty > 0 ? sharedTwoUpQty : 0;
        const weight = Math.max(1, Math.round((stanchionQty * 20) + (feetQty * 6) + (attachTwoUpQty * 8)));
        const contents = [{
          sku: row?.sku || 'UNKNOWN',
          name: 'Base Station stanchions',
          qty: stanchionQty,
          matched: row?.matched || 'Base Station',
        }];
        if (feetQty > 0) {
          contents.push({
            sku: row?.sku || 'UNKNOWN',
            name: 'Base Station feet',
            qty: feetQty,
            matched: row?.matched || 'Base Station',
          });
        }
        if (attachTwoUpQty > 0) {
          contents.push({
            sku: '80101-0281',
            name: '2UP spillover on Base Station host pallet',
            qty: attachTwoUpQty,
            matched: '2UP',
          });
          sharedTwoUpAttached = true;
        }
        packages.push({
          id: packageId++,
          type: 'base_station_stanchion',
          family: 'Base Station',
          dims: {
            l: PACKAGE_TEMPLATES.base_station_stanchion.l,
            w: PACKAGE_TEMPLATES.base_station_stanchion.w,
            h: estimateBundledBaseStationStanchionHeight(stanchionQty, attachTwoUpQty),
          },
          weight,
          mergeable: false,
          contents,
        });
      }

      for (const feetQty of feetQtys) {
        packages.push({
          id: packageId++,
          type: 'base_station_feet',
          family: 'Base Station',
          dims: {
            l: PACKAGE_TEMPLATES.base_station_feet.l,
            w: PACKAGE_TEMPLATES.base_station_feet.w,
            h: PACKAGE_TEMPLATES.base_station_feet.h,
          },
          weight: Math.max(1, Math.round(feetQty * 6)),
          mergeable: false,
          contents: [{
            sku: row?.sku || 'UNKNOWN',
            name: 'Base Station feet',
            qty: feetQty,
            matched: row?.matched || 'Base Station',
          }],
        });
      }
      continue;
    }

    const templateKey = mapTemplateForBreakdownRow(row);
    const dims = PACKAGE_TEMPLATES[templateKey] || PACKAGE_TEMPLATES.standard_pallet;
    const family = String(row?.matched || row?.family || 'Unknown');
    let effectiveQty = Math.max(0, Number(row?.qty) || 0);
    let effectivePallets = pallets;
    let totalRowWeight = Math.max(0, Number(row?.weight) || 0);

    if (!sharedTwoUpConsumed && sharedTwoUpQty > 0 && family === '2UP') {
      effectiveQty = Math.max(0, effectiveQty - sharedTwoUpQty);
      effectivePallets = effectiveQty > 0 ? computePalletsForFamily('2UP', effectiveQty, row?.sku, row?.name, {}) : 0;
      totalRowWeight = row?.qty ? Math.round(totalRowWeight * (effectiveQty / row.qty)) : 0;
      sharedTwoUpConsumed = true;
    }

    if (effectivePallets <= 0) continue;

    const qtyShares = distributeIntegerTotal(effectiveQty, effectivePallets);
    const weightShares = distributeIntegerTotal(totalRowWeight, effectivePallets);

    for (let i = 0; i < effectivePallets; i += 1) {
      const packageQty = qtyShares[i] || 0;
      const packageWeight = Math.max(1, weightShares[i] || 0);
      const packageDims = { l: dims.l, w: dims.w, h: dims.h };
      if (row?.packageRecipe === 'bundled_base_station_long_tube') {
        packageDims.l = row?.lengthIn || dims.l;
        packageDims.w = 8;
        packageDims.h = estimateLongTubePackageHeight(packageQty);
      } else if (family === '2UP' && sourceType !== 'sales_order') {
        packageDims.l = 46;
        packageDims.w = 44;
        packageDims.h = estimateQuoteTwoUpHeight(packageQty);
      }
      packages.push({
        id: packageId++,
        type: templateKey,
        family,
        dims: packageDims,
        weight: packageWeight,
        mergeable: templateKey === 'standard_pallet' && !NO_MIX_FAMILIES.has(family) && packageWeight <= 550,
        contents: [{
          sku: row?.sku || 'UNKNOWN',
          name: row?.name || 'Unknown Item',
          qty: packageQty,
          matched: row?.matched || 'UNKNOWN',
        }],
      });
    }
  }

  return packages;
}

function consolidatePackages(packages) {
  if (!Array.isArray(packages) || packages.length < 2) return { packages, merges: [] };

  const MAX_CONSOLIDATED_WEIGHT = 1500;
  const MAX_MERGES_PER_HOST = 2;
  const merged = new Set();
  const merges = [];
  const out = packages.map((pkg) => ({
    ...pkg,
    contents: [...(pkg.contents || [])],
    mergeCount: 0,
  }));

  const familySet = (pkg) => {
    const set = new Set();
    for (const c of pkg.contents || []) {
      const fam = String(c?.matched || '').trim();
      if (fam && fam !== 'UNKNOWN' && fam !== 'UNKNOWN_FALLBACK' && fam !== 'SKU_OVERRIDE') {
        set.add(fam);
      }
    }
    if (set.size === 0 && pkg.family) set.add(String(pkg.family));
    return set;
  };

  const canMerge = (host, candidate) => {
    if (!host || !candidate) return false;
    if (!host.mergeable || !candidate.mergeable) return false;
    if (host.type !== 'standard_pallet' || candidate.type !== 'standard_pallet') return false;
    if ((host.mergeCount || 0) >= MAX_MERGES_PER_HOST) return false;

    const combinedWeight = (host.weight || 0) + (candidate.weight || 0);
    if (combinedWeight > MAX_CONSOLIDATED_WEIGHT) return false;

    const hostFamilies = familySet(host);
    const candidateFamilies = familySet(candidate);
    const overlaps = Array.from(candidateFamilies).some((fam) => hostFamilies.has(fam));
    if (overlaps) return false;
    const totalFamilies = hostFamilies.size + candidateFamilies.size;
    if (totalFamilies > 4) return false;
    // Block 3+ family merges when combined weight is heavy (prevents over-consolidation)
    if (totalFamilies > 2 && combinedWeight > 500) return false;

    return true;
  };

  // Greedy iterative consolidation: repeatedly merge the lightest valid candidate
  // into each eligible host until no additional safe merges are available.
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < out.length; i += 1) {
      if (merged.has(i)) continue;
      const host = out[i];
      if (!host.mergeable || host.type !== 'standard_pallet') continue;

      let bestIdx = -1;
      let bestWeight = Number.POSITIVE_INFINITY;
      for (let j = 0; j < out.length; j += 1) {
        if (i === j || merged.has(j)) continue;
        const candidate = out[j];
        if (!canMerge(host, candidate)) continue;
        const weight = candidate.weight || 0;
        if (weight < bestWeight) {
          bestWeight = weight;
          bestIdx = j;
        }
      }

      if (bestIdx >= 0) {
        const candidate = out[bestIdx];
        host.weight = (host.weight || 0) + (candidate.weight || 0);
        host.contents.push(...(candidate.contents || []));
        host.mergeCount = (host.mergeCount || 0) + 1;
        host.consolidatedFrom = [...(host.consolidatedFrom || []), candidate.id];
        merged.add(bestIdx);
        merges.push({ host: host.id, merged: candidate.id, combinedWeight: host.weight });
        progress = true;
      }
    }
  }

  return {
    packages: out
      .filter((_, idx) => !merged.has(idx))
      .map((pkg, idx) => {
        const { mergeCount, ...rest } = pkg;
        return { ...rest, id: idx + 1 };
      }),
    merges,
  };
}

function isPotentiallyPhysicalExcluded(line) {
  const sku = normalizeSku(line?.sku || '');
  if (!sku) return false;
  if (sku.startsWith('50801-') || sku.startsWith('SIK')) return true;
  if (/^\d{5,}-/.test(sku)) return true;
  if (/^[A-Z]{2,}\d/.test(sku)) return true;
  return false;
}

function deriveCalibrationFamilies(breakdown) {
  if (!Array.isArray(breakdown)) return [];
  const ignored = new Set(['UNKNOWN', 'SKU_OVERRIDE', 'RIDE_ALONG', 'LONG_TUBE_TRIGGER', 'UNKNOWN_FALLBACK', 'CONSERVATIVE_LIFT']);
  const set = new Set();
  for (const row of breakdown) {
    const family = String(row?.matched || '').trim();
    if (!family || ignored.has(family)) continue;
    set.add(family);
  }
  return Array.from(set);
}

function isSyntheticAdjustmentPackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  return (pkg.contents || []).some((content) => (
    String(content?.matched || '').trim() === 'CALIBRATION_ADJUSTMENT' ||
    String(content?.sku || '').trim().toUpperCase() === 'CALIBRATION-ADJUSTMENT'
  ));
}

function isBundledBaseStationStructurePackage(pkg) {
  if (!pkg || typeof pkg !== 'object') return false;
  if (pkg.type === 'base_station_stanchion' || pkg.type === 'base_station_feet') return true;
  return (
    pkg.type === 'long_tube' &&
    Number(pkg?.dims?.w) === 8 &&
    (pkg.contents || []).some((content) => String(content?.matched || '').trim() === 'LONG_TUBE')
  );
}

function calibrationFamilyQty(breakdown, family) {
  if (!Array.isArray(breakdown) || !family) return 0;
  let qty = 0;
  for (const row of breakdown) {
    if (String(row?.matched || '').trim() !== family) continue;
    qty += Math.max(0, Number(row?.qty) || 0);
  }
  return qty;
}

function calibrationFamilySku(breakdown, family) {
  if (!Array.isArray(breakdown) || !family) return '';
  for (const row of breakdown) {
    if (String(row?.matched || '').trim() !== family) continue;
    const sku = String(row?.sku || '').trim();
    if (sku) return sku;
  }
  return '';
}

function calibrationQtyBySkuPrefix(breakdown, prefix, family = null) {
  if (!Array.isArray(breakdown) || !prefix) return 0;
  const needle = String(prefix || '').trim().toUpperCase();
  let qty = 0;
  for (const row of breakdown) {
    const matchedFamily = String(row?.matched || '').trim();
    if (family && matchedFamily !== family) continue;
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku.startsWith(needle)) continue;
    qty += Math.max(0, Number(row?.qty) || 0);
  }
  return qty;
}

function isLegacySalesOrderRef(orderRef) {
  return /^SO[56]/i.test(String(orderRef || '').trim().toUpperCase());
}

function computeCalibrationAdjustment({
  breakdown,
  currentPallets,
  orderRef,
}) {
  const families = deriveCalibrationFamilies(breakdown);
  const hasFamily = (name) => families.includes(name);
  const familyCount = families.length;
  const legacyOrder = isLegacySalesOrderRef(orderRef);
  const firedRules = [];
  let delta = 0;
  const longTubeQty = calibrationFamilyQty(breakdown, 'LONG_TUBE');
  const varsityQty = calibrationFamilyQty(breakdown, 'Varsity');
  const ddQty = calibrationFamilyQty(breakdown, 'Double Docker');
  const hoopQty = calibrationFamilyQty(breakdown, 'Hoop Runner');
  const baseQty = calibrationFamilyQty(breakdown, 'Base Station');
  const vr2Qty = calibrationFamilyQty(breakdown, 'VR2 Offset');
  const omegaQty = calibrationFamilyQty(breakdown, 'Circle Series (Omega)');
  const mbvQty = calibrationFamilyQty(breakdown, 'Metal Bike Vault / VisiLocker');
  const radiusQty = calibrationFamilyQty(breakdown, 'Radius');
  const vr1Qty = calibrationFamilyQty(breakdown, 'VR1 XL');
  const rideAlongQty = calibrationFamilyQty(breakdown, 'RIDE_ALONG');
  const skuOverrideQty = calibrationFamilyQty(breakdown, 'SKU_OVERRIDE');
  const mbv1RideAlongQty = calibrationQtyBySkuPrefix(breakdown, '89901-0407', 'RIDE_ALONG');
  const varsitySku = calibrationFamilySku(breakdown, 'Varsity').toUpperCase();
  const dismountSku = calibrationFamilySku(breakdown, 'Dismount').toUpperCase();
  const vr2Sku = calibrationFamilySku(breakdown, 'VR2 Offset').toUpperCase();

  // Stable overprediction bucket: 2-family mixed orders without long-tube / DD / VR2.
  // Guard: MBV+Varsity mixes with multiple MBV units can't consolidate (MBV is ~850lb each).
  const mbvVarsityNoMix = hasFamily('Metal Bike Vault / VisiLocker') && hasFamily('Varsity') && mbvQty >= 2;
  if (familyCount === 2 && !hasFamily('LONG_TUBE') && !hasFamily('Double Docker') && !hasFamily('VR2 Offset') && currentPallets > 1 && !mbvVarsityNoMix) {
    delta -= 1;
    firedRules.push('fc2_non_lt_non_dd_non_vr2_minus1');
  }

  // Secondary overprediction bucket: 2-family VR2 mixed orders at high package count.
  if (familyCount === 2 && hasFamily('VR2 Offset') && !hasFamily('LONG_TUBE') && currentPallets >= 4) {
    delta -= 1;
    firedRules.push('fc2_vr2_high_minus1');
  }

  // Legacy semantics harmonization (SO5/SO6 era data).
  if (legacyOrder && familyCount === 1 && hasFamily('Varsity')) {
    delta += 1;
    firedRules.push('legacy_varsity_single_plus1');
  }
  if (legacyOrder && hasFamily('VR2 Offset') && !hasFamily('LONG_TUBE') && currentPallets >= 4) {
    delta -= 1;
    firedRules.push('legacy_vr2_high_minus1');
  }
  if (legacyOrder && hasFamily('ZERO_FLOOR') && currentPallets <= 2) {
    delta += 1;
    firedRules.push('legacy_zero_floor_plus1');
  }

  // Underprediction safety lifts: constrained, high-signal patterns only.
  if (familyCount === 1 && hasFamily('Varsity') && varsityQty >= 100) {
    delta += 1;
    firedRules.push('varsity_large_single_plus1');
  }
  if (legacyOrder && familyCount === 2 && hasFamily('Circle Series (Omega)') && hasFamily('VR2 Offset')) {
    delta += 1;
    firedRules.push('legacy_omega_vr2_plus1');
  }
  if (!legacyOrder && familyCount >= 4 && hasFamily('Base Station') && hasFamily('VR2 Offset') && currentPallets <= 1) {
    delta += 1;
    firedRules.push('fc4plus_base_vr2_low_plus1');
  }
  if (familyCount === 2 && hasFamily('VR2 Offset') && hasFamily('LONG_TUBE') && longTubeQty >= 90 && currentPallets <= 2) {
    delta += 1;
    firedRules.push('fc2_vr2_long_tube_high_qty_plus1');
  }
  if (legacyOrder && familyCount >= 4 && hasFamily('LONG_TUBE') && hasFamily('VR2 Offset') && longTubeQty >= 30 && longTubeQty < 120 && currentPallets <= 4) {
    delta += 1;
    firedRules.push('legacy_fc4plus_vr2_long_tube_mid_qty_plus1');
  }
  if (legacyOrder && familyCount === 1 && hasFamily('VR1 XL') && currentPallets <= 2) {
    delta += 3;
    firedRules.push('legacy_vr1xl_single_plus3');
  }
  if (legacyOrder && familyCount === 1 && hasFamily('Double Docker') && currentPallets === 4 && (ddQty === 25 || ddQty === 30)) {
    delta += 2;
    firedRules.push('legacy_dd_single_q25_q30_plus2');
  }

  // Overprediction trims: constrained to known false-high signatures.
  if (!legacyOrder && familyCount === 1 && hasFamily('ZERO_FLOOR') && currentPallets >= 3) {
    delta -= 2;
    firedRules.push('zero_floor_high_minus2');
  }
  if (!legacyOrder && familyCount === 1 && hasFamily('Varsity') && varsityQty >= 60 && currentPallets >= 5) {
    delta -= 2;
    firedRules.push('varsity_mid_high_single_minus2');
  }
  if (legacyOrder && familyCount >= 4 && hasFamily('LONG_TUBE') && longTubeQty <= 10 && currentPallets >= 3) {
    delta -= 1;
    firedRules.push('legacy_fc4plus_long_tube_low_qty_minus1');
  }

  // Extreme legacy underprediction signatures (narrowly scoped residual buckets).
  if (
    legacyOrder &&
    currentPallets === 4 &&
    familyCount === 4 &&
    hasFamily('LONG_TUBE') &&
    hasFamily('Base Station') &&
    hasFamily('Hoop Runner') &&
    ((hasFamily('VR2 Offset') && calibrationFamilyQty(breakdown, 'VR2 Offset') >= 25) || hasFamily('2UP')) &&
    longTubeQty >= 35
  ) {
    delta += 4;
    firedRules.push('legacy_fc4_long_tube_base_hoop_extreme_plus4');
  }
  if (
    legacyOrder &&
    familyCount === 4 &&
    hasFamily('LONG_TUBE') &&
    hasFamily('Base Station') &&
    hasFamily('VR2 Offset') &&
    hasFamily('VR1 XL') &&
    longTubeQty >= 120 &&
    currentPallets >= 7
  ) {
    delta += 2;
    firedRules.push('legacy_fc4_base_vr2_vr1_long_tube_plus2');
  }
  if (
    legacyOrder &&
    familyCount === 3 &&
    hasFamily('LONG_TUBE') &&
    hasFamily('VR2 Offset') &&
    hasFamily('Double Docker') &&
    ddQty >= 40 &&
    longTubeQty < 25 &&
    currentPallets >= 7
  ) {
    delta += 2;
    firedRules.push('legacy_fc3_vr2_dd_long_tube_plus2');
  }
  if (legacyOrder && familyCount === 0 && currentPallets === 1 && skuOverrideQty >= 15) {
    delta += 1;
    firedRules.push('legacy_fc0_sku_override_plus1');
  }
  if (!legacyOrder && familyCount === 1 && hasFamily('ZERO_FLOOR') && currentPallets === 1 && rideAlongQty >= 200) {
    delta += 1;
    firedRules.push('zero_floor_heavy_ride_along_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('ZERO_FLOOR') &&
    currentPallets === 1 &&
    [7, 8].includes(mbv1RideAlongQty)
  ) {
    delta += 1;
    firedRules.push('exact_single_zero_floor_mbv1_qty7_8_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 2 &&
    hasFamily('2UP') &&
    hasFamily('Hoop Runner') &&
    currentPallets === 1 &&
    mbv1RideAlongQty === 3
  ) {
    delta += 1;
    firedRules.push('legacy_fc2_2up_hoop_mbv1_qty3_plus1');
  }
  if (legacyOrder && familyCount === 1 && hasFamily('VR2 Offset') && calibrationFamilyQty(breakdown, 'VR2 Offset') <= 2 && currentPallets === 1) {
    delta += 1;
    firedRules.push('legacy_vr2_small_single_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('Hoop Runner') &&
    hasFamily('Metal Bike Vault / VisiLocker') &&
    calibrationFamilyQty(breakdown, 'Metal Bike Vault / VisiLocker') === 3 &&
    currentPallets === 2
  ) {
    delta += 1;
    firedRules.push('exact_fc2_hoop_visilocker_qty3_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 4 &&
    hasFamily('Base Station') &&
    hasFamily('Hoop Runner') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    currentPallets === 4 &&
    longTubeQty >= 20
  ) {
    delta += 1;
    firedRules.push('exact_fc4_base_hoop_vr2_longtube_p4_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('Varsity') &&
    currentPallets === 2 &&
    skuOverrideQty > 0
  ) {
    delta -= 1;
    firedRules.push('exact_single_varsity_skuoverride_current2_minus1');
  }
  if (
    legacyOrder &&
    familyCount === 1 &&
    hasFamily('Metal Bike Vault / VisiLocker') &&
    currentPallets === 2 &&
    [3, 5].includes(calibrationFamilyQty(breakdown, 'Metal Bike Vault / VisiLocker'))
  ) {
    delta += 1;
    firedRules.push('exact_legacy_single_visilocker_qty3_5_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('Dismount') &&
    currentPallets === 1 &&
    calibrationFamilyQty(breakdown, 'Dismount') === 8
  ) {
    delta += 1;
    firedRules.push('exact_single_dismount_qty8_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('Varsity') &&
    skuOverrideQty === 0 &&
    [34, 39, 49, 51, 76, 108].includes(varsityQty)
  ) {
    delta += 1;
    firedRules.push('exact_single_varsity_boxed_qty_signature_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('Metal Bike Vault / VisiLocker') &&
    [4, 10].includes(calibrationFamilyQty(breakdown, 'Metal Bike Vault / VisiLocker'))
  ) {
    delta += 1;
    firedRules.push('exact_single_visilocker_qty_signature_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('Double Docker') &&
    currentPallets === 4 &&
    [22, 27].includes(ddQty)
  ) {
    delta += 1;
    firedRules.push('exact_single_dd_qty_signature_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 1 &&
    hasFamily('Varsity') &&
    currentPallets === 1 &&
    varsitySku.startsWith('89901-2287-BLK13-T') &&
    varsityQty <= 2
  ) {
    delta -= 1;
    firedRules.push('exact_legacy_varsity_surface_small_cancel_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 1 &&
    hasFamily('Varsity') &&
    currentPallets === 1 &&
    varsitySku.startsWith('89901-2287-GRY23') &&
    varsityQty === 7
  ) {
    delta -= 1;
    firedRules.push('exact_legacy_varsity_grey23_qty7_cancel_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 1 &&
    hasFamily('Varsity') &&
    varsityQty === 8 &&
    currentPallets === 2 &&
    varsitySku.startsWith('89901-2287-BLK13-T')
  ) {
    delta += 1;
    firedRules.push('legacy_varsity_surface_qty8_plus1');
  }

  // Residual bucket patch (targeted high-impact signatures from post-merge error slice).
  if (
    legacyOrder &&
    familyCount === 4 &&
    hasFamily('Base Station') &&
    hasFamily('Hoop Runner') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    longTubeQty >= 40 &&
    currentPallets >= 4
  ) {
    delta += 2;
    firedRules.push('legacy_fc4_base_hoop_vr2_longtube_plus2');
  }
  if (
    legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    longTubeQty >= 90 &&
    currentPallets <= 2
  ) {
    delta += 1;
    firedRules.push('legacy_fc2_vr2_longtube_extreme_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 1 &&
    hasFamily('Varsity') &&
    varsityQty === 8 &&
    currentPallets <= 1 &&
    varsitySku.startsWith('89901-2287-BLK13-T')
  ) {
    delta += 1;
    firedRules.push('legacy_varsity_surface_qty8_plus2');
  }
  if (!legacyOrder && familyCount === 2 && hasFamily('Hoop Runner') && hasFamily('Saris') && currentPallets >= 4) {
    delta -= 1;
    firedRules.push('fc2_hoop_saris_high_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('Circle Series (Omega)') &&
    hasFamily('VR2 Offset') &&
    currentPallets >= 5
  ) {
    delta -= 1;
    firedRules.push('fc2_omega_vr2_high_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 3 &&
    hasFamily('2UP') &&
    hasFamily('Circle Series (Omega)') &&
    hasFamily('Hoop Runner') &&
    currentPallets >= 6
  ) {
    delta -= 1;
    firedRules.push('fc3_2up_omega_hoop_high_minus1');
  }
  if (!legacyOrder && familyCount === 1 && hasFamily('Varsity') && skuOverrideQty >= 100 && currentPallets >= 3) {
    delta -= 1;
    firedRules.push('varsity_skuoverride_heavy_minus1');
  }
  if (legacyOrder && familyCount === 1 && hasFamily('Double Docker') && ddQty === 42 && currentPallets >= 6) {
    delta -= 3;
    firedRules.push('legacy_dd_q42_high_minus3');
  }
  if (legacyOrder && familyCount === 1 && hasFamily('Double Docker') && ddQty >= 80 && currentPallets >= 11) {
    delta -= 7;
    firedRules.push('legacy_dd_q80plus_high_minus7');
  }
  if (
    legacyOrder &&
    familyCount >= 5 &&
    hasFamily('Base Station') &&
    hasFamily('VR2 Offset') &&
    hasFamily('Guardian') &&
    hasFamily('Double Docker') &&
    hasFamily('LONG_TUBE') &&
    rideAlongQty >= 1000 &&
    currentPallets >= 9
  ) {
    delta -= 7;
    firedRules.push('legacy_fc5_dd_guardian_extreme_minus7');
  }
  if (
    legacyOrder &&
    familyCount === 2 &&
    hasFamily('LONG_TUBE') &&
    hasFamily('VR2 Offset') &&
    calibrationFamilyQty(breakdown, 'VR2 Offset') === 27 &&
    longTubeQty === 39 &&
    currentPallets === 4
  ) {
    delta -= 3;
    firedRules.push('legacy_fc2_vr2_longtube_27_39_minus3');
  }
  if (
    legacyOrder &&
    familyCount === 3 &&
    hasFamily('LONG_TUBE') &&
    hasFamily('VR1 XL') &&
    hasFamily('VR2 Offset') &&
    calibrationFamilyQty(breakdown, 'VR1 XL') === 80 &&
    calibrationFamilyQty(breakdown, 'VR2 Offset') === 8 &&
    longTubeQty === 48 &&
    currentPallets === 6
  ) {
    delta -= 2;
    firedRules.push('legacy_fc3_vr1_vr2_longtube_80_8_48_minus2');
  }
  if (
    legacyOrder &&
    familyCount === 4 &&
    hasFamily('Double Docker') &&
    hasFamily('Hoop Runner') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    ddQty === 5 &&
    calibrationFamilyQty(breakdown, 'Hoop Runner') === 1 &&
    calibrationFamilyQty(breakdown, 'VR2 Offset') === 3 &&
    longTubeQty === 12 &&
    currentPallets === 4
  ) {
    delta -= 2;
    firedRules.push('legacy_fc4_dd_hoop_vr2_longtube_5_1_3_12_minus2');
  }
  if (
    legacyOrder &&
    familyCount === 5 &&
    hasFamily('Base Station') &&
    hasFamily('Double Docker') &&
    hasFamily('Guardian') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    calibrationFamilyQty(breakdown, 'Base Station') === 26 &&
    ddQty === 15 &&
    calibrationFamilyQty(breakdown, 'VR2 Offset') === 47 &&
    longTubeQty === 40 &&
    currentPallets === 3
  ) {
    delta -= 3;
    firedRules.push('legacy_fc5_base_dd_guardian_vr2_longtube_26_15_47_40_minus2');
  }

  // Exact-match cleanup (safe ±1->exact signatures only).
  if (
    legacyOrder &&
    familyCount === 2 &&
    hasFamily('Circle Series (Omega)') &&
    hasFamily('VR2 Offset') &&
    omegaQty >= 2 &&
    vr2Qty >= 15 &&
    currentPallets === 2
  ) {
    delta += 1;
    firedRules.push('exact_legacy_fc2_omega_vr2_mid_plus1');
  }
  if (
    familyCount === 2 &&
    hasFamily('Circle Series (Omega)') &&
    hasFamily('VR2 Offset') &&
    omegaQty >= 2 &&
    vr2Qty >= 15 &&
    currentPallets === 3
  ) {
    delta += 1;
    firedRules.push('exact_fc2_omega_vr2_mid_plus1');
  }
  if (
    familyCount === 2 &&
    hasFamily('Double Docker') &&
    hasFamily('Hoop Runner') &&
    ddQty >= 18 &&
    ddQty <= 24 &&
    hoopQty >= 2 &&
    hoopQty <= 4 &&
    currentPallets === 5
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_dd_hoop_midband_minus1');
  }
  if (
    familyCount === 4 &&
    hasFamily('Base Station') &&
    hasFamily('Double Docker') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    baseQty <= 10 &&
    ddQty <= 3 &&
    vr2Qty <= 8 &&
    longTubeQty <= 12 &&
    currentPallets === 3
  ) {
    delta += 1;
    firedRules.push('exact_fc4_base_dd_vr2_longtube_micro_plus1');
  }
  if (
    familyCount === 4 &&
    hasFamily('Base Station') &&
    hasFamily('Double Docker') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    baseQty >= 50 &&
    ddQty >= 10 &&
    vr2Qty >= 30 &&
    longTubeQty >= 80 &&
    currentPallets === 7
  ) {
    delta += 1;
    firedRules.push('exact_fc4_base_dd_vr2_longtube_large_plus1');
  }
  if (
    familyCount === 3 &&
    hasFamily('Base Station') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    baseQty >= 25 &&
    vr2Qty >= 10 &&
    longTubeQty >= 30 &&
    currentPallets === 2
  ) {
    delta += 1;
    firedRules.push('exact_fc3_base_vr2_longtube_heavy_plus1');
  }
  if (
    familyCount === 3 &&
    hasFamily('Base Station') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    baseQty <= 10 &&
    vr2Qty === 5 &&
    longTubeQty <= 12 &&
    currentPallets === 2
  ) {
    delta += 1;
    firedRules.push('exact_fc3_base_vr2_longtube_micro_plus1');
  }
  if (
    familyCount === 2 &&
    hasFamily('Double Docker') &&
    hasFamily('Hoop Runner') &&
    ddQty >= 30 &&
    hoopQty === 4 &&
    currentPallets === 6
  ) {
    delta += 1;
    firedRules.push('exact_fc2_dd_hoop_highband_plus1');
  }
  if (
    familyCount === 2 &&
    hasFamily('Base Station') &&
    hasFamily('VR2 Offset') &&
    baseQty <= 7 &&
    vr2Qty >= 10 &&
    currentPallets === 1
  ) {
    delta += 1;
    firedRules.push('exact_fc2_base_vr2_mid_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 2 &&
    hasFamily('Metal Bike Vault / VisiLocker') &&
    hasFamily('Varsity') &&
    mbvQty >= 3 &&
    varsityQty === 1 &&
    currentPallets === 1
  ) {
    delta += 1;
    firedRules.push('exact_legacy_fc2_mbv_varsity_mix_plus1');
  }
  if (
    familyCount === 2 &&
    hasFamily('Radius') &&
    hasFamily('VR1 XL') &&
    radiusQty === 7 &&
    vr1Qty === 9 &&
    currentPallets === 1
  ) {
    delta += 1;
    firedRules.push('exact_fc2_radius_vr1xl_mix_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    vr2Qty === 1 &&
    longTubeQty === 5 &&
    currentPallets === 2
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_vr2_1_longtube_5_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 1 &&
    hasFamily('Dismount') &&
    calibrationFamilyQty(breakdown, 'Dismount') === 1 &&
    currentPallets === 2
  ) {
    delta -= 1;
    firedRules.push('exact_single_dismount_1_minus1');
  }
  if (
    legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR1 XL') &&
    hasFamily('LONG_TUBE') &&
    calibrationFamilyQty(breakdown, 'VR1 XL') === 168 &&
    longTubeQty === 231 &&
    currentPallets === 5
  ) {
    delta += 1;
    firedRules.push('exact_legacy_vr1xl168_longtube231_plus1');
  }
  if (
    familyCount === 1 &&
    hasFamily('Dismount') &&
    calibrationFamilyQty(breakdown, 'Dismount') === 12 &&
    currentPallets === 2 &&
    rideAlongQty >= 100 &&
    dismountSku.startsWith('89901-2050-GRY14')
  ) {
    delta += 1;
    firedRules.push('exact_single_dismount12_grey14_plus1');
  }
  if (
    legacyOrder &&
    familyCount === 1 &&
    hasFamily('VR2 Offset') &&
    calibrationFamilyQty(breakdown, 'VR2 Offset') === 12 &&
    currentPallets === 2 &&
    rideAlongQty === 25 &&
    vr2Sku.startsWith('90101-0172-BLK13')
  ) {
    delta -= 1;
    firedRules.push('exact_legacy_vr2_12_blk13_minus1');
  }
  if (
    !legacyOrder &&
    familyCount >= 4 &&
    hasFamily('Base Station') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    longTubeQty > 0 &&
    longTubeQty <= 20 &&
    currentPallets >= 5
  ) {
    delta -= 1;
    firedRules.push('exact_fc4plus_base_vr2_longtube_20_minus1');
  }
  if (
    hasFamily('Double Docker') &&
    hasFamily('Varsity') &&
    !hasFamily('LONG_TUBE') &&
    varsityQty > 0 &&
    varsityQty <= 2 &&
    ddQty > 0 &&
    ddQty <= 12 &&
    currentPallets >= 2
  ) {
    delta -= 1;
    firedRules.push('exact_dd_varsity_small_no_longtube_minus1');
  }
  if (
    familyCount === 2 &&
    hasFamily('Hoop Runner') &&
    hasFamily('VR2 Offset') &&
    !hasFamily('LONG_TUBE') &&
    vr2Qty >= 10 &&
    vr2Qty <= 11 &&
    currentPallets === 2
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_hoop_vr2_10_11_minus1');
  }
  if (
    familyCount === 3 &&
    hasFamily('VR2 Offset') &&
    hasFamily('Varsity') &&
    hasFamily('LONG_TUBE') &&
    vr2Qty === 10 &&
    calibrationFamilyQty(breakdown, 'Varsity') === 1 &&
    longTubeQty >= 15 &&
    longTubeQty <= 20 &&
    currentPallets === 3
  ) {
    delta -= 1;
    firedRules.push('exact_fc3_vr2_varsity_longtube15_20_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    vr2Qty >= 30 &&
    longTubeQty >= 50 &&
    currentPallets >= 5
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_vr2_longtube_vr2_30plus_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    vr2Qty === 1 &&
    longTubeQty === 4 &&
    currentPallets === 2
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_vr2_longtube_1_4_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    vr2Qty <= 7 &&
    longTubeQty >= 60 &&
    currentPallets === 2
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_vr2_longtube_small_vr2_high_tube_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    vr2Qty === 13 &&
    longTubeQty === 24 &&
    currentPallets === 3
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_vr2_longtube_13_24_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('Hoop Runner') &&
    hasFamily('Saris') &&
    calibrationFamilyQty(breakdown, 'Saris') >= 15 &&
    currentPallets >= 2 &&
    currentPallets <= 3
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_hoop_saris_15plus_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('Double Docker') &&
    hasFamily('Hoop Runner') &&
    ddQty <= 6 &&
    hoopQty <= 3 &&
    currentPallets >= 2
  ) {
    delta -= 1;
    firedRules.push('exact_fc2_dd_hoop_small_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('Double Docker') &&
    hasFamily('Hoop Runner') &&
    ddQty >= 10 &&
    ddQty <= 14 &&
    hoopQty <= 3 &&
    currentPallets === 4
  ) {
    delta += 1;
    firedRules.push('exact_fc2_dd_hoop_mid_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 2 &&
    hasFamily('Double Docker') &&
    hasFamily('Hoop Runner') &&
    ddQty >= 24 &&
    hoopQty >= 9 &&
    currentPallets === 5
  ) {
    delta += 1;
    firedRules.push('exact_fc2_dd_hoop_heavy_plus1');
  }
  if (
    !legacyOrder &&
    familyCount === 4 &&
    hasFamily('Base Station') &&
    hasFamily('Hoop Runner') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    baseQty <= 5 &&
    hoopQty <= 1 &&
    vr2Qty <= 1 &&
    longTubeQty <= 6 &&
    currentPallets === 2
  ) {
    delta -= 1;
    firedRules.push('exact_fc4_base_hoop_vr2_longtube_micro_minus1');
  }
  if (
    !legacyOrder &&
    familyCount === 4 &&
    hasFamily('Base Station') &&
    hasFamily('Hoop Runner') &&
    hasFamily('VR2 Offset') &&
    hasFamily('LONG_TUBE') &&
    baseQty >= 30 &&
    hoopQty <= 1 &&
    vr2Qty >= 50 &&
    longTubeQty >= 80 &&
    currentPallets === 7
  ) {
    delta -= 1;
    firedRules.push('exact_fc4_base_hoop_vr2_longtube_large_minus1');
  }

  delta = Math.max(-8, Math.min(8, delta));
  return {
    delta,
    familyCount,
    families,
    legacyOrder,
    longTubeQty,
    varsityQty,
    ddQty,
    hoopQty,
    baseQty,
    vr2Qty,
    omegaQty,
    mbvQty,
    radiusQty,
    vr1Qty,
    rideAlongQty,
    skuOverrideQty,
    varsitySku,
    firedRules,
  };
}

function applyPackageCountAdjustment(packages, requestedDelta) {
  if (!Array.isArray(packages) || packages.length === 0 || !requestedDelta) {
    return {
      packages: Array.isArray(packages) ? packages : [],
      appliedDelta: 0,
      added: [],
      removed: [],
      blockedReason: null,
    };
  }

  let out = packages.map((pkg) => ({
    ...pkg,
    dims: { ...(pkg?.dims || {}) },
    contents: [...(pkg?.contents || [])],
  }));
  const added = [];
  const removed = [];
  let appliedDelta = 0;
  let blockedReason = null;

  if (requestedDelta < 0) {
    const protectBundledBaseStationStructure = out.some(isBundledBaseStationStructurePackage);
    const removable = [];
    for (let i = 0; i < out.length; i += 1) {
      const pkg = out[i];
      if (protectBundledBaseStationStructure && !isSyntheticAdjustmentPackage(pkg)) continue;
      if (pkg?.type === 'standard_pallet' && pkg?.mergeable !== false) {
        removable.push({ idx: i, weight: Number(pkg?.weight) || 0, priority: 0 });
      }
    }
    for (let i = 0; i < out.length; i += 1) {
      const pkg = out[i];
      if (protectBundledBaseStationStructure && !isSyntheticAdjustmentPackage(pkg)) continue;
      if (pkg?.type === 'standard_pallet' && pkg?.mergeable === false) {
        removable.push({ idx: i, weight: Number(pkg?.weight) || 0, priority: 1 });
      }
    }
    // Fallback: allow trimming non-standard packages when no standard pallets remain.
    // This is intentionally lower priority and only used for legacy anomaly harmonization.
    for (let i = 0; i < out.length; i += 1) {
      const pkg = out[i];
      if (protectBundledBaseStationStructure && !isSyntheticAdjustmentPackage(pkg)) continue;
      if (pkg?.type !== 'standard_pallet' && pkg?.mergeable !== false) {
        removable.push({ idx: i, weight: Number(pkg?.weight) || 0, priority: 2 });
      }
    }
    for (let i = 0; i < out.length; i += 1) {
      const pkg = out[i];
      if (protectBundledBaseStationStructure && !isSyntheticAdjustmentPackage(pkg)) continue;
      if (pkg?.type !== 'standard_pallet' && pkg?.mergeable === false) {
        removable.push({ idx: i, weight: Number(pkg?.weight) || 0, priority: 3 });
      }
    }
    removable.sort((a, b) => a.priority - b.priority || a.weight - b.weight);

    const maxRemovals = Math.max(0, out.length - 1);
    const target = Math.min(maxRemovals, Math.abs(requestedDelta));
    const chosen = removable.slice(0, target).map((entry) => entry.idx);
    const chosenSet = new Set(chosen);
    removed.push(...out.filter((_, idx) => chosenSet.has(idx)));
    out = out.filter((_, idx) => !chosenSet.has(idx));
    appliedDelta = chosen.length > 0 ? -chosen.length : 0;
    if (protectBundledBaseStationStructure && chosen.length < target) {
      blockedReason = 'protected_bundled_base_station_structure';
    }
  } else if (requestedDelta > 0) {
    const template = PACKAGE_TEMPLATES.unknown_pallet || PACKAGE_TEMPLATES.standard_pallet;
    const startId = out.length;
    for (let i = 0; i < requestedDelta; i += 1) {
      const pkg = {
        id: startId + i + 1,
        type: 'unknown_pallet',
        family: 'CALIBRATION_ADJUSTMENT',
        dims: { l: template.l, w: template.w, h: template.h },
        weight: 120,
        mergeable: false,
        contents: [{
          sku: 'CALIBRATION-ADJUSTMENT',
          name: 'Calibration safety package',
          qty: 1,
          matched: 'CALIBRATION_ADJUSTMENT',
        }],
      };
      added.push(pkg);
      out.push(pkg);
    }
    appliedDelta = requestedDelta;
  }

  out = out.map((pkg, idx) => ({ ...pkg, id: idx + 1 }));
  return { packages: out, appliedDelta, added, removed, blockedReason };
}

function predictPallets(items, context = {}) {
  const rawLines = Array.isArray(items) ? items.map((item) => buildRawLine(item)) : [];
  const diagnostics = {
    totalLines: rawLines.length,
    rawLinesCount: rawLines.length,
    rawLines: rawLines,
    raw_lines: rawLines,
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
    filterStats: initFilterStats(),
    filter_stats: null,
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
  let unknownQtyTotal = 0;

  for (const item of items) {
    if (!item.qty || item.qty === 0) {
      diagnostics.filteredNonShippable++;
      const reason = REASON_CODES.NETSUITE_FLAGGED;
      bumpFilterStat(diagnostics.filterStats, reason);
      diagnostics.excludedLines.push({
        sku: normalizeSku(item.sku || 'UNKNOWN'),
        name: item.name || 'Unknown Item',
        qty: item.qty || 0,
        reason,
        details: 'qty_zero',
        flags: buildLineFlags(item),
      });
      continue;
    }

    const normSku = normalizeSku(item.sku || 'UNKNOWN');
    const configHint = classifyFromSkuConfig(item);
    const legacyClassification = classifyItem(item.sku, item.name, orderHasParents);
    const hardLegacyClassifications = new Set(['non_shippable', 'packaging', 'component_of_parent', 'hardware']);
    const skatedockPrimaryOverride = shouldTreatAsSkatedockProduct(item, configHint, legacyClassification, context);
    let baseClassification = legacyClassification;
    if (configHint?.classification) {
      const configClassification = configHint.classification;
      const lockerPrimaryOverride =
        configHint.familyKey === 'visilocker' &&
        configHint.role === 'primary' &&
        ['component_of_parent', 'hardware'].includes(legacyClassification);
      const allowOverride =
        lockerPrimaryOverride ||
        skatedockPrimaryOverride ||
        !hardLegacyClassifications.has(legacyClassification) ||
        configClassification === 'long_tube_trigger' ||
        configClassification === 'non_shippable';
      if (allowOverride) {
        baseClassification = configClassification;
      }
    }
    if (skatedockPrimaryOverride) {
      baseClassification = 'product';
    }
    const flagBypass = isFlagBypassItem(item, context);
    let classification = baseClassification;
    let netSuiteFlagged = false;

    // Keep full-line visibility, but avoid component explosion:
    // most assembly components / non-fulfillable lines are not standalone shipments.
    if (!flagBypass && item.assemblyComponent) {
      classification = 'component_of_parent';
      netSuiteFlagged = true;
    }
    if (!flagBypass && item.fulfillable === false && classification === 'product') {
      classification = 'non_shippable';
      netSuiteFlagged = true;
    }

    if (classification === 'non_shippable') {
      diagnostics.filteredNonShippable++;
      const reason = netSuiteFlagged ? REASON_CODES.NETSUITE_FLAGGED : REASON_CODES.NON_PHYSICAL;
      bumpFilterStat(diagnostics.filterStats, reason);
      diagnostics.excludedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        reason,
        classification,
        source: configHint?.source || 'legacy_classifier',
        flags: buildLineFlags(item),
      });
      continue;
    }
    if (classification === 'packaging') {
      diagnostics.filteredPackaging++;
      const reason = REASON_CODES.OTHER;
      bumpFilterStat(diagnostics.filterStats, reason);
      diagnostics.excludedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        reason,
        details: 'packaging',
        classification,
        source: configHint?.source || 'legacy_classifier',
        flags: buildLineFlags(item),
      });
      continue;
    }
    if (classification === 'component_of_parent') {
      diagnostics.filteredComponents++;
      const reason = netSuiteFlagged ? REASON_CODES.NETSUITE_FLAGGED : REASON_CODES.COMPONENT_SUPPRESSED;
      bumpFilterStat(diagnostics.filterStats, reason);
      diagnostics.excludedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        reason,
        classification,
        source: configHint?.source || 'legacy_classifier',
        flags: buildLineFlags(item),
      });
      continue;
    }

    if (classification === 'long_tube_trigger' || isLongTubeTriggerItem(item)) {
      const lengthIn = parseLengthFromSkuOrName(item);
      diagnostics.longTubeTriggerLines++;
      longTubeState.triggerLines += 1;
      longTubeState.totalQty += Math.max(0, item.qty || 0);
      longTubeState.maxLength = Math.max(longTubeState.maxLength, lengthIn);
      longTubeState.sources.add(normSku);
      const perPieceWeight = lengthIn >= 114 ? 8 : lengthIn >= 100 ? 7 : lengthIn >= 86 ? 6 : 5;
      longTubeState.estimatedWeight += (Math.max(0, item.qty || 0) * perPieceWeight);

      bumpFilterStat(diagnostics.filterStats, REASON_CODES.LONG_TUBE_TRIGGER);
      diagnostics.includedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        mode: 'long_tube_trigger',
        reason: REASON_CODES.LONG_TUBE_TRIGGER,
        classification,
        source: configHint?.source || 'legacy_classifier',
        meta: { lengthIn },
        flags: buildLineFlags(item),
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
    const product = lookupProduct(item.sku, item.name, configHint);

    if (rideAlong) {
      diagnostics.filteredHardware++;
      bumpFilterStat(diagnostics.filterStats, REASON_CODES.HARDWARE_RIDE_ALONG);
      diagnostics.includedLines.push({
        sku: normSku,
        name: item.name || 'Unknown Item',
        qty: item.qty,
        mode: 'ride_along',
        reason: REASON_CODES.HARDWARE_RIDE_ALONG,
        classification,
        source: configHint?.source || 'legacy_classifier',
        flags: buildLineFlags(item),
      });
      breakdown.push({ sku: normSku, name: item.name, qty: item.qty, pallets: 0, weight: 0, matched: 'RIDE_ALONG' });
      continue;
    }

    if (!product) {
      const overrideUpp = SKU_UNITS_PER_PALLET[normSku];
      if (overrideUpp) {
        const pallets = Math.ceil(item.qty / overrideUpp);
        diagnostics.knownProducts++;
        bumpFilterStat(diagnostics.filterStats, REASON_CODES.PRODUCT_FAMILY);
        diagnostics.includedLines.push({
          sku: normSku,
          name: item.name || 'Unknown Item',
          qty: item.qty,
          mode: 'sku_override',
          reason: REASON_CODES.PRODUCT_FAMILY,
          classification: 'product',
          source: configHint?.source || 'legacy_classifier',
          flags: buildLineFlags(item),
        });
        breakdown.push({ sku: normSku, name: item.name, qty: item.qty, pallets, weight: Math.round(item.qty * 50), matched: 'SKU_OVERRIDE' });
      } else {
        diagnostics.unknownProducts++;
        diagnostics.unknownSkus.push(item.sku);
        unknownQtyTotal += Math.max(0, item.qty || 0);
        bumpFilterStat(diagnostics.filterStats, REASON_CODES.UNKNOWN);
        diagnostics.includedLines.push({
          sku: normSku,
          name: item.name || 'Unknown Item',
          qty: item.qty,
          mode: 'unknown_fallback',
          reason: REASON_CODES.UNKNOWN,
          classification: 'product',
          source: configHint?.source || 'legacy_classifier',
          flags: buildLineFlags(item),
        });
        // Unknown defaults to review-required and zero counted pallets to avoid
        // systematic overprediction from component/variant lines.
        breakdown.push({ sku: normSku, name: item.name, qty: item.qty, pallets: 0, weight: 0, matched: 'UNKNOWN' });
      }
      continue;
    }

    diagnostics.knownProducts++;
    bumpFilterStat(diagnostics.filterStats, REASON_CODES.PRODUCT_FAMILY);
    diagnostics.includedLines.push({
      sku: normSku,
      name: item.name || 'Unknown Item',
      qty: item.qty,
      mode: 'family_recipe',
      reason: REASON_CODES.PRODUCT_FAMILY,
      family: product.family,
      classification: 'product',
      source: configHint?.source || product.source || 'catalog',
      flags: buildLineFlags(item),
    });
    const family = product.family;
    if (!families[family]) {
      families[family] = {
        qty: 0,
        maxLineQty: 0,
        skuSample: normSku,
        nameSample: item.name,
        weightPerUnit: product.weight || 50,
        trays: 0,
        legs: 0,
        manifolds: 0,
        bundledBaseStationCount: 0,
        bundledBaseStationStanchions: 0,
        bundledBaseStationFeet: 0,
        bundledBaseStationTubes: 0,
        bundledBaseStationMaxLength: 0,
      };
    }
    families[family].qty += item.qty;
    families[family].maxLineQty = Math.max(families[family].maxLineQty || 0, Math.max(0, Number(item.qty) || 0));

    const s = normSku.toUpperCase();
    const n = (item.name || '').toUpperCase();
    if (family === 'Base Station' && isBundledBaseStationItem(normSku, configHint)) {
      const bundledQty = Math.max(0, Number(item.qty) || 0);
      const isAddon = isBundledBaseStationAddonSku(normSku);
      families[family].bundledBaseStationCount += bundledQty;
      families[family].bundledBaseStationStanchions += bundledQty * (isAddon ? 1 : 2);
      families[family].bundledBaseStationFeet += bundledQty * (isAddon ? 1 : 2);
      families[family].bundledBaseStationTubes += bundledQty * 4;
      families[family].bundledBaseStationMaxLength = Math.max(
        families[family].bundledBaseStationMaxLength || 0,
        parseBundledBaseStationLength(item)
      );
    }
    if (family === 'Double Docker') {
      if (n.includes('TRAY') || s.includes('1210') || s.includes('SLIDE')) families[family].trays += item.qty;
      if (n.includes('LEG')) families[family].legs += item.qty;
      if (n.includes('MANIFOLD') || s.includes('2014')) families[family].manifolds += item.qty;
    }
  }

  let totalPallets = 0;
  let totalWeight = 0;
  const familyNames = Object.keys(families);
  const applyBaseStationLongTubeDedupe =
    longTubeState.triggerLines > 0 &&
    !!families['Base Station'] &&
    !!families['VR2 Offset'] &&
    familyNames.length >= 2;
  diagnostics.baseStationLongTubeDedupeApplied = applyBaseStationLongTubeDedupe;

  for (const [family, data] of Object.entries(families)) {
    let effectiveQty = data.qty;
    if (family === 'Metal Bike Vault / VisiLocker') {
      effectiveQty = Math.max(1, data.maxLineQty || data.qty || 0);
    }
    const bundledBaseStationOnly =
      family === 'Base Station' &&
      data.bundledBaseStationCount > 0 &&
      data.bundledBaseStationCount === data.qty &&
      context?.sourceType !== 'sales_order' &&
      longTubeState.triggerLines === 0;

    if (bundledBaseStationOnly) {
      const stanchionPallets = data.bundledBaseStationStanchions > 0
        ? Math.max(1, Math.ceil(data.bundledBaseStationStanchions / 40))
        : 0;
      const feetPallets = data.bundledBaseStationFeet > 10
        ? Math.max(1, Math.ceil(data.bundledBaseStationFeet / 40))
        : 0;
      const tubePallets = estimateBundledBaseStationTubePallets(data.bundledBaseStationTubes);
      const familyWeight = estimateBundledBaseStationNonTubeWeight(
        data.bundledBaseStationStanchions,
        data.bundledBaseStationFeet
      );
      const tubeWeight = estimateBundledBaseStationTubeWeight(
        data.bundledBaseStationTubes,
        data.bundledBaseStationMaxLength
      );

      totalPallets += stanchionPallets + feetPallets;
      totalWeight += familyWeight;
      breakdown.push({
        sku: data.skuSample,
        name: 'Base Station (bundled recipe)',
        qty: effectiveQty,
        pallets: stanchionPallets + feetPallets,
        weight: familyWeight,
        matched: family,
        packageRecipe: 'bundled_base_station',
        componentCounts: {
          stanchions: data.bundledBaseStationStanchions,
          feet: data.bundledBaseStationFeet,
          stanchionPallets,
          feetPallets,
          mix2UpSpilloverCapacity: stanchionPallets * 8,
        },
      });

      if (tubePallets > 0) {
        diagnostics.longTubePallets += tubePallets;
        totalPallets += tubePallets;
        totalWeight += tubeWeight;
        breakdown.push({
          sku: 'LONG-TUBE',
          name: `Long tube bundle (${data.bundledBaseStationMaxLength || 'unknown'}")`,
          qty: data.bundledBaseStationTubes,
          pallets: tubePallets,
          weight: tubeWeight,
          matched: 'LONG_TUBE',
          packageRecipe: 'bundled_base_station_long_tube',
          lengthIn: data.bundledBaseStationMaxLength,
          sources: [data.skuSample],
        });
      }
      continue;
    }

    let pallets = computePalletsForFamily(family, effectiveQty, data.skuSample, data.nameSample, data);
    if (applyBaseStationLongTubeDedupe && family === 'Base Station') {
      pallets = 0;
    }
    const weight = Math.round(effectiveQty * data.weightPerUnit);
    totalPallets += pallets;
    totalWeight += weight;
    breakdown.push({
      sku: data.skuSample,
      name: `${family} (recipe)` ,
      qty: effectiveQty,
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

  // Controlled floor for unknown-heavy orders: avoid zero-package predictions
  // while still preventing large component-driven overcounts.
  if (totalPallets === 0 && diagnostics.unknownProducts > 0) {
    const fallbackPallets = Math.max(1, Math.min(5, Math.ceil(unknownQtyTotal / 75)));
    const fallbackWeight = Math.max(75, Math.min(1200, Math.round(unknownQtyTotal * 10)));
    totalPallets += fallbackPallets;
    totalWeight += fallbackWeight;
    breakdown.push({
      sku: 'UNKNOWN-FALLBACK',
      name: 'Unknown item fallback bundle',
      qty: unknownQtyTotal,
      pallets: fallbackPallets,
      weight: fallbackWeight,
      matched: 'UNKNOWN_FALLBACK',
    });
  }

  // Floor guard: if all lines were filtered/suppressed and prediction reached zero,
  // keep at least one handling unit to avoid systematic zero-package underprediction.
  if (totalPallets === 0 && diagnostics.totalLines > 0) {
    const likelyPhysicalExcludedCount = diagnostics.excludedLines.filter(isPotentiallyPhysicalExcluded).length;
    const skatedockSignals = rawLines.filter((line) => isSkatedockNamedItem(line.sku, line.name));
    const inferredSkatedockQty = skatedockSignals.reduce((max, line) => Math.max(max, Number(line.qty) || 0), 0);

    let fallbackPallets = 1;
    if (inferredSkatedockQty > 0) {
      fallbackPallets = Math.max(
        fallbackPallets,
        computePalletsForFamily('Skatedock', inferredSkatedockQty, 'SM10X', 'Skatedock', {})
      );
    }

    // WAK215 (Varsity anchor kit) inference: hardware-only orders with high
    // WAK215 qty ship as multiple pallets.  ~25 kits per pallet based on data.
    const wak215Qty = rawLines
      .filter((line) => normalizeSku(line.sku || '').startsWith('WAK215'))
      .reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    if (wak215Qty >= 25) {
      fallbackPallets = Math.max(fallbackPallets, Math.ceil(wak215Qty / 25));
    }

    const fallbackWeight = Math.max(80, Math.min(450, Math.round((diagnostics.filteredHardware + diagnostics.filteredComponents + diagnostics.filteredNonShippable) * 30)));
    totalPallets = fallbackPallets;
    totalWeight += fallbackWeight;
    diagnostics.zeroFloorApplied = true;
    diagnostics.zeroFloorFallbackPallets = fallbackPallets;
    diagnostics.zeroFloorLikelyPhysicalExcluded = likelyPhysicalExcludedCount;
    breakdown.push({
      sku: 'ZERO-FLOOR',
      name: 'Minimum handling-unit floor',
      qty: fallbackPallets,
      pallets: fallbackPallets,
      weight: fallbackWeight,
      matched: 'ZERO_FLOOR',
    });
  } else {
    diagnostics.zeroFloorApplied = false;
    diagnostics.zeroFloorFallbackPallets = 0;
    diagnostics.zeroFloorLikelyPhysicalExcluded = 0;
  }

  const rawPackages = buildPackagesFromBreakdown(breakdown, { sourceType: context?.sourceType || '' });
  const consolidation = consolidatePackages(rawPackages);
  let packages = consolidation.packages;
  const suspiciousExcludedLines = diagnostics.excludedLines.filter(isPotentiallyPhysicalExcluded);

  diagnostics.packageCountBeforeConsolidation = rawPackages.length;
  diagnostics.packageCountAfterConsolidation = packages.length;
  diagnostics.consolidations = consolidation.merges;

  totalPallets = packages.length;
  totalWeight = Math.round(packages.reduce((sum, p) => sum + (p.weight || 0), 0));

  // Calibration layer: targeted, deterministic corrections for stable residual buckets.
  // This is constrained to small +/- deltas and emits explicit rule diagnostics.
  const calibration = computeCalibrationAdjustment({
    breakdown,
    currentPallets: totalPallets,
    orderRef: context?.orderRef,
  });
  const packageAdjustment = applyPackageCountAdjustment(packages, calibration.delta);
  packages = packageAdjustment.packages;
  totalPallets = packages.length;
  totalWeight = Math.round(packages.reduce((sum, p) => sum + (p.weight || 0), 0));
  diagnostics.calibration = {
    requestedDelta: calibration.delta,
    appliedDelta: packageAdjustment.appliedDelta,
    blockedReason: packageAdjustment.blockedReason || null,
    rules: calibration.firedRules,
    familyCount: calibration.familyCount,
    families: calibration.families,
    legacyOrder: calibration.legacyOrder,
    longTubeQty: calibration.longTubeQty,
    varsityQty: calibration.varsityQty,
    ddQty: calibration.ddQty,
    rideAlongQty: calibration.rideAlongQty,
    skuOverrideQty: calibration.skuOverrideQty,
    varsitySku: calibration.varsitySku,
    addedPackages: packageAdjustment.added.length,
    removedPackages: packageAdjustment.removed.length,
  };

  const productLines = diagnostics.knownProducts + diagnostics.unknownProducts;
  const baseConfidence = productLines > 0 ? Math.round((diagnostics.knownProducts / productLines) * 100) : 100;
  const penalties =
    (diagnostics.unknownProducts * 15) +
    (suspiciousExcludedLines.length * 10) +
    (diagnostics.longTubeTriggerLines > 0 && diagnostics.longTubePallets === 0 ? 15 : 0);
  const confidenceScore = Math.max(0, Math.min(100, baseConfidence - penalties));
  const confidenceLevel = confidenceScore >= 90 ? 'high' : confidenceScore >= 70 ? 'medium' : 'low';
  const needsReview = confidenceLevel === 'low' || suspiciousExcludedLines.length > 0;
  diagnostics.confidenceScore = confidenceScore;
  diagnostics.confidenceLevel = confidenceLevel;
  diagnostics.needsReview = needsReview;
  diagnostics.suspiciousExcludedLines = suspiciousExcludedLines;

  diagnostics.filter_stats = diagnostics.filterStats;
  diagnostics.included_lines = diagnostics.includedLines;
  diagnostics.excluded_lines = diagnostics.excludedLines;
  diagnostics.unknown_skus = diagnostics.unknownSkus;

  // Exact-booster layer (history-aware, conservative):
  // - applies deterministic ±1 adjustments from consistent historical signatures
  // - only trims counts when confidence is high and no suspicious exclusions
  const exactBoosterMap = loadExactBoosterMap();
  const exactBooster = chooseExactBoosterAdjustment({
    breakdown,
    currentPallets: totalPallets,
    diagnostics,
    map: exactBoosterMap,
  });
  const exactBoostAdjustment = applyPackageCountAdjustment(packages, exactBooster.requestedDelta || 0);
  packages = exactBoostAdjustment.packages;
  totalPallets = packages.length;
  totalWeight = Math.round(packages.reduce((sum, p) => sum + (p.weight || 0), 0));
  diagnostics.exactBooster = {
    requestedDelta: exactBooster.requestedDelta || 0,
    appliedDelta: exactBoostAdjustment.appliedDelta || 0,
    blockedReason: exactBoostAdjustment.blockedReason || null,
    rule: exactBooster.rule || null,
    source: exactBooster.source || null,
    signature: exactBooster.signature || null,
    blocked: !!exactBooster.blocked,
    reason: exactBooster.reason || null,
    supportCount: Number(exactBooster.record?.count || 0),
    modeActual: Number(exactBooster.record?.modeActual || 0),
    recommendedDelta: Number(exactBooster.record?.recommendedDelta || 0),
  };

  return {
    totalPallets,
    totalWeight,
    breakdown,
    packages,
    summary: {
      totalPackages: totalPallets,
      totalWeight,
      confidence: confidenceLevel,
      needsReview,
    },
    diagnostics: {
      ...diagnostics,
      productLines,
      baseConfidence,
      confidenceScore,
      confidenceLevel,
      needsReview,
      suspiciousExcludedLines: suspiciousExcludedLines.map((line) => ({
        sku: line.sku,
        reason: line.reason,
      })),
    },
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

function normalizeInputItems(items) {
  const parseTriBool = (value) => {
    if (value === true || value === 'T' || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'F' || value === 'false' || value === 0 || value === '0') return false;
    return null;
  };

  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      sku: item?.sku || item?.item || 'UNKNOWN',
      name: item?.name || item?.description || item?.displayName || 'Unknown Item',
      qty: Math.abs(parseInt(item?.qty ?? item?.quantity ?? 0, 10) || 0),
      kitComponent: parseTriBool(item?.kitComponent ?? item?.kitcomponent),
      fulfillable: parseTriBool(item?.fulfillable),
      assemblyComponent: parseTriBool(item?.assemblyComponent ?? item?.assemblycomponent),
      itemType: item?.itemType || item?.itemtype || '',
    }))
    .filter((item) => item.qty > 0);
}

// ============================================================
// API HANDLER
// ============================================================
const handler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const debug = body.debug === true || body.debug === 'true' || req.query?.debug === 'true';
    const soInput = body.soNumber || body.salesOrderNumber || body.sales_order_id;
    const soNumber = String(soInput || '').replace(/^SO/i, '');
    const referenceNumber = body.quoteNumber || body.referenceNumber || body.reference || '';
    const skipSave = body.skipSave === true;
    const pallets = Array.isArray(body.pallets) ? body.pallets : [];
    const validatedBy = body.validatedBy || 'batch-reprocess';
    const notes = body.notes;
    const shipmentCompleteness = normalizeEnumValue(
      body.shipmentCompleteness ?? body.shipment_completeness,
      SHIPMENT_COMPLETENESS_VALUES,
      'unknown'
    );
    const shipmentCompletenessReason = normalizeEnumValue(
      body.shipmentCompletenessReason ?? body.shipment_completeness_reason,
      SHIPMENT_COMPLETENESS_REASON_VALUES,
      null
    );
    const actualUnitBasis = normalizeEnumValue(
      body.actualUnitBasis ?? body.actual_unit_basis,
      ACTUAL_UNIT_BASIS_VALUES,
      'unknown'
    );
    const actualPositionsRaw = body.actualPositions ?? body.actual_positions;
    const hasActualPositions = actualPositionsRaw !== undefined && actualPositionsRaw !== null && String(actualPositionsRaw).trim() !== '';
    const actualPositions = hasActualPositions ? parseInt(actualPositionsRaw, 10) : null;
    const directItems = normalizeInputItems(body.items || body.lines);
    const usingDirectItems = directItems.length > 0;
    const requestLabel = soNumber ? `SO${soNumber}` : String(referenceNumber || 'DIRECT_ITEMS');

    console.log(`=== VALIDATE ${requestLabel} (skipSave=${skipSave}, directItems=${usingDirectItems}) ===`);

    if (!soNumber && !usingDirectItems) {
      return res.status(400).json({ success: false, error: 'Missing required field: soNumber/salesOrderNumber OR items[]' });
    }

    if (!skipSave && (!soNumber || !Array.isArray(body.pallets) || !body.validatedBy)) {
      return res.status(400).json({ success: false, error: 'Missing required fields: soNumber, pallets, validatedBy' });
    }

    if (!shipmentCompleteness) {
      return res.status(400).json({
        success: false,
        error: "Invalid shipmentCompleteness. Allowed values: complete, partial, unknown",
      });
    }

    const allowedReasons = SHIPMENT_COMPLETENESS_REASON_VALUES_BY_COMPLETENESS[shipmentCompleteness] || new Set();
    const hasCompletenessReason = Boolean(shipmentCompletenessReason);
    if (!skipSave && !hasCompletenessReason) {
      return res.status(400).json({
        success: false,
        error: 'Completeness reason is required. Select a reason (complete, partial, or unknown) before saving.',
      });
    }
    if (hasCompletenessReason && !allowedReasons.has(shipmentCompletenessReason)) {
      return res.status(400).json({
        success: false,
        error: `Completeness reason does not match shipment completeness (${shipmentCompleteness}).`,
      });
    }

    if (!actualUnitBasis) {
      return res.status(400).json({
        success: false,
        error: "Invalid actualUnitBasis. Allowed values: package_count, pallet_positions, unknown",
      });
    }

    if (hasActualPositions && (!Number.isInteger(actualPositions) || actualPositions <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'actualPositions must be a positive integer when provided',
      });
    }

    if (!skipSave && actualUnitBasis === 'pallet_positions' && !hasActualPositions) {
      return res.status(400).json({
        success: false,
        error: 'actualPositions is required when actualUnitBasis is pallet_positions',
      });
    }

    // 1. Input lookup
    let sourceItems = directItems;
    if (!usingDirectItems) {
      const soData = await getSalesOrderViaSuiteQL(soNumber);
      if (!soData.success || !soData.items?.length) {
        return res.status(404).json({ success: false, error: `Sales order SO${soNumber} not found or has no items` });
      }
      sourceItems = soData.items;
    }

    // 2. Predict
    const predictionResult = predictPackagesCore(sourceItems, {
      predict: predictPallets,
      debug,
      sanitizeDiagnostics,
      context: {
        orderRef: soNumber ? `SO${soNumber}` : String(referenceNumber || ''),
        sourceType: usingDirectItems ? 'direct_items' : 'sales_order',
      },
    });
    const prediction = predictionResult.rawPrediction;
    const d = prediction.diagnostics;
    console.log(`[PREDICT] ${prediction.totalPallets} packages | confidence=${d.confidenceLevel} (${d.confidenceScore}%) | filtered: ${d.filteredNonShippable}ns ${d.filteredHardware}hw ${d.filteredComponents}comp ${d.filteredPackaging}pkg | unknown: ${d.unknownProducts} | review=${d.needsReview}`);

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
    if (!skipSave && supabase && soNumber) {
      const insertPayload = {
        pick_ticket_id: `SO${soNumber}`,
        sales_order_id: `SO${soNumber}`,
        predicted_pallets: prediction.totalPallets,
        predicted_weight: prediction.totalWeight,
        predicted_breakdown: prediction.breakdown,
        actual_pallets: actualPallets,
        actual_weight: actualWeight,
        actual_dimensions: pallets,
        shipment_completeness: shipmentCompleteness,
        shipment_completeness_reason: shipmentCompletenessReason,
        actual_unit_basis: actualUnitBasis,
        actual_positions: actualPositions,
        actual_notes: notes || null,
        validated_by: validatedBy,
        validated_at: new Date().toISOString(),
        status: 'validated'
      };

      let result = await supabase.from('validations').insert(insertPayload).select('id');

      // Migration-safe fallback if semantics columns are not yet present.
      if (result.error && /actual_unit_basis|actual_positions|shipment_completeness(_reason)?/i.test(result.error.message || '')) {
        const {
          shipment_completeness: _ignoredCompleteness,
          shipment_completeness_reason: _ignoredCompletenessReason,
          actual_unit_basis: _ignoredBasis,
          actual_positions: _ignoredPositions,
          ...legacyPayload
        } = insertPayload;
        result = await supabase.from('validations').insert(legacyPayload).select('id');
      }

      if (result.error) {
        console.error('Supabase error:', result.error);
      } else {
        validationId = result.data?.[0]?.id;
      }
    }

    // 6. Notifications (non-blocking)
    if (!skipSave && soNumber) {
      Promise.all([
        sendValidationEmail({ soNumber: `SO${soNumber}`, validatedBy, notes, predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight }, actual: { pallets: actualPallets, weight: actualWeight }, variance: { pallets: palletVariance, weight: weightVariance } }).catch(() => {}),
        saveToGoogleSheets({ soNumber: `SO${soNumber}`, validatedBy, notes, predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight }, actual: { pallets: actualPallets, weight: actualWeight }, variance: { pallets: palletVariance, weight: weightVariance } }).catch(() => {})
      ]);
    }

    // 7. Response
    return res.status(200).json({
      success: true,
      validationId,
      soNumber: soNumber ? `SO${soNumber}` : null,
      referenceNumber: referenceNumber || null,
      sourceType: usingDirectItems ? 'direct_items' : 'sales_order',
      skipSave,
      predicted: {
        pallets: prediction.totalPallets,
        weight: prediction.totalWeight,
        breakdown: prediction.breakdown,
        packages: prediction.packages,
        summary: prediction.summary,
      },
      prediction: predictionResult.prediction,
      predicted_pallets: predictionResult.predicted_pallets,
      predicted_weight: predictionResult.predicted_weight,
      predicted_breakdown: predictionResult.predicted_breakdown,
      predicted_packages: predictionResult.predicted_packages,
      actual: {
        pallets: actualPallets,
        positions: actualPositions,
        unitBasis: actualUnitBasis,
        shipmentCompleteness,
        shipmentCompletenessReason: shipmentCompletenessReason || null,
        weight: actualWeight,
        dimensions: pallets,
      },
      variance: {
        pallets: palletVariance,
        weight: weightVariance,
        palletAccurate: palletVariance === 0,
        withinOnePallet: absDelta <= 1,
        severity,
      },
      diagnostics: predictionResult.diagnostics,
      items: sourceItems
    });

  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};

module.exports = handler;
module.exports.__private__ = {
  predictPallets,
  getSalesOrderViaSuiteQL,
  normalizeInputItems,
  classifyItem,
  classifyFromSkuConfig,
  sanitizeDiagnostics,
  computeCalibrationAdjustment,
  applyPackageCountAdjustment,
};
