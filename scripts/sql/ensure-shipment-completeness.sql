-- Safe migration: shipment completeness tracking for evaluation slices.
-- Rollback:
--   ALTER TABLE validations DROP COLUMN IF EXISTS shipment_completeness;

ALTER TABLE validations
ADD COLUMN IF NOT EXISTS shipment_completeness TEXT;

UPDATE validations
SET shipment_completeness = 'unknown'
WHERE shipment_completeness IS NULL;

ALTER TABLE validations
ALTER COLUMN shipment_completeness SET DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'validations_shipment_completeness_check'
  ) THEN
    ALTER TABLE validations
      ADD CONSTRAINT validations_shipment_completeness_check
      CHECK (shipment_completeness IN ('complete', 'partial', 'unknown'));
  END IF;
END $$;
