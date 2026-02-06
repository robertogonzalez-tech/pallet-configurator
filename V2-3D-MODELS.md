# Pallet Configurator V2 — 3D Model Integration

## Goal
Replace placeholder boxes with actual GLB models in the 3D pallet viewer.

## Available Models (from Chad, Jan 30)
| Model File | Product Family |
|------------|----------------|
| `varsity-double-pack.glb` | Varsity DV215 |
| `vr2-two-pack.glb` | VR2 Offset |
| `hr101-unboxed.glb` | Hoop Runner HR101 |
| `cs200.glb` | Circle Series |
| `skatedock-box.glb` | SkateDock |
| `dd-slide-assembly.glb` | Double Docker (upper slide) |
| `dd-lower-track.glb` | Double Docker (lower track) |
| `dd-support-leg.glb` | Double Docker (leg) |
| `dd-manifold.glb` | Double Docker (manifold) |
| `locker-1bike-box-a.glb` | 1-Bike Locker (box A) |
| `locker-1bike-box-b.glb` | 1-Bike Locker (box B) |
| `locker-2bike-box-a.glb` | 2-Bike Locker (box A) |
| `locker-2bike-box-b.glb` | 2-Bike Locker (box B) |
| `locker-2bike-box-c.glb` | 2-Bike Locker (box C) |

## Tasks

### 1. Fix SKU → Model Mapping
- [ ] Update `getProductModelKey()` to handle all SKU patterns
- [ ] Map product families to correct model files
- [ ] Handle color variants (GAV, BLK, GRY) → same model

### 2. Model Scaling & Positioning
- [ ] Measure each GLB model's native dimensions
- [ ] Calculate correct scale factor per model
- [ ] Handle different coordinate origins (some models center, some corner)
- [ ] Test stacking behavior

### 3. Double Docker Component Packing
- [ ] DD ships as components, not assembled units
- [ ] Show 4 separate component types on pallet
- [ ] Use component-specific models (slide, track, leg, manifold)

### 4. Fallback Handling
- [ ] Products without GLB → use dimensionally-accurate box
- [ ] Show product family color
- [ ] Display item count label

### 5. Performance
- [ ] Preload common models
- [ ] Use instancing for repeated items
- [ ] Limit max items rendered per pallet

## Not in Scope (V2)
- Animation of packing process
- Drag-and-drop rearrangement
- Export to 3D format

## Definition of Done
- All 14 GLB models render correctly
- Models match actual product appearance
- Proper scaling on 48×40" pallets
- DD components show as separate pieces
- Smooth 60fps rotation/zoom
