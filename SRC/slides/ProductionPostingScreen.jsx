import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { DcActionBar } from '../components/DispatchChallanActionBar';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmt3(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '';
  return x.toFixed(3);
}

export default function ProductionPostingScreen({
  apiBase,
  formData,
  defaultSDateYmd,
  defaultSNo,
  onClose,
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;

  const [sDateYmd, setSDateYmd] = useState(() => defaultSDateYmd || toInputDateString(new Date()));
  const [sNo, setSNo] = useState(() => String(defaultSNo ?? ''));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const runPosting = useCallback(async () => {
    setErr('');
    if (!sDateYmd || !String(sNo).trim()) {
      setErr('Date and Sr.No. are required.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/production-stock-posting`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sDateYmd),
          s_no: String(sNo).trim(),
        },
        ...reqOpts,
      });
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setErr(e?.response?.data?.error || e.message || 'Posting load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, sDateYmd, sNo]);

  useEffect(() => {
    if (defaultSDateYmd && defaultSNo) void runPosting();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load from entry screen
  }, []);

  return (
    <div className="slide slide-32-production-posting dc-list-screen">
      <DcActionBar position="top">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          ← Back
        </button>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runPosting()}>
          {loading ? 'Loading…' : 'Show posting'}
        </button>
      </DcActionBar>

      <header className="dc-list-screen__head">
        <h2>Production posting (STOCK type PR)</h2>
        <div className="dc-list-filters">
          <label>
            Date
            <input type="date" className="form-input" value={sDateYmd} onChange={(e) => setSDateYmd(e.target.value)} />
          </label>
          <label>
            Sr.No.
            <input
              className="form-input"
              value={sNo}
              onChange={(e) => setSNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
        </div>
      </header>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className="dc-list-table-wrap prod-posting-table-wrap">
        <table className="report-table prod-posting-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Date</th>
              <th>Vr No</th>
              <th>Item</th>
              <th className="amount">R Qty</th>
              <th className="amount">R Wt</th>
              <th className="amount">R Bags</th>
              <th className="amount">R Katta</th>
              <th className="amount">R Hkatta</th>
              <th className="amount">I Qty</th>
              <th className="amount">I Wt</th>
              <th className="amount">I Bags</th>
              <th className="amount">I Katta</th>
              <th className="amount">I Hkatta</th>
              <th className="amount">Short</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={15}>{loading ? 'Loading…' : 'Show posting to load STOCK rows (save voucher first).'}</td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.TYPE ?? r.type}</td>
                  <td>{toDisplayDate(toInputDateString(r.VR_DATE ?? r.vr_date))}</td>
                  <td>{r.VR_NO ?? r.vr_no}</td>
                  <td>{r.ITEM_CODE ?? r.item_code}</td>
                  <td className="amount">{fmt3(r.R_QNTY ?? r.r_qnty)}</td>
                  <td className="amount">{fmt3(r.R_WEIGHT ?? r.r_weight)}</td>
                  <td className="amount">{fmt3(r.R_BAGS ?? r.r_bags)}</td>
                  <td className="amount">{fmt3(r.R_KATTA ?? r.r_katta)}</td>
                  <td className="amount">{fmt3(r.R_HKATTA ?? r.r_hkatta)}</td>
                  <td className="amount">{fmt3(r.I_QNTY ?? r.i_qnty)}</td>
                  <td className="amount">{fmt3(r.I_WEIGHT ?? r.i_weight)}</td>
                  <td className="amount">{fmt3(r.I_BAGS ?? r.i_bags)}</td>
                  <td className="amount">{fmt3(r.I_KATTA ?? r.i_katta)}</td>
                  <td className="amount">{fmt3(r.I_HKATTA ?? r.i_hkatta)}</td>
                  <td className="amount">{fmt3(r.SHORT ?? r.short)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
