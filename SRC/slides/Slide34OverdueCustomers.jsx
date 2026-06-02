import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import FasReportHeader from '../components/FasReportHeader';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import '../styles/overdueCustomers.css';

function fmtAmt(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Slide34OverdueCustomers({ apiBase, formData, onPrev, onReset, onOpenCustomerLedger }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [asOfDate, setAsOfDate] = useState('');
  const [minDays, setMinDays] = useState(30);
  const [minAmount, setMinAmount] = useState('');
  const [search, setSearch] = useState('');

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const defaultAsOf = useMemo(() => {
    const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (fyEnd) return fyEnd;
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  const loadList = useCallback(async () => {
    if (!compCode || !compUid) {
      setError('Company and financial year are required.');
      setLoading(false);
      return;
    }
    const eDate = toOracleDate(asOfDate || defaultAsOf);
    if (!eDate) {
      setError('As-of date is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/overdue-customers`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          e_date: eDate,
          min_days: minDays,
          min_amount: Math.max(0, Number(String(minAmount).replace(/,/g, '')) || 0),
        },
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load overdue customers.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, asOfDate, defaultAsOf, minDays, minAmount]);

  useEffect(() => {
    setAsOfDate(defaultAsOf);
  }, [defaultAsOf]);

  useEffect(() => {
    if (!asOfDate) return;
    loadList();
  }, [asOfDate, minDays, minAmount, loadList]);

  const sortByName = useCallback((list) => {
    return [...list].sort((a, b) => {
      const na = String(a.NAME ?? a.name ?? '')
        .trim()
        .toUpperCase();
      const nb = String(b.NAME ?? b.name ?? '')
        .trim()
        .toUpperCase();
      const byName = na.localeCompare(nb, 'en', { sensitivity: 'base' });
      if (byName !== 0) return byName;
      return String(a.CODE ?? a.code ?? '').localeCompare(String(b.CODE ?? b.code ?? ''), 'en', {
        numeric: true,
      });
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q
      ? rows
      : rows.filter((r) => {
          const code = String(r.CODE ?? r.code ?? '').toLowerCase();
          const name = String(r.NAME ?? r.name ?? '').toLowerCase();
          const city = String(r.CITY ?? r.city ?? '').toLowerCase();
          return code.includes(q) || name.includes(q) || city.includes(q);
        });
    return sortByName(base);
  }, [rows, search, sortByName]);

  const totalOverdue = useMemo(
    () => filtered.reduce((s, r) => s + (Number(r.OVERDUE_BAL ?? r.overdue_bal) || 0), 0),
    [filtered]
  );

  const handleRowClick = (row) => {
    const code = String(row.CODE ?? row.code ?? '').trim();
    if (!code || !onOpenCustomerLedger) return;
    onOpenCustomerLedger({
      code,
      name: String(row.NAME ?? row.name ?? '').trim(),
      city: String(row.CITY ?? row.city ?? '').trim(),
      asOfDate: asOfDate || defaultAsOf,
    });
  };

  const periodLabel = `${toDisplayDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT))} – ${toDisplayDate(toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT))}`;

  return (
    <div className="slide slide-34-overdue fas-tb-host">
      <div className="fas-flow fas-tb-flow">
        <FasReportHeader
          title="Overdue Customers"
          onBack={onPrev}
          rightSlot={
            <SessionToolbarChrome
              helpReportId="overdue-customers"
              helpLabel="Overdue customers help"
              helpCompanyName={compName}
            />
          }
        />
        <div className="fas-flow-body fas-tb-body overdue-shell">
          <div className="overdue-scroll">
          <div className="overdue-meta">
            <div>
              <strong>{compName}</strong>
              <span className="overdue-meta__sub">
                FY {compYear} · {periodLabel}
              </span>
            </div>
            <span className="overdue-meta__badge">
              Bills pending more than {minDays} days
              {Number(String(minAmount).replace(/,/g, '')) > 0
                ? ` · overdue above ₹ ${fmtAmt(minAmount)}`
                : ''}{' '}
              (as of {toDisplayDate(asOfDate || defaultAsOf)})
            </span>
          </div>

          <div className="overdue-toolbar">
            <label className="overdue-toolbar__field">
              <span>As-of date</span>
              <input
                type="date"
                lang="en-GB"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </label>
            <label className="overdue-toolbar__field overdue-toolbar__field--narrow">
              <span>Min days</span>
              <input
                type="number"
                min={1}
                max={9999}
                value={minDays}
                onChange={(e) => setMinDays(Math.max(1, parseInt(e.target.value, 10) || 30))}
              />
            </label>
            <label className="overdue-toolbar__field overdue-toolbar__field--amount">
              <span>Min amount (ignore below)</span>
              <input
                type="number"
                min={0}
                step={1}
                placeholder="0 = all"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
              />
            </label>
            <label className="overdue-toolbar__field overdue-toolbar__field--grow">
              <span>Search</span>
              <input
                type="search"
                placeholder="Code, name, city…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-secondary overdue-toolbar__refresh" onClick={loadList} disabled={loading}>
              Refresh
            </button>
          </div>

          {loading ? <p className="overdue-status">Loading overdue customers…</p> : null}
          {error ? (
            <p className="overdue-status overdue-status--error" role="alert">
              {error}
            </p>
          ) : null}

          {!loading && !error ? (
            <>
              <p className="overdue-summary">
                {filtered.length} customer{filtered.length === 1 ? '' : 's'} · Total overdue{' '}
                <strong>₹ {fmtAmt(totalOverdue)}</strong>
                {onOpenCustomerLedger ? (
                  <span className="overdue-summary__hint"> · Tap a row to open customer ledger</span>
                ) : null}
              </p>
              <div className="overdue-table-wrap">
                <table className="overdue-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Customer</th>
                      <th>City</th>
                      <th className="num">Bills</th>
                      <th className="num">Max days</th>
                      <th className="num">Overdue amount</th>
                      <th>Oldest bill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="overdue-table__empty">
                          No customers with bills pending more than {minDays} days
                          {Number(String(minAmount).replace(/,/g, '')) > 0
                            ? ` and overdue above ₹ ${fmtAmt(minAmount)}`
                            : ''}
                          .
                        </td>
                      </tr>
                    ) : (
                      filtered.map((row) => {
                        const code = String(row.CODE ?? row.code ?? '');
                        return (
                          <tr
                            key={code}
                            className={onOpenCustomerLedger ? 'overdue-table__row--clickable' : undefined}
                            onClick={() => handleRowClick(row)}
                            title={onOpenCustomerLedger ? `Open customer ledger for ${code}` : undefined}
                          >
                            <td className="overdue-table__code">{code}</td>
                            <td>{row.NAME ?? row.name ?? '—'}</td>
                            <td>{row.CITY ?? row.city ?? '—'}</td>
                            <td className="num">{row.BILL_COUNT ?? row.bill_count ?? 0}</td>
                            <td className="num">{row.MAX_DAYS ?? row.max_days ?? 0}</td>
                            <td className="num overdue-table__amt">₹ {fmtAmt(row.OVERDUE_BAL ?? row.overdue_bal)}</td>
                            <td>{formatLedgerDateDisplay(row.OLDEST_BILL_DATE ?? row.oldest_bill_date)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          </div>

          <div className="overdue-actions">
            <button type="button" className="btn btn-secondary" onClick={onPrev}>
              ← Back to menu
            </button>
            {onReset ? (
              <button type="button" className="btn btn-secondary" onClick={onReset}>
                Home menu
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
