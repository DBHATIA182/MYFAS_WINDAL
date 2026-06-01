import React, { useEffect, useState } from 'react';
import { exitApp } from '../utils/exitApp';
import WindalInitialFlowCard from '../components/WindalInitialFlowCard';

export default function Slide1({ companies, onNext, onExit, userName = '', flowHeaderActions = null }) {
  const [selected, setSelected] = useState('');

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
    const selectedComp = companies?.find((c) => String(c.COMP_CODE) === String(selected));
    if (!selectedComp) {
      alert('Please select a company first');
      return;
    }
    onNext({ COMP_CODE: selected });
  };

  const count = Array.isArray(companies) ? companies.length : 0;
  const userLabel = String(userName || '').trim() || '—';

  return (
    <div className="slide slide-windal-initial">
      <WindalInitialFlowCard
        variant="step"
        stepTitle="Company Selection"
        stepIcon="🏢"
        headerRight={<span>User: {userLabel}</span>}
        settingsSlot={flowHeaderActions}
      >
        <div className="windal-initial-section-label">Select Company</div>

        {count === 0 ? (
          <p className="windal-initial-company-line">No companies loaded. Check the server connection.</p>
        ) : (
          <ul className="windal-initial-list" role="listbox" aria-label="Companies">
            {companies.map((comp, index) => {
              const code = String(comp.COMP_CODE);
              const name = comp.COMP_NAME ?? comp.comp_name ?? code;
              const isSelected = code === String(selected);
              return (
                <li key={code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`windal-initial-list-item${isSelected ? ' is-selected' : ''}`}
                    onClick={() => setSelected(code)}
                  >
                    <span>
                      #{index + 1} {name}
                    </span>
                    <span className="windal-initial-list-item__check" aria-hidden="true">
                      ✓
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="windal-initial-btn-row">
          <button
            type="button"
            className="windal-initial-btn windal-initial-btn--ghost"
            onClick={() => (onExit ? onExit() : exitApp())}
          >
            ← Back
          </button>
          <button
            type="button"
            className="windal-initial-btn windal-initial-btn--primary"
            onClick={handleNext}
            disabled={!selected || count === 0}
          >
            ✓ Select
          </button>
        </div>
      </WindalInitialFlowCard>
    </div>
  );
}
