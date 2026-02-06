-- Pallet Configurator Database Schema
-- Run this in Supabase SQL Editor to create tables

-- ============================================
-- VALIDATIONS TABLE
-- Stores comparison between predicted vs actual packing
-- ============================================
CREATE TABLE IF NOT EXISTS validations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Reference to the order
  pick_ticket_id TEXT NOT NULL,
  sales_order_id TEXT,
  quote_number TEXT,
  
  -- Prediction data (from configurator)
  predicted_pallets INTEGER NOT NULL,
  predicted_weight_lbs NUMERIC(10,2),
  predicted_items JSONB, -- [{sku, qty, dims, weight}]
  prediction_timestamp TIMESTAMPTZ,
  
  -- Actual data (from warehouse)
  actual_pallets INTEGER,
  actual_weight_lbs NUMERIC(10,2),
  actual_notes TEXT,
  validated_by TEXT, -- Who entered the validation (e.g., "Chad")
  validation_timestamp TIMESTAMPTZ,
  
  -- Calculated accuracy
  pallet_variance INTEGER GENERATED ALWAYS AS (actual_pallets - predicted_pallets) STORED,
  weight_variance_lbs NUMERIC(10,2) GENERATED ALWAYS AS (actual_weight_lbs - predicted_weight_lbs) STORED,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'validated', 'needs_review'))
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_validations_pick_ticket ON validations(pick_ticket_id);
CREATE INDEX IF NOT EXISTS idx_validations_status ON validations(status);
CREATE INDEX IF NOT EXISTS idx_validations_created ON validations(created_at DESC);

-- ============================================
-- CORRECTIONS TABLE
-- Stores product-level corrections when prediction was wrong
-- ============================================
CREATE TABLE IF NOT EXISTS corrections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Link to validation
  validation_id UUID REFERENCES validations(id) ON DELETE CASCADE,
  
  -- Product info
  sku TEXT NOT NULL,
  product_name TEXT,
  
  -- What was wrong
  correction_type TEXT NOT NULL CHECK (correction_type IN (
    'dimensions', -- Dims were wrong
    'weight',     -- Weight was wrong
    'packing',    -- Packing rule was wrong (e.g., nesting)
    'quantity',   -- Qty on pick ticket was wrong
    'other'       -- Other issue
  )),
  
  -- Correction details
  predicted_value JSONB, -- What we predicted {dims: {l,w,h}, weight, etc}
  actual_value JSONB,    -- What it actually was
  notes TEXT,
  
  -- Status
  applied BOOLEAN DEFAULT FALSE, -- Has this been applied to productModels.js?
  applied_at TIMESTAMPTZ
);

-- Index for finding corrections by SKU
CREATE INDEX IF NOT EXISTS idx_corrections_sku ON corrections(sku);
CREATE INDEX IF NOT EXISTS idx_corrections_validation ON corrections(validation_id);
CREATE INDEX IF NOT EXISTS idx_corrections_unapplied ON corrections(applied) WHERE applied = FALSE;

-- ============================================
-- ATTACHMENTS TABLE
-- Stores photos of packed pallets
-- ============================================
CREATE TABLE IF NOT EXISTS attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Link to validation
  validation_id UUID REFERENCES validations(id) ON DELETE CASCADE,
  
  -- File info
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Supabase Storage path
  file_size INTEGER,
  mime_type TEXT,
  
  -- Metadata
  pallet_number INTEGER, -- Which pallet is this photo of (1, 2, 3...)
  notes TEXT
);

-- Index for finding attachments by validation
CREATE INDEX IF NOT EXISTS idx_attachments_validation ON attachments(validation_id);

-- ============================================
-- VIEWS FOR REPORTING
-- ============================================

-- Accuracy summary view
CREATE OR REPLACE VIEW validation_accuracy AS
SELECT 
  COUNT(*) as total_validations,
  COUNT(*) FILTER (WHERE pallet_variance = 0) as exact_matches,
  COUNT(*) FILTER (WHERE ABS(pallet_variance) <= 1) as within_one,
  ROUND(100.0 * COUNT(*) FILTER (WHERE pallet_variance = 0) / NULLIF(COUNT(*), 0), 1) as exact_match_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE ABS(pallet_variance) <= 1) / NULLIF(COUNT(*), 0), 1) as within_one_pct,
  ROUND(AVG(ABS(weight_variance_lbs)), 1) as avg_weight_variance_lbs,
  ROUND(AVG(ABS(pallet_variance)), 2) as avg_pallet_variance
FROM validations
WHERE status = 'validated';

-- Products needing attention (multiple corrections)
CREATE OR REPLACE VIEW products_needing_correction AS
SELECT 
  sku,
  product_name,
  COUNT(*) as correction_count,
  ARRAY_AGG(DISTINCT correction_type) as correction_types,
  MAX(created_at) as last_correction
FROM corrections
WHERE applied = FALSE
GROUP BY sku, product_name
HAVING COUNT(*) >= 2
ORDER BY correction_count DESC;

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- For now, allow all authenticated users to read/write
-- ============================================
ALTER TABLE validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "Allow all for authenticated users" ON validations
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON corrections
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON attachments
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- STORAGE BUCKET FOR PHOTOS
-- Run this separately in Supabase Dashboard > Storage
-- ============================================
-- CREATE BUCKET: pallet-photos
-- Public: No
-- File size limit: 10MB
-- Allowed MIME types: image/jpeg, image/png, image/webp
