import { useState, useRef, useEffect } from 'react'

/**
 * PackingPlan Component
 * Shows detailed packing instructions with Tetris-style visualization
 * Supports drag-and-drop layer reordering
 * Allows warehouse to adjust and save preferences
 */

// Product colors for visualization
const PRODUCT_COLORS = {
  'dv215': '#2563eb',      // Varsity - blue
  'vr2': '#7c3aed',        // VR2 - purple
  'vr1': '#8b5cf6',        // VR1 - light purple
  'dd4': '#dc2626',        // DD4 - red
  'dd6': '#b91c1c',        // DD6 - dark red
  'sm10x': '#d97706',      // SkateDock - orange
  'dismount': '#0891b2',   // Dismount - cyan
  'hr101': '#16a34a',      // Hoop Runner - green
  'mbv1': '#4b5563',       // MBV1 - gray
  'mbv2': '#374151',       // MBV2 - dark gray
  'visi1': '#6b7280',      // VISI1 - gray
  'visi2': '#525252',      // VISI2 - dark gray
  'ss120': '#0369a1',      // Base stations - sky blue
  'ss95': '#0284c7',
  'ss66': '#0ea5e9',
  'ssa114': '#38bdf8',
  'ssa86': '#7dd3fc',
  'sik120': '#f59e0b',     // SIK struts - amber
  'sik114': '#fbbf24',
  'sik86': '#fcd34d',
  'default': '#9ca3af'
}

// Packing priority (lower = pack first / bottom)
const PACKING_PRIORITY = {
  'dd4': 1, 'dd6': 1,           // DD goes on own pallets, first
  'mbv1': 2, 'mbv2': 2,         // Lockers - heavy, own pallets
  'visi1': 2, 'visi2': 2,
  'ss120': 3, 'ss95': 3,        // Base stations - long, grouped
  'ss66': 3, 'ssa114': 3,
  'sik120': 4, 'sik114': 4,     // SIK struts - long
  'sik86': 4, 'sik57': 4,
  'vr2': 5, 'vr1': 5,           // VR - medium, stackable
  'dv215': 6,                   // Varsity - light, top
  'sm10x': 6, 'dismount': 6,    // Light items on top
  'hr101': 6,
  'default': 7
}

function getProductKey(sku) {
  const skuLower = (sku || '').toLowerCase()
  
  // Varsity
  if (skuLower.includes('dv215') || skuLower.includes('varsity')) return 'dv215'
  if (skuLower.startsWith('80101-008') || skuLower.startsWith('80301-008')) return 'dv215'
  if (skuLower.startsWith('80101-028') || skuLower.startsWith('80301-028')) return 'dv215'
  if (skuLower.startsWith('90101-2287')) return 'dv215'
  
  // VR
  if (skuLower.includes('vr2') || skuLower.includes('vr-vr2')) return 'vr2'
  if (skuLower.includes('vr1') || skuLower.includes('vr-vr1')) return 'vr1'
  
  // DD
  if (skuLower.includes('dd-04') || skuLower.includes('dd4') || skuLower.includes('dd-ss-04')) return 'dd4'
  if (skuLower.includes('dd-06') || skuLower.includes('dd6') || skuLower.includes('dd-ss-06')) return 'dd6'
  
  // Lockers
  if (skuLower.includes('mbv-1') || skuLower.includes('mbv1')) return 'mbv1'
  if (skuLower.includes('mbv-2') || skuLower.includes('mbv2')) return 'mbv2'
  if (skuLower.includes('visi-1') || skuLower.includes('visi1')) return 'visi1'
  if (skuLower.includes('visi-2') || skuLower.includes('visi2')) return 'visi2'
  
  // SkateDock
  if (skuLower.includes('sm10') || skuLower.includes('skatedock')) return 'sm10x'
  
  // Dismount
  if (skuLower.includes('dismount') || skuLower.startsWith('89901-205')) return 'dismount'
  
  // Hoop Runner
  if (skuLower.includes('hr101') || skuLower.includes('hr-101')) return 'hr101'
  
  // Base stations
  if (skuLower.includes('ss120') || skuLower.includes('ss-120')) return 'ss120'
  if (skuLower.includes('ss95') || skuLower.includes('ss-95')) return 'ss95'
  if (skuLower.includes('ss66') || skuLower.includes('ss-66')) return 'ss66'
  if (skuLower.includes('ssa114')) return 'ssa114'
  if (skuLower.includes('ssa86')) return 'ssa86'
  
  // SIK struts
  if (skuLower.includes('sik120')) return 'sik120'
  if (skuLower.includes('sik114')) return 'sik114'
  if (skuLower.includes('sik86')) return 'sik86'
  if (skuLower.includes('sik57')) return 'sik57'
  
  return 'default'
}

function getColor(sku) {
  const key = getProductKey(sku)
  return PRODUCT_COLORS[key] || PRODUCT_COLORS.default
}

function getPriority(sku) {
  const key = getProductKey(sku)
  return PACKING_PRIORITY[key] || PACKING_PRIORITY.default
}

/**
 * Generate a detailed packing plan from order items
 */
export function generatePackingPlan(orderItems, palletResults) {
  if (!orderItems || orderItems.length === 0) return null
  
  // Expand items into individual units with metadata
  const units = []
  orderItems.forEach(item => {
    const key = getProductKey(item.sku)
    const priority = getPriority(item.sku)
    const color = getColor(item.sku)
    const weight = item.packaged?.weight_lbs || 50
    const height = item.packaged?.height_in || 12
    
    for (let i = 0; i < item.qty; i++) {
      units.push({
        sku: item.sku,
        name: item.displayName || item.family || item.sku,
        productKey: key,
        priority,
        color,
        weight,
        height,
        length: item.packaged?.length_in || 48,
        width: item.packaged?.width_in || 40
      })
    }
  })
  
  // Sort by priority (lower = first = bottom of pallet)
  units.sort((a, b) => a.priority - b.priority)
  
  // Group into categories
  const ddUnits = units.filter(u => u.productKey === 'dd4' || u.productKey === 'dd6')
  const lockerUnits = units.filter(u => ['mbv1', 'mbv2', 'visi1', 'visi2'].includes(u.productKey))
  const baseUnits = units.filter(u => u.productKey.startsWith('ss') || u.productKey.startsWith('ssa'))
  const sikUnits = units.filter(u => u.productKey.startsWith('sik'))
  const mixableUnits = units.filter(u => 
    !['dd4', 'dd6', 'mbv1', 'mbv2', 'visi1', 'visi2'].includes(u.productKey) &&
    !u.productKey.startsWith('ss') && !u.productKey.startsWith('ssa') &&
    !u.productKey.startsWith('sik')
  )
  
  const pallets = []
  let palletId = 1
  
  // Helper to create a pallet
  const createPallet = (type, units) => {
    const layers = []
    let currentHeight = 6 // pallet height
    let currentWeight = 50 // pallet weight
    
    // Group units by product for cleaner layers
    const grouped = {}
    units.forEach(u => {
      const key = u.sku
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(u)
    })
    
    Object.entries(grouped).forEach(([sku, items]) => {
      const layerWeight = items.reduce((sum, i) => sum + i.weight, 0)
      const layerHeight = items[0]?.height || 12
      
      layers.push({
        id: `${palletId}-${layers.length}`,
        layerNumber: layers.length + 1,
        products: [{
          sku,
          name: items[0].name,
          quantity: items.length,
          color: items[0].color
        }],
        heightFromBase: currentHeight,
        layerHeight,
        layerWeight
      })
      
      currentHeight += layerHeight
      currentWeight += layerWeight
    })
    
    return {
      id: palletId++,
      type,
      layers,
      totalHeight: currentHeight,
      totalWeight: currentWeight,
      dims: [48, 40, Math.ceil(currentHeight)]
    }
  }
  
  // DD pallets (separate)
  if (ddUnits.length > 0) {
    const ddPerPallet = 5
    for (let i = 0; i < ddUnits.length; i += ddPerPallet) {
      const batch = ddUnits.slice(i, i + ddPerPallet)
      pallets.push(createPallet('Double Docker', batch))
    }
  }
  
  // Locker pallets (separate)
  if (lockerUnits.length > 0) {
    const lockerPerPallet = 4
    for (let i = 0; i < lockerUnits.length; i += lockerPerPallet) {
      const batch = lockerUnits.slice(i, i + lockerPerPallet)
      pallets.push(createPallet('Lockers', batch))
    }
  }
  
  // SIK strut pallets
  if (sikUnits.length > 0) {
    const sikPerPallet = 6
    for (let i = 0; i < sikUnits.length; i += sikPerPallet) {
      const batch = sikUnits.slice(i, i + sikPerPallet)
      pallets.push(createPallet('Strut Kits', batch))
    }
  }
  
  // Base station + mixable (can share)
  const shareableUnits = [...baseUnits, ...mixableUnits]
  if (shareableUnits.length > 0) {
    shareableUnits.sort((a, b) => b.weight - a.weight)
    const unitsPerPallet = 60
    for (let i = 0; i < shareableUnits.length; i += unitsPerPallet) {
      const batch = shareableUnits.slice(i, i + unitsPerPallet)
      pallets.push(createPallet('Mixed', batch))
    }
  }
  
  return {
    totalPallets: pallets.length,
    totalWeight: pallets.reduce((sum, p) => sum + p.totalWeight, 0),
    totalUnits: units.length,
    pallets,
    generatedAt: new Date().toISOString()
  }
}

/**
 * Draggable Layer Component
 */
function DraggableLayer({ 
  layer, 
  palletId, 
  index, 
  editMode, 
  onDragStart, 
  onDragOver, 
  onDrop, 
  isDragOver 
}) {
  const product = layer.products[0]
  
  return (
    <div
      draggable={editMode}
      onDragStart={(e) => onDragStart(e, palletId, index)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, palletId, index)}
      style={{
        background: `linear-gradient(135deg, ${product.color} 0%, ${product.color}cc 100%)`,
        borderRadius: '6px',
        padding: '10px 14px',
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: editMode 
          ? '0 2px 8px rgba(0,0,0,0.25)' 
          : '0 1px 3px rgba(0,0,0,0.2)',
        cursor: editMode ? 'grab' : 'default',
        transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
        border: isDragOver ? '2px dashed #fff' : '2px solid transparent',
        transition: 'transform 0.15s, border 0.15s, box-shadow 0.15s',
        userSelect: 'none'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {editMode && (
          <span style={{ opacity: 0.7, fontSize: '1.1rem' }}>⋮⋮</span>
        )}
        <span style={{ fontWeight: '600' }}>
          {product.quantity}× {product.name.split(',')[0]}
        </span>
      </div>
      <span style={{ 
        fontSize: '0.75rem', 
        opacity: 0.85,
        background: 'rgba(0,0,0,0.2)',
        padding: '2px 8px',
        borderRadius: '10px'
      }}>
        Layer {layer.layerNumber}
      </span>
    </div>
  )
}

/**
 * Drop Zone Component (shown between layers in edit mode)
 */
function DropZone({ palletId, index, onDragOver, onDrop, isActive }) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, palletId, index)}
      style={{
        height: isActive ? '40px' : '8px',
        background: isActive ? '#3b82f6' : 'transparent',
        borderRadius: '4px',
        transition: 'all 0.2s',
        margin: '2px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: isActive ? '2px dashed #fff' : 'none'
      }}
    >
      {isActive && (
        <span style={{ color: 'white', fontSize: '0.75rem', fontWeight: '600' }}>
          Drop here
        </span>
      )}
    </div>
  )
}

/**
 * PackingPlan visualization component with drag-and-drop reordering
 */
export default function PackingPlan({ orderItems, results, onAdjustment }) {
  const [plan, setPlan] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [adjustments, setAdjustments] = useState([])
  const [dragState, setDragState] = useState({ 
    dragging: false, 
    sourcePallet: null, 
    sourceIndex: null,
    targetPallet: null,
    targetIndex: null 
  })
  
  // Auto-generate plan when results change
  useEffect(() => {
    if (results && results.totalPallets > 0 && orderItems.length > 0) {
      const newPlan = generatePackingPlan(orderItems, results)
      setPlan(newPlan)
    } else {
      setPlan(null)
    }
  }, [results, orderItems])
  
  // Manual regenerate (for reset button)
  const handleGeneratePlan = () => {
    const newPlan = generatePackingPlan(orderItems, results)
    setPlan(newPlan)
  }
  
  // Drag handlers
  const handleDragStart = (e, palletId, layerIndex) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', JSON.stringify({ palletId, layerIndex }))
    setDragState({
      dragging: true,
      sourcePallet: palletId,
      sourceIndex: layerIndex,
      targetPallet: null,
      targetIndex: null
    })
  }
  
  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  
  const handleDragEnter = (palletId, index) => {
    if (dragState.dragging) {
      setDragState(prev => ({
        ...prev,
        targetPallet: palletId,
        targetIndex: index
      }))
    }
  }
  
  const handleDrop = (e, targetPalletId, targetIndex) => {
    e.preventDefault()
    
    const data = JSON.parse(e.dataTransfer.getData('text/plain'))
    const { palletId: sourcePalletId, layerIndex: sourceIndex } = data
    
    // Don't do anything if dropping in the same position
    if (sourcePalletId === targetPalletId && sourceIndex === targetIndex) {
      setDragState({ dragging: false, sourcePallet: null, sourceIndex: null, targetPallet: null, targetIndex: null })
      return
    }
    
    // Update the plan with reordered layers
    setPlan(prevPlan => {
      const newPlan = { ...prevPlan, pallets: [...prevPlan.pallets] }
      
      if (sourcePalletId === targetPalletId) {
        // Reordering within the same pallet
        const palletIndex = newPlan.pallets.findIndex(p => p.id === sourcePalletId)
        const pallet = { ...newPlan.pallets[palletIndex] }
        const layers = [...pallet.layers]
        
        // Remove from source
        const [movedLayer] = layers.splice(sourceIndex, 1)
        
        // Insert at target (adjust index if needed)
        const insertIndex = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex
        layers.splice(insertIndex, 0, movedLayer)
        
        // Renumber layers
        layers.forEach((layer, idx) => {
          layer.layerNumber = idx + 1
        })
        
        pallet.layers = layers
        newPlan.pallets[palletIndex] = pallet
      } else {
        // Moving between pallets
        const sourcePalletIndex = newPlan.pallets.findIndex(p => p.id === sourcePalletId)
        const targetPalletIndex = newPlan.pallets.findIndex(p => p.id === targetPalletId)
        
        const sourcePallet = { ...newPlan.pallets[sourcePalletIndex] }
        const targetPallet = { ...newPlan.pallets[targetPalletIndex] }
        
        const sourceLayers = [...sourcePallet.layers]
        const targetLayers = [...targetPallet.layers]
        
        // Remove from source
        const [movedLayer] = sourceLayers.splice(sourceIndex, 1)
        
        // Insert at target
        targetLayers.splice(targetIndex, 0, movedLayer)
        
        // Renumber both pallets
        sourceLayers.forEach((layer, idx) => layer.layerNumber = idx + 1)
        targetLayers.forEach((layer, idx) => layer.layerNumber = idx + 1)
        
        // Update weights
        const movedWeight = movedLayer.layerWeight
        sourcePallet.totalWeight -= movedWeight
        targetPallet.totalWeight += movedWeight
        
        sourcePallet.layers = sourceLayers
        targetPallet.layers = targetLayers
        
        newPlan.pallets[sourcePalletIndex] = sourcePallet
        newPlan.pallets[targetPalletIndex] = targetPallet
        
        // Remove empty pallets
        newPlan.pallets = newPlan.pallets.filter(p => p.layers.length > 0)
        newPlan.totalPallets = newPlan.pallets.length
      }
      
      return newPlan
    })
    
    // Log the adjustment
    logAdjustment(targetPalletId, 'layer-reordered', {
      from: { pallet: sourcePalletId, index: sourceIndex },
      to: { pallet: targetPalletId, index: targetIndex }
    })
    
    setDragState({ dragging: false, sourcePallet: null, sourceIndex: null, targetPallet: null, targetIndex: null })
  }
  
  const handleDragEnd = () => {
    setDragState({ dragging: false, sourcePallet: null, sourceIndex: null, targetPallet: null, targetIndex: null })
  }
  
  // Log an adjustment
  const logAdjustment = (palletId, change, details = {}) => {
    const adjustment = {
      timestamp: new Date().toISOString(),
      palletId,
      change,
      details,
      orderSnapshot: orderItems.map(i => ({ sku: i.sku, qty: i.qty }))
    }
    setAdjustments(prev => [...prev, adjustment])
    
    if (onAdjustment) {
      onAdjustment(adjustment)
    }
  }
  
  // Reset to original
  const handleReset = () => {
    const newPlan = generatePackingPlan(orderItems, results)
    setPlan(newPlan)
    setAdjustments([])
  }
  
  if (!results || !results.totalPallets) {
    return null
  }
  
  return (
    <div style={{ marginTop: '24px' }} onDragEnd={handleDragEnd}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        <h2 style={{ margin: 0 }}>📦 Packing Plan</h2>
        {plan && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setEditMode(!editMode)}
                style={{
                  padding: '8px 16px',
                  background: editMode ? '#dc2626' : '#6b7280',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                {editMode ? '✕ Done Editing' : '✏️ Reorder Layers'}
              </button>
              {editMode && (
                <button
                  onClick={handleReset}
                  style={{
                    padding: '8px 16px',
                    background: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500'
                  }}
                >
                  ↺ Reset
                </button>
              )}
          </div>
        )}
      </div>
      
      {/* Edit mode instructions */}
      {editMode && plan && (
        <div style={{
          padding: '12px 16px',
          background: '#dbeafe',
          border: '1px solid #93c5fd',
          borderRadius: '8px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '1.5rem' }}>↕️</span>
          <div>
            <strong>Drag & Drop Mode</strong>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.875rem', color: '#1e40af' }}>
              Drag layers to reorder them within a pallet, or move them between pallets.
              Your changes train the system for better future predictions.
            </p>
          </div>
        </div>
      )}
      
      {plan && (
        <>
          {/* Summary */}
          <div style={{
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#0369a1' }}>
                  {plan.totalPallets}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Pallets</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#0369a1' }}>
                  {plan.totalWeight.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Total lbs</div>
              </div>
              <div>
                <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#0369a1' }}>
                  {plan.totalUnits}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Units</div>
              </div>
            </div>
          </div>
          
          {/* Color Legend */}
          <div style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px'
          }}>
            <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '0.875rem', color: '#374151' }}>
              🎨 Product Color Legend
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
              {[
                { key: 'dv215', label: 'Varsity' },
                { key: 'vr2', label: 'VR2' },
                { key: 'vr1', label: 'VR1' },
                { key: 'dd4', label: 'DD4' },
                { key: 'dd6', label: 'DD6' },
                { key: 'sm10x', label: 'SkateDock' },
                { key: 'dismount', label: 'Dismount' },
                { key: 'hr101', label: 'Hoop Runner' },
                { key: 'mbv1', label: 'MBV Locker' },
                { key: 'visi1', label: 'VISI Locker' },
                { key: 'ss120', label: 'Base Station' },
                { key: 'sik120', label: 'Strut Kit' }
              ].map(item => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: PRODUCT_COLORS[item.key] || PRODUCT_COLORS.default,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                  }} />
                  <span style={{ fontSize: '0.8rem', color: '#4b5563' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Pallet Cards */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
            gap: '16px'
          }}>
            {plan.pallets.map(pallet => (
              <div 
                key={pallet.id}
                style={{
                  background: 'white',
                  border: dragState.targetPallet === pallet.id 
                    ? '2px solid #3b82f6' 
                    : '2px solid #e5e7eb',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  transition: 'border-color 0.2s'
                }}
              >
                {/* Pallet Header */}
                <div style={{
                  background: '#f3f4f6',
                  padding: '12px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>
                      Pallet {pallet.id}: {pallet.type}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                      {pallet.dims.join('×')}" • {pallet.totalWeight} lbs
                    </div>
                  </div>
                  <div style={{
                    background: '#e0f2fe',
                    color: '#0369a1',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '0.8rem',
                    fontWeight: '600'
                  }}>
                    {pallet.layers.length} layers
                  </div>
                </div>
                
                {/* Tetris Visualization */}
                <div 
                  style={{
                    padding: '16px',
                    background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
                    minHeight: '200px',
                    display: 'flex',
                    flexDirection: 'column-reverse',
                    gap: '4px'
                  }}
                  onDragOver={handleDragOver}
                  onDragEnter={() => handleDragEnter(pallet.id, pallet.layers.length)}
                >
                  {/* Pallet base */}
                  <div style={{
                    height: '20px',
                    background: 'linear-gradient(180deg, #c4a574 0%, #a08060 100%)',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.7rem',
                    color: '#5c4a30',
                    fontWeight: '600',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}>
                    48×40" PALLET
                  </div>
                  
                  {/* Drop zone at bottom (above pallet) */}
                  {editMode && dragState.dragging && (
                    <DropZone
                      palletId={pallet.id}
                      index={0}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      isActive={dragState.targetPallet === pallet.id && dragState.targetIndex === 0}
                    />
                  )}
                  
                  {/* Layers (reversed for visual stacking) */}
                  {[...pallet.layers].reverse().map((layer, visualIdx) => {
                    const actualIdx = pallet.layers.length - 1 - visualIdx
                    return (
                      <div key={layer.id} onDragEnter={() => handleDragEnter(pallet.id, actualIdx + 1)}>
                        <DraggableLayer
                          layer={layer}
                          palletId={pallet.id}
                          index={actualIdx}
                          editMode={editMode}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          isDragOver={
                            dragState.targetPallet === pallet.id && 
                            dragState.targetIndex === actualIdx &&
                            !(dragState.sourcePallet === pallet.id && dragState.sourceIndex === actualIdx)
                          }
                        />
                        {/* Drop zone after each layer */}
                        {editMode && dragState.dragging && visualIdx < pallet.layers.length - 1 && (
                          <DropZone
                            palletId={pallet.id}
                            index={actualIdx + 1}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            isActive={dragState.targetPallet === pallet.id && dragState.targetIndex === actualIdx + 1}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                
                {/* Stacking Instructions */}
                <div style={{
                  padding: '12px 16px',
                  borderTop: '1px solid #e5e7eb',
                  background: '#fafafa'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '0.875rem' }}>
                    📋 Stacking Order (bottom → top):
                  </div>
                  <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '0.875rem', color: '#4b5563' }}>
                    {pallet.layers.map((layer, idx) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>
                        {layer.products.map(p => `${p.quantity}× ${p.name.split(',')[0]}`).join(', ')}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ))}
          </div>
          
          {/* Logged Adjustments */}
          {adjustments.length > 0 && (
            <div style={{
              marginTop: '16px',
              padding: '16px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px'
            }}>
              <strong>✅ Adjustments Made ({adjustments.length})</strong>
              <p style={{ margin: '8px 0 0 0', fontSize: '0.875rem', color: '#166534' }}>
                Your reordering changes have been logged for learning.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
