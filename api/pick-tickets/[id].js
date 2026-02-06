// Pick Ticket API Endpoint
// Fetches item fulfillment / pick ticket data from NetSuite
// Returns items + runs them through the pallet configurator for prediction

import crypto from 'crypto'

// NetSuite OAuth 1.0 signature generation
function generateOAuthSignature(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&')
  
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url.split('?')[0]),
    encodeURIComponent(sortedParams)
  ].join('&')
  
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`
  const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64')
  
  return signature
}

// Build OAuth header
function buildOAuthHeader(url, method, consumerKey, consumerSecret, tokenId, tokenSecret) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonce = crypto.randomBytes(16).toString('hex')
  
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_token: tokenId,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0'
  }
  
  const signature = generateOAuthSignature(method, url, oauthParams, consumerSecret, tokenSecret)
  oauthParams.oauth_signature = signature
  
  const headerParts = Object.keys(oauthParams)
    .sort()
    .map(key => `${key}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ')
  
  return `OAuth realm="${process.env.NETSUITE_ACCOUNT_ID}", ${headerParts}`
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const { id } = req.query
  
  if (!id) {
    return res.status(400).json({ error: 'Pick ticket ID required' })
  }
  
  // Check if NetSuite is configured
  const accountId = process.env.NETSUITE_ACCOUNT_ID
  const consumerKey = process.env.NETSUITE_CONSUMER_KEY
  const consumerSecret = process.env.NETSUITE_CONSUMER_SECRET
  const tokenId = process.env.NETSUITE_TOKEN_ID
  const tokenSecret = process.env.NETSUITE_TOKEN_SECRET
  
  if (!accountId || !consumerKey || !tokenId) {
    // Return mock data if NetSuite not configured
    // TODO: Remove mock once NetSuite is wired up
    console.log('[PICK-TICKET] NetSuite not configured, returning mock data')
    
    return res.status(200).json({
      success: true,
      pickTicketId: id,
      salesOrderId: 'SO-MOCK-1234',
      quoteNumber: 'QUO-MOCK-5678',
      predictedPallets: 3,
      predictedWeight: 1850,
      timestamp: new Date().toISOString(),
      items: [
        { sku: 'DD-SS-04-GAV', name: 'Double Docker 4-Bike', qty: 5 },
        { sku: 'SM10X-10-GAL', name: 'SkateDock 10-Board', qty: 8 },
        { sku: 'DV215-SS-GAL', name: 'Varsity 2x15', qty: 12 },
      ],
      _mock: true,
    })
  }
  
  try {
    // Determine the record type from the ID prefix
    // IF-#### = Item Fulfillment
    // PT-#### = Pick Ticket (custom record)
    // Just numbers = try item fulfillment first
    let recordType = 'itemFulfillment'
    let internalId = id
    
    if (id.toUpperCase().startsWith('IF-')) {
      internalId = id.substring(3)
      recordType = 'itemFulfillment'
    } else if (id.toUpperCase().startsWith('PT-')) {
      internalId = id.substring(3)
      recordType = 'customrecord_pick_ticket' // Adjust based on Chad's answer
    }
    
    // Build RESTlet URL
    // TODO: Update script/deploy IDs based on actual RESTlet
    const baseUrl = `https://${accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`
    const scriptId = process.env.NETSUITE_PICKTICKET_SCRIPT_ID || '576' // Same as quote script for now
    const deployId = process.env.NETSUITE_PICKTICKET_DEPLOY_ID || '1'
    
    const url = `${baseUrl}?script=${scriptId}&deploy=${deployId}&action=getPickTicket&id=${internalId}&type=${recordType}`
    
    // Generate OAuth header
    const authHeader = buildOAuthHeader(url, 'GET', consumerKey, consumerSecret, tokenId, tokenSecret)
    
    console.log(`[PICK-TICKET] Fetching: ${id} (type: ${recordType}, internal: ${internalId})`)
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('[PICK-TICKET] NetSuite error:', response.status, errorText)
      
      if (response.status === 404) {
        return res.status(404).json({ error: 'Pick ticket not found' })
      }
      
      return res.status(500).json({ 
        error: 'Failed to fetch pick ticket',
        details: errorText,
      })
    }
    
    const data = await response.json()
    
    // Transform NetSuite response to our format
    // TODO: Adjust field names based on actual response
    const pickTicket = {
      success: true,
      pickTicketId: id,
      salesOrderId: data.createdFromId || data.salesOrder?.id,
      quoteNumber: data.quoteNumber,
      items: (data.items || data.lines || []).map(line => ({
        sku: line.item || line.sku,
        name: line.description || line.itemName,
        qty: parseInt(line.quantity) || 0,
      })).filter(item => item.qty > 0),
      timestamp: new Date().toISOString(),
    }
    
    // TODO: Run items through pallet calculator to get prediction
    // For now, return placeholder
    pickTicket.predictedPallets = Math.ceil(pickTicket.items.reduce((sum, i) => sum + i.qty, 0) / 10)
    pickTicket.predictedWeight = pickTicket.items.reduce((sum, i) => sum + (i.qty * 50), 0) // Rough estimate
    
    return res.status(200).json(pickTicket)
    
  } catch (error) {
    console.error('[PICK-TICKET] Error:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
    })
  }
}
