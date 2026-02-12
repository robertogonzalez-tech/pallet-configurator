require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function deleteTestValidation() {
  const validationId = '76c742a4-cba9-4025-91f3-5721a5370aed';
  
  const { error } = await supabase
    .from('validations')
    .delete()
    .eq('id', validationId);
  
  if (error) {
    console.error('Error deleting validation:', error);
  } else {
    console.log(`✅ Deleted test validation ${validationId}`);
  }
}

deleteTestValidation().catch(console.error);
