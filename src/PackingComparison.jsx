import { useState, useMemo } from 'react'
import { packItems, PACKING_CONFIG } from './binPacking3D'

/**
 * PackingComparison - Compare different packing strategies side by side
 * Helps users understand algorithm decisions and choose optimal packing
 */

export default function PackingComparison({ items, options = {}, onSelect, onClose }) {
  const [selectedStrategy, setSelectedStrategy] = useState(null)
  
  // Run all strategies and collect results
  const strategies = useMemo(() => {
    if (!items || items.length === 0) return []
    
    const results = []
    const strategyNames = ['volume', 'height', 'footprint', 'weight']
    
    for (const strategy of strategyNames) {
      try {
        // Run packing with single strategy (disable multi-pass)
        const pallets = packItems(items, {
          ...options,
          multiPass: false,
          sortStrategy: strategy,
        })
        
        const totalVolume = pallets.reduce((sum, p) => {
          return sum + (p.metrics?.volumeUsed || 0)
        }, 0)
        
        const avgUtilization = pallets.reduce((sum, p) => {
          const util = parseFloat(p.metrics?.utilization) || 0
          return sum + util
        }, 0) / pallets.length
        
        const maxHeight = Math.max(...pallets.map(p => p.metrics?.height || 0))
        
        results.push({
          strategy,
          pallets,
          palletCount: pallets.length,
          totalVolume,
          avgUtilization: avgUtilization.toFixed(1),
          maxHeight: maxHeight.toFixed(0),
          totalWeight: pallets.reduce((sum, p) => sum + (p.metrics?.weight || 0), 0),
        })
      } catch (err) {
        console.error(`Strategy ${strategy} failed:`, err)
      }
    }
    
    // Sort by pallet count (ascending), then by utilization (descending)
    results.sort((a, b) => {
      if (a.palletCount !== b.palletCount) return a.palletCount - b.palletCount
      return parseFloat(b.avgUtilization) - parseFloat(a.avgUtilization)
    })
    
    return results
  }, [items, options])
  
  // Best result (fewest pallets, highest utilization)
  const bestStrategy = strategies[0]
  
  const handleSelect = (result) => {
    setSelectedStrategy(result.strategy)
    if (onSelect) {
      onSelect(result.pallets, result.strategy)
    }
  }
  
  const strategyDescriptions = {
    volume: 'Largest items first by total volume',
    height: 'Tallest items first, then by volume',
    footprint: 'Largest footprint first (fills layers)',
    weight: 'Heaviest items first (stability)',
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
        maxWidth: '800px',
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
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              🔄 Compare Packing Strategies
            </h2>
            <p style={{ margin: '4px 0 0 0', color: '#6b7280', fontSize: '0.9rem' }}>
              {items?.length || 0} item types, {items?.reduce((sum, i) => sum + (i.qty || 1), 0) || 0} total units
            </p>
          </div>
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
          {/* Strategy Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '16px',
            marginBottom: '20px',
          }}>
            {strategies.map((result, idx) => {
              const isBest = idx === 0
              const isSelected = selectedStrategy === result.strategy
              
              return (
                <div
                  key={result.strategy}
                  onClick={() => handleSelect(result)}
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: isSelected 
                      ? '2px solid #2563eb' 
                      : isBest 
                        ? '2px solid #059669'
                        : '1px solid #e5e7eb',
                    background: isSelected 
                      ? '#EFF6FF' 
                      : isBest 
                        ? '#ECFDF5'
                        : 'white',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    position: 'relative',
                  }}
                >
                  {isBest && (
                    <div style={{
                      position: 'absolute',
                      top: '-8px',
                      right: '12px',
                      background: '#059669',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: '600',
                    }}>
                      BEST
                    </div>
                  )}
                  
                  <div style={{
                    fontWeight: '600',
                    marginBottom: '8px',
                    textTransform: 'capitalize',
                    color: isSelected ? '#2563eb' : '#1f2937',
                  }}>
                    {result.strategy}
                  </div>
                  
                  <div style={{
                    fontSize: '2rem',
                    fontWeight: '700',
                    color: isBest ? '#059669' : '#374151',
                    marginBottom: '4px',
                  }}>
                    {result.palletCount}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '12px' }}>
                    {result.palletCount === 1 ? 'pallet' : 'pallets'}
                  </div>
                  
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    fontSize: '0.8rem',
                  }}>
                    <div>
                      <div style={{ color: '#9ca3af' }}>Utilization</div>
                      <div style={{ fontWeight: '500' }}>{result.avgUtilization}%</div>
                    </div>
                    <div>
                      <div style={{ color: '#9ca3af' }}>Max Height</div>
                      <div style={{ fontWeight: '500' }}>{result.maxHeight}"</div>
                    </div>
                  </div>
                  
                  <div style={{
                    marginTop: '12px',
                    fontSize: '0.75rem',
                    color: '#6b7280',
                    fontStyle: 'italic',
                  }}>
                    {strategyDescriptions[result.strategy]}
                  </div>
                </div>
              )
            })}
          </div>
          
          {/* Comparison Table */}
          {strategies.length > 0 && (
            <div style={{
              overflowX: 'auto',
              marginBottom: '20px',
            }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.85rem',
              }}>
                <thead>
                  <tr style={{ background: '#f9fafb' }}>
                    <th style={{ padding: '10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Strategy</th>
                    <th style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Pallets</th>
                    <th style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Utilization</th>
                    <th style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Max Height</th>
                    <th style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Total Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {strategies.map((result, idx) => (
                    <tr 
                      key={result.strategy}
                      style={{ 
                        background: selectedStrategy === result.strategy ? '#EFF6FF' : idx === 0 ? '#ECFDF5' : 'white',
                      }}
                    >
                      <td style={{ padding: '10px', borderBottom: '1px solid #e5e7eb', fontWeight: '500', textTransform: 'capitalize' }}>
                        {result.strategy}
                        {idx === 0 && <span style={{ marginLeft: '8px', color: '#059669' }}>✓</span>}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb', fontWeight: '600' }}>
                        {result.palletCount}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                        {result.avgUtilization}%
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                        {result.maxHeight}"
                      </td>
                      <td style={{ padding: '10px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>
                        {result.totalWeight.toLocaleString()} lbs
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                border: 'none',
                borderRadius: '6px',
                fontWeight: '500',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (bestStrategy) {
                  handleSelect(bestStrategy)
                  onClose()
                }
              }}
              style={{
                padding: '10px 20px',
                background: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Use Best ({bestStrategy?.palletCount} pallets)
            </button>
          </div>
        </div>
        
        {/* Info Footer */}
        <div style={{
          padding: '12px 20px',
          background: '#f9fafb',
          borderTop: '1px solid #e5e7eb',
          fontSize: '0.8rem',
          color: '#6b7280',
        }}>
          💡 The algorithm automatically picks the best strategy. Use this view to understand why, or to override if you know better.
        </div>
      </div>
    </div>
  )
}
