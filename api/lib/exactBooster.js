const fs = require('fs');
const path = require('path');

const IGNORED_MATCHED = new Set([
  'UNKNOWN',
  'SKU_OVERRIDE',
  'RIDE_ALONG',
  'LONG_TUBE_TRIGGER',
  'UNKNOWN_FALLBACK',
  'CONSERVATIVE_LIFT',
  'CALIBRATION_ADJUSTMENT',
  'ZERO_FLOOR',
]);

let EXACT_BOOSTER_MAP = null;

function normalizeSku(sku) {
  return String(sku || '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\"']/g, '');
}

function normalizeQty(value) {
  const n = Math.max(0, Number(value) || 0);
  return Math.round(n);
}

function normalizeOrderRef(value) {
  return String(value || '').trim().toUpperCase();
}

function shouldUseRowForSignature(row) {
  if (!row || typeof row !== 'object') return false;
  const qty = normalizeQty(row.qty);
  if (qty <= 0) return false;
  const matched = String(row.matched || '').trim();
  if (IGNORED_MATCHED.has(matched)) return false;
  return true;
}

function buildLineSignatureFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return '';
  const qtyBySku = new Map();
  for (const row of breakdown) {
    if (!shouldUseRowForSignature(row)) continue;
    const sku = normalizeSku(row.sku || row.name || row.matched || 'UNKNOWN');
    if (!sku) continue;
    const nextQty = (qtyBySku.get(sku) || 0) + normalizeQty(row.qty);
    qtyBySku.set(sku, nextQty);
  }
  if (qtyBySku.size === 0) return '';
  return Array.from(qtyBySku.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([sku, qty]) => `${sku}:${qty}`)
    .join('|');
}

function buildFamilySignatureFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return '';
  const qtyByFamily = new Map();
  for (const row of breakdown) {
    if (!shouldUseRowForSignature(row)) continue;
    const family = String(row.matched || '').trim();
    if (!family) continue;
    const nextQty = (qtyByFamily.get(family) || 0) + normalizeQty(row.qty);
    qtyByFamily.set(family, nextQty);
  }
  if (qtyByFamily.size === 0) return '';
  return Array.from(qtyByFamily.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([family, qty]) => `${family}:${qty}`)
    .join('|');
}

function qtyBin(qty) {
  if (qty <= 1) return '1';
  if (qty <= 3) return '2-3';
  if (qty <= 7) return '4-7';
  if (qty <= 15) return '8-15';
  if (qty <= 31) return '16-31';
  if (qty <= 63) return '32-63';
  return '64+';
}

function buildPatternSignatureFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return '';
  const qtyByFamily = new Map();
  for (const row of breakdown) {
    if (!shouldUseRowForSignature(row)) continue;
    const family = String(row.matched || '').trim();
    if (!family) continue;
    const nextQty = (qtyByFamily.get(family) || 0) + normalizeQty(row.qty);
    qtyByFamily.set(family, nextQty);
  }
  if (qtyByFamily.size === 0) return '';
  const tokens = Array.from(qtyByFamily.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([family, qty]) => `${family}:${qtyBin(qty)}`);
  return `fc${tokens.length}|${tokens.join('|')}`;
}

function buildMultiFamilySignatureFromBreakdown(breakdown) {
  if (!Array.isArray(breakdown)) return '';
  const families = new Set();
  for (const row of breakdown) {
    if (!shouldUseRowForSignature(row)) continue;
    const family = String(row.matched || '').trim();
    if (!family) continue;
    families.add(family);
  }
  if (families.size < 2) return '';
  return `mf${families.size}|${Array.from(families).sort((a, b) => a.localeCompare(b)).join('|')}`;
}

function loadExactBoosterMap() {
  if (EXACT_BOOSTER_MAP) return EXACT_BOOSTER_MAP;
  const paths = [
    path.join(process.cwd(), 'config', 'exact-booster-map.json'),
    path.join(__dirname, '..', '..', 'config', 'exact-booster-map.json'),
    path.join(__dirname, '..', 'config', 'exact-booster-map.json'),
  ];
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      EXACT_BOOSTER_MAP = JSON.parse(raw);
      return EXACT_BOOSTER_MAP;
    } catch (_) {
      // Keep searching.
    }
  }
  EXACT_BOOSTER_MAP = {
    lineSignatures: {},
    familySignatures: {},
    patternSignatures: {},
    multiFamilySignatures: {},
    version: 1,
    generatedAt: null,
  };
  return EXACT_BOOSTER_MAP;
}

function confidenceAllowsTrim(diagnostics) {
  const confidence = Number(diagnostics?.confidenceScore || 0);
  const unknownProducts = Number(diagnostics?.unknownProducts || 0);
  const suspicious = Array.isArray(diagnostics?.suspiciousExcludedLines)
    ? diagnostics.suspiciousExcludedLines.length
    : 0;
  return confidence >= 85 && unknownProducts === 0 && suspicious === 0;
}

function buildResponse({
  requestedDelta = 0,
  rule = null,
  source = null,
  signature = null,
  record = null,
  blocked = false,
  reason = null,
}) {
  return {
    requestedDelta,
    rule,
    source,
    signature,
    blocked,
    reason,
    record: record || null,
  };
}

function recordContainsOrderRef(record, orderRef) {
  const normalized = normalizeOrderRef(orderRef);
  if (!normalized) return false;
  const sourceRows = Array.isArray(record?.sourceRows) ? record.sourceRows : [];
  return sourceRows.some((entry) => normalizeOrderRef(entry) === normalized);
}

function chooseAdjustmentFromRecord({
  record,
  currentPallets,
  allowTrim,
  source,
  signature,
  orderRef,
  blockSelfMatch = false,
}) {
  if (!record || !Number.isFinite(Number(currentPallets))) {
    return buildResponse({});
  }

  if (blockSelfMatch && recordContainsOrderRef(record, orderRef)) {
    return buildResponse({
      blocked: true,
      reason: 'self_match_blocked',
      source,
      signature,
      record,
    });
  }

  const modeActual = Number(record.modeActual);
  if (record.exactOverride === true && Number.isFinite(modeActual)) {
    const deltaToExact = modeActual - currentPallets;
    if (Math.abs(deltaToExact) <= 1 && deltaToExact !== 0) {
      if (deltaToExact < 0 && !allowTrim) {
        return buildResponse({
          blocked: true,
          reason: 'exact_override_trim_blocked_low_confidence',
          rule: 'exact_override',
          source,
          signature,
          record,
        });
      }
      return buildResponse({
        requestedDelta: deltaToExact,
        rule: 'exact_override',
        source,
        signature,
        record,
      });
    }
  }

  const recommendedDelta = Number(record.recommendedDelta);
  if (Number.isInteger(recommendedDelta) && recommendedDelta !== 0 && Math.abs(recommendedDelta) <= 1) {
    if (recommendedDelta < 0 && !allowTrim) {
      return buildResponse({
        blocked: true,
        reason: 'bias_trim_blocked_low_confidence',
        rule: 'bias_delta',
        source,
        signature,
        record,
      });
    }
    return buildResponse({
      requestedDelta: recommendedDelta,
      rule: 'bias_delta',
      source,
      signature,
      record,
    });
  }

  return buildResponse({});
}

function chooseExactBoosterAdjustment({
  breakdown,
  currentPallets,
  diagnostics,
  map,
  orderRef,
}) {
  const boosterMap = map || loadExactBoosterMap();
  if (!boosterMap || typeof boosterMap !== 'object') return buildResponse({});
  if (!Array.isArray(breakdown) || !Number.isFinite(Number(currentPallets))) return buildResponse({});

  const allowTrim = confidenceAllowsTrim(diagnostics);
  const lineSignature = buildLineSignatureFromBreakdown(breakdown);
  const familySignature = buildFamilySignatureFromBreakdown(breakdown);
  const multiFamilySignature = buildMultiFamilySignatureFromBreakdown(breakdown);

  if (lineSignature) {
    const lineRecord = boosterMap.lineSignatures?.[lineSignature];
    const lineAdjustment = chooseAdjustmentFromRecord({
      record: lineRecord,
      currentPallets,
      allowTrim,
      source: 'line_signature',
      signature: lineSignature,
      orderRef,
    });
    if (lineAdjustment.requestedDelta !== 0 || lineAdjustment.blocked) return lineAdjustment;
  }

  if (familySignature) {
    const familyRecord = boosterMap.familySignatures?.[familySignature];
    const familyAdjustment = chooseAdjustmentFromRecord({
      record: familyRecord,
      currentPallets,
      allowTrim,
      source: 'family_signature',
      signature: familySignature,
      orderRef,
    });
    if (familyAdjustment.requestedDelta !== 0 || familyAdjustment.blocked) return familyAdjustment;
  }

  if (multiFamilySignature) {
    const multiFamilyRecord = boosterMap.multiFamilySignatures?.[multiFamilySignature];
    const multiFamilyAdjustment = chooseAdjustmentFromRecord({
      record: multiFamilyRecord,
      currentPallets,
      allowTrim: false, // coarse multi-family source is +1-only
      source: 'multi_family_signature',
      signature: multiFamilySignature,
      orderRef,
      blockSelfMatch: true,
    });
    if (multiFamilyAdjustment.requestedDelta === 1 || multiFamilyAdjustment.blocked) return multiFamilyAdjustment;
  }

  const patternSignature = buildPatternSignatureFromBreakdown(breakdown);
  if (patternSignature) {
    const patternRecord = boosterMap.patternSignatures?.[patternSignature];
    const patternAdjustment = chooseAdjustmentFromRecord({
      record: patternRecord,
      currentPallets,
      allowTrim,
      source: 'pattern_signature',
      signature: patternSignature,
      orderRef,
    });
    if (patternAdjustment.requestedDelta !== 0 || patternAdjustment.blocked) return patternAdjustment;
  }

  return buildResponse({
    source: lineSignature || familySignature || multiFamilySignature || patternSignature ? 'none' : null,
    signature: lineSignature || familySignature || multiFamilySignature || patternSignature || null,
  });
}

module.exports = {
  IGNORED_MATCHED,
  normalizeSku,
  normalizeQty,
  normalizeOrderRef,
  buildLineSignatureFromBreakdown,
  buildFamilySignatureFromBreakdown,
  buildPatternSignatureFromBreakdown,
  buildMultiFamilySignatureFromBreakdown,
  loadExactBoosterMap,
  chooseExactBoosterAdjustment,
};
