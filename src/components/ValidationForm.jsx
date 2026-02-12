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

export default function ValidationForm() {
  // Form state
  const [soNumber, setSoNumber] = useState('')
  const [validatedBy, setValidatedBy] = useState('Chad')
  const [notes, setNotes] = useState('')
  const [pallets, setPallets] = useState([{ ...DEFAULT_PALLET }])

  // UI state
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [prediction, setPrediction] = useState(null)

  const supabaseStatus = getSupabaseStatus()

  // Add a new pallet row
  const addPallet = () => {
    setPallets([...pallets, { ...DEFAULT_PALLET }])
  }

  // Remove a pallet row
  const removePallet = (index) => {
    if (pallets.length === 1) return // Keep at least one
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
    // SO# must be 4+ digits
    if (!/^\d{4,}$/.test(soNumber)) {
      return 'Sales Order # must be at least 4 digits'
    }

    // At least 1 pallet
    if (pallets.length === 0) {
      return 'At least one pallet is required'
    }

    // All pallet fields must be filled
    for (let i = 0; i < pallets.length; i++) {
      const p = pallets[i]
      if (!p.weight || !p.length || !p.width || !p.height) {
        return `Pallet ${i + 1}: All fields are required`
      }
      if (parseFloat(p.weight) <= 0) {
        return `Pallet ${i + 1}: Weight must be greater than 0`
      }
    }

    return null
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

    try {
      // Call the API endpoint
      const response = await fetch('/api/validate-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soNumber: soNumber.trim(),
          validatedBy,
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

      // Store prediction for display
      setPrediction(data.prediction)

      // Show success
      setSuccess({
        soNumber: `SO${soNumber}`,
        actualPallets: totalPallets,
        actualWeight: totalWeight,
        predictedPallets: data.prediction?.palletCount || 0,
        predictedWeight: data.prediction?.totalWeight || 0,
        variance: {
          pallets: totalPallets - (data.prediction?.palletCount || 0),
          weight: totalWeight - (data.prediction?.totalWeight || 0),
        },
      })

      // Clear form for next entry
      setSoNumber('')
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
  }

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

      {/* Success State */}
      {success && (
        <div className="success-card">
          <div className="success-icon">Saved</div>
          <h3>Validation saved for {success.soNumber}</h3>

          <div className="comparison-grid">
            <div className="comparison-item">
              <span className="label">Predicted</span>
              <span className="value">{success.predictedPallets} pallets</span>
              <span className="weight">{success.predictedWeight.toLocaleString()} lbs</span>
            </div>
            <div className="comparison-arrow">vs</div>
            <div className="comparison-item">
              <span className="label">Actual</span>
              <span className="value">{success.actualPallets} pallets</span>
              <span className="weight">{success.actualWeight.toLocaleString()} lbs</span>
            </div>
          </div>

          <div className={`variance-badge ${success.variance.pallets === 0 ? 'exact' : success.variance.pallets > 0 ? 'over' : 'under'}`}>
            {success.variance.pallets === 0
              ? 'Exact Match!'
              : `${success.variance.pallets > 0 ? '+' : ''}${success.variance.pallets} pallet${Math.abs(success.variance.pallets) !== 1 ? 's' : ''}`
            }
          </div>

          <button className="new-btn" onClick={handleNewValidation}>
            Validate Another Shipment
          </button>
        </div>
      )}

      {/* Form */}
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
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 8px;
        }

        .subtitle {
          color: #94a3b8;
          font-size: 16px;
        }

        .warning-banner {
          background: #fef3c7;
          color: #92400e;
          padding: 12px 16px;
          border-radius: 8px;
          margin-top: 12px;
          font-size: 14px;
        }

        /* Form Section */
        .form-section {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
        }

        .form-row {
          display: flex;
          gap: 16px;
          margin-bottom: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 600;
          color: #94a3b8;
        }

        .so-number {
          flex: 1;
        }

        .so-input-wrapper {
          display: flex;
          align-items: center;
          background: #0f172a;
          border: 2px solid #475569;
          border-radius: 8px;
          overflow: hidden;
        }

        .so-prefix {
          padding: 14px 12px;
          background: #334155;
          color: #94a3b8;
          font-weight: 600;
          font-size: 18px;
        }

        .so-input {
          flex: 1;
          padding: 14px 12px;
          border: none;
          background: transparent;
          color: white;
          font-size: 20px;
          font-weight: 600;
          min-width: 0;
        }

        .so-input:focus {
          outline: none;
        }

        .so-input-wrapper:focus-within {
          border-color: #3b82f6;
        }

        .validator {
          min-width: 140px;
        }

        .validator-select {
          padding: 14px 12px;
          border: 2px solid #475569;
          border-radius: 8px;
          background: #0f172a;
          color: white;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
        }

        .validator-select:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .notes-group {
          margin-bottom: 0;
        }

        .notes-group textarea {
          padding: 12px;
          border: 2px solid #475569;
          border-radius: 8px;
          background: #0f172a;
          color: white;
          font-size: 16px;
          resize: vertical;
          min-height: 60px;
        }

        .notes-group textarea:focus {
          outline: none;
          border-color: #3b82f6;
        }

        /* Pallet Section */
        .pallet-section {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
        }

        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .section-header h3 {
          font-size: 18px;
          font-weight: 600;
        }

        .add-pallet-btn {
          padding: 10px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          touch-action: manipulation;
        }

        .add-pallet-btn:active {
          background: #2563eb;
        }

        /* Table Header (Desktop) */
        .pallet-table-header {
          display: none;
          padding: 12px 8px;
          background: #0f172a;
          border-radius: 8px;
          margin-bottom: 8px;
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
        }

        @media (min-width: 640px) {
          .pallet-table-header {
            display: flex;
            align-items: center;
            gap: 12px;
          }
        }

        .col-num { width: 32px; text-align: center; }
        .col-dim { width: 70px; text-align: center; }
        .col-weight { flex: 2; min-width: 150px; }
        .col-action { width: 44px; }

        /* Pallet Rows */
        .pallet-rows {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .pallet-row {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          background: #0f172a;
          border-radius: 10px;
          border: 2px solid #334155;
        }

        .pallet-num {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #3b82f6;
          color: white;
          font-weight: 700;
          font-size: 14px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .pallet-fields {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .mobile-label {
          display: block;
          font-size: 12px;
          color: #64748b;
          margin-bottom: 4px;
        }

        @media (min-width: 640px) {
          .mobile-label {
            display: none;
          }

          .pallet-fields {
            flex-direction: row;
            align-items: center;
            gap: 12px;
          }
        }

        .weight-field {
          flex: 2;
          min-width: 150px;
        }

        .input-weight {
          width: 100%;
          padding: 14px 12px;
          border: 2px solid #475569;
          border-radius: 8px;
          background: #1e293b;
          color: white;
          font-size: 18px;
          font-weight: 600;
          text-align: center;
        }

        .input-weight:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .dims-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .dims-group .field-group {
          flex: 1;
        }

        .dim-separator {
          color: #64748b;
          font-weight: 600;
          padding-top: 20px;
        }

        @media (min-width: 640px) {
          .dim-separator {
            padding-top: 0;
          }
        }

        .input-dim {
          width: 100%;
          padding: 12px 8px;
          border: 2px solid #475569;
          border-radius: 8px;
          background: #1e293b;
          color: white;
          font-size: 16px;
          font-weight: 500;
          text-align: center;
        }

        .input-dim:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .remove-pallet-btn {
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #dc2626;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          flex-shrink: 0;
          touch-action: manipulation;
        }

        .remove-pallet-btn:disabled {
          background: #475569;
          cursor: not-allowed;
        }

        .remove-pallet-btn:not(:disabled):active {
          background: #b91c1c;
        }

        /* Totals */
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

        /* Error */
        .error-message {
          background: #450a0a;
          color: #fca5a5;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        /* Submit Button */
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

        /* Success Card */
        .success-card {
          background: #14532d;
          border-radius: 16px;
          padding: 32px;
          text-align: center;
        }

        .success-icon {
          display: inline-block;
          padding: 8px 16px;
          background: #22c55e;
          color: white;
          font-weight: 700;
          font-size: 14px;
          border-radius: 20px;
          margin-bottom: 16px;
        }

        .success-card h3 {
          font-size: 22px;
          margin-bottom: 24px;
        }

        .comparison-grid {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 24px;
          margin-bottom: 20px;
        }

        .comparison-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .comparison-item .label {
          font-size: 12px;
          color: #86efac;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .comparison-item .value {
          font-size: 24px;
          font-weight: 700;
        }

        .comparison-item .weight {
          font-size: 14px;
          color: #86efac;
        }

        .comparison-arrow {
          color: #86efac;
          font-size: 18px;
          font-weight: 600;
        }

        .variance-badge {
          display: inline-block;
          padding: 8px 20px;
          border-radius: 20px;
          font-weight: 700;
          font-size: 16px;
          margin-bottom: 24px;
        }

        .variance-badge.exact {
          background: #22c55e;
          color: white;
        }

        .variance-badge.over {
          background: #f59e0b;
          color: #1e293b;
        }

        .variance-badge.under {
          background: #3b82f6;
          color: white;
        }

        .new-btn {
          padding: 14px 28px;
          background: #22c55e;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          touch-action: manipulation;
        }

        .new-btn:active {
          background: #16a34a;
        }

        /* Mobile Responsive */
        @media (max-width: 480px) {
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

          .comparison-arrow {
            transform: rotate(90deg);
          }
        }
      `}</style>
    </div>
  )
}
