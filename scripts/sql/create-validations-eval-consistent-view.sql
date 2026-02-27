-- Canonical consistent evaluation slice:
-- - validated rows only
-- - complete shipments
-- - package-count basis only
-- - one row per SO (latest by validated_at/created_at)
-- - excludes legacy SO5/SO6 ambiguity era
-- - excludes rows that required sentinel fallback predictions

create or replace view validations_eval_consistent as
with ranked as (
  select
    v.*,
    row_number() over (
      partition by v.sales_order_id
      order by v.validated_at desc nulls last, v.created_at desc nulls last, v.id desc
    ) as rn
  from validations v
  where v.status = 'validated'
    and lower(coalesce(v.shipment_completeness, 'unknown')) = 'complete'
    and lower(coalesce(v.actual_unit_basis, 'unknown')) = 'package_count'
)
select r.*
from ranked r
where r.rn = 1
  and upper(coalesce(r.sales_order_id, '')) !~ '^SO[56]'
  and not exists (
    select 1
    from jsonb_array_elements(coalesce(r.predicted_breakdown::jsonb, '[]'::jsonb)) as e
    where upper(coalesce(e->>'matched', '')) in ('ZERO_FLOOR', 'UNKNOWN_FALLBACK')
  );

