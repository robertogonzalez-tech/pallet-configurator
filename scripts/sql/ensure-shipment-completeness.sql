-- Safe migration: shipment semantics contract for evaluation/training slices.
-- Rollback:
--   ALTER TABLE validations DROP CONSTRAINT IF EXISTS validations_shipment_completeness_reason_not_blank_check;
--   ALTER TABLE validations DROP COLUMN IF EXISTS shipment_completeness_reason;
--   ALTER TABLE validations DROP CONSTRAINT IF EXISTS validations_actual_unit_basis_check;
--   ALTER TABLE validations DROP COLUMN IF EXISTS actual_positions;
--   ALTER TABLE validations DROP COLUMN IF EXISTS actual_unit_basis;
--   ALTER TABLE validations DROP CONSTRAINT IF EXISTS validations_shipment_completeness_check;
--   ALTER TABLE validations DROP COLUMN IF EXISTS shipment_completeness;

ALTER TABLE validations
ADD COLUMN IF NOT EXISTS shipment_completeness TEXT;

UPDATE validations
SET shipment_completeness = 'unknown'
WHERE shipment_completeness IS NULL;

ALTER TABLE validations
ALTER COLUMN shipment_completeness SET DEFAULT 'unknown';

ALTER TABLE validations
ALTER COLUMN shipment_completeness SET NOT NULL;

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

ALTER TABLE validations
ADD COLUMN IF NOT EXISTS shipment_completeness_reason TEXT;

UPDATE validations
SET shipment_completeness_reason = 'legacy_unspecified'
WHERE shipment_completeness_reason IS NULL OR btrim(shipment_completeness_reason) = '';

ALTER TABLE validations
ALTER COLUMN shipment_completeness_reason SET DEFAULT 'legacy_unspecified';

ALTER TABLE validations
ALTER COLUMN shipment_completeness_reason SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'validations_shipment_completeness_reason_not_blank_check'
  ) THEN
    ALTER TABLE validations
      ADD CONSTRAINT validations_shipment_completeness_reason_not_blank_check
      CHECK (length(btrim(shipment_completeness_reason)) > 0);
  END IF;
END $$;

ALTER TABLE validations
ADD COLUMN IF NOT EXISTS actual_unit_basis TEXT;

UPDATE validations
SET actual_unit_basis = 'unknown'
WHERE actual_unit_basis IS NULL;

ALTER TABLE validations
ALTER COLUMN actual_unit_basis SET DEFAULT 'unknown';

ALTER TABLE validations
ALTER COLUMN actual_unit_basis SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'validations_actual_unit_basis_check'
  ) THEN
    ALTER TABLE validations
      ADD CONSTRAINT validations_actual_unit_basis_check
      CHECK (actual_unit_basis IN ('package_count', 'pallet_positions', 'unknown'));
  END IF;
END $$;

ALTER TABLE validations
ADD COLUMN IF NOT EXISTS actual_positions INTEGER;
