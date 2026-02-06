# GCS Pallet Configurator — Quick Start Guide

## What It Does
Calculate exactly how many pallets an order needs — before quoting freight.

**URL:** https://pallet-configurator.vercel.app

---

## How to Use

### Option 1: Import from NetSuite Quote
1. Enter the **Quote Number** (e.g., `QUO33922` or just `33922`)
2. Click **Import**
3. Products load automatically
4. Click **Calculate Pallets**

### Option 2: Build Order Manually
1. Search for products by SKU or name
2. Click to add items
3. Adjust quantities with +/- buttons
4. Click **Calculate Pallets**

---

## Understanding Results

### Summary Bar
| Metric | Meaning |
|--------|---------|
| **Pallets** | Number of 48×40" pallets needed |
| **Total lbs** | Combined weight (including pallet weight) |
| **Cubic Ft** | Total volume for freight quoting |
| **Ship Method** | LTL, Parcel, Partial TL, or Full Truckload |

### Shipping Methods
- **Parcel** — Small orders (<150 lbs, small items) → UPS/FedEx
- **LTL** — Standard freight (1-10 pallets)
- **Partial TL** — Large orders (6-10 pallets, >10,000 lbs)
- **Full Truckload** — Very large (>10 pallets or >15,000 lbs)

---

## Features

### 🎮 3D Pallet Viewer
- Click any pallet button to see 3D visualization
- **Drag** to rotate | **Scroll** to zoom
- Click **💥 Explode** to see individual items

### 🖨️ Print Packing Slip
- Generates warehouse-ready packing list
- Shows stacking order per pallet
- Includes checkboxes for verification

### 📦 Warehouse Mode
- Tablet-friendly checklist view
- Tap items to mark as packed
- Progress bars show completion

---

## Tips

### Accuracy
- System is calibrated against 115 real BOL records
- Accuracy: ~91% within ±1 pallet
- DD (Double Docker) uses component-based packing

### Warnings
- ⚠️ **Yellow warning** = Unknown product (using estimated dims)
- When you see this, verify actual dimensions before quoting

### Keyboard Shortcuts
- **Enter** — Calculate pallets
- **Escape** — Close 3D viewer

---

## Need Help?
Contact: Brady, Connor, or Anisa

*Last updated: January 31, 2026*
