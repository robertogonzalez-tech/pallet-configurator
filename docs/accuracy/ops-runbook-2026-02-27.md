# Package Prediction Ops Runbook (2026-02-27)

## 1) Baseline / Eval
Run full reproducible eval (all validated + clean deduped complete slice):

```bash
npm run eval:accuracy -- --write-report --tag=<label>
```

Outputs:
- `docs/accuracy/baseline-<label>.json`
- `docs/accuracy/baseline-<label>.md`

Key metrics to track:
- `exact_pct`
- `within_1_pct`
- `within_2_pct`
- `mae`
- `bias`
- `severe_under_rate` (actual - predicted >= 2)

## 2) Safe Reprocess (Guarded Writes)
Dry-run + gate checks (no DB writes):

```bash
npm run reprocess:guarded
```

Live write (only after gates pass):

```bash
npm run reprocess:guarded -- --apply
```

Gate rules:
- exact must not drop by > 1.0 point
- within ±1 must not drop by > 1.0 point
- MAE must not worsen

If any gate fails, live write is aborted automatically.

## 3) No Silent Drops / Blindness Audit
Run blindness report on top misses:

```bash
npm run report:blindness -- --limit=50 --write-report
```

Outputs:
- `docs/accuracy/blindness-report-<date>.json`
- `docs/accuracy/blindness-report-<date>.md`

Use this to identify excluded but likely-physical SKUs (rails/tubes/kits).

## 4) SKU Mapping Updates
Primary config:
- `config/sku-classification.json`

When adding/changing SKU behavior:
1. Update classification patterns.
2. Run classifier contract test:
   ```bash
   npm run test:classifier
   ```
3. Run eval:
   ```bash
   npm run eval:accuracy -- --write-report --tag=<label>
   ```
4. Run guarded dry-run:
   ```bash
   npm run reprocess:guarded
   ```

## 5) Debug a Bad Prediction Quickly
Use API debug mode to inspect line accounting.

Endpoint:
- `POST /api/validate-shipment`

Payload example:
```json
{
  "salesOrderNumber": "7652",
  "skipSave": true,
  "debug": true
}
```

Inspect:
- `diagnostics.raw_lines`
- `diagnostics.included_lines`
- `diagnostics.excluded_lines`
- `diagnostics.unknown_skus`
- `diagnostics.filter_stats`

If a physical SKU is excluded incorrectly, fix classifier rules before tuning recipes.

## 6) Canonical Output Contract
Canonical:
- `prediction.packages[]` (dims + weight + contents)
- `prediction.summary`

Compatibility fields retained:
- `predicted_pallets`
- `predicted_weight`
- `predicted_breakdown`
- `predicted_packages`

## 7) Rollback
Code rollback:
```bash
git revert <bad_commit_hash>
git push origin main
```

Data rollback:
- Predictions are regenerated via reprocess.
- Re-run prior known-good commit with guarded apply:
  ```bash
  npm run reprocess:guarded -- --apply
  ```

Schema rollback (if needed):
- `scripts/sql/ensure-shipment-completeness.sql` includes rollback notes.
- `scripts/sql/create-validations-eval-clean-view.sql` includes rollback notes.
