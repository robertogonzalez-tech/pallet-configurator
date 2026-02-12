const crypto = require('crypto');
const OAuth = require('oauth-1.0a');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });

const config = {
  accountId: process.env.NETSUITE_ACCOUNT_ID?.trim(),
  consumerKey: process.env.NETSUITE_CONSUMER_KEY?.trim(),
  consumerSecret: process.env.NETSUITE_CONSUMER_SECRET?.trim(),
  tokenId: process.env.NETSUITE_TOKEN_ID?.trim(),
  tokenSecret: process.env.NETSUITE_TOKEN_SECRET?.trim()
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

async function testSuiteQL() {
  const soNumber = '7780';
  const soQuery = `SELECT id, tranid, type FROM transaction WHERE tranid = 'SO${soNumber}' AND type = 'SalesOrd'`;
  
  console.log('Testing SuiteQL query:');
  console.log('Query:', soQuery);
  
  const url = `https://${config.accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=1&offset=0`;
  console.log('URL:', url);
  
  const oauth = createOAuthClient();
  const token = { key: config.tokenId, secret: config.tokenSecret };
  const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'POST' }, token));
  authHeader.Authorization = authHeader.Authorization.replace(
    'OAuth ',
    `OAuth realm="${config.accountId.toUpperCase()}", `
  );
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader.Authorization,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'transient'
    },
    body: JSON.stringify({ q: soQuery })
  });
  
  const data = await response.json();
  console.log('\nResponse status:', response.status);
  console.log('Response data:', JSON.stringify(data, null, 2));
}

testSuiteQL();
