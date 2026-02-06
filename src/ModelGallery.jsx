import { useState, Suspense, lazy } from 'react'

const ModelViewer = lazy(() => import('./ModelViewer'))

// Available 3D models with metadata
const MODELS = [
  {
    id: 'varsity',
    name: 'Varsity 2-Pack',
    file: '/models/varsity-double-pack.glb',
    dims: '34.5" × 11" × 13.5"',
    type: 'Packaging Box',
  },
  {
    id: 'vr2',
    name: 'VR2 2-Pack',
    file: '/models/vr2-two-pack.glb',
    dims: '42.8" × 24.9" × 13.4"',
    type: 'Packaging Box',
  },
  {
    id: 'hr101',
    name: 'HR101 Hoop Runner',
    file: '/models/hr101-unboxed.glb',
    dims: '32.4" × 27.5" × 6.0"',
    type: 'Product',
  },
  {
    id: 'cs200',
    name: 'CS200 Circle Series',
    file: '/models/cs200.glb',
    dims: '34.7" × 31.3" × 6.0"',
    type: 'Product',
  },
  {
    id: 'skatedock',
    name: 'SkateDock Box',
    file: '/models/skatedock-box.glb',
    dims: '73.0" × 14.0" × 13.0"',
    type: 'Packaging Box',
  },
  {
    id: 'dd-slide',
    name: 'DD Slide Assembly',
    file: '/models/dd-slide-assembly.glb',
    dims: '80.4" × 16.5" × 6.5"',
    type: 'Component',
  },
  {
    id: 'dd-lower',
    name: 'DD Lower Track',
    file: '/models/dd-lower-track.glb',
    dims: '79.3" × 12.2" × 6.0"',
    type: 'Component',
  },
  {
    id: 'dd-leg',
    name: 'DD Support Leg',
    file: '/models/dd-support-leg.glb',
    dims: '43.7" × 24.9" × 7.0"',
    type: 'Component',
  },
  {
    id: 'dd-manifold',
    name: 'DD Manifold',
    file: '/models/dd-manifold.glb',
    dims: '29.7" × 12.3" × 11.8"',
    type: 'Component',
  },
]

export default function ModelGallery() {
  const [selectedModel, setSelectedModel] = useState(MODELS[0])
  const [isOpen, setIsOpen] = useState(false)
  
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          padding: '10px 20px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: '500',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        🎮 View 3D Product Models ({MODELS.length})
      </button>
    )
  }
  
  return (
    <div style={{
      background: 'white',
      borderRadius: '12px',
      border: '2px solid #e5e7eb',
      overflow: 'hidden',
      marginBottom: '20px'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        background: '#f8fafc',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem' }}>🎮 3D Product Models</h2>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            padding: '6px 12px',
            background: '#6b7280',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Close
        </button>
      </div>
      
      <div style={{ display: 'flex', minHeight: '450px' }}>
        {/* Model list */}
        <div style={{
          width: '250px',
          borderRight: '1px solid #e5e7eb',
          background: '#fafafa',
          overflowY: 'auto'
        }}>
          {MODELS.map(model => (
            <div
              key={model.id}
              onClick={() => setSelectedModel(model)}
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                background: selectedModel.id === model.id ? '#dbeafe' : 'transparent',
                borderBottom: '1px solid #e5e7eb',
                transition: 'background 0.15s'
              }}
            >
              <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{model.name}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '2px' }}>
                {model.dims}
              </div>
              <div style={{
                fontSize: '0.65rem',
                color: model.type === 'Product' ? '#059669' : model.type === 'Component' ? '#d97706' : '#6b7280',
                marginTop: '4px',
                textTransform: 'uppercase',
                fontWeight: '600'
              }}>
                {model.type}
              </div>
            </div>
          ))}
        </div>
        
        {/* 3D Viewer */}
        <div style={{ flex: 1 }}>
          <Suspense fallback={
            <div style={{ 
              height: '450px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              background: '#1e293b',
              color: '#94a3b8'
            }}>
              Loading 3D viewer...
            </div>
          }>
            <ModelViewer 
              modelUrl={selectedModel.file} 
              height={450}
              title={selectedModel.name}
            />
          </Suspense>
        </div>
      </div>
      
      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        background: '#f8fafc',
        borderTop: '1px solid #e5e7eb',
        fontSize: '0.8rem',
        color: '#6b7280'
      }}>
        <strong>{selectedModel.name}</strong> — {selectedModel.dims} • 
        Models from STEP files (Chad, 2026-01-30)
      </div>
    </div>
  )
}
