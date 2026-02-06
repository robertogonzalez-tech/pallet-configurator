/**
 * WarehouseView Component
 * 
 * Tablet-friendly interface for warehouse packing.
 * Large touch targets, packing checklist, clear visual feedback.
 * 
 * v2 Features:
 * - Persistent checklist state (localStorage, 7-day TTL)
 * - Per-pallet notes
 * - Resume banner when loading saved state
 * - Reset checklist button
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { saveChecklist, loadChecklist, clearChecklist } from './utils/checklistStorage'

// Large status badge
function StatusBadge({ status }) {
  const colors = {
    pending: { bg: '#fef3c7', text: '#92400e', label: 'PENDING' },
    packing: { bg: '#dbeafe', text: '#1e40af', label: 'PACKING' },
    complete: { bg: '#dcfce7', text: '#166534', label: 'COMPLETE' },
  }
  const c = colors[status] || colors.pending

  return (
    <div style={{
      display: 'inline-block',
      padding: '8px 16px',
      background: c.bg,
      color: c.text,
      fontWeight: 'bold',
      fontSize: '14px',
      borderRadius: '20px',
      textTransform: 'uppercase',
    }}>
      {c.label}
    </div>
  )
}

// Single pallet card for warehouse
function PalletCard({ 
  pallet, 
  palletNumber, 
  totalPallets, 
  onItemCheck, 
  checkedItems,
  notes,
  onNotesChange 
}) {
  const [showNotes, setShowNotes] = useState(false)
  
  const allChecked = useMemo(() => {
    if (!pallet.items) return false
    return pallet.items.every((item, idx) => 
      checkedItems[`${palletNumber}-${idx}`]
    )
  }, [pallet.items, palletNumber, checkedItems])

  const checkedCount = useMemo(() => {
    if (!pallet.items) return 0
    return pallet.items.filter((item, idx) => 
      checkedItems[`${palletNumber}-${idx}`]
    ).length
  }, [pallet.items, palletNumber, checkedItems])

  const palletNotes = notes[palletNumber] || ''

  return (
    <div style={{
      background: 'white',
      borderRadius: '16px',
      overflow: 'hidden',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
      marginBottom: '20px',
    }}>
      {/* Pallet Header */}
      <div style={{
        background: allChecked ? '#166534' : '#1e293b',
        color: 'white',
        padding: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        transition: 'background 0.3s ease',
      }}>
        <div>
          <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
            PALLET {palletNumber}
            <span style={{ fontSize: '18px', opacity: 0.8, marginLeft: '8px' }}>
              of {totalPallets}
            </span>
          </div>
          <div style={{ fontSize: '16px', opacity: 0.9, marginTop: '4px' }}>
            {pallet.dims?.[0] || 48}" × {pallet.dims?.[1] || 40}" × {pallet.dims?.[2] || 48}"
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '28px', fontWeight: 'bold' }}>
            {pallet.weight?.toLocaleString()} lbs
          </div>
          {allChecked && (
            <div style={{ fontSize: '24px', marginTop: '4px' }}>✓ COMPLETE</div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{
        height: '8px',
        background: '#e5e7eb',
      }}>
        <div style={{
          height: '100%',
          width: `${(checkedCount / (pallet.items?.length || 1)) * 100}%`,
          background: allChecked ? '#22c55e' : '#3b82f6',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Items list */}
      <div style={{ padding: '12px' }}>
        {pallet.items?.map((item, idx) => {
          const isChecked = checkedItems[`${palletNumber}-${idx}`]
          const itemKey = `${palletNumber}-${idx}`
          
          return (
            <div
              key={idx}
              onClick={() => onItemCheck(itemKey)}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '16px',
                marginBottom: '8px',
                background: isChecked ? '#dcfce7' : '#f8fafc',
                borderRadius: '12px',
                cursor: 'pointer',
                border: isChecked ? '2px solid #22c55e' : '2px solid transparent',
                transition: 'all 0.2s ease',
                touchAction: 'manipulation',
              }}
            >
              {/* Checkbox */}
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: isChecked ? '#22c55e' : 'white',
                border: isChecked ? 'none' : '3px solid #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginRight: '16px',
                flexShrink: 0,
                transition: 'all 0.2s ease',
              }}>
                {isChecked && (
                  <span style={{ color: 'white', fontSize: '28px' }}>✓</span>
                )}
              </div>

              {/* Quantity */}
              <div style={{
                width: '60px',
                height: '60px',
                background: isChecked ? '#166534' : '#2563eb',
                color: 'white',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                fontWeight: 'bold',
                marginRight: '16px',
                flexShrink: 0,
              }}>
                {item.qty || 1}
              </div>

              {/* Item details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '18px',
                  fontWeight: '600',
                  color: isChecked ? '#166534' : '#1e293b',
                  textDecoration: isChecked ? 'line-through' : 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {item.displayName || item.name || item.family || 'Product'}
                </div>
                <div style={{
                  fontSize: '14px',
                  color: '#64748b',
                  marginTop: '4px',
                }}>
                  {item.sku} • {((item.weight || 50) * (item.qty || 1)).toLocaleString()} lbs
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Notes section */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid #e5e7eb',
      }}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowNotes(!showNotes)
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 16px',
            width: '100%',
            background: palletNotes ? '#fef3c7' : '#f8fafc',
            border: palletNotes ? '1px solid #fcd34d' : '1px solid #e5e7eb',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            color: palletNotes ? '#92400e' : '#64748b',
            touchAction: 'manipulation',
          }}
        >
          {palletNotes ? '📝 Notes attached' : '📝 Add notes'}
          <span style={{ marginLeft: 'auto' }}>{showNotes ? '▲' : '▼'}</span>
        </button>
        
        {showNotes && (
          <textarea
            value={palletNotes}
            onChange={(e) => onNotesChange(palletNumber, e.target.value)}
            placeholder="Add warehouse notes for this pallet..."
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              marginTop: '12px',
              padding: '12px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '16px',
              minHeight: '100px',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        )}
      </div>
    </div>
  )
}

// Main WarehouseView component
export default function WarehouseView({ results, quoteNumber, onClose }) {
  const [checkedItems, setCheckedItems] = useState({})
  const [notes, setNotes] = useState({})
  const [isResuming, setIsResuming] = useState(false)
  const [resumeTime, setResumeTime] = useState(null)
  const saveTimeoutRef = useRef(null)

  // Load saved state on mount
  useEffect(() => {
    if (quoteNumber) {
      const saved = loadChecklist(quoteNumber)
      if (saved) {
        setCheckedItems(saved.checkedItems || {})
        setNotes(saved.notes || {})
        setIsResuming(true)
        setResumeTime(saved.updatedAt)
        
        // Auto-hide resume banner after 5 seconds
        setTimeout(() => setIsResuming(false), 5000)
      }
    }
  }, [quoteNumber])

  // Debounced save function
  const debouncedSave = useCallback((checkedItems, notes) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    
    saveTimeoutRef.current = setTimeout(() => {
      if (quoteNumber) {
        saveChecklist(quoteNumber, { checkedItems, notes })
      }
    }, 300)
  }, [quoteNumber])

  // Save on changes
  useEffect(() => {
    debouncedSave(checkedItems, notes)
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [checkedItems, notes, debouncedSave])

  if (!results || !results.pallets) return null

  const handleItemCheck = (itemKey) => {
    setCheckedItems(prev => ({
      ...prev,
      [itemKey]: !prev[itemKey]
    }))

    // Haptic feedback on mobile (if supported)
    if (navigator.vibrate) {
      navigator.vibrate(50)
    }
  }

  const handleNotesChange = (palletNumber, value) => {
    setNotes(prev => ({
      ...prev,
      [palletNumber]: value
    }))
  }

  const handleResetChecklist = () => {
    if (confirm('Reset all progress? This will clear all checked items and notes.')) {
      setCheckedItems({})
      setNotes({})
      if (quoteNumber) {
        clearChecklist(quoteNumber)
      }
    }
  }

  // Calculate overall progress
  const totalItems = results.pallets.reduce((sum, p) => 
    sum + (p.items?.length || 0), 0
  )
  const checkedCount = Object.values(checkedItems).filter(Boolean).length
  const progressPercent = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0
  const allComplete = progressPercent === 100

  // Check if any notes exist
  const hasNotes = Object.values(notes).some(n => n && n.trim())

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: '#f1f5f9',
      zIndex: 1000,
      overflow: 'auto',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        background: allComplete ? '#166534' : '#1e293b',
        color: 'white',
        padding: '16px 20px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        transition: 'background 0.3s ease',
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          maxWidth: '800px',
          margin: '0 auto',
        }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
              {allComplete ? '✓ PACKING COMPLETE' : 'WAREHOUSE PACKING'}
            </div>
            <div style={{ fontSize: '14px', opacity: 0.9, marginTop: '4px' }}>
              {quoteNumber && <span style={{ marginRight: '12px' }}>{quoteNumber}</span>}
              {checkedCount} of {totalItems} items packed
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleResetChecklist}
              style={{
                padding: '12px 16px',
                background: 'rgba(255,255,255,0.15)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              🔄 Reset
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '12px 24px',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          maxWidth: '800px',
          margin: '12px auto 0',
        }}>
          <div style={{
            height: '12px',
            background: 'rgba(255,255,255,0.3)',
            borderRadius: '6px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: allComplete ? '#86efac' : '#60a5fa',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {/* Resume banner */}
      {isResuming && (
        <div style={{
          maxWidth: '800px',
          margin: '12px auto 0',
          padding: '0 20px',
        }}>
          <div style={{
            padding: '12px 16px',
            background: '#dbeafe',
            border: '1px solid #93c5fd',
            borderRadius: '8px',
            color: '#1e40af',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>
              📂 Resuming packing for {quoteNumber}
              {resumeTime && (
                <span style={{ marginLeft: '8px', opacity: 0.8 }}>
                  (last saved {new Date(resumeTime).toLocaleString()})
                </span>
              )}
            </span>
            <button
              onClick={() => setIsResuming(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#1e40af',
                cursor: 'pointer',
                fontSize: '18px',
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{
        maxWidth: '800px',
        margin: '20px auto',
        padding: '0 20px',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginBottom: '20px',
        }}>
          {[
            { label: 'Pallets', value: results.totalPallets, color: '#2563eb' },
            { label: 'Total Lbs', value: results.totalWeight?.toLocaleString(), color: '#7c3aed' },
            { label: 'Items', value: results.totalItems, color: '#059669' },
            { label: 'Ship', value: results.shippingMethod, color: '#dc2626' },
          ].map((stat, idx) => (
            <div key={idx} style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: stat.color }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Notes indicator */}
        {hasNotes && (
          <div style={{
            padding: '12px 16px',
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            marginBottom: '20px',
            color: '#92400e',
            fontSize: '14px',
          }}>
            ⚠️ <strong>Warehouse notes attached</strong> — Review before shipping
          </div>
        )}

        {/* Completion celebration */}
        {allComplete && (
          <div style={{
            padding: '24px',
            background: 'linear-gradient(135deg, #dcfce7 0%, #86efac 100%)',
            border: '2px solid #22c55e',
            borderRadius: '12px',
            marginBottom: '20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
            <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#166534' }}>
              READY TO SHIP
            </div>
            <div style={{ color: '#166534', marginTop: '8px' }}>
              All {totalItems} items packed on {results.totalPallets} pallets
            </div>
            <button
              onClick={() => window.print()}
              style={{
                marginTop: '16px',
                padding: '12px 24px',
                background: '#166534',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              🖨️ Print Confirmation
            </button>
          </div>
        )}

        {/* Pallet Cards */}
        {results.pallets.map((pallet, idx) => (
          <PalletCard
            key={pallet.id || idx}
            pallet={pallet}
            palletNumber={idx + 1}
            totalPallets={results.totalPallets}
            onItemCheck={handleItemCheck}
            checkedItems={checkedItems}
            notes={notes}
            onNotesChange={handleNotesChange}
          />
        ))}

        {/* Bottom padding for scrolling */}
        <div style={{ height: '100px' }} />
      </div>
    </div>
  )
}
