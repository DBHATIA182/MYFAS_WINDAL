import React, { useMemo, useState, useLayoutEffect } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import FasFlowLayout from '../components/FasFlowLayout';

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

/** Prefer FY where today is between start and end; else first row (API: newest comp_year first). */
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

export default function Slide2({ years, formData, onPrev, onNext, flowHeaderActions = null, appName = 'FAS Accounting' }) {
  const [selectedUid, setSelectedUid] = useState('');

  const brand = useMemo(() => {
    const words = String(appName || '').trim().split(/\s+/).filter(Boolean);
    const short = words[0] || 'FAS';
    return { short, letter: short.slice(0, 1).toUpperCase(), sub: 'ACCOUNTING SUITE' };
  }, [appName]);

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

  const handleNext = () => {
    if (!yearObj) {
      alert('Please select a financial year first.');
      return;
    }
    onNext(yearObj);
  };

  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const sDisp = yearObj ? formatLedgerDateDisplay(yearObj.COMP_S_DT ?? yearObj.comp_s_dt) : '';
  const eDisp = yearObj ? formatLedgerDateDisplay(yearObj.COMP_E_DT ?? yearObj.comp_e_dt) : '';

  let isCurrentYear = false;
  if (yearObj) {
    const start = parseDateBoundary(yearObj.COMP_S_DT ?? yearObj.comp_s_dt, false);
    const end = parseDateBoundary(yearObj.COMP_E_DT ?? yearObj.comp_e_dt, true);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    isCurrentYear = Boolean(start && end && today >= start && today <= end);
  }

  return (
    <div className="slide slide-fas-flow">
      <FasFlowLayout
        mode="brand"
        step={3}
        logoLetter={brand.letter}
        productName={brand.short}
        productSub={brand.sub}
        headerActions={flowHeaderActions}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minHeight: 0 }}>
          <div>
            <div className="fas-flow-title">Financial Year</div>
            {compName ? (
              <div className="fas-info-pill" style={{ marginTop: 8 }}>
                <span style={{ color: 'var(--fas-indigo)' }} aria-hidden="true">
                  🏢
                </span>
                {compName}
              </div>
            ) : null}
          </div>

          <div className="fas-field-group">
            <div className="fas-field-label">Select financial year</div>
            <div className="fas-field-input" style={{ paddingRight: 8 }}>
              <span className="fas-field-icon" aria-hidden="true">
                📅
              </span>
              <select value={selectedUid} onChange={(e) => setSelectedUid(e.target.value)}>
                <option value="">-- Select Year --</option>
                {years.map((y) => (
                  <option key={y.COMP_UID} value={y.COMP_UID}>
                    {y.COMP_YEAR}
                    {y.COMP_S_DT
                      ? ` (${formatLedgerDateDisplay(y.COMP_S_DT)} to ${formatLedgerDateDisplay(y.COMP_E_DT)})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {yearObj ? (
            <div className="fas-year-summary">
              <div className="fas-year-summary-label">Year summary</div>
              <div className="fas-year-row">
                <span>Start date</span>
                <strong>{sDisp}</strong>
              </div>
              <div className="fas-year-divider" />
              <div className="fas-year-row">
                <span>End date</span>
                <strong>{eDisp}</strong>
              </div>
              <div className="fas-year-divider" />
              <div className="fas-year-row">
                <span>Status</span>
                <em>{isCurrentYear ? '● Current year' : '○ Other year'}</em>
              </div>
            </div>
          ) : null}

          <div className="fas-btn-row">
            <button type="button" className="fas-btn fas-btn-ghost" onClick={onPrev}>
              ← Back
            </button>
            <button type="button" className="fas-btn fas-btn-primary" onClick={handleNext} disabled={!selectedUid}>
              Next →
            </button>
          </div>
        </div>
      </FasFlowLayout>
    </div>
  );
}
