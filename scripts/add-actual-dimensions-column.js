require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function addColumn() {
  console.log('Adding actual_dimensions column to validations table...');
  
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: 'ALTER TABLE validations ADD COLUMN IF NOT EXISTS actual_dimensions JSONB;'
  });
  
  if (error) {
    console.error('Error adding column:', error);
    
    // Try direct query instead
    console.log('Trying direct query...');
    const { error: error2 } = await supabase
      .from('validations')
      .select('*')
      .limit(0);
    
    if (error2) {
      console.error('Direct query also failed:', error2);
    }
  } else {
    console.log('Column added successfully!');
  }
}

addColumn().catch(console.error);
