require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function clearAllValidations() {
  // First, count how many rows exist
  const { count, error: countError } = await supabase
    .from('validations')
    .select('*', { count: 'exact', head: true });
  
  if (countError) {
    console.error('❌ Error counting validations:', countError);
    return;
  }
  
  console.log(`Found ${count} validation rows`);
  
  if (count === 0) {
    console.log('✅ No rows to delete');
    return;
  }
  
  console.log('Deleting all validation rows...');
  
  const { error } = await supabase
    .from('validations')
    .delete()
    .not('id', 'is', null); // Delete all rows (id is never null)
  
  if (error) {
    console.error('❌ Error deleting validations:', error);
  } else {
    console.log(`✅ Deleted ${count} validation rows`);
  }
}

clearAllValidations().catch(console.error);
