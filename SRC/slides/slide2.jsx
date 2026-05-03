import React, { useState, useLayoutEffect } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';

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

export default function Slide2({ years, formData, onPrev, onNext }) {
  const [selectedUid, setSelectedUid] = useState('');

  useLayoutEffect(() => {
    if (!years?.length) {
      setSelectedUid('');
      return;
    }
    const uid = defaultYearUid(years);
    if (uid) setSelectedUid(uid);
  }, [years]);

  const handleNext = () => {
    // FIX: Force both to String to ensure the match works regardless of type
    const yearObj = years.find(y => String(y.COMP_UID) === String(selectedUid));

    if (yearObj) {
      // We pass the data up to App.jsx
      onNext(yearObj); 
    } else {
      alert("Please select a financial year first.");
    }
  };

  return (
    <div className="slide">
      <h2>Step 2: Select Financial Year</h2>
      {/* Support both UPPER and lower case for the company name display */}
      <p>Company: <strong>{formData.comp_name || formData.COMP_NAME}</strong></p>
      
      <div className="form-group">
        <label>Select Financial Year:</label>
        <select 
          className="form-select"
          value={selectedUid} 
          onChange={(e) => setSelectedUid(e.target.value)}
        >
          <option value="">-- Select Year --</option>
          {years.map((y) => (
            <option key={y.COMP_UID} value={y.COMP_UID}>
              {y.COMP_YEAR} 
              {/* Force dd/mm/yyyy regardless of browser/OS locale */}
              {y.COMP_S_DT
                ? ` (${formatLedgerDateDisplay(y.COMP_S_DT)} to ${formatLedgerDateDisplay(y.COMP_E_DT)})`
                : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="button-group">
        <button className="btn btn-secondary" onClick={onPrev}>← Back</button>
        <button className="btn btn-primary" onClick={handleNext} disabled={!selectedUid}>
          Next →
        </button>
      </div>
    </div>
  );
}