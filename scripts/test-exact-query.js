const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const https = require('https');

// Load NetSuite credentials from local file
const credPath = path.join(require('os').homedir(), '.config/clawdbot/netsuite-credentials.json');
const config = JSON.parse(fs.readFileSync(credPath, 'utf8'));

console.log('Account ID:', config.accountId);

const oauth = OAuth({
  consumer: { key: config.consumerKey, secret: config.consumerSecret },
  signature_method: 'HMAC-SHA256',
  hash_function(base_string, key) {
    return crypto.createHmac('sha256', key).update(base_string).digest('base64');
  }
});

const query = `SELECT tl.transaction, tl.item, tl.quantity, tl.mainline, i.itemid, i.displayname
FROM transactionline tl 
LEFT JOIN item i ON i.id = tl.item
WHERE tl.transaction = 151022 
AND tl.mainline = 'F' 
AND tl.item IS NOT NULL`;

const url = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=10&offset=0`;
const token = { key: config.tokenId, secret: config.tokenSecret };
const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'POST' }, token));
authHeader.Authorization = authHeader.Authorization.replace('OAuth ', `OAuth realm="${config.accountId.toUpperCase()}", `);

const postData = JSON.stringify({ q: query });

console.log('Query:', query);
console.log('URL:', url);

const req = https.request(url, {
  method: 'POST',
  headers: {
    'Authorization': authHeader.Authorization,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Prefer': 'transient',
    'Content-Length': Buffer.byteLength(postData)
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('\nResponse:', JSON.stringify(JSON.parse(data), null, 2));
  });
});

req.on('error', console.error);
req.write(postData);
req.end();
