import React, { useEffect, useMemo, useState } from 'react';
import { exitApp } from '../utils/exitApp';
import FasFlowLayout from '../components/FasFlowLayout';

export default function Slide1({ companies, onNext, onExit, flowHeaderActions = null, appName = 'FAS Accounting' }) {
  const [selected, setSelected] = useState('');

  const brand = useMemo(() => {
    const words = String(appName || '').trim().split(/\s+/).filter(Boolean);
    const short = words[0] || 'FAS';
    return { short, letter: short.slice(0, 1).toUpperCase(), sub: 'ACCOUNTING SUITE' };
  }, [appName]);

  useEffect(() => {
    if (!Array.isArray(companies) || companies.length === 0) return;
    setSelected((prev) => {
      if (prev && companies.some((comp) => String(comp.COMP_CODE) === String(prev))) return prev;
      const firstCode = companies[0]?.COMP_CODE;
      return firstCode != null ? String(firstCode) : '';
    });
  }, [companies]);

  const handleNext = () => {
    if (!selected) {
      alert('Please select a company first');
      return;
    }
    onNext({ COMP_CODE: selected });
  };

  const count = Array.isArray(companies) ? companies.length : 0;
  const selectedComp = companies?.find((c) => String(c.COMP_CODE) === String(selected));

  return (
    <div className="slide slide-fas-flow">
      <FasFlowLayout
        mode="brand"
        step={2}
        logoLetter={brand.letter}
        productName={brand.short}
        productSub={brand.sub}
        headerActions={flowHeaderActions}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0 }}>
          <div>
            <div className="fas-flow-title">Select Company</div>
            <div className="fas-flow-subtitle">Choose the company you want to work with</div>
          </div>

          <div className="fas-field-group">
            <div className="fas-field-label">Company</div>
            <div className="fas-select-wrap">
              <div className="fas-field-input" style={{ paddingRight: 36 }}>
                <span className="fas-field-icon" aria-hidden="true">
                  🏢
                </span>
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">-- Select Company --</option>
                  {companies.map((comp) => (
                    <option key={comp.COMP_CODE} value={comp.COMP_CODE}>
                      {comp.COMP_NAME} ({comp.COMP_CODE})
                    </option>
                  ))}
                </select>
              </div>
              <span className="fas-select-arrow" aria-hidden="true">
                ⌄
              </span>
            </div>
          </div>

          {count > 0 ? (
            <div className="fas-info-pill">
              <span style={{ color: 'var(--fas-accent)' }} aria-hidden="true">
                ✓
              </span>
              {count} {count === 1 ? 'company' : 'companies'} available for your account
            </div>
          ) : (
            <div className="fas-info-tip">No companies loaded yet. If this persists, check the server connection.</div>
          )}

          <div className="fas-btn-row">
            <button
              type="button"
              className="fas-btn fas-btn-ghost"
              onClick={() => (onExit ? onExit() : exitApp())}
              title="Exit application"
            >
              Exit
            </button>
            <button type="button" className="fas-btn fas-btn-primary" onClick={handleNext} disabled={!selected || !selectedComp}>
              Next →
            </button>
          </div>
        </div>
      </FasFlowLayout>
    </div>
  );
}
