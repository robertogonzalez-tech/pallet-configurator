import { useState } from 'react'
import { supabase, isSupabaseConfigured, getSupabaseStatus } from '../lib/supabase'

// Default pallet dimensions (all blank)
const DEFAULT_PALLET = {
  weight: '',
  length: '',
  width: '',
  height: '',
}

const VALIDATORS = ['Anisa', 'Avianna', 'Berto', 'Chad', 'Tristan']
const SHIPMENT_COMPLETENESS_OPTIONS = ['complete', 'partial', 'unknown']
const ACTUAL_UNIT_BASIS_OPTIONS = ['package_count', 'pallet_positions', 'unknown']

export default function ValidationForm() {
  // Form state
  const [soNumber, setSoNumber] = useState('')
  const [validatedBy, setValidatedBy] = useState('Chad')
  const [shipmentCompleteness, setShipmentCompleteness] = useState('complete')
  const [actualUnitBasis, setActualUnitBasis] = useState('package_count')
  const [actualPositions, setActualPositions] = useState('')
  const [notes, setNotes] = useState('')
  const [pallets, setPallets] = useState([{ ...DEFAULT_PALLET }])

  // UI state
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [prediction, setPrediction] = useState(null)

  // Feedback state — per-item corrections from Chad
  const [itemFeedback, setItemFeedback] = useState({})
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)

  const supabaseStatus = getSupabaseStatus()

  // Add a new pallet row
  const addPallet = () => {
    setPallets([...pallets, { ...DEFAULT_PALLET }])
  }

  // Remove a pallet row
  const removePallet = (index) => {
    if (pallets.length === 1) return
    setPallets(pallets.filter((_, i) => i !== index))
  }

  // Update a pallet field
  const updatePallet = (index, field, value) => {
    const updated = [...pallets]
    updated[index] = { ...updated[index], [field]: value }
    setPallets(updated)
  }

  // Calculate totals
  const totalPallets = pallets.length
  const totalWeight = pallets.reduce((sum, p) => sum + (parseFloat(p.weight) || 0), 0)

  // Validate form
  const validateForm = () => {
    if (!/^\d{4,}$/.test(soNumber)) {
      return 'Sales Order # must be at least 4 digits'
    }
    if (pallets.length === 0) {
      return 'At least one pallet is required'
    }
    for (let i = 0; i < pallets.length; i++) {
      const p = pallets[i]
      if (!p.weight || !p.length || !p.width || !p.height) {
        return `Pallet ${i + 1}: All fields are required`
      }
      if (parseFloat(p.weight) <= 0) {
        return `Pallet ${i + 1}: Weight must be greater than 0`
      }
    }
    if (!SHIPMENT_COMPLETENESS_OPTIONS.includes(shipmentCompleteness)) {
      return 'Shipment completeness is required'
    }
    if (!ACTUAL_UNIT_BASIS_OPTIONS.includes(actualUnitBasis)) {
      return 'Actual unit basis is required'
    }
    if (actualUnitBasis === 'pallet_positions') {
      if (!actualPositions) return 'Actual positions is required when basis is pallet_positions'
      if ((parseInt(actualPositions, 10) || 0) <= 0) return 'Actual positions must be greater than 0'
    } else if (actualPositions && (parseInt(actualPositions, 10) || 0) <= 0) {
      return 'Actual positions must be greater than 0'
    }
    return null
  }

  // Toggle item flagged as wrong
  const toggleItemFlag = (index) => {
    setItemFeedback(prev => {
      const current = prev[index] || {}
      return {
        ...prev,
        [index]: { ...current, flagged: !current.flagged }
      }
    })
  }

  // Update item correction note
  const updateItemNote = (index, note) => {
    setItemFeedback(prev => ({
      ...prev,
      [index]: { ...(prev[index] || {}), note, flagged: true }
    }))
  }

  // Update item actual pallet count
  const updateItemActualPallets = (index, count) => {
    setItemFeedback(prev => ({
      ...prev,
      [index]: { ...(prev[index] || {}), actualPallets: count, flagged: true }
    }))
  }

  // Submit corrections to Supabase
  const submitFeedback = async () => {
    const flaggedItems = Object.entries(itemFeedback).filter(([_, fb]) => fb.flagged)
    if (flaggedItems.length === 0) return

    setFeedbackSubmitting(true)
    try {
      const breakdown = success?.breakdown || []
      const corrections = flaggedItems.map(([idx, fb]) => {
        const item = breakdown[parseInt(idx)]
        return {
          validation_id: success?.validationId || null,
          sku: item?.sku || 'UNKNOWN',
          field: 'per_pallet',
          predicted_value: item?.pallets || 0,
          actual_value: fb.actualPallets != null ? parseFloat(fb.actualPallets) : null,
          notes: fb.note || null,
        }
      }).filter(c => c.sku !== 'UNKNOWN')

      if (corrections.length > 0 && supabase) {
        const { error: insertError } = await supabase.from('corrections').insert(corrections)
        if (insertError) {
          console.error('Corrections save error:', insertError)
        }
      }

      // Also update the validation record notes with correction summary
      if (success?.validationId && supabase) {
        const feedbackSummary = flaggedItems.map(([idx, fb]) => {
          const item = breakdown[parseInt(idx)]
          const parts = [`${item?.sku}: predicted ${item?.pallets} pallets`]
          if (fb.actualPallets != null) parts.push(`actual ${fb.actualPallets}`)
          if (fb.note) parts.push(`"${fb.note}"`)
          return parts.join(' — ')
        }).join('; ')

        await supabase
          .from('validations')
          .update({ notes: `${success?.existingNotes || ''}\n[CORRECTIONS] ${feedbackSummary}`.trim() })
          .eq('id', success.validationId)
      }

      setFeedbackSubmitted(true)
    } catch (err) {
      console.error('Feedback submit error:', err)
    } finally {
      setFeedbackSubmitting(false)
    }
  }

  // Submit validation
  const handleSubmit = async () => {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccess(null)
    setItemFeedback({})
    setFeedbackSubmitted(false)

    try {
      const response = await fetch('/api/validate-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soNumber: soNumber.trim(),
          validatedBy,
          shipmentCompleteness,
          actualUnitBasis,
          actualPositions: actualPositions ? parseInt(actualPositions, 10) : null,
          notes: notes.trim(),
          pallets: pallets.map((p, i) => ({
            palletNum: i + 1,
            weight: parseFloat(p.weight),
            length: parseFloat(p.length),
            width: parseFloat(p.width),
            height: parseFloat(p.height),
          })),
        }),
      })

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error || 'Failed to submit validation')
      }

      setPrediction(data)

      const palletVar = totalPallets - (data.predicted?.pallets || 0)
      setSuccess({
        validationId: data.validationId,
        soNumber: `SO${soNumber}`,
        actualPallets: totalPallets,
        actualWeight: totalWeight,
        predictedPallets: data.predicted?.pallets || 0,
        predictedWeight: data.predicted?.weight || 0,
        breakdown: data.predicted?.breakdown || [],
        variance: data.variance || {
          pallets: palletVar,
          weight: totalWeight - (data.predicted?.weight || 0),
        },
        severity: data.variance?.severity || 'unknown',
        diagnostics: data.diagnostics || null,
        existingNotes: notes.trim(),
      })

      // Clear form for next entry
      setSoNumber('')
      setShipmentCompleteness('complete')
      setActualUnitBasis('package_count')
      setActualPositions('')
      setNotes('')
      setPallets([{ ...DEFAULT_PALLET }])

    } catch (err) {
      console.error('Submit error:', err)
      setError(err.message || 'Failed to submit validation')
    } finally {
      setSubmitting(false)
    }
  }

  // Clear success message and start new validation
  const handleNewValidation = () => {
    setSuccess(null)
    setPrediction(null)
    setItemFeedback({})
    setFeedbackSubmitted(false)
  }

  const flaggedCount = Object.values(itemFeedback).filter(fb => fb.flagged).length

  return (
    <div className="validation-form-container">
      <div className="form-header">
        <h2>Validate Shipment</h2>
        <p className="subtitle">Enter actual pallet data from the shipping floor</p>

        {!supabaseStatus.configured && (
          <div className="warning-banner">
            Database not configured. Validations won't be saved.
          </div>
        )}
      </div>

      {/* ============ RESULTS VIEW (after submission) ============ */}
      {success && (
        <div className="results-container">

          {/* Header with SO# and status */}
          <div className="results-header">
            <div className="results-title-row">
              <h3>{success.soNumber} — Validation Results</h3>
              <span className="saved-badge">Saved</span>
            </div>
          </div>

          {/* Predicted vs Actual comparison */}
          <div className="comparison-card">
            <div className="comparison-grid">
              <div className="comparison-item predicted-side">
                <span className="comp-label">System Predicted</span>
                <span className="comp-pallets">{success.predictedPallets}</span>
                <span className="comp-unit">pallets</span>
                <span className="comp-weight">{success.predictedWeight.toLocaleString()} lbs</span>
              </div>
              <div className="comparison-vs">
                <div className={`variance-circle ${success.variance.pallets === 0 ? 'exact' : Math.abs(success.variance.pallets) <= 1 ? 'close' : Math.abs(success.variance.pallets) <= 2 ? 'over' : 'high'}`}>
                  {success.variance.pallets === 0
                    ? '\u2713'
                    : `${success.variance.pallets > 0 ? '+' : ''}${success.variance.pallets}`
                  }
                </div>
                <span className="variance-label">
                  {success.variance.pallets === 0
                    ? 'Exact Match'
                    : Math.abs(success.variance.pallets) <= 1
                    ? 'Close'
                    : `Off by ${Math.abs(success.variance.pallets)}`
                  }
                </span>
              </div>
              <div className="comparison-item actual-side">
                <span className="comp-label">You Counted</span>
                <span className="comp-pallets">{success.actualPallets}</span>
                <span className="comp-unit">pallets</span>
                <span className="comp-weight">{success.actualWeight.toLocaleString()} lbs</span>
              </div>
            </div>
          </div>

          {/* Diagnostics summary (collapsed) */}
          {success.diagnostics && (
            <div className="diagnostics-bar">
              <span className={`conf-pill conf-${success.diagnostics.confidenceLevel}`}>
                {success.diagnostics.confidenceScore}% confidence
              </span>
              <span className="diag-summary">
                {success.diagnostics.totalLines} lines &rarr; {success.diagnostics.filteredNonShippable + success.diagnostics.filteredHardware + success.diagnostics.filteredPackaging + success.diagnostics.filteredComponents} filtered, {success.diagnostics.knownProducts} known, {success.diagnostics.unknownProducts} unknown
              </span>
            </div>
          )}

          {/* ======= ITEM BREAKDOWN — the key feedback section ======= */}
          {success.breakdown && success.breakdown.length > 0 && (
            <div className="breakdown-section">
              <div className="breakdown-header">
                <h4>What the system counted</h4>
                <p className="breakdown-hint">
                  {feedbackSubmitted
                    ? `${flaggedCount} correction${flaggedCount !== 1 ? 's' : ''} saved \u2014 thank you!`
                    : 'Tap any item that looks wrong to flag it'
                  }
                </p>
              </div>

              <div className="breakdown-list">
                {success.breakdown.map((item, idx) => {
                  const fb = itemFeedback[idx] || {}
                  const isUnknown = item.matched === 'UNKNOWN'
                  return (
                    <div
                      key={idx}
                      className={`breakdown-item ${fb.flagged ? 'flagged' : ''} ${isUnknown ? 'unknown' : ''}`}
                    >
                      <div className="item-main" onClick={() => !feedbackSubmitted && toggleItemFlag(idx)}>
                        <div className="item-info">
                          <span className="item-sku">{item.sku}</span>
                          <span className="item-name">{item.name || item.matched}</span>
                        </div>
                        <div className="item-stats">
                          <span className="item-qty">qty {item.qty}</span>
                          <span className="item-arrow">&rarr;</span>
                          <span className="item-pallets">{item.pallets} pallet{item.pallets !== 1 ? 's' : ''}</span>
                          <span className="item-weight">{item.weight?.toLocaleString()} lbs</span>
                        </div>
                        <div className="item-family">
                          {isUnknown
                            ? <span className="family-unknown">Unknown product</span>
                            : <span className="family-known">{item.matched}</span>
                          }
                        </div>
                      </div>

                      {/* Expanded correction form when flagged */}
                      {fb.flagged && !feedbackSubmitted && (
                        <div className="item-correction">
                          <div className="correction-row">
                            <div className="correction-field">
                              <label>Actually needed:</label>
                              <div className="pallet-adjuster">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min="0"
                                  max="99"
                                  value={fb.actualPallets ?? ''}
                                  onChange={(e) => updateItemActualPallets(idx, e.target.value)}
                                  placeholder={String(item.pallets)}
                                  className="correction-input"
                                />
                                <span className="correction-unit">pallets</span>
                              </div>
                            </div>
                            <div className="correction-field note-field">
                              <label>What's wrong?</label>
                              <input
                                type="text"
                                value={fb.note || ''}
                                onChange={(e) => updateItemNote(idx, e.target.value)}
                                placeholder="e.g. These fit on 1 pallet, not 4"
                                className="correction-note"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Show saved correction */}
                      {fb.flagged && feedbackSubmitted && (
                        <div className="item-correction-saved">
                          Correction saved
                          {fb.actualPallets != null ? ` \u2014 actually ${fb.actualPallets} pallet${fb.actualPallets != 1 ? 's' : ''}` : ''}
                          {fb.note ? ` \u2014 "${fb.note}"` : ''}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Unknown SKUs callout */}
              {success.diagnostics?.unknownSkus?.length > 0 && (
                <div className="unknown-callout">
                  <strong>{success.diagnostics.unknownSkus.length} unknown SKU{success.diagnostics.unknownSkus.length !== 1 ? 's' : ''}</strong> &mdash; prediction confidence is reduced and may require manual review.
                </div>
              )}
            </div>
          )}

          {/* Submit corrections button */}
          {flaggedCount > 0 && !feedbackSubmitted && (
            <button
              className="submit-corrections-btn"
              onClick={submitFeedback}
              disabled={feedbackSubmitting}
            >
              {feedbackSubmitting
                ? 'Saving corrections...'
                : `Submit ${flaggedCount} Correction${flaggedCount !== 1 ? 's' : ''}`
              }
            </button>
          )}

          {/* New validation button */}
          <button className="new-btn" onClick={handleNewValidation}>
            Validate Another Shipment
          </button>
        </div>
      )}

      {/* ============ FORM (before submission) ============ */}
      {!success && (
        <>
          {/* Top Section */}
          <div className="form-section">
            <div className="form-row">
              <div className="form-group so-number">
                <label htmlFor="so-number">Sales Order #</label>
                <div className="so-input-wrapper">
                  <span className="so-prefix">SO</span>
                  <input
                    id="so-number"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={soNumber}
                    onChange={(e) => setSoNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="7706"
                    className="so-input"
                  />
                </div>
              </div>

              <div className="form-group validator">
                <label htmlFor="validated-by">Validated by</label>
                <select
                  id="validated-by"
                  value={validatedBy}
                  onChange={(e) => setValidatedBy(e.target.value)}
                  className="validator-select"
                >
                  {VALIDATORS.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group validator">
                <label htmlFor="shipment-completeness">Shipment Completeness</label>
                <select
                  id="shipment-completeness"
                  value={shipmentCompleteness}
                  onChange={(e) => setShipmentCompleteness(e.target.value)}
                  className="validator-select"
                >
                  {SHIPMENT_COMPLETENESS_OPTIONS.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>

              <div className="form-group validator">
                <label htmlFor="actual-unit-basis">Actual Unit Basis</label>
                <select
                  id="actual-unit-basis"
                  value={actualUnitBasis}
                  onChange={(e) => setActualUnitBasis(e.target.value)}
                  className="validator-select"
                >
                  {ACTUAL_UNIT_BASIS_OPTIONS.map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>

              <div className="form-group validator">
                <label htmlFor="actual-positions">Actual Positions</label>
                <input
                  id="actual-positions"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={actualPositions}
                  onChange={(e) => setActualPositions(e.target.value.replace(/\D/g, ''))}
                  placeholder={actualUnitBasis === 'pallet_positions' ? 'Required' : 'Optional'}
                  className="validator-select"
                />
              </div>
            </div>

            <div className="form-group notes-group">
              <label htmlFor="notes">Notes (optional)</label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any observations about this shipment..."
                rows={2}
              />
            </div>
          </div>

          {/* Pallet Table */}
          <div className="pallet-section">
            <div className="section-header">
              <h3>Pallet Details</h3>
              <button type="button" className="add-pallet-btn" onClick={addPallet}>
                + Add Pallet
              </button>
            </div>

            {/* Desktop Table Header */}
            <div className="pallet-table-header">
              <span className="col-num">#</span>
              <span className="col-dim">L (in)</span>
              <span className="col-dim">W (in)</span>
              <span className="col-dim">H (in)</span>
              <span className="col-weight">Weight (lbs)</span>
              <span className="col-action"></span>
            </div>

            {/* Pallet Rows */}
            <div className="pallet-rows">
              {pallets.map((pallet, index) => (
                <div key={index} className="pallet-row">
                  <div className="pallet-num">{index + 1}</div>

                  <div className="pallet-fields">
                    <div className="dims-group">
                      <div className="field-group">
                        <label className="mobile-label">Length</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={pallet.length}
                          onChange={(e) => updatePallet(index, 'length', e.target.value)}
                          placeholder=""
                          className="input-dim"
                        />
                      </div>

                      <span className="dim-separator">x</span>

                      <div className="field-group">
                        <label className="mobile-label">Width</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={pallet.width}
                          onChange={(e) => updatePallet(index, 'width', e.target.value)}
                          placeholder=""
                          className="input-dim"
                        />
                      </div>

                      <span className="dim-separator">x</span>

                      <div className="field-group">
                        <label className="mobile-label">Height</label>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={pallet.height}
                          onChange={(e) => updatePallet(index, 'height', e.target.value)}
                          placeholder=""
                          className="input-dim"
                        />
                      </div>
                    </div>

                    <div className="field-group weight-field">
                      <label className="mobile-label">Weight (lbs)</label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={pallet.weight}
                        onChange={(e) => updatePallet(index, 'weight', e.target.value)}
                        placeholder=""
                        className="input-weight"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="remove-pallet-btn"
                    onClick={() => removePallet(index)}
                    disabled={pallets.length === 1}
                    aria-label="Remove pallet"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="totals-row">
              <div className="total-item">
                <span className="total-label">Total Pallets:</span>
                <span className="total-value">{totalPallets}</span>
              </div>
              <div className="total-item">
                <span className="total-label">Total Weight:</span>
                <span className="total-value">{totalWeight.toLocaleString()} lbs</span>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="error-message">{error}</div>
          )}

          {/* Submit Button */}
          <button
            type="button"
            className="submit-btn"
            onClick={handleSubmit}
            disabled={submitting || !soNumber}
          >
            {submitting ? 'Submitting...' : 'Submit Validation'}
          </button>
        </>
      )}

      <style>{`
        .validation-form-container {
          max-width: 700px;
          margin: 0 auto;
          padding: 16px;
        }

        .form-header {
          margin-bottom: 24px;
        }

        .form-header h2 {
          font-size: 24px;
          font-weight: 700;
          margin: 0;
          color: #f1f5f9;
        }

        .subtitle {
          color: #94a3b8;
          font-size: 14px;
          margin-top: 4px;
        }

        .warning-banner {
          background: #78350f;
          color: #fbbf24;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 13px;
          margin-top: 12px;
        }

        .form-section {
          margin-bottom: 20px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          margin-bottom: 12px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
        }

        .so-number { flex: 1; }
        .validator { min-width: 160px; }

        .so-input-wrapper {
          display: flex;
          align-items: center;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 8px;
          overflow: hidden;
        }

        .so-prefix {
          padding: 10px 12px;
          background: #334155;
          color: #94a3b8;
          font-weight: 600;
          font-size: 16px;
        }

        .so-input {
          flex: 1;
          background: transparent;
          border: none;
          color: white;
          padding: 10px 12px;
          font-size: 18px;
          font-weight: 700;
          outline: none;
        }

        .validator-select {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 8px;
          color: white;
          padding: 10px 12px;
          font-size: 16px;
        }

        .notes-group textarea {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 8px;
          color: white;
          padding: 10px 12px;
          font-size: 14px;
          resize: vertical;
        }

        .pallet-section {
          background: #1e293b;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .section-header h3 {
          font-size: 16px;
          font-weight: 600;
          color: #e2e8f0;
          margin: 0;
        }

        .add-pallet-btn {
          background: #0d9488;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .add-pallet-btn:active {
          background: #0f766e;
        }

        .pallet-table-header {
          display: flex;
          padding: 6px 8px;
          gap: 8px;
          color: #64748b;
          font-size: 12px;
          font-weight: 600;
          border-bottom: 1px solid #334155;
          margin-bottom: 8px;
        }

        .col-num { width: 28px; text-align: center; }
        .col-dim { flex: 1; text-align: center; }
        .col-weight { width: 100px; text-align: center; }
        .col-action { width: 36px; }

        @media (max-width: 600px) {
          .pallet-table-header { display: none; }
        }

        .pallet-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: #0f172a;
          border-radius: 8px;
          margin-bottom: 8px;
        }

        .pallet-num {
          width: 28px;
          text-align: center;
          font-weight: 700;
          color: #64748b;
          font-size: 14px;
        }

        .pallet-fields {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .dims-group {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 1;
        }

        .field-group { flex: 1; }

        .mobile-label {
          display: none;
          font-size: 11px;
          color: #64748b;
        }

        @media (max-width: 600px) {
          .mobile-label { display: block; }
          .pallet-fields { flex-direction: column; gap: 8px; }
          .dims-group { width: 100%; }
          .weight-field { width: 100%; }
        }

        .dim-separator {
          color: #475569;
          font-weight: 600;
          padding: 0 2px;
        }

        .input-dim, .input-weight {
          width: 100%;
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 6px;
          color: white;
          padding: 8px;
          font-size: 16px;
          text-align: center;
        }

        .input-weight {
          width: 100px;
          text-align: center;
        }

        @media (max-width: 600px) {
          .input-weight { width: 100%; }
        }

        .input-dim:focus, .input-weight:focus {
          border-color: #0d9488;
          outline: none;
        }

        .remove-pallet-btn {
          width: 36px;
          height: 36px;
          background: #dc2626;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
        }

        .remove-pallet-btn:disabled {
          background: #475569;
          cursor: not-allowed;
        }

        .remove-pallet-btn:not(:disabled):active {
          background: #b91c1c;
        }

        .totals-row {
          display: flex;
          justify-content: flex-end;
          gap: 24px;
          margin-top: 16px;
          padding-top: 16px;
          border-top: 2px solid #334155;
        }

        .total-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .total-label {
          font-size: 14px;
          color: #94a3b8;
        }

        .total-value {
          font-size: 18px;
          font-weight: 700;
          color: #3b82f6;
        }

        .error-message {
          background: #450a0a;
          color: #fca5a5;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .submit-btn {
          width: 100%;
          padding: 18px 24px;
          background: #22c55e;
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          touch-action: manipulation;
        }

        .submit-btn:disabled {
          background: #475569;
          cursor: not-allowed;
        }

        .submit-btn:not(:disabled):active {
          background: #16a34a;
        }

        /* ================================================
           RESULTS VIEW
           ================================================ */

        .results-container {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .results-header {
          padding: 0;
        }

        .results-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .results-title-row h3 {
          font-size: 20px;
          font-weight: 700;
          color: #f1f5f9;
          margin: 0;
        }

        .saved-badge {
          display: inline-block;
          padding: 4px 14px;
          background: #22c55e;
          color: white;
          font-weight: 700;
          font-size: 13px;
          border-radius: 20px;
          flex-shrink: 0;
        }

        .comparison-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 24px 16px;
        }

        .comparison-grid {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
        }

        .comparison-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .comp-label {
          font-size: 11px;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 600;
        }

        .comp-pallets {
          font-size: 36px;
          font-weight: 800;
          line-height: 1.1;
          color: #f1f5f9;
        }

        .comp-unit {
          font-size: 13px;
          color: #94a3b8;
          font-weight: 500;
        }

        .comp-weight {
          font-size: 13px;
          color: #64748b;
          margin-top: 4px;
        }

        .comparison-vs {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 0 8px;
        }

        .variance-circle {
          width: 56px;
          height: 56px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 18px;
        }

        .variance-circle.exact {
          background: #14532d;
          color: #22c55e;
          border: 2px solid #22c55e;
        }

        .variance-circle.close {
          background: #14532d;
          color: #86efac;
          border: 2px solid #22c55e;
        }

        .variance-circle.over {
          background: #422006;
          color: #fbbf24;
          border: 2px solid #f59e0b;
        }

        .variance-circle.high {
          background: #450a0a;
          color: #fca5a5;
          border: 2px solid #ef4444;
        }

        .variance-label {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 600;
          text-align: center;
        }

        .diagnostics-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          background: #0f172a;
          border-radius: 8px;
          flex-wrap: wrap;
        }

        .conf-pill {
          padding: 3px 10px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          flex-shrink: 0;
        }

        .conf-high { background: #14532d; color: #86efac; }
        .conf-medium { background: #422006; color: #fbbf24; }
        .conf-low { background: #450a0a; color: #fca5a5; }

        .diag-summary {
          font-size: 12px;
          color: #64748b;
        }

        /* ================================================
           ITEM BREAKDOWN
           ================================================ */

        .breakdown-section {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 16px;
        }

        .breakdown-header {
          margin-bottom: 12px;
        }

        .breakdown-header h4 {
          font-size: 16px;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0 0 4px 0;
        }

        .breakdown-hint {
          font-size: 13px;
          color: #64748b;
          margin: 0;
        }

        .breakdown-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .breakdown-item {
          background: #0f172a;
          border: 1px solid #1e293b;
          border-radius: 10px;
          overflow: hidden;
          transition: border-color 0.15s;
          cursor: pointer;
        }

        .breakdown-item:hover {
          border-color: #334155;
        }

        .breakdown-item.flagged {
          border-color: #f59e0b;
          background: #1c1917;
        }

        .breakdown-item.unknown {
          border-left: 3px solid #ef4444;
        }

        .item-main {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          gap: 12px;
          flex-wrap: wrap;
        }

        .item-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 120px;
        }

        .item-sku {
          font-size: 13px;
          font-weight: 700;
          color: #e2e8f0;
          font-family: 'SF Mono', 'Fira Code', monospace;
        }

        .item-name {
          font-size: 11px;
          color: #64748b;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .item-stats {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .item-qty {
          font-size: 13px;
          color: #94a3b8;
          font-weight: 500;
        }

        .item-arrow {
          color: #475569;
          font-size: 12px;
        }

        .item-pallets {
          font-size: 14px;
          font-weight: 700;
          color: #f1f5f9;
          background: #334155;
          padding: 2px 10px;
          border-radius: 6px;
        }

        .item-weight {
          font-size: 12px;
          color: #64748b;
        }

        .item-family {
          min-width: 80px;
          text-align: right;
        }

        .family-known {
          font-size: 11px;
          color: #22c55e;
          background: #14532d;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .family-unknown {
          font-size: 11px;
          color: #fca5a5;
          background: #450a0a;
          padding: 2px 8px;
          border-radius: 4px;
        }

        .item-correction {
          padding: 10px 14px;
          background: #292524;
          border-top: 1px solid #44403c;
        }

        .correction-row {
          display: flex;
          gap: 12px;
          align-items: flex-end;
        }

        .correction-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .correction-field label {
          font-size: 11px;
          font-weight: 600;
          color: #a8a29e;
        }

        .note-field {
          flex: 1;
        }

        .pallet-adjuster {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .correction-input {
          width: 60px;
          background: #1c1917;
          border: 1px solid #57534e;
          border-radius: 6px;
          color: #fbbf24;
          padding: 6px 8px;
          font-size: 16px;
          font-weight: 700;
          text-align: center;
        }

        .correction-input:focus {
          outline: none;
          border-color: #f59e0b;
        }

        .correction-unit {
          font-size: 12px;
          color: #a8a29e;
        }

        .correction-note {
          width: 100%;
          background: #1c1917;
          border: 1px solid #57534e;
          border-radius: 6px;
          color: white;
          padding: 6px 10px;
          font-size: 13px;
        }

        .correction-note:focus {
          outline: none;
          border-color: #f59e0b;
        }

        .correction-note::placeholder {
          color: #78716c;
        }

        .item-correction-saved {
          padding: 8px 14px;
          background: #14532d;
          border-top: 1px solid rgba(34, 197, 94, 0.2);
          font-size: 12px;
          color: #86efac;
        }

        .unknown-callout {
          margin-top: 12px;
          padding: 10px 14px;
          background: #450a0a;
          border: 1px solid #7f1d1d;
          border-radius: 8px;
          font-size: 13px;
          color: #fca5a5;
        }

        .unknown-callout strong {
          color: #fecaca;
        }

        .submit-corrections-btn {
          width: 100%;
          padding: 14px 24px;
          background: #f59e0b;
          color: #1c1917;
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          touch-action: manipulation;
        }

        .submit-corrections-btn:disabled {
          background: #475569;
          color: #94a3b8;
          cursor: not-allowed;
        }

        .submit-corrections-btn:not(:disabled):active {
          background: #d97706;
        }

        .new-btn {
          width: 100%;
          padding: 14px 28px;
          background: #0d9488;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          touch-action: manipulation;
        }

        .new-btn:active {
          background: #0f766e;
        }

        @media (max-width: 600px) {
          .validation-form-container {
            padding: 12px;
          }

          .form-row {
            flex-direction: column;
          }

          .validator {
            min-width: 100%;
          }

          .totals-row {
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
          }

          .comparison-grid {
            flex-direction: column;
            gap: 16px;
          }

          .comparison-vs {
            flex-direction: row;
            padding: 0;
          }

          .results-title-row {
            flex-direction: column;
            align-items: flex-start;
          }

          .item-main {
            flex-direction: column;
            align-items: flex-start;
          }

          .item-stats {
            width: 100%;
          }

          .item-family {
            text-align: left;
          }

          .correction-row {
            flex-direction: column;
          }

          .diagnostics-bar {
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </div>
  )
}
