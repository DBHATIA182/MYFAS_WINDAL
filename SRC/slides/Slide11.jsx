import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import PurchaseBillPrintModal from '../components/PurchaseBillPrintModal';

function n(row, upper, lower) {
  const v = row?.[upper] ?? row?.[lower];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function isDn(row) {
  return String(row?.TYPE ?? row?.type ?? '').trim().toUpperCase() === 'DN';
}

function signedDnVal(row, upper, lower) {
  const v = n(row, upper, lower);
  return isDn(row) ? -Math.abs(v) : v;
}

function fmtQty(v) {
  const x = parseFloat(v);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function fmtAmt(v) {
  const x = parseFloat(v) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function t(row, upper, lower) {
  return String(row?.[upper] ?? row?.[lower] ?? '').trim();
}

function cmpTxt(a, b) {
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });
}

export default function Slide11({ apiBase, formData, onPrev, onReset }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [code, setCode] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [purCode, setPurCode] = useState('');
  const [godCode, setGodCode] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [items, setItems] = useState([]);
  const [purCodes, setPurCodes] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [lookupError, setLookupError] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [purchaseSortMode, setPurchaseSortMode] = useState('date');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    setLookupError('');
    (async () => {
      try {
        const [s, i, p, g] = await Promise.all([
          axios.get(`${apiBase}/api/purchaselist-suppliers`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/purchaselist-items`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/purchaselist-purcodes`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/purchaselist-godowns`, { params: { comp_code: compCode, comp_uid: compUid } }),
        ]);
        setSuppliers(Array.isArray(s.data) ? s.data : []);
        setItems(Array.isArray(i.data) ? i.data : []);
        setPurCodes(Array.isArray(p.data) ? p.data : []);
        setGodowns(Array.isArray(g.data) ? g.data : []);
      } catch (err) {
        setLookupError(
          err.response?.status === 404
            ? `No /api/purchaselist-* routes on ${formatApiOrigin(apiBase)}. Restart API with latest server.cjs.`
            : err.response?.data?.error || err.message || 'Failed to load search help'
        );
      }
    })();
  }, [apiBase, compCode, compUid]);

  const sortedRows = useMemo(() => {
    const out = [...rows];
    const compareDateTail = (a, b) => {
      const dCmp = cmpTxt(toInputDateString(a.R_DATE ?? a.r_date), toInputDateString(b.R_DATE ?? b.r_date));
      if (dCmp !== 0) return dCmp;
      const rCmp = cmpTxt(t(a, 'R_NO', 'r_no'), t(b, 'R_NO', 'r_no'));
      if (rCmp !== 0) return rCmp;
      return (parseFloat(a.TRN_NO ?? a.trn_no) || 0) - (parseFloat(b.TRN_NO ?? b.trn_no) || 0);
    };
    out.sort((a, b) => {
      if (purchaseSortMode === 'party') {
        const nCmp = cmpTxt(t(a, 'NAME', 'name'), t(b, 'NAME', 'name'));
        if (nCmp !== 0) return nCmp;
        const cCmp = cmpTxt(t(a, 'CODE', 'code'), t(b, 'CODE', 'code'));
        if (cCmp !== 0) return cCmp;
      } else if (purchaseSortMode === 'item') {
        const nCmp = cmpTxt(t(a, 'ITEM_NAME', 'item_name'), t(b, 'ITEM_NAME', 'item_name'));
        if (nCmp !== 0) return nCmp;
        const cCmp = cmpTxt(t(a, 'ITEM_CODE', 'item_code'), t(b, 'ITEM_CODE', 'item_code'));
        if (cCmp !== 0) return cCmp;
      } else if (purchaseSortMode === 'broker') {
        const nCmp = cmpTxt(t(a, 'PUR_NAME', 'pur_name'), t(b, 'PUR_NAME', 'pur_name'));
        if (nCmp !== 0) return nCmp;
        const cCmp = cmpTxt(t(a, 'PUR_CODE', 'pur_code'), t(b, 'PUR_CODE', 'pur_code'));
        if (cCmp !== 0) return cCmp;
      }
      return compareDateTail(a, b);
    });
    return out;
  }, [rows, purchaseSortMode]);

  const totals = useMemo(() => {
    let q = 0;
    let w = 0;
    let a = 0;
    let tx = 0;
    let c = 0;
    let s = 0;
    let i = 0;
    let b = 0;
    for (const r of sortedRows) {
      q += signedDnVal(r, 'QNTY', 'qnty');
      w += signedDnVal(r, 'WEIGHT', 'weight');
      a += signedDnVal(r, 'AMOUNT', 'amount');
      tx += signedDnVal(r, 'TAXABLE', 'taxable');
      c += signedDnVal(r, 'CGST_AMT', 'cgst_amt');
      s += signedDnVal(r, 'SGST_AMT', 'sgst_amt');
      i += signedDnVal(r, 'IGST_AMT', 'igst_amt');
      b += signedDnVal(r, 'BILL_AMT', 'bill_amt');
    }
    return { q, w, a, tx, c, s, i, b };
  }, [sortedRows]);

  const pdfData = useMemo(() => ({ rows: sortedRows }), [sortedRows]);
  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(startDate),
      endDate: toDisplayDate(endDate),
      supplierLabel: code || 'All',
      itemLabel: itemCode || 'All',
      purLabel: purCode || 'All',
      godLabel: godCode || 'All',
    }),
    [compName, startDate, endDate, code, itemCode, purCode, godCode]
  );

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
      const { data } = await axios.get(`${apiBase}/api/purchase-list`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: sDate,
          e_date: eDate,
          code,
          item_code: itemCode,
          pur_code: purCode,
          god_code: godCode,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data) ? data : []);
      setPurchaseSortMode('date');
      setShowReport(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load purchase list');
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = () =>
    generatePDF('purchase-list', pdfData, pdfMeta).catch((err) => alert(String(err?.message || err)));
  const shareWa = () =>
    sharePdfWithWhatsApp(
      'purchase-list',
      pdfData,
      pdfMeta,
      ['Purchase list', compName, `${pdfMeta.startDate} - ${pdfMeta.endDate}`].join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const openPurchaseBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const rNo = row.R_NO ?? row.r_no;
    const rDt = row.R_DATE ?? row.r_date;
    const ymd = toInputDateString(rDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || rNo == null || rNo === '' || !oracleDt) {
      alert('Cannot open bill: missing type, R no, or R date.');
      return;
    }
    setBillPrintParams({
      type: String(typ).trim(),
      rNo: String(rNo).trim(),
      oracleDt,
      label: `Purchase — ${String(typ).trim()} / ${String(rNo).trim()} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  if (showReport) {
    const purchaseSortLabel =
      purchaseSortMode === 'party'
        ? 'Party-wise'
        : purchaseSortMode === 'item'
          ? 'Item-wise'
          : purchaseSortMode === 'broker'
            ? 'Broker/Purchase code-wise'
            : 'Date-wise';
    return (
      <div className="slide slide-report slide-11">
        <PurchaseBillPrintModal
          open={billPrintOpen}
          onClose={() => {
            setBillPrintOpen(false);
            setBillPrintParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={billPrintParams}
          companyName={compName}
        />
        <div className="report-toolbar">
          <h2>Purchase list</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={downloadPdf}>
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(sortedRows, 'PurchaseList', `${compName}_PurchaseList`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareWa}>
              💬 WhatsApp
            </button>
          </div>
        </div>

        <div className="report-sort-switch" role="group" aria-label="Purchase list sort">
          <span className="report-sort-switch__label">Sort:</span>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'date' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('date')}
          >
            Date
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'party' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('party')}
          >
            Party
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'item' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('item')}
          >
            Item
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${purchaseSortMode === 'broker' ? ' is-active' : ''}`}
            onClick={() => setPurchaseSortMode('broker')}
          >
            Broker/Pur
          </button>
        </div>

        <div className="report-info">
          <p>
            <strong>Dates</strong> {toDisplayDate(startDate)} - {toDisplayDate(endDate)} · <strong>Supplier</strong> {code || 'All'} ·{' '}
            <strong>Item</strong> {itemCode || 'All'} · <strong>Purchase code</strong> {purCode || 'All'} · <strong>Godown</strong>{' '}
            {godCode || 'All'}
          </p>
          <p>
            {compName} | FY {compYear} — TYPE DN rows show qty/weight/amount/tax columns in negative. Click any data row to
            open the purchase bill / debit note print. Current view: <strong>{purchaseSortLabel}</strong>.
          </p>
        </div>

        <div className="report-display table-responsive">
          <table className="report-table purchase-list-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>R date</th>
                <th>R no</th>
                <th>Bill date</th>
                <th>Bill no</th>
                <th>Supplier</th>
                <th>Name</th>
                <th>Trn</th>
                <th>Pur code</th>
                <th>Pur name</th>
                <th>Item</th>
                <th>Item name</th>
                <th>God</th>
                <th>Lot</th>
                <th>B no</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Weight</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
                <th className="text-right">IGST</th>
                <th className="text-right">Freight</th>
                <th className="text-right">Labour</th>
                <th className="text-right">Bill amt</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr
                  key={`${r.R_NO ?? r.r_no}-${r.TRN_NO ?? r.trn_no}-${i}`}
                  className="purchase-list-row-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => openPurchaseBill(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openPurchaseBill(r);
                    }
                  }}
                >
                  <td>{r.TYPE ?? r.type ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.R_DATE ?? r.r_date)}</td>
                  <td>{r.R_NO ?? r.r_no ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date)}</td>
                  <td>{r.BILL_NO ?? r.bill_no ?? '—'}</td>
                  <td>{r.CODE ?? r.code ?? '—'}</td>
                  <td className="ledger-detail">{r.NAME ?? r.name ?? '—'}</td>
                  <td>{r.TRN_NO ?? r.trn_no ?? '—'}</td>
                  <td>{r.PUR_CODE ?? r.pur_code ?? '—'}</td>
                  <td className="ledger-detail">{r.PUR_NAME ?? r.pur_name ?? '—'}</td>
                  <td>{r.ITEM_CODE ?? r.item_code ?? '—'}</td>
                  <td className="ledger-detail">{r.ITEM_NAME ?? r.item_name ?? '—'}</td>
                  <td>{r.GOD_CODE ?? r.god_code ?? '—'}</td>
                  <td>{r.LOT ?? r.lot ?? '—'}</td>
                  <td>{r.B_NO ?? r.b_no ?? '—'}</td>
                  <td className="text-right">{fmtQty(signedDnVal(r, 'QNTY', 'qnty'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'WEIGHT', 'weight'))}</td>
                  <td className="text-right">{fmtAmt(n(r, 'RATE', 'rate'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'AMOUNT', 'amount'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'TAXABLE', 'taxable'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'CGST_AMT', 'cgst_amt'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'SGST_AMT', 'sgst_amt'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'IGST_AMT', 'igst_amt'))}</td>
                  <td className="text-right">{fmtAmt(n(r, 'FREIGHT', 'freight'))}</td>
                  <td className="text-right">{fmtAmt(n(r, 'LABOUR', 'labour'))}</td>
                  <td className="text-right">{fmtAmt(signedDnVal(r, 'BILL_AMT', 'bill_amt'))}</td>
                </tr>
              ))}
              <tr className="stock-sum-grand">
                <td colSpan={15}>
                  <strong>Grand total</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtQty(totals.q)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.w)}</strong>
                </td>
                <td className="text-right">—</td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.a)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.tx)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.c)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.s)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.i)}</strong>
                </td>
                <td className="text-right">—</td>
                <td className="text-right">—</td>
                <td className="text-right">
                  <strong>{fmtAmt(totals.b)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          {sortedRows.length === 0 ? <p className="stock-sum-empty">No rows returned.</p> : null}
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
    <div className="slide slide-11">
      <h2>Purchase list</h2>
      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          PURCHASE lines for <strong>PU/DN</strong>. For <strong>DN</strong>, qty/weight/amount/tax columns are shown in
          negative.
        </span>
      </p>
      {lookupError ? (
        <div className="form-api-error" role="alert">
          {lookupError}
        </div>
      ) : null}
      {error ? (
        <div className="form-api-error" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group">
          <label htmlFor="pl-sdate">Starting date</label>
          <input id="pl-sdate" type="date" lang="en-GB" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="pl-edate">Ending date</label>
          <input id="pl-edate" type="date" lang="en-GB" className="form-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label htmlFor="pl-sup">Specific supplier</label>
          <input id="pl-sup" list="pl-sup-list" className="form-input" value={code} onChange={(e) => setCode(e.target.value)} />
          <datalist id="pl-sup-list">
            {suppliers.map((s) => (
              <option key={String(s.CODE ?? s.code)} value={String(s.CODE ?? s.code)}>
                {`${String(s.NAME ?? s.name ?? '')} ${String(s.CITY ?? s.city ?? '')}`.trim()}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="pl-item">Specific item</label>
          <input id="pl-item" list="pl-item-list" className="form-input" value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          <datalist id="pl-item-list">
            {items.map((it) => (
              <option key={String(it.ITEM_CODE ?? it.item_code)} value={String(it.ITEM_CODE ?? it.item_code)}>
                {String(it.ITEM_NAME ?? it.item_name ?? '')}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="pl-pur">Specific purchase code</label>
          <input id="pl-pur" list="pl-pur-list" className="form-input" value={purCode} onChange={(e) => setPurCode(e.target.value)} />
          <datalist id="pl-pur-list">
            {purCodes.map((p) => (
              <option key={String(p.CODE ?? p.code)} value={String(p.CODE ?? p.code)}>
                {`${String(p.NAME ?? p.name ?? '')} ${String(p.CITY ?? p.city ?? '')}`.trim()}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="pl-god">Specific godown</label>
          <input id="pl-god" list="pl-god-list" className="form-input" value={godCode} onChange={(e) => setGodCode(e.target.value)} />
          <datalist id="pl-god-list">
            {godowns.map((g) => (
              <option key={String(g.GOD_CODE ?? g.god_code)} value={String(g.GOD_CODE ?? g.god_code)}>
                {String(g.GOD_NAME ?? g.god_name ?? '')}
              </option>
            ))}
          </datalist>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </form>
    </div>
  );
}
