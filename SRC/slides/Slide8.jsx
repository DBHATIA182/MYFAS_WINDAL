import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import SessionInfoLine, { SessionLineText } from '../components/SessionInfoLine';
import {
  filterCodeNameCityRows,
  filterItemCodeNameRows,
  SEARCH_ITEM_TYPE_HINT,
  SEARCH_NO_MATCH,
  SEARCH_TYPE_HINT,
} from '../utils/masterSearchFilter';

/** VFP9 PTYPE: Oracle SALE.TYPE is NUMBER 1–9 (not SL/CN text). */
const SALE_LIST_NUMTYPE_TO_PRINT = {
  1: 'SL',
  2: 'CH',
  3: 'SL',
  6: 'SE',
  8: 'CN',
  9: 'RC',
};

const SALE_LIST_PTYPE_OPTIONS = [
  { value: '', label: 'Mixed — all types 1–9 (same as VFP “all lists” in range)' },
  { value: '1', label: '1 — Retail invoice list' },
  { value: '2', label: '2 — Consignment challan list' },
  { value: '3', label: '3 — Tax invoice list' },
  { value: '4', label: '4 — Goods return list' },
  { value: '5', label: '5 — Goods return consignment list' },
  { value: '6', label: '6 — Tax invoice others list' },
  { value: '7', label: '7 — Debit note list' },
  { value: '8', label: '8 — Credit note list' },
  { value: '9', label: '9 — Reverse charge invoice list' },
];

function highlightMatch(text, q) {
  if (text == null) return null;
  const s = String(text);
  const query = q.trim();
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

export default function Slide8({ apiBase, formData, onPrev, onReset }) {
  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [items, setItems] = useState([]);
  const [plants, setPlants] = useState([]);
  const [markas, setMarkas] = useState([]);
  const [bTypes, setBTypes] = useState([]);
  const [lookupError, setLookupError] = useState('');

  const [salePtype, setSalePtype] = useState('');
  const [billNoStart, setBillNoStart] = useState('');
  const [billNoEnd, setBillNoEnd] = useState('');
  const [selectedPlant, setSelectedPlant] = useState('');
  const [markaInput, setMarkaInput] = useState('');
  const [bTypeInput, setBTypeInput] = useState('');

  const [partySearch, setPartySearch] = useState('');
  const [brokerSearch, setBrokerSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [brokerHi, setBrokerHi] = useState(0);
  const [itemHi, setItemHi] = useState(0);

  const [selectedMcode, setSelectedMcode] = useState('');
  const [selectedBk, setSelectedBk] = useState('');
  const [selectedItem, setSelectedItem] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [saleSortMode, setSaleSortMode] = useState('date');

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const lookupRequestSeqRef = useRef(0);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const sRaw = formData.comp_s_dt ?? formData.COMP_S_DT;
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const s = toInputDateString(sRaw);
    const e = toInputDateString(eRaw);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    const requestSeq = ++lookupRequestSeqRef.current;

    const load = async () => {
      if (!compCode || !compUid) return;
      setLookupError('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const dateParams = { ...params };
        if (startDate && endDate) {
          dateParams.s_date = toOracleDate(startDate);
          dateParams.e_date = toOracleDate(endDate);
        }
        const [pr, br, it] = await Promise.all([
          axios.get(`${apiBase}/api/salelist-parties`, { params }),
          axios.get(`${apiBase}/api/salelist-brokers`, { params }),
          axios.get(`${apiBase}/api/salelist-items`, { params }),
        ]);

        const mkParams = startDate && endDate ? dateParams : params;
        const [plR, mkR, btR] = await Promise.allSettled([
          axios.get(`${apiBase}/api/salelist-plants`, { params }),
          axios.get(`${apiBase}/api/salelist-markas`, { params: mkParams }),
          axios.get(`${apiBase}/api/salelist-btypes`, { params: mkParams }),
        ]);

        // Ignore stale responses from older requests (prevents full-list overwrite).
        if (requestSeq !== lookupRequestSeqRef.current) return;

        const pList = Array.isArray(pr.data) ? pr.data : [];
        const bList = Array.isArray(br.data) ? br.data : [];
        const iList = Array.isArray(it.data) ? it.data : [];
        const plList = plR.status === 'fulfilled' && Array.isArray(plR.value.data) ? plR.value.data : [];
        const mkList = mkR.status === 'fulfilled' && Array.isArray(mkR.value.data) ? mkR.value.data : [];
        const btList = btR.status === 'fulfilled' && Array.isArray(btR.value.data) ? btR.value.data : [];
        setParties(pList);
        setBrokers(bList);
        setItems(iList);
        setPlants(plList);
        setMarkas(mkList);
        setBTypes(btList);

        setSelectedMcode((prev) => {
          if (!prev) return prev;
          const ok = pList.some((p) => String(p.CODE ?? p.code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
        setSelectedBk((prev) => {
          if (!prev) return prev;
          const ok = bList.some((b) => String(b.CODE ?? b.code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
        setSelectedItem((prev) => {
          if (!prev) return prev;
          const ok = iList.some((r) => String(r.ITEM_CODE ?? r.item_code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
        setSelectedPlant((prev) => {
          if (!prev) return prev;
          const ok = plList.some((r) => String(r.PLANT_CODE ?? r.plant_code ?? '').trim() === String(prev).trim());
          return ok ? prev : '';
        });
      } catch (err) {
        // Ignore stale errors from older requests.
        if (requestSeq !== lookupRequestSeqRef.current) return;

        console.error('Sale list lookups:', err);
        const st = err.response?.status;
        setLookupError(
          st === 404
            ? `No /api/salelist-* routes on ${formatApiOrigin(apiBase)}. Run \`npm run server\` (port 5001) with the latest server.cjs, then refresh.`
            : err.response?.data?.error || err.message || 'Request failed'
        );
      }
    };
    load();
  }, [apiBase, compCode, compUid, startDate, endDate]);

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [parties, partySearch]
  );

  const filteredBrokers = useMemo(
    () => filterCodeNameCityRows(brokers, brokerSearch, 50),
    [brokers, brokerSearch]
  );

  const filteredItems = useMemo(
    () => filterItemCodeNameRows(items, itemSearch, 50),
    [items, itemSearch]
  );

  useEffect(() => {
    setPartyHi(0);
  }, [partySearch]);
  useEffect(() => {
    setBrokerHi(0);
  }, [brokerSearch]);
  useEffect(() => {
    setItemHi(0);
  }, [itemSearch]);

  const safePartyHi = Math.min(partyHi, Math.max(0, filteredParties.length - 1));
  const safeBrokerHi = Math.min(brokerHi, Math.max(0, filteredBrokers.length - 1));
  const safeItemHi = Math.min(itemHi, Math.max(0, filteredItems.length - 1));

  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code) === String(selectedMcode));
  const selectedBrokerRow = brokers.find((b) => String(b.CODE ?? b.code) === String(selectedBk));
  const selectedItemRow = items.find((r) => String(r.ITEM_CODE ?? r.item_code) === String(selectedItem));

  const openSaleBill = (row) => {
    const typRaw = row.TYPE ?? row.type;
    const typU = String(typRaw ?? '')
      .trim()
      .toUpperCase();
    const num = typeof typRaw === 'number' ? typRaw : parseInt(String(typRaw ?? '').trim(), 10);
    let printType = typU;
    if (Number.isFinite(num) && num >= 1 && num <= 9) {
      const mapped = SALE_LIST_NUMTYPE_TO_PRINT[num];
      if (!mapped) {
        alert('Print preview is not mapped for this document type number (4, 5, or 7).');
        return;
      }
      printType = mapped;
    } else if (!['SL', 'SE', 'CN', 'CH', 'RC'].includes(typU)) {
      alert('Print preview supports SL, SE, CN, CH, RC, or numeric TYPE 1–3, 6, 8–9 mapped to those.');
      return;
    }
    const billNo = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bType = row.B_TYPE ?? row.b_type ?? '';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (typRaw == null || typRaw === '' || billNo == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    const oracleExact =
      typeof typRaw === 'number'
        ? typRaw
        : Number.isFinite(num) && num >= 1 && num <= 9
          ? num
          : null;
    setBillPrintParams({
      type: printType,
      oracleTypeNum: oracleExact ?? undefined,
      billNo: String(billNo).trim(),
      bType: String(bType).trim(),
      oracleDt,
      compYear: String(compYear ?? '').trim(),
      label: `Sale bill — ${printType} (${typRaw}) / ${billNo} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert('Please set starting and ending dates.');
      return;
    }
    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(startDate),
        e_date: toOracleDate(endDate),
      };
      if (selectedMcode.trim()) params.mcode = selectedMcode.trim();
      if (selectedBk.trim()) params.b_code = selectedBk.trim();
      if (selectedItem.trim()) params.item_code = selectedItem.trim();
      if (salePtype.trim()) params.ptype = salePtype.trim();
      if (billNoStart.trim()) params.sb_no = billNoStart.trim();
      if (billNoEnd.trim()) params.eb_no = billNoEnd.trim();
      if (selectedPlant.trim()) params.plant_code = selectedPlant.trim();
      if (markaInput.trim()) params.marka = markaInput.trim();
      if (bTypeInput.trim()) params.b_type = bTypeInput.trim();

      const { data } = await axios.get(`${apiBase}/api/sale-list`, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert(
          'No rows returned. Check: dates and bill no range; clear party / broker / item / plant / marka / B type. The list uses numeric SALE.TYPE = ptype (1–9), or TYPE 1–9 when “Mixed” is selected.'
        );
      } else {
        setReportData(rows);
        setSaleSortMode('date');
        setShowReport(true);
      }
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const listTypeLabel = SALE_LIST_PTYPE_OPTIONS.find((o) => o.value === salePtype)?.label ?? 'Mixed — TYPE 1–9';
  const selectedPlantRow = plants.find((p) => String(p.PLANT_CODE ?? p.plant_code ?? '').trim() === selectedPlant.trim());
  const pdfMeta = {
    companyName: compName,
    year: compYear,
    endDate: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    listTypeLabel,
    partyLabel: selectedMcode
      ? `${selectedMcode} — ${selectedPartyRow?.NAME ?? ''}`
      : 'All parties',
    brokerLabel: selectedBk ? `${selectedBk} — ${selectedBrokerRow?.NAME ?? ''}` : 'All brokers',
    itemLabel: selectedItem
      ? `${selectedItem} — ${selectedItemRow?.ITEM_NAME ?? selectedItemRow?.item_name ?? ''}`
      : 'All items',
    billRangeLabel:
      billNoStart.trim() || billNoEnd.trim()
        ? `Bill no ${billNoStart.trim() || '…'} – ${billNoEnd.trim() || '…'}`
        : 'All bill numbers',
    plantLabel: selectedPlant
      ? `${selectedPlant} — ${selectedPlantRow?.PLANT_NAME ?? selectedPlantRow?.plant_name ?? ''}`
      : 'All godowns / plants',
    markaLabel: markaInput.trim() ? markaInput.trim() : 'All marka',
    bTypeLabel: bTypeInput.trim() ? bTypeInput.trim() : 'All B type',
  };

  const downloadPDF = () => generatePDF('sale-list', reportData, pdfMeta);

  const shareWhatsApp = () => {
    const shareText = [
      `Sale bill list — ${compName}`,
      `${compYear} | ${pdfMeta.listTypeLabel}`,
      pdfMeta.endDate,
      pdfMeta.partyLabel,
      pdfMeta.brokerLabel,
      pdfMeta.itemLabel,
      pdfMeta.billRangeLabel,
      pdfMeta.plantLabel,
      pdfMeta.markaLabel,
      pdfMeta.bTypeLabel,
    ].join('\n');
    return sharePdfWithWhatsApp('sale-list', reportData, pdfMeta, shareText);
  };

  if (showReport && reportData.length > 0) {
    const saleSortLabel =
      saleSortMode === 'party' ? 'Party-wise' : saleSortMode === 'item' ? 'Item-wise' : saleSortMode === 'broker' ? 'Broker-wise' : 'Date-wise';
    return (
      <div className="slide slide-report">
        <SaleBillPrintModal
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
        <SessionInfoLine formData={formData} helpReportId="sale-list" />
        <div className="report-toolbar">
          <h2>Sale bill list</h2>
          <div className="toolbar-actions">
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-export"
              onClick={() => downloadPDF().catch((err) => alert(err?.message || String(err)))}
            >
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(reportData, 'SaleList', `${compName}_SaleList`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button
              type="button"
              className="btn btn-whatsapp"
              onClick={() => shareWhatsApp().catch((err) => alert(err?.message || String(err)))}
            >
              💬 WhatsApp
            </button>
          </div>
        </div>

        <div className="report-sort-switch" role="group" aria-label="Sale list sort">
          <span className="report-sort-switch__label">Sort:</span>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'date' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('date')}
          >
            Date
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'party' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('party')}
          >
            Party
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'item' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('item')}
          >
            Item
          </button>
          <button
            type="button"
            className={`btn btn-secondary btn-sort-switch${saleSortMode === 'broker' ? ' is-active' : ''}`}
            onClick={() => setSaleSortMode('broker')}
          >
            Broker
          </button>
        </div>

        <div className="report-info">
          <p>
            <strong>Period</strong> {toDisplayDate(startDate)} – {toDisplayDate(endDate)}
          </p>
        </div>

        <div className="report-display">
          <ReportTable data={reportData} type="sale-list" onSaleBillClick={openSaleBill} saleListSortMode={saleSortMode} />
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
    <div className="slide slide-8">
      <h2>Sale bill list</h2>
      <SessionInfoLine formData={formData} helpReportId="sale-list">
        <br />
        <span className="compdet-date-hint">
          Same as VFP9 <code>MVAR</code>: <code>SALE.TYPE</code> is a <strong>number</strong> (1–9) matching the document list; filter is{' '}
          <code>A.TYPE = ptype</code> or <code>A.TYPE BETWEEN 1 AND 9</code> when Mixed. Dates, bill range, party, broker (
          <code>MASTER</code> schedule ≈ 11.20), item, <code>PLANT</code>, marka, B type. Item is <code>LEFT JOIN</code>. Row click maps
          numeric type to SL / CH / SE / CN / RC for print where supported.
        </span>
      </SessionInfoLine>

      {lookupError ? (
        <div className="form-api-error" role="alert">
          <strong>Could not load help lists.</strong> {lookupError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ Loading…' : 'Run'}
          </button>
        </div>

        <div className="form-group">
          <label htmlFor="sl-ptype">Document list (VFP PTYPE)</label>
          <select
            id="sl-ptype"
            className="form-input"
            value={salePtype}
            onChange={(e) => setSalePtype(e.target.value)}
          >
            {SALE_LIST_PTYPE_OPTIONS.map((o) => (
              <option key={o.value || 'legacy'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="sl-start">Starting date</label>
          <input
            id="sl-start"
            type="date"
            lang="en-GB"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="sl-end">Ending date</label>
          <input
            id="sl-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sl-bill-start">Starting bill no (optional)</label>
            <input
              id="sl-bill-start"
              type="text"
              inputMode="numeric"
              className="form-input"
              autoComplete="off"
              value={billNoStart}
              onChange={(e) => setBillNoStart(e.target.value)}
              placeholder="e.g. 1"
            />
          </div>
          <div className="form-group">
            <label htmlFor="sl-bill-end">Ending bill no (optional)</label>
            <input
              id="sl-bill-end"
              type="text"
              inputMode="numeric"
              className="form-input"
              autoComplete="off"
              value={billNoEnd}
              onChange={(e) => setBillNoEnd(e.target.value)}
              placeholder="e.g. 999999"
            />
          </div>
        </div>

        {/* Party MCODE */}
        <div className="form-group account-search-group">
          <label htmlFor="sl-party-search">Specific party (MCODE) — optional</label>
          <input
            id="sl-party-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search party name, city, or code…"
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedMcode) return;
              const max = Math.max(0, filteredParties.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredParties.length === 0) return;
                setPartyHi((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPartyHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const r = filteredParties[safePartyHi];
                if (r) {
                  e.preventDefault();
                  setSelectedMcode(String(r.CODE ?? r.code ?? '').trim());
                  setPartySearch('');
                }
              }
            }}
          />
          {selectedMcode ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedMcode}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedMcode('');
                  setPartySearch('');
                }}
              >
                Clear
              </button>
            </p>
          ) : partySearch.trim() ? (
            <div className="account-search-results party-search-results" role="listbox">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
              </div>
              {filteredParties.length === 0 ? (
                <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
              ) : (
                filteredParties.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safePartyHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      role="option"
                      className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setPartyHi(index)}
                      onClick={() => {
                        setSelectedMcode(String(code).trim());
                        setPartySearch('');
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(code, partySearch)}</span>
                      <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, partySearch)}</span>
                      <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <p className="sale-bill-section__hint dc-party-search-hint">{SEARCH_TYPE_HINT}</p>
          )}
        </div>

        {/* Broker */}
        <div className="form-group account-search-group">
          <label htmlFor="sl-broker-search">Specific broker (SALE.B_CODE); list = MASTER schedule ≈ 11.20 — optional</label>
          <input
            id="sl-broker-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search broker…"
            value={brokerSearch}
            onChange={(e) => setBrokerSearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedBk) return;
              const max = Math.max(0, filteredBrokers.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredBrokers.length === 0) return;
                setBrokerHi((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setBrokerHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const r = filteredBrokers[safeBrokerHi];
                if (r) {
                  e.preventDefault();
                  setSelectedBk(String(r.CODE ?? r.code ?? '').trim());
                  setBrokerSearch('');
                }
              }
            }}
          />
          {selectedBk ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedBrokerRow?.NAME ?? '—'}</strong> (<code>{selectedBk}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedBk('');
                  setBrokerSearch('');
                }}
              >
                Clear
              </button>
            </p>
          ) : brokerSearch.trim() ? (
            <div className="account-search-results party-search-results" role="listbox">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
              </div>
              {filteredBrokers.length === 0 ? (
                <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
              ) : (
                filteredBrokers.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safeBrokerHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setBrokerHi(index)}
                      onClick={() => {
                        setSelectedBk(String(code).trim());
                        setBrokerSearch('');
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(code, brokerSearch)}</span>
                      <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, brokerSearch)}</span>
                      <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <p className="sale-bill-section__hint dc-party-search-hint">{SEARCH_TYPE_HINT}</p>
          )}
        </div>

        {/* Item */}
        <div className="form-group account-search-group">
          <label htmlFor="sl-item-search">Specific item (ITEM_CODE) — optional</label>
          <input
            id="sl-item-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search item name or code…"
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedItem) return;
              const max = Math.max(0, filteredItems.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredItems.length === 0) return;
                setItemHi((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setItemHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const r = filteredItems[safeItemHi];
                if (r) {
                  e.preventDefault();
                  setSelectedItem(String(r.ITEM_CODE ?? r.item_code ?? '').trim());
                  setItemSearch('');
                }
              }
            }}
          />
          {selectedItem ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedItemRow?.ITEM_NAME ?? selectedItemRow?.item_name ?? '—'}</strong> (
              <code>{selectedItem}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedItem('');
                  setItemSearch('');
                }}
              >
                Clear
              </button>
            </p>
          ) : itemSearch.trim() ? (
            <div className="account-search-results broker-search-results" role="listbox">
              <div className="account-search-header broker-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
              </div>
              {filteredItems.length === 0 ? (
                <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
              ) : (
                filteredItems.map((row, index) => {
                  const code = row.ITEM_CODE ?? row.item_code;
                  const rowHi = safeItemHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      className={`account-search-row broker-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setItemHi(index)}
                      onClick={() => {
                        setSelectedItem(String(code).trim());
                        setItemSearch('');
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(code, itemSearch)}</span>
                      <span className="account-search-name">
                        {highlightMatch(row.ITEM_NAME ?? row.item_name, itemSearch)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <p className="sale-bill-section__hint dc-party-search-hint">{SEARCH_ITEM_TYPE_HINT}</p>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="sl-plant">Specific godown / plant (PLANT_CODE) — optional</label>
          <select
            id="sl-plant"
            className="form-input"
            value={selectedPlant}
            onChange={(e) => setSelectedPlant(e.target.value)}
          >
            <option value="">All plants</option>
            {plants.map((p) => {
              const code = String(p.PLANT_CODE ?? p.plant_code ?? '').trim();
              const name = String(p.PLANT_NAME ?? p.plant_name ?? '').trim();
              return (
                <option key={code || name} value={code}>
                  {name ? `${name} (${code})` : code || '—'}
                </option>
              );
            })}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="sl-marka">Specific marka — optional</label>
          <input
            id="sl-marka"
            type="text"
            className="form-input"
            list="sl-marka-datalist"
            autoComplete="off"
            value={markaInput}
            onChange={(e) => setMarkaInput(e.target.value)}
            placeholder="Type or pick from list"
          />
          <datalist id="sl-marka-datalist">
            {markas.map((r, i) => {
              const m = String(r.MARKA ?? r.marka ?? '').trim();
              return m ? <option key={`${m}-${i}`} value={m} /> : null;
            })}
          </datalist>
        </div>

        <div className="form-group">
          <label htmlFor="sl-btype">Specific B type — optional</label>
          <input
            id="sl-btype"
            type="text"
            className="form-input"
            list="sl-btype-datalist"
            autoComplete="off"
            value={bTypeInput}
            onChange={(e) => setBTypeInput(e.target.value)}
            placeholder="Type or pick from list"
          />
          <datalist id="sl-btype-datalist">
            {bTypes.map((r, i) => {
              const t = String(r.B_TYPE ?? r.b_type ?? '').trim();
              return t ? <option key={`${t}-${i}`} value={t} /> : null;
            })}
          </datalist>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ Loading…' : 'Run'}
          </button>
        </div>
      </form>
    </div>
  );
}
