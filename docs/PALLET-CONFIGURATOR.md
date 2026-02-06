# Pallet Configurator Technical Documentation

Technical reference for the GCS Pallet Configurator 3D visualization and bin-packing system.

---

## Table of Contents

1. [How to Add a New Product Type](#1-how-to-add-a-new-product-type)
2. [How to Add a New GLB Model](#2-how-to-add-a-new-glb-model)
3. [Coordinate System Reference](#3-coordinate-system-reference)
4. [Troubleshooting Common Issues](#4-troubleshooting-common-issues)

---

## 1. How to Add a New Product Type

### Step 1: Define Dimensions in `productModels.js`

Add a new entry to the `PRODUCT_MODELS` object with accurate dimensions from STEP files:

```javascript
// src/productModels.js

export const PRODUCT_MODELS = {
  // ... existing products ...
  
  'my-new-product': {
    name: 'My New Product',
    model: '/models/my-new-product.glb',  // Path to GLB (or null if no model)
    dims: { l: 36.0, w: 24.0, h: 12.0 },  // Dimensions in INCHES
    weight: 45,                            // Weight in LBS
    type: 'box',                           // 'box', 'product', 'component', or 'assembly'
    stackable: true,                       // Can items be stacked on top?
    unitsPerPallet: 20,                    // Estimated units per standard pallet
  },
}
```

### Step 2: Add SKU Pattern Matching

Update `getProductModelKey()` to recognize the new product's SKU patterns:

```javascript
// src/productModels.js

export function getProductModelKey(sku, family) {
  const skuLower = (sku || '').toLowerCase()
  const familyLower = (family || '').toLowerCase()
  
  // === MY NEW PRODUCT ===
  // Add all known SKU patterns for this product
  if (skuLower.includes('mynp') || skuLower.includes('my-new-product')) return 'my-new-product'
  if (skuLower.startsWith('80101-9999')) return 'my-new-product'  // NetSuite SKU pattern
  if (familyLower.includes('my new product')) return 'my-new-product'
  
  // ... existing patterns ...
}
```

### Step 3: Add Packing Rules (App.jsx)

If the product has special packing requirements, update `PACKING_RULES` and `getProductKey()`:

```javascript
// src/App.jsx

const PACKING_RULES = {
  realShippingWeights: {
    // ... existing ...
    'my-new-product': 45,  // Real shipping weight from BOL data
  },
  
  unitsPerPallet: {
    // ... existing ...
    'my-new-product': 20,  // Calibrated from actual shipments
  },
  
  realPalletCounts: {
    // ... existing ...
    'my-new-product': [[1, 20, 1], [21, 40, 2], [41, 60, 3]],  // [minQty, maxQty, palletCount]
  },
}
```

### Step 4: Add Constraint Group (if needed)

If the product needs special packing rules (ships separately, special pallet size):

```javascript
// src/binPacking3D.js

function getConstraintGroup(item, separateTypes = []) {
  const sku = (item.sku || '').toLowerCase()
  const family = (item.family || '').toLowerCase()
  
  // My new product ships separately (e.g., it's fragile)
  if (sku.includes('mynp') || family.includes('my new product')) {
    return 'my-new-product'  // New constraint group
  }
  
  // ... existing groups ...
}

function getPalletConfigForGroup(groupName, items, defaults) {
  // ... existing cases ...
  
  case 'my-new-product':
    // Custom pallet size for this product
    return {
      ...defaults,
      palletLength: 60,  // Custom pallet dimensions
      palletWidth: 48,
      maxHeight: 72,     // Limit stacking
    }
}
```

### Step 5: Test the New Product

1. Add the product to an order in the UI
2. Click "Calculate Pallets" 
3. Verify the 3D visualization shows correct dimensions
4. Compare pallet count to known BOL data
5. Check browser console for packing debug output:

```
🎮 GAP-FREE TETRIS v7.0 (Full Grid Scan)
   Pallet: 48×40×96" (max 2500 lbs)
   Item: my-new-product × 5 → dims: 36×24×12"
```

---

## 2. How to Add a New GLB Model

### Model Requirements

| Requirement | Value | Notes |
|-------------|-------|-------|
| **Units** | Millimeters (mm) | Three.js scale factor: 0.0393701 (mm→inch) |
| **Origin** | Bottom-center | Model sits on ground plane at Y=0 |
| **Y Direction** | Up | Standard Y-up orientation |
| **Format** | glTF Binary (.glb) | Preferred for web performance |

### Step 1: Prepare the Model in Blender

1. **Import STEP file**: File → Import → STEP (.step)
2. **Check orientation**: Y should be vertical (up)
3. **Center the model**: Object → Set Origin → Origin to Geometry
4. **Move to ground**: Set Z location so bottom touches Z=0
5. **Verify units**: Scene units should be mm

### Step 2: Export Settings

Export as glTF Binary (.glb) with these settings:

```
Format: glTF Binary (.glb)
Include:
  ☑ Selected Objects (if exporting specific objects)
  ☑ Apply Modifiers

Transform:
  ☑ +Y Up (CRITICAL - must be checked)
  Scale: 1.0 (do NOT change scale here)

Geometry:
  ☑ UVs
  ☑ Normals
  ☑ Vertex Colors (if applicable)

Animation:
  ☐ Animations (uncheck unless needed)

Data:
  ☑ Materials
  ☑ Textures (if applicable)
```

**CRITICAL**: Always use `+Y Up` orientation. The Three.js scene expects Y-up.

### Step 3: Place the File

Copy the exported `.glb` file to:

```
public/models/my-new-product.glb
```

### Step 4: Register in productModels.js

```javascript
'my-new-product': {
  name: 'My New Product',
  model: '/models/my-new-product.glb',  // Path from public root
  dims: { l: 36.0, w: 24.0, h: 12.0 },  // In inches
  weight: 45,
  // ...
}
```

### Step 5: Add Scale Configuration (if needed)

Most models use the standard mm→inch conversion. For special cases:

```javascript
// src/PalletViewer3D.jsx

const MODEL_SCALES = {
  // Standard mm→inch conversion (for STEP-derived models)
  'my-new-product': { scale: 0.0393701, rotation: [0, 0, 0] },
  
  // If model needs rotation correction
  'rotated-product': { scale: 0.0393701, rotation: [Math.PI/2, 0, 0] },
}
```

### Step 6: Preload for Performance

Add to the preload section at the bottom of `PalletViewer3D.jsx`:

```javascript
useGLTF.preload('/models/my-new-product.glb')
```

---

## 3. Coordinate System Reference

### System Overview

| System | Units | Origin | Y Direction | Notes |
|--------|-------|--------|-------------|-------|
| **NetSuite/Products** | Inches | N/A | N/A | Source data from products.json |
| **Bin Packing** | Inches | Corner of pallet (0,0,0) | Up | X=length, Z=width, Y=height |
| **Three.js Scene** | Scene units (scaled) | Center of ground plane | Up | Uses palletScale factor |
| **GLB Models** | Millimeters | Varies by model | Up | Converted via MODEL_SCALES |

### Coordinate Conversion Formulas

#### From Bin Packing to Three.js Scene

Located in `PalletScene` within `PalletViewer3D.jsx`:

```javascript
const scale = 0.5  // palletScale - adjusts scene size

// Bin packing coords (inches, corner origin) → Three.js (centered, scaled)
const palletL = (pallet.dims?.[0] || 48) * scale
const palletW = (pallet.dims?.[1] || 40) * scale

// Convert box position
const x = (box.x + box.l / 2) * scale - palletL / 2  // Center X
const y = box.y * scale + 3 * scale                   // Y + pallet base height
const z = (box.z + box.w / 2) * scale - palletW / 2  // Center Z
```

#### From Millimeters to Scene Units (GLB Models)

Located in `GLBModel` component:

```javascript
// Standard conversion: mm → inches → scene units
const MM_TO_INCH = 0.0393701
const palletScale = 0.5  // Scene scale factor

// Final scale: model_mm * MM_TO_INCH * palletScale = scene_units
const uniformScale = 0.0393701 * palletScale  // ≈ 0.0197
```

#### Axis Mapping

```
Bin Packing:          Three.js Scene:
    Y (height)             Y (up)
    |                      |
    |_____ X (length)      |_____ X (length)
   /                      /
  Z (width)              Z (width)

Note: Same orientation, just different origins and scales
```

### Pallet Base Offset

The pallet base is 3 scene units (6 inches at scale 0.5):

```javascript
// Items sit on top of the pallet base
const palletBaseHeight = 3 * scale  // 6 inches → 3 scene units

// Position Y includes pallet base
const y = box.y * scale + palletBaseHeight
```

### Example Conversion

A box at bin packing position (10, 0, 5) with dims (20, 10, 15):

```javascript
// Input (inches, corner origin)
box = { x: 10, y: 0, z: 5, l: 20, w: 15, h: 10 }

// Pallet: 48×40 inches
const palletL = 48 * 0.5 = 24  // scene units
const palletW = 40 * 0.5 = 20  // scene units

// Output (scene units, centered origin)
sceneX = (10 + 20/2) * 0.5 - 24/2 = 10 * 0.5 - 12 = -7
sceneY = 0 * 0.5 + 3 * 0.5 = 1.5  // On floor + pallet base
sceneZ = (5 + 15/2) * 0.5 - 20/2 = 12.5 * 0.5 - 10 = -3.75

// Box dimensions (scene units)
sceneL = 20 * 0.5 = 10
sceneH = 10 * 0.5 = 5
sceneW = 15 * 0.5 = 7.5
```

---

## 4. Troubleshooting Common Issues

### Floating Items

**Symptom**: Items appear to hover above the pallet or other items.

**Causes & Solutions**:

1. **Incorrect offset.y calculation**
   - Check `GLBModel` component's offset calculation:
   ```javascript
   // offset.y should lift model so bounding box min sits at y=0
   const offset = {
     y: -box.min.y * uniformScale  // Compensate for model's min Y
   }
   ```

2. **Stale bounding box**
   - The bounding box is calculated from the ORIGINAL scene before cloning
   - Check console for: `🔍 GLBModel: size=... min.y=... max.y=...`

3. **Wrong Y origin in GLB**
   - Re-export with origin at bottom-center
   - In Blender: Object → Set Origin → Origin to 3D Cursor (with cursor at model bottom)

### Wrong Scale

**Symptom**: Model is too large or too small relative to other items.

**Causes & Solutions**:

1. **Model not in millimeters**
   - STEP files should be in mm
   - Scale factor 0.0393701 converts mm→inches
   - Check console for: `📐 GLBModel: Using CONFIGURED scale=...`

2. **Custom scale needed**
   - Add entry to `MODEL_SCALES` in `PalletViewer3D.jsx`:
   ```javascript
   'my-product': { scale: 0.05, rotation: [0, 0, 0] }  // Adjust scale
   ```

3. **Blender export with wrong scale**
   - Ensure export Scale is 1.0
   - Don't apply scale transform in Blender export dialog

### Gaps Between Items

**Symptom**: Visible gaps between packed items in 3D view.

**Causes & Solutions**:

1. **Spacing in DD layout**
   - Check the DD component packing in `App.jsx`:
   ```javascript
   // TIGHT packing - no gaps
   z: col * SLIDE_DIMS.w,  // Should be exact, no + spacing
   ```

2. **Adjacency scoring too low**
   - In `binPacking3D.js`, increase adjacency bonus:
   ```javascript
   - adjacency * 500  // Higher = more reward for flush placement
   ```

3. **Grid resolution too coarse**
   - Decrease `heightMapResolution` in `PACKING_CONFIG`:
   ```javascript
   heightMapResolution: 0.25,  // Finer grid (default: 0.5)
   ```

### Performance Issues

**Symptom**: 3D viewer is slow or laggy.

**Causes & Solutions**:

1. **Too many items rendered**
   - The viewer limits display to ~20 items per layer:
   ```javascript
   const maxItems = Math.min(qty, Math.max(20, itemsPerLayer * 3))
   ```

2. **Grid resolution too fine**
   - In `binPacking3D.js`, increase grid step:
   ```javascript
   const step = 2  // Increase from 1 for faster (but less precise) packing
   ```

3. **Large GLB models**
   - Simplify geometry in Blender before export
   - Use Decimate modifier to reduce polygon count
   - Target: <50,000 triangles per model

4. **Missing model preloads**
   - Add `useGLTF.preload()` for all models at bottom of `PalletViewer3D.jsx`

### Model Not Loading

**Symptom**: Fallback box shown instead of GLB model.

**Causes & Solutions**:

1. **Wrong path**
   - Path should be from public root: `/models/my-product.glb`
   - Check Network tab for 404 errors

2. **Model not in PRODUCT_MODELS**
   - Ensure `getProductModelKey()` returns the correct key
   - Add console.log to verify: `console.log('Model key:', key)`

3. **Corrupt GLB**
   - Test in online GLB viewer (e.g., https://gltf-viewer.donmccurdy.com/)
   - Re-export from Blender if needed

### Console Debug Commands

Check model info in browser console:

```javascript
// View all loaded model debug info
window.DEBUG_MODELS

// View packing calculation logs
window.packingLogs.get()

// Export packing logs for analysis
window.packingLogs.export()
```

---

## Additional Resources

- **STEP Files**: Request from Chad via Warehouse Trello
- **BOL Training Data**: `localStorage` key `gcs_packing_calculations`
- **Bin Packing Algorithm**: `src/binPacking3D.js` - GAP-FREE TETRIS v7.0
- **3D Rendering**: Three.js + React Three Fiber + Drei

---

*Last updated: 2026-02-02*
