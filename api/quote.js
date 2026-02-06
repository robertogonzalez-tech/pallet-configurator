const crypto = require('crypto');
const OAuth = require('oauth-1.0a');

// NetSuite credentials from environment variables (trim to handle whitespace from Vercel UI)
const config = {
  accountId: process.env.NETSUITE_ACCOUNT_ID?.trim(),
  consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim(),
  consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim(),
  tokenId: process.env.NETSUITE_TOKEN_ID?.trim(),
  tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim(),
  restletUrl: process.env.NETSUITE_RESTLET_URL?.trim()
};

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

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Debug endpoint
  if (req.query.debug === 'env') {
    return res.status(200).json({
      hasAccountId: !!config.accountId,
      accountIdLength: config.accountId?.length || 0,
      hasConsumerKey: !!config.consumerKey,
      consumerKeyLength: config.consumerKey?.length || 0,
      hasConsumerSecret: !!config.consumerSecret,
      hasTokenId: !!config.tokenId,
      tokenIdLength: config.tokenId?.length || 0,
      hasTokenSecret: !!config.tokenSecret,
      hasRestletUrl: !!config.restletUrl,
      restletUrl: config.restletUrl || 'not set'
    });
  }
  
  // Check config
  if (!config.restletUrl) {
    return res.status(500).json({ 
      success: false, 
      error: 'NetSuite not configured. Set environment variables.' 
    });
  }
  
  const { num, id } = req.query;
  
  if (!num && !id) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing quote number (num) or ID (id)' 
    });
  }
  
  try {
    let result;
    
    if (num) {
      result = await callNetSuite('quoteByNumber', { num });
    } else {
      result = await callNetSuite('quote', { id });
    }
    
    return res.status(200).json(result);
  } catch (err) {
    console.error('NetSuite API error:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};
