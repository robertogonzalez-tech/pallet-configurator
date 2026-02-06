/**
 * Text-based Packing Slip Generator
 * 
 * Generates ASCII-formatted packing instructions for warehouse use.
 * Replaces 3D visualization with printable text output.
 */

const LINE_WIDTH = 65

/**
 * Generate a complete packing slip in ASCII format
 * @param {Array} pallets - Array of pallet objects with items, dims, weight
 * @param {Object} orderInfo - Order metadata (quoteNumber, shippingMethod, etc)
 * @returns {string} ASCII-formatted packing slip
 */
export function generatePackingSlip(pallets, orderInfo) {
  const output = []
  
  output.push(formatHeader(orderInfo))
  output.push(formatSummary(pallets, orderInfo))
  
  pallets.forEach((pallet, idx) => {
    output.push(formatPallet(pallet, idx + 1, pallets.length))
  })
  
  output.push(formatFooter(pallets))
  
  return output.join('\n')
}

/**
 * Format the header section
 */
function formatHeader(orderInfo) {
  const date = new Date().toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  })
  const time = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit'
  })
  
  const quoteNum = orderInfo.quoteNumber || 'MANUAL ORDER'
  
  return `${'═'.repeat(LINE_WIDTH)}
PALLET CONFIGURATION — ${quoteNum}
Generated: ${date} at ${time}
${'═'.repeat(LINE_WIDTH)}`
}

/**
 * Format the summary section
 */
function formatSummary(pallets, orderInfo) {
  const totalWeight = pallets.reduce((sum, p) => sum + (p.weight || 0), 0)
  const totalItems = pallets.reduce((sum, p) => {
    return sum + (p.items?.reduce((s, i) => s + (i.qty || 1), 0) || 0)
  }, 0)
  
  // Count DD components
  let dd4Count = 0
  let dd6Count = 0
  let regularItems = 0
  
  pallets.forEach(p => {
    if (p.family === 'Double Docker' || p.group === 'double-docker') {
      // DD pallets contain components
      p.items?.forEach(item => {
        if (item.sku?.includes('dd4') || item.name?.includes('DD4')) dd4Count += item.qty || 0
        else if (item.sku?.includes('dd6') || item.name?.includes('DD6')) dd6Count += item.qty || 0
      })
    } else {
      p.items?.forEach(item => {
        regularItems += item.qty || 1
      })
    }
  })
  
  // Check for warnings
  const hasUnknown = pallets.some(p => p.items?.some(i => i.isUnknown))
  const hasUnverifiedDims = pallets.some(p => p.items?.some(i => !i.dims && !i.accurateDims))
  
  let summary = `
SUMMARY
${'─'.repeat(LINE_WIDTH)}
Total Pallets:     ${pallets.length}
Total Weight:      ${totalWeight.toLocaleString()} lbs
Ship Method:       ${orderInfo.shippingMethod || 'LTL'}
Total Units:       ${totalItems}
`

  if (dd4Count > 0 || dd6Count > 0) {
    summary += `
DD Components:     ${dd4Count > 0 ? `${dd4Count} DD4` : ''}${dd4Count > 0 && dd6Count > 0 ? ' + ' : ''}${dd6Count > 0 ? `${dd6Count} DD6` : ''}`
  }
  
  if (regularItems > 0) {
    summary += `
Regular Products:  ${regularItems} items`
  }
  
  // Add warnings if any
  if (hasUnknown || hasUnverifiedDims) {
    summary += `

⚠️  WARNINGS:
`
    if (hasUnknown) {
      summary += `    • Contains UNKNOWN products with estimated dimensions
`
    }
    if (hasUnverifiedDims) {
      summary += `    • Some dimensions are unverified - confirm before shipping
`
    }
  }
  
  return summary
}

/**
 * Format a single pallet section
 */
function formatPallet(pallet, palletNum, totalPallets) {
  const dims = pallet.dims || [48, 40, 48]
  const weight = pallet.weight || 0
  
  // Determine pallet type
  let palletType = 'STANDARD PALLET'
  if (pallet.group === 'double-docker' || pallet.family === 'Double Docker') {
    if (pallet.source === 'dd-slide-track') palletType = 'DD SLIDE/TRACK CRATE'
    else if (pallet.source === 'dd-manifold') palletType = 'DD MANIFOLD CRATE'
    else if (pallet.source === 'dd-legs') palletType = 'DD LEGS PALLET'
    else palletType = 'DD COMPONENT CRATE'
  } else if (pallet.family === 'Mixed') {
    palletType = 'MIXED PALLET'
  } else if (pallet.family) {
    palletType = `${pallet.family.toUpperCase()} PALLET`
  }
  
  // Sort items by weight (heaviest first = bottom of pallet)
  const sortedItems = [...(pallet.items || [])].sort((a, b) => {
    const weightA = (a.weight || 50) * (a.qty || 1)
    const weightB = (b.weight || 50) * (b.qty || 1)
    return weightB - weightA
  })
  
  let section = `
${'═'.repeat(LINE_WIDTH)}

PALLET ${palletNum} of ${totalPallets} — ${palletType}
${'─'.repeat(LINE_WIDTH)}
Dimensions:   ${dims[0]}" × ${dims[1]}" × ${dims[2]}"
Weight:       ${weight.toLocaleString()} lbs`

  if (pallet.freightClass) {
    section += `
Freight Class: ${pallet.freightClass}`
  }
  
  if (pallet.palletSize) {
    section += `
Pallet Size:   ${pallet.palletSize}"`
  }
  
  // Contents list
  section += `

CONTENTS:
`
  
  sortedItems.forEach(item => {
    const itemName = item.displayName || item.name || item.sku
    const qty = item.qty || 1
    const itemWeight = (item.weight || 50) * qty
    const unknown = item.isUnknown ? ' ⚠️' : ''
    
    // Truncate long names
    const maxNameLen = LINE_WIDTH - 20
    const displayName = itemName.length > maxNameLen 
      ? itemName.substring(0, maxNameLen - 3) + '...'
      : itemName
    
    section += `  • ${qty}× ${displayName}${unknown}
`
    
    if (item.sku && item.sku !== itemName) {
      section += `       SKU: ${item.sku}
`
    }
  })
  
  // Packing instructions
  section += `
PACKING:
`
  
  // Generate layer-based instructions
  if (sortedItems.length > 0) {
    let layerNum = 1
    let currentLayerWeight = 0
    const MAX_LAYER_WEIGHT = 500 // lbs per layer guideline
    
    let layerItems = []
    
    sortedItems.forEach((item, idx) => {
      const itemTotalWeight = (item.weight || 50) * (item.qty || 1)
      
      if (currentLayerWeight + itemTotalWeight > MAX_LAYER_WEIGHT && layerItems.length > 0) {
        // Output current layer
        section += `  → Layer ${layerNum}: ${layerItems.join(', ')}
`
        layerNum++
        layerItems = []
        currentLayerWeight = 0
      }
      
      layerItems.push(`${item.qty || 1}× ${item.displayName || item.name || item.sku}`)
      currentLayerWeight += itemTotalWeight
    })
    
    // Output final layer
    if (layerItems.length > 0) {
      section += `  → Layer ${layerNum}: ${layerItems.join(', ')}
`
    }
    
    // Add general packing note
    section += `  → Secure with stretch wrap
`
  }
  
  // Special notes
  if (pallet.packingNote) {
    section += `
📝 NOTE: ${pallet.packingNote}
`
  }
  
  // Warnings for this pallet
  const hasWarnings = sortedItems.some(i => i.isUnknown) || pallet.source?.startsWith('dd-')
  if (hasWarnings) {
    section += `
⚠️  `
    if (sortedItems.some(i => i.isUnknown)) {
      section += `Contains items with unverified dimensions`
    }
    if (pallet.source?.startsWith('dd-')) {
      section += `DD components ship in dedicated crates - do not mix`
    }
  }
  
  return section
}

/**
 * Format footer with notes
 */
function formatFooter(pallets) {
  const hasDD = pallets.some(p => p.group === 'double-docker' || p.family === 'Double Docker')
  const hasMixed = pallets.some(p => p.family === 'Mixed')
  
  let footer = `

${'═'.repeat(LINE_WIDTH)}

SHIPPING NOTES:
`
  
  if (hasDD) {
    footer += `• Double Docker ships as 3 separate crate types:
    1. Slide/Track crates (80×43×56")
    2. Manifold crates (54×28×55")
    3. Legs pallets (48×45×53")
`
  }
  
  if (hasMixed) {
    footer += `• Mixed pallets: stack heaviest items on bottom
`
  }
  
  footer += `• Stretch wrap all pallets before shipping
• Mark fragile items appropriately
• Verify weights before loading

${'─'.repeat(LINE_WIDTH)}
Generated by GCS Pallet Configurator
${'═'.repeat(LINE_WIDTH)}
`
  
  return footer
}

/**
 * Get the anchor ID for a pallet section (for navigation)
 */
export function getPalletAnchor(palletNum) {
  return `pallet-${palletNum}`
}

/**
 * Export as downloadable text file
 */
export function downloadPackingSlip(text, quoteNumber) {
  const filename = quoteNumber 
    ? `packing-slip-${quoteNumber}-${Date.now()}.txt`
    : `packing-slip-${Date.now()}.txt`
  
  const blob = new Blob([text], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
