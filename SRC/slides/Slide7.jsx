import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import { filterBrokerOsRawRowsByMinClosingAbs, parseBrokerOsRangeForUi } from '../utils/brokerOsDisplay';
import ReportHelpButton from '../components/ReportHelpButton';
import { filterCodeNameCityRows, SEARCH_NO_MATCH, SEARCH_TYPE_HINT } from '../utils/masterSearchFilter';

const DEFAULT_HISTORY_START_DATE = '2001-04-01';

/** Default B_CODE range on BrokerOs. */
const BROKER_OS_RANGE_START = '26001';
const BROKER_OS_RANGE_END = '26999';

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

export default function Slide7({ apiBase, onPrev, onReset, formData }) {
  const [brokers, setBrokers] = useState([]);
  const [parties, setParties] = useState([]);
  const [brokStart, setBrokStart] = useState(BROKER_OS_RANGE_START);
  const [brokEnd, setBrokEnd] = useState(BROKER_OS_RANGE_END);
  const [brokerSearch, setBrokerSearch] = useState('');
  const [brokerListHighlight, setBrokerListHighlight] = useState(0);
  const [selectedParty, setSelectedParty] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [mco, setMco] = useState('A');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [payEndDate, setPayEndDate] = useState('');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const dateStartRef = useRef(null);
  const partySearchRef = useRef(null);
  const brokerSearchRef = useRef(null);
  const [listHighlight, setListHighlight] = useState(0);
  /** Dr/Cr column order: blank or ≠11.10 → Dr then Cr; 11.10 (creditors) → Cr then Dr. */
  const [brokerOsSchedule, setBrokerOsSchedule] = useState('');
  /** Bills with |final / closing balance| below this are omitted from the list (PDF, Excel, screen). */
  const [brokerOsMinIgnore, setBrokerOsMinIgnore] = useState('');
  const [whatsAppBusy, setWhatsAppBusy] = useState(false);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const e = toInputDateString(eRaw);
    setStartDate(DEFAULT_HISTORY_START_DATE);
    if (e) {
      setEndDate(e);
      setPayEndDate(e);
    }
  }, [
    formData.comp_s_dt,
    formData.comp_e_dt,
    formData.COMP_S_DT,
    formData.COMP_E_DT,
  ]);

  useEffect(() => {
    const seed =
      formData.broker_os_schedule ??
      formData.BROKER_OS_SCHEDULE ??
      formData.report_schedule ??
      formData.REPORT_SCHEDULE ??
      '';
    setBrokerOsSchedule(String(seed ?? '').trim());
  }, [compUid]);

  useEffect(() => {
    const load = async () => {
      if (!compCode || !compUid) return;
      setLookupError('');
      try {
        const [br, pr] = await Promise.all([
          axios.get(`${apiBase}/api/broker-os-brokers`, {
            params: { comp_code: compCode, comp_uid: compUid },
          }),
          axios.get(`${apiBase}/api/broker-os-parties`, {
            params: { comp_code: compCode, comp_uid: compUid },
          }),
        ]);
        setBrokers(Array.isArray(br.data) ? br.data : []);
        setParties(Array.isArray(pr.data) ? pr.data : []);
      } catch (err) {
        console.error('Broker OS lookups:', err);
        const st = err.response?.status;
        const baseHint =
          st === 404
            ? `Broker APIs not found on ${formatApiOrigin(apiBase)}. Run \`npm run server\` (port 5001) with the latest server.cjs, then refresh.`
            : (err.response?.data?.error || err.message || 'Request failed');
        setLookupError(baseHint);
      }
    };
    load();
  }, [apiBase, compCode, compUid]);

  /** Reset default numeric band when company / year changes (avoids stale B00001-style values). */
  useEffect(() => {
    setBrokStart(BROKER_OS_RANGE_START);
    setBrokEnd(BROKER_OS_RANGE_END);
  }, [compCode, compUid]);

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [parties, partySearch]
  );

  const filteredBrokers = useMemo(
    () => filterCodeNameCityRows(brokers, brokerSearch, 50),
    [brokers, brokerSearch]
  );

  useEffect(() => {
    setListHighlight(0);
  }, [partySearch]);

  useEffect(() => {
    setBrokerListHighlight(0);
  }, [brokerSearch]);

  const partyMaxIdx = Math.max(0, filteredParties.length - 1);
  const safePartyHi = Math.min(listHighlight, partyMaxIdx);

  const brokerMaxIdx = Math.max(0, filteredBrokers.length - 1);
  const safeBrokerHi = Math.min(brokerListHighlight, brokerMaxIdx);

  const focusDates = () => {
    setTimeout(() => {
      const el = dateStartRef.current;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  const selectPartyRow = (row) => {
    setSelectedParty(String(row.CODE ?? row.code ?? '').trim());
    setPartySearch('');
    focusDates();
  };

  const selectBrokerRow = (row) => {
    const code = String(row.CODE ?? row.code ?? '').trim();
    if (!code) return;
    setBrokStart(code);
    setBrokEnd(code);
    setBrokerSearch('');
    setBrokerListHighlight(0);
    focusDates();
  };

  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code) === String(selectedParty));

  const singleBrokerRow =
    brokStart.trim() &&
    brokStart.trim() === brokEnd.trim()
      ? brokers.find((b) => String(b.CODE ?? b.code ?? '').trim() === brokStart.trim())
      : null;

  /** Numeric band sent to API (matches server parseBrokerOsRangeNum). */
  const brokerRangeLabel = useMemo(() => {
    const a = parseBrokerOsRangeForUi(brokStart);
    const b = parseBrokerOsRangeForUi(brokEnd);
    if (a != null && b != null) {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return `${lo} – ${hi}`;
    }
    return `${brokStart.trim()} – ${brokEnd.trim()}`;
  }, [brokStart, brokEnd]);

  const selectedBrokerName = String(singleBrokerRow?.NAME ?? singleBrokerRow?.name ?? '').trim();
  /** Range + broker name when one broker is selected (for PDF, WhatsApp, and report header). */
  const brokerRangeWithName = selectedBrokerName
    ? `${brokerRangeLabel} — ${selectedBrokerName}`
    : brokerRangeLabel;

  const brokerOsFilteredReportData = useMemo(
    () => filterBrokerOsRawRowsByMinClosingAbs(reportData, brokerOsMinIgnore),
    [reportData, brokerOsMinIgnore],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!brokStart.trim() || !brokEnd.trim()) {
      alert('Please set starting and ending broker codes.');
      return;
    }
    if (!startDate || !endDate || !payEndDate) {
      alert('Please set start date, end date, and payment ending date.');
      return;
    }

    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(startDate),
        e_date: toOracleDate(endDate),
        p_edt: toOracleDate(payEndDate),
        brok_start: brokStart.trim(),
        brok_end: brokEnd.trim(),
        mco,
      };
      if (selectedParty) params.party_code = selectedParty;

      const { data } = await axios.get(`${apiBase}/api/broker-outstanding`, {
        params,
        withCredentials: true,
        timeout: 600000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert('No rows returned. Try All (A), widen broker B_CODE range or dates, or check bills with B_CODE and VR_TYPE S/SE/PU.');
      } else {
        setReportData(rows);
        setShowReport(true);
      }
    } catch (error) {
      const st = error.response?.status;
      const msg =
        st === 404
          ? `404 — broker report API missing on ${formatApiOrigin(apiBase)}. Run \`npm run server\` or redeploy rbrl-api with /api/broker-outstanding.`
          : error.response?.data?.error || error.message;
      alert('Error: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const pdfMeta = {
    companyName: compName,
    year: compYear,
    endDate: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    payEndDate: toDisplayDate(payEndDate),
    brokerRange: brokerRangeWithName,
    partyLabel: selectedParty
      ? `${selectedParty} — ${selectedPartyRow?.NAME ?? ''}`
      : 'All parties (C/S)',
    filterLabel: (() => {
      const base = mco === 'O' ? 'Outstanding only (FINAL_BAL ≠ 0)' : 'All bills';
      const n = parseFloat(String(brokerOsMinIgnore ?? '').replace(/,/g, '').trim());
      if (Number.isFinite(n) && n > 0) {
        return `${base}; hide bills with |final bal| < ${n}`;
      }
      return base;
    })(),
    schedule: brokerOsSchedule,
  };

  const downloadPDF = () => generatePDF('broker-os', brokerOsFilteredReportData, pdfMeta);

  const shareWhatsApp = async () => {
    const brokerHeadline = selectedBrokerName
      ? `Broker: ${String(singleBrokerRow.CODE ?? singleBrokerRow.code ?? '').trim()} — ${selectedBrokerName}`
      : `Brokers: ${brokerRangeLabel}`;
    const shareText = [
      `Broker-wise outstanding — ${compName}`,
      brokerHeadline,
      compYear,
      pdfMeta.partyLabel,
      `Dates ${toDisplayDate(startDate)} – ${toDisplayDate(endDate)} | Pay to ${toDisplayDate(payEndDate)}`,
      mco === 'O' ? 'Filter: Outstanding' : 'Filter: All',
    ].join('\n');
    setWhatsAppBusy(true);
    try {
      await sharePdfWithWhatsApp('broker-os', brokerOsFilteredReportData, pdfMeta, shareText);
    } finally {
      setWhatsAppBusy(false);
    }
  };

  if (showReport && reportData.length > 0) {
    const minIgnoreNum = parseFloat(String(brokerOsMinIgnore ?? '').replace(/,/g, '').trim());
    const minIgnoreActive = Number.isFinite(minIgnoreNum) && minIgnoreNum > 0;

    if (brokerOsFilteredReportData.length === 0) {
      return (
        <div className="slide slide-report">
          <div className="report-toolbar">
            <h2>Broker outstanding</h2>
            <div className="toolbar-actions">
            <ReportHelpButton reportId="broker-os" />
            
              <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
                ← Back
              </button>
            </div>
          </div>
          <div className="report-info" role="status">
            <p>
              <strong>No bills to show.</strong>{' '}
              {minIgnoreActive
                ? `Every bill had |final balance| below your minimum (${minIgnoreNum}). Use ← Back, lower or clear “Minimum amount to ignore”, then Run again.`
                : 'Try widening dates or broker range.'}
            </p>
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
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>Broker outstanding</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="broker-os" />
            
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
                  downloadExcelRows(brokerOsFilteredReportData, 'BrokerOS', `${compName}_BrokerOutstanding`);
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
              disabled={whatsAppBusy}
              onClick={() => shareWhatsApp().catch((err) => alert(err?.message || String(err)))}
            >
              {whatsAppBusy ? 'Preparing…' : '💬 WhatsApp'}
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>Brokers</strong> {brokerRangeWithName}
            {selectedParty ? (
              <>
                {' '}
                · Party <strong>{selectedPartyRow?.NAME ?? selectedParty}</strong> ({selectedParty})
              </>
            ) : (
              <> · All parties (C/S)</>
            )}
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Bills {toDisplayDate(startDate)} – {toDisplayDate(endDate)} · Payment cut-off {toDisplayDate(payEndDate)} ·{' '}
            {mco === 'O' ? 'Outstanding only' : 'All'}
            {minIgnoreActive ? (
              <>
                {' '}
                · Hiding bills whose |final bal| is below <strong>{minIgnoreNum}</strong>
              </>
            ) : null}
          </p>
        </div>

        <div className="report-display">
          <ReportTable data={brokerOsFilteredReportData} type="broker-os" meta={{ schedule: brokerOsSchedule }} />
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
    <div className="slide slide-7">
      <h2>Broker outstanding (BrokerOs)</h2>

      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          Each included bill has at least one <strong>BILLS</strong> line with numeric <strong>b_code</strong> (column{' '}
          <strong>B_CODE</strong>) in your broker range and <strong>VR_TYPE</strong> in <strong>S</strong>, SE, or PU — not SL.
          Credits after the payment ending date are ignored in balances.
        </span>
      </p>

      {lookupError ? (
        <div className="form-api-error" role="alert">
          <strong>Could not load broker / party lists.</strong> {lookupError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form" autoComplete="off">
        <div className="button-group button-group--form-top">
          <button type="button" onClick={onPrev} className="btn btn-secondary">
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="bo-broker-search">Broker name or code (help — pick one broker)</label>
          <input
            id="bo-broker-search"
            ref={brokerSearchRef}
            type="search"
            autoComplete="off"
            placeholder="Search broker name or code… (↑↓ Enter)"
            value={brokerSearch}
            onChange={(e) => setBrokerSearch(e.target.value)}
            onKeyDown={(e) => {
              const max = Math.max(0, filteredBrokers.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredBrokers.length === 0) return;
                setBrokerListHighlight((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setBrokerListHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const row = filteredBrokers[safeBrokerHi];
                if (row) {
                  e.preventDefault();
                  selectBrokerRow(row);
                }
              }
            }}
            className="form-input"
          />
          {singleBrokerRow ? (
            <p className="account-selected-hint">
              Single broker: <strong>{singleBrokerRow.NAME ?? singleBrokerRow.name ?? '—'}</strong> (
              <code>{brokStart.trim()}</code>) — from and to are the same.
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setBrokStart(BROKER_OS_RANGE_START);
                  setBrokEnd(BROKER_OS_RANGE_END);
                  setBrokerSearch('');
                  setBrokerListHighlight(0);
                  setTimeout(() => brokerSearchRef.current?.focus(), 0);
                }}
              >
                All brokers
              </button>
            </p>
          ) : brokerSearch.trim() ? (
            <div className="account-search-results broker-search-results" role="listbox" aria-label="Brokers">
              <div className="account-search-header broker-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
              </div>
              {filteredBrokers.length === 0 ? (
                <div className="account-search-empty">
                  {lookupError ? 'Fix the API error above to load brokers.' : SEARCH_NO_MATCH}
                </div>
              ) : (
                filteredBrokers.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safeBrokerHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      role="option"
                      aria-selected={rowHi}
                      className={`account-search-row broker-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setBrokerListHighlight(index)}
                      onClick={() => selectBrokerRow(row)}
                    >
                      <span className="account-search-code">{highlightMatch(code, brokerSearch)}</span>
                      <span className="account-search-name" title={row.NAME ?? row.name}>
                        {highlightMatch(row.NAME ?? row.name, brokerSearch)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <p className="sale-bill-section__hint dc-party-search-hint">
              {SEARCH_TYPE_HINT} Or set starting / ending broker codes below for a range.
            </p>
          )}
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="bo-b-code-start">Starting broker b_code (B_CODE)</label>
            <input
              id="bo-b-code-start"
              name="broker-os-b-code-start"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={brokStart}
              onChange={(e) => setBrokStart(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={BROKER_OS_RANGE_START}
            />
          </div>
          <div className="form-group">
            <label htmlFor="bo-b-code-end">Ending broker b_code (B_CODE)</label>
            <input
              id="bo-b-code-end"
              name="broker-os-b-code-end"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={brokEnd}
              onChange={(e) => setBrokEnd(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={BROKER_OS_RANGE_END}
            />
          </div>
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="bo-party-search">Specific customer / party (optional — leave empty for all C/S)</label>
          <input
            id="bo-party-search"
            ref={partySearchRef}
            type="search"
            autoComplete="off"
            placeholder="Search code, name, city… (↑↓ Enter)"
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedParty) return;
              const max = Math.max(0, filteredParties.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredParties.length === 0) return;
                setListHighlight((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setListHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const row = filteredParties[safePartyHi];
                if (row) {
                  e.preventDefault();
                  selectPartyRow(row);
                }
              }
            }}
            className="form-input"
          />
          {selectedParty ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedParty}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedParty('');
                  setPartySearch('');
                  setListHighlight(0);
                  setTimeout(() => partySearchRef.current?.focus(), 0);
                }}
              >
                Clear
              </button>
            </p>
          ) : null}
          {!selectedParty && partySearch.trim() ? (
            <div className="account-search-results party-search-results" role="listbox" aria-label="Parties C/S">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
              </div>
              {filteredParties.length === 0 ? (
                <div className="account-search-empty">
                  {lookupError ? 'Fix the API error above to load parties.' : SEARCH_NO_MATCH}
                </div>
              ) : (
                filteredParties.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safePartyHi === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      role="option"
                      aria-selected={rowHi}
                      className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setListHighlight(index)}
                      onClick={() => selectPartyRow(row)}
                    >
                      <span className="account-search-code">{highlightMatch(code, partySearch)}</span>
                      <span className="account-search-name" title={row.NAME ?? row.name}>
                        {highlightMatch(row.NAME ?? row.name, partySearch)}
                      </span>
                      <span className="account-search-city" title={row.CITY ?? row.city ?? ''}>
                        {row.CITY ?? row.city ?? '—'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : !selectedParty ? (
            <p className="sale-bill-section__hint dc-party-search-hint">
              Optional: {SEARCH_TYPE_HINT} Leave blank to include all C/S accounts.
            </p>
          ) : null}
        </div>

        <div className="form-group">
          <label htmlFor="bo-schedule">Schedule no. (column order — optional)</label>
          <input
            id="bo-schedule"
            name="broker-os-schedule"
            type="text"
            inputMode="decimal"
            className="form-input"
            style={{ maxWidth: '10rem' }}
            value={brokerOsSchedule}
            onChange={(e) => setBrokerOsSchedule(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 11.10"
          />
          <p className="form-hint" style={{ marginTop: '0.35rem' }}>
            Leave blank or any value except <strong>11.10</strong>: <strong>Dr</strong> then <strong>Cr</strong>. Enter{' '}
            <strong>11.10</strong> for creditors style: <strong>Cr</strong> then <strong>Dr</strong>.
          </p>
        </div>

        <div className="form-group">
          <span className="form-label-block">Include bills</span>
          <div className="radio-row">
            <label className="radio-inline">
              <input type="radio" name="mco-bo" value="A" checked={mco === 'A'} onChange={() => setMco('A')} />
              All (A)
            </label>
            <label className="radio-inline">
              <input type="radio" name="mco-bo" value="O" checked={mco === 'O'} onChange={() => setMco('O')} />
              Outstanding only (O) — FINAL_BAL ≠ 0
            </label>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="bo-min-ignore">Minimum amount to ignore (optional)</label>
          <input
            id="bo-min-ignore"
            name="broker-os-min-ignore"
            type="text"
            inputMode="decimal"
            className="form-input"
            style={{ maxWidth: '12rem' }}
            value={brokerOsMinIgnore}
            onChange={(e) => setBrokerOsMinIgnore(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. 100"
          />
          <p className="form-hint" style={{ marginTop: '0.35rem' }}>
            Bills whose <strong>final balance</strong> (closing total for the bill — same as the <strong>Final bal</strong>{' '}
            column) has absolute value <strong>strictly below</strong> this amount are omitted from the on-screen list, PDF,
            and Excel. Leave blank for no extra filter.
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="bo-start">Starting date (bill date range)</label>
          <input
            id="bo-start"
            ref={dateStartRef}
            type="date"
            lang="en-GB"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="bo-end">Ending date</label>
          <input id="bo-end" type="date" lang="en-GB" className="form-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div className="form-group">
          <label htmlFor="bo-pedt">Payment ending date (credits after this date → 0 in report)</label>
          <input
            id="bo-pedt"
            type="date"
            lang="en-GB"
            className="form-input"
            value={payEndDate}
            onChange={(e) => setPayEndDate(e.target.value)}
          />
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
