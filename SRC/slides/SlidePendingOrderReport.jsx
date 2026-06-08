import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import SessionInfoLine, { SessionLineText } from '../components/SessionInfoLine';
import { downloadExcelRows } from '../utils/excelExport';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { buildReportHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { printHtmlDocument } from '../utils/openPrintPreviewWindow';
import {
  filterCodeNameCityRows,
  filterItemCodeNameRows,
  SEARCH_ITEM_TYPE_HINT,
  SEARCH_NO_MATCH,
  SEARCH_TYPE_HINT,
} from '../utils/masterSearchFilter';
import {
  advanceReportFormOnEnter,
  focusNextReportField,
  handleReportDateEnter,
} from '../utils/reportFormFocus';

const reqOpts = { withCredentials: true, timeout: 120000 };

const REPORT_CFG = {
  sales: {
    apiPath: 'pending-sales-order-report',
    detailRtype: 'SO',
    pdfType: 'pending-sales-order',
    helpId: 'pending-sales-order',
    title: 'Pending Sales Order',
    partyLabel: 'Specific party',
    showMcs: true,
    excelName: 'PendingSalesOrder',
  },
  purchase: {
    apiPath: 'pending-purchase-order-report',
    detailRtype: 'PO',
    pdfType: 'pending-purchase-order',
    helpId: 'pending-purchase-order',
    title: 'Pending Purchase Order',
    partyLabel: 'Specific supplier',
    showMcs: false,
    excelName: 'PendingPurchaseOrder',
  },
};

const COLUMNS = [
  'SO_NO',
  'SO_DATE',
  'CODE',
  'NAME',
  'ITEM_CODE',
  'ITEM_NAME',
  'STATUS',
  'RATE',
  'MARKA',
  'PO_NO',
  'OQTY',
  'RQTY',
  'BQTY',
  'AMOUNT',
  'REMARKS',
];

const NUM_COLS = new Set(['RATE', 'OQTY', 'RQTY', 'BQTY', 'AMOUNT']);

const COL_LABELS = {
  SO_NO: 'SO No',
  SO_DATE: 'SO Date',
  CODE: 'Code',
  NAME: 'Name',
  ITEM_CODE: 'Item',
  ITEM_NAME: 'Item Name',
  STATUS: 'St',
  RATE: 'Rate',
  MARKA: 'Marka',
  PO_NO: 'PO No',
  OQTY: 'Oqty',
  RQTY: 'Rqty',
  BQTY: 'Bqty',
  AMOUNT: 'Amount',
  REMARKS: 'Remarks',
};

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

function fmtNum(v, dec = 3) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function mapRow(r) {
  return {
    SO_NO: r.SO_NO ?? r.so_no ?? '',
    SO_DATE: toDisplayDate(toInputDateString(r.SO_DATE ?? r.so_date)),
    CODE: r.CODE ?? r.code ?? '',
    NAME: r.NAME ?? r.name ?? '',
    ITEM_CODE: r.ITEM_CODE ?? r.item_code ?? '',
    ITEM_NAME: r.ITEM_NAME ?? r.item_name ?? '',
    STATUS: r.STATUS ?? r.status ?? '',
    RATE: Number(r.RATE ?? r.rate ?? 0),
    MARKA: r.MARKA ?? r.marka ?? '',
    PO_NO: r.PO_NO ?? r.po_no ?? '',
    OQTY: Number(r.OQTY ?? r.oqty ?? 0),
    RQTY: Number(r.RQTY ?? r.rqty ?? 0),
    BQTY: Number(r.BQTY ?? r.bqty ?? 0),
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0),
    REMARKS: r.REMARKS ?? r.remarks ?? '',
  };
}

function PendingOrderDetailModal({ open, onClose, loading, err, detail, title }) {
  if (!open) return null;
  const sum = detail?.summary || {};
  const orderLines = detail?.order_lines || [];
  const fulfillLines = detail?.fulfill_lines || [];
  const outLabel = detail?.fulfill_source === 'SALE' ? 'Sale bills (OUT)' : detail?.fulfill_source === 'ISSUE' ? 'Challans (OUT)' : 'Purchase / GRN (OUT)';

  return (
    <div className="pending-order-detail-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pending-order-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-order-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pending-order-detail-modal__head">
          <h3 id="pending-order-detail-title">{title}</h3>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        {loading ? <p className="loading-msg">Loading detail…</p> : null}
        {err ? <p className="form-api-error">{err}</p> : null}

        {!loading && !err && detail ? (
          <>
            <p className="pending-order-detail-modal__summary">
              Oqty <strong>{fmtNum(sum.OQTY)}</strong> · Rqty <strong>{fmtNum(sum.RQTY)}</strong> · Bqty{' '}
              <strong>{fmtNum(sum.BQTY)}</strong>
            </p>

            <h4 className="pending-order-detail-modal__section">Sales / purchase orders (IN)</h4>
            <div className="table-responsive">
              <table className="report-table report-table--pending-order-detail">
                <thead>
                  <tr>
                    <th>Order no</th>
                    <th>Order date</th>
                    <th>Line</th>
                    <th>Item</th>
                    <th>St</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Qty</th>
                    <th>Marka</th>
                    <th>PO No</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {orderLines.length === 0 ? (
                    <tr>
                      <td colSpan={10}>No order lines.</td>
                    </tr>
                  ) : (
                    orderLines.map((r, i) => (
                      <tr key={`in-${i}`}>
                        <td>{r.SO_NO}</td>
                        <td>{toDisplayDate(toInputDateString(r.SO_DATE ?? r.DOC_DATE))}</td>
                        <td>{r.TRN_NO || r.DOC_NO}</td>
                        <td>{r.ITEM_CODE}</td>
                        <td>{r.STATUS}</td>
                        <td className="text-right">{fmtNum(r.RATE, 2)}</td>
                        <td className="text-right">{fmtNum(r.QNTY)}</td>
                        <td>{r.MARKA}</td>
                        <td>{r.PO_NO}</td>
                        <td>{r.REMARKS}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <h4 className="pending-order-detail-modal__section">{outLabel}</h4>
            <div className="table-responsive">
              <table className="report-table report-table--pending-order-detail">
                <thead>
                  <tr>
                    <th>Order no</th>
                    <th>Date</th>
                    <th>Doc no</th>
                    <th>Type</th>
                    <th>Item</th>
                    <th>St</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {fulfillLines.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No billed / challan / purchase lines.</td>
                    </tr>
                  ) : (
                    fulfillLines.map((r, i) => (
                      <tr key={`out-${i}`}>
                        <td>{r.SO_NO}</td>
                        <td>{toDisplayDate(toInputDateString(r.DOC_DATE))}</td>
                        <td>{r.BILL_NO || r.DOC_NO}</td>
                        <td>{r.TYPE}</td>
                        <td>{r.ITEM_CODE}</td>
                        <td>{r.STATUS}</td>
                        <td className="text-right">{fmtNum(r.RATE, 2)}</td>
                        <td className="text-right">{fmtNum(r.QNTY)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default function SlidePendingOrderReport({
  apiBase,
  formData,
  onPrev,
  onReset,
  reportMode = 'sales',
  slideClass = 'slide-37-pending-sales-order',
}) {
  const cfg = REPORT_CFG[reportMode] || REPORT_CFG.sales;
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [sDate, setSDate] = useState(() => toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [eDate, setEDate] = useState(() => toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));
  const [mcs, setMcs] = useState('S');
  const [cp, setCp] = useState('P');
  const [partyCode, setPartyCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [itemCode, setItemCode] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemHi, setItemHi] = useState(0);

  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [rows, setRows] = useState([]);
  const [rateChk, setRateChk] = useState('N');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showReport, setShowReport] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailTitle, setDetailTitle] = useState('');

  const formRef = useRef(null);
  const sDateInputRef = useRef(null);

  const itemsApi = reportMode === 'sales' ? 'salelist-items' : 'purchaselist-items';

  const focusStartDate = () => {
    setTimeout(() => {
      const el = sDateInputRef.current;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  useEffect(() => {
    if (showReport) return;
    focusStartDate();
  }, [showReport]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    const params = { comp_code: compCode, comp_uid: compUid };
    Promise.all([
      axios.get(`${apiBase}/api/pending-order-parties`, { params, ...reqOpts }),
      axios.get(`${apiBase}/api/${itemsApi}`, { params, ...reqOpts }),
    ])
      .then(([pRes, iRes]) => {
        setParties(Array.isArray(pRes.data) ? pRes.data : []);
        setItems(Array.isArray(iRes.data) ? iRes.data : []);
      })
      .catch(() => {});
  }, [apiBase, compCode, compUid, itemsApi]);

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [parties, partySearch]
  );
  const filteredItems = useMemo(
    () => filterItemCodeNameRows(items, itemSearch, 50),
    [items, itemSearch]
  );

  const safePartyHi = Math.min(partyHi, Math.max(0, filteredParties.length - 1));
  const safeItemHi = Math.min(itemHi, Math.max(0, filteredItems.length - 1));

  const reportRows = useMemo(() => {
    const mapped = rows.map(mapRow);
    return mapped.sort((a, b) => {
      const da = toInputDateString(a.SO_DATE) || '';
      const db = toInputDateString(b.SO_DATE) || '';
      if (da !== db) return da.localeCompare(db);
      const sn = Number(a.SO_NO) - Number(b.SO_NO);
      if (sn !== 0) return sn;
      return String(a.ITEM_CODE).localeCompare(String(b.ITEM_CODE));
    });
  }, [rows]);

  const totals = useMemo(() => {
    let o = 0;
    let r = 0;
    let b = 0;
    let a = 0;
    for (const row of reportRows) {
      o += row.OQTY;
      r += row.RQTY;
      b += row.BQTY;
      a += row.AMOUNT;
    }
    return { oqty: o, rqty: r, bqty: b, amount: a };
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

  const cpLabel = cp === 'C' ? 'Complete (all)' : 'Pending only';

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      reportTitle: cfg.title,
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
      partyLabel,
      itemLabel,
      cpLabel,
      mcsLabel: cfg.showMcs ? (mcs === 'C' ? 'Challan (ISSUE)' : 'Sale Bill (SALE)') : '',
      rateChkLabel: rateChk === 'Y' ? 'Rate check: Yes' : 'Rate check: No',
    }),
    [compName, cfg, sDate, eDate, partyLabel, itemLabel, cp, mcs, rateChk]
  );

  const excelRows = useMemo(
    () =>
      reportRows.map((r) => ({
        'SO No': r.SO_NO,
        'SO Date': r.SO_DATE,
        Code: r.CODE,
        Name: r.NAME,
        Item: r.ITEM_CODE,
        'Item Name': r.ITEM_NAME,
        Status: r.STATUS,
        Rate: r.RATE,
        Marka: r.MARKA,
        'PO No': r.PO_NO,
        Oqty: r.OQTY,
        Rqty: r.RQTY,
        Bqty: r.BQTY,
        Amount: r.AMOUNT,
        Remarks: r.REMARKS,
      })),
    [reportRows]
  );

  const applyPartyPick = (pc) => {
    const row = parties.find((x) => String(x.CODE ?? x.code) === String(pc));
    setPartyCode(pc);
    setPartySearch(row ? `[${pc}] ${row.NAME ?? row.name}` : String(pc));
    setPartyHi(0);
  };

  const applyItemPick = (ic) => {
    const row = items.find((x) => String(x.ITEM_CODE ?? x.item_code) === String(ic));
    setItemCode(ic);
    setItemSearch(row ? `[${ic}] ${row.ITEM_NAME ?? row.item_name}` : ic);
    setItemHi(0);
  };

  const partyDropdownOpen = !partyCode && partySearch.trim().length > 0;
  const itemDropdownOpen = !itemCode && itemSearch.trim().length > 0;

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
        cp,
      };
      if (partyCode) params.code = partyCode;
      if (itemCode.trim()) params.item_code = itemCode.trim();
      if (cfg.showMcs) params.mcs = mcs;
      const { data } = await axios.get(`${apiBase}/api/${cfg.apiPath}`, { params, ...reqOpts });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setRateChk(String(data?.rate_chk ?? 'N').toUpperCase());
      setShowReport(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Report failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    void runReport();
  };

  const onFormFieldEnter = (e) => advanceReportFormOnEnter(e, formRef.current);
  const onDateEnter = (e) => handleReportDateEnter(e, formRef.current);

  const openDetail = async (row) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailErr('');
    setDetail(null);
    setDetailTitle(
      `SO ${row.SO_NO} · ${row.ITEM_CODE} · St ${row.STATUS} · Rate ${fmtNum(row.RATE, 2)} — ${row.NAME}`
    );
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(sDate),
        e_date: toOracleDate(eDate),
        rtype: cfg.detailRtype,
        so_no: row.SO_NO,
        item_code: row.ITEM_CODE,
        status: row.STATUS,
        rate: row.RATE,
      };
      if (cfg.showMcs) params.mcs = mcs;
      const { data } = await axios.get(`${apiBase}/api/pending-order-detail`, { params, ...reqOpts });
      setDetail(data);
    } catch (e) {
      setDetailErr(e?.response?.data?.error || e.message || 'Detail failed');
    } finally {
      setDetailLoading(false);
    }
  };

  const shareText = `${compName}\n${cfg.title}\n${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}`;

  const toolbar = (
    <div className="toolbar-actions">
      <button type="button" className="btn btn-secondary btn-toolbar-back" onClick={onPrev}>
        ← Back
      </button>
      {showReport ? (
        <>
          <button
            type="button"
            className="btn btn-export"
            disabled={!reportRows.length}
            onClick={() =>
              generatePDF(cfg.pdfType, { rows: reportRows }, pdfMeta).catch((e) => alert(e?.message || String(e)))
            }
          >
            Pdf
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!reportRows.length}
            onClick={() => {
              const html = buildReportHtml(cfg.pdfType, { rows: reportRows }, pdfMeta);
              printHtmlDocument(html, cfg.title);
            }}
          >
            Print
          </button>
          <button
            type="button"
            className="btn btn-excel"
            disabled={!reportRows.length}
            onClick={() => downloadExcelRows(excelRows, cfg.excelName, `${compName}_${cfg.excelName}`)}
          >
            Excel
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={!reportRows.length}
            onClick={() =>
              sharePdfWithWhatsApp(cfg.pdfType, { rows: reportRows }, pdfMeta, shareText).catch((e) =>
                alert(e?.message || String(e))
              )
            }
          >
            WhatsApp
          </button>
        </>
      ) : null}
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        Home
      </button>
    </div>
  );

  return (
    <div className={`slide slide-report ${slideClass}`}>
      <SessionInfoLine>
        <SessionLineText formData={formData} />
      </SessionInfoLine>

      <div className="report-toolbar">
        <h2>{cfg.title}</h2>
        {toolbar}
      </div>

      {!showReport ? (
        <form
          id="pending-order-form"
          ref={formRef}
          className="report-form report-form--pending-order"
          autoComplete="off"
          onSubmit={handleSubmit}
          onKeyDown={onFormFieldEnter}
        >
          <div className="form-row-broker form-row-broker--dates">
            <div className="form-group">
              <label htmlFor="pending-s-date">Starting date</label>
              <input
                id="pending-s-date"
                ref={sDateInputRef}
                type="date"
                lang="en-GB"
                className="form-input"
                value={sDate}
                onChange={(e) => setSDate(e.target.value)}
                onKeyDown={onDateEnter}
              />
            </div>
            <div className="form-group">
              <label htmlFor="pending-e-date">Ending date</label>
              <input
                id="pending-e-date"
                type="date"
                lang="en-GB"
                className="form-input"
                value={eDate}
                onChange={(e) => setEDate(e.target.value)}
                onKeyDown={onDateEnter}
              />
            </div>
            {cfg.showMcs ? (
              <div className="form-group">
                <label>Link Challan / Sale Bill</label>
                <select className="form-input" value={mcs} onChange={(e) => setMcs(e.target.value)}>
                  <option value="S">S — Sale Bill</option>
                  <option value="C">C — Challan (Issue)</option>
                </select>
              </div>
            ) : null}
            <div className="form-group">
              <label>Complete / Pending</label>
              <select className="form-input" value={cp} onChange={(e) => setCp(e.target.value)}>
                <option value="P">P — Pending (Bqty &gt; 0)</option>
                <option value="C">C — Complete (all incl. fulfilled)</option>
              </select>
            </div>
          </div>

          <div className="form-group account-search-group">
            <label>{cfg.partyLabel}</label>
            <input
              id="pending-party-search"
              type="text"
              className="form-input"
              autoComplete="off"
              placeholder="Search name, city, code, GST or PAN…"
              value={partySearch}
              onChange={(e) => {
                setPartySearch(e.target.value);
                setPartyHi(0);
                if (!e.target.value.trim()) setPartyCode('');
              }}
              onKeyDown={(e) => {
                const max = Math.max(0, filteredParties.length - 1);
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (filteredParties.length) setPartyHi((h) => Math.min(max, h + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setPartyHi((h) => Math.max(0, h - 1));
                } else if (e.key === 'Escape') {
                  setPartySearch('');
                  setPartyCode('');
                } else if (e.key === 'Enter') {
                  if (partyDropdownOpen && filteredParties.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    const row = filteredParties[safePartyHi];
                    if (row) applyPartyPick(String(row.CODE ?? row.code));
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  focusNextReportField(formRef.current, e.target);
                }
              }}
            />
            {partyCode ? (
              <p className="account-selected-hint">
                Selected: {partyLabel}
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={() => {
                    setPartyCode('');
                    setPartySearch('');
                  }}
                >
                  Clear
                </button>
              </p>
            ) : partyDropdownOpen ? (
              <div className="account-search-results party-search-results pending-order-party-search" role="listbox">
                <div className="account-search-header party-search-header party-search-header--gst-pan" aria-hidden="true">
                  <span>Code</span>
                  <span>Name</span>
                  <span>City</span>
                  <span>GST</span>
                  <span>PAN</span>
                </div>
                {filteredParties.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredParties.map((p, index) => {
                    const pc = String(p.CODE ?? p.code);
                    const rowHi = safePartyHi === index;
                    return (
                      <button
                        key={pc}
                        type="button"
                        role="option"
                        className={`account-search-row party-search-row party-search-row--gst-pan${rowHi ? ' is-highlight' : ''}`}
                        onMouseEnter={() => setPartyHi(index)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyPartyPick(pc);
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(pc, partySearch)}</span>
                        <span className="account-search-name">{highlightMatch(p.NAME ?? p.name, partySearch)}</span>
                        <span className="account-search-city">{highlightMatch(p.CITY ?? p.city, partySearch) || '—'}</span>
                        <span className="account-search-gst">{highlightMatch(p.GST_NO ?? p.gst_no, partySearch) || '—'}</span>
                        <span className="account-search-pan">{highlightMatch(p.PAN ?? p.pan, partySearch) || '—'}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <p className="sale-bill-section__hint">{SEARCH_TYPE_HINT}</p>
            )}
          </div>

          <div className="form-group account-search-group">
            <label>Specific item</label>
            <input
              id="pending-item-search"
              type="text"
              className="form-input"
              autoComplete="off"
              placeholder="Search item code or name…"
              value={itemSearch}
              onChange={(e) => {
                setItemSearch(e.target.value);
                setItemHi(0);
                if (!e.target.value.trim()) setItemCode('');
              }}
              onKeyDown={(e) => {
                const max = Math.max(0, filteredItems.length - 1);
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  if (filteredItems.length) setItemHi((h) => Math.min(max, h + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setItemHi((h) => Math.max(0, h - 1));
                } else if (e.key === 'Escape') {
                  setItemSearch('');
                  setItemCode('');
                } else if (e.key === 'Enter') {
                  if (itemDropdownOpen && filteredItems.length > 0) {
                    e.preventDefault();
                    e.stopPropagation();
                    const row = filteredItems[safeItemHi];
                    if (row) applyItemPick(String(row.ITEM_CODE ?? row.item_code));
                    return;
                  }
                  e.preventDefault();
                  e.stopPropagation();
                  focusNextReportField(formRef.current, e.target);
                }
              }}
            />
            {itemCode ? (
              <p className="account-selected-hint">
                Selected: {itemLabel}
                <button
                  type="button"
                  className="btn-text-clear"
                  onClick={() => {
                    setItemCode('');
                    setItemSearch('');
                  }}
                >
                  Clear
                </button>
              </p>
            ) : itemDropdownOpen ? (
              <div className="account-search-results party-search-results" role="listbox">
                <div className="account-search-header party-search-header" aria-hidden="true">
                  <span>Code</span>
                  <span>Name</span>
                </div>
                {filteredItems.length === 0 ? (
                  <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
                ) : (
                  filteredItems.map((it, index) => {
                    const ic = String(it.ITEM_CODE ?? it.item_code);
                    const rowHi = safeItemHi === index;
                    return (
                      <button
                        key={ic}
                        type="button"
                        role="option"
                        className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                        onMouseEnter={() => setItemHi(index)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyItemPick(ic);
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(ic, itemSearch)}</span>
                        <span className="account-search-name">{highlightMatch(it.ITEM_NAME ?? it.item_name, itemSearch)}</span>
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <p className="sale-bill-section__hint">{SEARCH_ITEM_TYPE_HINT}</p>
            )}
          </div>

          {err ? <p className="form-api-error">{err}</p> : null}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Loading…' : 'Run'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReset}>
              Home
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="report-info">
            <p>
              Period: {toDisplayDate(sDate)} to {toDisplayDate(eDate)}
              {cfg.showMcs ? ` · Link: ${mcs === 'C' ? 'Challan' : 'Sale Bill'}` : ''}
              {' · '}
              {cpLabel} · {partyLabel} · {itemLabel}
              {rateChk === 'Y' ? ' · Rate check on' : ''}
            </p>
            <p>
              {reportRows.length} line(s) · Oqty {fmtNum(totals.oqty)} · Rqty {fmtNum(totals.rqty)} · Bqty{' '}
              {fmtNum(totals.bqty)} · Amount {fmtNum(totals.amount, 2)}
            </p>
            <p className="sale-bill-section__hint">Click any row for complete IN (order) / OUT (billed) detail.</p>
          </div>

          {err ? <p className="form-api-error">{err}</p> : null}

          <div className="report-display pending-order-report">
            <div className="table-responsive">
              <table className="report-table report-table--pending-order report-table--click-rows">
                <thead>
                  <tr>
                    {COLUMNS.map((col) => (
                      <th key={col} className={NUM_COLS.has(col) ? 'text-right' : ''}>
                        {COL_LABELS[col] ?? col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reportRows.length === 0 ? (
                    <tr>
                      <td colSpan={COLUMNS.length}>No rows for selected filters.</td>
                    </tr>
                  ) : (
                    reportRows.map((r, i) => (
                      <tr
                        key={`${r.SO_NO}-${r.ITEM_CODE}-${r.STATUS}-${r.RATE}-${i}`}
                        className="sale-list-row-clickable"
                        title="Click for IN/OUT detail"
                        onClick={() => void openDetail(r)}
                      >
                        {COLUMNS.map((col) => {
                          const val = r[col];
                          if (NUM_COLS.has(col)) {
                            const dec = col === 'AMOUNT' || col === 'RATE' ? 2 : 3;
                            return (
                              <td key={col} className="text-right">
                                {fmtNum(val, dec)}
                              </td>
                            );
                          }
                          if (col === 'SO_DATE') return <td key={col}>{val}</td>;
                          return <td key={col}>{val == null ? '' : String(val)}</td>;
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
                {reportRows.length > 0 ? (
                  <tfoot>
                    <tr className="stock-sum-grand">
                      <td colSpan={10} className="text-right">
                        <strong>GRAND TOTAL</strong>
                      </td>
                      <td className="text-right">
                        <strong>{fmtNum(totals.oqty)}</strong>
                      </td>
                      <td className="text-right">
                        <strong>{fmtNum(totals.rqty)}</strong>
                      </td>
                      <td className="text-right">
                        <strong>{fmtNum(totals.bqty)}</strong>
                      </td>
                      <td className="text-right">
                        <strong>{fmtNum(totals.amount, 2)}</strong>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
              Change filters
            </button>
          </div>
        </>
      )}

      {loading && !showReport ? <p className="loading-msg">Loading…</p> : null}

      <PendingOrderDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
        err={detailErr}
        detail={detail}
        title={detailTitle}
      />
    </div>
  );
}
