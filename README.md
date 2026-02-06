# GCS Pallet Configurator

3D bin-packing visualization tool for Ground Control Systems. Calculate pallet layouts, visualize shipments, and generate accurate freight quotes.

## Features

- 🎮 **3D Bin Packing** - GAP-FREE TETRIS algorithm with exact item positioning
- 📦 **GLB Model Support** - Real product models from STEP files
- 🔍 **Exploded View** - Interactive layer-by-layer visualization
- 📊 **BOL Integration** - Load quotes from NetSuite, validate against real shipments
- 📋 **Packing Slips** - Generate warehouse packing instructions

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone and install
cd ~/clawd/apps/pallet-configurator
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Build for Production

```bash
npm run build
npm run preview  # Preview production build
```

## Project Structure

```
pallet-configurator/
├── public/
│   ├── models/          # GLB 3D models
│   ├── products.json    # Product catalog
│   └── ...
├── src/
│   ├── App.jsx              # Main app + packing rules
│   ├── PalletViewer3D.jsx   # Three.js 3D visualization
│   ├── binPacking3D.js      # GAP-FREE TETRIS algorithm
│   ├── productModels.js     # Product dimensions & model registry
│   └── ...
├── api/                     # Vercel serverless functions
├── docs/                    # Technical documentation
└── scripts/                 # Build utilities
```

## Usage

### Load a NetSuite Quote

1. Enter quote number (e.g., `QUO33924`)
2. Click "Load Quote"
3. Items populate automatically with accurate dimensions

### Calculate Pallets

1. Add products to order (search or load quote)
2. Adjust quantities as needed
3. Click "Calculate Pallets"
4. View 3D pallet visualization
5. Use "Explode" button to see layers

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Calculate pallets |
| `Escape` | Clear pallet selection |

## Configuration

### Pallet Constraints

Edit in `src/binPacking3D.js`:

```javascript
const PALLET = {
  length: 48,      // inches (X axis)
  width: 40,       // inches (Z axis)
  maxHeight: 96,   // inches (Y axis)
  maxWeight: 2500, // lbs
}
```

### Packing Rules

Edit in `src/App.jsx`:

```javascript
const PACKING_RULES = {
  realShippingWeights: { ... },  // BOL-calibrated weights
  unitsPerPallet: { ... },       // Units per pallet by product
  realPalletCounts: { ... },     // [minQty, maxQty, palletCount]
}
```

## Adding Products

See [docs/PALLET-CONFIGURATOR.md](docs/PALLET-CONFIGURATOR.md) for:

- How to add new product types
- How to add GLB 3D models
- Coordinate system reference
- Troubleshooting guide

## Deployment

Deployed via Vercel. Push to `main` branch triggers auto-deploy.

```bash
# Manual deploy
npx vercel --prod
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/quote?num=QUO123` | Fetch NetSuite quote |
| `/api/products` | Product catalog |
| `/api/optimize` | AI packing optimization |

## Debug Tools

Open browser console:

```javascript
// View packing calculation logs
window.packingLogs.get()

// Export logs for ML training
window.packingLogs.export()

// View loaded model debug info
window.DEBUG_MODELS
```

## Tech Stack

- **Frontend**: React + Vite
- **3D**: Three.js + React Three Fiber + Drei
- **Backend**: Vercel Serverless Functions
- **Data**: NetSuite REST API

## License

Proprietary - Ground Control Systems

---

*For technical documentation, see [docs/PALLET-CONFIGURATOR.md](docs/PALLET-CONFIGURATOR.md)*
