import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

async function verifySupabase() {
  console.log('🔍 Verifying Supabase connection...\n')
  
  // Check if we can query the validations table
  const { data, error } = await supabase
    .from('validations')
    .select('*')
    .limit(5)
  
  if (error) {
    console.error('❌ Supabase query failed:', error.message)
    process.exit(1)
  }
  
  console.log(`✅ Supabase connected! Found ${data.length} validation(s)`)
  
  if (data.length > 0) {
    console.log('\nSample record:', JSON.stringify(data[0], null, 2))
  } else {
    console.log('\n✨ Validations table is empty (expected after wipe)')
  }
}

verifySupabase()
