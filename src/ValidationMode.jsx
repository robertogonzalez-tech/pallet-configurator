import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured, getSupabaseStatus } from './lib/supabase'
import PhotoUpload from './components/PhotoUpload'

export default function ValidationMode() {
  const [pickTicketId, setPickTicketId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [prediction, setPrediction] = useState(null)
  const [validation, setValidation] = useState({
    actualPallets: '',
    actualWeight: '',
    notes: '',
    validatedBy: 'Chad', // Default
  })
  const [corrections, setCorrections] = useState([])
  const [photos, setPhotos] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Check Supabase status on mount
  const supabaseStatus = getSupabaseStatus()

  // Load pick ticket and prediction
  const loadPickTicket = async () => {
    if (!pickTicketId.trim()) return
    
    setLoading(true)
    setError(null)
    setPrediction(null)
    setSubmitted(false)
    
    try {
      // TODO: Replace with real NetSuite pick ticket endpoint
      // For now, mock the response
      const response = await fetch(`/api/pick-tickets/${encodeURIComponent(pickTicketId.trim())}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Pick ticket not found')
        }
        throw new Error('Failed to load pick ticket')
      }
      
      const data = await response.json()
      
      // Load existing validation if any
      if (isSupabaseConfigured()) {
        const { data: existing } = await supabase
          .from('validations')
          .select('*')
          .eq('pick_ticket_id', pickTicketId.trim())
          .single()
        
        if (existing) {
          setValidation({
            actualPallets: existing.actual_pallets?.toString() || '',
            actualWeight: existing.actual_weight_lbs?.toString() || '',
            notes: existing.actual_notes || '',
            validatedBy: existing.validated_by || 'Chad',
          })
          if (existing.status === 'validated') {
            setSubmitted(true)
          }
        }
      }
      
      setPrediction(data)
    } catch (err) {
      console.error('Load error:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Add a product correction
  const addCorrection = () => {
    setCorrections([...corrections, {
      sku: '',
      productName: '',
      correctionType: 'dimensions',
      notes: '',
      predictedValue: {},
      actualValue: {},
    }])
  }

  // Update a correction
  const updateCorrection = (index, field, value) => {
    const updated = [...corrections]
    updated[index][field] = value
    setCorrections(updated)
  }

  // Remove a correction
  const removeCorrection = (index) => {
    setCorrections(corrections.filter((_, i) => i !== index))
  }

  // Handle photo upload
  const handlePhotoUpload = (data) => {
    setPhotos([...photos, data])
  }

  // Submit validation
  const submitValidation = async () => {
    if (!validation.actualPallets) {
      setError('Please enter the actual pallet count')
      return
    }
    
    setSubmitting(true)
    setError(null)
    
    try {
      if (isSupabaseConfigured()) {
        // Upsert validation record
        const { error: validationError } = await supabase
          .from('validations')
          .upsert({
            pick_ticket_id: pickTicketId.trim(),
            sales_order_id: prediction?.salesOrderId,
            quote_number: prediction?.quoteNumber,
            predicted_pallets: prediction?.predictedPallets || 0,
            predicted_weight_lbs: prediction?.predictedWeight || 0,
            predicted_items: prediction?.items || [],
            prediction_timestamp: prediction?.timestamp || new Date().toISOString(),
            actual_pallets: parseInt(validation.actualPallets),
            actual_weight_lbs: validation.actualWeight ? parseFloat(validation.actualWeight) : null,
            actual_notes: validation.notes,
            validated_by: validation.validatedBy,
            validation_timestamp: new Date().toISOString(),
            status: 'validated',
          }, {
            onConflict: 'pick_ticket_id',
          })
        
        if (validationError) throw validationError
        
        // Insert corrections
        if (corrections.length > 0) {
          const { data: validationRecord } = await supabase
            .from('validations')
            .select('id')
            .eq('pick_ticket_id', pickTicketId.trim())
            .single()
          
          if (validationRecord) {
            const correctionRecords = corrections
              .filter(c => c.sku && c.correctionType)
              .map(c => ({
                validation_id: validationRecord.id,
                sku: c.sku,
                product_name: c.productName,
                correction_type: c.correctionType,
                predicted_value: c.predictedValue,
                actual_value: c.actualValue,
                notes: c.notes,
              }))
            
            if (correctionRecords.length > 0) {
              await supabase.from('corrections').insert(correctionRecords)
            }
          }
        }
      } else {
        // No database - just log to console for now
        console.log('Validation submitted (no database):', {
          pickTicketId,
          prediction,
          validation,
          corrections,
          photos,
        })
      }
      
      setSubmitted(true)
    } catch (err) {
      console.error('Submit error:', err)
      setError(`Failed to submit: ${err.message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="validation-mode">
      <div className="validation-header">
        <h2>📋 Validation Mode</h2>
        <p className="subtitle">Verify packing predictions against actual results</p>
        
        {!supabaseStatus.configured && (
          <div className="warning-banner">
            ⚠️ Database not configured ({supabaseStatus.reason}). 
            Validations won't be saved.
          </div>
        )}
      </div>

      {/* Pick Ticket Input */}
      <div className="input-section">
        <label htmlFor="pick-ticket">Pick Ticket / Item Fulfillment ID</label>
        <div className="input-row">
          <input
            id="pick-ticket"
            type="text"
            value={pickTicketId}
            onChange={(e) => setPickTicketId(e.target.value)}
            placeholder="IF-12345 or PT-12345"
            onKeyDown={(e) => e.key === 'Enter' && loadPickTicket()}
          />
          <button 
            onClick={loadPickTicket}
            disabled={loading || !pickTicketId.trim()}
            className="load-btn"
          >
            {loading ? 'Loading...' : 'Load'}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      {/* Prediction Summary */}
      {prediction && (
        <div className="prediction-section">
          <h3>🎯 Prediction</h3>
          <div className="prediction-grid">
            <div className="stat-card">
              <div className="stat-value">{prediction.predictedPallets || '—'}</div>
              <div className="stat-label">Predicted Pallets</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{prediction.predictedWeight ? `${prediction.predictedWeight.toLocaleString()} lbs` : '—'}</div>
              <div className="stat-label">Predicted Weight</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{prediction.items?.length || 0}</div>
              <div className="stat-label">Line Items</div>
            </div>
          </div>
          
          {/* Items list */}
          {prediction.items?.length > 0 && (
            <details className="items-details">
              <summary>View Items ({prediction.items.length})</summary>
              <table className="items-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {prediction.items.map((item, i) => (
                    <tr key={i}>
                      <td><code>{item.sku}</code></td>
                      <td>{item.name}</td>
                      <td>{item.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {/* Validation Form */}
      {prediction && !submitted && (
        <div className="validation-form">
          <h3>✅ Actual Results</h3>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Actual Pallet Count *</label>
              <input
                type="number"
                min="0"
                value={validation.actualPallets}
                onChange={(e) => setValidation({...validation, actualPallets: e.target.value})}
                placeholder="e.g., 5"
              />
            </div>
            
            <div className="form-group">
              <label>BOL Weight (lbs)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={validation.actualWeight}
                onChange={(e) => setValidation({...validation, actualWeight: e.target.value})}
                placeholder="e.g., 2450"
              />
            </div>
            
            <div className="form-group">
              <label>Validated By</label>
              <input
                type="text"
                value={validation.validatedBy}
                onChange={(e) => setValidation({...validation, validatedBy: e.target.value})}
                placeholder="e.g., Chad"
              />
            </div>
          </div>
          
          <div className="form-group full-width">
            <label>Notes</label>
            <textarea
              value={validation.notes}
              onChange={(e) => setValidation({...validation, notes: e.target.value})}
              placeholder="Any observations about the packing..."
              rows={3}
            />
          </div>

          {/* Photo Upload */}
          <div className="photo-section">
            <h4>📷 Photos (optional)</h4>
            <div className="photo-grid">
              {photos.map((photo, i) => (
                <div key={i} className="photo-thumb">
                  <img src={photo.preview} alt={`Photo ${i + 1}`} />
                </div>
              ))}
              <PhotoUpload 
                validationId={prediction?.validationId}
                onUpload={handlePhotoUpload}
              />
            </div>
          </div>

          {/* Product Corrections */}
          <div className="corrections-section">
            <div className="section-header">
              <h4>🔧 Product Corrections</h4>
              <button className="add-btn" onClick={addCorrection}>+ Add Correction</button>
            </div>
            
            {corrections.map((correction, i) => (
              <div key={i} className="correction-card">
                <button className="remove-btn" onClick={() => removeCorrection(i)}>✕</button>
                
                <div className="correction-grid">
                  <div className="form-group">
                    <label>SKU</label>
                    <input
                      type="text"
                      value={correction.sku}
                      onChange={(e) => updateCorrection(i, 'sku', e.target.value)}
                      placeholder="DD-SS-04-GAV"
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>Issue Type</label>
                    <select
                      value={correction.correctionType}
                      onChange={(e) => updateCorrection(i, 'correctionType', e.target.value)}
                    >
                      <option value="dimensions">Wrong Dimensions</option>
                      <option value="weight">Wrong Weight</option>
                      <option value="packing">Wrong Packing Rule</option>
                      <option value="quantity">Wrong Quantity</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  
                  <div className="form-group full-width">
                    <label>Notes</label>
                    <input
                      type="text"
                      value={correction.notes}
                      onChange={(e) => updateCorrection(i, 'notes', e.target.value)}
                      placeholder="What was wrong and what's the correct value?"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Submit */}
          <button 
            className="submit-btn"
            onClick={submitValidation}
            disabled={submitting || !validation.actualPallets}
          >
            {submitting ? 'Saving...' : 'Submit Validation'}
          </button>
        </div>
      )}

      {/* Success State */}
      {submitted && (
        <div className="success-card">
          <div className="success-icon">✅</div>
          <h3>Validation Saved!</h3>
          <p>
            Predicted: {prediction?.predictedPallets} pallets → 
            Actual: {validation.actualPallets} pallets
            {validation.actualPallets != prediction?.predictedPallets && (
              <span className="variance">
                ({validation.actualPallets - prediction?.predictedPallets > 0 ? '+' : ''}
                {validation.actualPallets - prediction?.predictedPallets})
              </span>
            )}
          </p>
          <button 
            className="new-btn"
            onClick={() => {
              setPickTicketId('')
              setPrediction(null)
              setValidation({ actualPallets: '', actualWeight: '', notes: '', validatedBy: 'Chad' })
              setCorrections([])
              setPhotos([])
              setSubmitted(false)
            }}
          >
            Validate Another
          </button>
        </div>
      )}

      <style>{`
        .validation-mode {
          max-width: 800px;
          margin: 0 auto;
        }
        
        .validation-header {
          margin-bottom: 24px;
        }
        
        .validation-header h2 {
          font-size: 24px;
          margin-bottom: 8px;
        }
        
        .subtitle {
          color: #94a3b8;
        }
        
        .warning-banner {
          background: #fef3c7;
          color: #92400e;
          padding: 12px 16px;
          border-radius: 8px;
          margin-top: 12px;
          font-size: 14px;
        }
        
        .input-section {
          margin-bottom: 24px;
        }
        
        .input-section label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
        }
        
        .input-row {
          display: flex;
          gap: 12px;
        }
        
        .input-row input {
          flex: 1;
          padding: 12px 16px;
          border: 1px solid #475569;
          border-radius: 8px;
          background: #1e293b;
          color: white;
          font-size: 16px;
        }
        
        .load-btn {
          padding: 12px 24px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
        }
        
        .load-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .error-text {
          color: #ef4444;
          margin-top: 8px;
          font-size: 14px;
        }
        
        .prediction-section {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
        }
        
        .prediction-section h3 {
          margin-bottom: 16px;
        }
        
        .prediction-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
        }
        
        .stat-card {
          background: #0f172a;
          padding: 16px;
          border-radius: 8px;
          text-align: center;
        }
        
        .stat-value {
          font-size: 24px;
          font-weight: 700;
          color: #3b82f6;
        }
        
        .stat-label {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 4px;
        }
        
        .items-details {
          margin-top: 16px;
        }
        
        .items-details summary {
          cursor: pointer;
          color: #3b82f6;
        }
        
        .items-table {
          width: 100%;
          margin-top: 12px;
          font-size: 14px;
        }
        
        .items-table th {
          text-align: left;
          padding: 8px;
          border-bottom: 1px solid #475569;
        }
        
        .items-table td {
          padding: 8px;
        }
        
        .validation-form {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
        }
        
        .validation-form h3 {
          margin-bottom: 16px;
        }
        
        .form-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          margin-bottom: 16px;
        }
        
        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .form-group.full-width {
          grid-column: 1 / -1;
        }
        
        .form-group label {
          font-size: 14px;
          font-weight: 500;
          color: #94a3b8;
        }
        
        .form-group input,
        .form-group select,
        .form-group textarea {
          padding: 10px 12px;
          border: 1px solid #475569;
          border-radius: 6px;
          background: #0f172a;
          color: white;
          font-size: 14px;
        }
        
        .form-group textarea {
          resize: vertical;
        }
        
        .photo-section {
          margin-top: 24px;
        }
        
        .photo-section h4 {
          margin-bottom: 12px;
        }
        
        .photo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
          gap: 12px;
        }
        
        .photo-thumb {
          aspect-ratio: 1;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .photo-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .corrections-section {
          margin-top: 24px;
        }
        
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        
        .section-header h4 {
          margin: 0;
        }
        
        .add-btn {
          padding: 6px 12px;
          background: #334155;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        }
        
        .correction-card {
          background: #0f172a;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          position: relative;
        }
        
        .correction-card .remove-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 24px;
          height: 24px;
          border: none;
          background: #475569;
          color: white;
          border-radius: 50%;
          cursor: pointer;
          font-size: 12px;
        }
        
        .correction-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        
        .submit-btn {
          width: 100%;
          padding: 14px;
          background: #22c55e;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 24px;
        }
        
        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        .success-card {
          background: #14532d;
          border-radius: 12px;
          padding: 40px;
          text-align: center;
        }
        
        .success-icon {
          font-size: 48px;
          margin-bottom: 16px;
        }
        
        .success-card h3 {
          margin-bottom: 8px;
        }
        
        .variance {
          color: ${validation.actualPallets - prediction?.predictedPallets === 0 ? '#22c55e' : '#f59e0b'};
          font-weight: 600;
          margin-left: 4px;
        }
        
        .new-btn {
          margin-top: 20px;
          padding: 12px 24px;
          background: #22c55e;
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
        }
        
        @media (max-width: 640px) {
          .prediction-grid,
          .form-grid {
            grid-template-columns: 1fr;
          }
          
          .correction-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  )
}
