/**
 * Warehouse Checklist Storage Utility
 * 
 * Persists checklist state to localStorage with 7-day TTL.
 * Each quote gets its own storage key.
 */

const STORAGE_KEY_PREFIX = 'gcs_packing_checklist_'
const TTL_DAYS = 7

/**
 * Save checklist state for a quote
 * @param {string} quoteNumber - Quote identifier
 * @param {Object} state - Checklist state { checkedItems, notes }
 */
export function saveChecklist(quoteNumber, state) {
  if (!quoteNumber) return
  
  const data = {
    version: 1,
    quoteNumber,
    updatedAt: new Date().toISOString(),
    checkedItems: state.checkedItems || {},
    notes: state.notes || {},
    expiresAt: Date.now() + (TTL_DAYS * 24 * 60 * 60 * 1000)
  }
  
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + quoteNumber,
      JSON.stringify(data)
    )
  } catch (err) {
    console.error('Failed to save checklist:', err)
  }
}

/**
 * Load checklist state for a quote
 * @param {string} quoteNumber - Quote identifier
 * @returns {Object|null} - Checklist state or null if not found/expired
 */
export function loadChecklist(quoteNumber) {
  if (!quoteNumber) return null
  
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + quoteNumber)
    if (!raw) return null
    
    const data = JSON.parse(raw)
    
    // Check if expired
    if (Date.now() > data.expiresAt) {
      localStorage.removeItem(STORAGE_KEY_PREFIX + quoteNumber)
      return null
    }
    
    return {
      checkedItems: data.checkedItems || {},
      notes: data.notes || {},
      updatedAt: data.updatedAt
    }
  } catch (err) {
    console.error('Failed to load checklist:', err)
    return null
  }
}

/**
 * Clear checklist state for a quote
 * @param {string} quoteNumber - Quote identifier
 */
export function clearChecklist(quoteNumber) {
  if (!quoteNumber) return
  
  try {
    localStorage.removeItem(STORAGE_KEY_PREFIX + quoteNumber)
  } catch (err) {
    console.error('Failed to clear checklist:', err)
  }
}

/**
 * Check if a saved checklist exists for a quote
 * @param {string} quoteNumber - Quote identifier
 * @returns {boolean}
 */
export function hasChecklist(quoteNumber) {
  return loadChecklist(quoteNumber) !== null
}

/**
 * Get all saved checklists (for debugging/export)
 * @returns {Object} - Map of quote numbers to checklist data
 */
export function getAllChecklists() {
  const checklists = {}
  
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const quoteNumber = key.replace(STORAGE_KEY_PREFIX, '')
        const data = loadChecklist(quoteNumber)
        if (data) {
          checklists[quoteNumber] = data
        }
      }
    }
  } catch (err) {
    console.error('Failed to get all checklists:', err)
  }
  
  return checklists
}

/**
 * Clean up expired checklists
 */
export function cleanupExpiredChecklists() {
  try {
    const keysToRemove = []
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        const raw = localStorage.getItem(key)
        if (raw) {
          const data = JSON.parse(raw)
          if (Date.now() > data.expiresAt) {
            keysToRemove.push(key)
          }
        }
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key))
    
    if (keysToRemove.length > 0) {
      console.log(`Cleaned up ${keysToRemove.length} expired checklists`)
    }
  } catch (err) {
    console.error('Failed to cleanup checklists:', err)
  }
}

// Run cleanup on module load
cleanupExpiredChecklists()
