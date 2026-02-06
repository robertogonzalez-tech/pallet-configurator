import { useState } from 'react'

const MODES = [
  { id: 'sales', label: 'Sales', icon: '💰', description: 'Quote → Pallet estimate' },
  { id: 'validation', label: 'Validation', icon: '✅', description: 'Verify predictions' },
  { id: 'warehouse', label: 'Warehouse', icon: '📦', description: 'Packing instructions' },
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
          margin-bottom: 24px;
        }
        
        .mode-tabs {
          display: flex;
          gap: 8px;
          background: #1e293b;
          padding: 6px;
          border-radius: 12px;
          width: fit-content;
        }
        
        .mode-tab {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border: none;
          background: transparent;
          color: #94a3b8;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 14px;
          font-weight: 500;
        }
        
        .mode-tab:hover {
          background: #334155;
          color: #e2e8f0;
        }
        
        .mode-tab.active {
          background: #3b82f6;
          color: white;
        }
        
        .mode-icon {
          font-size: 18px;
        }
        
        .mode-label {
          font-weight: 600;
        }
        
        @media (max-width: 640px) {
          .mode-tabs {
            width: 100%;
            justify-content: center;
          }
          
          .mode-tab {
            padding: 8px 12px;
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
