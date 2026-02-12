require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function checkValidation() {
  const { data, error } = await supabase
    .from('validations')
    .select('*')
    .eq('id', '76c742a4-cba9-4025-91f3-5721a5370aed')
    .single();
  
  if (error) {
    console.error('Error fetching validation:', error);
    return;
  }
  
  console.log('Validation row found:');
  console.log(JSON.stringify(data, null, 2));
}

checkValidation().catch(console.error);
