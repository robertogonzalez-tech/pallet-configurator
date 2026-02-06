/**
 * TextPackingOutput Component
 * 
 * Displays ASCII-formatted packing instructions with:
 * - Scrollable monospace text output
 * - Print and Copy to Clipboard buttons
 * - Pallet navigation
 * - Warning highlights
 */

import { useMemo, useRef, useState } from 'react'
import { generatePackingSlip, downloadPackingSlip } from './packingSlipGenerator'

// Styles for print
const printStyles = `
@media print {
  body * {
    visibility: hidden;
  }
  .text-packing-output, .text-packing-output * {
    visibility: visible;
  }
  .text-packing-output {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    background: white !important;
    color: black !important;
  }
  .text-packing-output pre {
    background: white !important;
    color: black !important;
    font-size: 10pt !important;
  }
  .no-print {
    display: none !important;
  }
}
`

export default function TextPackingOutput({ results, quoteNumber }) {
  const [copied, setCopied] = useState(false)
  const textRef = useRef(null)
  
  // Generate the packing slip text
  const packingText = useMemo(() => {
    if (!results || !results.pallets) return ''
    
    const orderInfo = {
      quoteNumber: quoteNumber || null,
      shippingMethod: results.shippingMethod,
      totalItems: results.totalItems,
    }
    
    return generatePackingSlip(results.pallets, orderInfo)
  }, [results, quoteNumber])
  
  // Check for warnings
  const hasWarnings = useMemo(() => {
    return results?.pallets?.some(p => 
      p.items?.some(i => i.isUnknown) || 
      !p.dims
    )
  }, [results])
  
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(packingText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = packingText
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  
  const handlePrint = () => {
    window.print()
  }
  
  const handleDownload = () => {
    downloadPackingSlip(packingText, quoteNumber)
  }
  
  const scrollToPallet = (palletNum) => {
    if (!textRef.current) return
    
    // Find the pallet section in the text
    const searchStr = `PALLET ${palletNum} of`
    const text = textRef.current.textContent
    const index = text.indexOf(searchStr)
    
    if (index === -1) return
    
    // Calculate approximate scroll position
    const lineHeight = 18 // Approximate line height in pixels
    const charsPerLine = 65
    const linesBeforePallet = Math.floor(index / charsPerLine)
    const scrollTop = linesBeforePallet * lineHeight
    
    textRef.current.scrollTop = Math.max(0, scrollTop - 50)
  }
  
  if (!results || !results.pallets || results.pallets.length === 0) {
    return null
  }
  
  return (
    <>
      <style>{printStyles}</style>
      
      <div className="text-packing-output" style={{
        marginBottom: '20px',
      }}>
        {/* Action buttons */}
        <div className="no-print" style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '12px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <button
            onClick={handlePrint}
            style={{
              padding: '10px 20px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            🖨️ Print Packing Slip
          </button>
          
          <button
            onClick={handleCopy}
            style={{
              padding: '10px 20px',
              background: copied ? '#16a34a' : '#059669',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background 0.2s',
            }}
          >
            {copied ? '✓ Copied!' : '📋 Copy to Clipboard'}
          </button>
          
          <button
            onClick={handleDownload}
            style={{
              padding: '10px 20px',
              background: '#7c3aed',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            📥 Download .txt
          </button>
        </div>
        
        {/* Pallet navigation */}
        <div className="no-print" style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '12px',
          flexWrap: 'wrap',
        }}>
          <span style={{
            padding: '8px 12px',
            color: '#6b7280',
            fontSize: '0.875rem',
            fontWeight: '500',
          }}>
            Jump to:
          </span>
          {results.pallets.map((pallet, idx) => (
            <button
              key={pallet.id || idx}
              onClick={() => scrollToPallet(idx + 1)}
              style={{
                padding: '8px 14px',
                background: '#f3f4f6',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '500',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              📦 Pallet {idx + 1}
            </button>
          ))}
        </div>
        
        {/* Warning banner */}
        {hasWarnings && (
          <div className="no-print" style={{
            marginBottom: '12px',
            padding: '12px 16px',
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            color: '#92400e',
            fontSize: '0.875rem',
          }}>
            <strong>⚠️ Warning:</strong> This order contains items with unverified dimensions. 
            Review highlighted items before shipping.
          </div>
        )}
        
        {/* Text output */}
        <pre
          ref={textRef}
          style={{
            fontFamily: '"SF Mono", "Monaco", "Inconsolata", "Fira Mono", "Droid Sans Mono", "Source Code Pro", monospace',
            fontSize: '13px',
            lineHeight: '1.5',
            background: '#1e293b',
            color: '#e2e8f0',
            padding: '20px',
            borderRadius: '8px',
            overflow: 'auto',
            maxHeight: '600px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {packingText}
        </pre>
        
        {/* Summary bar */}
        <div className="no-print" style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '12px',
          padding: '8px 16px',
          background: '#f3f4f6',
          borderRadius: '6px',
          fontSize: '0.875rem',
          color: '#6b7280',
        }}>
          <span>
            {results.totalPallets} pallet{results.totalPallets !== 1 ? 's' : ''} • 
            {results.totalWeight?.toLocaleString()} lbs • 
            {results.shippingMethod}
          </span>
          <span>
            {quoteNumber || 'Manual Order'}
          </span>
        </div>
      </div>
    </>
  )
}
