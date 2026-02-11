#!/usr/bin/env node
/**
 * Google Drive BOL Watcher
 * 
 * Monitors a Google Drive folder for new BOL PDFs and runs validation automatically.
 * 
 * Setup:
 * 1. Share a Google Drive folder with: brooke-sheets@brooke-485505.iam.gserviceaccount.com
 * 2. Set DRIVE_BOL_FOLDER_ID env var (or pass --folder-id)
 * 3. Run: node watch-drive-bols.js --watch
 * 
 * Usage:
 *   node watch-drive-bols.js --folder-id FOLDER_ID        # Process new files once
 *   node watch-drive-bols.js --folder-id FOLDER_ID --watch # Continuous monitoring
 *   node watch-drive-bols.js --file-id FILE_ID            # Process a specific file
 */

import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

// Load environment variables from .env.local
const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const RESULTS_DIR = join(__dirname, '../validation-results')
const STATE_FILE = join(__dirname, '../.drive-watcher-state.json')
const CREDENTIALS_PATH = process.env.HOME + '/.config/clawdbot/google-sheets-service-account.json'
const NETSUITE_CLI = process.env.HOME + '/clawd/bin/brooke-netsuite'

// Initialize Supabase client
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null

if (!supabase) {
  console.warn('⚠️  Supabase not configured - results will only be saved locally')
}

// Ensure results directory exists
if (!existsSync(RESULTS_DIR)) {
  mkdirSync(RESULTS_DIR, { recursive: true })
}

// Load or initialize state (tracks processed files)
function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    }
  } catch (err) {
    console.error('Error loading state:', err.message)
  }
  return { processedFiles: [], lastCheck: null }
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// Initialize Google Drive API
async function getDriveClient() {
  const credentials = JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8'))
  
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  })
  
  return google.drive({ version: 'v3', auth })
}

// List PDF files in folder
async function listBolFiles(drive, folderId) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`,
    fields: 'files(id, name, createdTime, modifiedTime)',
    orderBy: 'createdTime desc',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 50
  })
  
  return response.data.files || []
}

// Download file to temp location
async function downloadFile(drive, fileId, fileName) {
  const tmpPath = `/tmp/bol-${fileId}-${Date.now()}.pdf`
  
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  )
  
  writeFileSync(tmpPath, Buffer.from(response.data))
  console.log(`   Downloaded: ${fileName} → ${tmpPath}`)
  
  return tmpPath
}

// Parse BOL PDF (reused from process-bol.js)
function parseBolPdf(pdfPath) {
  try {
    const text = execSync(`pdftotext -layout "${pdfPath}" -`, { encoding: 'utf8' })
    const fields = {}
    
    // HAWB/Air Bill Number
    const hawbMatch = text.match(/(\d{8})\s*$/m) || text.match(/AIR BILL NO\..*?(\d{8})/is)
    if (hawbMatch) fields.hawb = hawbMatch[1]
    
    // Shipper Reference Number (Sales Order)
    const shipperLine = text.split('\n').find(l => /^\d{10}\s+\d{4,}/.test(l.trim()))
    if (shipperLine) {
      const soMatch = shipperLine.match(/^\d{10}\s+(\d{4,})/)
      if (soMatch) fields.soNumber = soMatch[1]
    }
    if (!fields.soNumber) {
      const soMatch2 = text.match(/SHIPPER REFERENCE NUMBER.*?(\d{4,6})/is)
      if (soMatch2) fields.soNumber = soMatch2[1]
    }
    
    // Packages and weight from "1 BIKE RACKS ... 1104" line
    const packageLine = text.split('\n').find(l => /\d+\s+BIKE RACKS/i.test(l))
    if (packageLine) {
      const pcsMatch = packageLine.match(/(\d+)\s+BIKE RACKS/i)
      if (pcsMatch) fields.pallets = parseInt(pcsMatch[1])
      const weightMatch = packageLine.match(/(\d{3,})\s*$/)
      if (weightMatch) fields.weight = parseInt(weightMatch[1])
    }
    
    // Ship date
    const dateMatch = text.match(/DATE SHIPPED\s*[\n\r]+.*?(\d{1,2}\/\d{1,2}\/\d{2,4})/is)
    if (dateMatch) fields.shipDate = dateMatch[1]
    
    // Consignee
    const consigneeMatch = text.match(/CONSIGNEE INFORMATION\s*[\n\r]+\s*([A-Z][A-Z\s&]+)/i)
    if (consigneeMatch) fields.consignee = consigneeMatch[1].trim()
    
    return fields
  } catch (err) {
    console.error('Error parsing PDF:', err.message)
    return null
  }
}

// Get sales order items from NetSuite
async function getSalesOrderItems(soNumber) {
  try {
    const tranQuery = `SELECT id, tranid FROM transaction WHERE recordtype = 'salesorder' AND tranid = 'SO${soNumber}'`
    const tranResult = JSON.parse(execSync(`${NETSUITE_CLI} sql "${tranQuery}"`, { encoding: 'utf8' }))
    
    if (!tranResult.success || tranResult.count === 0) {
      console.error(`   Sales order SO${soNumber} not found`)
      return null
    }
    
    const tranId = tranResult.results[0].id
    
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
    
    if (!itemsResult.success) return null
    
    return itemsResult.results.map(r => ({
      sku: r.itemid,
      name: r.displayname || r.memo,
      qty: Math.abs(r.quantity)
    }))
  } catch (err) {
    console.error('Error getting SO items:', err.message)
    return null
  }
}

// Run configurator prediction
function predictPallets(items) {
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
  }
  
  const weightPerUnit = {
    'dv215': 55, '90101-2287': 55,  // UPDATED from BOL validation
    'dismount': 10,
    'vr2': 31, 'vr1': 31,
    'dd4': 206, 'dd6': 260,
    'mbv1': 312, 'mbv2': 420,
    'visi1': 280, 'visi2': 375,
    'hr101': 14, 'hr201': 48,
    'undergrad': 85,
    'sm10x': 28, 'sm10': 28, '89901-121': 28,
    'default': 50
  }
  
  let totalPallets = 0
  let totalWeight = 0
  const breakdown = []
  
  for (const item of items) {
    const skuLower = item.sku.toLowerCase()
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
    breakdown.push({ sku: item.sku, name: item.name, qty: item.qty, pallets, weight })
  }
  
  return { totalPallets, totalWeight: Math.round(totalWeight), breakdown }
}

// Process a single BOL file
async function processBolFile(drive, fileId, fileName) {
  console.log(`\n📋 Processing: ${fileName}`)
  
  let pdfPath = null
  
  try {
    // Download the file
    pdfPath = await downloadFile(drive, fileId, fileName)
    
    // Parse the PDF
    const bol = parseBolPdf(pdfPath)
    if (!bol || !bol.soNumber) {
      console.error('   ❌ Could not parse BOL or find SO number')
      return null
    }
    
    console.log(`   HAWB: ${bol.hawb || 'N/A'}`)
    console.log(`   SO: ${bol.soNumber}`)
    console.log(`   Pallets: ${bol.pallets || 'N/A'}`)
    console.log(`   Weight: ${bol.weight || 'N/A'} lbs`)
    
    // Get SO items from NetSuite
    const items = await getSalesOrderItems(bol.soNumber)
    if (!items || items.length === 0) {
      console.error('   ❌ Could not get items for SO', bol.soNumber)
      return null
    }
    
    console.log(`   Items: ${items.length} line items (before filtering)`)
    
    // Filter out hardware/kit items that pack with main products
    const kitSkuPatterns = [
      /^80101-0257-.+-KIT$/i, // DD4 hardware kit
      /^80101-0258-.+-KIT$/i, // DD6 hardware kit
      /^91000-/i,             // Hardware tools
      /^WAK\d+$/i,            // Wall anchor kits
      /^26268$/i,             // Work Stand Install Kit
      /^3000[PQ]-/i,          // Screws
      /^31000-/i,             // Washers
      /^39000-/i,             // Nuts
      /^50801-/i,             // Unistrut
      /^81000-/i,             // Anchor/hardware kits
    ]
    
    const filteredItems = items.filter(item => {
      return !kitSkuPatterns.some(pattern => pattern.test(item.sku))
    })
    
    console.log(`   Items: ${filteredItems.length} line items (after filtering, ${items.length - filteredItems.length} hardware items skipped)`)
    
    // Run prediction
    const prediction = predictPallets(filteredItems)
    
    console.log(`\n   🎯 Prediction: ${prediction.totalPallets} pallets, ${prediction.totalWeight} lbs`)
    
    // Compare
    const palletVariance = (bol.pallets || 0) - prediction.totalPallets
    const weightVariance = (bol.weight || 0) - prediction.totalWeight
    
    console.log(`   📊 Variance: ${palletVariance >= 0 ? '+' : ''}${palletVariance} pallets, ${weightVariance >= 0 ? '+' : ''}${weightVariance} lbs`)
    
    const result = {
      timestamp: new Date().toISOString(),
      source: 'google-drive',
      driveFileId: fileId,
      fileName,
      hawb: bol.hawb,
      soNumber: bol.soNumber,
      shipDate: bol.shipDate,
      consignee: bol.consignee,
      actual: { pallets: bol.pallets, weight: bol.weight },
      predicted: { pallets: prediction.totalPallets, weight: prediction.totalWeight, breakdown: prediction.breakdown },
      variance: {
        pallets: palletVariance,
        weight: weightVariance,
        palletAccurate: palletVariance === 0,
        withinOnePallet: Math.abs(palletVariance) <= 1
      },
      items
    }
    
    // Save result to local JSON
    const resultFile = join(RESULTS_DIR, `SO${bol.soNumber}-${Date.now()}.json`)
    writeFileSync(resultFile, JSON.stringify(result, null, 2))
    console.log(`   💾 Saved locally: ${resultFile}`)
    
    // Save to Supabase
    if (supabase) {
      try {
        const { error } = await supabase.from('validations').insert({
          pick_ticket_id: `SO${bol.soNumber}`,
          sales_order_id: `SO${bol.soNumber}`,
          predicted_pallets: prediction.totalPallets,
          predicted_weight: prediction.totalWeight,
          predicted_breakdown: prediction.breakdown,
          actual_pallets: bol.pallets,
          actual_weight: bol.weight,
          actual_notes: `HAWB: ${bol.hawb}, Consignee: ${bol.consignee}`,
          validated_by: 'System',
          validated_at: bol.shipDate ? new Date(bol.shipDate).toISOString() : new Date().toISOString(),
          status: 'validated'
        })
        
        if (error) {
          console.error('   ❌ Supabase error:', error.message)
        } else {
          console.log('   ✅ Saved to Supabase')
        }
      } catch (err) {
        console.error('   ❌ Failed to save to Supabase:', err.message)
      }
    }
    
    return result
  } catch (err) {
    console.error(`   ❌ Error processing file: ${err.message}`)
    return null
  } finally {
    // Cleanup temp file
    if (pdfPath) {
      try { unlinkSync(pdfPath) } catch {}
    }
  }
}

// Main watch loop
async function watchFolder(folderId, interval = 5 * 60 * 1000) {
  console.log(`🔄 Watching Drive folder: ${folderId}`)
  console.log(`   Checking every ${interval / 60000} minutes`)
  console.log('   Press Ctrl+C to stop\n')
  
  const drive = await getDriveClient()
  const state = loadState()
  
  async function checkForNewFiles() {
    try {
      console.log(`\n⏰ Checking for new BOLs... (${new Date().toLocaleTimeString()})`)
      
      const files = await listBolFiles(drive, folderId)
      console.log(`   Found ${files.length} PDF files in folder`)
      
      // Filter to unprocessed files
      const newFiles = files.filter(f => !state.processedFiles.includes(f.id))
      
      if (newFiles.length === 0) {
        console.log('   No new files to process')
        return
      }
      
      console.log(`   📥 ${newFiles.length} new file(s) to process`)
      
      for (const file of newFiles) {
        try {
          const result = await processBolFile(drive, file.id, file.name)
          
          // Alert on significant variance
          if (result && Math.abs(result.variance.pallets) >= 2) {
            console.log(`\n   ⚠️  ALERT: Large pallet variance (${result.variance.pallets}) for SO${result.soNumber}`)
            // TODO: Send Discord notification here
          }
        } catch (err) {
          console.error(`   ❌ Failed to process ${file.name}: ${err.message}`)
        }
        
        // Mark as processed regardless of success (to avoid reprocessing bad files)
        state.processedFiles.push(file.id)
        
        // Keep only last 500 processed file IDs
        if (state.processedFiles.length > 500) {
          state.processedFiles = state.processedFiles.slice(-500)
        }
      }
      
      state.lastCheck = new Date().toISOString()
      saveState(state)
      
    } catch (err) {
      console.error('❌ Error checking for files:', err.message)
      console.error('   Will retry on next check...')
    }
  }
  
  // Check immediately, then on interval (wrap in try/catch to prevent initial failure from crashing)
  try {
    await checkForNewFiles()
  } catch (err) {
    console.error('❌ Initial check failed:', err.message)
    console.error('   Will retry on next interval...')
  }
  setInterval(checkForNewFiles, interval)
}

// Process a single file by ID
async function processFileById(fileId) {
  try {
    const drive = await getDriveClient()
    
    // Get file metadata
    const response = await drive.files.get({
      fileId,
      fields: 'id, name'
    })
    
    await processBolFile(drive, fileId, response.data.name)
  } catch (err) {
    console.error('❌ Error processing file:', err.message)
    throw err // Re-throw for single file processing (not watch mode)
  }
}

// Main
async function main() {
  const args = process.argv.slice(2)
  
  // Parse arguments
  const folderId = args.includes('--folder-id') 
    ? args[args.indexOf('--folder-id') + 1]
    : process.env.DRIVE_BOL_FOLDER_ID
  
  const fileId = args.includes('--file-id')
    ? args[args.indexOf('--file-id') + 1]
    : null
  
  const watch = args.includes('--watch')
  
  if (fileId) {
    await processFileById(fileId)
  } else if (folderId) {
    if (watch) {
      await watchFolder(folderId)
    } else {
      // Single check
      const drive = await getDriveClient()
      const state = loadState()
      const files = await listBolFiles(drive, folderId)
      const newFiles = files.filter(f => !state.processedFiles.includes(f.id))
      
      console.log(`Found ${newFiles.length} new BOL(s) to process`)
      
      for (const file of newFiles) {
        await processBolFile(drive, file.id, file.name)
        state.processedFiles.push(file.id)
      }
      
      state.lastCheck = new Date().toISOString()
      saveState(state)
    }
  } else {
    console.log(`
Google Drive BOL Watcher

Usage:
  node watch-drive-bols.js --folder-id FOLDER_ID           # Process new files once
  node watch-drive-bols.js --folder-id FOLDER_ID --watch   # Continuous monitoring
  node watch-drive-bols.js --file-id FILE_ID               # Process specific file

Setup:
  1. Share a Drive folder with: brooke-sheets@brooke-485505.iam.gserviceaccount.com
  2. Get the folder ID from the URL (after /folders/)
  3. Run with --folder-id

Environment:
  DRIVE_BOL_FOLDER_ID    Folder ID (alternative to --folder-id)
`)
  }
}

main().catch(console.error)
