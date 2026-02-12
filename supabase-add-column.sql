-- Add actual_dimensions column to validations table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/shnjcjlhvhxkflpahvqh/sql/new

ALTER TABLE validations ADD COLUMN IF NOT EXISTS actual_dimensions JSONB;

-- Verify the column was added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'validations' 
  AND column_name = 'actual_dimensions';
