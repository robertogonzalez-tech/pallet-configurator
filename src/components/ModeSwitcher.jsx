import { useState } from 'react'

const MODES = [
  { id: 'sales', label: 'Quoting', icon: '🧾', description: 'Quote intake and shipment plan' },
  { id: 'validate', label: 'Warehouse', icon: '📋', description: 'Capture actual shipment outcomes' },
  { id: 'warehouse', label: 'Packing', icon: '📦', description: 'Packing instructions' },
]

export default function ModeSwitcher({ currentMode, onModeChange }) {
  return (
    <div className="mode-switcher">
      <div className="mode-tabs">
        {MODES.map(mode => (
          <button
            key={mode.id}
            className={`mode-tab ${currentMode === mode.id ? 'active' : ''}`}
            onClick={() => onModeChange(mode.id)}
            title={mode.description}
          >
            <span className="mode-icon">{mode.icon}</span>
            <span className="mode-label">{mode.label}</span>
          </button>
        ))}
      </div>
      
      <style>{`
        .mode-switcher {
          margin-bottom: 28px;
        }
        
        .mode-tabs {
          display: flex;
          gap: 10px;
          background: linear-gradient(135deg, rgba(15, 23, 42, 0.92) 0%, rgba(49, 46, 129, 0.9) 100%);
          padding: 8px;
          border-radius: 18px;
          width: fit-content;
          border: 1px solid rgba(245, 158, 11, 0.18);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.18);
        }
        
        .mode-tab {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 24px;
          border: none;
          background: transparent;
          color: rgba(241, 245, 249, 0.78);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 14.5px;
          font-weight: 700;
        }
        
        .mode-tab:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #f8fafc;
          transform: translateY(-2px);
        }
        
        .mode-tab.active {
          background: linear-gradient(135deg, #f59e0b 0%, #fb7185 100%);
          color: #fffdf8;
          box-shadow: 0 6px 18px rgba(249, 115, 22, 0.32);
        }
        
        .mode-icon {
          font-size: 18px;
        }
        
        .mode-label {
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-size: 0.78rem;
        }
        
        @media (max-width: 640px) {
          .mode-tabs {
            width: 100%;
            justify-content: center;
          }
          
          .mode-tab {
            padding: 10px 14px;
            flex: 1;
            justify-content: center;
          }
          
          .mode-label {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}
