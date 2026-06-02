import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, getCurBal, formatCurBal } from '../utils/dateFormat';
import SessionInfoLine from '../components/SessionInfoLine';
import { filterCodeNameCityRows, SEARCH_NO_MATCH, SEARCH_TYPE_HINT } from '../utils/masterSearchFilter';

const DEFAULT_HISTORY_START_DATE = '2001-04-01';

/** Party caption: name (code) · city · Tel: … (omit empty city/tel). */
function formatBillLedgerPartyCaption(row, code) {
  const name = String(row?.NAME ?? row?.name ?? '').trim();
  const c = String(code ?? '').trim();
  const city = String(row?.CITY ?? row?.city ?? '').trim();
  const tel = String(row?.TEL_NO_O ?? row?.tel_no_o ?? '').trim();
  const head = c ? `${name || 'Party'} (${c})` : name || 'Party';
  const bits = [head];
  if (city) bits.push(city);
  if (tel) bits.push(`Tel: ${tel}`);
  return bits.join(' · ');
}

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

export default function Slide6({ apiBase, onPrev, onReset, formData }) {
  const [parties, setParties] = useState([]);
  const [selectedCode, setSelectedCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [mco, setMco] = useState('A');
  const [billStart, setBillStart] = useState('');
  const [billEnd, setBillEnd] = useState('');
  const [payEndDate, setPayEndDate] = useState('');
  const [requireInterest, setRequireInterest] = useState('N');
  const [interestAsOf, setInterestAsOf] = useState('');
  const [intGsDays, setIntGsDays] = useState('0');
  const [intGedDays, setIntGedDays] = useState('30');
  const [intGroupCd, setIntGroupCd] = useState('0');
  const [intBombayDhara, setIntBombayDhara] = useState('0');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const partySearchInputRef = useRef(null);
  const billStartInputRef = useRef(null);
  const customerLedgerDrillRanRef = useRef(null);
  const [listHighlight, setListHighlight] = useState(0);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';
  const isSupplierLedger = String(formData.reportType || '').toLowerCase() === 'supplier-ledger';
  const ledgerKind = isSupplierLedger ? 'supplier' : 'customer';
  const ledgerTitle = isSupplierLedger ? 'SupplierLedger' : 'CustomerLedger';
  const showPartyBal = !isSupplierLedger;
  const openedFromOverdue =
    formData.customerLedgerDrilldown?.returnReport === 'overdue-customers' ||
    formData.customerLedgerDrilldown?.returnSlide === 34;

  const handleReportBack = () => {
    if (openedFromOverdue) {
      onPrev?.();
      return;
    }
    setShowReport(false);
  };

  useEffect(() => {
    if (!compCode) return;
    const today = toInputDateString(new Date());
    setBillStart(DEFAULT_HISTORY_START_DATE);
    setBillEnd(today);
    setPayEndDate(today);
    setInterestAsOf(today);
  }, [
    compCode,
    compUid,
    formData.comp_s_dt,
    formData.comp_e_dt,
    formData.COMP_S_DT,
    formData.COMP_E_DT,
  ]);

  useEffect(() => {
    const load = async () => {
      if (!compCode || !compUid) return;
      try {
        const { data } = await axios.get(`${apiBase}/api/bill-ledger-parties`, {
          params: { comp_code: compCode, comp_uid: compUid, ledger_kind: ledgerKind },
        });
        setParties(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(`${ledgerTitle} parties:`, err);
      }
    };
    load();
  }, [apiBase, compCode, compUid, ledgerKind, ledgerTitle]);

  useEffect(() => {
    const loadInterestDefaults = async () => {
      if (!compCode || !compUid) return;
      try {
        const { data } = await axios.get(`${apiBase}/api/bill-ledger-defaults`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
        });
        const gs = data?.g_days;
        const ged = data?.g_edays;
        if (gs != null && String(gs).trim() !== '') setIntGsDays(String(gs).trim());
        if (ged != null && String(ged).trim() !== '') setIntGedDays(String(ged).trim());
      } catch (err) {
        console.error('Bill ledger defaults:', err);
      }
    };
    loadInterestDefaults();
  }, [apiBase, compCode, compUid]);

  const filteredParties = useMemo(
    () => filterCodeNameCityRows(parties, partySearch, 50),
    [parties, partySearch]
  );

  useEffect(() => {
    setListHighlight(0);
  }, [partySearch]);

  const accountListMaxIdx = Math.max(0, filteredParties.length - 1);
  const safeHighlight = Math.min(listHighlight, accountListMaxIdx);

  const focusBillStart = () => {
    setTimeout(() => {
      const el = billStartInputRef.current;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  const selectParty = (row) => {
    setSelectedCode(String(row.CODE ?? row.code ?? '').trim());
    setPartySearch('');
    focusBillStart();
  };

  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code) === String(selectedCode));

  const runBillLedgerQuery = async (overrides = {}) => {
    const code = overrides.code !== undefined ? String(overrides.code || '').trim() : selectedCode;
    if (!code) {
      alert('Please select a party (search and pick from the list).');
      return false;
    }
    const bs = overrides.billStart ?? billStart;
    const be = overrides.billEnd ?? billEnd;
    const ped = overrides.payEndDate ?? payEndDate;
    const filterMco = overrides.mco ?? mco;
    if (!bs || !be || !ped) {
      alert('Please set bill date range and payment ending date.');
      return false;
    }
    const params = {
      comp_code: compCode,
      code,
      s_date: toOracleDate(bs),
      e_date: toOracleDate(be),
      p_edt: toOracleDate(ped),
      mco: filterMco,
      comp_uid: compUid,
      ledger_kind: ledgerKind,
    };
    if (requireInterest === 'Y') {
      const asOf = overrides.interestAsOf ?? interestAsOf ?? ped;
      if (!asOf) {
        alert('Interest as-of date is required when interest is Yes.');
        return false;
      }
      params.include_interest = 'Y';
      params.int_indt = toOracleDate(asOf);
      params.gs_days = intGsDays.trim() || '0';
      params.ged_days = intGedDays.trim() || '30';
      params.group_cd = intGroupCd.trim() || '0';
      params.bombay_dhara = intBombayDhara.trim() || '0';
    } else {
      params.include_interest = 'N';
    }

    const { data } = await axios.get(`${apiBase}/api/bill-ledger`, {
      params,
      withCredentials: true,
      timeout: 120000,
    });
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      alert(
        `No rows returned from BILLS for this party and dates for ${ledgerTitle}.\n\n` +
          `This report reads BILLS bill-wise (${isSupplierLedger ? 'supplier mode: CR - DR' : 'customer mode: DR - CR'}). ` +
          'If vouchers exist only in LEDGER, widen dates or check expected rows in BILLS.'
      );
      return false;
    }
    setReportData(rows);
    setShowReport(true);
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await runBillLedgerQuery();
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const d = formData.customerLedgerDrilldown;
    if (!d?.autoRun || !d.code || isSupplierLedger) return;
    const runKey = String(d.at ?? `${d.code}-${d.asOfDate || ''}`);
    if (customerLedgerDrillRanRef.current === runKey) return;
    customerLedgerDrillRanRef.current = runKey;

    const code = String(d.code).trim();
    const asOf = d.asOfDate ? toInputDateString(d.asOfDate) : toInputDateString(new Date());
    setSelectedCode(code);
    setPartySearch('');
    setMco('O');
    setBillStart(DEFAULT_HISTORY_START_DATE);
    if (asOf) {
      setBillEnd(asOf);
      setPayEndDate(asOf);
      setInterestAsOf(asOf);
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!cancelled) {
          await runBillLedgerQuery({
            code,
            billStart: DEFAULT_HISTORY_START_DATE,
            billEnd: asOf,
            payEndDate: asOf,
            mco: 'O',
            interestAsOf: asOf,
          });
        }
      } catch (error) {
        if (!cancelled) alert('Error: ' + (error.response?.data?.error || error.message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [formData.customerLedgerDrilldown, isSupplierLedger]);

  const pdfMeta = {
    companyName: compName,
    year: compYear,
    partyName: selectedPartyRow?.NAME ?? selectedPartyRow?.name ?? '',
    partyCode: String(selectedCode),
    partyCity: selectedPartyRow?.CITY ?? selectedPartyRow?.city ?? '',
    partyTel: selectedPartyRow?.TEL_NO_O ?? selectedPartyRow?.tel_no_o ?? '',
    endDate: `${toDisplayDate(billStart)} – ${toDisplayDate(billEnd)}`,
    payEndDate: toDisplayDate(payEndDate),
    filterLabel: mco === 'O' ? 'Outstanding bills only' : 'All bills',
    billLedgerInterest: requireInterest === 'Y',
    interestAsOfLabel:
      requireInterest === 'Y' ? toDisplayDate(interestAsOf || payEndDate) : '',
    billLedgerTitle: ledgerTitle,
    billLedgerKind: ledgerKind,
  };

  const downloadPDF = () =>
    generatePDF('bill-ledger', reportData, pdfMeta);

  const shareWhatsApp = () => {
    const shareText = [
      `${ledgerTitle} — ${compName}`,
      `${compYear} | ${formatBillLedgerPartyCaption(selectedPartyRow, selectedCode)}`,
      `Bills: ${toDisplayDate(billStart)} – ${toDisplayDate(billEnd)} | Pay to: ${toDisplayDate(payEndDate)}`,
      mco === 'O' ? 'Filter: Outstanding' : 'Filter: All',
    ].join('\n');
    return sharePdfWithWhatsApp('bill-ledger', reportData, pdfMeta, shareText);
  };

  if (showReport && reportData.length > 0) {
    return (
      <div className="slide slide-report">
        <SessionInfoLine formData={formData} helpReportId="customer-ledger" />
        <div className="report-toolbar">
          <h2>{ledgerTitle}</h2>
          <div className="toolbar-actions">
            
            <button type="button" className="btn btn-toolbar-back" onClick={handleReportBack}>
              {openedFromOverdue ? '← Back to overdue' : '← Back'}
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
                  downloadExcelRows(reportData, ledgerTitle, `${compName}_${ledgerTitle}_${selectedCode}`);
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

        <div className="report-info">
          <p>
            <strong>{compName || 'Company'}</strong>
            {compYear ? <> | FY {compYear}</> : null}
          </p>
          <p>
            {formatBillLedgerPartyCaption(selectedPartyRow, selectedCode)}
            <br />
            Bills {toDisplayDate(billStart)} – {toDisplayDate(billEnd)} · Payment cut-off {toDisplayDate(payEndDate)}
            <br />
            {mco === 'O' ? 'Outstanding only' : 'All bills'} · {isSupplierLedger ? 'Balance formula: CR - DR' : 'Balance formula: DR - CR'}
            {requireInterest === 'Y' ? (
              <>
                <br />
                Interest ({isSupplierLedger ? 'GETINT_SUP' : 'GETINT'}) as of {toDisplayDate(interestAsOf || payEndDate)} · grace {intGsDays}/{intGedDays}{' '}
                days · group_cd {intGroupCd} · bombay_dhara {intBombayDhara}
              </>
            ) : null}
          </p>
        </div>

        <div className="report-display">
          <ReportTable
            data={reportData}
            type="bill-ledger"
            billLedgerInterest={requireInterest === 'Y'}
            billLedgerKind={ledgerKind}
            meta={{
              billLedgerCompanyName: compName,
              billLedgerPartyCode: selectedCode,
              billLedgerPartyName: selectedPartyRow?.NAME ?? selectedPartyRow?.name ?? '',
              billLedgerPartyCity: selectedPartyRow?.CITY ?? selectedPartyRow?.city ?? '',
              billLedgerPartyTel: selectedPartyRow?.TEL_NO_O ?? selectedPartyRow?.tel_no_o ?? '',
            }}
          />
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
    <div className="slide slide-6">
      <h2>{ledgerTitle} — parameters</h2>

      <SessionInfoLine formData={formData} helpReportId="customer-ledger">
        <br />
        <span className="compdet-date-hint">
          {isSupplierLedger
            ? 'Search supplier (schedule 11.10). Bill dates and payment ending date match your legacy prompts.'
            : 'Search customer (schedule 8-9). Bill dates and payment ending date match your legacy prompts.'}
        </span>
      </SessionInfoLine>

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" onClick={onPrev} className="btn btn-secondary">
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="party-search">{isSupplierLedger ? 'Search supplier' : 'Search customer'}</label>
          <input
            id="party-search"
            ref={partySearchInputRef}
            type="search"
            autoComplete="off"
            placeholder="Code, name, or city… (↑↓ Enter)"
            value={partySearch}
            onChange={(e) => setPartySearch(e.target.value)}
            onKeyDown={(e) => {
              if (selectedCode) return;
              const max = Math.max(0, filteredParties.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredParties.length === 0) return;
                setListHighlight((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setListHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const row = filteredParties[safeHighlight];
                if (row) {
                  e.preventDefault();
                  selectParty(row);
                }
              }
            }}
            className="form-input"
          />
          {selectedCode ? (
            <p className="account-selected-hint">
              Selected: <strong>{selectedPartyRow?.NAME ?? '—'}</strong> (<code>{selectedCode}</code>)
              {showPartyBal ? (
                <>
                  {' · '}
                  Bal {formatCurBal(getCurBal(selectedPartyRow) ?? 0)}
                </>
              ) : null}
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedCode('');
                  setPartySearch('');
                  setListHighlight(0);
                  setTimeout(() => partySearchInputRef.current?.focus(), 0);
                }}
              >
                Clear
              </button>
            </p>
          ) : null}
          {!selectedCode && partySearch.trim() ? (
            <div className="account-search-results party-search-results" role="listbox" aria-label="Matching parties">
              <div className={`account-search-header party-search-header${showPartyBal ? ' party-search-header--with-bal' : ''}`} aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
                {showPartyBal ? <span className="account-search-bal-h">Bal</span> : null}
              </div>
              {filteredParties.length === 0 ? (
                <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
              ) : (
                filteredParties.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const balRaw = getCurBal(row);
                  const bal = balRaw ?? 0;
                  const n = Number(bal);
                  const dc = !Number.isNaN(n) ? (n < 0 ? 'Cr' : 'Dr') : '';
                  const rowHi = safeHighlight === index;
                  return (
                    <button
                      key={String(code)}
                      type="button"
                      role="option"
                      aria-selected={rowHi}
                      className={`account-search-row party-search-row${showPartyBal ? ' party-search-row--with-bal' : ''}${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setListHighlight(index)}
                      onClick={() => selectParty(row)}
                    >
                      <span className="account-search-code">{highlightMatch(code, partySearch)}</span>
                      <span className="account-search-name" title={row.NAME ?? row.name}>
                        {highlightMatch(row.NAME ?? row.name, partySearch)}
                      </span>
                      <span className="account-search-city" title={row.CITY ?? row.city ?? ''}>
                        {row.CITY ?? row.city ?? '—'}
                      </span>
                      {showPartyBal ? (
                        <span className={`account-search-bal ${dc === 'Cr' ? 'is-cr' : dc === 'Dr' ? 'is-dr' : ''}`}>
                          {formatCurBal(bal)}
                          {dc ? <span className="account-search-bal-dc">{dc}</span> : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          ) : !selectedCode ? (
            <p className="sale-bill-section__hint dc-party-search-hint">{SEARCH_TYPE_HINT}</p>
          ) : null}
        </div>

        <div className="form-group">
          <span className="form-label-block">Transactions</span>
          <div className="radio-row">
            <label className="radio-inline">
              <input type="radio" name="mco" value="A" checked={mco === 'A'} onChange={() => setMco('A')} />
              All (A)
            </label>
            <label className="radio-inline">
              <input type="radio" name="mco" value="O" checked={mco === 'O'} onChange={() => setMco('O')} />
              Outstanding only (O)
            </label>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="bill-start">Bill start date (DD-MM-YYYY via calendar)</label>
          <input
            id="bill-start"
            ref={billStartInputRef}
            type="date"
            lang="en-GB"
            className="form-input"
            value={billStart}
            onChange={(e) => setBillStart(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="bill-end">Bill end date</label>
          <input
            id="bill-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={billEnd}
            onChange={(e) => setBillEnd(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="pay-end">Payment ending date (voucher cut-off for CV/BV/JV)</label>
          <input
            id="pay-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={payEndDate}
            onChange={(e) => setPayEndDate(e.target.value)}
          />
        </div>

        <div className="form-group">
          <span className="form-label-block">Interest on bills (Oracle {isSupplierLedger ? 'GETINT_SUP' : 'GETINT'})</span>
          <div className="radio-row">
            <label className="radio-inline">
              <input
                type="radio"
                name="req-int"
                value="N"
                checked={requireInterest === 'N'}
                onChange={() => setRequireInterest('N')}
              />
              No (N)
            </label>
            <label className="radio-inline">
              <input
                type="radio"
                name="req-int"
                value="Y"
                checked={requireInterest === 'Y'}
                onChange={() => {
                  setRequireInterest('Y');
                  setInterestAsOf((prev) => prev || toInputDateString(new Date()));
                }}
              />
              Yes (Y) — add interest columns from GETINT
            </label>
          </div>
        </div>

        {requireInterest === 'Y' ? (
          <>
            <div className="form-group">
              <label htmlFor="int-asof">Interest as-of date (INDT / same DD-MM-YYYY as other dates)</label>
              <input
                id="int-asof"
                type="date"
                lang="en-GB"
                className="form-input"
                value={interestAsOf || toInputDateString(new Date())}
                onChange={(e) => setInterestAsOf(e.target.value)}
              />
            </div>
            <div className="form-row-broker">
              <div className="form-group">
                <label htmlFor="int-gs">G_GSDAYS</label>
                <input
                  id="int-gs"
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  value={intGsDays}
                  onChange={(e) => setIntGsDays(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="form-group">
                <label htmlFor="int-ged">G_GEDAYS</label>
                <input
                  id="int-ged"
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  value={intGedDays}
                  onChange={(e) => setIntGedDays(e.target.value)}
                  placeholder="30"
                />
              </div>
            </div>
            <div className="form-row-broker">
              <div className="form-group">
                <label htmlFor="int-grp">GROUP_CD</label>
                <input
                  id="int-grp"
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  value={intGroupCd}
                  onChange={(e) => setIntGroupCd(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="form-group">
                <label htmlFor="int-bomb">BOMBAY_DHARA</label>
                <input
                  id="int-bomb"
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  value={intBombayDhara}
                  onChange={(e) => setIntBombayDhara(e.target.value)}
                  placeholder="0 or 365"
                />
              </div>
            </div>
          </>
        ) : null}

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
