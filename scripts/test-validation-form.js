import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

async function testFormSubmission() {
  console.log('🧪 Testing validation form submission...\n')
  
  const testData = {
    soNumber: '7263',
    validatedBy: 'Brooke',
    pallets: [
      { weight: 366, length: 48, width: 40, height: 48 }
    ],
    notes: 'Test submission from validation form - end-to-end test'
  }
  
  console.log('📤 Submitting test data:', JSON.stringify(testData, null, 2))
  
  const response = await fetch('https://pallet-configurator.vercel.app/api/validate-shipment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testData)
  })
  
  if (!response.ok) {
    console.error('❌ Request failed:', response.status, response.statusText)
    const text = await response.text()
    console.error('Response:', text)
    process.exit(1)
  }
  
  const result = await response.json()
  console.log('\n✅ Response:', JSON.stringify(result, null, 2))
  
  if (result.validationId) {
    console.log('\n✨ Validation saved! ID:', result.validationId)
  }
}

testFormSubmission()
