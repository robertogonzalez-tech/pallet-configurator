# Pallet Configurator — Verified Specs

*Last updated: 2026-02-03 (Chad's Feb 3 answers incorporated)*

---

## DD4 Components — CONFIRMED

| Component | Per DD4 | Source |
|-----------|---------|--------|
| Slides | 2 | Feb 2 |
| Tracks | 2 | Feb 2 |
| Manifolds | 1 | Feb 2 |
| Legs | 1 | Feb 2 |

---

## DD6 Components — CONFIRMED

| Component | Per DD6 | Source |
|-----------|---------|--------|
| Slides | 3 | Feb 3 (NetSuite + Chad confirmed) |
| Tracks | 3 | Feb 3 (NetSuite + Chad confirmed) |
| Manifolds | 1 (larger than DD4) | Feb 3 |
| Legs | 1 | Feb 2 |

**DD6 Manifold Note:** "significantly reduces capacity because they are shaped in a way that makes it hard to neatly nest them together... Most of the time the few dd6 manifolds can be placed on an existing pallet adding no additional space to the pallet dimensions just their weight."

**Rule:** DD6 manifolds ride along on existing pallets (adds weight, not space). Only create separate crate for rare large DD6-only orders.

---

## DD Crates — CONFIRMED

### Slide/Track Crate

| Spec | Value |
|------|-------|
| Dims | 80" × 43" × 56" |
| Capacity | 21 nested sets |
| Packing | 7 per layer × 3 layers |
| Weight (full) | 1,510 lbs |
| Weight per set | ~72 lbs (estimated: 1510 ÷ 21) |

### Manifold Crate (DD4)

| Spec | Value |
|------|-------|
| Dims | 54" × 28" × 55" |
| Capacity | 40 DD4 manifolds |
| Packing | 10 per layer |

### Manifold Crate (DD6)

- Capacity significantly reduced (not specified)
- Typical orders: DD6 manifolds fit on existing pallets

### Legs Pallet

| Spec | Value |
|------|-------|
| Pallet | 48" × 40" |
| Footprint | 48" × 45" (overhang) |
| Capacity | 30-40 legs |
| Height (30 legs) | ~53" |

---

## DD Dynamic Packing — CONFIRMED

| Order Size | Method |
|------------|--------|
| ≤2 DD units | All components on one pallet |
| 3+ DD units | Split by component type |

---

## DD Weights — ESTIMATED

| Item | Weight | Method |
|------|--------|--------|
| Slide/Track nested set | ~72 lbs | 1510 ÷ 21 |
| Manifold | Unknown | Validate via BOL later |
| Leg | Unknown | Validate via BOL later |

---

## Undergrad Single-Sided — CONFIRMED

### Base Footprints (Perpendicular Entry)

| Config | Footprint |
|--------|-----------|
| 3-bike | 48" × 63.5" |
| 4-bike | 40" × 87.5" |
| 5-bike | 40" × 111.5" |

**Right/Left Entry:** Add 35" to length

### Nesting Rules

| Spec | Value |
|------|-------|
| First unit height | 12" |
| Each additional unit | +2.5" height |
| Length growth | +2-3" per unit |
| Max per pallet | ~10 units |
| Max height | 36" |

**Example: 10 units stacked**
- Height: 12" + (9 × 2.5") = 34.5" ✓
- Length: base + ~25"

---

## Undergrad Double-Sided — CONFIRMED (Feb 2)

| Spec | Value |
|------|-------|
| Per pallet | 3 max |
| Height | ~40" |
| Max length | 160" |
| Max width | 48" |

---

## Hoop Runner — CONFIRMED (Jan 30)

| Spec | Value |
|------|-------|
| Individual dims | 28" × 32" × 6" |
| Stacked height | First = 6", each additional = +2" |
| Method | Alternate orientation |

---

## Lockers — CONFIRMED (Jan 30)

Ship in boxes only. Each locker = 2 boxes:

| Package | Contents | Dims (in) |
|---------|----------|-----------|
| A | Side panels | 81" × 26" × 5" |
| B | Top/doors | 82" × 32" × 8" |

---

## IMPLEMENTED

| Feature | Status | Date |
|---------|--------|------|
| DD6 component counts (3/3/1/1) | ✅ Implemented in productModels.js | Feb 3 |
| DD6 manifold ride-along logic | ✅ Implemented in calculateDDPallets() | Feb 3 |
| Undergrad single-sided footprints | ✅ Implemented in PRODUCT_MODELS | Feb 3 |
| calcUndergradSingleStack() function | ✅ Implemented | Feb 3 |

---

## STILL UNKNOWN

| Item | Status |
|------|--------|
| DD6 manifold crate capacity | Unknown (rare large orders only) |
| Individual manifold weight | Validate via BOL |
| Individual leg weight | Validate via BOL |
| Partial crate layer heights | Not confirmed |
| Shipping_Dimensions.xlsx accuracy | Not reviewed by Chad |
