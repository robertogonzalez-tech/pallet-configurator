/**
 * LayerPacker - 2D Guillotine Bin Packing for Pallet Layers
 * 
 * Solves the 2D bin packing problem for a single horizontal layer.
 * Uses guillotine cutting: each placement creates clean rectangular remainders.
 * 
 * Usage:
 *   const packer = new LayerPacker(86, 40)  // pallet dimensions in inches
 *   const placement = packer.findBestFit(item)
 *   if (placement) packer.placeItem(placement)
 */

export class LayerPacker {
  constructor(palletL, palletW, options = {}) {
    this.palletL = palletL
    this.palletW = palletW
    this.options = {
      allowRotation: true,
      splitStrategy: 'shorter-axis',  // 'shorter-axis', 'longer-axis', 'area-min'
      ...options
    }
    
    // Available rectangular spaces (initially the full pallet)
    this.spaces = [{
      x: 0,
      z: 0,
      l: palletL,
      w: palletW,
      area: palletL * palletW
    }]
    
    // Placed items for reference
    this.placements = []
    this.usedArea = 0
  }

  /**
   * Find the best position for an item using Best Short Side Fit (BSSF)
   * Returns null if item doesn't fit anywhere
   */
  findBestFit(item) {
    let bestPlacement = null
    let bestScore = Infinity

    for (const space of this.spaces) {
      const orientations = this._getOrientations(item)

      for (const orient of orientations) {
        // Check if item fits in this space
        if (orient.l <= space.l + 0.01 && orient.w <= space.w + 0.01) {
          // Calculate fit score (lower is better)
          const score = this._calculateFitScore(space, orient)

          if (score < bestScore) {
            bestScore = score
            bestPlacement = {
              space,
              orient,
              x: space.x,
              z: space.z,
              item,
              score
            }
          }
        }
      }
    }

    return bestPlacement
  }

  /**
   * Find best fit considering adjacency to already-placed items
   */
  findBestFitWithAdjacency(item) {
    let bestPlacement = null
    let bestScore = Infinity

    for (const space of this.spaces) {
      const orientations = this._getOrientations(item)

      for (const orient of orientations) {
        if (orient.l <= space.l + 0.01 && orient.w <= space.w + 0.01) {
          // Base fit score
          let score = this._calculateFitScore(space, orient)
          
          // Adjacency bonus (reduce score for touching edges)
          const adjacency = this._calculateAdjacencyBonus(space.x, space.z, orient)
          score -= adjacency * 50  // Significant bonus for adjacency
          
          // Corner bonus (prefer corners to reduce fragmentation)
          const isCorner = this._isCornerPosition(space.x, space.z)
          if (isCorner) score -= 100

          if (score < bestScore) {
            bestScore = score
            bestPlacement = {
              space,
              orient,
              x: space.x,
              z: space.z,
              item,
              score
            }
          }
        }
      }
    }

    return bestPlacement
  }

  /**
   * Place an item and update available spaces
   */
  placeItem(placement) {
    const { space, orient, x, z, item } = placement

    // Record placement
    this.placements.push({
      item,
      x,
      z,
      l: orient.l,
      w: orient.w,
      h: orient.h,
      rotated: orient.rotated || false
    })
    this.usedArea += orient.l * orient.w

    // Remove used space
    this.spaces = this.spaces.filter(s => s !== space)

    // Create remainder spaces using guillotine cut
    const remainders = this._guillotineCut(space, orient, x, z)
    this.spaces.push(...remainders)

    // Merge adjacent spaces to reduce fragmentation
    this._mergeSpaces()

    // Sort spaces for consistent placement order (bottom-left first)
    this.spaces.sort((a, b) => {
      if (Math.abs(a.z - b.z) > 0.5) return a.z - b.z
      return a.x - b.x
    })

    return placement
  }

  /**
   * Get current layer utilization (0-1)
   */
  getUtilization() {
    const totalArea = this.palletL * this.palletW
    return this.usedArea / totalArea
  }

  /**
   * Get remaining capacity estimate
   */
  getRemainingArea() {
    return this.spaces.reduce((sum, s) => sum + s.area, 0)
  }

  /**
   * Check if an item of given dimensions could possibly fit
   */
  canFit(l, w) {
    for (const space of this.spaces) {
      if ((l <= space.l && w <= space.w) || (w <= space.l && l <= space.w)) {
        return true
      }
    }
    return false
  }

  /**
   * Get all placements for this layer
   */
  getPlacements() {
    return this.placements
  }

  // ============ Private Methods ============

  _getOrientations(item) {
    const base = {
      l: item.l,
      w: item.w,
      h: item.h,
      rotated: false
    }

    if (!this.options.allowRotation) {
      return [base]
    }

    // For square items, rotation is redundant
    if (Math.abs(item.l - item.w) < 0.1) {
      return [base]
    }

    return [
      base,
      {
        l: item.w,
        w: item.l,
        h: item.h,
        rotated: true
      }
    ]
  }

  _calculateFitScore(space, orient) {
    // Best Short Side Fit (BSSF) - minimize the shorter leftover dimension
    const leftoverL = space.l - orient.l
    const leftoverW = space.w - orient.w
    
    // Primary: minimize shortest remainder (reduces unusable slivers)
    const shortSide = Math.min(leftoverL, leftoverW)
    
    // Secondary: minimize total waste
    const longSide = Math.max(leftoverL, leftoverW)
    
    return shortSide * 1000 + longSide
  }

  _calculateAdjacencyBonus(x, z, orient) {
    let touches = 0
    const tol = 0.5

    // Check if touching pallet edge
    if (x < tol) touches++
    if (z < tol) touches++
    if (Math.abs(x + orient.l - this.palletL) < tol) touches++
    if (Math.abs(z + orient.w - this.palletW) < tol) touches++

    // Check if touching placed items
    for (const p of this.placements) {
      // Left/right adjacency
      if (Math.abs(x - (p.x + p.l)) < tol || Math.abs(x + orient.l - p.x) < tol) {
        // Check Z overlap
        if (z < p.z + p.w + tol && z + orient.w > p.z - tol) {
          touches++
        }
      }
      // Front/back adjacency
      if (Math.abs(z - (p.z + p.w)) < tol || Math.abs(z + orient.w - p.z) < tol) {
        // Check X overlap
        if (x < p.x + p.l + tol && x + orient.l > p.x - tol) {
          touches++
        }
      }
    }

    return touches
  }

  _isCornerPosition(x, z) {
    const tol = 0.5
    const isLeftOrRight = x < tol || Math.abs(x + this.palletL) < tol
    const isFrontOrBack = z < tol || Math.abs(z + this.palletW) < tol
    return isLeftOrRight || isFrontOrBack
  }

  _guillotineCut(space, orient, x, z) {
    const remainders = []
    const rightWidth = space.l - orient.l
    const topHeight = space.w - orient.w

    if (this.options.splitStrategy === 'shorter-axis') {
      // Split along shorter axis first (creates more usable rectangles)
      if (rightWidth <= topHeight) {
        // Horizontal split first
        if (rightWidth > 0.5) {
          remainders.push({
            x: x + orient.l,
            z: z,
            l: rightWidth,
            w: space.w,
            area: rightWidth * space.w
          })
        }
        if (topHeight > 0.5) {
          remainders.push({
            x: x,
            z: z + orient.w,
            l: orient.l,
            w: topHeight,
            area: orient.l * topHeight
          })
        }
      } else {
        // Vertical split first
        if (topHeight > 0.5) {
          remainders.push({
            x: x,
            z: z + orient.w,
            l: space.l,
            w: topHeight,
            area: space.l * topHeight
          })
        }
        if (rightWidth > 0.5) {
          remainders.push({
            x: x + orient.l,
            z: z,
            l: rightWidth,
            w: orient.w,
            area: rightWidth * orient.w
          })
        }
      }
    } else if (this.options.splitStrategy === 'longer-axis') {
      // Split along longer axis (alternative strategy)
      if (rightWidth >= topHeight) {
        if (rightWidth > 0.5) {
          remainders.push({
            x: x + orient.l,
            z: z,
            l: rightWidth,
            w: space.w,
            area: rightWidth * space.w
          })
        }
        if (topHeight > 0.5) {
          remainders.push({
            x: x,
            z: z + orient.w,
            l: orient.l,
            w: topHeight,
            area: orient.l * topHeight
          })
        }
      } else {
        if (topHeight > 0.5) {
          remainders.push({
            x: x,
            z: z + orient.w,
            l: space.l,
            w: topHeight,
            area: space.l * topHeight
          })
        }
        if (rightWidth > 0.5) {
          remainders.push({
            x: x + orient.l,
            z: z,
            l: rightWidth,
            w: orient.w,
            area: rightWidth * orient.w
          })
        }
      }
    }

    return remainders
  }

  _mergeSpaces() {
    // Attempt to merge adjacent rectangles
    let merged = true
    
    while (merged) {
      merged = false
      
      for (let i = 0; i < this.spaces.length && !merged; i++) {
        for (let j = i + 1; j < this.spaces.length && !merged; j++) {
          const a = this.spaces[i]
          const b = this.spaces[j]
          
          // Check if horizontally adjacent and same height
          if (Math.abs(a.z - b.z) < 0.01 && Math.abs(a.w - b.w) < 0.01) {
            if (Math.abs(a.x + a.l - b.x) < 0.01) {
              // a is left of b, merge
              this.spaces[i] = {
                x: a.x,
                z: a.z,
                l: a.l + b.l,
                w: a.w,
                area: (a.l + b.l) * a.w
              }
              this.spaces.splice(j, 1)
              merged = true
            } else if (Math.abs(b.x + b.l - a.x) < 0.01) {
              // b is left of a, merge
              this.spaces[i] = {
                x: b.x,
                z: a.z,
                l: a.l + b.l,
                w: a.w,
                area: (a.l + b.l) * a.w
              }
              this.spaces.splice(j, 1)
              merged = true
            }
          }
          
          // Check if vertically adjacent and same width
          if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.l - b.l) < 0.01) {
            if (Math.abs(a.z + a.w - b.z) < 0.01) {
              // a is below b, merge
              this.spaces[i] = {
                x: a.x,
                z: a.z,
                l: a.l,
                w: a.w + b.w,
                area: a.l * (a.w + b.w)
              }
              this.spaces.splice(j, 1)
              merged = true
            } else if (Math.abs(b.z + b.w - a.z) < 0.01) {
              // b is below a, merge
              this.spaces[i] = {
                x: a.x,
                z: b.z,
                l: a.l,
                w: a.w + b.w,
                area: a.l * (a.w + b.w)
              }
              this.spaces.splice(j, 1)
              merged = true
            }
          }
        }
      }
    }
  }
}

/**
 * Utility: Group items by similar heights for layer-based packing
 */
export function groupItemsByHeight(items, tolerance = 1.0) {
  if (items.length === 0) return []

  // Sort by height
  const sorted = [...items].sort((a, b) => a.h - b.h)

  const groups = []
  let currentGroup = {
    height: sorted[0].h,
    items: [sorted[0]]
  }

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i]
    
    if (item.h <= currentGroup.height + tolerance) {
      // Same layer group
      currentGroup.items.push(item)
      // Use tallest item height for the group
      currentGroup.height = Math.max(currentGroup.height, item.h)
    } else {
      // New group
      groups.push(currentGroup)
      currentGroup = {
        height: item.h,
        items: [item]
      }
    }
  }
  
  groups.push(currentGroup)
  return groups
}

/**
 * Utility: Sort items for optimal packing order
 */
export function sortItemsForPacking(items, strategy = 'area-desc') {
  const sorted = [...items]
  
  switch (strategy) {
    case 'area-desc':
      sorted.sort((a, b) => (b.l * b.w) - (a.l * a.w))
      break
    case 'volume-desc':
      sorted.sort((a, b) => (b.l * b.w * b.h) - (a.l * a.w * a.h))
      break
    case 'perimeter-desc':
      sorted.sort((a, b) => (b.l + b.w) - (a.l + a.w))
      break
    case 'height-desc':
      sorted.sort((a, b) => b.h - a.h)
      break
    case 'weight-desc':
      sorted.sort((a, b) => (b.weight || 0) - (a.weight || 0))
      break
    case 'longest-side-desc':
      sorted.sort((a, b) => Math.max(b.l, b.w) - Math.max(a.l, a.w))
      break
    default:
      // No sorting
      break
  }
  
  return sorted
}

export default LayerPacker
