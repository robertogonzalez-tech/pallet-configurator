/**
 * Dimension Overrides Storage Utility
 * 
 * Stores manual dimension overrides for unknown products.
 * Persists to localStorage with 30-day TTL.
 */

const OVERRIDE_KEY = 'gcs_dimension_overrides'
const OVERRIDE_TTL_DAYS = 30

/**
 * Get all stored overrides
 * @returns {Object} - Map of SKU to override data
 */
export function getOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY)
    if (!raw) return {}
    
    const overrides = JSON.parse(raw)
    
    // Clean up expired overrides
    const now = Date.now()
    const cleanedOverrides = {}
    let hasExpired = false
    
    Object.entries(overrides).forEach(([sku, data]) => {
      if (data.expiresAt && now > data.expiresAt) {
        hasExpired = true
      } else {
        cleanedOverrides[sku] = data
      }
    })
    
    // Save cleaned data if any were expired
    if (hasExpired) {
      localStorage.setItem(OVERRIDE_KEY, JSON.stringify(cleanedOverrides))
    }
    
    return cleanedOverrides
  } catch (err) {
    console.error('Failed to load overrides:', err)
    return {}
  }
}

/**
 * Get override for a specific SKU
 * @param {string} sku - Product SKU
 * @returns {Object|null} - Override data or null
 */
export function getOverride(sku) {
  if (!sku) return null
  
  const overrides = getOverrides()
  const override = overrides[sku]
  
  if (!override) return null
  if (override.expiresAt && Date.now() > override.expiresAt) return null
  
  return {
    length: override.length,
    width: override.width,
    height: override.height,
    weight: override.weight
  }
}

/**
 * Save dimension override for a SKU
 * @param {string} sku - Product SKU
 * @param {Object} dims - { length, width, height, weight }
 */
export function saveDimensionOverride(sku, dims) {
  if (!sku) return
  
  const overrides = getOverrides()
  
  overrides[sku] = {
    length: Number(dims.length) || 24,
    width: Number(dims.width) || 18,
    height: Number(dims.height) || 12,
    weight: Number(dims.weight) || 25,
    savedAt: Date.now(),
    expiresAt: Date.now() + (OVERRIDE_TTL_DAYS * 24 * 60 * 60 * 1000)
  }
  
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides))
    console.log(`Saved dimension override for ${sku}:`, dims)
  } catch (err) {
    console.error('Failed to save override:', err)
  }
}

/**
 * Remove override for a SKU
 * @param {string} sku - Product SKU
 */
export function removeOverride(sku) {
  if (!sku) return
  
  const overrides = getOverrides()
  delete overrides[sku]
  
  try {
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides))
  } catch (err) {
    console.error('Failed to remove override:', err)
  }
}

/**
 * Clear all overrides
 */
export function clearAllOverrides() {
  try {
    localStorage.removeItem(OVERRIDE_KEY)
  } catch (err) {
    console.error('Failed to clear overrides:', err)
  }
}

/**
 * Apply overrides to an array of items
 * Returns items with packaged dimensions updated if override exists
 * @param {Array} items - Array of order items
 * @returns {Array} - Items with overrides applied
 */
export function applyOverridesToItems(items) {
  if (!items || !Array.isArray(items)) return items
  
  return items.map(item => {
    const override = getOverride(item.sku)
    
    if (override) {
      return {
        ...item,
        packaged: {
          ...item.packaged,
          length_in: override.length,
          width_in: override.width,
          height_in: override.height,
          weight_lbs: override.weight
        },
        hasOverride: true,
        isUnknown: false // No longer unknown if overridden
      }
    }
    
    return item
  })
}

/**
 * Check if any items have overrides
 * @param {Array} items - Array of order items
 * @returns {number} - Count of items with overrides
 */
export function countOverrides(items) {
  if (!items || !Array.isArray(items)) return 0
  
  let count = 0
  items.forEach(item => {
    if (getOverride(item.sku)) count++
  })
  return count
}

/**
 * Export all overrides as JSON (for debugging/backup)
 * @returns {string} - JSON string of all overrides
 */
export function exportOverrides() {
  return JSON.stringify(getOverrides(), null, 2)
}
