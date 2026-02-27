# Accuracy Baseline 2026-02-27T14:42:51.377Z

## Dataset
- validated rows: 491
- complete rows: 491
- complete + package_count rows: 0
- clean rows (complete + package_count + deduped): 477
- consistent clean rows (clean - legacy ambiguity - sentinel fallback): 307
- shipment completeness counts: `{"complete":491}`
- actual unit basis counts: `{"unknown":491}`
- basis filter fallback: `true` (no package_count rows found, used complete rows)

## Metrics

| Slice | Rows | Exact % | Within ±1 % | Within ±2 % | MAE | Bias | Severe Under % | Severe Over % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 491 | 61.91 | 90.63 | 95.93 | 0.56 | 0.10 | 4.28 | 5.09 |
| clean | 477 | 63.10 | 91.61 | 96.65 | 0.52 | 0.08 | 3.98 | 4.40 |
| consistent_clean | 307 | 67.43 | 96.42 | 99.35 | 0.37 | 0.17 | 0.33 | 3.26 |

## Clean Slice Breakdown
- single: exact 76.82%, within±1 94.46%, MAE 0.35
- multi: exact 38.64%, within±1 86.93%, MAE 0.82
- unknown: exact 91.67%, within±1 91.67%, MAE 0.17

### By Family Count (Clean)
- families=0: rows 12, exact 91.67%, within±1 91.67%, MAE 0.17
- families=1: rows 289, exact 76.82%, within±1 94.46%, MAE 0.35
- families=2: rows 104, exact 50.00%, within±1 92.31%, MAE 0.60
- families=3: rows 36, exact 27.78%, within±1 91.67%, MAE 0.81
- families=4+: rows 36, exact 16.67%, within±1 66.67%, MAE 1.47

### Top 20 Family Error Buckets (outside ±1, clean)
- VR2 Offset: 18
- LONG_TUBE: 16
- Hoop Runner: 11
- Double Docker: 11
- Base Station: 10
- ZERO_FLOOR: 6
- VR1 XL: 4
- Varsity: 4
- Circle Series (Omega): 3
- 2UP: 3
- Saris: 3
- MBA: 1
- Guardian: 1

### Top 20 SKU Error Buckets (outside ±1, clean)
- 81000-0114: 45
- 32000-0380-16SS: 45
- 31000-0380-0750-SS: 44
- 81000-0052: 43
- 81000-0054-HS: 43
- 81000-0055: 43
- 34010-0375-375-SS: 42
- 81000-0006: 42
- 81000-0005: 41
- 50101-0256-GAV: 38
- 3000Q-0250-100-BO: 34
- 50801-0012-GAV-120: 28
- 81000-0030: 22
- 81000-0008: 21
- 81000-0104: 20
- 50801-0014-BLK13: 17
- LONG-TUBE: 16
- 34051-0250-0200: 16
- 91000-0002-HS: 15
- 26268: 15

## SQL Used (Reference)
```sql
SELECT id, sales_order_id, pick_ticket_id, status, shipment_completeness, actual_unit_basis, predicted_pallets, actual_pallets, predicted_breakdown, validated_at, created_at
FROM validations
WHERE status = 'validated';
```