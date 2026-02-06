import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html, useGLTF, Center } from '@react-three/drei'
import { useState, useRef, useMemo, Suspense, useEffect } from 'react'
import * as THREE from 'three'
import { getProductModelKey, PRODUCT_MODELS, DD_COMPONENTS } from './productModels'

// Product family colors (fallback when no model)
const FAMILY_COLORS = {
  'Varsity': '#2563eb',
  'VR2 Offset': '#7c3aed',
  'VR1 XL': '#8b5cf6',
  'Undergrad': '#059669',
  'Skatedock': '#d97706',
  'Dismount': '#0891b2',
  'Double Docker': '#dc2626',
  'Metal Bike Vault / VisiLocker': '#4b5563',
  'Hoop Runner': '#16a34a',
  'Circle Series (Omega)': '#0d9488',
  'Saris': '#9333ea',
  'Base Station': '#64748b',
  'Strut Install Kit': '#78716c',
  'default': '#6b7280',
}

// Layer colors for visualization
const LAYER_COLORS = [
  '#2563eb', // Blue
  '#059669', // Green
  '#d97706', // Amber
  '#dc2626', // Red
  '#7c3aed', // Purple
  '#0891b2', // Cyan
  '#be185d', // Pink
  '#4b5563', // Gray
]

// Model scale factors (models are in mm, we need inches for pallet scale)
// Scale factor = targetInches / modelMM * inchToUnit
// Models from STEP files are typically in mm
// DD models have been re-exported with correct Y-up orientation
const MODEL_SCALES = {
  'dv215': { scale: 0.0393701, rotation: [0, 0, 0] },
  'vr2': { scale: 0.0393701, rotation: [0, 0, 0] },
  'hr101': { scale: 0.0393701, rotation: [0, 0, 0] },
  'cs200': { scale: 0.0393701, rotation: [0, 0, 0] },
  'sm10x': { scale: 0.0393701, rotation: [0, 0, 0] },
  'dd-slide': { scale: 0.0393701, rotation: [0, 0, 0] },
  'dd-lower': { scale: 0.0393701, rotation: [0, 0, 0] },
  'dd-leg': { scale: 0.0393701, rotation: [0, 0, 0] },
  'dd-manifold': { scale: 0.0393701, rotation: [0, 0, 0] },
  'locker-1-box-a': { scale: 0.0393701, rotation: [0, 0, 0] },
  'locker-1-box-b': { scale: 0.0393701, rotation: [0, 0, 0] },
  'locker-2-box-a': { scale: 0.0393701, rotation: [0, 0, 0] },
  'locker-2-box-b': { scale: 0.0393701, rotation: [0, 0, 0] },
  'locker-2-box-c': { scale: 0.0393701, rotation: [0, 0, 0] },
}

// Get model info for a product
function getModelForProduct(item) {
  const key = getProductModelKey(item.sku, item.family)
  if (key && PRODUCT_MODELS[key]) {
    return { ...PRODUCT_MODELS[key], key }
  }
  return null
}

// Check if product is a Double Docker that needs component breakdown
function isDDProduct(item) {
  const key = getProductModelKey(item.sku, item.family)
  return key === 'dd4' || key === 'dd6'
}

// Get DD components for an item
function getDDComponents(item) {
  const key = getProductModelKey(item.sku, item.family)
  if (key !== 'dd4' && key !== 'dd6') return []
  
  const qty = item.qty || 1
  const isDD6 = key === 'dd6'
  
  const components = []
  Object.entries(DD_COMPONENTS).forEach(([compKey, comp]) => {
    const perUnit = isDD6 ? comp.perDD6 : comp.perDD4
    const totalQty = qty * perUnit
    if (totalQty > 0) {
      components.push({
        key: compKey,
        name: comp.name,
        qty: totalQty,
        model: PRODUCT_MODELS[compKey]?.model,
        dims: comp.dims,
        weight: comp.weight,
      })
    }
  })
  
  return components
}

// GLB Model component with auto-scaling
function GLBModel({ url, position, modelKey, palletScale = 0.4, dims }) {
  const { scene } = useGLTF(url)
  const scaleConfig = MODEL_SCALES[modelKey] || { scale: 1, rotation: [0, 0, 0] }
  
  // Calculate bounding box from ORIGINAL scene (immutable, cached by useGLTF)
  // Must happen BEFORE cloning since clones can be mutated by Three.js primitive
  const originalBounds = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    
    // Diagnostic logging - explicit values for production minified builds
    console.log(`🔍 GLBModel ${modelKey}: size=[${size.x.toFixed(1)}, ${size.y.toFixed(1)}, ${size.z.toFixed(1)}] min.y=${box.min.y.toFixed(1)} max.y=${box.max.y.toFixed(1)} center.y=${center.y.toFixed(1)}`)
    
    // Store in window for easy debugging
    window.DEBUG_MODELS = window.DEBUG_MODELS || {}
    window.DEBUG_MODELS[modelKey] = { size: {x: size.x, y: size.y, z: size.z}, minY: box.min.y, maxY: box.max.y }
    
    return { box, size, center }
  }, [scene, modelKey])
  
  // Clone scene for rendering (this clone will be mutated by <primitive>)
  const clonedScene = useMemo(() => {
    const clone = scene.clone()
    // Make materials double-sided to avoid rendering issues
    clone.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.side = THREE.DoubleSide
        child.material.needsUpdate = true
      }
    })
    return clone
  }, [scene])
  
  // Calculate scale/offset using original bounds (stable across re-renders)
  const { scale, offset } = useMemo(() => {
    const { box, size, center } = originalBounds
    
    // Target size based on dims (in inches) and pallet scale
    const targetL = (dims?.l || 30) * palletScale
    const targetW = (dims?.w || 20) * palletScale
    const targetH = (dims?.h || 10) * palletScale
    
    // Find the scale factor to fit model to target dimensions
    // DD models are Y-up with: X=width, Y=height, Z=length
    // Map target dimensions to model axes correctly:
    const scaleX = size.x > 0 ? targetW / size.x : 1  // model X = width
    const scaleY = size.y > 0 ? targetH / size.y : 1  // model Y = height
    const scaleZ = size.z > 0 ? targetL / size.z : 1  // model Z = length
    
    // Scale models to FIT their target dimensions (from packing algorithm)
    // This ensures models don't overlap regardless of their native size
    let uniformScale
    const configuredScale = scaleConfig.scale
    
    // ALWAYS fit to dims - this prevents overlapping models
    // Use minimum scale to fit within bounds while maintaining aspect ratio
    uniformScale = Math.min(scaleX, scaleY, scaleZ)
    
    // Log scale calculation
    console.log(`📐 GLBModel ${modelKey}: FIT scale=${uniformScale.toFixed(6)} target=${targetL.toFixed(1)}×${targetW.toFixed(1)}×${targetH.toFixed(1)} model=${size.z.toFixed(0)}×${size.x.toFixed(0)}×${size.y.toFixed(0)}`)
    
    // Position model so bottom sits at placement Y
    // offset.y lifts the model so its bounding box min sits at y=0 locally
    const offset = {
      x: -center.x * uniformScale,
      y: -box.min.y * uniformScale,
      z: -center.z * uniformScale
    }
    
    console.log(`📐 GLBModel ${modelKey}: offset.y=${offset.y.toFixed(2)} (from min.y=${box.min.y.toFixed(1)})`)
    
    return { scale: uniformScale, offset }
  }, [originalBounds, dims, palletScale])
  
  return (
    <group position={position}>
      <primitive 
        object={clonedScene} 
        scale={scale}
        position={[offset.x, offset.y, offset.z]}
        rotation={scaleConfig.rotation}
      />
    </group>
  )
}

// Fallback box component (when no GLB model available) - NO LABELS
function FallbackBox({ position, size, color, opacity = 1 }) {
  const meshRef = useRef()
  const [hovered, setHovered] = useState(false)
  
  useFrame(() => {
    if (meshRef.current) {
      const targetScale = hovered ? 1.03 : 1
      meshRef.current.scale.lerp({ x: targetScale, y: targetScale, z: targetScale }, 0.15)
    }
  })
  
  const finalOpacity = hovered ? Math.min(1, opacity + 0.1) : opacity * 0.92
  
  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial 
          color={hovered ? '#60a5fa' : color} 
          transparent
          opacity={finalOpacity}
        />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(...size)]} />
        <lineBasicMaterial color="#000000" opacity={opacity} transparent />
      </lineSegments>
    </group>
  )
}

// Product on pallet - uses GLB if available, falls back to box - NO LABELS (moved to sidebar)
function ProductOnPallet({ item, position, scale = 0.5, overrideColor = null, opacity = 1 }) {
  const modelInfo = getModelForProduct(item)
  const baseColor = FAMILY_COLORS[item.family] || FAMILY_COLORS.default
  const color = overrideColor || baseColor
  
  // Get dimensions - prefer item's calculated dims, fall back to model/packaged
  const itemL = item.length || (modelInfo?.dims?.l) || (item.packaged?.length_in) || 30
  const itemW = item.width || (modelInfo?.dims?.w) || (item.packaged?.width_in) || 20
  const itemH = item.height || (modelInfo?.dims?.h) || (item.packaged?.height_in) || 10
  
  // Ensure minimum visible size
  const size = [
    Math.max(4, itemL * scale),  // length (X)
    Math.max(2, itemH * scale),  // height (Y)
    Math.max(4, itemW * scale)   // width (Z)
  ]
  
  if (modelInfo?.model) {
    // Use actual GLB model
    return (
      <group position={position}>
        <Suspense fallback={
          <FallbackBox position={[0, itemH * scale / 2, 0]} size={size} color={color} opacity={opacity} />
        }>
          <GLBModel 
            url={modelInfo.model} 
            position={[0, 0, 0]}
            modelKey={modelInfo.key}
            palletScale={scale}
            dims={{ l: itemL, w: itemW, h: itemH }}
          />
        </Suspense>
      </group>
    )
  }
  
  // Fallback to colored box - position[1] is BOTTOM, but boxGeometry is centered
  // So shift up by half height
  const adjustedPosition = [
    position[0],
    position[1] + (itemH * scale / 2),
    position[2]
  ]
  return <FallbackBox position={adjustedPosition} size={size} color={color} opacity={opacity} />
}

// DD Slide - Long flat channel/rail shape
function DDSlide({ position, dims, scale, opacity = 1 }) {
  const l = dims.l * scale
  const w = dims.w * scale
  const h = dims.h * scale
  const wallThickness = 0.5 * scale
  const [hovered, setHovered] = useState(false)
  
  // Create a U-channel shape (slide tray)
  return (
    <group position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Bottom plate */}
      <mesh position={[0, -h/2 + wallThickness/2, 0]}>
        <boxGeometry args={[l, wallThickness, w]} />
        <meshStandardMaterial color={hovered ? '#ef4444' : '#b91c1c'} transparent opacity={opacity} />
      </mesh>
      {/* Left rail */}
      <mesh position={[0, 0, -w/2 + wallThickness/2]}>
        <boxGeometry args={[l, h, wallThickness]} />
        <meshStandardMaterial color={hovered ? '#ef4444' : '#dc2626'} transparent opacity={opacity} />
      </mesh>
      {/* Right rail */}
      <mesh position={[0, 0, w/2 - wallThickness/2]}>
        <boxGeometry args={[l, h, wallThickness]} />
        <meshStandardMaterial color={hovered ? '#ef4444' : '#dc2626'} transparent opacity={opacity} />
      </mesh>
      {/* Edges */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(l, h, w)]} />
        <lineBasicMaterial color="#7f1d1d" transparent opacity={opacity} />
      </lineSegments>
    </group>
  )
}

// DD Track - Long tube/rail shape (lower track)
function DDTrack({ position, dims, scale, opacity = 1 }) {
  const l = dims.l * scale
  const w = dims.w * scale
  const h = dims.h * scale
  const [hovered, setHovered] = useState(false)
  
  // Create a rounded rail/tube shape
  return (
    <group position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Main tube - horizontal cylinder */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[h/2, h/2, l, 8]} />
        <meshStandardMaterial color={hovered ? '#fbbf24' : '#f59e0b'} transparent opacity={opacity} />
      </mesh>
      {/* End caps */}
      <mesh position={[l/2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <circleGeometry args={[h/2, 8]} />
        <meshStandardMaterial color={hovered ? '#fcd34d' : '#fbbf24'} side={THREE.DoubleSide} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-l/2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <circleGeometry args={[h/2, 8]} />
        <meshStandardMaterial color={hovered ? '#fcd34d' : '#fbbf24'} side={THREE.DoubleSide} transparent opacity={opacity} />
      </mesh>
    </group>
  )
}

// DD Leg - Vertical support post
function DDLeg({ position, dims, scale, opacity = 1 }) {
  const l = dims.l * scale
  const w = dims.w * scale
  const h = dims.h * scale
  const [hovered, setHovered] = useState(false)
  
  // Create an L-shaped support leg
  const legThickness = 2 * scale
  return (
    <group position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {/* Vertical post */}
      <mesh position={[0, 0, -w/4]}>
        <boxGeometry args={[legThickness, h * 1.5, legThickness]} />
        <meshStandardMaterial color={hovered ? '#a3a3a3' : '#737373'} transparent opacity={opacity} />
      </mesh>
      {/* Horizontal base */}
      <mesh position={[0, -h/2, 0]}>
        <boxGeometry args={[l, legThickness, w]} />
        <meshStandardMaterial color={hovered ? '#a3a3a3' : '#525252'} transparent opacity={opacity} />
      </mesh>
      {/* Gusset/brace */}
      <mesh position={[0, 0, w/8]} rotation={[Math.PI/6, 0, 0]}>
        <boxGeometry args={[legThickness, h * 0.8, legThickness/2]} />
        <meshStandardMaterial color={hovered ? '#a3a3a3' : '#404040'} transparent opacity={opacity} />
      </mesh>
    </group>
  )
}

// DD Manifold - Connector box
function DDManifold({ position, dims, scale, opacity = 1 }) {
  const l = dims.l * scale
  const w = dims.w * scale
  const h = dims.h * scale
  const [hovered, setHovered] = useState(false)
  
  // Connector piece - box with holes/ports
  return (
    <group position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <mesh>
        <boxGeometry args={[l, h, w]} />
        <meshStandardMaterial color={hovered ? '#60a5fa' : '#3b82f6'} transparent opacity={opacity} />
      </mesh>
      {/* Port holes on ends */}
      <mesh position={[l/2 - 0.5, 0, 0]}>
        <cylinderGeometry args={[h/4, h/4, 1, 8]} />
        <meshStandardMaterial color="#1e40af" transparent opacity={opacity} />
      </mesh>
      <mesh position={[-l/2 + 0.5, 0, 0]}>
        <cylinderGeometry args={[h/4, h/4, 1, 8]} />
        <meshStandardMaterial color="#1e40af" transparent opacity={opacity} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(l, h, w)]} />
        <lineBasicMaterial color="#1e3a8a" transparent opacity={opacity} />
      </lineSegments>
    </group>
  )
}

// DD Component on pallet - loads GLB models for accurate rendering
function DDComponentOnPallet({ component, position, scale = 0.4, overrideColor = null, opacity = 1 }) {
  const dims = component.dims || { l: 80, w: 16, h: 6 }
  const key = (component.key || '').toLowerCase()
  
  // Map component keys to their GLB model paths
  const MODEL_PATHS = {
    'dd-slide': '/models/dd-slide-assembly.glb',
    'dd-lower': '/models/dd-lower-track.glb',
    'dd-leg': '/models/dd-support-leg.glb',
    'dd-manifold': '/models/dd-manifold.glb',
  }
  
  // Find matching model path
  let modelPath = null
  let modelKey = key
  if (key.includes('slide')) { modelPath = MODEL_PATHS['dd-slide']; modelKey = 'dd-slide' }
  else if (key.includes('lower') || key.includes('track')) { modelPath = MODEL_PATHS['dd-lower']; modelKey = 'dd-lower' }
  else if (key.includes('leg')) { modelPath = MODEL_PATHS['dd-leg']; modelKey = 'dd-leg' }
  else if (key.includes('manifold')) { modelPath = MODEL_PATHS['dd-manifold']; modelKey = 'dd-manifold' }
  
  console.log(`🎨 DDComponent key="${key}" → modelPath=${modelPath} modelKey=${modelKey} posY=${position[1].toFixed(2)}`)
  
  // Get color for fallback
  const DD_COLORS = {
    'slide': '#dc2626',
    'lower': '#f59e0b',
    'track': '#f59e0b', 
    'leg': '#737373',
    'manifold': '#3b82f6',
  }
  let color = overrideColor || '#dc2626'
  for (const [pattern, c] of Object.entries(DD_COLORS)) {
    if (key.includes(pattern)) { color = c; break }
  }
  
  const size = [dims.l * scale, dims.h * scale, dims.w * scale]
  
  if (modelPath) {
    // Fallback box position: centered geometry needs Y offset of half height
    const fallbackPos = [0, size[1] / 2, 0]
    return (
      <group position={position}>
        <Suspense fallback={<FallbackBox position={fallbackPos} size={size} color={color} opacity={opacity} />}>
          <GLBModel 
            url={modelPath}
            position={[0, 0, 0]}
            modelKey={modelKey}
            palletScale={scale}
            dims={dims}
          />
        </Suspense>
      </group>
    )
  }
  
  // Fallback to colored box for unknown components
  // FallbackBox uses centered boxGeometry, so shift up by half height
  // since position[1] is the BOTTOM of the item
  const adjustedPosition = [
    position[0],
    position[1] + (dims.h * scale / 2),
    position[2]
  ]
  return <FallbackBox position={adjustedPosition} size={size} color={color} opacity={opacity} />
}

// Pallet base - standard 48" x 40" pallet
function PalletBase({ width = 24, depth = 20, scale = 0.5 }) {
  // Standard pallet is 48" x 40" x 6" tall
  const palletHeight = 3 * scale
  const deckThickness = 0.75 * scale
  const stringerHeight = 3.5 * scale
  const stringerWidth = 1.5 * scale
  
  return (
    <group position={[0, 0, 0]}>
      {/* Top deck boards */}
      <mesh position={[0, palletHeight - deckThickness / 2, 0]}>
        <boxGeometry args={[width, deckThickness, depth]} />
        <meshStandardMaterial color="#c4a574" />
      </mesh>
      
      {/* Bottom deck boards */}
      <mesh position={[0, deckThickness / 2, 0]}>
        <boxGeometry args={[width, deckThickness, depth]} />
        <meshStandardMaterial color="#b89a64" />
      </mesh>
      
      {/* Stringers (the 3 support beams) */}
      {[-1, 0, 1].map((i) => (
        <mesh key={`stringer-${i}`} position={[i * (width / 3), palletHeight / 2, 0]}>
          <boxGeometry args={[stringerWidth, stringerHeight, depth]} />
          <meshStandardMaterial color="#a08060" />
        </mesh>
      ))}
    </group>
  )
}

// Check if item is a DD component (dd-slide, dd-lower, dd-leg, dd-manifold)
function isDDComponent(item) {
  const sku = String(item?.sku || '').toLowerCase()
  return sku.startsWith('dd-') && !sku.includes('dd-ss') && !sku.includes('dd-ds')
}

// Animated item wrapper - smoothly transitions position
function AnimatedItem({ children, targetPosition }) {
  const groupRef = useRef()
  
  useFrame(() => {
    if (groupRef.current) {
      // Smoothly interpolate to target position
      groupRef.current.position.x += (targetPosition[0] - groupRef.current.position.x) * 0.1
      groupRef.current.position.y += (targetPosition[1] - groupRef.current.position.y) * 0.1
      groupRef.current.position.z += (targetPosition[2] - groupRef.current.position.z) * 0.1
    }
  })
  
  return (
    <group ref={groupRef} position={targetPosition}>
      {children}
    </group>
  )
}

// Main 3D pallet scene
function PalletScene({ pallet, exploded, showComponents, activeLayer = 'all', showLayerColors = false, layerColors = [], showLabels = false }) {
  const scale = 0.5 // Increased scale for better visibility
  
  const products = useMemo(() => {
    const result = []
    
    // NEW: Use exact positions from 3D bin-packing if available
    if (pallet.boxes && pallet.boxes.length > 0) {
      // DEBUG: Show first few boxes in alert for debugging
      const debugInfo = pallet.boxes.slice(0, 15).map((b, i) => 
        `${i}: ${b.item?.sku || '?'} y=${b.y}`
      ).join('\n')
      console.log('🎯 DEBUG BOX POSITIONS:\n' + debugInfo)
      console.log('🎯 Using exact 3D positions for pallet', pallet.id, 'boxes:', pallet.boxes.map(b => ({ y: b.y, h: b.h })))
      
      // Calculate center for explode effect
      const palletL = (pallet.dims?.[0] || 48) * scale
      const palletW = (pallet.dims?.[1] || 40) * scale
      
      pallet.boxes.forEach((box, idx) => {
        const item = box.item || {}
        const isDD = isDDComponent(item)
        
        // Convert from bin-packing coords (inches, origin at corner)
        // to Three.js coords (centered X/Z, bottom Y)
        const x = (box.x + box.l / 2) * scale - palletL / 2
        const y = box.y * scale + 3 * scale // BOTTOM of box, +3 for pallet base height
        const z = (box.z + box.w / 2) * scale - palletW / 2
        console.log(`Box ${idx}: ${item.sku || item.name || 'unknown'} input y=${box.y}, output y=${y.toFixed(2)}`)
        
        // Explode effect: items spread outward AND upward based on position
        // Higher items move up more, items spread from center
        let explodeX = 0, explodeY = 0, explodeZ = 0
        if (exploded) {
          // Vertical spread based on height layer
          const layer = Math.floor(box.y / 12) // Approximate layer number
          explodeY = (layer + 1) * 8 + idx * 0.5 // Each layer spreads more
          
          // Horizontal spread from center
          explodeX = x * 0.3 // Spread outward from center
          explodeZ = z * 0.3
        }
        
        if (isDD) {
          const compKey = String(item.sku || '').toLowerCase()
          const modelInfo = PRODUCT_MODELS[compKey]
          const compInfo = DD_COMPONENTS[compKey] || {}
          
          // DEBUG: Log each DD component position
          console.log(`🎯 DD item ${idx}: sku=${item.sku} inputY=${box.y} outputY=${y.toFixed(2)}`)
          
          result.push({
            type: 'dd-component',
            component: {
              ...compInfo,
              ...modelInfo,
              key: compKey,
              name: item.name || modelInfo?.name || compKey,
              dims: { l: box.l, w: box.w, h: box.h },
              debugY: box.y, // Store original Y for debug display
            },
            position: [x + explodeX, y + explodeY, z + explodeZ],
            basePosition: [x, y, z],
          })
        } else {
          result.push({
            type: 'product',
            item: {
              ...item,
              qty: 1,
              length: box.l,
              width: box.w,
              height: box.h,
            },
            position: [x + explodeX, y + explodeY, z + explodeZ],
            basePosition: [x, y, z],
          })
        }
      })
      
      console.log('✅ NEW PATH: Returned', result.length, 'items from pallet.boxes')
      return result
    }
    
    console.log('⚠️ LEGACY PATH: pallet.boxes not found, using items fallback')
    // LEGACY: Build positions from items (for pallets without exact positions)
    const EXPLODE_SPACING = 10 // Vertical spacing when exploded
    let currentHeight = 3 // Start above pallet base
    
    pallet.items.forEach((item, itemIdx) => {
      const qty = item.qty || 1
      
      // Check if this is a DD component item (like 20x dd-slide)
      if (isDDComponent(item)) {
        // Get component info - PRODUCT_MODELS has the GLB model paths
        const compKey = String(item.sku || '').toLowerCase()
        const modelInfo = PRODUCT_MODELS[compKey] // Has model path
        const compInfo = DD_COMPONENTS[compKey] || {} // Has packing info
        const dims = modelInfo?.dims || compInfo?.dims || item.dims || { l: 80, w: 16, h: 6 }
        const unitH = (dims.h || 6) * scale
        const unitL = (dims.l || 80) * scale
        const unitW = (dims.w || 16) * scale
        
        // Calculate grid arrangement on pallet
        const palletL = (pallet.dims?.[0] || 80) * scale
        const palletW = (pallet.dims?.[1] || 40) * scale
        const itemsPerRow = Math.max(1, Math.floor(palletL / (unitL + 0.5)))
        const itemsPerCol = Math.max(1, Math.floor(palletW / (unitW + 0.5)))
        const itemsPerLayer = itemsPerRow * itemsPerCol
        
        // Place items in grid layers - show enough to represent the full pallet
        // For long items like slides, show realistic stacking
        const maxItems = Math.min(qty, Math.max(20, itemsPerLayer * 3)) // Show at least 3 layers
        for (let i = 0; i < maxItems; i++) {
          const layer = Math.floor(i / itemsPerLayer)
          const posInLayer = i % itemsPerLayer
          const row = Math.floor(posInLayer / itemsPerRow)
          const col = posInLayer % itemsPerRow
          
          const startX = -palletL / 2 + unitL / 2 + 0.5
          const startZ = -palletW / 2 + unitW / 2 + 0.5
          const x = startX + col * (unitL + 0.5)
          const z = startZ + row * (unitW + 0.5)
          const y = currentHeight + unitH / 2 + layer * (unitH + 0.3)
          
          // Explode: spread vertically and horizontally
          const explodeY = exploded ? (layer + 1) * EXPLODE_SPACING : 0
          const explodeX = exploded ? x * 0.2 : 0
          const explodeZ = exploded ? z * 0.2 : 0
          
          result.push({
            type: 'dd-component',
            component: {
              ...compInfo,
              ...modelInfo, // Include model path from PRODUCT_MODELS
              key: compKey,
              name: item.displayName || modelInfo?.name || compInfo?.name || item.sku,
              qty: 1,
              dims,
            },
            position: [x + explodeX, y + explodeY, z + explodeZ],
          })
        }
        
        // Update height for next item type
        const layersUsed = Math.ceil(Math.min(qty, maxItems) / itemsPerLayer)
        currentHeight += layersUsed * (unitH + 0.3)
      }
      // Check if this is a DD product that should show components
      else if (showComponents && isDDProduct(item)) {
        const components = getDDComponents(item)
        components.forEach((comp, compIdx) => {
          const dims = comp.dims || { l: 80, w: 16, h: 6 }
          const unitH = dims.h * scale
          
          // Explode: spread components vertically
          const explodeY = exploded ? (compIdx + 1) * EXPLODE_SPACING : 0
          
          result.push({
            type: 'dd-component',
            component: comp,
            position: [0, currentHeight + unitH / 2 + explodeY, 0],
          })
          
          currentHeight += unitH + 0.5
        })
      } else {
        // Regular product - arrange in grid on pallet, then stack
        const modelInfo = getModelForProduct(item)
        const dims = modelInfo?.dims || item.packaged || item.accurateDims || { l: 30, w: 20, h: 10 }
        // Ensure minimum visible dimensions
        const itemL = Math.max(8, dims.l || dims.length_in || item.length || 30)
        const itemW = Math.max(8, dims.w || dims.width_in || item.width || 20)
        const itemH = Math.max(4, dims.h || dims.height_in || item.height || 10)
        const unitH = itemH * scale
        const unitL = itemL * scale
        const unitW = itemW * scale
        
        // Calculate how many fit per row (X) and per column (Z) on pallet
        const palletL = (pallet.dims?.[0] || 48) * scale
        const palletW = (pallet.dims?.[1] || 40) * scale
        const itemsPerRow = Math.max(1, Math.floor(palletL / (unitL + 1)))
        const itemsPerCol = Math.max(1, Math.floor(palletW / (unitW + 1)))
        const itemsPerLayer = itemsPerRow * itemsPerCol
        
        // Place items in grid layers - show realistic packing
        const maxItems = Math.min(qty, Math.max(15, itemsPerLayer * 3)) // Show at least 3 layers
        for (let i = 0; i < maxItems; i++) {
          const layer = Math.floor(i / itemsPerLayer)
          const posInLayer = i % itemsPerLayer
          const row = Math.floor(posInLayer / itemsPerRow)
          const col = posInLayer % itemsPerRow
          
          // Calculate position within pallet footprint
          const startX = -palletL / 2 + unitL / 2 + 1
          const startZ = -palletW / 2 + unitW / 2 + 1
          const x = startX + col * (unitL + 1)
          const z = startZ + row * (unitW + 1)
          const y = currentHeight + unitH / 2 + layer * (unitH + 0.5)
          
          // Explode: spread vertically and horizontally
          const explodeY = exploded ? (layer + 1) * EXPLODE_SPACING : 0
          const explodeX = exploded ? x * 0.2 : 0
          const explodeZ = exploded ? z * 0.2 : 0
          
          result.push({
            type: 'product',
            item: { 
              ...item, 
              qty: 1,
              length: itemL,
              width: itemW,
              height: itemH,
            },
            position: [x + explodeX, y + explodeY, z + explodeZ],
            layer: layer + 1, // 1-indexed layer number
          })
        }
        
        // Update height for next item type
        const layersUsed = Math.ceil(Math.min(qty, maxItems) / itemsPerLayer)
        currentHeight += layersUsed * (unitH + 0.5)
      }
    })
    
    return result
  }, [pallet, exploded, showComponents])
  
  // Filter products by active layer
  const filteredProducts = useMemo(() => {
    if (activeLayer === 'all') return products
    return products.filter(p => p.layer === activeLayer)
  }, [products, activeLayer])
  
  // Get max layer number
  const maxLayer = useMemo(() => {
    return Math.max(1, ...products.map(p => p.layer || 1))
  }, [products])
  
  // Calculate unique products for labels (group by SKU/family)
  const uniqueLabels = useMemo(() => {
    if (!showLabels) return []
    
    const labelMap = new Map()
    const productPositions = new Map() // Track positions per product type
    
    filteredProducts.forEach(p => {
      if (p.type === 'product') {
        const key = p.item?.sku || p.item?.family || 'unknown'
        const shortName = p.item?.family?.split(' ')[0] || p.item?.displayName?.split(' ')[0] || key.split('-')[0]
        
        if (!labelMap.has(key)) {
          labelMap.set(key, { qty: 0, name: shortName, positions: [] })
        }
        const entry = labelMap.get(key)
        entry.qty += 1
        entry.positions.push(p.position)
      } else if (p.type === 'dd-component') {
        const key = p.component?.key || 'dd-component'
        const shortName = p.component?.name?.split(' ').slice(-1)[0] || key.replace('dd-', '')
        
        if (!labelMap.has(key)) {
          labelMap.set(key, { qty: 0, name: shortName, positions: [] })
        }
        const entry = labelMap.get(key)
        entry.qty += 1
        entry.positions.push(p.position)
      }
    })
    
    // Calculate average position for each unique product, add vertical offset
    const labels = []
    labelMap.forEach((data, key) => {
      if (data.positions.length === 0) return
      
      // Find center and top position
      let sumX = 0, maxY = 0, sumZ = 0
      data.positions.forEach(pos => {
        sumX += pos[0]
        maxY = Math.max(maxY, pos[1])
        sumZ += pos[2]
      })
      
      const avgX = sumX / data.positions.length
      const avgZ = sumZ / data.positions.length
      
      // Add stagger offset to prevent overlap
      const staggerOffset = (labels.length % 3) * 2
      
      labels.push({
        key,
        text: `${data.qty}× ${data.name}`,
        position: [avgX, maxY + 4 + staggerOffset, avgZ]
      })
    })
    
    return labels.slice(0, 20) // Max 20 labels for performance
  }, [filteredProducts, showLabels])
  
  const palletDims = pallet.dims || [48, 40]
  const palletWidth = palletDims[0] * scale
  const palletDepth = palletDims[1] * scale
  
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 20, 10]} intensity={0.8} />
      <directionalLight position={[-10, 10, -10]} intensity={0.4} />
      
      <PalletBase width={palletWidth} depth={palletDepth} scale={scale} />
      
      {/* Dimension labels */}
      {/* Length label (X axis) */}
      <Html position={[0, -1, palletDepth / 2 + 3]} center>
        <div style={{
          background: 'rgba(37, 99, 235, 0.9)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '3px',
          fontSize: '11px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
        }}>
          {palletDims[0]}"
        </div>
      </Html>
      
      {/* Width label (Z axis) */}
      <Html position={[palletWidth / 2 + 3, -1, 0]} center>
        <div style={{
          background: 'rgba(37, 99, 235, 0.9)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '3px',
          fontSize: '11px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
        }}>
          {palletDims[1]}"
        </div>
      </Html>
      
      {/* Height label (Y axis) - shows stack height */}
      <Html position={[-palletWidth / 2 - 3, (palletDims[2] || 48) * scale / 2, 0]} center>
        <div style={{
          background: 'rgba(220, 38, 38, 0.9)',
          color: 'white',
          padding: '2px 6px',
          borderRadius: '3px',
          fontSize: '11px',
          fontWeight: '600',
          whiteSpace: 'nowrap',
        }}>
          {palletDims[2] || 48}"
        </div>
      </Html>
      
      {filteredProducts.map((p, idx) => {
        // Determine if this item should be dimmed (when filtering by layer)
        const isDimmed = activeLayer !== 'all' && p.layer !== activeLayer
        const layerColor = showLayerColors && p.layer ? layerColors[(p.layer - 1) % layerColors.length] : null
        
        // DIRECT POSITIONING - bypass AnimatedItem for DD components
        if (p.type === 'dd-component') {
          return (
            <group key={`item-${idx}`} position={p.position}>
              <DDComponentOnPallet 
                component={p.component}
                position={[0, 0, 0]}
                scale={scale}
                overrideColor={layerColor}
                opacity={isDimmed ? 0.3 : 1}
              />
            </group>
          )
        }
        
        return (
          <AnimatedItem key={`item-${idx}`} targetPosition={p.position}>
            <ProductOnPallet 
              item={p.item} 
              position={[0, 0, 0]}
              scale={scale}
              overrideColor={layerColor}
              opacity={isDimmed ? 0.3 : 1}
            />
          </AnimatedItem>
        )
      })}
      
      {/* Floating product labels */}
      {showLabels && uniqueLabels.map((label, idx) => (
        <Html
          key={`label-${label.key}`}
          position={label.position}
          center
          distanceFactor={60}
          occlude={false}
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(0, 0, 0, 0.85)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: '600',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
            transform: 'translateY(-50%)',
          }}>
            {label.text}
          </div>
        </Html>
      ))}
      
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#e5e7eb" />
      </mesh>
    </>
  )
}

// Exported component
export default function PalletViewer3D({ pallet }) {
  const [exploded, setExploded] = useState(false)
  const [showComponents, setShowComponents] = useState(true)
  const [activeLayer, setActiveLayer] = useState('all') // 'all' or layer number
  const [showLayerColors, setShowLayerColors] = useState(false)
  const [showLabels, setShowLabels] = useState(false) // Toggle 3D product labels
  
  // Check if pallet has DD products
  const hasDD = useMemo(() => {
    return pallet?.items?.some(item => isDDProduct(item)) || false
  }, [pallet])
  
  // Calculate layers from box positions
  const layers = useMemo(() => {
    if (!pallet?.boxes || pallet.boxes.length === 0) {
      // Fallback: estimate layers from items
      if (!pallet?.items) return [{ level: 1, items: [] }]
      return [{ level: 1, items: pallet.items }]
    }
    
    // Group boxes by Y position (rounded to nearest inch for tolerance)
    const layerMap = new Map()
    pallet.boxes.forEach(box => {
      const yLevel = Math.round(box.y) // Round to group nearby items
      if (!layerMap.has(yLevel)) {
        layerMap.set(yLevel, [])
      }
      layerMap.get(yLevel).push(box)
    })
    
    // Sort by Y and create numbered layers
    const sortedYs = [...layerMap.keys()].sort((a, b) => a - b)
    return sortedYs.map((y, idx) => ({
      level: idx + 1,
      y,
      boxes: layerMap.get(y),
      height: y,
    }))
  }, [pallet])
  
  const getLayerColor = (layerNum) => {
    return LAYER_COLORS[(layerNum - 1) % LAYER_COLORS.length]
  }
  
  // Component colors matching the 3D shapes
  const DD_COMPONENT_COLORS = {
    'slide': '#dc2626',    // Red for slides
    'lower': '#f59e0b',    // Amber for tracks
    'track': '#f59e0b',    // Amber for tracks
    'leg': '#737373',      // Gray for legs
    'manifold': '#3b82f6', // Blue for manifolds
  }
  
  // Get color for DD component
  const getComponentColor = (compKey) => {
    const key = (compKey || '').toLowerCase()
    for (const [pattern, color] of Object.entries(DD_COMPONENT_COLORS)) {
      if (key.includes(pattern)) return color
    }
    return '#dc2626' // Default DD red
  }
  
  // Build contents list for legend
  const contentsList = useMemo(() => {
    if (!pallet?.items) return []
    
    const items = []
    pallet.items.forEach(item => {
      // Check if this is already a DD component (from the new palletization)
      if (isDDComponent(item)) {
        const compKey = String(item.sku || '').toLowerCase()
        items.push({
          qty: item.qty,
          name: item.name || compKey.replace('dd-', '').replace('-', ' '),
          color: getComponentColor(compKey)
        })
      } else if (showComponents && isDDProduct(item)) {
        const components = getDDComponents(item)
        components.forEach(comp => {
          items.push({
            qty: comp.qty,
            name: comp.name,
            color: getComponentColor(comp.key)
          })
        })
      } else {
        const color = FAMILY_COLORS[item.family] || FAMILY_COLORS.default
        items.push({
          qty: item.qty,
          name: item.family?.split(' ')[0] || item.sku || 'Item',
          color
        })
      }
    })
    return items
  }, [pallet, showComponents])
  
  if (!pallet) return null
  
  return (
    <div style={{ position: 'relative', background: '#f3f4f6', borderRadius: '8px', overflow: 'hidden' }}>
      {/* 3D Canvas Area */}
      <div style={{ position: 'relative', height: '350px' }}>
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: 10,
          display: 'flex',
          gap: '8px'
        }}>
          <button
            onClick={() => setExploded(!exploded)}
            style={{
              padding: '8px 16px',
              background: exploded ? '#dc2626' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
            }}
          >
            {exploded ? '📦 Collapse' : '💥 Explode'}
          </button>
          
          {hasDD && (
            <button
              onClick={() => setShowComponents(!showComponents)}
              style={{
                padding: '8px 16px',
                background: showComponents ? '#059669' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '0.875rem',
              }}
            >
              {showComponents ? '🔧 Components' : '📦 Assembled'}
            </button>
          )}
          
          <button
            onClick={() => setShowLayerColors(!showLayerColors)}
            style={{
              padding: '8px 16px',
              background: showLayerColors ? '#7c3aed' : '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
            }}
          >
            {showLayerColors ? '🎨 Layers' : '🎨 Layers'}
          </button>
          
          <button
            onClick={() => setShowLabels(!showLabels)}
            style={{
              padding: '8px 16px',
              background: showLabels ? '#0891b2' : '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: '600',
              fontSize: '0.875rem',
            }}
          >
            {showLabels ? '🏷️ Labels' : '🏷️ Labels'}
          </button>
        </div>
        
        {/* Layer selector - shows when layer colors are on */}
        {showLayerColors && layers.length > 1 && (
          <div style={{
            position: 'absolute',
            top: '52px',
            left: '12px',
            zIndex: 10,
            display: 'flex',
            gap: '4px',
            background: 'rgba(255,255,255,0.95)',
            padding: '8px',
            borderRadius: '6px',
          }}>
            <button
              onClick={() => setActiveLayer('all')}
              style={{
                padding: '4px 10px',
                background: activeLayer === 'all' ? '#1f2937' : '#e5e7eb',
                color: activeLayer === 'all' ? 'white' : '#374151',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '500',
                fontSize: '0.75rem',
              }}
            >
              All
            </button>
            {layers.map((layer) => (
              <button
                key={layer.level}
                onClick={() => setActiveLayer(layer.level)}
                style={{
                  padding: '4px 10px',
                  background: activeLayer === layer.level 
                    ? getLayerColor(layer.level) 
                    : '#e5e7eb',
                  color: activeLayer === layer.level ? 'white' : '#374151',
                  border: activeLayer !== layer.level ? `2px solid ${getLayerColor(layer.level)}` : 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: '500',
                  fontSize: '0.75rem',
                }}
              >
                L{layer.level}
              </button>
            ))}
          </div>
        )}
        
        <div style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          zIndex: 10,
          fontSize: '0.75rem',
          color: '#6b7280',
          background: 'rgba(255,255,255,0.9)',
          padding: '6px 10px',
          borderRadius: '4px'
        }}>
          {/* Touch-aware hint */}
          {'ontouchstart' in window ? (
            <>👆 Drag to rotate • Pinch to zoom</>
          ) : (
            <>🖱️ Drag to rotate • Scroll to zoom</>
          )}
        </div>
        
        <div style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          zIndex: 10,
          background: 'rgba(255,255,255,0.95)',
          padding: '12px',
          borderRadius: '6px',
          fontSize: '0.875rem'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>Pallet {pallet.id}</div>
          <div style={{ color: '#6b7280' }}>{pallet.dims?.[0] || 48}×{pallet.dims?.[1] || 40}×{pallet.dims?.[2] || 48}"</div>
          <div style={{ color: '#6b7280' }}>{pallet.weight?.toLocaleString()} lbs</div>
        </div>
        
        <Canvas
          camera={{ position: [50, 40, 50], fov: 50 }}
          style={{ background: '#f3f4f6' }}
        >
          <Suspense fallback={
            <Html center>
              <div style={{ 
                background: 'rgba(255,255,255,0.9)', 
                padding: '12px 20px', 
                borderRadius: '8px',
                fontSize: '14px',
                color: '#6b7280'
              }}>
                Loading 3D models...
              </div>
            </Html>
          }>
            <PalletScene 
              pallet={pallet} 
              exploded={exploded} 
              showComponents={showComponents}
              activeLayer={activeLayer}
              showLayerColors={showLayerColors}
              layerColors={LAYER_COLORS}
              showLabels={showLabels}
            />
          </Suspense>
          <OrbitControls 
            enablePan={true}
            enableZoom={true}
            enableRotate={true}
            minDistance={20}
            maxDistance={120}
            // Touch-friendly settings
            touches={{
              ONE: THREE.TOUCH.ROTATE,
              TWO: THREE.TOUCH.DOLLY_PAN
            }}
            rotateSpeed={0.8}
            zoomSpeed={1.2}
            panSpeed={0.8}
          />
        </Canvas>
      </div>
      
      {/* Contents Legend - Below the 3D view */}
      <div style={{
        background: 'white',
        padding: '12px 16px',
        borderTop: '1px solid #e5e7eb',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
        alignItems: 'center'
      }}>
        <span style={{ fontWeight: '600', fontSize: '0.875rem', color: '#374151' }}>Contents:</span>
        {contentsList.map((item, idx) => (
          <div key={idx} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.875rem',
            color: '#1f2937',
          }}>
            <span style={{
              width: '12px',
              height: '12px',
              borderRadius: '2px',
              backgroundColor: item.color,
              display: 'inline-block',
              flexShrink: 0
            }} />
            <span>{item.qty}× {item.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Preload all available models for faster loading
// Core products
useGLTF.preload('/models/varsity-double-pack.glb')
useGLTF.preload('/models/vr2-two-pack.glb')
useGLTF.preload('/models/hr101-unboxed.glb')
useGLTF.preload('/models/cs200.glb')
useGLTF.preload('/models/skatedock-box.glb')

// DD components
useGLTF.preload('/models/dd-slide-assembly.glb')
useGLTF.preload('/models/dd-lower-track.glb')
useGLTF.preload('/models/dd-support-leg.glb')
useGLTF.preload('/models/dd-manifold.glb')
