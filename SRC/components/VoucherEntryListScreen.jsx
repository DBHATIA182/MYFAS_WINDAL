import React, { useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  defaultDocDateInFinYear,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function groupVoucherListRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const vt = String(r.VR_TYPE ?? r.vr_type ?? '').trim();
    const ymd = toInputDateString(r.VR_DATE ?? r.vr_date);
    const no = r.VR_NO ?? r.vr_no;
    const tp = String(r.TYPE ?? r.type ?? 'N').trim().toUpperCase();
    const key = `${vt}|${ymd}|${no}|${tp}`;
    let g = map.get(key);
    if (!g) {
      g = {
        vr_type: vt,
        vr_date: ymd,
        vr_no: no,
        type: tp,
        dc_code: r.DC_CODE ?? r.dc_code,
        dr: 0,
        cr: 0,
        lines: 0,
        party: r.NAME ?? r.name ?? '',
      };
      map.set(key, g);
    }
    g.dr += Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    g.cr += Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    g.lines += 1;
  }
  return Array.from(map.values()).sort((a, b) => {
    const d = String(a.vr_date || '').localeCompare(String(b.vr_date || ''));
    if (d) return d;
    const t = String(a.vr_type || '').localeCompare(String(b.vr_type || ''));
    if (t) return t;
    return (Number(a.vr_no) || 0) - (Number(b.vr_no) || 0);
  });
}

export default function VoucherEntryListScreen({ apiBase, formData, defaultVrType, onClose, onOpenVoucher }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const finYear = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);

  const [startDate, setStartDate] = useState(() => finYear.fyMinYmd || toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [endDate, setEndDate] = useState(() =>
    defaultDocDateInFinYear(finYear.fyMinYmd, finYear.fyMaxYmd) || toInputDateString(new Date())
  );
  const [vrType, setVrType] = useState(defaultVrType || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);

  const grouped = useMemo(() => groupVoucherListRows(rows), [rows]);

  const totals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const g of grouped) {
      dr += g.dr;
      cr += g.cr;
    }
    return { dr, cr };
  }, [grouped]);

  const runList = async () => {
    const sDate = toOracleDate(startDate);
    const eDate = toOracleDate(endDate);
    if (!sDate || !eDate) {
      alert('Choose start and end date.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { data } = await axios.get(`${apiBase}/api/voucher-list`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: vrType || undefined,
          s_date: sDate,
          e_date: eDate,
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data) ? data : []);
      setRan(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'List failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const openRow = (g) => {
    onOpenVoucher?.({
      vr_type: g.vr_type,
      vr_date: g.vr_date,
      vr_no: g.vr_no,
      type: g.type,
    });
  };

  return (
    <div className="slide slide-28-voucher-list sale-bill-page">
      <div className="report-toolbar">
        <h2 className="sale-bill-page__title">Voucher list</h2>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            ← Back to entry
          </button>
        </div>
      </div>

      <SessionInfoLine formData={formData} />

      <div className="voucher-entry-list-filters">
        <label className="voucher-entry-field">
          <span>From date</span>
          <input className="form-input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="voucher-entry-field">
          <span>To date</span>
          <input className="form-input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="voucher-entry-field">
          <span>Voucher type</span>
          <select className="form-input" value={vrType} onChange={(e) => setVrType(e.target.value)}>
            <option value="">All</option>
            <option value="CV">CV — Cash</option>
            <option value="BV">BV — Bank</option>
            <option value="JV">JV — Journal</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => void runList()} disabled={loading}>
          {loading ? 'Loading…' : 'View list'}
        </button>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className="table-responsive table-responsive--voucher-list">
        <table className="report-table report-table--voucher-list">
          <thead>
            <tr>
              <th>Type</th>
              <th>Date</th>
              <th>No.</th>
              <th>R/N</th>
              <th>Cash/Bank</th>
              <th>Party (1st line)</th>
              <th className="text-right">Dr</th>
              <th className="text-right">Cr</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {!ran ? (
              <tr>
                <td colSpan={9} className="voucher-entry-list-empty">
                  Set dates and click View list.
                </td>
              </tr>
            ) : grouped.length === 0 ? (
              <tr>
                <td colSpan={9} className="voucher-entry-list-empty">
                  No vouchers in this range.
                </td>
              </tr>
            ) : (
              grouped.map((g) => (
                <tr
                  key={`${g.vr_type}-${g.vr_date}-${g.vr_no}-${g.type}`}
                  className="sale-list-row-clickable"
                  onClick={() => openRow(g)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openRow(g);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  title="Open voucher in entry"
                >
                  <td>{g.vr_type || '—'}</td>
                  <td>{toDisplayDate(g.vr_date)}</td>
                  <td>{g.vr_no ?? '—'}</td>
                  <td>{g.type || 'N'}</td>
                  <td>{g.dc_code ?? '—'}</td>
                  <td>{g.party || '—'}</td>
                  <td className="text-right">{fmtAmt(g.dr)}</td>
                  <td className="text-right">{fmtAmt(g.cr)}</td>
                  <td>{g.lines}</td>
                </tr>
              ))
            )}
            {grouped.length > 0 ? (
              <tr className="bill-ledger-grand-total">
                <td colSpan={6}>
                  <strong>TOTAL ({grouped.length} vouchers)</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.dr)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.cr)}</strong>
                </td>
                <td>—</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
