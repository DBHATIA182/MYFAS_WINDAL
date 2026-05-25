import React, { useMemo, useState } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';
import { filterCodeNameCityRows, filterItemCodeNameRows } from '../utils/masterSearchFilter';

const reqOpts = { withCredentials: true, timeout: 120000 };
const PU_TYPE = 'PU';
const LIST_COL_COUNT = 24;

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

function fmtAmt(val, decimals = 2) {
  const x = parseFloat(val);
  if (Number.isNaN(x) || Math.abs(x) < 0.0000001) return '';
  return x.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtQty3(val) {
  const x = parseFloat(val);
  if (Number.isNaN(x) || Math.abs(x) < 0.0000001) return '';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function mapRow(r) {
  return {
    R_DATE: formatLedgerDateDisplay(r.R_DATE ?? r.r_date),
    R_NO: r.R_NO ?? r.r_no,
    BILL_DATE: formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date),
    BILL_NO: r.BILL_NO ?? r.bill_no,
    CODE: r.CODE ?? r.code,
    PARTY_NAME: r.NAME ?? r.name,
    ITEM_CODE: r.ITEM_CODE ?? r.item_code,
    ITEM_NAME: r.ITEM_NAME ?? r.item_name,
    QNTY: Number(r.QNTY ?? r.qnty ?? 0),
    STATUS: r.STATUS ?? r.status,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0),
    STK_WEIGHT: Number(r.STK_WEIGHT ?? r.stk_weight ?? 0),
    STK_DATE: formatLedgerDateDisplay(r.STK_DATE ?? r.stk_date),
    RATE: Number(r.RATE ?? r.rate ?? 0),
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0),
    TAXABLE: Number(r.TAXABLE ?? r.taxable ?? 0),
    BILL_AMT: Number(r.BILL_AMT ?? r.bill_amt ?? 0),
    CGST_AMT: Number(r.CGST_AMT ?? r.cgst_amt ?? 0),
    SGST_AMT: Number(r.SGST_AMT ?? r.sgst_amt ?? 0),
    IGST_AMT: Number(r.IGST_AMT ?? r.igst_amt ?? 0),
    LABOUR: Number(r.LABOUR ?? r.labour ?? 0),
    FREIGHT: Number(r.FREIGHT ?? r.freight ?? 0),
    MFEE_AMT: Number(r.MFEE_AMT ?? r.mfee_amt ?? 0),
    ADD_EXP: Number(r.ADDEXP ?? r.addexp ?? r.ADD_EXP ?? 0),
    LESS_EXP: Number(r.LESSEXP ?? r.lessexp ?? r.LESS_EXP ?? 0),
    NTDS_AMT: Number(r.NTDS_AMT ?? r.ntds_amt ?? r.TDS_AMT ?? r.tds_amt ?? 0),
    TRN_NO: r.TRN_NO ?? r.trn_no,
    _rDateRaw: r.R_DATE ?? r.r_date,
  };
}

function openBillFromRow(r, onOpenBill) {
  onOpenBill?.({
    r_no: r.R_NO,
    r_date: r._rDateRaw,
  });
}

export default function PurchaseBillListScreen({ apiBase, formData, lookups, onClose, onOpenBill }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [sDate, setSDate] = useState(() => toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [eDate, setEDate] = useState(() => toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));
  const [partyCode, setPartyCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [plantCode, setPlantCode] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);

  const parties = lookups?.parties || lookups?.suppliers || [];
  const items = lookups?.items || [];
  const plants = lookups?.plants || [];

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [partySearch, parties]
  );

  const filteredItems = useMemo(
    () => filterItemCodeNameRows(items, itemSearch, 50),
    [itemSearch, items]
  );

  const reportRows = useMemo(() => rows.map(mapRow), [rows]);

  const totals = useMemo(() => {
    let q = 0;
    let w = 0;
    let sw = 0;
    let a = 0;
    let c = 0;
    let s = 0;
    let i = 0;
    let tax = 0;
    let lab = 0;
    let frt = 0;
    let mfee = 0;
    let add = 0;
    let less = 0;
    let bill = 0;
    let ntds = 0;
    for (const r of reportRows) {
      q += Number(r.QNTY) || 0;
      w += Number(r.WEIGHT) || 0;
      sw += Number(r.STK_WEIGHT) || 0;
      a += Number(r.AMOUNT) || 0;
      c += Number(r.CGST_AMT) || 0;
      s += Number(r.SGST_AMT) || 0;
      i += Number(r.IGST_AMT) || 0;
      tax += Number(r.TAXABLE) || 0;
      lab += Number(r.LABOUR) || 0;
      frt += Number(r.FREIGHT) || 0;
      mfee += Number(r.MFEE_AMT) || 0;
      add += Number(r.ADD_EXP) || 0;
      less += Number(r.LESS_EXP) || 0;
      bill += Number(r.BILL_AMT) || 0;
      ntds += Number(r.NTDS_AMT) || 0;
    }
    return {
      qnty: q,
      weight: w,
      stkWeight: sw,
      amount: a,
      cgst: c,
      sgst: s,
      igst: i,
      taxable: tax,
      labour: lab,
      freight: frt,
      mfeeAmt: mfee,
      addExp: add,
      lessExp: less,
      billAmt: bill,
      ntdsAmt: ntds,
    };
  }, [reportRows]);

  const partyLabel = useMemo(() => {
    if (!partyCode) return 'All suppliers';
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
      typeLabel: 'Purchase bill (PU)',
    }),
    [compName, sDate, eDate, partyLabel, itemLabel]
  );

  const excelRows = useMemo(
    () =>
      reportRows.map((r) => ({
        RDate: r.R_DATE,
        RNo: r.R_NO,
        BillDate: r.BILL_DATE,
        BillNo: r.BILL_NO,
        Party: r.PARTY_NAME,
        Item: r.ITEM_CODE,
        Qty: r.QNTY,
        St: r.STATUS,
        NetWt: r.WEIGHT,
        StkWt: r.STK_WEIGHT,
        StkDate: r.STK_DATE,
        Rate: r.RATE,
        Amount: r.AMOUNT,
        Taxable: r.TAXABLE,
        BillAmt: r.BILL_AMT,
        Cgst: r.CGST_AMT,
        Sgst: r.SGST_AMT,
        Igst: r.IGST_AMT,
        Labour: r.LABOUR,
        Freight: r.FREIGHT,
        MfeeAmt: r.MFEE_AMT,
        AddExp: r.ADD_EXP,
        LessExp: r.LESS_EXP,
        NtdsAmt: r.NTDS_AMT,
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
        type: PU_TYPE,
        s_date: toOracleDate(sDate),
        e_date: toOracleDate(eDate),
      };
      if (partyCode) params.code = partyCode;
      if (itemCode.trim()) params.item_code = itemCode.trim();
      if (plantCode.trim()) params.plant_code = plantCode.trim();
      const { data } = await axios.get(`${apiBase}/api/purchase-list`, { params, ...reqOpts });
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
    setPlantCode('');
  };

  const shareText = `${compName}\nPurchase bill list\n${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}\n${partyLabel}\n${itemLabel}`;

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
          generatePDF('purchase-list', { rows, type: PU_TYPE }, pdfMeta).catch((e) => alert(e?.message || String(e)))
        }
      >
        Pdf
      </button>
      <button
        type="button"
        className="btn btn-excel"
        disabled={!hasRows}
        onClick={() => downloadExcelRows(excelRows, 'PurchaseBill', `${compName}_PurchaseBill_List`)}
      >
        Excel
      </button>
      <button
        type="button"
        className="btn btn-whatsapp"
        disabled={!hasRows}
        title={hasRows ? 'Share list as PDF on WhatsApp' : 'Run report first'}
        onClick={() =>
          sharePdfWithWhatsApp('purchase-list', { rows, type: PU_TYPE }, pdfMeta, shareText).catch((e) =>
            alert(e?.message || String(e))
          )
        }
      >
        WhatsApp
      </button>
    </>
  );

  return (
    <div className="slide slide-25-purchase-bill-list dc-list-screen">
      <header className="dc-list-screen__head">
        <h2 className="sale-bill-page__title">Purchase bill list</h2>
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
            <span className="sale-bill-field__label">Supplier</span>
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
                  <em>All suppliers</em>
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
            <span className="sale-bill-field__label">Item</span>
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
            <span className="sale-bill-field__label">Plant</span>
            <select className="form-input" value={plantCode} onChange={(e) => setPlantCode(e.target.value)}>
              <option value="">All plants</option>
              {plants.map((pl) => {
                const pc = String(pl.PLANT_CODE ?? pl.plant_code ?? '');
                return (
                  <option key={pc} value={pc}>
                    {pc} — {pl.PLANT_NAME ?? pl.plant_name}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        <div className="dc-list-filters-actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runReport()}>
            {loading ? 'Loading…' : 'Run report'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={clearFilters}>
            Clear filters
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
              {reportRows.length} line(s) · Qty {totals.qnty} · Wgt {totals.weight.toFixed(3)} · Line amt{' '}
              {totals.amount.toFixed(2)} · Taxable {totals.taxable.toFixed(2)} · Bill amt {totals.billAmt.toFixed(2)}
            </p>
          </div>
          <p className="sale-bill-section__hint dc-list-scroll-hint">
            Swipe left/right inside the table box to see all columns (Bill amt, Ntds amt, etc.).
          </p>
          <div className="pb-purchase-list-scroll-panel dc-list-table-wrap dc-list-table-wrap--wide">
            <div className="pb-purchase-list-table-inner">
            <table className="report-table dc-list-table dc-list-table--purchase-bill">
              <thead>
                <tr>
                  <th>R date</th>
                  <th>R no</th>
                  <th>Bill date</th>
                  <th>Bill no</th>
                  <th>Party</th>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th>St</th>
                  <th className="num">Net wt</th>
                  <th className="num">Stk wt</th>
                  <th>Stk date</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST</th>
                  <th className="num">IGST</th>
                  <th className="num">Taxable</th>
                  <th className="num">Labour</th>
                  <th className="num">Freight</th>
                  <th className="num">Mfee</th>
                  <th className="num">Add exp</th>
                  <th className="num">Less exp</th>
                  <th className="num pb-list-col-bill">Bill amt</th>
                  <th className="num pb-list-col-ntds">Ntds amt</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.length === 0 ? (
                  <tr>
                    <td colSpan={LIST_COL_COUNT}>No rows for selected filters.</td>
                  </tr>
                ) : (
                  reportRows.map((r, i) => (
                    <tr
                      key={`${r.R_NO}-${r.TRN_NO}-${i}`}
                      className="dc-list-row-clickable"
                      title="Open this purchase bill in entry"
                      onClick={() => openBillFromRow(r, onOpenBill)}
                    >
                      <td className="dc-list-date-cell">{r.R_DATE}</td>
                      <td>{r.R_NO}</td>
                      <td className="dc-list-date-cell">{r.BILL_DATE}</td>
                      <td>{r.BILL_NO}</td>
                      <td className="dc-list-party-cell" title={`[${r.CODE}] ${r.PARTY_NAME ?? ''}`}>
                        <span className="dc-list-party-line">
                          [{r.CODE}] {r.PARTY_NAME}
                        </span>
                      </td>
                      <td title={r.ITEM_NAME || ''}>{r.ITEM_CODE}</td>
                      <td className="num">{fmtQty3(r.QNTY)}</td>
                      <td>{r.STATUS}</td>
                      <td className="num">{fmtQty3(r.WEIGHT)}</td>
                      <td className="num">{fmtQty3(r.STK_WEIGHT)}</td>
                      <td className="dc-list-date-cell">{r.STK_DATE}</td>
                      <td className="num">{fmtAmt(r.RATE)}</td>
                      <td className="num">{fmtAmt(r.AMOUNT)}</td>
                      <td className="num">{fmtAmt(r.CGST_AMT)}</td>
                      <td className="num">{fmtAmt(r.SGST_AMT)}</td>
                      <td className="num">{fmtAmt(r.IGST_AMT)}</td>
                      <td className="num">{fmtAmt(r.TAXABLE)}</td>
                      <td className="num">{fmtAmt(r.LABOUR)}</td>
                      <td className="num">{fmtAmt(r.FREIGHT)}</td>
                      <td className="num">{fmtAmt(r.MFEE_AMT)}</td>
                      <td className="num">{fmtAmt(r.ADD_EXP)}</td>
                      <td className="num">{fmtAmt(r.LESS_EXP)}</td>
                      <td className="num pb-list-col-bill">{fmtAmt(r.BILL_AMT)}</td>
                      <td className="num pb-list-col-ntds">{fmtAmt(r.NTDS_AMT)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {reportRows.length > 0 ? (
                <tfoot>
                  <tr className="dc-list-grand-total">
                    <td colSpan={6}>
                      <strong>Grand total</strong>
                    </td>
                    <td className="num">{fmtQty3(totals.qnty)}</td>
                    <td />
                    <td className="num">{fmtQty3(totals.weight)}</td>
                    <td className="num">{fmtQty3(totals.stkWeight)}</td>
                    <td />
                    <td />
                    <td className="num">{fmtAmt(totals.amount)}</td>
                    <td className="num">{fmtAmt(totals.cgst)}</td>
                    <td className="num">{fmtAmt(totals.sgst)}</td>
                    <td className="num">{fmtAmt(totals.igst)}</td>
                    <td className="num">{fmtAmt(totals.taxable)}</td>
                    <td className="num">{fmtAmt(totals.labour)}</td>
                    <td className="num">{fmtAmt(totals.freight)}</td>
                    <td className="num">{fmtAmt(totals.mfeeAmt)}</td>
                    <td className="num">{fmtAmt(totals.addExp)}</td>
                    <td className="num">{fmtAmt(totals.lessExp)}</td>
                    <td className="num pb-list-col-bill">{fmtAmt(totals.billAmt)}</td>
                    <td className="num pb-list-col-ntds">{fmtAmt(totals.ntdsAmt)}</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
            </div>
          </div>
          {reportRows.length > 0 ? (
            <div className="pb-purchase-list-grand-bar" aria-label="Grand total summary">
              <strong className="pb-purchase-list-grand-bar__title">Grand total</strong>
              <span>Qty {fmtQty3(totals.qnty)}</span>
              <span>Wgt {fmtQty3(totals.weight)}</span>
              <span>Amt {fmtAmt(totals.amount)}</span>
              <span>CGST {fmtAmt(totals.cgst)}</span>
              <span>SGST {fmtAmt(totals.sgst)}</span>
              <span>IGST {fmtAmt(totals.igst)}</span>
              <span>Taxable {fmtAmt(totals.taxable)}</span>
              <span>Bill {fmtAmt(totals.billAmt)}</span>
              <span>Ntds {fmtAmt(totals.ntdsAmt)}</span>
            </div>
          ) : null}
          <p className="sale-bill-section__hint">Click a row to open that purchase bill in the entry screen.</p>
        </section>
      ) : null}

      <DcActionBar position="bottom" label="List actions">
        {listActionButtons}
      </DcActionBar>
    </div>
  );
}
