import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function highlightMatch(text, q) {
  if (text == null) return null;
  const s = String(text);
  const query = String(q ?? '').trim();
  if (!query) return s;
  const lower = s.toLowerCase();
  const qi = lower.indexOf(query.toLowerCase());
  if (qi === -1) return s;
  return (
    <>
      {s.slice(0, qi)}
      <mark className="search-highlight">{s.slice(qi, qi + query.length)}</mark>
      {s.slice(qi + query.length)}
    </>
  );
}

function mapReportRow(r) {
  return {
    SO_NO: r.SO_NO ?? r.so_no,
    SO_DATE: toDisplayDate(toInputDateString(r.SO_DATE ?? r.so_date)),
    CODE: r.CODE ?? r.code,
    PARTY_NAME: r.PARTY_NAME ?? r.party_name ?? r.NAME ?? r.name,
    ITEM_CODE: r.ITEM_CODE ?? r.item_code,
    ITEM_NAME: r.ITEM_NAME ?? r.item_name,
    MARKA: r.MARKA ?? r.marka,
    QNTY: Number(r.QNTY ?? r.qnty ?? 0),
    STATUS: r.STATUS ?? r.status,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0),
    RATE: Number(r.RATE ?? r.rate ?? 0),
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0),
    TRN_NO: r.TRN_NO ?? r.trn_no,
    PO_NO: r.PO_NO ?? r.po_no,
    REMARKS: r.REMARKS ?? r.remarks,
    REMARKS2: r.REMARKS2 ?? r.remarks2,
  };
}

export default function SalesOrderListScreen({
  apiBase,
  formData,
  lookups,
  onClose,
  onOpenOrder,
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [sDate, setSDate] = useState(() => toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [eDate, setEDate] = useState(() => toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));
  const [partyCode, setPartyCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [marka, setMarka] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);

  const parties = lookups?.customers || [];
  const items = lookups?.items || [];
  const markas = lookups?.markas || [];

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return parties.slice(0, 80);
    return parties.filter((p) => {
      const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      return pc.includes(q) || name.includes(q);
    });
  }, [partySearch, parties]);

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 80);
    return items.filter((it) => {
      const ic = String(it.ITEM_CODE ?? it.item_code ?? '').toLowerCase();
      const nm = String(it.ITEM_NAME ?? it.item_name ?? '').toLowerCase();
      return ic.includes(q) || nm.includes(q);
    });
  }, [itemSearch, items]);

  const reportRows = useMemo(() => rows.map(mapReportRow), [rows]);

  const totals = useMemo(() => {
    let q = 0;
    let w = 0;
    let a = 0;
    for (const r of reportRows) {
      q += Number(r.QNTY) || 0;
      w += Number(r.WEIGHT) || 0;
      a += Number(r.AMOUNT) || 0;
    }
    return { qnty: q, weight: w, amount: a };
  }, [reportRows]);

  const partyLabel = useMemo(() => {
    if (!partyCode) return 'All parties';
    const p = parties.find((x) => String(x.CODE ?? x.code) === String(partyCode));
    return p ? `[${partyCode}] ${p.NAME ?? p.name}` : String(partyCode);
  }, [partyCode, parties]);

  const itemLabel = useMemo(() => {
    if (!itemCode) return 'All items';
    const it = items.find((x) => String(x.ITEM_CODE ?? x.item_code) === String(itemCode));
    return it ? `[${itemCode}] ${it.ITEM_NAME ?? it.item_name}` : String(itemCode);
  }, [itemCode, items]);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
      partyLabel,
      itemLabel,
      markaLabel: marka.trim() ? marka.trim() : 'All markas',
    }),
    [compName, sDate, eDate, partyLabel, itemLabel, marka]
  );

  const excelRows = useMemo(
    () =>
      reportRows.map((r) => ({
        SoNo: r.SO_NO,
        SoDate: r.SO_DATE,
        PoNo: r.PO_NO,
        Remarks: r.REMARKS,
        Remarks2: r.REMARKS2,
      })),
    [reportRows]
  );

  const runReport = async () => {
    setErr('');
    if (!sDate || !eDate) {
      setErr('Starting date and ending date are required.');
      return;
    }
    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(sDate),
        e_date: toOracleDate(eDate),
      };
      if (partyCode) params.code = partyCode;
      if (itemCode.trim()) params.item_code = itemCode.trim();
      if (marka.trim()) params.marka = marka.trim();
      const { data } = await axios.get(`${apiBase}/api/sales-order-list-report`, { params, ...reqOpts });
      setRows(Array.isArray(data) ? data : []);
      setRan(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Report failed');
    } finally {
      setLoading(false);
    }
  };

  const clearFilters = () => {
    setPartyCode('');
    setPartySearch('');
    setItemCode('');
    setItemSearch('');
    setMarka('');
  };

  const shareText = `${compName}\nSales order list\n${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}\n${partyLabel}\n${itemLabel}`;

  const hasRows = reportRows.length > 0;
  const listActionButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        ← Back
      </button>
      <button
        type="button"
        className="btn btn-export"
        disabled={!hasRows}
        onClick={() =>
          generatePDF('sales-order-list', { rows: reportRows }, pdfMeta).catch((e) =>
            alert(e?.message || String(e))
          )
        }
      >
        Pdf
      </button>
      <button
        type="button"
        className="btn btn-excel"
        disabled={!hasRows}
        onClick={() => downloadExcelRows(excelRows, 'SalesOrder', `${compName}_SalesOrder_List`)}
      >
        Excel
      </button>
      <button
        type="button"
        className="btn btn-whatsapp"
        disabled={!hasRows}
        title={hasRows ? 'Share list as PDF on WhatsApp' : 'Run report first'}
        onClick={() =>
          sharePdfWithWhatsApp('sales-order-list', { rows: reportRows }, pdfMeta, shareText).catch((e) =>
            alert(e?.message || String(e))
          )
        }
      >
        WhatsApp
      </button>
    </>
  );

  return (
    <div className="slide slide-23-sales-order-list dc-list-screen">
      <header className="dc-list-screen__head">
        <h2 className="sale-bill-page__title">Sales order list</h2>
      </header>

      <DcActionBar position="top" label="List actions">
        {listActionButtons}
      </DcActionBar>

      <section className="sale-bill-section sale-bill-section--card dc-list-filters">
        <h3 className="sale-bill-section__title">Filters</h3>
        <div className="dc-list-filters-grid">
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Starting date</span>
            <input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ending date</span>
            <input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Specific party</span>
            <input
              className="form-input"
              placeholder="Search or leave blank for all"
              value={partySearch}
              onChange={(e) => {
                setPartySearch(e.target.value);
                if (!e.target.value.trim()) setPartyCode('');
              }}
            />
            {partySearch.trim() ? (
              <ul className="account-search-list dc-list-filter-list" role="listbox">
                <li
                  role="option"
                  onClick={() => {
                    setPartyCode('');
                    setPartySearch('');
                  }}
                >
                  <em>All parties</em>
                </li>
                {filteredParties.map((p) => {
                  const pc = String(p.CODE ?? p.code);
                  return (
                    <li
                      key={pc}
                      role="option"
                      className={pc === partyCode ? 'account-search-item--hi' : ''}
                      onClick={() => {
                        setPartyCode(pc);
                        setPartySearch(`[${pc}] ${p.NAME ?? p.name}`);
                      }}
                    >
                      <strong>[{pc}]</strong> {highlightMatch(p.NAME ?? p.name, partySearch)}
                    </li>
                  );
                })}
              </ul>
            ) : partyCode ? (
              <p className="account-selected-hint">Selected: {partyLabel}</p>
            ) : null}
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Specific item</span>
            <input
              className="form-input"
              placeholder="Search or leave blank for all"
              value={itemSearch}
              onChange={(e) => {
                setItemSearch(e.target.value);
                if (!e.target.value.trim()) setItemCode('');
              }}
            />
            {itemSearch.trim() ? (
              <ul className="account-search-list dc-list-filter-list" role="listbox">
                <li
                  role="option"
                  onClick={() => {
                    setItemCode('');
                    setItemSearch('');
                  }}
                >
                  <em>All items</em>
                </li>
                {filteredItems.map((it) => {
                  const ic = String(it.ITEM_CODE ?? it.item_code);
                  return (
                    <li
                      key={ic}
                      role="option"
                      className={ic === itemCode ? 'account-search-item--hi' : ''}
                      onClick={() => {
                        setItemCode(ic);
                        setItemSearch(`[${ic}] ${it.ITEM_NAME ?? it.item_name}`);
                      }}
                    >
                      <strong>[{ic}]</strong> {highlightMatch(it.ITEM_NAME ?? it.item_name, itemSearch)}
                    </li>
                  );
                })}
              </ul>
            ) : itemCode ? (
              <p className="account-selected-hint">Selected: {itemLabel}</p>
            ) : null}
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Specific marka</span>
            <input
              className="form-input"
              list="dc-list-markas"
              value={marka}
              placeholder="All markas"
              onChange={(e) => setMarka(e.target.value)}
            />
            <datalist id="dc-list-markas">
              {markas.map((m, i) => (
                <option key={i} value={String(m.MARKA ?? m.marka ?? m)} />
              ))}
            </datalist>
          </label>
        </div>
        <div className="dc-list-filters-actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runReport()}>
            {loading ? 'Loading…' : 'Run report'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={clearFilters}>
            Clear party / item / marka
          </button>
        </div>
      </section>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      {!ran && !loading ? (
        <p className="sale-bill-section__hint dc-list-run-hint">Set filters and click Run report.</p>
      ) : null}

      {ran ? (
        <section className="sale-bill-section sale-bill-section--card dc-list-results">
          <div className="dc-list-results__toolbar">
            <p className="sale-bill-totals-summary">
              {reportRows.length} line(s) · Qty {totals.qnty} · Wgt {totals.weight.toFixed(3)} · Amt{' '}
              {totals.amount.toFixed(2)}
            </p>
          </div>
          <div className="dc-list-table-wrap">
            <table className="report-table dc-list-table">
              <thead>
                <tr>
                  <th>SO no</th>
                  <th>Date</th>
                  <th>Party</th>
                  <th>Item</th>
                  <th>Marka</th>
                  <th className="num">Qty</th>
                  <th>St</th>
                  <th className="num">Weight</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.length === 0 ? (
                  <tr>
                    <td colSpan={11}>No rows for selected filters.</td>
                  </tr>
                ) : (
                  reportRows.map((r, i) => (
                    <tr
                      key={`${r.SO_NO}-${r.TRN_NO}-${i}`}
                      className="dc-list-row-clickable"
                      title="Open this challan in entry"
                      onClick={() =>
                        onOpenOrder?.({ SO_NO: r.SO_NO })
                      }
                    >
                      <td>{r.SO_NO}</td>
                      <td>{r.SO_DATE}</td>
                      <td className="dc-list-party-cell" title={`[${r.CODE}] ${r.PARTY_NAME ?? ''}`}>
                        <span className="dc-list-party-line">
                          [{r.CODE}] {r.PARTY_NAME}
                        </span>
                      </td>
                      <td>{r.ITEM_CODE}</td>
                      <td>{r.MARKA}</td>
                      <td className="num">{Number(r.QNTY) || ''}</td>
                      <td>{r.STATUS}</td>
                      <td className="num">{Number(r.WEIGHT).toFixed(3)}</td>
                      <td className="num">{Number(r.RATE).toFixed(2)}</td>
                      <td className="num">{Number(r.AMOUNT).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="sale-bill-section__hint">Click a row to open that sales order in the entry screen.</p>
        </section>
      ) : null}

      <DcActionBar position="bottom" label="List actions">
        {listActionButtons}
      </DcActionBar>
    </div>
  );
}
