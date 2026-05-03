import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';

function todayInputValue() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function Slide12({ apiBase, onPrev, onReset, formData }) {
  const VIEW = { FORM: 'form', REPORT: 'report', DETAIL: 'detail' };
  const [schedule, setSchedule] = useState('8.10');
  const [endDate, setEndDate] = useState('');
  const [mlb, setMlb] = useState('L');
  const [ranges, setRanges] = useState([
    { from: '0', to: '30' },
    { from: '31', to: '60' },
    { from: '61', to: '90' },
    { from: '91', to: '180' },
    { from: '181', to: '99999' },
  ]);
  const [reportData, setReportData] = useState([]);
  const [viewMode, setViewMode] = useState(VIEW.FORM);
  const [loading, setLoading] = useState(false);
  const [detailRows, setDetailRows] = useState([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailType, setDetailType] = useState('ledger');

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    setEndDate(todayInputValue());
  }, []);

  const rangeLabels = useMemo(
    () => ranges.map((item) => `${item.from || 0} to ${item.to || item.from || 0}`),
    [ranges]
  );

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      schedule: schedule.trim(),
      endingDate: toDisplayDate(endDate),
      modeLabel: mlb === 'L' ? 'Ledger' : 'Bills',
      rangeLabels,
    }),
    [compName, compYear, schedule, endDate, mlb, rangeLabels]
  );

  const handleRangeChange = (idx, key, value) => {
    setRanges((prev) => prev.map((item, i) => (i === idx ? { ...item, [key]: value } : item)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!schedule.trim() || Number.isNaN(Number(schedule))) {
      alert('Please enter a valid schedule number.');
      return;
    }
    if (!endDate) {
      alert('Please enter the ending date.');
      return;
    }
    for (let i = 0; i < ranges.length; i += 1) {
      const from = Number(ranges[i].from);
      const to = Number(ranges[i].to);
      if (Number.isNaN(from) || Number.isNaN(to) || from < 0 || to < from) {
        alert(`Please enter a valid day range for bucket ${i + 1}.`);
        return;
      }
    }

    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        schedule: schedule.trim(),
        e_date: toOracleDate(endDate),
        mlb,
        range1: ranges[0].from,
        range2: ranges[0].to,
        range3: ranges[1].from,
        range4: ranges[1].to,
        range5: ranges[2].from,
        range6: ranges[2].to,
        range7: ranges[3].from,
        range8: ranges[3].to,
        range9: ranges[4].from,
        range10: ranges[4].to,
      };

      const { data } = await axios.get(`${apiBase}/api/ageing`, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert('No ageing rows returned for this schedule/date. Try another schedule, source, or ending date.');
        return;
      }
      setReportData(rows);
      setViewMode(VIEW.REPORT);
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const openPendingEntries = async (code, nameHint) => {
    const accountCode = String(code || '').trim();
    if (!accountCode) return;
    const startDate = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    if (!startDate || !endDate) {
      alert('Financial year dates are missing. Re-select the year and try again.');
      return;
    }

    setLoading(true);
    try {
      if (mlb === 'B') {
        const { data } = await axios.get(`${apiBase}/api/ageing-bills-detail`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            code: accountCode,
            schedule: schedule.trim(),
            e_date: toOracleDate(endDate),
          },
          withCredentials: true,
          timeout: 120000,
        });
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          alert('No pending bill entries found for this account.');
          return;
        }
        setDetailRows(rows);
        setDetailType('ageing-bills-detail');
      } else {
        const { data } = await axios.get(`${apiBase}/api/ageing-ledger-detail`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            code: accountCode,
            schedule: schedule.trim(),
            e_date: toOracleDate(endDate),
          },
          withCredentials: true,
          timeout: 120000,
        });
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          alert('No pending ledger entries found for this account.');
          return;
        }
        setDetailRows(rows);
        setDetailType('ageing-ledger-detail');
      }
      setDetailTitle(`${nameHint || accountCode} (${accountCode})`);
      setViewMode(VIEW.DETAIL);
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const shareWhatsApp = () => {
    const shareText = [
      `Ageing report — ${compName}`,
      `${compYear} | Schedule ${schedule.trim()} | ${mlb === 'L' ? 'Ledger' : 'Bills'}`,
      `Ending date ${toDisplayDate(endDate)}`,
    ].join('\n');
    return sharePdfWithWhatsApp('ageing', reportData, pdfMeta, shareText);
  };

  if (viewMode === VIEW.DETAIL && detailRows.length > 0) {
    return (
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>{mlb === 'B' ? 'Pending bill entries' : 'Pending ledger entries'}</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.REPORT)}>
              ← Back to ageing
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  const tag = String(detailTitle || 'detail').replace(/\s+/g, '_');
                  downloadExcelRows(detailRows, 'AgeingDetail', `${compName}_Ageing_${tag}`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>{detailTitle}</strong>
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Up to {toDisplayDate(endDate)} · {mlb === 'B' ? 'Outstanding bills only' : 'FIFO pending ledger balance'}
          </p>
        </div>

        <div className="report-display">
          <ReportTable data={detailRows} type={detailType} />
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setViewMode(VIEW.REPORT)}>
            ← Back to ageing
          </button>
        </div>
      </div>
    );
  }

  if (viewMode === VIEW.REPORT && reportData.length > 0) {
    return (
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>Ageing report</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.FORM)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-export"
              onClick={() => generatePDF('ageing', reportData, pdfMeta).catch((err) => alert(err?.message || String(err)))}
            >
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(reportData, 'Ageing', `${compName}_Ageing`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button
              type="button"
              className="btn btn-whatsapp"
              onClick={() => shareWhatsApp().catch((err) => alert(err?.message || String(err)))}
            >
              💬 WhatsApp
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>Schedule</strong> {schedule.trim()} · <strong>Source</strong> {mlb === 'L' ? 'Ledger' : 'Bills'}
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Ending date {toDisplayDate(endDate)}
            <br />
            Buckets: {rangeLabels.join(' | ')}
            <br />
            Click any account row to open pending entries.
          </p>
        </div>

        <div className="report-display">
          <ReportTable
            data={reportData}
            type="ageing"
            meta={{ rangeLabels, schedule }}
            onLedgerClick={openPendingEntries}
          />
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setViewMode(VIEW.FORM)}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-ageing-form">
      <h2>Ageing report — parameters</h2>

      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">Select schedule, ending date, source, and the five ageing buckets.</span>
      </p>

      <form onSubmit={handleSubmit} className="report-form report-form--ageing">
        <div className="button-group button-group--form-top">
          <button type="button" onClick={onPrev} className="btn btn-secondary">
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="ageing-schedule">Schedule No.</label>
          <input
            id="ageing-schedule"
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="Example: 8.10"
          />
        </div>

        <div className="form-row-broker form-row-ageing-meta">
          <div className="form-group">
            <label htmlFor="ageing-end-date">Ending Date</label>
            <input id="ageing-end-date" type="date" lang="en-GB" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label htmlFor="ageing-mlb">Ledger / Bills</label>
            <select id="ageing-mlb" value={mlb} onChange={(e) => setMlb(e.target.value)}>
              <option value="L">Ledger</option>
              <option value="B">Bills</option>
            </select>
          </div>
        </div>

        <div className="ageing-range-card-grid">
        {ranges.map((item, idx) => (
          <div className="form-row-broker ageing-range-card" key={idx}>
            <div className="form-group">
              <label htmlFor={`range-from-${idx}`}>Range {idx + 1} From</label>
              <input
                id={`range-from-${idx}`}
                type="number"
                min="0"
                value={item.from}
                onChange={(e) => handleRangeChange(idx, 'from', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor={`range-to-${idx}`}>Range {idx + 1} To</label>
              <input
                id={`range-to-${idx}`}
                type="number"
                min="0"
                value={item.to}
                onChange={(e) => handleRangeChange(idx, 'to', e.target.value)}
              />
            </div>
          </div>
        ))}
        </div>

        <div className="button-group">
          <button type="button" onClick={onPrev} className="btn btn-secondary">
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>
      </form>
    </div>
  );
}
