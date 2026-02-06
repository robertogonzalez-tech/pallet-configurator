import { useState, useEffect } from 'react'
import { validateAgainstBOL } from './binPacking3D'

/**
 * BOL Validator - Compare predicted packing to actual shipments
 * Used to improve algorithm accuracy over time
 */

const VALIDATION_LOG_KEY = 'gcs_bol_validations'

// Load validation history from localStorage
function loadValidations() {
  try {
    return JSON.parse(localStorage.getItem(VALIDATION_LOG_KEY) || '[]')
  } catch {
    return []
  }
}

// Save validation to localStorage
function saveValidation(validation) {
  const validations = loadValidations()
  validations.push({
    ...validation,
    id: `val_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: new Date().toISOString(),
  })
  // Keep last 200 validations
  if (validations.length > 200) {
    validations.splice(0, validations.length - 200)
  }
  localStorage.setItem(VALIDATION_LOG_KEY, JSON.stringify(validations))
  return validations
}

// Calculate accuracy stats
function calculateAccuracyStats(validations) {
  if (validations.length === 0) {
    return { exactMatch: 0, withinOne: 0, avgVariance: 0, count: 0 }
  }
  
  const exactMatches = validations.filter(v => v.metrics?.exactMatch).length
  const withinOne = validations.filter(v => v.metrics?.withinOne).length
  const totalVariance = validations.reduce((sum, v) => sum + Math.abs(v.metrics?.variance || 0), 0)
  
  return {
    exactMatch: ((exactMatches / validations.length) * 100).toFixed(1),
    withinOne: ((withinOne / validations.length) * 100).toFixed(1),
    avgVariance: (totalVariance / validations.length).toFixed(2),
    count: validations.length,
  }
}

export default function BOLValidator({ packingResult, quoteNumber, onClose }) {
  const [actualPallets, setActualPallets] = useState('')
  const [actualWeight, setActualWeight] = useState('')
  const [notes, setNotes] = useState('')
  const [validations, setValidations] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  
  useEffect(() => {
    setValidations(loadValidations())
  }, [])
  
  const predictedPallets = packingResult?.length || 0
  const predictedWeight = packingResult?.reduce((sum, p) => sum + (p.metrics?.weight || p.weight || 0), 0) || 0
  
  const handleSubmit = () => {
    if (!actualPallets) return
    
    const actualBol = {
      palletCount: parseInt(actualPallets),
      totalWeight: actualWeight ? parseInt(actualWeight) : null,
    }
    
    const metrics = validateAgainstBOL(packingResult, actualBol)
    
    const validation = {
      quoteNumber,
      predicted: {
        pallets: predictedPallets,
        weight: predictedWeight,
      },
      actual: actualBol,
      metrics,
      notes,
      items: packingResult?.map(p => p.items?.length || p.boxes?.length).reduce((a, b) => a + b, 0),
    }
    
    const updated = saveValidation(validation)
    setValidations(updated)
    setSubmitted(true)
  }
  
  const stats = calculateAccuracyStats(validations)
  
  const handleExport = () => {
    const data = {
      validations,
      stats,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bol-validations-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '20px',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '12px',
        maxWidth: '500px',
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
      }}>
        <div style={{
          padding: '20px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
            📊 Validate Against BOL
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: '#6b7280',
            }}
          >
            ×
          </button>
        </div>
        
        <div style={{ padding: '20px' }}>
          {/* Accuracy Stats Banner */}
          <div style={{
            background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px',
          }}>
            <div style={{ fontWeight: '600', color: '#4F46E5', marginBottom: '8px' }}>
              Algorithm Accuracy ({stats.count} validations)
            </div>
            <div style={{ display: 'flex', gap: '20px', fontSize: '0.9rem' }}>
              <div>
                <div style={{ color: '#6b7280' }}>Exact Match</div>
                <div style={{ fontWeight: '600', fontSize: '1.25rem' }}>{stats.exactMatch}%</div>
              </div>
              <div>
                <div style={{ color: '#6b7280' }}>Within ±1</div>
                <div style={{ fontWeight: '600', fontSize: '1.25rem' }}>{stats.withinOne}%</div>
              </div>
              <div>
                <div style={{ color: '#6b7280' }}>Avg Variance</div>
                <div style={{ fontWeight: '600', fontSize: '1.25rem' }}>{stats.avgVariance}</div>
              </div>
            </div>
          </div>
          
          {!submitted ? (
            <>
              {/* Prediction vs Actual */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
                marginBottom: '20px',
              }}>
                <div style={{
                  background: '#f3f4f6',
                  padding: '16px',
                  borderRadius: '8px',
                }}>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '4px' }}>
                    Predicted
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '700' }}>
                    {predictedPallets} pallets
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
                    {predictedWeight.toLocaleString()} lbs
                  </div>
                </div>
                
                <div style={{
                  background: '#FEF3C7',
                  padding: '16px',
                  borderRadius: '8px',
                }}>
                  <div style={{ color: '#92400e', fontSize: '0.85rem', marginBottom: '4px' }}>
                    Actual (from BOL)
                  </div>
                  <input
                    type="number"
                    value={actualPallets}
                    onChange={(e) => setActualPallets(e.target.value)}
                    placeholder="# pallets"
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '2px solid #fcd34d',
                      borderRadius: '6px',
                      fontSize: '1.25rem',
                      fontWeight: '600',
                      marginBottom: '8px',
                    }}
                  />
                  <input
                    type="number"
                    value={actualWeight}
                    onChange={(e) => setActualWeight(e.target.value)}
                    placeholder="Total lbs (optional)"
                    style={{
                      width: '100%',
                      padding: '6px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '4px',
                      fontSize: '0.9rem',
                    }}
                  />
                </div>
              </div>
              
              {/* Notes */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '6px', color: '#374151', fontWeight: '500' }}>
                  Notes (optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special circumstances? Different packing? etc."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    resize: 'vertical',
                  }}
                />
              </div>
              
              {/* Quote number display */}
              {quoteNumber && (
                <div style={{ marginBottom: '20px', color: '#6b7280', fontSize: '0.9rem' }}>
                  Quote: <strong>{quoteNumber}</strong>
                </div>
              )}
              
              <button
                onClick={handleSubmit}
                disabled={!actualPallets}
                style={{
                  width: '100%',
                  padding: '12px',
                  background: actualPallets ? '#059669' : '#d1d5db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '600',
                  fontSize: '1rem',
                  cursor: actualPallets ? 'pointer' : 'not-allowed',
                }}
              >
                ✓ Record Validation
              </button>
            </>
          ) : (
            /* Success State */
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>
                {actualPallets == predictedPallets ? '🎯' : Math.abs(actualPallets - predictedPallets) <= 1 ? '👍' : '📝'}
              </div>
              <div style={{ fontSize: '1.25rem', fontWeight: '600', marginBottom: '8px' }}>
                {actualPallets == predictedPallets 
                  ? 'Exact Match!' 
                  : Math.abs(actualPallets - predictedPallets) <= 1
                    ? 'Close! Within ±1 pallet'
                    : `Off by ${Math.abs(actualPallets - predictedPallets)} pallets`}
              </div>
              <div style={{ color: '#6b7280', marginBottom: '20px' }}>
                Validation recorded. This helps improve accuracy.
              </div>
              <button
                onClick={onClose}
                style={{
                  padding: '10px 24px',
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
        
        {/* History Toggle */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid #e5e7eb',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              background: 'none',
              border: 'none',
              color: '#2563eb',
              cursor: 'pointer',
              fontWeight: '500',
            }}
          >
            {showHistory ? '▼ Hide History' : '▶ Show History'} ({validations.length})
          </button>
          
          <button
            onClick={handleExport}
            style={{
              background: '#f3f4f6',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            📥 Export Data
          </button>
        </div>
        
        {/* History List */}
        {showHistory && (
          <div style={{
            maxHeight: '200px',
            overflow: 'auto',
            borderTop: '1px solid #e5e7eb',
          }}>
            {validations.slice(-20).reverse().map((v, i) => (
              <div
                key={v.id || i}
                style={{
                  padding: '12px 20px',
                  borderBottom: '1px solid #f3f4f6',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <span style={{ fontWeight: '500' }}>
                    {v.quoteNumber || 'No quote #'}
                  </span>
                  <span style={{ color: '#6b7280', marginLeft: '8px' }}>
                    {new Date(v.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span>{v.predicted?.pallets} → {v.actual?.palletCount}</span>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    background: v.metrics?.exactMatch ? '#D1FAE5' : v.metrics?.withinOne ? '#FEF3C7' : '#FEE2E2',
                    color: v.metrics?.exactMatch ? '#059669' : v.metrics?.withinOne ? '#D97706' : '#DC2626',
                  }}>
                    {v.metrics?.exactMatch ? '✓' : v.metrics?.variance > 0 ? `+${v.metrics.variance}` : v.metrics?.variance}
                  </span>
                </div>
              </div>
            ))}
            {validations.length === 0 && (
              <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>
                No validations yet. Start recording to improve accuracy!
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Export accuracy functions for use elsewhere
export { loadValidations, calculateAccuracyStats }
