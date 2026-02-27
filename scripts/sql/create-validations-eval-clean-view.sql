-- Deterministic clean evaluation slice.
-- Includes only complete shipments with package-count semantics and keeps latest row per SO.
-- Rollback:
--   DROP VIEW IF EXISTS validations_eval_clean;

CREATE OR REPLACE VIEW validations_eval_clean AS
WITH ranked AS (
  SELECT
    v.*,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(v.sales_order_id, v.pick_ticket_id, v.id::text)
      ORDER BY v.validated_at DESC NULLS LAST, v.created_at DESC NULLS LAST, v.id DESC
    ) AS rn
  FROM validations v
  WHERE v.status = 'validated'
    AND COALESCE(v.shipment_completeness, 'unknown') = 'complete'
    AND COALESCE(v.actual_unit_basis, 'unknown') = 'package_count'
)
SELECT *
FROM ranked
WHERE rn = 1;
