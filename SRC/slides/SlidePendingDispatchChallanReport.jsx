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
  pickSearchResult,
  scrollReportFieldIntoView,
} from '../utils/reportFormFocus';

const reqOpts = { withCredentials: true, timeout: 120000 };

const COLUMNS = [
  'CH_NO',
  'CH_DATE',
  'CH_TYPE',
  'CODE',
  'NAME',
  'ITEM_CODE',
  'ITEM_NAME',
  'MARKA',
  'STATUS',
  'RATE',
  'D_QNTY',
  'B_QNTY',
  'BQTY',
  'AMOUNT',
  'PLANT_CODE',
];

const NUM_COLS = new Set(['RATE', 'D_QNTY', 'B_QNTY', 'BQTY', 'AMOUNT']);

const COL_LABELS = {
  CH_NO: 'Ch no',
  CH_DATE: 'Ch date',
  CH_TYPE: 'Tp',
  CODE: 'Code',
  NAME: 'Name',
  ITEM_CODE: 'Item',
  ITEM_NAME: 'Item name',
  MARKA: 'Marka',
  STATUS: 'St',
  RATE: 'Rate',
  D_QNTY: 'Ch qty',
  B_QNTY: 'Sl qty',
  BQTY: 'Bal',
  AMOUNT: 'Amount',
  PLANT_CODE: 'Plant',
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

function PendingChallanDetailModal({ open, onClose, loading, err, detail, title, selectedRow }) {
  if (!open) return null;
  const sum = detail?.summary || {};
  const challanLines = detail?.challan_lines || [];
  const saleLines = detail?.sale_lines || [];

  return (
    <div className="pending-order-detail-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pending-order-detail-modal pending-order-detail-modal--challan"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pending-challan-detail-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pending-order-detail-modal__head">
          <h3 id="pending-challan-detail-title">{title}</h3>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        {loading ? <p className="loading-msg">Loading detail…</p> : null}
        {err ? <p className="form-api-error">{err}</p> : null}

        {!loading && !err && detail ? (
          <>
            <p className="pending-order-detail-modal__summary">
              {selectedRow ? (
                <>
                  Selected line ({selectedRow.ITEM_CODE}): Ch qty <strong>{fmtNum(selectedRow.D_QNTY)}</strong> · Sl qty{' '}
                  <strong>{fmtNum(selectedRow.B_QNTY)}</strong> · Bal <strong>{fmtNum(selectedRow.BQTY)}</strong>
                  <br />
                </>
              ) : null}
              Challan total: Ch qty <strong>{fmtNum(sum.OQTY)}</strong> · Sl qty <strong>{fmtNum(sum.SQTY)}</strong> · Bal{' '}
              <strong>{fmtNum(sum.BQTY)}</strong>
            </p>

            <h4 className="pending-order-detail-modal__section">Dispatch challan entries (IN)</h4>
            <div className="table-responsive table-responsive--pending-challan-detail">
              <table className="report-table report-table--pending-order-detail">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Ch no</th>
                    <th>Date</th>
                    <th>R no</th>
                    <th>Tp</th>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Item</th>
                    <th>Item name</th>
                    <th>St</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Weight</th>
                    <th className="text-right">Amount</th>
                    <th>Marka</th>
                    <th>SO no</th>
                    <th>Plant</th>
                  </tr>
                </thead>
                <tbody>
                  {challanLines.length === 0 ? (
                    <tr>
                      <td colSpan={17}>No dispatch challan lines.</td>
                    </tr>
                  ) : (
                    challanLines.map((r, i) => (
                      <tr key={`in-${i}`} className={r.HIGHLIGHT ? 'pending-challan-detail-row--highlight' : undefined}>
                        <td>{r.TRN_NO || i + 1}</td>
                        <td>{r.CH_NO}</td>
                        <td>{toDisplayDate(toInputDateString(r.DOC_DATE))}</td>
                        <td>{r.DOC_NO}</td>
                        <td>{r.TYPE}</td>
                        <td>{r.CODE}</td>
                        <td>{r.NAME}</td>
                        <td>{r.ITEM_CODE}</td>
                        <td>{r.ITEM_NAME}</td>
                        <td>{r.STATUS}</td>
                        <td className="text-right">{fmtNum(r.RATE, 2)}</td>
                        <td className="text-right">{fmtNum(r.QNTY)}</td>
                        <td className="text-right">{fmtNum(r.WEIGHT)}</td>
                        <td className="text-right">{fmtNum(r.AMOUNT, 2)}</td>
                        <td>{r.MARKA}</td>
                        <td>{r.SO_NO || ''}</td>
                        <td>{r.PLANT_CODE}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <h4 className="pending-order-detail-modal__section">Sale bills (OUT)</h4>
            <div className="table-responsive table-responsive--pending-challan-detail">
              <table className="report-table report-table--pending-order-detail">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Ch no</th>
                    <th>Bill date</th>
                    <th>Bill no</th>
                    <th>B type</th>
                    <th>Type</th>
                    <th>Item</th>
                    <th>Item name</th>
                    <th>St</th>
                    <th className="text-right">Rate</th>
                    <th className="text-right">Qty</th>
                    <th>Marka</th>
                    <th>Plant</th>
                  </tr>
                </thead>
                <tbody>
                  {saleLines.length === 0 ? (
                    <tr>
                      <td colSpan={13}>No sale bill lines against this challan.</td>
                    </tr>
                  ) : (
                    saleLines.map((r, i) => (
                      <tr key={`out-${i}`} className={r.HIGHLIGHT ? 'pending-challan-detail-row--highlight' : undefined}>
                        <td>{r.TRN_NO || i + 1}</td>
                        <td>{r.CH_NO}</td>
                        <td>{toDisplayDate(toInputDateString(r.DOC_DATE))}</td>
                        <td>{r.DOC_NO}</td>
                        <td>{r.B_TYPE}</td>
                        <td>{r.TYPE}</td>
                        <td>{r.ITEM_CODE}</td>
                        <td>{r.ITEM_NAME}</td>
                        <td>{r.STATUS}</td>
                        <td className="text-right">{fmtNum(r.RATE, 2)}</td>
                        <td className="text-right">{fmtNum(r.QNTY)}</td>
                        <td>{r.MARKA}</td>
                        <td>{r.PLANT_CODE}</td>
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

function mapRow(r) {
  return {
    CH_NO: r.CH_NO ?? r.ch_no ?? '',
    CH_DATE: toDisplayDate(toInputDateString(r.CH_DATE ?? r.ch_date)),
    CH_TYPE: r.CH_TYPE ?? r.ch_type ?? '',
    CODE: r.CODE ?? r.code ?? '',
    NAME: r.NAME ?? r.name ?? '',
    ITEM_CODE: r.ITEM_CODE ?? r.item_code ?? '',
    ITEM_NAME: r.ITEM_NAME ?? r.item_name ?? '',
    MARKA: r.MARKA ?? r.marka ?? '',
    STATUS: r.STATUS ?? r.status ?? '',
    RATE: Number(r.RATE ?? r.rate ?? 0),
    D_QNTY: Number(r.D_QNTY ?? r.d_qnty ?? 0),
    B_QNTY: Number(r.B_QNTY ?? r.b_qnty ?? 0),
    BQTY: Number(r.BQTY ?? r.bqty ?? r.BAL_QNTY ?? 0),
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0),
    PLANT_CODE: r.PLANT_CODE ?? r.plant_code ?? '',
  };
}

export default function SlidePendingDispatchChallanReport({
  apiBase,
  formData,
  onPrev,
  onReset,
  slideClass = 'slide-39-pending-dispatch-challan',
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [sDate, setSDate] = useState(() => toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const [eDate, setEDate] = useState(() => toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));
  const [cp, setCp] = useState('P');
  const [partyCode, setPartyCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [itemCode, setItemCode] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [itemHi, setItemHi] = useState(0);
  const [plantCode, setPlantCode] = useState('');
  const [chType, setChType] = useState('');

  const [parties, setParties] = useState([]);
  const [items, setItems] = useState([]);
  const [plants, setPlants] = useState([]);
  const [rows, setRows] = useState([]);
  const [rateChk, setRateChk] = useState('N');
  const [markaChk, setMarkaChk] = useState('N');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [showReport, setShowReport] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailErr, setDetailErr] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailRow, setDetailRow] = useState(null);

  const formRef = useRef(null);
  const sDateInputRef = useRef(null);

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
      axios.get(`${apiBase}/api/salelist-items`, { params, ...reqOpts }),
      axios.get(`${apiBase}/api/salelist-plants`, { params, ...reqOpts }),
    ])
      .then(([pRes, iRes, plRes]) => {
        setParties(Array.isArray(pRes.data) ? pRes.data : []);
        setItems(Array.isArray(iRes.data) ? iRes.data : []);
        setPlants(Array.isArray(plRes.data) ? plRes.data : []);
      })
      .catch(() => {});
  }, [apiBase, compCode, compUid]);

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

  const reportRows = useMemo(() => rows.map(mapRow), [rows]);

  const totals = useMemo(() => {
    let d = 0;
    let b = 0;
    let bal = 0;
    let a = 0;
    for (const row of reportRows) {
      d += row.D_QNTY;
      b += row.B_QNTY;
      bal += row.BQTY;
      a += row.AMOUNT;
    }
    return { dqty: d, bqty: b, bal, amount: a };
  }, [reportRows]);

  const partyLabel = useMemo(() => {
    if (!partyCode) return 'All codes';
    const p = parties.find((x) => String(x.CODE ?? x.code) === String(partyCode));
    return p ? `[${partyCode}] ${p.NAME ?? p.name}` : String(partyCode);
  }, [partyCode, parties]);

  const plantLabel = useMemo(() => {
    if (!plantCode.trim()) return 'All godowns';
    const pl = plants.find((x) => String(x.PLANT_CODE ?? x.plant_code).trim() === plantCode.trim());
    return pl
      ? `[${plantCode.trim()}] ${pl.PLANT_NAME ?? pl.plant_name ?? ''}`.trim()
      : plantCode.trim();
  }, [plantCode, plants]);

  const chTypeLabel = chType.trim() ? `Type ${chType.trim()}` : 'All challan types';

  const itemLabel = useMemo(() => {
    if (!itemCode) return 'All items';
    const it = items.find((x) => String(x.ITEM_CODE ?? x.item_code) === String(itemCode));
    return it ? `[${itemCode}] ${it.ITEM_NAME ?? it.item_name}` : String(itemCode);
  }, [itemCode, items]);

  const cpLabel = cp === 'C' ? 'Complete (all)' : 'Pending only';

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      reportTitle: 'Pending Challan',
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
      partyLabel: partyLabel,
      itemLabel,
      cpLabel,
      plantLabel,
      chTypeLabel,
      rateChkLabel: rateChk === 'Y' ? 'Rate check: Yes' : 'Rate check: No',
      markaChkLabel: markaChk === 'Y' ? 'Marka check: Yes' : 'Marka check: No',
    }),
    [compName, sDate, eDate, partyLabel, itemLabel, cp, plantLabel, chTypeLabel, rateChk, markaChk]
  );

  const excelRows = useMemo(
    () =>
      reportRows.map((r) => ({
        'Ch No': r.CH_NO,
        'Ch Date': r.CH_DATE,
        Tp: r.CH_TYPE,
        Code: r.CODE,
        Name: r.NAME,
        Item: r.ITEM_CODE,
        'Item Name': r.ITEM_NAME,
        Marka: r.MARKA,
        Status: r.STATUS,
        Rate: r.RATE,
        'Ch Qty': r.D_QNTY,
        'Sl Qty': r.B_QNTY,
        Bal: r.BQTY,
        Amount: r.AMOUNT,
        Plant: r.PLANT_CODE,
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
      if (plantCode.trim()) params.plant_code = plantCode.trim();
      if (chType.trim()) params.ch_type = chType.trim().slice(0, 1);
      const { data } = await axios.get(`${apiBase}/api/pending-dispatch-challan-report`, { params, ...reqOpts });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setRateChk(String(data?.rate_chk ?? 'N').toUpperCase());
      setMarkaChk(String(data?.marka_chk ?? 'N').toUpperCase());
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
    setDetailRow(row);
    setDetailTitle(`Challan ${row.CH_NO} · Type ${row.CH_TYPE} — ${row.NAME || 'All entries'}`);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        e_date: toOracleDate(eDate),
        ch_no: row.CH_NO,
        ch_type: row.CH_TYPE,
        highlight_item: row.ITEM_CODE,
      };
      if (plantCode.trim()) params.plant_code = plantCode.trim();
      const { data } = await axios.get(`${apiBase}/api/pending-challan-detail`, { params, ...reqOpts });
      setDetail(data);
    } catch (e) {
      setDetailErr(e?.response?.data?.error || e.message || 'Detail failed');
    } finally {
      setDetailLoading(false);
    }
  };

  const shareText = `${compName}\nPending Challan\n${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}`;

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
              generatePDF('pending-dispatch-challan', { rows: reportRows }, pdfMeta).catch((e) =>
                alert(e?.message || String(e))
              )
            }
          >
            Pdf
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!reportRows.length}
            onClick={() => {
              const html = buildReportHtml('pending-dispatch-challan', { rows: reportRows }, pdfMeta);
              printHtmlDocument(html, 'Pending Challan');
            }}
          >
            Print
          </button>
          <button
            type="button"
            className="btn btn-excel"
            disabled={!reportRows.length}
            onClick={() => downloadExcelRows(excelRows, 'PendingDispatchChallan', `${compName}_PendingDispatchChallan`)}
          >
            Excel
          </button>
          <button
            type="button"
            className="btn btn-whatsapp"
            disabled={!reportRows.length}
            onClick={() =>
              sharePdfWithWhatsApp('pending-dispatch-challan', { rows: reportRows }, pdfMeta, shareText).catch((e) =>
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
      <SessionInfoLine helpReportId="pending-dispatch-challan">
        <SessionLineText formData={formData} />
      </SessionInfoLine>

      <div className="report-toolbar">
        <h2>Pending Challan</h2>
        {toolbar}
      </div>

      {!showReport ? (
        <form
          id="pending-dispatch-challan-form"
          ref={formRef}
          className="report-form report-form--pending-order"
          autoComplete="off"
          onSubmit={handleSubmit}
          onKeyDown={onFormFieldEnter}
        >
          <div className="form-row-broker form-row-broker--dates">
            <div className="form-group">
              <label htmlFor="pdc-s-date">Starting date</label>
              <input
                id="pdc-s-date"
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
              <label htmlFor="pdc-e-date">Ending date</label>
              <input
                id="pdc-e-date"
                type="date"
                lang="en-GB"
                className="form-input"
                value={eDate}
                onChange={(e) => setEDate(e.target.value)}
                onKeyDown={onDateEnter}
              />
            </div>
          </div>

          <div className="form-group account-search-group">
            <label>Specific code</label>
            <input
              id="pdc-party-search"
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
              onFocus={(e) => scrollReportFieldIntoView(e.target)}
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
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={(e) => pickSearchResult(e, () => applyPartyPick(pc))}
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
              id="pdc-item-search"
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
              onFocus={(e) => scrollReportFieldIntoView(e.target)}
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
                        onPointerDown={(e) => e.preventDefault()}
                        onClick={(e) => pickSearchResult(e, () => applyItemPick(ic))}
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

          <div className="form-row-broker form-row-broker--dates">
            <div className="form-group">
              <label htmlFor="pdc-pc">Pending / Complete (P/C)</label>
              <select id="pdc-pc" className="form-input" value={cp} onChange={(e) => setCp(e.target.value)}>
                <option value="P">P — Pending (Bal &gt; 0)</option>
                <option value="C">C — Complete (all incl. billed)</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pdc-godown">Godown</label>
              <input
                id="pdc-godown"
                list="pdc-godown-list"
                className="form-input"
                value={plantCode}
                onChange={(e) => setPlantCode(e.target.value)}
                placeholder="Plant / godown code"
              />
              <datalist id="pdc-godown-list">
                {plants.map((g) => (
                  <option
                    key={String(g.PLANT_CODE ?? g.plant_code)}
                    value={String(g.PLANT_CODE ?? g.plant_code).trim()}
                  >
                    {String(g.PLANT_NAME ?? g.plant_name ?? '')}
                  </option>
                ))}
              </datalist>
            </div>
            <div className="form-group">
              <label htmlFor="pdc-ch-type">Specific challan type</label>
              <input
                id="pdc-ch-type"
                type="text"
                className="form-input"
                maxLength={1}
                value={chType}
                onChange={(e) => setChType(e.target.value.slice(0, 1))}
                placeholder="e.g. D"
              />
            </div>
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
              Period: {toDisplayDate(sDate)} to {toDisplayDate(eDate)} · {cpLabel} · {partyLabel} · {itemLabel} ·{' '}
              {plantLabel} · {chTypeLabel}
              {rateChk === 'Y' ? ' · Rate check on' : ''}
              {markaChk === 'Y' ? ' · Marka check on' : ''}
            </p>
            <p>
              {reportRows.length} line(s) · Ch qty {fmtNum(totals.dqty)} · Sl qty {fmtNum(totals.bqty)} · Bal{' '}
              {fmtNum(totals.bal)} · Amount {fmtNum(totals.amount, 2)}
            </p>
            <p className="sale-bill-section__hint">Click any row to see all line entries for that challan.</p>
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
                        key={`${r.CH_NO}-${r.ITEM_CODE}-${r.STATUS}-${r.RATE}-${i}`}
                        className="sale-list-row-clickable"
                        title="Click for challan / sale bill detail"
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
                        <strong>{fmtNum(totals.dqty)}</strong>
                      </td>
                      <td className="text-right">
                        <strong>{fmtNum(totals.bqty)}</strong>
                      </td>
                      <td className="text-right">
                        <strong>{fmtNum(totals.bal)}</strong>
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

      <PendingChallanDetailModal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
        err={detailErr}
        detail={detail}
        title={detailTitle}
        selectedRow={detailRow}
      />

      {loading && !showReport ? <p className="loading-msg">Loading…</p> : null}
    </div>
  );
}
