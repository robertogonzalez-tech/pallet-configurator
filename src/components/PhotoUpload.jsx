import { useState, useRef, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

export default function PhotoUpload({ validationId, palletNumber, onUpload }) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)
  const dropZoneRef = useRef(null)

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return
    
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      setError('Please upload a JPG, PNG, or WebP image')
      return
    }
    
    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10MB')
      return
    }
    
    setError(null)
    
    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => setPreview(e.target.result)
    reader.readAsDataURL(file)
    
    // Upload to Supabase if configured
    if (isSupabaseConfigured() && validationId) {
      setUploading(true)
      try {
        const fileExt = file.name.split('.').pop()
        const fileName = `${validationId}/pallet-${palletNumber || 'general'}-${Date.now()}.${fileExt}`
        
        const { data, error: uploadError } = await supabase.storage
          .from('pallet-photos')
          .upload(fileName, file)
        
        if (uploadError) throw uploadError
        
        // Save attachment record
        const { error: dbError } = await supabase
          .from('attachments')
          .insert({
            validation_id: validationId,
            filename: file.name,
            file_path: data.path,
            file_size: file.size,
            mime_type: file.type,
            pallet_number: palletNumber,
          })
        
        if (dbError) throw dbError
        
        onUpload?.({ path: data.path, preview })
      } catch (err) {
        console.error('Upload error:', err)
        setError(`Upload failed: ${err.message}`)
      } finally {
        setUploading(false)
      }
    } else {
      // No Supabase - just pass the file back
      onUpload?.({ file, preview })
    }
  }, [validationId, palletNumber, onUpload, preview])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    dropZoneRef.current?.classList.remove('drag-over')
    
    const file = e.dataTransfer.files[0]
    handleFileSelect(file)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.add('drag-over')
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.remove('drag-over')
  }, [])

  const openCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.setAttribute('capture', 'environment')
      fileInputRef.current.click()
    }
  }

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute('capture')
      fileInputRef.current.click()
    }
  }

  return (
    <div className="photo-upload">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(e) => handleFileSelect(e.target.files[0])}
        style={{ display: 'none' }}
      />
      
      {preview ? (
        <div className="preview-container">
          <img src={preview} alt="Preview" className="preview-image" />
          <button 
            className="remove-btn"
            onClick={() => setPreview(null)}
          >
            ✕
          </button>
          {uploading && (
            <div className="upload-overlay">
              <div className="spinner"></div>
              <span>Uploading...</span>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={dropZoneRef}
          className="drop-zone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="drop-icon">📷</div>
          <p className="drop-text">Drag & drop photo here</p>
          <div className="upload-buttons">
            <button className="upload-btn camera" onClick={openCamera}>
              📱 Take Photo
            </button>
            <button className="upload-btn browse" onClick={openFilePicker}>
              📁 Browse Files
            </button>
          </div>
        </div>
      )}
      
      {error && <p className="error-text">{error}</p>}
      
      <style>{`
        .photo-upload {
          width: 100%;
        }
        
        .drop-zone {
          border: 2px dashed #475569;
          border-radius: 12px;
          padding: 32px;
          text-align: center;
          transition: all 0.2s ease;
          background: #1e293b;
        }
        
        .drop-zone.drag-over {
          border-color: #3b82f6;
          background: #1e3a5f;
        }
        
        .drop-icon {
          font-size: 48px;
          margin-bottom: 12px;
        }
        
        .drop-text {
          color: #94a3b8;
          margin-bottom: 16px;
        }
        
        .upload-buttons {
          display: flex;
          gap: 12px;
          justify-content: center;
        }
        
        .upload-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s ease;
        }
        
        .upload-btn.camera {
          background: #3b82f6;
          color: white;
        }
        
        .upload-btn.camera:hover {
          background: #2563eb;
        }
        
        .upload-btn.browse {
          background: #334155;
          color: #e2e8f0;
        }
        
        .upload-btn.browse:hover {
          background: #475569;
        }
        
        .preview-container {
          position: relative;
          border-radius: 12px;
          overflow: hidden;
        }
        
        .preview-image {
          width: 100%;
          max-height: 300px;
          object-fit: cover;
          border-radius: 12px;
        }
        
        .remove-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 50%;
          background: rgba(0,0,0,0.7);
          color: white;
          cursor: pointer;
          font-size: 16px;
        }
        
        .upload-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: white;
        }
        
        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid #ffffff40;
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .error-text {
          color: #ef4444;
          font-size: 14px;
          margin-top: 8px;
        }
      `}</style>
    </div>
  )
}
