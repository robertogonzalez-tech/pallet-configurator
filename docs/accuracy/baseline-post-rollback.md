# Accuracy Baseline 2026-02-27T05:34:16.834Z

## Dataset
- validated rows: 491
- clean rows (complete + deduped): 477
- consistent clean rows (clean - legacy ambiguity - sentinel fallback): 288
- shipment completeness counts: `{"complete":491}`

## Metrics

| Slice | Rows | Exact % | Within ±1 % | Within ±2 % | MAE | Bias | Severe Under % | Severe Over % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| all | 491 | 61.10 | 89.41 | 95.52 | 0.58 | 0.03 | 5.70 | 4.89 |
| clean | 477 | 62.05 | 90.36 | 96.23 | 0.55 | 0.02 | 5.24 | 4.40 |
| consistent_clean | 288 | 67.01 | 95.49 | 99.31 | 0.39 | 0.18 | 0.35 | 4.17 |

## Clean Slice Breakdown
- single: exact 74.91%, within±1 93.19%, MAE 0.39
- multi: exact 37.95%, within±1 86.14%, MAE 0.84
- unknown: exact 75.00%, within±1 87.50%, MAE 0.38

### By Family Count (Clean)
- families=0: rows 32, exact 75.00%, within±1 87.50%, MAE 0.38
- families=1: rows 279, exact 74.91%, within±1 93.19%, MAE 0.39
- families=2: rows 96, exact 48.96%, within±1 90.63%, MAE 0.63
- families=3: rows 36, exact 27.78%, within±1 91.67%, MAE 0.81
- families=4+: rows 34, exact 17.65%, within±1 67.65%, MAE 1.47

### Top 20 Family Error Buckets (outside ±1, clean)
- LONG_TUBE: 15
- VR2 Offset: 15
- Hoop Runner: 13
- Double Docker: 12
- Base Station: 10
- ZERO_FLOOR: 9
- VR1 XL: 4
- Varsity: 4
- Circle Series (Omega): 3
- 2UP: 3
- Saris: 3
- Guardian: 1

### Top 20 SKU Error Buckets (outside ±1, clean)
- 32000-0380-16SS: 54
- 31000-0380-0750-SS: 53
- 34010-0375-375-SS: 51
- 81000-0114: 51
- 81000-0052: 45
- 81000-0054-HS: 45
- 81000-0055: 45
- 81000-0006: 44
- 81000-0005: 43
- 50101-0256-GAV: 40
- 3000Q-0250-100-BO: 36
- 50801-0012-GAV-120: 26
- 81000-0008: 22
- 81000-0030: 21
- 81000-0104: 20
- 91000-0002-HS: 17
- 34051-0250-0200: 17
- 26246: 16
- 26268: 16
- 50801-0014-BLK13: 16

## SQL Used (Reference)
```sql
SELECT id, sales_order_id, pick_ticket_id, status, shipment_completeness, predicted_pallets, actual_pallets, predicted_breakdown, validated_at, created_at
FROM validations
WHERE status = 'validated';
```