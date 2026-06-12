import React, { useMemo, useState, useLayoutEffect } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import WindalInitialFlowCard from '../components/WindalInitialFlowCard';

function parseDateBoundary(value, endOfDay) {
  if (value == null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function defaultYearUid(yearRows) {
  if (!yearRows?.length) return '';
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (const y of yearRows) {
    const uid = y.COMP_UID ?? y.comp_uid;
    if (uid == null || uid === '') continue;
    const start = parseDateBoundary(y.COMP_S_DT ?? y.comp_s_dt, false);
    const end = parseDateBoundary(y.COMP_E_DT ?? y.comp_e_dt, true);
    if (start && end && today >= start && today <= end) {
      return String(uid);
    }
  }
  const first = yearRows[0];
  const uid0 = first.COMP_UID ?? first.comp_uid;
  return uid0 != null && uid0 !== '' ? String(uid0) : '';
}

export default function Slide2({ years, formData, onPrev, onNext, flowHeaderActions = null }) {
  const [selectedUid, setSelectedUid] = useState('');

  useLayoutEffect(() => {
    if (!years?.length) {
      setSelectedUid('');
      return;
    }
    const uid = defaultYearUid(years);
    if (uid) setSelectedUid(uid);
  }, [years]);

  const yearObj = useMemo(
    () => years.find((y) => String(y.COMP_UID) === String(selectedUid)),
    [years, selectedUid]
  );

  const selectYear = (y) => {
    const uid = String(y.COMP_UID ?? y.comp_uid ?? '');
    if (!uid) return;
    setSelectedUid(uid);
    onNext(y);
  };

  const handleNext = () => {
    if (!yearObj) {
      alert('Please select a financial year first.');
      return;
    }
    onNext(yearObj);
  };

  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compNo = formData.comp_code ?? formData.COMP_CODE ?? '';

  return (
    <div className="slide slide-windal-initial">
      <WindalInitialFlowCard
        variant="step"
        stepTitle="Year Selection"
        stepIcon="📅"
        headerRight={<span>{compName || '—'}</span>}
        settingsSlot={flowHeaderActions}
      >
        {(compNo || compName) && (
          <div className="windal-initial-company-line">
            Company No: {compNo || '—'}&nbsp;&nbsp;Name: {compName || '—'}
          </div>
        )}

        {!years?.length ? (
          <p className="windal-initial-company-line">No financial years available.</p>
        ) : (
          <>
          <p className="windal-initial-year-hint">Tap any year to select and continue.</p>
          <div className="windal-initial-year-table-wrap">
            <table className="windal-initial-year-table">
              <thead>
                <tr>
                  <th>Year</th>
                  <th>Company</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                </tr>
              </thead>
              <tbody>
                {years.map((y) => {
                  const uid = String(y.COMP_UID ?? y.comp_uid ?? '');
                  const isSelected = uid === String(selectedUid);
                  const yearLabel = y.COMP_YEAR ?? y.comp_year ?? '';
                  const companyLabel = y.COMP_NAME ?? y.comp_name ?? compName;
                  const sDisp = formatLedgerDateDisplay(y.COMP_S_DT ?? y.comp_s_dt);
                  const eDisp = formatLedgerDateDisplay(y.COMP_E_DT ?? y.comp_e_dt);
                  return (
                    <tr
                      key={uid || yearLabel}
                      className={isSelected ? 'is-selected' : ''}
                      onClick={() => selectYear(y)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          selectYear(y);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-selected={isSelected}
                      aria-label={`Select year ${yearLabel}`}
                    >
                      <td>{yearLabel}</td>
                      <td>{companyLabel}</td>
                      <td>{sDisp}</td>
                      <td>{eDisp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        <div className="windal-initial-btn-row">
          <button type="button" className="windal-initial-btn windal-initial-btn--ghost" onClick={onPrev}>
            ← Back
          </button>
          <button
            type="button"
            className="windal-initial-btn windal-initial-btn--primary"
            onClick={handleNext}
            disabled={!selectedUid}
          >
            ✓ Select & Login
          </button>
        </div>
      </WindalInitialFlowCard>
    </div>
  );
}
