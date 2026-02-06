/**
 * PackingSlip Component
 * 
 * Print-friendly packing slip for warehouse.
 * Shows pallet-by-pallet breakdown with items, quantities, and stacking order.
 * Includes PDF export functionality.
 */

import { useMemo, useState } from 'react'
import { generatePDF, isPDFSupported } from './utils/pdfExport'

// Print styles - injected when printing
const printStyles = `
@media print {
  body * {
    visibility: hidden;
  }
  .packing-slip, .packing-slip * {
    visibility: visible;
  }
  .packing-slip {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
  }
  .no-print {
    display: none !important;
  }
  .page-break {
    page-break-before: always;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
`

// Format date for slip
function formatDate(date = new Date()) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Single pallet section
function PalletSection({ pallet, palletNumber, totalPallets }) {
  // Get items sorted by stacking order (heavy/large on bottom)
  const sortedItems = useMemo(() => {
    if (!pallet.items) return []
    return [...pallet.items].sort((a, b) => {
      const weightA = (a.weight || 50) * (a.qty || 1)
      const weightB = (b.weight || 50) * (b.qty || 1)
      return weightB - weightA // Heavy first (bottom of pallet)
    })
  }, [pallet.items])

  return (
    <div style={{
      border: '2px solid #000',
      marginBottom: '20px',
      pageBreakInside: 'avoid',
    }}>
      {/* Pallet Header */}
      <div style={{
        background: '#1e293b',
        color: 'white',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
          PALLET {palletNumber} of {totalPallets}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
            {pallet.weight?.toLocaleString()} lbs
          </div>
          <div style={{ fontSize: '14px', opacity: 0.9 }}>
            {pallet.dims?.[0] || 48}" × {pallet.dims?.[1] || 40}" × {pallet.dims?.[2] || 48}"
          </div>
        </div>
      </div>

      {/* Stacking Instructions */}
      <div style={{
        padding: '12px 16px',
        background: '#fef3c7',
        borderBottom: '1px solid #000',
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          ⚠️ STACKING ORDER (Bottom → Top)
        </div>
        <div style={{ fontSize: '12px', color: '#92400e' }}>
          Place heaviest items on bottom. Stack in order listed below.
        </div>
      </div>

      {/* Items Table */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '14px',
      }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            <th style={{ 
              padding: '10px', 
              textAlign: 'left', 
              borderBottom: '2px solid #000',
              width: '40px',
            }}>
              #
            </th>
            <th style={{ 
              padding: '10px', 
              textAlign: 'center', 
              borderBottom: '2px solid #000',
              width: '60px',
            }}>
              QTY
            </th>
            <th style={{ 
              padding: '10px', 
              textAlign: 'left', 
              borderBottom: '2px solid #000',
            }}>
              ITEM
            </th>
            <th style={{ 
              padding: '10px', 
              textAlign: 'right', 
              borderBottom: '2px solid #000',
              width: '80px',
            }}>
              WEIGHT
            </th>
            <th style={{ 
              padding: '10px', 
              textAlign: 'center', 
              borderBottom: '2px solid #000',
              width: '60px',
            }}>
              ✓
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedItems.map((item, idx) => (
            <tr key={idx} style={{
              background: idx % 2 === 0 ? 'white' : '#f8fafc',
            }}>
              <td style={{ 
                padding: '10px', 
                borderBottom: '1px solid #e2e8f0',
                fontWeight: 'bold',
                color: '#64748b',
              }}>
                {idx + 1}
              </td>
              <td style={{ 
                padding: '10px', 
                textAlign: 'center',
                borderBottom: '1px solid #e2e8f0',
                fontWeight: 'bold',
                fontSize: '18px',
              }}>
                {item.qty || 1}
              </td>
              <td style={{ 
                padding: '10px', 
                borderBottom: '1px solid #e2e8f0',
              }}>
                <div style={{ fontWeight: '600' }}>
                  {item.displayName || item.name || item.sku}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {item.sku}
                </div>
              </td>
              <td style={{ 
                padding: '10px', 
                textAlign: 'right',
                borderBottom: '1px solid #e2e8f0',
              }}>
                {((item.weight || 50) * (item.qty || 1)).toLocaleString()} lbs
              </td>
              <td style={{ 
                padding: '10px', 
                textAlign: 'center',
                borderBottom: '1px solid #e2e8f0',
              }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  border: '2px solid #000',
                  margin: '0 auto',
                }} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f1f5f9', fontWeight: 'bold' }}>
            <td colSpan={3} style={{ padding: '10px', textAlign: 'right' }}>
              PALLET TOTAL:
            </td>
            <td style={{ padding: '10px', textAlign: 'right' }}>
              {pallet.weight?.toLocaleString()} lbs
            </td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* Notes section */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid #000',
        background: '#f8fafc',
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>Notes:</div>
        <div style={{ 
          minHeight: '40px', 
          border: '1px solid #cbd5e1',
          background: 'white',
          padding: '8px',
        }} />
      </div>
    </div>
  )
}

// Main PackingSlip component
export default function PackingSlip({ results, quoteNumber, onClose }) {
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfProgress, setPdfProgress] = useState(0)
  const [pdfError, setPdfError] = useState(null)

  if (!results || !results.pallets) return null

  const handlePrint = () => {
    window.print()
  }

  const handleDownloadPDF = async () => {
    if (!isPDFSupported()) {
      setPdfError('PDF generation is not supported in this browser')
      return
    }

    setPdfLoading(true)
    setPdfProgress(0)
    setPdfError(null)

    try {
      await generatePDF(results, quoteNumber, (progress) => {
        setPdfProgress(progress)
      })
    } catch (err) {
      console.error('PDF generation failed:', err)
      setPdfError(err.message || 'Failed to generate PDF')
    } finally {
      setPdfLoading(false)
      setPdfProgress(0)
    }
  }

  return (
    <>
      {/* Inject print styles */}
      <style>{printStyles}</style>

      <div className="packing-slip" style={{
        fontFamily: 'Arial, sans-serif',
        maxWidth: '800px',
        margin: '0 auto',
        padding: '20px',
        background: 'white',
      }}>
        {/* Header - visible on print */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '20px',
          paddingBottom: '20px',
          borderBottom: '3px solid #000',
        }}>
          <div>
            <div style={{ fontSize: '28px', fontWeight: 'bold' }}>
              PACKING SLIP
            </div>
            <div style={{ fontSize: '14px', color: '#64748b', marginTop: '4px' }}>
              Ground Control Systems
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {quoteNumber && (
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                {quoteNumber}
              </div>
            )}
            <div style={{ fontSize: '14px', color: '#64748b' }}>
              {formatDate()}
            </div>
          </div>
        </div>

        {/* Summary */}
        <div style={{
          display: 'flex',
          gap: '20px',
          marginBottom: '20px',
          padding: '16px',
          background: '#f1f5f9',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
        }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
              {results.totalPallets}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>
              Pallets
            </div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
              {results.totalWeight?.toLocaleString()}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>
              Total lbs
            </div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
              {results.totalItems}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>
              Total Items
            </div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '32px', fontWeight: 'bold' }}>
              {results.shippingMethod}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase' }}>
              Ship Method
            </div>
          </div>
        </div>

        {/* Action buttons - hidden on print */}
        <div className="no-print" style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '20px',
          flexWrap: 'wrap',
        }}>
          <button
            onClick={handleDownloadPDF}
            disabled={pdfLoading}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '12px 24px',
              background: pdfLoading ? '#9ca3af' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: pdfLoading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {pdfLoading ? (
              <>
                <span style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  border: '2px solid white',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
                Generating PDF... {pdfProgress > 0 && `${pdfProgress}%`}
              </>
            ) : (
              <>📥 Download PDF</>
            )}
          </button>
          <button
            onClick={handlePrint}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '12px 24px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            🖨️ Print Packing Slip
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '12px 24px',
                background: '#f1f5f9',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontSize: '16px',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          )}
        </div>

        {/* PDF Error message */}
        {pdfError && (
          <div className="no-print" style={{
            padding: '12px 16px',
            background: '#fef2f2',
            color: '#dc2626',
            borderRadius: '8px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <span>⚠️</span>
            <span>{pdfError}</span>
            <button
              onClick={() => setPdfError(null)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: '#dc2626',
                cursor: 'pointer',
                fontSize: '18px',
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Pallet sections */}
        {results.pallets.map((pallet, idx) => (
          <PalletSection
            key={pallet.id || idx}
            pallet={pallet}
            palletNumber={idx + 1}
            totalPallets={results.totalPallets}
          />
        ))}

        {/* Footer */}
        <div style={{
          marginTop: '20px',
          paddingTop: '20px',
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '12px',
          color: '#64748b',
        }}>
          <div>Generated by GCS Pallet Configurator</div>
          <div>{formatDate()} {new Date().toLocaleTimeString()}</div>
        </div>
      </div>
    </>
  )
}
