import { useState } from 'react'

const MODES = [
  { id: 'sales', label: 'Sales', icon: '💰', description: 'Quote → Pallet estimate' },
  { id: 'validate', label: 'Validate', icon: '📋', description: 'Enter actual pallet data' },
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
          margin-bottom: 28px;
        }
        
        .mode-tabs {
          display: flex;
          gap: 10px;
          background: linear-gradient(135deg, #f8d5b0 0%, #fde8cc 100%);
          padding: 8px;
          border-radius: 14px;
          width: fit-content;
          border: 2px solid #fde8cc;
          box-shadow: 0 4px 12px rgba(120, 113, 108, 0.1);
        }
        
        .mode-tab {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 24px;
          border: none;
          background: transparent;
          color: #78716c;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 14.5px;
          font-weight: 600;
        }
        
        .mode-tab:hover {
          background: rgba(255, 255, 255, 0.7);
          color: #0d9488;
          transform: translateY(-2px);
        }
        
        .mode-tab.active {
          background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
        }
        
        .mode-icon {
          font-size: 20px;
        }
        
        .mode-label {
          font-weight: 700;
          letter-spacing: 0.015em;
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
