#!/usr/bin/env node
/**
 * BOL Email Processor
 * 
 * Monitors incoming emails for AIT BOLs, parses them, and runs validation
 * against the pallet configurator predictions.
 * 
 * Usage:
 *   node process-bol.js                    # Process latest unread BOL
 *   node process-bol.js --watch            # Continuous monitoring mode
 *   node process-bol.js --file /path/to.pdf # Process a specific PDF
 */

import { execSync, spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULTS_DIR = join(__dirname, '../validation-results')
const NETSUITE_CLI = process.env.HOME + '/clawd/bin/brooke-netsuite'
const EMAIL_CLI = process.env.HOME + '/clawd/bin/brooke-email-read'

// Ensure results directory exists
if (!existsSync(RESULTS_DIR)) {
  mkdirSync(RESULTS_DIR, { recursive: true })
}

/**
 * Parse BOL PDF and extract key fields
 */
function parseBolPdf(pdfPath) {
  try {
    // Extract text from PDF with layout preservation (keeps column structure)
    const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf8' })
    
    // Extract fields using regex
    const fields = {}
    
    // HAWB/Air Bill Number - 8-digit number at end of header line
    // In layout mode: "...AIR BILL NO.\n...\n...25493380"
    const hawbMatch = text.match(/(\d{8})\s*$/m) // 8-digit number at end of line
      || text.match(/AIR BILL NO\..*?(\d{8})/is)
      || text.match(/HAWB#?\s*(\d+)/i)
    if (hawbMatch) fields.hawb = hawbMatch[1]
    
    // Shipper Reference Number (Sales Order)
    // In layout mode, find the line with SHIPPER NUMBER and get the second number group
    // Pattern: "0009031714                                 7706"
    const shipperLine = text.split('\n').find(l => /^\d{10}\s+\d{4,}/.test(l.trim()))
    if (shipperLine) {
      const soMatch = shipperLine.match(/^\d{10}\s+(\d{4,})/)
      if (soMatch) fields.soNumber = soMatch[1]
    }
    // Fallback: look for 4-digit number after SHIPPER REFERENCE NUMBER label
    if (!fields.soNumber) {
      const soMatch2 = text.match(/SHIPPER REFERENCE NUMBER.*?(\d{4,6})/is)
      if (soMatch2) fields.soNumber = soMatch2[1]
    }
    
    // Number of packages/pieces - look for "1 BIKE RACKS" pattern
    // In layout mode: "                1 BIKE RACKS                                                       1104"
    const packageLine = text.split('\n').find(l => /\d+\s+BIKE RACKS/i.test(l))
    if (packageLine) {
      const pcsMatch = packageLine.match(/(\d+)\s+BIKE RACKS/i)
      if (pcsMatch) fields.pallets = parseInt(pcsMatch[1])
      
      // Weight is at the end of the same line
      const weightMatch = packageLine.match(/(\d{3,})\s*$/)
      if (weightMatch) fields.weight = parseInt(weightMatch[1])
    }
    
    // Fallback for weight
    if (!fields.weight) {
      const weightMatch = text.match(/WEIGHT\s*[\n\r]+[^\n]*(\d{3,})/im)
        || text.match(/(\d{4})\s*$/m)
      if (weightMatch) fields.weight = parseInt(weightMatch[1])
    }
    
    // Dimensions (L x W x H)
    const dimsMatch = text.match(/(\d+)\s+(\d+)\s+(\d+)\s+\d{3,}/i) // L W H followed by weight
    if (dimsMatch) {
      fields.dimensions = {
        length: parseInt(dimsMatch[1]),
        width: parseInt(dimsMatch[2]),
        height: parseInt(dimsMatch[3])
      }
    }
    
    // Ship date
    const dateMatch = text.match(/DATE SHIPPED\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)
    if (dateMatch) fields.shipDate = dateMatch[1]
    
    // Consignee
    const consigneeMatch = text.match(/CONSIGNEE INFORMATION\s*\n\s*([A-Z][A-Z\s&]+)/i)
    if (consigneeMatch) fields.consignee = consigneeMatch[1].trim()
    
    return fields
  } catch (err) {
    console.error('Error parsing PDF:', err.message)
    return null
  }
}

/**
 * Get sales order items from NetSuite
 */
async function getSalesOrderItems(soNumber) {
  try {
    // First get the transaction ID
    const tranQuery = `SELECT id, tranid FROM transaction WHERE recordtype = 'salesorder' AND tranid = 'SO${soNumber}'`
    const tranResult = JSON.parse(execSync(`${NETSUITE_CLI} sql "${tranQuery}"`, { encoding: 'utf8' }))
    
    if (!tranResult.success || tranResult.count === 0) {
      console.error(`Sales order SO${soNumber} not found`)
      return null
    }
    
    const tranId = tranResult.results[0].id
    
    // Get line items (only main items, not assembly components)
    const itemsQuery = `
      SELECT tl.item, tl.quantity, tl.memo, i.itemid, i.displayname
      FROM transactionline tl
      JOIN item i ON tl.item = i.id
      WHERE tl.transaction = ${tranId}
        AND tl.mainline = 'F'
        AND tl.itemtype IN ('Assembly', 'InvtPart', 'Kit')
        AND tl.assemblycomponent = 'F'
        AND ABS(tl.quantity) > 0
    `
    const itemsResult = JSON.parse(execSync(`${NETSUITE_CLI} sql "${itemsQuery}"`, { encoding: 'utf8' }))
    
    if (!itemsResult.success) {
      console.error('Failed to get line items')
      return null
    }
    
    return itemsResult.results.map(r => ({
      sku: r.itemid,
      name: r.displayname || r.memo,
      qty: Math.abs(r.quantity) // Quantities are negative for shipped items
    }))
  } catch (err) {
    console.error('Error getting SO items:', err.message)
    return null
  }
}

/**
 * Run configurator prediction for items
 * (Simplified version - uses the calibrated rules from App.jsx)
 */
function predictPallets(items) {
  // Calibrated units per pallet (from App.jsx PACKING_RULES)
  const unitsPerPallet = {
    'dv215': 70,    // Varsity
    '90101-2287': 70, // Varsity numeric SKU
    'dismount': 15,
    'vr2': 50,
    'vr1': 50,
    'dd4': 12,
    'dd6': 8,
    'mbv1': 4,
    'mbv2': 2,
    'visi1': 6,
    'visi2': 3,
    'hr101': 60,
    'hr201': 20,
    'undergrad': 4,
    'sm10x': 16,
    'sm10': 16,
    '89901-121': 16, // SkateDock numeric
    'default': 10
  }
  
  // Weight per unit (lbs)
  const weightPerUnit = {
    'dv215': 55,      // Varsity 2-pack - UPDATED from BOL validation
    '90101-2287': 55, // Varsity numeric SKU
    'dismount': 10,
    'vr2': 31,
    'vr1': 31,
    'dd4': 206,
    'dd6': 260,
    'mbv1': 312,
    'mbv2': 420,
    'visi1': 280,
    'visi2': 375,
    'hr101': 14,
    'hr201': 48,
    'undergrad': 85,
    'sm10x': 28,
    'sm10': 28,
    '89901-121': 28,
    'default': 50
  }
  
  let totalPallets = 0
  let totalWeight = 0
  const breakdown = []
  
  for (const item of items) {
    const skuLower = item.sku.toLowerCase()
    
    // Find matching rule
    let upp = unitsPerPallet.default
    let wpu = weightPerUnit.default
    
    for (const [key, val] of Object.entries(unitsPerPallet)) {
      if (key !== 'default' && skuLower.includes(key.toLowerCase())) {
        upp = val
        wpu = weightPerUnit[key] || weightPerUnit.default
        break
      }
    }
    
    const pallets = Math.ceil(item.qty / upp)
    const weight = item.qty * wpu
    
    totalPallets += pallets
    totalWeight += weight
    
    breakdown.push({
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      pallets,
      weight,
      rule: `${upp}/pallet, ${wpu}lbs/unit`
    })
  }
  
  return {
    totalPallets,
    totalWeight: Math.round(totalWeight),
    breakdown
  }
}

/**
 * Process a single BOL
 */
async function processBol(pdfPath, options = {}) {
  console.log(`\n📋 Processing BOL: ${pdfPath}`)
  
  // Parse the PDF
  const bol = parseBolPdf(pdfPath)
  if (!bol || !bol.soNumber) {
    console.error('❌ Could not parse BOL or find SO number')
    return null
  }
  
  console.log(`   HAWB: ${bol.hawb || 'N/A'}`)
  console.log(`   SO: ${bol.soNumber}`)
  console.log(`   Pallets: ${bol.pallets || 'N/A'}`)
  console.log(`   Weight: ${bol.weight || 'N/A'} lbs`)
  
  // Get SO items from NetSuite
  const items = await getSalesOrderItems(bol.soNumber)
  if (!items || items.length === 0) {
    console.error('❌ Could not get items for SO', bol.soNumber)
    return null
  }
  
  console.log(`   Items: ${items.length} line items`)
  
  // Run prediction
  const prediction = predictPallets(items)
  
  console.log(`\n🎯 Prediction:`)
  console.log(`   Pallets: ${prediction.totalPallets}`)
  console.log(`   Weight: ${prediction.totalWeight} lbs`)
  
  // Compare
  const palletVariance = (bol.pallets || 0) - prediction.totalPallets
  const weightVariance = (bol.weight || 0) - prediction.totalWeight
  
  console.log(`\n📊 Comparison:`)
  console.log(`   Pallet variance: ${palletVariance >= 0 ? '+' : ''}${palletVariance}`)
  console.log(`   Weight variance: ${weightVariance >= 0 ? '+' : ''}${weightVariance} lbs`)
  
  const result = {
    timestamp: new Date().toISOString(),
    hawb: bol.hawb,
    soNumber: bol.soNumber,
    shipDate: bol.shipDate,
    consignee: bol.consignee,
    actual: {
      pallets: bol.pallets,
      weight: bol.weight,
      dimensions: bol.dimensions
    },
    predicted: {
      pallets: prediction.totalPallets,
      weight: prediction.totalWeight,
      breakdown: prediction.breakdown
    },
    variance: {
      pallets: palletVariance,
      weight: weightVariance,
      palletAccurate: palletVariance === 0,
      withinOnePallet: Math.abs(palletVariance) <= 1
    },
    items
  }
  
  // Save result
  const resultFile = join(RESULTS_DIR, `SO${bol.soNumber}-${Date.now()}.json`)
  writeFileSync(resultFile, JSON.stringify(result, null, 2))
  console.log(`\n💾 Saved: ${resultFile}`)
  
  return result
}

/**
 * Check email for new BOLs
 */
async function checkEmailForBols() {
  console.log('📧 Checking email for new BOLs...')
  
  try {
    // Download recent emails with attachments
    const tmpDir = '/tmp/bol-downloads-' + Date.now()
    mkdirSync(tmpDir, { recursive: true })
    
    const output = execSync(
      `${EMAIL_CLI} --limit 5 --download-attachments "${tmpDir}" 2>&1`,
      { encoding: 'utf8' }
    )
    
    // Look for AIT BOL emails
    const aitEmails = output.split('------------------------------------------------------------')
      .filter(block => block.includes('aitworldwide.com') || block.includes('AIT:'))
    
    if (aitEmails.length === 0) {
      console.log('   No new AIT BOLs found')
      return []
    }
    
    console.log(`   Found ${aitEmails.length} AIT email(s)`)
    
    // Find downloaded PDFs
    const files = execSync(`find "${tmpDir}" -name "*.PDF" -o -name "*.pdf"`, { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
    
    const results = []
    for (const pdfPath of files) {
      const result = await processBol(pdfPath)
      if (result) results.push(result)
    }
    
    return results
  } catch (err) {
    console.error('Error checking email:', err.message)
    return []
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)
  
  if (args.includes('--file')) {
    const fileIndex = args.indexOf('--file')
    const pdfPath = args[fileIndex + 1]
    if (!pdfPath) {
      console.error('Please provide a PDF path: --file /path/to/bol.pdf')
      process.exit(1)
    }
    await processBol(pdfPath)
  } else if (args.includes('--watch')) {
    console.log('🔄 Starting continuous monitoring mode...')
    console.log('   Press Ctrl+C to stop\n')
    
    // Check immediately, then every 5 minutes
    await checkEmailForBols()
    setInterval(() => checkEmailForBols(), 5 * 60 * 1000)
  } else {
    // Single check
    await checkEmailForBols()
  }
}

main().catch(console.error)
