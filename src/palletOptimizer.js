/**
 * PalletOptimizer - Multi-Strategy 3D Bin Packing
 * 
 * Orchestrates multiple packing strategies and selects the best result.
 * Uses layer-based packing for optimal "tetris" style arrangements.
 * 
 * Usage:
 *   const result = optimizePalletPacking(items, palletConfig)
 *   // result.pallets = array of packed pallets
 *   // result.metrics = { palletCount, utilization, strategy }
 */

import { LayerPacker, groupItemsByHeight, sortItemsForPacking } from './layerPacker.js'

// Default pallet configuration
const DEFAULT_PALLET_CONFIG = {
  length: 86,      // inches (can accommodate 48" standard + overhang)
  width: 40,       // inches (standard pallet width)
  maxHeight: 72,   // inches (typical truck height limit)
  maxWeight: 2500, // lbs
  deckHeight: 6,   // inches (pallet deck thickness)
}

/**
 * Main entry point - pack items optimally across pallets
 */
export function optimizePalletPacking(items, config = {}) {
  const palletConfig = { ...DEFAULT_PALLET_CONFIG, ...config }
  
  // Expand items with quantities into individual units
  const expandedItems = expandItems(items)
  
  if (expandedItems.length === 0) {
    return {
      pallets: [],
      metrics: { palletCount: 0, utilization: 0, totalWeight: 0 },
      strategy: 'none'
    }
  }

  // Try multiple strategies
  const strategies = [
    { name: 'layer-area', sort: 'area-desc', layerTolerance: 1.0 },
    { name: 'layer-area-tight', sort: 'area-desc', layerTolerance: 0.5 },
    { name: 'layer-area-loose', sort: 'area-desc', layerTolerance: 2.0 },
    { name: 'layer-volume', sort: 'volume-desc', layerTolerance: 1.0 },
    { name: 'layer-height', sort: 'height-desc', layerTolerance: 1.0 },
    { name: 'layer-weight', sort: 'weight-desc', layerTolerance: 1.0 },
  ]

  let bestResult = null
  let bestScore = Infinity

  for (const strategy of strategies) {
    try {
      const result = packWithStrategy(expandedItems, palletConfig, strategy)
      const score = scoreResult(result)

      console.log(`📦 Strategy "${strategy.name}": ${result.pallets.length} pallets, ` +
                  `${(result.metrics.avgUtilization * 100).toFixed(1)}% util, score=${score.toFixed(0)}`)

      if (score < bestScore) {
        bestScore = score
        bestResult = result
      }
    } catch (err) {
      console.warn(`Strategy "${strategy.name}" failed:`, err.message)
    }
  }

  if (!bestResult) {
    // Fallback to simple greedy if all strategies fail
    console.warn('All strategies failed, using fallback greedy packing')
    bestResult = packGreedy(expandedItems, palletConfig)
  }

  console.log(`✅ Best strategy: "${bestResult.strategy}" with ${bestResult.pallets.length} pallets`)

  return bestResult
}

/**
 * Pack items using a specific strategy
 */
function packWithStrategy(items, palletConfig, strategy) {
  const { length: palletL, width: palletW, maxHeight, maxWeight, deckHeight } = palletConfig
  const usableHeight = maxHeight - deckHeight

  // Sort items according to strategy
  const sortedItems = sortItemsForPacking(items, strategy.sort)

  // Group by height for layer-based packing
  const heightGroups = groupItemsByHeight(sortedItems, strategy.layerTolerance)

  // Reorder groups: heaviest average weight first (they go on bottom)
  heightGroups.sort((a, b) => {
    const avgWeightA = a.items.reduce((s, i) => s + (i.weight || 0), 0) / a.items.length
    const avgWeightB = b.items.reduce((s, i) => s + (i.weight || 0), 0) / b.items.length
    return avgWeightB - avgWeightA
  })

  const pallets = []
  let remainingItems = []

  // Flatten groups back to items but maintain order
  for (const group of heightGroups) {
    remainingItems.push(...group.items.map(item => ({
      ...item,
      groupHeight: group.height  // Track which height group this item belongs to
    })))
  }

  // Pack pallets until all items are placed
  while (remainingItems.length > 0) {
    const pallet = packSinglePallet(remainingItems, palletConfig, strategy.layerTolerance)

    // Don't add empty pallets - breaks infinite loop
    if (pallet.boxes.length === 0) {
      console.warn('⚠️ Could not place any items, stopping. Remaining:', remainingItems.length)
      break
    }

    pallets.push(pallet)

    // Remove packed items from remaining
    const packedIds = new Set(pallet.boxes.map(b => b._tempId))
    remainingItems = remainingItems.filter(item => !packedIds.has(item._tempId))

    // Safety valve
    if (pallets.length > 100) {
      console.warn('Packing exceeded 100 pallets, stopping')
      break
    }
  }

  // Calculate metrics
  const metrics = calculateMetrics(pallets, palletConfig)

  return {
    pallets,
    metrics,
    strategy: strategy.name
  }
}

/**
 * Pack a single pallet with layer-based approach
 */
function packSinglePallet(items, palletConfig, layerTolerance) {
  const { length: palletL, width: palletW, maxHeight, maxWeight, deckHeight } = palletConfig
  const usableHeight = maxHeight - deckHeight

  const boxes = []
  let currentY = 0
  let currentWeight = 0
  const remainingItems = [...items]

  // Build layers from bottom up
  while (remainingItems.length > 0 && currentY < usableHeight) {
    // Find items that can fit in a layer at current height
    const availableHeight = usableHeight - currentY

    // Get items that could start a layer (height <= available)
    const candidates = remainingItems.filter(item => 
      item.h <= availableHeight &&
      currentWeight + (item.weight || 0) <= maxWeight
    )

    if (candidates.length === 0) break

    // Group candidates by similar height
    const heightGroups = groupItemsByHeight(candidates, layerTolerance)
    
    // Pick the group with largest total area (best layer candidates)
    heightGroups.sort((a, b) => {
      const areaA = a.items.reduce((s, i) => s + i.l * i.w, 0)
      const areaB = b.items.reduce((s, i) => s + i.l * i.w, 0)
      return areaB - areaA
    })

    const layerGroup = heightGroups[0]
    if (!layerGroup || layerGroup.items.length === 0) break

    // Pack this layer using 2D bin packing
    const layerPacker = new LayerPacker(palletL, palletW, {
      allowRotation: true,
      splitStrategy: 'shorter-axis'
    })

    // Sort layer items by area (largest first)
    const layerItems = sortItemsForPacking(layerGroup.items, 'area-desc')

    for (const item of layerItems) {
      // Check weight constraint
      if (currentWeight + (item.weight || 0) > maxWeight) continue

      const placement = layerPacker.findBestFitWithAdjacency(item)

      if (placement) {
        layerPacker.placeItem(placement)

        boxes.push({
          x: placement.x,
          y: currentY,
          z: placement.z,
          l: placement.orient.l,
          w: placement.orient.w,
          h: placement.orient.h,
          item: item.item || item,
          weight: item.weight || 0,
          rotated: placement.orient.rotated,
          _tempId: item._tempId
        })

        currentWeight += item.weight || 0

        // Remove from remaining items
        const idx = remainingItems.findIndex(i => i._tempId === item._tempId)
        if (idx >= 0) remainingItems.splice(idx, 1)
      }
    }

    // Move to next layer
    const layerHeight = layerGroup.height
    if (layerPacker.getPlacements().length > 0) {
      currentY += layerHeight

      // Log layer stats
      console.log(`  Layer at y=${(currentY - layerHeight).toFixed(1)}: ` +
                  `${layerPacker.getPlacements().length} items, ` +
                  `${(layerPacker.getUtilization() * 100).toFixed(0)}% util`)
    } else {
      // No items placed in this layer, try next height group
      break
    }

    // Check if we should stop (nearly full)
    if (currentY >= usableHeight * 0.95) break
  }

  // Calculate pallet dimensions and weight
  const dims = calculatePalletDims(boxes, palletConfig)

  return {
    id: Date.now() + Math.random(),
    boxes,
    dims,
    weight: currentWeight,
    itemCount: boxes.length
  }
}

/**
 * Simple greedy fallback packing
 */
function packGreedy(items, palletConfig) {
  const { length: palletL, width: palletW, maxHeight, maxWeight, deckHeight } = palletConfig
  const usableHeight = maxHeight - deckHeight

  const pallets = []
  const remaining = [...items]

  while (remaining.length > 0) {
    const boxes = []
    let currentWeight = 0

    // Very simple: sort by volume, place in order
    remaining.sort((a, b) => (b.l * b.w * b.h) - (a.l * a.w * a.h))

    // Track occupied space with simple grid
    const heightMap = new Array(Math.ceil(palletL)).fill(0)
      .map(() => new Array(Math.ceil(palletW)).fill(0))

    const toRemove = []

    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i]

      if (currentWeight + (item.weight || 0) > maxWeight) continue

      // Find lowest position
      const pos = findLowestPosition(heightMap, item.l, item.w, palletL, palletW, usableHeight, item.h)

      if (pos) {
        boxes.push({
          x: pos.x,
          y: pos.y,
          z: pos.z,
          l: item.l,
          w: item.w,
          h: item.h,
          item: item.item || item,
          weight: item.weight || 0,
          _tempId: item._tempId
        })

        // Update height map
        for (let x = Math.floor(pos.x); x < Math.min(Math.ceil(pos.x + item.l), palletL); x++) {
          for (let z = Math.floor(pos.z); z < Math.min(Math.ceil(pos.z + item.w), palletW); z++) {
            if (heightMap[x] && heightMap[x][z] !== undefined) {
              heightMap[x][z] = Math.max(heightMap[x][z], pos.y + item.h)
            }
          }
        }

        currentWeight += item.weight || 0
        toRemove.push(i)
      }
    }

    // Remove packed items (in reverse order to maintain indices)
    toRemove.reverse().forEach(i => remaining.splice(i, 1))

    if (boxes.length === 0) {
      console.warn('Could not place any items, stopping')
      break
    }

    pallets.push({
      id: Date.now() + Math.random(),
      boxes,
      dims: calculatePalletDims(boxes, palletConfig),
      weight: currentWeight,
      itemCount: boxes.length
    })
  }

  return {
    pallets,
    metrics: calculateMetrics(pallets, palletConfig),
    strategy: 'greedy-fallback'
  }
}

/**
 * Find lowest valid position in height map
 */
function findLowestPosition(heightMap, itemL, itemW, palletL, palletW, maxHeight, itemH) {
  let best = null
  let bestY = Infinity

  for (let x = 0; x <= palletL - itemL; x++) {
    for (let z = 0; z <= palletW - itemW; z++) {
      // Find max height in this footprint
      let maxY = 0
      for (let dx = 0; dx < Math.ceil(itemL); dx++) {
        for (let dz = 0; dz < Math.ceil(itemW); dz++) {
          const hx = Math.min(x + dx, heightMap.length - 1)
          const hz = Math.min(z + dz, heightMap[0].length - 1)
          if (heightMap[hx] && heightMap[hx][hz] !== undefined) {
            maxY = Math.max(maxY, heightMap[hx][hz])
          }
        }
      }

      if (maxY + itemH <= maxHeight && maxY < bestY) {
        bestY = maxY
        best = { x, y: maxY, z }
      }
    }
  }

  return best
}

/**
 * Expand items with quantities into individual units
 */
function expandItems(items) {
  const expanded = []
  let tempId = 0

  for (const item of items) {
    const qty = item.qty || item.quantity || 1

    for (let i = 0; i < qty; i++) {
      expanded.push({
        l: item.l || item.length || 30,
        w: item.w || item.width || 20,
        h: item.h || item.height || 10,
        weight: item.weight || 0,
        item: item,
        _tempId: tempId++
      })
    }
  }

  return expanded
}

/**
 * Calculate pallet bounding dimensions
 */
function calculatePalletDims(boxes, palletConfig) {
  if (boxes.length === 0) {
    return [palletConfig.length, palletConfig.width, palletConfig.deckHeight]
  }

  let maxX = 0, maxY = 0, maxZ = 0

  for (const box of boxes) {
    maxX = Math.max(maxX, box.x + box.l)
    maxY = Math.max(maxY, box.y + box.h)
    maxZ = Math.max(maxZ, box.z + box.w)
  }

  return [
    Math.max(maxX, palletConfig.length),
    Math.max(maxZ, palletConfig.width),
    maxY + palletConfig.deckHeight
  ]
}

/**
 * Calculate packing metrics
 */
function calculateMetrics(pallets, palletConfig) {
  if (pallets.length === 0) {
    return {
      palletCount: 0,
      totalWeight: 0,
      totalItems: 0,
      avgUtilization: 0,
      cubicFeet: 0
    }
  }

  const palletVolume = palletConfig.length * palletConfig.width * (palletConfig.maxHeight - palletConfig.deckHeight)
  let totalUsedVolume = 0
  let totalWeight = 0
  let totalItems = 0

  for (const pallet of pallets) {
    for (const box of pallet.boxes) {
      totalUsedVolume += box.l * box.w * box.h
      totalWeight += box.weight || 0
      totalItems++
    }
  }

  const totalAvailableVolume = pallets.length * palletVolume
  const avgUtilization = totalUsedVolume / totalAvailableVolume

  // Cubic feet calculation
  let cubicFeet = 0
  for (const pallet of pallets) {
    const [l, w, h] = pallet.dims
    cubicFeet += (l * w * h) / 1728  // Convert cubic inches to cubic feet
  }

  return {
    palletCount: pallets.length,
    totalWeight,
    totalItems,
    avgUtilization,
    cubicFeet,
    usedVolume: totalUsedVolume,
    availableVolume: totalAvailableVolume
  }
}

/**
 * Score a packing result (lower is better)
 */
function scoreResult(result) {
  // Primary: minimize pallet count
  // Secondary: maximize utilization
  return result.pallets.length * 10000 - result.metrics.avgUtilization * 1000
}

/**
 * Validate packing constraints
 */
export function validatePacking(pallets, palletConfig) {
  const issues = []

  for (let i = 0; i < pallets.length; i++) {
    const pallet = pallets[i]

    // Check weight
    if (pallet.weight > palletConfig.maxWeight) {
      issues.push(`Pallet ${i + 1} exceeds max weight: ${pallet.weight} > ${palletConfig.maxWeight}`)
    }

    // Check height
    const [, , height] = pallet.dims
    if (height > palletConfig.maxHeight) {
      issues.push(`Pallet ${i + 1} exceeds max height: ${height} > ${palletConfig.maxHeight}`)
    }

    // Check for overlapping boxes
    for (let j = 0; j < pallet.boxes.length; j++) {
      for (let k = j + 1; k < pallet.boxes.length; k++) {
        if (boxesOverlap(pallet.boxes[j], pallet.boxes[k])) {
          issues.push(`Pallet ${i + 1}: boxes ${j} and ${k} overlap`)
        }
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  }
}

/**
 * Check if two boxes overlap
 */
function boxesOverlap(a, b) {
  const tol = 0.1
  return (
    a.x < b.x + b.l - tol && a.x + a.l > b.x + tol &&
    a.y < b.y + b.h - tol && a.y + a.h > b.y + tol &&
    a.z < b.z + b.w - tol && a.z + a.w > b.z + tol
  )
}

export default optimizePalletPacking
