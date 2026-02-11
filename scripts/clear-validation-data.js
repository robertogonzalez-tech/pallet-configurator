#!/usr/bin/env node
/**
 * Clear all validation data from Supabase
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function clearData() {
  console.log('🗑️  Clearing validation data from Supabase...\n')
  
  // Delete in order (foreign key constraints)
  const tables = ['corrections', 'attachments', 'validations']
  
  for (const table of tables) {
    console.log(`Deleting from ${table}...`)
    const { error, count } = await supabase
      .from(table)
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all rows
    
    if (error) {
      console.error(`❌ Error deleting from ${table}:`, error.message)
    } else {
      console.log(`✅ Deleted all rows from ${table}`)
    }
  }
  
  console.log('\n✅ All validation data cleared')
}

clearData().catch(console.error)
