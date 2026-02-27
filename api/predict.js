const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const validateShipment = require('./validate-shipment');
const { predictPackages: predictPackagesCore } = require('./lib/predictPackages');

const {
  predictPallets,
  getSalesOrderViaSuiteQL,
  normalizeInputItems,
  sanitizeDiagnostics,
} = validateShipment.__private__ || {};

const config = {
  accountId: process.env.NETSUITE_ACCOUNT_ID?.trim(),
  consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim(),
  consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim(),
  tokenId: process.env.NETSUITE_TOKEN_ID?.trim(),
  tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim(),
  restletUrl: process.env.NETSUITE_RESTLET_URL?.trim(),
};

function createOAuthClient() {
  return OAuth({
    consumer: {
      key: config.consumerKey,
      secret: config.consumerSecret,
    },
    signature_method: 'HMAC-SHA256',
    hash_function(baseString, key) {
      return crypto.createHmac('sha256', key).update(baseString).digest('base64');
    },
  });
}

async function callNetSuite(action, params = {}) {
  if (!config.restletUrl) {
    return { success: false, error: 'NetSuite RESTlet URL is not configured' };
  }

  const urlObj = new URL(config.restletUrl);
  urlObj.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') urlObj.searchParams.set(key, value);
  }

  const url = urlObj.toString();
  const oauth = createOAuthClient();
  const token = { key: config.tokenId, secret: config.tokenSecret };
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, token));
  authHeader.Authorization = authHeader.Authorization.replace(
    'OAuth ',
    `OAuth realm="${config.accountId.toUpperCase()}", `
  );

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader.Authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  return response.json();
}

async function getQuoteItems(quoteNumber) {
  const result = await callNetSuite('quoteByNumber', { num: quoteNumber });
  if (!result?.success || !result?.quote?.lines || !Array.isArray(result.quote.lines)) {
    return { success: false, error: result?.error || `Quote ${quoteNumber} not found` };
  }

  const lines = result.quote.lines
    .map((line) => ({
      sku: line?.item || 'UNKNOWN',
      name: line?.description || line?.item || 'Unknown Item',
      qty: Math.abs(parseInt(line?.quantity, 10) || 0),
    }))
    .filter((line) => line.qty > 0);

  return { success: true, items: normalizeInputItems(lines), quote: result.quote };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!predictPallets || !getSalesOrderViaSuiteQL || !normalizeInputItems) {
    return res.status(500).json({ success: false, error: 'Prediction engine unavailable' });
  }

  try {
    const payload = req.method === 'GET' ? req.query || {} : req.body || {};
    const soInput = payload.soNumber || payload.salesOrderNumber || payload.sales_order_id;
    const soNumber = String(soInput || '').replace(/^SO/i, '');
    const quoteNumber = String(payload.quoteNumber || payload.quote || '').trim();
    const referenceNumber = quoteNumber || payload.reference || null;
    let items = normalizeInputItems(payload.items || payload.lines);
    let sourceType = 'direct_items';

    if (!items.length) {
      if (quoteNumber) {
        const quoteData = await getQuoteItems(quoteNumber);
        if (!quoteData.success || !quoteData.items?.length) {
          return res.status(404).json({ success: false, error: quoteData.error || `Quote ${quoteNumber} not found` });
        }
        items = quoteData.items;
        sourceType = 'quote';
      } else if (!soNumber) {
        return res.status(400).json({
          success: false,
          error: 'Missing soNumber/salesOrderNumber OR quoteNumber OR items[]',
        });
      } else {
        const soData = await getSalesOrderViaSuiteQL(soNumber);
        if (!soData.success || !soData.items?.length) {
          return res.status(404).json({ success: false, error: soData.error || `Sales order SO${soNumber} not found` });
        }
        items = soData.items;
        sourceType = 'sales_order';
      }
    }

    const debug = payload.debug === true || payload.debug === 'true';
    const { prediction, predicted_pallets, predicted_weight, predicted_breakdown, predicted_packages, diagnostics } =
      predictPackagesCore(items, {
        predict: predictPallets,
        debug,
        sanitizeDiagnostics,
      });
    return res.status(200).json({
      success: true,
      soNumber: soNumber ? `SO${soNumber}` : null,
      referenceNumber,
      sourceType,
      prediction,
      predicted_pallets,
      predicted_weight,
      predicted_breakdown,
      predicted_packages,
      diagnostics,
      items,
    });
  } catch (error) {
    console.error('Predict API error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Internal server error' });
  }
};
