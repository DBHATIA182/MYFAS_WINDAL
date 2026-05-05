import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';

/** Maps Oracle SALE.TYPE (1–9) to print/API letter bucket (same as sale list / Slide8). */
const SALE_LIST_NUMTYPE_TO_PRINT = {
  1: 'SL',
  2: 'CH',
  3: 'SL',
  4: 'SL',
  5: 'SL',
  6: 'SE',
  7: 'SL',
  8: 'CN',
  9: 'RC',
};

const SALE_BILL_PRINT_PTYPE_OPTIONS = [
  { value: '', label: 'Mixed — TYPE 1–9' },
  { value: '1', label: '1 — Retail invoice' },
  { value: '2', label: '2 — Consignment challan' },
  { value: '3', label: '3 — Tax invoice' },
  { value: '4', label: '4 — Goods return' },
  { value: '5', label: '5 — Goods return consignment' },
  { value: '6', label: '6 — Tax invoice others' },
  { value: '7', label: '7 — Debit note' },
  { value: '8', label: '8 — Credit note' },
  { value: '9', label: '9 — Reverse charge invoice' },
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

export default function Slide13({ apiBase, formData, onPrev, onReset }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [billNoStart, setBillNoStart] = useState('');
  const [billNoEnd, setBillNoEnd] = useState('');
  const [salePtype, setSalePtype] = useState('');
  const [pageType, setPageType] = useState('1');
  const [copyNo, setCopyNo] = useState('0');
  const [bType, setBType] = useState('');
  const [revchg, setRevchg] = useState('');
  const [printGrossDane, setPrintGrossDane] = useState('N');
  const [printPacking, setPrintPacking] = useState('N');

  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [lookupError, setLookupError] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [brokerSearch, setBrokerSearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [brokerHi, setBrokerHi] = useState(0);
  const [selectedMcode, setSelectedMcode] = useState('');
  const [selectedBk, setSelectedBk] = useState('');

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [showReport, setShowReport] = useState(false);

  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

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
    const load = async () => {
      if (!compCode || !compUid) return;
      setLookupError('');
      try {
        const params = { comp_code: compCode, comp_uid: compUid };
        const [pr, br] = await Promise.all([
          axios.get(`${apiBase}/api/salelist-parties`, { params, withCredentials: true, timeout: 120000 }),
          axios.get(`${apiBase}/api/salelist-brokers`, { params, withCredentials: true, timeout: 120000 }),
        ]);
        setParties(Array.isArray(pr.data) ? pr.data : []);
        setBrokers(Array.isArray(br.data) ? br.data : []);
      } catch (err) {
        console.error('Sale bill printing lookups:', err);
        const st = err.response?.status;
        setLookupError(
          st === 404
            ? `Parties/brokers routes missing on ${formatApiOrigin(apiBase)}. Run latest server.cjs.`
            : err.response?.data?.error || err.message || 'Request failed'
        );
      }
    };
    load();
  }, [apiBase, compCode, compUid]);

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    if (!q) return parties.slice(0, 150);
    return parties.filter((p) => {
      const code = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return code.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [parties, partySearch]);

  const filteredBrokers = useMemo(() => {
    const q = brokerSearch.trim().toLowerCase();
    if (!q) return brokers.slice(0, 150);
    return brokers.filter((p) => {
      const code = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return code.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [brokers, brokerSearch]);

  useEffect(() => {
    setPartyHi(0);
  }, [partySearch]);
  useEffect(() => {
    setBrokerHi(0);
  }, [brokerSearch]);

  const safePartyHi = Math.min(partyHi, Math.max(0, filteredParties.length - 1));
  const safeBrokerHi = Math.min(brokerHi, Math.max(0, filteredBrokers.length - 1));
  const selectedPartyRow = parties.find((p) => String(p.CODE ?? p.code ?? '') === String(selectedMcode));
  const selectedBrokerRow = brokers.find((b) => String(b.CODE ?? b.code ?? '') === String(selectedBk));

  const printTypeForOracleNum = (num) => {
    if (!Number.isFinite(num)) return 'SL';
    return SALE_LIST_NUMTYPE_TO_PRINT[num] || 'SL';
  };

  const openSaleBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const billNoFromRow = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bTypeFromRow = row.B_TYPE ?? row.b_type ?? '';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (typ == null || typ === '' || billNoFromRow == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    const ptypeNum = typeof typ === 'number' ? typ : parseInt(String(typ ?? '').trim(), 10);
    const printType = Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9 ? printTypeForOracleNum(ptypeNum) : String(typ).trim();

    setBillPrintParams({
      type: printType,
      ...(Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9 ? { oracleTypeNum: ptypeNum } : {}),
      billNo: String(billNoFromRow).trim(),
      bType: String(bTypeFromRow).trim(),
      oracleDt,
      compYear: String(compYear ?? '').trim(),
      printGrossDane: printGrossDane,
      printPacking: printPacking,
      pageType,
      copyNo,
      revchg: revchg || undefined,
      label: `Sale bill — ${typ} / ${billNoFromRow} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert('Please set starting date and ending date.');
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
      if (salePtype.trim()) params.ptype = salePtype.trim();
      if (billNoStart.trim()) params.sb_no = billNoStart.trim();
      if (billNoEnd.trim()) params.eb_no = billNoEnd.trim();
      if (bType.trim()) params.b_type = bType.trim();
      if (selectedMcode.trim()) params.mcode = selectedMcode.trim();
      if (selectedBk.trim()) params.b_code = selectedBk.trim();
      if (revchg === 'Y' || revchg === 'N') params.revchg = revchg;

      const { data } = await axios.get(`${apiBase}/api/sale-bill-printing-list`, {
        params,
        withCredentials: true,
        timeout: 120000,
      });
      const list = Array.isArray(data) ? data : [];
      if (list.length === 0) {
        alert('No matching sale bills found. Widen dates or clear bill range / party / broker filters.');
        return;
      }
      setRows(list);
      setShowReport(true);
    } catch (error) {
      const msg = error.response?.data?.error || error.message || 'Request failed';
      alert('Error: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  if (showReport && rows.length > 0) {
    return (
      <div className="slide slide-report slide-13-report">
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
        <div className="report-toolbar">
          <h2>Sale Bill Printing</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>Dates</strong> {toDisplayDate(startDate)} – {toDisplayDate(endDate)}
            {billNoStart.trim() || billNoEnd.trim() ? (
              <>
                {' · '}
                <strong>Bill no</strong> {billNoStart.trim() || '—'} – {billNoEnd.trim() || '—'}
              </>
            ) : null}
            {' · '}
            <strong>SALETYPE</strong>{' '}
            {SALE_BILL_PRINT_PTYPE_OPTIONS.find((o) => o.value === salePtype)?.label ?? 'Mixed'}
            {' · '}
            <strong>PAGETYPE</strong> {pageType}
            {' · '}
            <strong>COPY NO</strong> {copyNo}
            {bType.trim() ? (
              <>
                {' · '}
                <strong>B type</strong> {bType.trim()}
              </>
            ) : null}
            {revchg ? (
              <>
                {' · '}
                <strong>REVCHG</strong> {revchg}
              </>
            ) : null}
            {' · '}
            <strong>Gross/Dane</strong> {printGrossDane} · <strong>Packing</strong> {printPacking}
          </p>
          <p>
            {compName} | FY {compYear}
            <br />
            Click a row to open the printable sale bill. (PAGETYPE / COPY NO apply to the Fox-style print stack; values are passed for future PDF parity.)
          </p>
        </div>

        <div className="report-display">
          <div className="table-responsive table-responsive--bill-ledger">
            <table className="report-table report-table--bill-ledger report-table--sale-print-list">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Bill date</th>
                  <th>Bill no</th>
                  <th>B type</th>
                  <th>Code</th>
                  <th>Name</th>
                  <th>City</th>
                  <th className="text-right">Total tax</th>
                  <th className="text-right">Bill amt</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <tr
                    key={idx}
                    className="clickable-row"
                    onClick={() => openSaleBill(row)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        openSaleBill(row);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td>{row.TYPE ?? row.type ?? '—'}</td>
                    <td>{toDisplayDate(toInputDateString(row.BILL_DATE ?? row.bill_date))}</td>
                    <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                    <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                    <td>{row.CODE ?? row.code ?? '—'}</td>
                    <td>{row.NAME ?? row.name ?? '—'}</td>
                    <td>{row.CITY ?? row.city ?? '—'}</td>
                    <td className="text-right">
                      {(parseFloat(row.TOTAL_TAX ?? row.total_tax ?? 0) || 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="text-right">
                      {(parseFloat(row.BILL_AMT ?? row.bill_amt ?? 0) || 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    <div className="slide slide-13">
      <h2>Sale Bill Printing</h2>
      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          VFP-style filters: <strong>date range</strong>, <strong>bill no range</strong>, <strong>SALETYPE</strong>, <strong>PAGETYPE</strong>,{' '}
          <strong>COPY NO</strong>, <strong>BTYPE</strong>, <strong>REVCHG</strong>, optional party and broker.
        </span>
      </p>

      {lookupError ? (
        <div className="form-api-error" role="alert">
          <strong>Could not load lookups.</strong> {lookupError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-sdt">Starting date</label>
            <input
              id="sbp-sdt"
              type="date"
              lang="en-GB"
              className="form-input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="sbp-edt">Ending date</label>
            <input
              id="sbp-edt"
              type="date"
              lang="en-GB"
              className="form-input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-sbno">Starting bill no</label>
            <input
              id="sbp-sbno"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={billNoStart}
              onChange={(e) => setBillNoStart(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="form-group">
            <label htmlFor="sbp-ebno">Ending bill no</label>
            <input
              id="sbp-ebno"
              type="text"
              inputMode="numeric"
              className="form-input"
              value={billNoEnd}
              onChange={(e) => setBillNoEnd(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-saletype">SALETYPE</label>
            <select id="sbp-saletype" value={salePtype} onChange={(e) => setSalePtype(e.target.value)}>
              {SALE_BILL_PRINT_PTYPE_OPTIONS.map((o) => (
                <option key={o.value || 'mix'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sbp-pagetype">PAGETYPE</label>
            <select id="sbp-pagetype" value={pageType} onChange={(e) => setPageType(e.target.value)} title="Fox: 1 = standard, 2 = line padding">
              <option value="1">1 — Standard page</option>
              <option value="2">2 — Line padding (Fox PAGETYPE 2)</option>
            </select>
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-copyno">COPY NO</label>
            <select id="sbp-copyno" value={copyNo} onChange={(e) => setCopyNo(e.target.value)} title="Fox: 0 = original+duplicate+triplicate">
              <option value="0">0 — All copies (Original + Duplicate + Triplicate)</option>
              <option value="1">1 — Original for buyer</option>
              <option value="2">2 — Duplicate</option>
              <option value="3">3 — Triplicate</option>
              <option value="4">4 — Quadruplicate</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sbp-b-type">BTYPE</label>
            <input
              id="sbp-b-type"
              type="text"
              className="form-input"
              value={bType}
              onChange={(e) => setBType(e.target.value)}
              placeholder="Optional bill branch / godown type"
            />
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-revchg">REVCHG</label>
            <select id="sbp-revchg" value={revchg} onChange={(e) => setRevchg(e.target.value)} title="Y = only TYPE 9; N = exclude TYPE 9">
              <option value="">— All (no filter)</option>
              <option value="Y">Y — Reverse charge only (TYPE 9)</option>
              <option value="N">N — Exclude reverse charge</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="sbp-print-gross-dane">Print Gross Weight &amp; Dane Weight</label>
            <select id="sbp-print-gross-dane" value={printGrossDane} onChange={(e) => setPrintGrossDane(e.target.value)}>
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </div>
        </div>

        <div className="form-row-broker">
          <div className="form-group">
            <label htmlFor="sbp-print-packing">Print Packing</label>
            <select id="sbp-print-packing" value={printPacking} onChange={(e) => setPrintPacking(e.target.value)}>
              <option value="N">No</option>
              <option value="Y">Yes</option>
            </select>
          </div>
          <div className="form-group" aria-hidden="true" />
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="sbp-party-search">Specific party (optional)</label>
          <input
            id="sbp-party-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search code, name, city…"
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
          ) : (
            <div className="account-search-results party-search-results" role="listbox">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>CODE</span>
                <span>NAME</span>
                <span>CITY</span>
              </div>
              {filteredParties.length === 0 ? (
                <div className="account-search-empty">
                  {partySearch.trim() ? 'No matches found.' : 'Type to search or leave empty for all parties.'}
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
          )}
        </div>

        <div className="form-group account-search-group">
          <label htmlFor="sbp-broker-search">Specific broker (optional)</label>
          <input
            id="sbp-broker-search"
            type="search"
            className="form-input"
            autoComplete="off"
            placeholder="Search broker code, name, city…"
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
              Broker: <strong>{selectedBrokerRow?.NAME ?? '—'}</strong> (<code>{selectedBk}</code>)
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
          ) : (
            <div className="account-search-results party-search-results" role="listbox">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>CODE</span>
                <span>NAME</span>
                <span>CITY</span>
              </div>
              {filteredBrokers.length === 0 ? (
                <div className="account-search-empty">
                  {brokerSearch.trim() ? 'No matches found.' : 'Type to search or leave empty for all brokers.'}
                </div>
              ) : (
                filteredBrokers.map((row, index) => {
                  const code = row.CODE ?? row.code;
                  const rowHi = safeBrokerHi === index;
                  return (
                    <button
                      key={`b-${code}`}
                      type="button"
                      role="option"
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
          )}
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '⏳ Loading…' : '📄 Show Bills'}
          </button>
        </div>
      </form>
    </div>
  );
}
