import { google } from 'googleapis'
import fs from 'fs'

const credentials = JSON.parse(
  fs.readFileSync('/Users/brooke/.config/clawdbot/google-sheets-service-account.json', 'utf8')
)

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
})

const sheets = google.sheets({ version: 'v4', auth })
const drive = google.drive({ version: 'v3', auth })

async function createSheet() {
  console.log('📊 Creating validation tracking sheet...\n')
  
  // Create new spreadsheet
  const createResponse = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: 'GCS Pallet Validation Tracking'
      },
      sheets: [{
        properties: {
          title: 'Validations',
          gridProperties: {
            frozenRowCount: 1
          }
        },
        data: [{
          startRow: 0,
          startColumn: 0,
          rowData: [{
            values: [
              { userEnteredValue: { stringValue: 'Timestamp' } },
              { userEnteredValue: { stringValue: 'SO Number' } },
              { userEnteredValue: { stringValue: 'Validated By' } },
              { userEnteredValue: { stringValue: 'Predicted Pallets' } },
              { userEnteredValue: { stringValue: 'Actual Pallets' } },
              { userEnteredValue: { stringValue: 'Pallet Variance' } },
              { userEnteredValue: { stringValue: 'Predicted Weight' } },
              { userEnteredValue: { stringValue: 'Actual Weight' } },
              { userEnteredValue: { stringValue: 'Weight Variance' } },
              { userEnteredValue: { stringValue: 'Accurate?' } },
              { userEnteredValue: { stringValue: 'Within 1?' } },
              { userEnteredValue: { stringValue: 'Notes' } }
            ]
          }]
        }]
      }]
    }
  })
  
  const spreadsheetId = createResponse.data.spreadsheetId
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
  
  console.log('✅ Sheet created!')
  console.log('   ID:', spreadsheetId)
  console.log('   URL:', spreadsheetUrl)
  
  // Share with Berto
  await drive.permissions.create({
    fileId: spreadsheetId,
    requestBody: {
      role: 'writer',
      type: 'user',
      emailAddress: 'berto@groundcontrolsystems.com'
    }
  })
  
  console.log('\n✅ Shared with berto@groundcontrolsystems.com (edit access)')
  
  // Save spreadsheet ID to .env.local
  const envPath = '.env.local'
  let envContent = fs.readFileSync(envPath, 'utf8')
  
  if (envContent.includes('VALIDATION_SHEET_ID=')) {
    envContent = envContent.replace(/VALIDATION_SHEET_ID=.*/g, `VALIDATION_SHEET_ID=${spreadsheetId}`)
  } else {
    envContent += `\n\n# Google Sheets backup\nVALIDATION_SHEET_ID=${spreadsheetId}\n`
  }
  
  fs.writeFileSync(envPath, envContent)
  console.log('\n✅ Saved VALIDATION_SHEET_ID to .env.local')
  console.log('\n📋 Next: Add this to Vercel env vars:')
  console.log(`   VALIDATION_SHEET_ID=${spreadsheetId}`)
}

createSheet()
