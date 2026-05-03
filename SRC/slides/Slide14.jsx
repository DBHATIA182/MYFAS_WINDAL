import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerDateDisplay, toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import ReportTable from '../components/ReportTable';

function fmtAmt(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n === 0) return '-';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Slide14({ apiBase, formData, onPrev, onReset }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [vrType, setVrType] = useState('');
  const [partyCode, setPartyCode] = useState('');
  const [cashBankCode, setCashBankCode] = useState('');
  const [drcrFlag, setDrcrFlag] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows] = useState([]);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [voucherRows, setVoucherRows] = useState(null);
  const [voucherTitle, setVoucherTitle] = useState('');
  const topScrollRef = useRef(null);
  const topInnerRef = useRef(null);
  const gridScrollRef = useRef(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(new Date());
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/api/accounts`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
        });
        setAccounts(Array.isArray(data) ? data : []);
      } catch {
        setAccounts([]);
      }
    })();
  }, [apiBase, compCode, compUid]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const r of rows) {
      dr += parseFloat(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
      cr += parseFloat(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    }
    return { dr, cr };
  }, [rows]);

  useEffect(() => {
    if (!showReport || voucherRows != null) return;
    const top = topScrollRef.current;
    const topInner = topInnerRef.current;
    const grid = gridScrollRef.current;
    if (!top || !topInner || !grid) return;
    let syncingFromTop = false;
    let syncingFromGrid = false;
    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth ? 'block' : 'none';
    };
    const onTopScroll = () => {
      if (syncingFromGrid) return;
      syncingFromTop = true;
      grid.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };
    const onGridScroll = () => {
      if (syncingFromTop) return;
      syncingFromGrid = true;
      top.scrollLeft = grid.scrollLeft;
      syncingFromGrid = false;
    };
    syncWidths();
    top.addEventListener('scroll', onTopScroll, { passive: true });
    grid.addEventListener('scroll', onGridScroll, { passive: true });
    window.addEventListener('resize', syncWidths);
    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
    };
  }, [showReport, voucherRows, rows]);

  const runVoucherDetail = async (row) => {
    const vrType = row.VR_TYPE ?? row.vr_type;
    const vrNo = row.VR_NO ?? row.vr_no;
    const vrDate = row.VR_DATE ?? row.vr_date;
    const n = Number(vrNo);
    const ymd = toInputDateString(vrDate);
    if (!vrType || !Number.isFinite(n) || n <= 0 || !ymd) {
      alert('Cannot open voucher: missing vr_type, vr_no or vr_date.');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.get(`${apiBase}/api/ledger-voucher`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: String(vrType).trim(),
          vr_date: toOracleDate(ymd),
          vr_no: n,
        },
        withCredentials: true,
        timeout: 60000,
      });
      const detailRows = Array.isArray(response.data) ? response.data : [];
      if (detailRows.length === 0) {
        alert('No voucher lines found for this voucher.');
        return;
      }
      setVoucherRows(detailRows);
      setVoucherTitle(`${String(vrType).trim()} ${n} · ${toDisplayDate(ymd)}`);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message || 'Voucher load failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const sDate = toOracleDate(startDate);
    const eDate = toOracleDate(endDate);
    if (!sDate || !eDate) {
      alert('Please choose start and end date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/voucher-list`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: vrType,
          s_date: sDate,
          e_date: eDate,
          code: cashBankCode.trim().toUpperCase(),
          dc_code: partyCode.trim().toUpperCase(),
          drcr_flag: drcrFlag,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data) ? data : []);
      setShowReport(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load voucher list');
    } finally {
      setLoading(false);
    }
  };

  if (showReport) {
    if (voucherRows != null) {
      return (
        <div className="slide slide-report">
          <div className="report-toolbar">
            <h2>Voucher entries</h2>
            <div className="toolbar-actions">
              <button type="button" className="btn btn-toolbar-back" onClick={() => setVoucherRows(null)}>
                ← Back to list
              </button>
              <button
                type="button"
                className="btn btn-excel"
                onClick={() => {
                  try {
                    const tag = String(voucherTitle || 'voucher').replace(/\s+/g, '_');
                    downloadExcelRows(voucherRows, 'Voucher', `${compName || 'Company'}_${tag}`);
                  } catch (e) {
                    alert(String(e?.message || e));
                  }
                }}
              >
                📊 Excel
              </button>
            </div>
          </div>
          <p className="ledger-report-voucher-ref">
            Voucher: <strong>{voucherTitle}</strong>
          </p>
          <div className="report-display">
            <ReportTable data={voucherRows} type="ledger-voucher" />
          </div>
          <div className="button-group">
            <button type="button" className="btn btn-secondary" onClick={() => setVoucherRows(null)}>
              ← Back to list
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
              ← Back
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>Cash/Bank/Journal Voucher List</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(rows, 'VoucherList', `${compName}_VoucherList_${vrType || 'ALL'}`);
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
            <strong>{compName}</strong> | FY {compYear}
            <br />
            {toDisplayDate(startDate)} - {toDisplayDate(endDate)} · Voucher type: {vrType || 'All'} · Party:{' '}
            {partyCode || 'All'} · Cash/Bank code: {cashBankCode || 'All'} · Entries: {drcrFlag || 'Both'}
          </p>
        </div>

        <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={topScrollRef} aria-hidden="true">
          <div className="sale-list-scroll-sync-inner" ref={topInnerRef} />
        </div>
        <div className="table-responsive table-responsive--voucher-list" ref={gridScrollRef}>
          <table className="report-table report-table--voucher-list">
            <thead>
              <tr>
                <th>Vr Type</th>
                <th>Vr Date</th>
                <th>Vr No</th>
                <th>Type</th>
                <th>Trn</th>
                <th>V Date</th>
                <th>Code</th>
                <th>Name</th>
                <th>City</th>
                <th>Bill Date</th>
                <th>Bill No</th>
                <th>B Type</th>
                <th>Detail</th>
                <th className="text-right">Dr Amt</th>
                <th className="text-right">Cr Amt</th>
                <th className="text-right">Cd Amt</th>
                <th>DC Code</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={idx}
                  className="sale-list-row-clickable"
                  onClick={() => runVoucherDetail(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      runVoucherDetail(r);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  title="Open voucher entries"
                >
                  <td>{r.VR_TYPE ?? r.vr_type ?? '—'}</td>
                  <td>{formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date)}</td>
                  <td>{r.VR_NO ?? r.vr_no ?? '—'}</td>
                  <td>{r.TYPE ?? r.type ?? '—'}</td>
                  <td>{r.TRN_NO ?? r.trn_no ?? '—'}</td>
                  <td>{formatLedgerDateDisplay(r.V_DATE ?? r.v_date)}</td>
                  <td>{r.CODE ?? r.code ?? '—'}</td>
                  <td>{r.NAME ?? r.name ?? '—'}</td>
                  <td>{r.CITY ?? r.city ?? '—'}</td>
                  <td>{formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date)}</td>
                  <td>{r.BILL_NO ?? r.bill_no ?? '—'}</td>
                  <td>{r.B_TYPE ?? r.b_type ?? '—'}</td>
                  <td>{r.DETAIL ?? r.detail ?? '—'}</td>
                  <td className="text-right">{fmtAmt(r.DR_AMT ?? r.dr_amt)}</td>
                  <td className="text-right">{fmtAmt(r.CR_AMT ?? r.cr_amt)}</td>
                  <td className="text-right">{fmtAmt(r.CD_AMT ?? r.cd_amt)}</td>
                  <td>{r.DC_CODE ?? r.dc_code ?? '—'}</td>
                </tr>
              ))}
              <tr className="bill-ledger-grand-total">
                <td colSpan={13}>
                  <strong>GRAND TOTAL</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.dr)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.cr)}</strong>
                </td>
                <td className="text-right">
                  <strong>—</strong>
                </td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-14">
      <h2>Cash/Bank/Journal Voucher List</h2>
      <p className="company-info">
        {compName} | FY {compYear}
      </p>
      <form className="report-form" onSubmit={handleSubmit}>
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label>Starting date</label>
            <input className="form-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Ending date</label>
            <input className="form-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label>Voucher type</label>
            <select className="form-select" value={vrType} onChange={(e) => setVrType(e.target.value)}>
              <option value="">All</option>
              <option value="JV">JV (Journal)</option>
              <option value="BV">BV (Bank)</option>
              <option value="CV">CV (Cash)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Entries</label>
            <select className="form-select" value={drcrFlag} onChange={(e) => setDrcrFlag(e.target.value)}>
              <option value="">Both (blank)</option>
              <option value="D">Debit entries</option>
              <option value="C">Credit entries</option>
            </select>
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label>Specific party (DC_CODE)</label>
            <input
              className="form-input"
              list="voucher-party-codes"
              value={partyCode}
              onChange={(e) => setPartyCode(e.target.value.toUpperCase())}
              placeholder="Blank = all"
            />
          </div>
          <div className="form-group">
            <label>Specific cash/bank code</label>
            <input
              className="form-input"
              list="voucher-cashbank-codes"
              value={cashBankCode}
              onChange={(e) => setCashBankCode(e.target.value.toUpperCase())}
              placeholder="Blank = all"
            />
          </div>
        </div>

        <datalist id="voucher-party-codes">
          {accounts.map((a) => (
            <option key={`p-${a.CODE ?? a.code}`} value={String(a.CODE ?? a.code ?? '')}>
              {String(a.NAME ?? a.name ?? '')}
            </option>
          ))}
        </datalist>
        <datalist id="voucher-cashbank-codes">
          {accounts.map((a) => (
            <option key={`c-${a.CODE ?? a.code}`} value={String(a.CODE ?? a.code ?? '')}>
              {String(a.NAME ?? a.name ?? '')}
            </option>
          ))}
        </datalist>

        {error ? (
          <p className="form-api-error">
            <strong>Could not load voucher list.</strong> {error}
          </p>
        ) : null}
      </form>
    </div>
  );
}
