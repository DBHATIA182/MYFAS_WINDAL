import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toDisplayDate } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

function billTotal(r) {
  const n = Number(r.TOTAL ?? r.total ?? r.CUR_BAL ?? r.cur_bal ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function adjNum(r) {
  return Number(String(r.ADJ_AMT ?? r.adj_amt ?? '').replace(/,/g, '')) || 0;
}

function fmtAdjInput(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(2);
}

export default function VoucherPendingBillsModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  partyCode,
  partyName,
  schedule,
  vDate,
  pndBills,
  vouIntShow,
  onApply,
}) {
  const [mode, setMode] = useState('manual');
  const [recvAmt, setRecvAmt] = useState('');
  const [includeInt, setIncludeInt] = useState(false);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('manual');
    setRecvAmt('');
    setIncludeInt(false);
    setRows([]);
    setErr('');
  }, [open, partyCode]);

  const loadBills = async (autoAmt = 0, withInt = false) => {
    if (!partyCode) {
      setErr('Select party code on the line first.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { data } = await axios.get(`${apiBase}/api/voucher-pending-bills`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          code: partyCode,
          schedule,
          v_date: vDate,
          pnd_bills: pndBills,
          vou_int_show: vouIntShow ?? 'Y',
        },
        ...reqOpts,
      });
      let list = Array.isArray(data) ? data.map((r) => ({ ...r, ADJ_AMT: '' })) : [];
      let remaining = Number(autoAmt) || 0;
      if (remaining > 0) {
        list = list.map((r) => {
          if (remaining <= 0) return r;
          const base = withInt ? billTotal(r) : Number(r.CUR_BAL ?? r.cur_bal ?? 0) || 0;
          if (base <= 0) return r;
          const adj = remaining > base ? base : remaining;
          remaining -= adj;
          return { ...r, ADJ_AMT: fmtAdjInput(adj) };
        });
      }
      setRows(list);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const handleModeGo = () => {
    if (mode === 'manual') {
      void loadBills(0, false);
    } else if (mode === 'auto') {
      void loadBills(Number(recvAmt) || 0, false);
    } else {
      void loadBills(Number(recvAmt) || 0, true);
    }
  };

  const totals = useMemo(() => {
    let adj = 0;
    for (const r of rows) adj += adjNum(r);
    return { adj };
  }, [rows]);

  const pickedCount = useMemo(() => rows.filter((r) => adjNum(r) > 0).length, [rows]);

  const setAdj = (idx, val) => {
    const s = String(val ?? '').replace(/[^\d.]/g, '');
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ADJ_AMT: s } : r)));
  };

  const fillAdjFromTotal = (idx) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const total = billTotal(r);
        return { ...r, ADJ_AMT: total > 0 ? total.toFixed(2) : '' };
      })
    );
  };

  const handleApply = () => {
    const picked = rows.filter((r) => adjNum(r) > 0);
    if (!picked.length) {
      alert('Enter adjustment amount on at least one bill.');
      return;
    }
    onApply?.(picked);
    onClose?.();
  };

  if (!open) return null;

  return createPortal(
    <div
      className="sale-bill-modal-backdrop voucher-pending-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="sale-bill-modal voucher-pending-modal" role="dialog">
        <div className="sale-bill-modal-head voucher-pending-modal__head">
          <div>
            <h3>Pending bills</h3>
            <p className="voucher-pending-modal__sub">
              [{partyCode}] {partyName || ''}
            </p>
          </div>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="voucher-pending-modal__body">
          <div className="voucher-pending-modal__modes">
            <label>
              <input type="radio" name="pbmode" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Manual
            </label>
            <label>
              <input type="radio" name="pbmode" checked={mode === 'auto'} onChange={() => setMode('auto')} /> Auto
            </label>
            <label>
              <input type="radio" name="pbmode" checked={mode === 'autoInt'} onChange={() => setMode('autoInt')} /> Auto + Int
            </label>
          </div>
          {mode !== 'manual' ? (
            <div className="voucher-pending-modal__recv">
              <label>
                Amount received
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  value={recvAmt}
                  onChange={(e) => setRecvAmt(e.target.value)}
                />
              </label>
              <label className="voucher-pending-modal__intyn">
                <input type="checkbox" checked={includeInt} onChange={(e) => setIncludeInt(e.target.checked)} disabled={mode === 'autoInt'} />
                Include interest
              </label>
            </div>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={handleModeGo} disabled={loading}>
            {loading ? 'Loading…' : 'Load bills'}
          </button>
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
          <div className="voucher-pending-modal__table-wrap">
            <table className="voucher-pending-table">
              <thead>
                <tr>
                  <th>Bill date</th>
                  <th>Bill no</th>
                  <th>Type</th>
                  <th>Cur bal</th>
                  <th>Int</th>
                  <th>Total</th>
                  <th>Adj amt</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="voucher-pending-table__empty">
                      {loading ? 'Loading…' : 'No pending bills.'}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.BILL_NO}-${r.BILL_DATE}-${i}`}>
                      <td>{toDisplayDate(toInputDateString(r.BILL_DATE ?? r.bill_date))}</td>
                      <td>{r.BILL_NO ?? r.bill_no}</td>
                      <td>{r.B_TYPE ?? r.b_type}</td>
                      <td className="num">{fmtAmt(r.CUR_BAL ?? r.cur_bal)}</td>
                      <td className="num">{fmtAmt(r.INT_AMT ?? r.int_amt)}</td>
                      <td
                        className="num voucher-pending-total-pick"
                        title="Click to fill adjustment amount"
                        onClick={() => fillAdjFromTotal(i)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            fillAdjFromTotal(i);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {fmtAmt(billTotal(r))}
                      </td>
                      <td>
                        <input
                          className="form-input voucher-pending-adj"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={r.ADJ_AMT ?? r.adj_amt ?? ''}
                          onChange={(e) => setAdj(i, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {rows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={6} className="num">
                      <strong>Total adjustment</strong>
                    </td>
                    <td className="num">
                      <strong>{fmtAmt(totals.adj)}</strong>
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
        <div className="voucher-pending-modal__foot">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleApply} disabled={!rows.length || pickedCount === 0}>
            {pickedCount > 1 ? `Apply ${pickedCount} lines to grid` : 'Apply to grid'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
