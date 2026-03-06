import { useState, useEffect, Suspense, lazy, Component } from 'react'
import PackingPlan from './PackingPlan'
import PackingSlip from './PackingSlip'
import WarehouseView from './WarehouseView'
import BOLValidator from './BOLValidator'
import PackingComparison from './PackingComparison'
import TextPackingOutput from './TextPackingOutput'
import ValidationForm from './components/ValidationForm'
import ModeSwitcher from './components/ModeSwitcher'
import { getProductDims, getProductModelKey, calculateDDPallets, DD_COMPONENTS } from './productModels'
import { packItemsWithConstraints, PALLET, validateAgainstBOL } from './binPacking3D'
import { optimizePalletPacking, validatePacking } from './palletOptimizer.js'
import { applyOverridesToItems, getOverride } from './utils/dimensionOverrides'
import DimensionOverrideModal from './components/DimensionOverrideModal'

// Import responsive styles
import './styles/responsive.css'

// ==========================================
// PACKING CALCULATION LOGGER
// Stores each calculation for future ML training
// ==========================================
const PACKING_LOG_KEY = 'gcs_packing_calculations'
const PACKING_LOG_VERSION = '1.0'

function logPackingCalculation(data) {
  try {
    const existingLogs = JSON.parse(localStorage.getItem(PACKING_LOG_KEY) || '[]')
    
    const logEntry = {
      id: `calc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      version: PACKING_LOG_VERSION,
      timestamp: new Date().toISOString(),
      quoteNumber: data.quoteNumber || null,
      
      // Input: what was requested
      input: {
        items: data.items.map(item => ({
          sku: item.sku,
          name: item.name,
          family: item.family,
          qty: item.qty,
          weight: item.weight,
          dims: item.dims || item.accurateDims || null,
        })),
        totalUnits: data.items.reduce((sum, i) => sum + (i.qty || 1), 0),
        totalWeight: data.items.reduce((sum, i) => sum + (i.weight || 0) * (i.qty || 1), 0),
      },
      
      // Output: what the algorithm produced
      output: {
        palletCount: data.pallets.length,
        pallets: data.pallets.map(p => ({
          id: p.id,
          dims: p.dims,
          weight: p.weight,
          itemCount: p.boxes?.length || p.items?.reduce((sum, i) => sum + (i.qty || 1), 0),
          items: p.items?.map(i => ({ sku: i.sku, qty: i.qty })),
          utilization: p.utilization,
          palletSize: p.palletSize,
        })),
        totalWeight: data.pallets.reduce((sum, p) => sum + (p.weight || 0), 0),
        totalCubicFeet: data.pallets.reduce((sum, p) => sum + (p.cubicFeet || 0), 0),
      },
      
      // Metadata for later comparison
      metadata: {
        algorithmVersion: '3d-binpack-v2',
        ddComponentsExpanded: data.ddExpanded || false,
        shipMethod: data.shipMethod || null,
      },
      
      // Will be filled in later when comparing to actual shipment
      actual: null, // { palletCount, weights, etc. } - from real BOL
      accuracy: null, // calculated after actual is filled
    }
    
    existingLogs.push(logEntry)
    
    // Keep last 500 calculations to avoid localStorage limits
    if (existingLogs.length > 500) {
      existingLogs.splice(0, existingLogs.length - 500)
    }
    
    localStorage.setItem(PACKING_LOG_KEY, JSON.stringify(existingLogs))
    console.log('📊 Logged packing calculation:', logEntry.id)
    
    return logEntry.id
  } catch (err) {
    console.error('Failed to log packing calculation:', err)
    return null
  }
}

function getPackingLogs() {
  try {
    return JSON.parse(localStorage.getItem(PACKING_LOG_KEY) || '[]')
  } catch {
    return []
  }
}

function exportPackingLogs() {
  const logs = getPackingLogs()
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `packing-logs-${new Date().toISOString().split('T')[0]}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function clearPackingLogs() {
  localStorage.removeItem(PACKING_LOG_KEY)
  console.log('🗑️ Cleared packing logs')
}

// Make available globally for debugging
if (typeof window !== 'undefined') {
  window.packingLogs = {
    get: getPackingLogs,
    export: exportPackingLogs,
    clear: clearPackingLogs,
  }
}

// Error boundary to prevent white screen crashes
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  
  componentDidCatch(error, errorInfo) {
    console.error('React Error Boundary caught:', error, errorInfo)
  }
  
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <h2 style={{ color: '#dc2626' }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', marginBottom: '20px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// 3D viewer components removed per Berto (2026-02-11)

// Packing rules configuration - CALIBRATED against 115 real BOL records
// Accuracy: 57.4% exact match, 91.3% within ±1 pallet (Jan 2026 calibration run)
const PACKING_RULES = {
  maxPalletHeight: 96, // inches
  maxPalletWeight: 2500, // lbs
  palletWeight: 50, // empty pallet weight
  
  // Real shipping weights per unit (CALIBRATED from 115 BOL training records)
  realShippingWeights: {
    'dv215': 55,      // Varsity 2-pack - UPDATED from BOL validation (was 15, actual 55 lbs)
    'dismount': 10,   // Dismount components - light
    'vr2': 31,        // VR2 Offset - confirmed
    'vr1': 31,        // VR1 XL - similar to VR2
    'dd4': 206,       // Double Docker 4 - confirmed ✓
    'dd6': 260,       // Double Docker 6
    'mbv1': 312,      // Metal Bike Vault 1 - confirmed ✓
    'mbv2': 420,      // Metal Bike Vault 2
    'visi1': 280,     // VisiLocker 1 - confirmed ✓
    'visi2': 375,     // VisiLocker 2
    'hr101': 14,      // Hoop Runner 101 - light flat pack
    'hr201': 48,      // Hoop Runner 201
    'undergrad': 85,  // Undergrad
    'sm10x': 28,      // SkateDock - CALIBRATED (packs efficiently)
    'radius': 34,     // Radius
    'cs200': 40,      // Circle Series
    'wave': 58,       // Wave Rack
    '2up': 20,        // 2-Up racks
    'fs_mba': 5,      // Mounting bracket - very light
    // SIK Struts - INSTALL KITS (rails + hardware) - 0.5 pallets each!
    'sik120': 150,    // 120" install kit - bulky
    'sik114': 130,    // 114" install kit
    'sik86': 100,     // 86" install kit
    'sik57': 65,      // 57" install kit
    'sik24': 30,      // 24" install kit
    'sik_other': 80,  // Generic strut kit
    // Base Station products - STRUCTURAL pieces (long!)
    'ss120': 85,      // Side Stage 120" - long structural
    'ss95': 70,       // Side Stage 95"
    'ss66': 50,       // Side Stage 66"
    'ss38': 35,       // Side Stage 38"
    'ssa114': 60,     // Add-on 114"
    'ssa86': 45,      // Add-on 86"
    'ssa57': 35,      // Add-on 57"
    'cs95': 75,       // Center Stage 95"
    'csa114': 65,     // Center Stage add-on
    'hoop': 25,       // Generic hoop rack
  },
  
  // Units per pallet (CALIBRATED from 115 BOL training records)
  // KEY INSIGHT: Varsity/VR/Dismount pack EXTREMELY efficiently!
  unitsPerPallet: {
    'dv215': 70,    // Varsity - VERY efficient! (80 varsity = 2 pallets max)
    'dismount': 15, // Dismount complete units per pallet
    'vr2': 50,      // VR2 - CALIBRATED (very efficient flat pack)
    'vr1': 50,      // VR1 - similar to VR2
    'dd4': 12,      // DD4 - CALIBRATED (more per pallet than thought)
    'dd6': 8,       // DD6
    'mbv1': 4,      // MBV1 - confirmed ✓
    'mbv2': 2,      // MBV2
    'visi1': 6,     // VISI1
    'visi2': 3,     // VISI2
    'hr101': 60,    // HR101 - very efficient flat pack
    'hr201': 20,    // HR201
    'undergrad': 4, // Undergrad
    'sm10x': 16,    // SkateDock - CALIBRATED
    'radius': 20,   // Radius
    'cs200': 15,    // CS200
    'wave': 4,      // Wave
    '2up': 30,      // 2-Up (flat packed)
    'fs_mba': 50,   // Mounting brackets - many per pallet
    // SIK Install Kits - BIG! Only 2-4 per pallet
    'sik120': 2,    // 120" kit - ~2 per pallet
    'sik114': 3,    // 114" kit
    'sik86': 3,     // 86" kit
    'sik57': 4,     // 57" kit
    'sik24': 6,     // 24" kit
    'sik_other': 3, // Generic kit
    // Base Station products - LONG structural pieces
    'ss120': 3,     // Side Stage 120" - ~3 per pallet
    'ss95': 4,      // Side Stage 95"
    'ss66': 5,      // Side Stage 66"
    'ss38': 8,      // Side Stage 38"
    'ssa114': 3,    // Add-on 114"
    'ssa86': 4,     // Add-on 86"
    'ssa57': 5,     // Add-on 57"
    'cs95': 3,      // Center Stage 95"
    'csa114': 3,    // Center Stage add-on
    'hoop': 20,     // Generic hoop rack
  },
  
  // Real pallet counts from BOL data (qty range → number of pallets)
  // CALIBRATED from 115 training records - Jan 2026
  realPalletCounts: {
    'dv215': [[1, 70, 1], [71, 140, 2], [141, 210, 3]], // Varsity packs VERY efficiently
    'dismount': [[1, 15, 1], [16, 30, 2], [31, 45, 3]], // Dismount
    'vr2': [[1, 50, 1], [51, 100, 2], [101, 150, 3]], // VR2 - efficient
    'vr1': [[1, 50, 1], [51, 100, 2]],
    'dd4': [[1, 12, 1], [13, 24, 2], [25, 36, 3]], // DD - CALIBRATED
    'dd6': [[1, 8, 1], [9, 16, 2]],
    'mbv1': [[1, 4, 1], [5, 8, 2], [9, 12, 3]],
    'mbv2': [[1, 2, 1], [3, 4, 2]],
    'visi1': [[1, 6, 1], [7, 12, 2], [13, 18, 3]],
    'visi2': [[1, 3, 1], [4, 6, 2]],
    'hr101': [[1, 60, 1], [61, 120, 2], [121, 180, 3]], // Very efficient flat pack
    'hr201': [[1, 20, 1], [21, 40, 2]],
    'undergrad': [[1, 4, 1], [5, 8, 2], [9, 16, 3]],
    'sm10x': [[1, 16, 1], [17, 32, 2], [33, 48, 3]], // CALIBRATED
    'radius': [[1, 20, 1], [21, 40, 2]],
    'cs200': [[1, 15, 1], [16, 30, 2]],
    'wave': [[1, 4, 1], [5, 8, 2]],
    '2up': [[1, 30, 1], [31, 60, 2]],
    // SIK Install Kits - BIG items, only 2-4 per pallet
    'sik120': [[1, 2, 1], [3, 4, 2], [5, 6, 3], [7, 8, 4]],
    'sik114': [[1, 3, 1], [4, 6, 2], [7, 9, 3]],
    'sik86': [[1, 3, 1], [4, 6, 2], [7, 9, 3]],
    'sik57': [[1, 4, 1], [5, 8, 2], [9, 12, 3]],
    'sik24': [[1, 6, 1], [7, 12, 2]],
    'sik_other': [[1, 3, 1], [4, 6, 2]],
    // Base Station products - LONG structural pieces
    'ss120': [[1, 3, 1], [4, 6, 2], [7, 9, 3]],
    'ss95': [[1, 4, 1], [5, 8, 2], [9, 12, 3]],
    'ss66': [[1, 5, 1], [6, 10, 2], [11, 15, 3]],
    'ss38': [[1, 8, 1], [9, 16, 2]],
    'ssa114': [[1, 3, 1], [4, 6, 2], [7, 9, 3]],
    'ssa86': [[1, 4, 1], [5, 8, 2], [9, 12, 3]],
    'ssa57': [[1, 5, 1], [6, 10, 2], [11, 15, 3]],
    'cs95': [[1, 3, 1], [4, 6, 2]],
    'csa114': [[1, 3, 1], [4, 6, 2]],
  },
  
  // Product family colors for visualization
  familyColors: {
    'Varsity': 'varsity',
    'VR2 Offset': 'vr2',
    'VR1 XL': 'vr1',
    'Undergrad': 'undergrad',
    'Skatedock': 'skatedock',
    'Dismount': 'dismount',
    'Double Docker': 'dd',
    'Metal Bike Vault / VisiLocker': 'locker',
    'Hoop Runner': 'hr',
    'Circle Series (Omega)': 'circle',
    'Saris': 'stretch',
  }
}

// Map product families/SKUs to reference keys
function getProductKey(sku, family, name = '') {
  const skuLower = (sku || '').toLowerCase()
  const familyLower = (family || '').toLowerCase()
  const nameLower = (name || '').toLowerCase()
  
  // Varsity products - multiple SKU patterns including numeric part numbers
  // 80101-0088 = HEAD assembled, 80101-0287 = BASE assembled
  // 80301-0088 = HEAD raw, 80301-0287 = BASE raw
  // 90101-2287 = 2-PACK (complete units)
  if (skuLower.includes('dv215') || familyLower.includes('varsity')) return 'dv215'
  if (skuLower.startsWith('80101-0088') || skuLower.startsWith('80301-0088')) return 'dv215'
  if (skuLower.startsWith('80101-0287') || skuLower.startsWith('80301-0287')) return 'dv215'
  if (skuLower.startsWith('90101-2287')) return 'dv215'
  
  // Dismount products (scooter racks)
  // 80101-2050, 80301-2048/2049/2050/2051/2052 = components
  // 89901-2050 = complete unit
  if (skuLower.startsWith('80101-205') || skuLower.startsWith('80301-204') || skuLower.startsWith('80301-205')) return 'dismount'
  if (skuLower.startsWith('89901-205')) return 'dismount'
  if (familyLower.includes('dismount')) return 'dismount'
  
  // SkateDock - 89901-1210 / SM10X patterns
  if (skuLower.includes('sm10') || skuLower.startsWith('89901-121') || skuLower.startsWith('89901-140')) return 'sm10x'
  if (familyLower.includes('skatedock') || familyLower.includes('snowdock')) return 'sm10x'
  
  // VR2/VR1 - vertical racks
  if (skuLower.includes('vr2') || skuLower.includes('vr-2') || skuLower.includes('vr-vr2')) return 'vr2'
  if (skuLower.startsWith('90101-0172') || skuLower.startsWith('80101-0172')) return 'vr2' // VR2 numeric SKUs
  if (skuLower.includes('vr1') || skuLower.includes('vr-1') || skuLower.includes('vr-vr1')) return 'vr1'
  
  // Double Docker - detect by SKU patterns OR product name containing bike count
  // SKU patterns: dd-04, dd4, dd-ss-04, 80101-0257-*, 80101-0258-*
  // Name patterns: "DOUBLE DOCKER...4 BIKES", "DOUBLE DOCKER...6 BIKES"
  if (skuLower.includes('dd-04') || skuLower.includes('dd4') || skuLower.includes('dd-ss-04')) return 'dd4'
  if (skuLower.includes('dd-06') || skuLower.includes('dd6') || skuLower.includes('dd-ss-06')) return 'dd6'
  if (skuLower.startsWith('80101-0257')) return 'dd4'
  if (skuLower.startsWith('80101-0258')) return 'dd6'
  // Detect from family OR name containing "Double Docker" with bike count
  const ddText = familyLower.includes('double docker') ? familyLower : 
                 nameLower.includes('double docker') ? nameLower : ''
  if (ddText) {
    if (ddText.includes('4 bike') || ddText.includes('4-bike') || ddText.includes(', 4 ')) return 'dd4'
    if (ddText.includes('6 bike') || ddText.includes('6-bike') || ddText.includes(', 6 ')) return 'dd6'
    return 'dd4' // Default to DD4 if Double Docker but no specific size
  }
  
  // Lockers
  if (skuLower.includes('mbv-1') || skuLower.includes('mbv1')) return 'mbv1'
  if (skuLower.includes('mbv-2') || skuLower.includes('mbv2')) return 'mbv2'
  if (skuLower.includes('visi-1') || skuLower.includes('visi1') || (skuLower.includes('visi') && skuLower.includes('-1'))) return 'visi1'
  if (skuLower.includes('visi-2') || skuLower.includes('visi2') || (skuLower.includes('visi') && skuLower.includes('-2'))) return 'visi2'
  
  // Hoop Runners
  if (skuLower.includes('hr-101') || skuLower.includes('hr101') || skuLower.includes('sm-hr101')) return 'hr101'
  if (skuLower.includes('hr-201') || skuLower.includes('hr201')) return 'hr201'
  
  // SIK Struts - these are BIG (2-3 per pallet)
  if (skuLower.startsWith('sik120') || skuLower.startsWith('sik-120')) return 'sik120'
  if (skuLower.startsWith('sik114') || skuLower.startsWith('sik-114')) return 'sik114'
  if (skuLower.startsWith('sik86') || skuLower.startsWith('sik-86')) return 'sik86'
  if (skuLower.startsWith('sik57') || skuLower.startsWith('sik-57')) return 'sik57'
  if (skuLower.startsWith('sik')) return 'sik_other'
  
  // Base Station products - Side Stage (SS) and Center Stage (CS)
  if (skuLower.includes('ss120') || skuLower.includes('ss-120')) return 'ss120'
  if (skuLower.includes('ssa114') || skuLower.includes('ssa-114')) return 'ssa114'
  if (skuLower.includes('ss95') || skuLower.includes('ss-95')) return 'ss95'
  if (skuLower.includes('ssa86') || skuLower.includes('ssa-86')) return 'ssa86'
  if (skuLower.includes('ss66') || skuLower.includes('ss-66')) return 'ss66'
  if (skuLower.includes('ssa57') || skuLower.includes('ssa-57')) return 'ssa57'
  if (skuLower.includes('ss38') || skuLower.includes('ss-38')) return 'ss38'
  if (skuLower.includes('cs95') || skuLower.includes('cs-95')) return 'cs95'
  if (skuLower.includes('csa114') || skuLower.includes('csa-114')) return 'csa114'
  
  // Mounting brackets
  if (skuLower.includes('fs-mba') || skuLower.includes('fsmba')) return 'fs_mba'
  
  // SIK 24" strut
  if (skuLower.startsWith('sik24') || skuLower.startsWith('sik-24')) return 'sik24'
  
  if (familyLower.includes('undergrad')) return 'undergrad'
  if (familyLower.includes('radius') || familyLower.includes('circle')) return 'radius'
  if (familyLower.includes('wave')) return 'wave'
  
  return null
}

// Get real shipping weight for a product
// First checks STEP-measured data, then falls back to BOL-calibrated weights
function getRealWeight(sku, family, fallbackWeight) {
  // Try STEP-measured data first
  const stepDims = getProductDims(sku)
  if (stepDims && stepDims.weight) {
    return stepDims.weight
  }
  
  // Fall back to BOL-calibrated weights
  const key = getProductKey(sku, family)
  if (key && PACKING_RULES.realShippingWeights[key]) {
    return PACKING_RULES.realShippingWeights[key]
  }
  return fallbackWeight
}

// Get accurate dimensions from STEP files when available
function getAccurateDims(sku, fallbackDims) {
  const stepDims = getProductDims(sku)
  if (stepDims) {
    return {
      length_in: stepDims.length,
      width_in: stepDims.width,
      height_in: stepDims.height,
      weight_lbs: stepDims.weight
    }
  }
  return fallbackDims
}

// Get estimated pallet count for a product type and quantity
function getEstimatedPallets(sku, family, qty) {
  const key = getProductKey(sku, family)
  if (key && PACKING_RULES.realPalletCounts[key]) {
    const ranges = PACKING_RULES.realPalletCounts[key]
    for (const [minQty, maxQty, pallets] of ranges) {
      if (qty >= minQty && qty <= maxQty) {
        return pallets
      }
    }
    // If qty exceeds all ranges, extrapolate from last range
    const lastRange = ranges[ranges.length - 1]
    const unitsPerPallet = lastRange[1] / lastRange[2]
    return Math.ceil(qty / unitsPerPallet)
  }
  return null
}

// NetSuite API configuration - uses Vercel serverless functions as proxy
const NETSUITE_CONFIG = {
  quoteEndpoint: '/api/quote',
  productsEndpoint: '/api/products',
}

function normalizeSkuKey(value) {
  return String(value || '').trim().toUpperCase()
}

function roundToTenth(value) {
  return Math.round((Number(value) || 0) * 10) / 10
}

function getFreightClassFromDensity(density) {
  if (density >= 50) return 50
  if (density >= 35) return 55
  if (density >= 30) return 60
  if (density >= 22.5) return 65
  if (density >= 15) return 70
  if (density >= 13.5) return 77.5
  if (density >= 12) return 85
  if (density >= 10.5) return 92.5
  if (density >= 9) return 100
  if (density >= 8) return 110
  if (density >= 7) return 125
  if (density >= 6) return 150
  if (density >= 5) return 175
  if (density >= 4) return 200
  if (density >= 3) return 250
  if (density >= 2) return 300
  if (density >= 1) return 400
  return 500
}

function getShippingMethodFromPackages(packages, totalWeight) {
  const normalizedPackages = Array.isArray(packages) ? packages : []
  const parcelEligible = normalizedPackages.length > 0 && normalizedPackages.every((pkg) => {
    const l = Number(pkg?.dims?.l ?? pkg?.dims?.[0] ?? 0)
    const w = Number(pkg?.dims?.w ?? pkg?.dims?.[1] ?? 0)
    const h = Number(pkg?.dims?.h ?? pkg?.dims?.[2] ?? 0)
    const weight = Number(pkg?.weight || 0)
    const cubicFeet = (l * w * h) / 1728
    return weight <= 50 && cubicFeet <= 1
  })

  if (parcelEligible && totalWeight < 150) return 'Parcel'
  if (totalWeight > 15000 || normalizedPackages.length > 10) return 'Full Truckload'
  if (totalWeight > 10000 || normalizedPackages.length > 6) return 'Partial TL'
  return 'LTL'
}

function buildFallbackPackageFromBreakdownRow(row, idx) {
  const pallets = Math.max(0, Number(row?.pallets) || 0)
  if (pallets <= 0) return []

  const templateByFamily = {
    'Base Station': { l: 120, w: 11, h: 11, type: 'long_tube' },
    'Strut Install Kit': { l: 120, w: 11, h: 11, type: 'long_tube' },
    'Double Docker': { l: 79, w: 43, h: 63, type: 'dd_mixed_crate' },
    'Metal Bike Vault / VisiLocker': { l: 85, w: 48, h: 39, type: 'large_pallet' },
    MBA: { l: 85, w: 48, h: 39, type: 'large_pallet' },
    Undergrad: { l: 96, w: 48, h: 28, type: 'oversized_pallet' },
    Skatedock: { l: 73, w: 14, h: 13, type: 'skatedock_box' },
  }

  const family = String(row?.matched || row?.family || 'Unknown')
  const template = templateByFamily[family] || { l: 48, w: 40, h: 30, type: 'standard_pallet' }
  const perPackageWeight = Math.max(1, Math.round((Number(row?.weight) || 0) / pallets))

  return Array.from({ length: pallets }, (_, palletIdx) => ({
    id: `${idx + 1}-${palletIdx + 1}`,
    type: template.type,
    family,
    dims: { l: template.l, w: template.w, h: template.h },
    weight: perPackageWeight,
    contents: [{
      sku: row?.sku || 'UNKNOWN',
      name: row?.name || 'Unknown Item',
      qty: row?.qty || 0,
      matched: row?.matched || row?.family || 'UNKNOWN',
    }],
  }))
}

function mapPredictionToResults(data, orderItems) {
  const prediction = data?.prediction || {}
  const breakdown = Array.isArray(data?.predicted_breakdown)
    ? data.predicted_breakdown
    : (Array.isArray(prediction?.breakdown) ? prediction.breakdown : [])
  const rawPackages = Array.isArray(data?.predicted_packages)
    ? data.predicted_packages
    : (Array.isArray(prediction?.packages) ? prediction.packages : [])
  const packages = rawPackages.length > 0
    ? rawPackages
    : breakdown.flatMap((row, idx) => buildFallbackPackageFromBreakdownRow(row, idx))

  const itemLookup = new Map(
    (Array.isArray(orderItems) ? orderItems : []).map((item) => [normalizeSkuKey(item?.sku), item])
  )

  const pallets = packages.map((pkg, idx) => {
    const l = Number(pkg?.dims?.l ?? pkg?.dims?.[0] ?? 48) || 48
    const w = Number(pkg?.dims?.w ?? pkg?.dims?.[1] ?? 40) || 40
    const h = Number(pkg?.dims?.h ?? pkg?.dims?.[2] ?? 30) || 30
    const weight = Math.max(0, Math.round(Number(pkg?.weight) || 0))
    const contents = Array.isArray(pkg?.contents) ? pkg.contents : []
    const totalContentQty = contents.reduce((sum, entry) => sum + Math.max(0, Number(entry?.qty) || 0), 0)

    const items = (contents.length > 0 ? contents : [null]).map((entry) => {
      const matchedItem = itemLookup.get(normalizeSkuKey(entry?.sku))
      const qty = Math.max(1, Number(entry?.qty) || 1)
      const fallbackUnitWeight = totalContentQty > 0
        ? Math.max(1, roundToTenth(weight / totalContentQty))
        : Math.max(1, roundToTenth(weight / qty))
      const family = (entry?.matched && !['UNKNOWN', 'UNKNOWN_FALLBACK', 'SKU_OVERRIDE'].includes(entry.matched))
        ? entry.matched
        : (matchedItem?.family || pkg?.family || 'Unknown')

      return {
        sku: entry?.sku || matchedItem?.sku || 'UNKNOWN',
        displayName: matchedItem?.displayName || matchedItem?.name || entry?.name || entry?.desc || pkg?.family || 'Unknown Item',
        name: entry?.name || entry?.desc || matchedItem?.displayName || matchedItem?.name || pkg?.family || 'Unknown Item',
        family,
        qty,
        weight: matchedItem?.packaged?.weight_lbs || matchedItem?.weight || fallbackUnitWeight,
        isUnknown: Boolean(matchedItem?.isUnknown || entry?.matched === 'UNKNOWN' || entry?.matched === 'UNKNOWN_FALLBACK' || pkg?.type === 'unknown_pallet'),
      }
    })

    const familyNames = [...new Set(items.map((item) => item.family).filter(Boolean))]
    const family = familyNames.length === 1 ? familyNames[0] : 'Mixed'
    const cubicFeet = roundToTenth((l * w * h) / 1728)
    const density = cubicFeet > 0 ? roundToTenth(weight / cubicFeet) : 0

    return {
      id: pkg?.id || idx + 1,
      items,
      dims: [l, w, h],
      weight,
      family,
      type: pkg?.type || 'standard_pallet',
      group: family === 'Double Docker' ? 'double-docker' : (family === 'Mixed' ? 'mixed' : undefined),
      palletSize: `${l}x${w}`,
      cubicFeet,
      density,
      freightClass: getFreightClassFromDensity(density),
      mergeable: Boolean(pkg?.mergeable),
      packingNote: pkg?.type === 'long_tube' ? 'Long tube ships as a separate handling unit.' : undefined,
    }
  })

  const predictedWeight = Number(data?.predicted_weight ?? prediction?.totalWeight)
  const totalWeight = Math.max(
    0,
    Math.round(Number.isFinite(predictedWeight) ? predictedWeight : pallets.reduce((sum, pallet) => sum + (pallet.weight || 0), 0))
  )
  const totalPallets = Math.max(
    0,
    Number(data?.predicted_pallets ?? prediction?.totalPallets ?? pallets.length) || pallets.length
  )
  const totalCubicFeet = roundToTenth(pallets.reduce((sum, pallet) => sum + (pallet.cubicFeet || 0), 0))
  const shippingMethod = getShippingMethodFromPackages(packages, totalWeight)
  const diagnostics = data?.diagnostics || {}
  const unknownSkus = diagnostics?.unknown_skus || diagnostics?.unknownSkus || []
  const hasUnknownItems = unknownSkus.length > 0 || pallets.some((pallet) => pallet.items.some((item) => item.isUnknown))
  const totalItems = (Array.isArray(orderItems) && orderItems.length > 0)
    ? orderItems.reduce((sum, item) => sum + (item?.qty || 0), 0)
    : pallets.reduce((sum, pallet) => sum + pallet.items.reduce((itemSum, item) => itemSum + (item?.qty || 0), 0), 0)

  return {
    pallets,
    totalWeight,
    totalCubicFeet,
    totalPallets,
    shippingMethod,
    totalItems,
    parcelItems: shippingMethod === 'Parcel' ? [{ count: totalPallets, totalWeight }] : [],
    hasUnknownItems,
    has3DPositions: false,
    diagnostics,
    confidence: prediction?.summary?.confidence || diagnostics?.confidence || 'low',
    needsReview: Boolean(prediction?.summary?.needsReview || diagnostics?.needsReview),
  }
}

function App() {
  // App mode: 'sales' | 'validation' | 'warehouse'
  const [appMode, setAppMode] = useState('sales')
  
  const [products, setProducts] = useState([])
  const [orderItems, setOrderItems] = useState([])
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [quoteNumber, setQuoteNumber] = useState('')
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState(null)
  const [pendingQuoteCalculation, setPendingQuoteCalculation] = useState(false)
  const [quoteHasManualEdits, setQuoteHasManualEdits] = useState(false)
  const [selectedPallet, setSelectedPallet] = useState(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [aiPlan, setAiPlan] = useState(null)
  const [showPackingSlip, setShowPackingSlip] = useState(false)
  const [showWarehouseView, setShowWarehouseView] = useState(false)
  const [unknownItems, setUnknownItems] = useState([]) // Track items that couldn't be matched
  const [showBOLValidator, setShowBOLValidator] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  const [overrideItem, setOverrideItem] = useState(null) // Item being edited for dimension override

  // Load products
  useEffect(() => {
    fetch('/products.json')
      .then(res => res.json())
      .then(data => {
        // Filter to products with dims
        const withDims = data.products.filter(p => p.packaged.weight_lbs && p.packaged.length_in)
        console.log(`[LOAD] Loaded ${withDims.length} products with dimensions`)
        console.log('[LOAD] DD products:', withDims.filter(p => p.sku?.startsWith('DD-')).map(p => p.sku))
        setProducts(withDims)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to load products:', err)
        setLoading(false)
      })
  }, [])
  
  // Auto-load quote from URL parameter (wait for products to load first)
  useEffect(() => {
    if (products.length === 0) return // Wait for products to load
    const params = new URLSearchParams(window.location.search)
    const quoteParam = params.get('quote')
    if (quoteParam && orderItems.length === 0) { // Only auto-load once
      loadQuote(quoteParam)
    }
  }, [products])
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Enter to calculate (when not in an input field)
      if (e.key === 'Enter' && e.target.tagName !== 'INPUT' && orderItems.length > 0) {
        calculatePallets()
      }
      // Escape to clear selection
      if (e.key === 'Escape') {
        setSelectedPallet(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [orderItems])

  useEffect(() => {
    if (!pendingQuoteCalculation || orderItems.length === 0) return
    calculatePallets()
    setPendingQuoteCalculation(false)
  }, [pendingQuoteCalculation, orderItems])

  const orderSkuCount = orderItems.length
  const orderUnitCount = orderItems.reduce((sum, item) => sum + (item?.qty || 0), 0)
  const orderEstimatedWeight = orderItems.reduce((sum, item) => {
    return sum + ((item?.packaged?.weight_lbs || 0) * (item?.qty || 0))
  }, 0)
  const hasUnknownOrderItems = orderItems.some(item => item.isUnknown && !getOverride(item.sku))
  const quoteStatusTone =
    typeof quoteError === 'string'
      ? quoteError.startsWith('✓')
        ? 'success'
        : quoteError.includes('Demo')
          ? 'info'
          : 'error'
      : null

  // Load quote from NetSuite via API proxy
  const loadQuote = async (quoteNum = null) => {
    const numToLoad = quoteNum || String(quoteNumber || '').trim()
    if (!numToLoad) return
    
    // Guard: wait for products to load first
    if (!products || products.length === 0) {
      setQuoteError('Still loading products, please wait...')
      return
    }
    
    setQuoteLoading(true)
    setQuoteError(null)
    setResults(null)
    setAiPlan(null)
    if (quoteNum) setQuoteNumber(String(quoteNum)) // Update input if loaded from URL

    try {
      const response = await fetch(`${NETSUITE_CONFIG.quoteEndpoint}?num=${encodeURIComponent(numToLoad)}`)
      const data = await response.json()

      if (!data.success) {
        const errorMsg = typeof data.error === 'string' ? data.error : 'Failed to load quote'
        setQuoteError(errorMsg)
        setQuoteLoading(false)
        return
      }

      const quote = data.quote
      if (!quote || !quote.lines || !Array.isArray(quote.lines) || quote.lines.length === 0) {
        setQuoteError('Quote not found or has no items')
        setQuoteLoading(false)
        return
      }

      // Map NetSuite line items to our product format
      // Skip Product Summary items and items with no quantity
      const newItems = []
      const unmatchedItems = []
      for (const line of quote.lines) {
        try {
          // Ensure line.item is a string and has content
          const item = String(line?.item || '').trim()
          const qty = Number(line?.quantity) || 0
          if (!item || qty <= 0) continue
          if (item === 'Product Summary' || item.includes('Product Summary')) continue
          
          // Skip common non-product items (services, fees, etc.)
          const skipPatterns = ['freight', 'shipping', 'labor', 'installation', 'service', 'fee', 'tax', 'discount']
          if (skipPatterns.some(p => item.toLowerCase().includes(p))) continue
          
          // Skip kit SKUs that ship with main products (DD kits, anchor kits, etc.)
          // These are hardware bundles already included in the main product dims/weight
          const kitSkuPatterns = [
            /^80101-0257-.+-KIT$/i, // DD4 hardware kit
            /^80101-0258-.+-KIT$/i, // DD6 hardware kit
            /^91000-/i,             // Hardware tools (trident sockets, etc.)
            /^WAK\d+$/i,            // Wall anchor kits
            /^26268$/i,             // Public Work Stand Install Kit - small, packs with hardware
            /^\d{5}\s*\(/i,         // SKUs like "26246 (HSO Pump...)" - Saris accessories
            /^3000[PQ]-/i,          // Screws (3000P-, 3000Q-)
            /^31000-/i,             // Washers (31000-)
            /^39000-/i,             // Nuts (39000-)
            /^81000-/i,             // Anchor/hardware kits (81000-)
          ]
          if (kitSkuPatterns.some(pattern => pattern.test(item))) {
            console.log(`[MATCH] ⏭️ Skipping kit/hardware SKU: "${item}"`)
            continue
          }
          
          // Normalize item SKU to string
          const itemSku = item
          const safeQty = Math.max(1, Math.round(qty))
          
          // Match by SKU - try exact match first, then prefix match
          console.log(`[MATCH] Trying to match SKU: "${itemSku}" against ${products.length} products`)
          const product = products.find(p => {
            const pSku = String(p?.sku || '')
            return pSku === itemSku || 
              pSku.startsWith(itemSku) ||
              itemSku.startsWith(pSku)
          })
          if (product) {
            console.log(`[MATCH] ✅ Found: ${product.sku} -> ${product.displayName}`)
            newItems.push({ ...product, qty: safeQty })
          } else {
            // Track unknown item with fallback dimensions
            console.log(`[MATCH] ❌ No match for: "${itemSku}"`)
            unmatchedItems.push({
              sku: itemSku,
              displayName: line.description || itemSku,
              qty: safeQty,
              family: 'Unknown',
              packaged: {
                // Fallback dimensions for unknown products
                length_in: 24,
                width_in: 18,
                height_in: 12,
                weight_lbs: 25
              },
              isUnknown: true // Flag for UI warning
            })
          }
        } catch (lineErr) {
          console.error('Error processing line:', line, lineErr)
          // Continue with other lines
        }
      }
      
      // Store unknown items for warning display
      setUnknownItems(unmatchedItems)
      setQuoteHasManualEdits(false)

      if (newItems.length > 0 || unmatchedItems.length > 0) {
        // Combine matched and unmatched items
        const allItems = [...newItems, ...unmatchedItems]
        
        setOrderItems(prev => {
          // Merge with existing items
          const merged = [...(prev || [])]
          allItems.forEach(newItem => {
            if (!newItem?.sku) return
            const existing = merged.find(m => m.sku === newItem.sku)
            if (existing) {
              existing.qty = (existing.qty || 0) + (newItem.qty || 0)
            } else {
              merged.push(newItem)
            }
          })
          return merged
        })
        setPendingQuoteCalculation(true)
        
        // Build status message
        let statusMsg = `✓ Loaded ${String(quote.tranId || 'quote')}: ${newItems.length} products`
        if (unmatchedItems.length > 0) {
          statusMsg += ` (⚠️ ${unmatchedItems.length} unknown items using fallback dims)`
        }
        setQuoteError(statusMsg)
      } else {
        setQuoteError('No matching products found in quote')
      }
    } catch (err) {
      console.error('Quote load error:', err)
      setQuoteError(`Failed to load quote: ${err?.message || 'Unknown error'}`)
    }

    setQuoteLoading(false)
  }

  // Update quantity
  const updateQty = (sku, delta) => {
    setQuoteHasManualEdits(true)
    setOrderItems(orderItems.map(item => {
      if (item.sku === sku) {
        const newQty = item.qty + delta
        return newQty > 0 ? { ...item, qty: newQty } : null
      }
      return item
    }).filter(Boolean))
  }

  // Remove item
  const removeItem = (sku) => {
    setQuoteHasManualEdits(true)
    setOrderItems(orderItems.filter(item => item.sku !== sku))
  }
  
  // Clear entire order
  const clearOrder = () => {
    setOrderItems([])
    setResults(null)
    setSelectedPallet(null)
    setUnknownItems([])
    setQuoteHasManualEdits(false)
  }

  // AI-powered packing optimization
  const aiOptimizePacking = async () => {
    setIsOptimizing(true)
    setAiPlan(null)
    
    try {
      // Prepare items with dimensions
      const items = orderItems.map(item => ({
        sku: item.sku,
        name: item.displayName || item.sku,
        quantity: item.qty,
        length: item.packaged?.length_in || 48,
        width: item.packaged?.width_in || 40,
        height: item.packaged?.height_in || 12,
        weight: item.packaged?.weight_lbs || 50
      }))
      
      const response = await fetch('/api/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      })
      
      const data = await response.json()
      
      if (data.success && data.plan) {
        setAiPlan(data.plan)
        
        // Calculate cubic feet from order items
        const totalCubicFeet = orderItems.reduce((sum, item) => {
          const l = item.packaged?.length_in || 48
          const w = item.packaged?.width_in || 40
          const h = item.packaged?.height_in || 12
          return sum + ((l * w * h * item.qty) / 1728)
        }, 0).toFixed(1)
        
        // Determine shipping method based on weight/pallets
        const totalPallets = data.plan.total_pallets || 1
        const totalWeight = data.plan.total_weight || 0
        let shippingMethod = 'LTL'
        if (totalPallets <= 1 && totalWeight < 150) shippingMethod = 'Parcel'
        else if (totalPallets >= 6 || totalWeight > 10000) shippingMethod = 'Truck'
        
        // Also update results to show pallet count
        setResults({
          totalPallets,
          totalWeight,
          totalCubicFeet,
          shippingMethod,
          pallets: (data.plan.pallets || []).map((p, i) => ({
            id: i + 1,
            items: (p.layers || []).flatMap(l => l.products || []),
            totalWeight: p.total_weight || 0,
            totalHeight: p.total_height || 0,
            notes: p.notes || ''
          }))
        })
      } else {
        alert('Optimization failed: ' + (data.error || 'Unknown error'))
      }
    } catch (err) {
      console.error('AI optimization error:', err)
      alert('Failed to optimize: ' + err.message)
    } finally {
      setIsOptimizing(false)
    }
  }

  // Calculate shipment plan using the same backend engine as warehouse validation.
  const calculatePallets = async () => {
    if (!orderItems.length && !quoteNumber) return

    setQuoteLoading(true)
    setQuoteError(null)
    setAiPlan(null)

    try {
      const trimmedQuoteNumber = String(quoteNumber || '').trim()
      const useQuoteSource = trimmedQuoteNumber && !quoteHasManualEdits
      const payload = useQuoteSource
        ? { quoteNumber: trimmedQuoteNumber }
        : {
            items: orderItems.map((item) => ({
              sku: item.sku,
              name: item.displayName || item.name || item.sku,
              qty: item.qty,
            })),
          }

      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json()

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to build shipment plan')
      }

      const mappedResults = mapPredictionToResults(data, orderItems)

      logPackingCalculation({
        quoteNumber: trimmedQuoteNumber || null,
        items: orderItems,
        pallets: mappedResults.pallets,
        shipMethod: mappedResults.shippingMethod,
      })

      setUnknownItems((data?.diagnostics?.unknown_skus || data?.diagnostics?.unknownSkus || []).map((sku) => ({
        sku,
        isUnknown: true,
      })))
      setResults(mappedResults)
    } catch (err) {
      console.error('Prediction error:', err)
      setResults(null)
      setQuoteError(`Failed to build shipment plan: ${err?.message || 'Unknown error'}`)
    } finally {
      setQuoteLoading(false)
    }
  }

  // Legacy calculation kept for reference
  const calculatePalletsLegacy = () => {
    const MAX_WEIGHT = PACKING_RULES.maxPalletWeight
    const MAX_HEIGHT = PACKING_RULES.maxPalletHeight
    const PALLET_WEIGHT = PACKING_RULES.palletWeight
    const PALLET_HEIGHT = 6 // inches
    
    // First, use real BOL data to estimate total pallets per product type
    // IMPROVED: Handle mixed orders where products can share pallets
    let ddPallets = 0  // Double Docker ships separately (component-based)
    let sikPallets = 0 // SIK Struts ship separately (large)
    let lockerPallets = 0 // Lockers are big
    let otherPallets = 0 // Everything else can mix
    const productPalletEstimates = []
    let ddBreakdown = null // Store DD component breakdown
    
    // First pass: count DD units for component-based packing
    let dd4Count = 0
    let dd6Count = 0
    orderItems.forEach(item => {
      const key = getProductKey(item.sku, item.family, item.name)
      if (key === 'dd4') dd4Count += item.qty
      if (key === 'dd6') dd6Count += item.qty
    })
    
    // Calculate DD pallets using component-based packing (Chad's method)
    if (dd4Count > 0 || dd6Count > 0) {
      ddBreakdown = calculateDDPallets(dd4Count, dd6Count)
      ddPallets = ddBreakdown.totalPallets
      console.log('DD Component Packing:', ddBreakdown)
    }
    
    orderItems.forEach(item => {
      const key = getProductKey(item.sku, item.family, item.name)
      const estimate = getEstimatedPallets(item.sku, item.family, item.qty)
      
      if (estimate) {
        productPalletEstimates.push({
          sku: item.sku,
          family: item.family,
          qty: item.qty,
          key,
          estimatedPallets: estimate
        })
        
        // Categorize by what can share pallets
        // DD already calculated above with component-based logic
        if (key === 'dd4' || key === 'dd6') {
          // Skip - already calculated
        } else if (key && key.startsWith('sik')) {
          sikPallets += estimate  // SIK struts are large rails
        } else if (key === 'mbv1' || key === 'mbv2' || key === 'visi1' || key === 'visi2') {
          lockerPallets += estimate  // Lockers are big boxes
        } else {
          otherPallets += estimate  // Everything else can mix
        }
      }
    })
    
    // Apply mixed-order efficiency: products can share pallets
    // Based on BOL data: mixed Varsity+VR+Skatedock often fit 150+ units on 1 pallet
    if (otherPallets > 1) {
      // Count how many mixed product types (excluding DD/SIK/Locker)
      const numMixedTypes = new Set(productPalletEstimates.filter(p => 
        !['dd4', 'dd6', 'mbv1', 'mbv2', 'visi1', 'visi2'].includes(p.key) &&
        !p.key?.startsWith('sik')
      ).map(p => p.key)).size
      
      if (numMixedTypes >= 2) {
        // Multi-type mix: 50% reduction (verified from SO 6422, 6521, 6499)
        otherPallets = Math.max(1, Math.ceil(otherPallets * 0.5))
      } else if (otherPallets >= 3) {
        // Single type large order: 30% reduction
        otherPallets = Math.max(1, Math.ceil(otherPallets * 0.7))
      }
    }
    
    // Total: DD/SIK/Lockers ship separately, others can mix
    let estimatedTotalPallets = ddPallets + sikPallets + lockerPallets + otherPallets
    
    // Minimum 1 pallet
    estimatedTotalPallets = Math.max(1, estimatedTotalPallets)
    
    // Log estimate for debugging
    console.log('BOL-based estimate:', estimatedTotalPallets, 'pallets', 
      { dd: ddPallets, sik: sikPallets, locker: lockerPallets, other: otherPallets },
      productPalletEstimates)
    
    // Expand order items into individual units for packing
    // Use STEP-measured dimensions when available, fall back to products.json
    // SKIP DD items - they use component-based packing
    const units = []
    orderItems.forEach(item => {
      const key = getProductKey(item.sku, item.family, item.name)
      
      // Skip DD products - they're handled separately with component packing
      if (key === 'dd4' || key === 'dd6') {
        return // Will create DD pallets from component breakdown
      }
      
      // Get accurate dims from STEP files if available
      const accurateDims = getAccurateDims(item.sku, item.packaged)
      const realWeight = getRealWeight(item.sku, item.family, accurateDims.weight_lbs || 50)
      
      for (let i = 0; i < item.qty; i++) {
        units.push({
          ...item,
          qty: 1,
          weight: realWeight,
          length: accurateDims.length_in || 48,
          width: accurateDims.width_in || 40,
          height: accurateDims.height_in || 12,
          // Store accurate dims for visualization
          accurateDims: accurateDims
        })
      }
    })
    
    // Sort for proper stacking: heaviest/largest on BOTTOM, lightest/smallest on TOP
    units.sort((a, b) => {
      // Primary: weight (heavier on bottom = first in array = bottom of pallet)
      const weightDiff = b.weight - a.weight
      if (Math.abs(weightDiff) > 10) return weightDiff
      
      // Secondary: footprint (larger base on bottom)
      const footprintA = a.length * a.width
      const footprintB = b.length * b.width
      return footprintB - footprintA
    })
    
    const pallets = []
    const unassigned = [...units]
    
    while (unassigned.length > 0) {
      // Start a new pallet
      const pallet = {
        id: pallets.length + 1,
        items: [],
        currentWeight: PALLET_WEIGHT,
        currentHeight: PALLET_HEIGHT,
        maxLength: 48,
        maxWidth: 40
      }
      
      // Try to fit as many items as possible
      let i = 0
      while (i < unassigned.length) {
        const unit = unassigned[i]
        
        // Check if unit fits on this pallet
        const newWeight = pallet.currentWeight + unit.weight
        const newHeight = pallet.currentHeight + unit.height
        
        if (newWeight <= MAX_WEIGHT && newHeight <= MAX_HEIGHT) {
          // It fits! Add to pallet
          pallet.currentWeight = newWeight
          pallet.currentHeight = newHeight
          pallet.maxLength = Math.max(pallet.maxLength, unit.length)
          pallet.maxWidth = Math.max(pallet.maxWidth, unit.width)
          
          // Check if same product already on pallet
          const existing = pallet.items.find(p => p.sku === unit.sku)
          if (existing) {
            existing.qty += 1
          } else {
            pallet.items.push({ ...unit, qty: 1 })
          }
          
          unassigned.splice(i, 1)
        } else {
          i++
        }
      }
      
      // Finalize pallet
      pallets.push({
        id: pallet.id,
        items: pallet.items,
        dims: [pallet.maxLength, pallet.maxWidth, Math.ceil(pallet.currentHeight)],
        weight: Math.ceil(pallet.currentWeight),
        family: pallet.items.length === 1 ? pallet.items[0].family : 'Mixed'
      })
    }
    
    // Create DD component pallets if we have DD breakdown
    // Each component type gets its own pallets (slides together, tracks together, etc.)
    if (ddBreakdown && ddBreakdown.components) {
      console.log('Creating DD pallets from breakdown:', ddBreakdown)
      
      Object.entries(ddBreakdown.components).forEach(([compKey, comp]) => {
        // Calculate realistic pallet capacity for this component
        // Standard pallet: 48" x 40" x 96" max height
        const compL = comp.dims?.l || 80
        const compW = comp.dims?.w || 16
        const compH = comp.dims?.h || 6
        const compWeight = comp.weight || 30
        
        // How many fit side-by-side on pallet?
        const itemsPerRow = Math.max(1, Math.floor(40 / compW)) // 40" pallet width
        // How many layers can we stack? (96" - 6" pallet = 90" usable)
        const maxLayers = Math.floor(90 / compH)
        // Max weight per pallet (2500 - 50 for pallet = 2450 lbs usable)
        const maxByWeight = Math.floor(2450 / compWeight)
        
        // Units per pallet = min of height limit and weight limit
        const unitsPerPallet = Math.min(
          itemsPerRow * maxLayers,
          maxByWeight,
          comp.unitsPerPallet || 20
        )
        
        let remaining = comp.totalUnits
        while (remaining > 0) {
          const unitsOnPallet = Math.min(remaining, unitsPerPallet)
          const layers = Math.ceil(unitsOnPallet / itemsPerRow)
          const palletWeight = unitsOnPallet * compWeight + PALLET_WEIGHT
          const stackHeight = layers * compH + PALLET_HEIGHT
          
          pallets.push({
            id: pallets.length + 1,
            items: [{
              sku: compKey,
              family: 'Double Docker',
              displayName: comp.name,
              qty: unitsOnPallet,
              weight: compWeight,
              length: compL,
              width: compW,
              height: compH,
            }],
            dims: [48, 40, Math.min(96, Math.ceil(stackHeight))], // Standard pallet footprint
            weight: Math.ceil(palletWeight),
            family: 'Double Docker',
          })
          
          remaining -= unitsOnPallet
        }
      })
    }

    // Calculate freight class for each pallet based on density
    pallets.forEach(pallet => {
      const cubicFeet = (pallet.dims[0] * pallet.dims[1] * pallet.dims[2]) / 1728
      const density = pallet.weight / cubicFeet
      
      // Freight class lookup based on density (lbs per cubic foot)
      if (density >= 50) pallet.freightClass = 50
      else if (density >= 35) pallet.freightClass = 55
      else if (density >= 30) pallet.freightClass = 60
      else if (density >= 22.5) pallet.freightClass = 65
      else if (density >= 15) pallet.freightClass = 70
      else if (density >= 13.5) pallet.freightClass = 77.5
      else if (density >= 12) pallet.freightClass = 85
      else if (density >= 10.5) pallet.freightClass = 92.5
      else if (density >= 9) pallet.freightClass = 100
      else if (density >= 8) pallet.freightClass = 110
      else if (density >= 7) pallet.freightClass = 125
      else if (density >= 6) pallet.freightClass = 150
      else if (density >= 5) pallet.freightClass = 175
      else if (density >= 4) pallet.freightClass = 200
      else if (density >= 3) pallet.freightClass = 250
      else if (density >= 2) pallet.freightClass = 300
      else if (density >= 1) pallet.freightClass = 400
      else pallet.freightClass = 500
      
      pallet.density = Math.round(density * 10) / 10
      pallet.cubicFeet = Math.round(cubicFeet * 10) / 10
    })

    // Calculate totals
    const totalWeight = pallets.reduce((sum, p) => sum + p.weight, 0)
    const totalCubicFeet = pallets.reduce((sum, p) => sum + p.cubicFeet, 0)
    const totalPallets = pallets.length
    
    // Determine shipping method
    let shippingMethod = 'LTL'
    if (totalWeight > 15000 || totalPallets > 10) {
      shippingMethod = 'Full Truckload'
    } else if (totalWeight > 10000 || totalPallets > 6) {
      shippingMethod = 'Partial TL'
    } else if (totalWeight < 150 && totalPallets <= 1) {
      shippingMethod = 'Parcel'
    }

    setResults({
      pallets,
      totalWeight,
      totalCubicFeet: Math.round(totalCubicFeet * 10) / 10,
      totalPallets,
      shippingMethod,
      totalItems: orderItems.reduce((sum, item) => sum + item.qty, 0)
    })
  }

  const getBoxColor = (family) => {
    return PACKING_RULES.familyColors[family] || 'default'
  }

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p>Loading products...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <header>
        <div className="header-top">
          <div className="hermes-brand">
            <div className="hermes-brand-mark" aria-hidden="true">
              <svg viewBox="0 0 96 96" role="presentation">
                <defs>
                  <linearGradient id="hermesHelmet" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f8fafc" />
                    <stop offset="100%" stopColor="#cbd5e1" />
                  </linearGradient>
                  <linearGradient id="hermesBox" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#f59e0b" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                </defs>
                <circle cx="48" cy="48" r="44" fill="rgba(255,255,255,0.08)" />
                <ellipse cx="40" cy="46" rx="17" ry="19" fill="#fde7d0" />
                <path d="M24 35c3-13 14-20 27-20 12 0 22 6 27 16l-7 6H31l-7-2z" fill="url(#hermesHelmet)" />
                <path d="M68 23c8 1 13 6 16 14-7-2-12-1-16 3 1-5 1-11 0-17z" fill="#f8fafc" />
                <path d="M70 28c6 1 10 4 12 9-5-1-9 0-12 3" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="34" cy="46" r="2.2" fill="#0f172a" />
                <circle cx="45" cy="46" r="2.2" fill="#0f172a" />
                <path d="M34 56c4 4 10 4 14 0" fill="none" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
                <rect x="51" y="48" width="24" height="18" rx="3" fill="url(#hermesBox)" />
                <path d="M51 55h24M63 48v18" fill="none" stroke="#fff7ed" strokeWidth="2" opacity="0.7" />
                <path d="M17 60c7 0 11 3 14 8" fill="none" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </div>
            <div className="hermes-brand-copy">
              <h1>Hermes</h1>
              <p>Internal quote and shipment planner</p>
            </div>
          </div>
        </div>
        
        {/* Mode Switcher */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px', marginBottom: '8px' }}>
          <ModeSwitcher currentMode={appMode} onModeChange={setAppMode} />
        </div>
        
        {appMode === 'sales' && (
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/guide.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '8px 16px',
              background: '#f3f4f6',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              textDecoration: 'none',
              fontWeight: '500',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            ❓ Quick Start Guide
          </a>
          <button
            onClick={exportPackingLogs}
            title={`${getPackingLogs().length} calculations logged - click to export for ML training`}
            style={{
              padding: '8px 16px',
              background: '#f0fdf4',
              color: '#166534',
              border: '1px solid #86efac',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '500',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.875rem',
            }}
          >
            📊 {getPackingLogs().length} Logs
          </button>
        </div>
        )}
      </header>

      {/* Validate Mode - Manual pallet data entry */}
      {appMode === 'validate' && (
        <div className="container">
          <ValidationForm />
        </div>
      )}

      {/* Warehouse Mode - Use existing WarehouseView if results exist */}
      {appMode === 'warehouse' && results && (
        <div className="container">
          <WarehouseView 
            pallets={results.pallets} 
            onClose={() => setAppMode('sales')} 
          />
        </div>
      )}
      
      {appMode === 'warehouse' && !results && (
        <div className="container">
          <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
            <p style={{ fontSize: '48px', marginBottom: '16px' }}>📦</p>
            <h3>No Packing Data</h3>
            <p style={{ color: '#94a3b8', marginTop: '8px' }}>
              Switch to Quoting and calculate pallets first, then come back here for packing instructions.
            </p>
            <button 
              onClick={() => setAppMode('sales')}
              style={{ marginTop: '20px', padding: '10px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
            >
              Go to Quoting
            </button>
          </div>
        </div>
      )}

      {/* Sales Mode - Main configurator */}
      {appMode === 'sales' && (
      <>
      <div className="container sales-shell">
        <div className="sales-hero">
          <div className="sales-hero-copy">
            <div className="sales-kicker">Hermes</div>
            <h2>Quote in. Shipment plan out.</h2>
            <p>
              Import a NetSuite quote and Hermes will map the pallets, dims, and weights for the shipment.
            </p>
          </div>
          <div className="sales-hero-stats">
            <div className="sales-hero-stat">
              <span className="sales-hero-label">Quote</span>
              <strong>{quoteNumber ? `#${quoteNumber}` : 'Not loaded'}</strong>
            </div>
            <div className="sales-hero-stat">
              <span className="sales-hero-label">Lines</span>
              <strong>{orderSkuCount}</strong>
            </div>
            <div className="sales-hero-stat">
              <span className="sales-hero-label">Units</span>
              <strong>{orderUnitCount}</strong>
            </div>
            <div className="sales-hero-stat">
              <span className="sales-hero-label">Projected lbs</span>
              <strong>{orderEstimatedWeight.toLocaleString()} lbs</strong>
            </div>
          </div>
        </div>

        <div className="sales-layout">
          <div className="sales-workbench">
            <div className="card sales-section-card sales-import-card">
              <div className="sales-section-heading">
                <div>
                  <div className="sales-step-tag">Step 1</div>
                  <h2>Import Quote</h2>
                </div>
                <p>Enter the NetSuite quote number and pull it in.</p>
              </div>

              <div className="sales-import-row">
                <input
                  type="text"
                  className="quote-input sales-quote-input"
                  placeholder="Enter quote number (example: QUO33922)"
                  value={quoteNumber}
                  onChange={(e) => setQuoteNumber(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadQuote()}
                />
                <button
                  className="sales-import-btn"
                  onClick={() => loadQuote()}
                  disabled={quoteLoading || !String(quoteNumber || '').trim()}
                >
                  {quoteLoading ? 'Loading...' : 'Pull Quote'}
                </button>
              </div>

              {quoteError && typeof quoteError === 'string' && (
                <div className={`sales-inline-message ${quoteStatusTone ? `tone-${quoteStatusTone}` : ''}`}>
                  {quoteError}
                </div>
              )}
            </div>

            <div className="card sales-section-card sales-order-card">
              <div className="sales-section-heading">
                <div>
                  <div className="sales-step-tag">Step 2</div>
                  <h2>Review Quote</h2>
                </div>
                <p>Check the imported lines, then build the shipment plan.</p>
              </div>

              {orderItems.length > 0 ? (
                <>
                  <div className="sales-order-summary">
                    <div className="sales-order-pill">
                      <span>Lines</span>
                      <strong>{orderSkuCount}</strong>
                    </div>
                    <div className="sales-order-pill">
                      <span>Units</span>
                      <strong>{orderUnitCount}</strong>
                    </div>
                    <div className="sales-order-pill">
                      <span>Projected lbs</span>
                      <strong>{orderEstimatedWeight.toLocaleString()} lbs</strong>
                    </div>
                    <button className="sales-clear-btn" onClick={clearOrder}>
                      Clear order
                    </button>
                  </div>

                  {hasUnknownOrderItems && (
                    <div className="sales-warning-card">
                      <strong>Unknown products detected</strong>
                      <p>
                        {orderItems.filter(i => i.isUnknown && !getOverride(i.sku)).length} item(s) are using fallback dimensions. Use edit before trusting a freight quote.
                      </p>
                    </div>
                  )}

                  <div className="order-list">
                    {orderItems.filter(item => item && item.sku).map(item => {
                      const hasOverride = getOverride(item.sku)
                      const showAsUnknown = item.isUnknown && !hasOverride
                      const showAsCorrected = item.isUnknown && hasOverride

                      return (
                        <div
                          key={item.sku}
                          className="order-item"
                          style={showAsUnknown ? {
                            background: '#fef3c7',
                            border: '1px solid #fcd34d'
                          } : showAsCorrected ? {
                            background: '#dcfce7',
                            border: '1px solid #86efac'
                          } : {}}
                        >
                          <div className="order-item-info">
                            <div className="order-item-name">
                              {showAsUnknown && <span style={{ color: '#d97706' }}>⚠️ </span>}
                              {showAsCorrected && <span style={{ color: '#16a34a' }}>✓ </span>}
                              {String(item.displayName || item.sku || 'Unknown')}
                            </div>
                            <div className="order-item-details">
                              {item.packaged?.weight_lbs || 0} lbs × {item.qty || 0} = {((item.packaged?.weight_lbs || 0) * (item.qty || 0)).toFixed(0)} lbs
                              {showAsUnknown && <span style={{ color: '#d97706', marginLeft: '8px' }}>(fallback dims)</span>}
                              {showAsCorrected && <span style={{ color: '#16a34a', marginLeft: '8px' }}>(corrected)</span>}
                            </div>
                          </div>
                          <div className="qty-controls">
                            {(item.isUnknown || showAsCorrected) && (
                              <button
                                className="qty-btn"
                                onClick={() => setOverrideItem(item)}
                                title="Edit dimensions"
                                style={{
                                  background: showAsCorrected ? '#dcfce7' : '#fef3c7',
                                  color: showAsCorrected ? '#16a34a' : '#d97706',
                                  border: `1px solid ${showAsCorrected ? '#86efac' : '#fcd34d'}`,
                                  fontSize: '0.8rem'
                                }}
                              >
                                ✏️
                              </button>
                            )}
                            <button className="qty-btn" onClick={() => updateQty(item.sku, -1)}>−</button>
                            <span className="qty-value">{item.qty || 0}</span>
                            <button className="qty-btn" onClick={() => updateQty(item.sku, 1)}>+</button>
                            <button className="qty-btn remove" onClick={() => removeItem(item.sku)}>×</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  <div className="sales-action-stack">
                    <button
                      className="calculate-btn"
                      onClick={calculatePallets}
                      disabled={orderItems.length === 0}
                    >
                      Build manifest
                    </button>
                  </div>

                  <p className="sales-keyboard-hint">
                    Press Enter anywhere outside an input to rebuild the shipment plan after the quote is imported.
                  </p>
                </>
              ) : (
                <div className="sales-empty-review">
                  <div className="sales-empty-icon">🧾</div>
                  <h3>No quote loaded</h3>
                  <p>Pull a quote above to load the shipment lines.</p>
                </div>
              )}
            </div>
          </div>

          <div className="card sales-results-card">
            <div className="sales-section-heading">
              <div>
                  <div className="sales-step-tag">Step 3</div>
                <h2>Shipment Plan</h2>
              </div>
              <p>Hermes keeps the quote input separate from the shipment output so the readout stays clear.</p>
            </div>

            {!results ? (
              <div className="sales-results-empty">
                <div className="empty-state">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p>
                    {orderItems.length > 0
                      ? 'The quote is loaded. Build the shipment plan to generate the readout.'
                      : 'Pull a quote in Step 1. Hermes will show the shipment plan here.'}
                  </p>
                </div>
                <div className="sales-results-checklist">
                  <div className={`sales-check-item ${quoteNumber ? 'done' : ''}`}>Quote entered</div>
                  <div className={`sales-check-item ${orderItems.length > 0 ? 'done' : ''}`}>Quote lines loaded</div>
                  <div className={`sales-check-item ${results ? 'done' : ''}`}>Shipment plan generated</div>
                </div>
              </div>
            ) : (
              <>
                <div className="results-summary">
                  <div className="summary-stat">
                    <div className="value">
                      {results.shippingMethod === 'Parcel'
                        ? (results.parcelItems?.[0]?.count || 1)
                        : (results.totalPallets || 0)}
                    </div>
                    <div className="label">
                      {results.shippingMethod === 'Parcel' ? 'Packages' : 'Pallets'}
                    </div>
                  </div>
                  <div className="summary-stat">
                    <div className="value">{(results.totalWeight || 0).toLocaleString()}</div>
                    <div className="label">Total lbs</div>
                  </div>
                  <div className="summary-stat">
                    <div className="value">{results.totalCubicFeet || '0'}</div>
                    <div className="label">Cubic Ft</div>
                  </div>
                  <div className="summary-stat">
                    <div
                      className="sales-ship-method-value"
                      style={{ color: (results.shippingMethod === 'Parcel') ? '#16a34a' : (results.shippingMethod === 'LTL') ? '#2563eb' : '#d97706' }}
                    >
                      {results.shippingMethod || 'LTL'}
                    </div>
                    <div className="label">Ship Method</div>
                  </div>
                </div>

                {results.shippingMethod === 'Parcel' && (
                  <div className="sales-notice-card tone-success">
                    <strong>Parcel shipment</strong>
                    <p>
                      Hermes marked this as parcel-capable. Estimated {results.parcelItems?.[0]?.count || 1} package(s), {results.totalWeight} lbs total.
                    </p>
                  </div>
                )}

                {results.hasUnknownItems && (
                  <div className="sales-notice-card tone-warning">
                    <strong>Accuracy notice</strong>
                    <p>
                      This order contains unknown products with estimated dimensions. Verify dimensions before using this for freight quoting.
                    </p>
                  </div>
                )}

                {results.pallets && results.pallets.length > 0 && (
                  <TextPackingOutput
                    results={results}
                    quoteNumber={quoteNumber}
                  />
                )}

                <div className="sales-actions-panel">
                  <div className="sales-actions-heading">
                    <h3>Quoting Actions</h3>
                    <p>Use the shipment plan for quoting, then print or copy the summary.</p>
                  </div>
                  <div className="sales-action-grid">
                    <button className="sales-action-btn tone-blue" onClick={() => setShowPackingSlip(true)}>
                      🖨️ Print Manifest
                    </button>
                    <button
                      className="sales-action-btn tone-neutral"
                      onClick={() => {
                        const text = results.pallets.map(p =>
                          `Pallet ${p.id}: ${p.dims.join('×')}" @ ${p.weight} lbs (Class ${p.freightClass})\n` +
                          p.items.map(i => `  - ${i.qty}× ${i.displayName || i.family}`).join('\n')
                        ).join('\n\n')
                        navigator.clipboard.writeText(text)
                        alert('Copied to clipboard!')
                      }}
                    >
                      📋 Copy Dispatch Summary
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Packing Slip Modal */}
      {showPackingSlip && results && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 1000,
          overflow: 'auto',
          padding: '20px',
        }}>
          <div style={{
            maxWidth: '850px',
            margin: '0 auto',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          }}>
            <PackingSlip 
              results={results}
              quoteNumber={quoteNumber || undefined}
              onClose={() => setShowPackingSlip(false)}
            />
          </div>
        </div>
      )}

      {/* Warehouse Mode */}
      {showWarehouseView && results && (
        <WarehouseView 
          results={results}
          quoteNumber={quoteNumber || undefined}
          onClose={() => setShowWarehouseView(false)}
        />
      )}

      {/* BOL Validator Modal */}
      {showBOLValidator && results && (
        <BOLValidator
          packingResult={results.pallets}
          quoteNumber={quoteNumber}
          onClose={() => setShowBOLValidator(false)}
        />
      )}

      {/* Packing Comparison Modal */}
      {showComparison && orderItems.length > 0 && (
        <PackingComparison
          items={orderItems}
          options={{
            maxHeight: 96,
            palletLength: 48,
            palletWidth: 40,
          }}
          onSelect={(pallets, strategy) => {
            console.log(`Selected strategy: ${strategy}`)
            // Could update results with selected strategy
          }}
          onClose={() => setShowComparison(false)}
        />
      )}

      {/* Dimension Override Modal */}
      {overrideItem && (
        <DimensionOverrideModal
          item={overrideItem}
          onSave={(sku, dims) => {
            // Update the item in orderItems with new dimensions
            setOrderItems(prev => prev.map(item => {
              if (item.sku === sku) {
                return {
                  ...item,
                  packaged: {
                    ...item.packaged,
                    length_in: dims.length,
                    width_in: dims.width,
                    height_in: dims.height,
                    weight_lbs: dims.weight
                  }
                }
              }
              return item
            }))
          }}
          onRecalculate={() => {
            // Recalculate pallets if we have results
            if (results) {
              setTimeout(() => calculatePallets(), 100)
            }
          }}
          onClose={() => setOverrideItem(null)}
        />
      )}
      </>
      )}
    </>
  )
}

// Wrap App with ErrorBoundary to prevent white screen crashes
function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
}

export default AppWithErrorBoundary
