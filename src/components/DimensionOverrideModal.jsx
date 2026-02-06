/**
 * DimensionOverrideModal Component
 * 
 * Modal for manually entering dimensions for unknown products.
 * Saves overrides to localStorage for future use.
 */

import { useState, useEffect } from 'react'
import { saveDimensionOverride, getOverride } from '../utils/dimensionOverrides'

export default function DimensionOverrideModal({ 
  item, 
  onSave, 
  onClose,
  onRecalculate 
}) {
  // Initialize with existing override or item's current dimensions
  const existingOverride = getOverride(item?.sku)
  
  const [dims, setDims] = useState({
    length: existingOverride?.length || item?.packaged?.length_in || 24,
    width: existingOverride?.width || item?.packaged?.width_in || 18,
    height: existingOverride?.height || item?.packaged?.height_in || 12,
    weight: existingOverride?.weight || item?.packaged?.weight_lbs || 25
  })
  
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  // Handle input change
  const handleChange = (field, value) => {
    const numValue = Number(value)
    if (numValue < 0) return
    
    setDims(prev => ({
      ...prev,
      [field]: numValue
    }))
    setError(null)
  }

  // Validate dimensions
  const validate = () => {
    if (dims.length <= 0 || dims.width <= 0 || dims.height <= 0) {
      setError('All dimensions must be greater than 0')
      return false
    }
    if (dims.weight <= 0) {
      setError('Weight must be greater than 0')
      return false
    }
    if (dims.length > 120 || dims.width > 120 || dims.height > 120) {
      setError('Dimensions cannot exceed 120 inches')
      return false
    }
    if (dims.weight > 2000) {
      setError('Weight cannot exceed 2000 lbs')
      return false
    }
    return true
  }

  // Handle save
  const handleSave = () => {
    if (!validate()) return
    
    setSaving(true)
    
    try {
      // Save to localStorage
      saveDimensionOverride(item.sku, dims)
      
      // Notify parent
      if (onSave) {
        onSave(item.sku, dims)
      }
      
      // Trigger recalculation
      if (onRecalculate) {
        onRecalculate()
      }
      
      onClose()
    } catch (err) {
      setError('Failed to save: ' + err.message)
      setSaving(false)
    }
  }

  // Calculate cubic feet for preview
  const cubicFeet = ((dims.length * dims.width * dims.height) / 1728).toFixed(2)

  if (!item) return null

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: '20px',
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'white',
        borderRadius: '12px',
        maxWidth: '500px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #e5e7eb',
          background: '#fef3c7',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}>
            <div>
              <div style={{ 
                fontSize: '18px', 
                fontWeight: 'bold',
                color: '#92400e',
              }}>
                ✏️ Edit Dimensions
              </div>
              <div style={{ 
                fontSize: '14px', 
                color: '#92400e',
                marginTop: '4px',
              }}>
                {item.displayName || item.sku}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '24px',
                color: '#92400e',
                cursor: 'pointer',
                padding: '0',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: '20px' }}>
          <p style={{
            margin: '0 0 20px 0',
            padding: '12px',
            background: '#f0f9ff',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#0369a1',
          }}>
            💡 This product wasn't found in our catalog. Enter the actual 
            packaged dimensions to improve accuracy. These dimensions will be 
            saved for 30 days.
          </p>

          {/* SKU display */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              color: '#6b7280',
              marginBottom: '4px',
              textTransform: 'uppercase',
            }}>
              SKU
            </label>
            <div style={{
              padding: '10px 12px',
              background: '#f3f4f6',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '14px',
            }}>
              {item.sku}
            </div>
          </div>

          {/* Dimensions grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '12px',
            marginBottom: '16px',
          }}>
            {/* Length */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: '#6b7280',
                marginBottom: '4px',
              }}>
                Length (in)
              </label>
              <input
                type="number"
                value={dims.length}
                onChange={(e) => handleChange('length', e.target.value)}
                min="1"
                max="120"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                }}
              />
            </div>

            {/* Width */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: '#6b7280',
                marginBottom: '4px',
              }}>
                Width (in)
              </label>
              <input
                type="number"
                value={dims.width}
                onChange={(e) => handleChange('width', e.target.value)}
                min="1"
                max="120"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                }}
              />
            </div>

            {/* Height */}
            <div>
              <label style={{
                display: 'block',
                fontSize: '12px',
                fontWeight: '600',
                color: '#6b7280',
                marginBottom: '4px',
              }}>
                Height (in)
              </label>
              <input
                type="number"
                value={dims.height}
                onChange={(e) => handleChange('height', e.target.value)}
                min="1"
                max="120"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '16px',
                }}
              />
            </div>
          </div>

          {/* Weight */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '12px',
              fontWeight: '600',
              color: '#6b7280',
              marginBottom: '4px',
            }}>
              Weight (lbs)
            </label>
            <input
              type="number"
              value={dims.weight}
              onChange={(e) => handleChange('weight', e.target.value)}
              min="1"
              max="2000"
              style={{
                width: '200px',
                padding: '10px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '16px',
              }}
            />
          </div>

          {/* Preview */}
          <div style={{
            padding: '12px 16px',
            background: '#f3f4f6',
            borderRadius: '8px',
            marginBottom: '20px',
          }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
              PREVIEW
            </div>
            <div style={{ fontSize: '16px', fontWeight: '600' }}>
              {dims.length}" × {dims.width}" × {dims.height}" @ {dims.weight} lbs
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px' }}>
              Volume: {cubicFeet} cubic feet
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              padding: '12px 16px',
              background: '#fef2f2',
              color: '#dc2626',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '14px',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                background: '#f3f4f6',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '10px 20px',
                background: saving ? '#9ca3af' : '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: saving ? 'wait' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save & Recalculate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
