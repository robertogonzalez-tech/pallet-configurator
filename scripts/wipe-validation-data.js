import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
)

async function wipeData() {
  console.log('🗑️  Wiping validation data from Supabase...\n')
  
  // Delete in order: corrections → attachments → validations
  const { error: correctionsError, count: correctionsCount } = await supabase
    .from('corrections')
    .delete()
    .gte('created_at', '2000-01-01') // Delete all (matches everything)
  
  if (correctionsError) {
    console.error('❌ Error deleting corrections:', correctionsError.message)
    process.exit(1)
  }
  console.log('✅ Deleted all corrections')
  
  const { error: attachmentsError, count: attachmentsCount } = await supabase
    .from('attachments')
    .delete()
    .gte('created_at', '2000-01-01')
  
  if (attachmentsError) {
    console.error('❌ Error deleting attachments:', attachmentsError.message)
    process.exit(1)
  }
  console.log('✅ Deleted all attachments')
  
  const { error: validationsError, count: validationsCount } = await supabase
    .from('validations')
    .delete()
    .gte('created_at', '2000-01-01')
  
  if (validationsError) {
    console.error('❌ Error deleting validations:', validationsError.message)
    process.exit(1)
  }
  console.log('✅ Deleted all validations')
  
  console.log('\n✨ All validation data wiped successfully!')
}

wipeData()
