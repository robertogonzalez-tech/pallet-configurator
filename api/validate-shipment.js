const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const { createClient } = require('@supabase/supabase-js');
const { sendValidationEmail, saveToGoogleSheets } = require('./lib/notifications');

// NetSuite credentials from environment variables (trim to handle whitespace from Vercel UI)
const config = {
  accountId: process.env.NETSUITE_ACCOUNT_ID?.trim(),
  consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim(),
  consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim(),
  tokenId: process.env.NETSUITE_TOKEN_ID?.trim(),
  tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim(),
  restletUrl: process.env.NETSUITE_RESTLET_URL?.trim()
};

// Supabase client
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

function createOAuthClient() {
  return OAuth({
    consumer: {
      key: config.consumerKey,
      secret: config.consumerSecret
    },
    signature_method: 'HMAC-SHA256',
    hash_function(base_string, key) {
      return crypto
        .createHmac('sha256', key)
        .update(base_string)
        .digest('base64');
    }
  });
}

async function callNetSuite(action, params = {}) {
  const urlObj = new URL(config.restletUrl);
  urlObj.searchParams.set('action', action);
  for (const [key, value] of Object.entries(params)) {
    urlObj.searchParams.set(key, value);
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
      'Authorization': authHeader.Authorization,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  });
  
  return response.json();
}

async function getSalesOrderViaSuiteQL(soNumber) {
  // Step 1: Look up sales order by tranid to get internal ID
  // Try both with and without SO prefix, filter for sales orders only, order by ID desc to get most recent
  const soQuery = `SELECT id, tranid, type FROM transaction WHERE tranid IN ('SO${soNumber}', '${soNumber}') AND type = 'SalesOrd' ORDER BY id DESC`;
  const soUrl = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=10&offset=0`;
  
  const oauth = createOAuthClient();
  const token = { key: config.tokenId, secret: config.tokenSecret };
  const authHeader = oauth.toHeader(oauth.authorize({ url: soUrl, method: 'POST' }, token));
  authHeader.Authorization = authHeader.Authorization.replace(
    'OAuth ',
    `OAuth realm="${config.accountId.toUpperCase()}", `
  );
  
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
  
  console.log('SuiteQL SO lookup response:', JSON.stringify(soData, null, 2));
  
  if (!soData.items || soData.items.length === 0) {
    console.log('No items found for SO' + soNumber + ' with type=SalesOrd filter, query was: ' + soQuery);
    return { success: false, error: `Sales order SO${soNumber} not found (no SalesOrd type match)`, debug: { query: soQuery, response: soData } };
  }
  
  // Type filter in SQL query should handle this, but double-check
  const salesOrder = soData.items[0]; // Take first match (already filtered by type=SalesOrd)
  const soId = salesOrder.id;
  console.log('Found sales order with internal ID:', soId, 'type:', salesOrder.type);
  
  // Step 2: Get line items for this sales order
  // DEBUG: Temporarily remove quantity filter to see all items
  const itemsQuery = `
    SELECT 
      i.itemid AS sku,
      i.displayname AS name,
      tl.quantity
    FROM transactionline tl
    LEFT JOIN item i ON i.id = tl.item
    WHERE tl.transaction = ${soId}
      AND tl.mainline = 'F'
      AND tl.item IS NOT NULL
  `;
  
  const itemsUrl = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1000&offset=0`;
  const itemsAuthHeader = oauth.toHeader(oauth.authorize({ url: itemsUrl, method: 'POST' }, token));
  itemsAuthHeader.Authorization = itemsAuthHeader.Authorization.replace(
    'OAuth ',
    `OAuth realm="${config.accountId.toUpperCase()}", `
  );
  
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
  
  console.log('SuiteQL items query response:', JSON.stringify(itemsData, null, 2));
  
  if (!itemsData.items || itemsData.items.length === 0) {
    console.log('No line items found for SO' + soNumber + ' (soId: ' + soId + ')');
    return { success: false, error: `No items found for SO${soNumber}`, debug: { soId, itemsQuery, response: itemsData } };
  }
  
  // Format items to match expected structure (qty not quantity for predictPallets)
  // Use Math.abs() to convert negative quantities (returns/credits) to positive
  const items = itemsData.items.map(row => ({
    sku: row.sku || row.itemid || 'UNKNOWN',
    name: row.name || row.displayname || 'Unknown Item',
    qty: Math.abs(parseInt(row.quantity, 10) || 0)
  }));
  
  console.log('Formatted items:', JSON.stringify(items, null, 2));
  
  return { success: true, items };
}

// Simple pallet prediction logic (matches productModels.js)
function predictPallets(items) {
  // Hardware SKU patterns to skip (small items that pack with main products)
  const hardwarePatterns = ['3000P-', '3000Q-', '31000-', '32000-', '34010-', '39000-', '50801-', '81000-', '26268'];
  
  // Filter out hardware items
  items = items.filter(item => {
    const sku = item.sku || '';
    return !hardwarePatterns.some(pattern => sku.includes(pattern));
  });
  
  const unitsPerPallet = {
    'dv215': 70, '90101-2287': 70,
    'dismount': 15,
    'vr2': 50, 'vr1': 50,
    'dd4': 12, 'dd6': 8,
    'mbv1': 4, 'mbv2': 2,
    'visi1': 6, 'visi2': 3,
    'hr101': 60, 'hr201': 20,
    'undergrad': 4,
    'sm10x': 16, 'sm10': 16, '89901-121': 16,
    'default': 10
  };
  
  const weightPerUnit = {
    'dv215': 55, '90101-2287': 55,
    'dismount': 10,
    'vr2': 31, 'vr1': 31,
    'dd4': 206, 'dd6': 260,
    'mbv1': 312, 'mbv2': 420,
    'visi1': 280, 'visi2': 375,
    'hr101': 14, 'hr201': 48,
    'undergrad': 85,
    'sm10x': 28, 'sm10': 28, '89901-121': 28,
    'default': 50
  };
  
  let totalPallets = 0;
  let totalWeight = 0;
  const breakdown = [];
  
  for (const item of items) {
    const skuLower = item.sku.toLowerCase();
    let upp = unitsPerPallet.default;
    let wpu = weightPerUnit.default;
    
    for (const [key, val] of Object.entries(unitsPerPallet)) {
      if (key !== 'default' && skuLower.includes(key.toLowerCase())) {
        upp = val;
        wpu = weightPerUnit[key] || weightPerUnit.default;
        break;
      }
    }
    
    const pallets = Math.ceil(item.qty / upp);
    const weight = item.qty * wpu;
    
    totalPallets += pallets;
    totalWeight += weight;
    breakdown.push({ 
      sku: item.sku, 
      name: item.name, 
      qty: item.qty, 
      pallets, 
      weight: Math.round(weight)
    });
  }
  
  return { totalPallets, totalWeight: Math.round(totalWeight), breakdown };
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  
  try {
    const { soNumber, pallets, validatedBy, notes } = req.body;
    
    console.log('=== VALIDATE REQUEST ===');
    console.log('SO#:', soNumber);
    console.log('Has AccountID:', !!config.accountId);
    console.log('Has Supabase:', !!supabase);
    
    if (!soNumber || !pallets || !validatedBy) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: soNumber, pallets, validatedBy' 
      });
    }
    
    // 1. Look up sales order in NetSuite using SuiteQL
    console.log('Calling getSalesOrderViaSuiteQL for SO' + soNumber);
    const soData = await getSalesOrderViaSuiteQL(soNumber);
    console.log('SuiteQL result:', JSON.stringify(soData));
    
    if (!soData.success || !soData.items || soData.items.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `Sales order SO${soNumber} not found or has no items`,
        debug: soData
      });
    }
    
    // 2. Run pallet prediction
    console.log('Items being sent to predictPallets:', JSON.stringify(soData.items, null, 2));
    const prediction = predictPallets(soData.items);
    console.log('Prediction result:', JSON.stringify(prediction, null, 2));
    
    // 3. Calculate actuals from pallet data
    const actualPallets = pallets.length;
    const actualWeight = pallets.reduce((sum, p) => sum + (p.weight || 0), 0);
    
    // 4. Calculate variance
    const palletVariance = actualPallets - prediction.totalPallets;
    const weightVariance = actualWeight - prediction.totalWeight;
    const palletAccurate = palletVariance === 0;
    const withinOnePallet = Math.abs(palletVariance) <= 1;
    
    // 5. Save to Supabase
    let validationId = null;
    if (supabase) {
      console.log('Attempting Supabase save for SO' + soNumber);
      const insertData = {
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
      };
      console.log('Insert data:', JSON.stringify(insertData, null, 2));
      
      let data, error;
      try {
        const result = await supabase.from('validations').insert(insertData).select('id');
        data = result.data;
        error = result.error;
        console.log('Supabase response - data:', data, 'error:', error);
      } catch (err) {
        console.error('Supabase insert exception:', err);
        error = err;
      }
      
      if (error) {
        console.error('Supabase save error:', error);
        return res.status(500).json({ 
          success: false, 
          error: `Failed to save validation: ${error.message}`,
          details: error
        });
      }
      
      validationId = data?.[0]?.id;
      console.log('Validation saved with ID:', validationId);
    } else {
      console.warn('Supabase client not configured - skipping save');
    }
    
    // 6. Send notifications (email + Google Sheets backup)
    const notificationData = {
      soNumber: `SO${soNumber}`,
      validatedBy,
      notes,
      predicted: {
        pallets: prediction.totalPallets,
        weight: prediction.totalWeight
      },
      actual: {
        pallets: actualPallets,
        weight: actualWeight
      },
      variance: {
        pallets: palletVariance,
        weight: weightVariance,
        palletAccurate,
        withinOnePallet
      }
    };
    
    // Send email and save to Sheets (non-blocking, don't wait)
    Promise.all([
      sendValidationEmail(notificationData).catch(err => console.error('Email error:', err)),
      saveToGoogleSheets(notificationData).catch(err => console.error('Sheets error:', err))
    ]);
    
    // 7. Return comparison data
    return res.status(200).json({
      success: true,
      validationId,
      soNumber: `SO${soNumber}`,
      predicted: {
        pallets: prediction.totalPallets,
        weight: prediction.totalWeight,
        breakdown: prediction.breakdown
      },
      actual: {
        pallets: actualPallets,
        weight: actualWeight,
        dimensions: pallets
      },
      variance: {
        pallets: palletVariance,
        weight: weightVariance,
        palletAccurate,
        withinOnePallet
      },
      items: soData.items
    });
    
  } catch (error) {
    console.error('Validation error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message || 'Internal server error' 
    });
  }
};
