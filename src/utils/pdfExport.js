/**
 * PDF Export Utility
 * 
 * Generates downloadable PDF packing slips using html2canvas + jsPDF.
 * Works offline (no server dependency).
 */

import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

/**
 * Generate a PDF from the packing slip data
 * @param {Object} results - Packing results with pallets array
 * @param {string} quoteNumber - Quote number for filename
 * @param {Function} onProgress - Optional progress callback (0-100)
 * @returns {Promise<void>}
 */
export async function generatePDF(results, quoteNumber, onProgress) {
  if (!results || !results.pallets || results.pallets.length === 0) {
    throw new Error('No pallet data to export')
  }

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter'
  })

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const margin = 40
  const contentWidth = pageWidth - (margin * 2)

  // Format date
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })

  // Helper to add footer to each page
  const addFooter = (pageNum, totalPages) => {
    pdf.setFontSize(9)
    pdf.setTextColor(100)
    pdf.text(
      `${quoteNumber || 'Packing Slip'} | ${dateStr} | Page ${pageNum} of ${totalPages}`,
      pageWidth / 2,
      pageHeight - 20,
      { align: 'center' }
    )
  }

  // Helper to draw a line
  const drawLine = (y, color = '#000000') => {
    pdf.setDrawColor(color)
    pdf.line(margin, y, pageWidth - margin, y)
  }

  // ===== PAGE 1: SUMMARY =====
  let yPos = margin

  // Header
  pdf.setFontSize(24)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0)
  pdf.text('PACKING SLIP', margin, yPos + 24)

  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(100)
  pdf.text('Ground Control Systems', margin, yPos + 40)

  // Quote number and date (right aligned)
  if (quoteNumber) {
    pdf.setFontSize(14)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(0)
    pdf.text(quoteNumber, pageWidth - margin, yPos + 24, { align: 'right' })
  }
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(100)
  pdf.text(dateStr, pageWidth - margin, yPos + 40, { align: 'right' })

  yPos += 60
  drawLine(yPos)
  yPos += 20

  // Summary boxes
  const summaryData = [
    { label: 'PALLETS', value: results.totalPallets.toString() },
    { label: 'TOTAL LBS', value: results.totalWeight?.toLocaleString() || '0' },
    { label: 'ITEMS', value: results.totalItems?.toString() || '0' },
    { label: 'SHIP METHOD', value: results.shippingMethod || 'LTL' }
  ]

  const boxWidth = (contentWidth - 30) / 4
  const boxHeight = 60

  pdf.setFillColor(241, 245, 249) // #f1f5f9
  pdf.rect(margin, yPos, contentWidth, boxHeight, 'F')

  summaryData.forEach((item, idx) => {
    const boxX = margin + (idx * (boxWidth + 10))
    
    // Value
    pdf.setFontSize(20)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(0)
    pdf.text(item.value, boxX + boxWidth / 2, yPos + 25, { align: 'center' })
    
    // Label
    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(100)
    pdf.text(item.label, boxX + boxWidth / 2, yPos + 45, { align: 'center' })
  })

  yPos += boxHeight + 20

  // Pallet overview table
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(0)
  pdf.text('Pallet Overview', margin, yPos)
  yPos += 15

  // Table header
  const colWidths = [60, 180, 80, 80, 80]
  const headers = ['Pallet', 'Contents', 'Weight', 'Dims', 'Items']
  
  pdf.setFillColor(30, 41, 59) // #1e293b
  pdf.rect(margin, yPos, contentWidth, 20, 'F')
  
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(255)
  let colX = margin + 5
  headers.forEach((header, idx) => {
    pdf.text(header, colX, yPos + 14)
    colX += colWidths[idx]
  })
  yPos += 20

  // Table rows
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(0)

  results.pallets.forEach((pallet, idx) => {
    const rowHeight = 22
    
    // Alternate row colors
    if (idx % 2 === 0) {
      pdf.setFillColor(248, 250, 252) // #f8fafc
      pdf.rect(margin, yPos, contentWidth, rowHeight, 'F')
    }

    colX = margin + 5
    pdf.setFontSize(9)

    // Pallet number
    pdf.setFont('helvetica', 'bold')
    pdf.text(`${idx + 1} of ${results.totalPallets}`, colX, yPos + 15)
    colX += colWidths[0]

    // Contents (truncated)
    pdf.setFont('helvetica', 'normal')
    const contents = pallet.items?.map(i => `${i.qty}× ${i.displayName || i.name || i.sku}`.substring(0, 20)).join(', ') || ''
    const truncatedContents = contents.length > 35 ? contents.substring(0, 32) + '...' : contents
    pdf.text(truncatedContents, colX, yPos + 15)
    colX += colWidths[1]

    // Weight
    pdf.text(`${pallet.weight?.toLocaleString() || 0} lbs`, colX, yPos + 15)
    colX += colWidths[2]

    // Dims
    const dims = pallet.dims || [48, 40, 48]
    pdf.text(`${dims[0]}×${dims[1]}×${dims[2]}"`, colX, yPos + 15)
    colX += colWidths[3]

    // Item count
    const itemCount = pallet.items?.reduce((sum, i) => sum + (i.qty || 1), 0) || 0
    pdf.text(itemCount.toString(), colX, yPos + 15)

    yPos += rowHeight

    // Check if we need a new page (leave room for more rows)
    if (yPos > pageHeight - 100 && idx < results.pallets.length - 1) {
      pdf.addPage()
      yPos = margin
    }
  })

  // ===== SUBSEQUENT PAGES: ONE PALLET PER PAGE =====
  const totalPages = 1 + results.pallets.length
  
  for (let palletIdx = 0; palletIdx < results.pallets.length; palletIdx++) {
    const pallet = results.pallets[palletIdx]
    
    // Progress callback
    if (onProgress) {
      onProgress(Math.round(((palletIdx + 1) / results.pallets.length) * 100))
    }

    pdf.addPage()
    yPos = margin

    // Pallet header
    pdf.setFillColor(30, 41, 59) // #1e293b
    pdf.rect(margin, yPos, contentWidth, 50, 'F')

    pdf.setFontSize(18)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(255)
    pdf.text(`PALLET ${palletIdx + 1} of ${results.totalPallets}`, margin + 15, yPos + 30)

    // Weight and dims (right side)
    pdf.setFontSize(14)
    pdf.text(`${pallet.weight?.toLocaleString() || 0} lbs`, pageWidth - margin - 15, yPos + 22, { align: 'right' })
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'normal')
    const dims = pallet.dims || [48, 40, 48]
    pdf.text(`${dims[0]}" × ${dims[1]}" × ${dims[2]}"`, pageWidth - margin - 15, yPos + 38, { align: 'right' })

    yPos += 60

    // Stacking instruction
    pdf.setFillColor(254, 243, 199) // #fef3c7
    pdf.rect(margin, yPos, contentWidth, 35, 'F')
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(146, 64, 14) // #92400e
    pdf.text('⚠️ STACKING ORDER (Bottom → Top)', margin + 10, yPos + 15)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('Place heaviest items on bottom. Stack in order listed below.', margin + 10, yPos + 27)

    yPos += 45

    // Items table header
    const itemColWidths = [30, 50, 280, 70, 50]
    const itemHeaders = ['#', 'QTY', 'ITEM', 'WEIGHT', '✓']

    pdf.setFillColor(241, 245, 249) // #f1f5f9
    pdf.rect(margin, yPos, contentWidth, 22, 'F')
    
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(0)
    colX = margin + 5
    itemHeaders.forEach((header, idx) => {
      const align = idx === 1 || idx === 4 ? 'center' : idx === 3 ? 'right' : 'left'
      const xOffset = align === 'center' ? itemColWidths[idx] / 2 : align === 'right' ? itemColWidths[idx] - 5 : 0
      pdf.text(header, colX + xOffset, yPos + 15, { align })
      colX += itemColWidths[idx]
    })
    
    // Draw header bottom border
    pdf.setDrawColor(0)
    pdf.setLineWidth(1)
    pdf.line(margin, yPos + 22, pageWidth - margin, yPos + 22)
    yPos += 24

    // Sort items by weight (heaviest first = bottom of pallet)
    const sortedItems = [...(pallet.items || [])].sort((a, b) => {
      const weightA = (a.weight || 50) * (a.qty || 1)
      const weightB = (b.weight || 50) * (b.qty || 1)
      return weightB - weightA
    })

    // Items rows
    pdf.setFont('helvetica', 'normal')
    sortedItems.forEach((item, itemIdx) => {
      const rowHeight = 35
      
      // Alternate row colors
      if (itemIdx % 2 === 0) {
        pdf.setFillColor(248, 250, 252) // #f8fafc
        pdf.rect(margin, yPos, contentWidth, rowHeight, 'F')
      }

      colX = margin + 5
      const rowMidY = yPos + rowHeight / 2 + 4

      // Row number
      pdf.setFontSize(9)
      pdf.setTextColor(100)
      pdf.text((itemIdx + 1).toString(), colX, rowMidY)
      colX += itemColWidths[0]

      // Quantity
      pdf.setFontSize(14)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(0)
      pdf.text((item.qty || 1).toString(), colX + itemColWidths[1] / 2, rowMidY, { align: 'center' })
      colX += itemColWidths[1]

      // Item name and SKU
      pdf.setFontSize(10)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(0)
      const itemName = item.displayName || item.name || item.sku || 'Product'
      pdf.text(itemName.substring(0, 45), colX, yPos + 14)
      
      pdf.setFontSize(8)
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(100)
      pdf.text(item.sku || '', colX, yPos + 26)
      colX += itemColWidths[2]

      // Weight
      pdf.setFontSize(9)
      pdf.setTextColor(0)
      const totalWeight = ((item.weight || 50) * (item.qty || 1))
      pdf.text(`${totalWeight.toLocaleString()} lbs`, colX + itemColWidths[3] - 5, rowMidY, { align: 'right' })
      colX += itemColWidths[3]

      // Checkbox
      const checkboxSize = 16
      const checkboxX = colX + (itemColWidths[4] - checkboxSize) / 2
      const checkboxY = yPos + (rowHeight - checkboxSize) / 2
      pdf.setDrawColor(0)
      pdf.setLineWidth(1)
      pdf.rect(checkboxX, checkboxY, checkboxSize, checkboxSize)

      // Row bottom border
      pdf.setDrawColor(226, 232, 240) // #e2e8f0
      pdf.setLineWidth(0.5)
      pdf.line(margin, yPos + rowHeight, pageWidth - margin, yPos + rowHeight)

      yPos += rowHeight
    })

    // Pallet total row
    pdf.setFillColor(241, 245, 249) // #f1f5f9
    pdf.rect(margin, yPos, contentWidth, 25, 'F')
    pdf.setFontSize(10)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(0)
    pdf.text('PALLET TOTAL:', margin + 250, yPos + 17, { align: 'right' })
    pdf.text(`${pallet.weight?.toLocaleString() || 0} lbs`, margin + 350, yPos + 17, { align: 'right' })

    yPos += 35

    // Notes section
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(10)
    pdf.text('Notes:', margin, yPos)
    yPos += 5
    
    pdf.setDrawColor(203, 213, 225) // #cbd5e1
    pdf.setFillColor(255)
    pdf.rect(margin, yPos, contentWidth, 60, 'FD')
  }

  // Add footers to all pages
  const pageCount = pdf.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i)
    addFooter(i, pageCount)
  }

  // Generate filename
  const dateForFile = today.toISOString().split('T')[0]
  const filename = `packing-slip-${quoteNumber || 'order'}-${dateForFile}.pdf`

  // Download
  pdf.save(filename)
}

/**
 * Check if PDF generation is supported
 */
export function isPDFSupported() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}
