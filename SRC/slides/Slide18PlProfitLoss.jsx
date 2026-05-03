import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { downloadExcelWorkbook, downloadExcelRows } from '../utils/excelExport';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import LedgerReportHeader from '../components/LedgerReportHeader';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { formatLedgerVoucherApiError } from '../utils/apiLabel';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtAmount(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSchedule(v) {
  const n = num(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function AmtCell({ value }) {
  if (!num(value)) return <td className="pl-pl-amt pl-amt"> </td>;
  return <td className="pl-pl-amt pl-amt text-right">{fmtAmount(value)}</td>;
}

function pairDebitCreditRows(lines) {
  const debit = [];
  const credit = [];
  (lines || []).forEach((ln) => {
    const drAmt = num(ln?.DR_AMT);
    const crAmt = num(ln?.CR_AMT);
    const drDetail = String(ln?.DR_DETAIL || '').trim();
    const crDetail = String(ln?.CR_DETAIL || '').trim();
    const code = String(ln?.CODE || '').trim();
    if (drAmt !== 0 || drDetail) debit.push({ detail: drDetail, amount: drAmt, code });
    if (crAmt !== 0 || crDetail) credit.push({ detail: crDetail, amount: crAmt, code });
  });
  const rowCount = Math.max(debit.length, credit.length);
  const out = [];
  for (let i = 0; i < rowCount; i += 1) {
    out.push({
      drDetail: debit[i]?.detail || '',
      drAmt: debit[i]?.amount || 0,
      drCode: debit[i]?.code || '',
      crDetail: credit[i]?.detail || '',
      crAmt: credit[i]?.amount || 0,
      crCode: credit[i]?.code || '',
    });
  }
  return out;
}

const SCREEN = { REPORT: 'report', LEDGER: 'ledger', VOUCHER: 'voucher' };

export default function Slide18PlProfitLoss({ apiBase, formData = {}, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const [edt, setEdt] = useState('');
  const [schedule, setSchedule] = useState('12.10');
  const [code, setCode] = useState('');
  const [mcb, setMcb] = useState('C');
  const [mwyn, setMwyn] = useState('N');
  const [catCodeYn, setCatCodeYn] = useState('N');
  const [mShortPick, setMShortPick] = useState('N');
  const [mfyn, setMfyn] = useState('A');
  const [accountOptions, setAccountOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [plData, setPlData] = useState(null);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerTitle, setLedgerTitle] = useState('');
  const [ledgerCode, setLedgerCode] = useState('');
  const [screen, setScreen] = useState(SCREEN.REPORT);
  const [selectedPlRowKey, setSelectedPlRowKey] = useState(null);
  const [voucherRows, setVoucherRows] = useState([]);
  const [voucherTitle, setVoucherTitle] = useState('');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);

  useEffect(() => {
    setSelectedPlRowKey(null);
  }, [plData]);

  useEffect(() => {
    if (!compCode || compUid == null || String(compUid).trim() === '') {
      setCompLedgerHeader(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
        });
        if (!cancelled) setCompLedgerHeader(data && typeof data === 'object' ? data : null);
      } catch {
        if (!cancelled) setCompLedgerHeader(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid]);

  const plRowClass = (baseClass, rowKey) =>
    [baseClass, 'pl-pl-row--interactive', selectedPlRowKey === rowKey ? 'pl-pl-row--selected' : '']
      .filter(Boolean)
      .join(' ');

  const normalizeSchedule = (raw) => {
    const txt = String(raw ?? '').replace(/[^\d.]/g, '');
    if (!txt) return '';
    const parts = txt.split('.');
    const intPart = (parts[0] || '').slice(0, 2);
    const decPartRaw = parts.length > 1 ? parts.slice(1).join('') : '';
    if (decPartRaw.length === 0) return intPart;
    return `${intPart}.${decPartRaw.slice(0, 2)}`;
  };

  useEffect(() => {
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (e) setEdt(e);
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  useEffect(() => {
    const scheduleNorm = normalizeSchedule(schedule);
    if (!compCode || !compUid || !/^\d{1,2}\.\d{2}$/.test(scheduleNorm)) {
      setAccountOptions([]);
      return;
    }
    let ignore = false;
    axios
      .get(`${apiBase}/api/trading-ac-accounts`, {
        params: { comp_code: compCode, comp_uid: compUid, schedule: scheduleNorm },
        withCredentials: true,
        timeout: 60000,
      })
      .then(({ data }) => {
        if (ignore) return;
        setAccountOptions(Array.isArray(data?.rows) ? data.rows : []);
      })
      .catch(() => {
        if (!ignore) setAccountOptions([]);
      });
    return () => {
      ignore = true;
    };
  }, [apiBase, compCode, compUid, schedule]);

  const fyPeriodLine = useMemo(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (!s || !e) return '';
    return `${toDisplayDate(s)} — ${toDisplayDate(e)}`;
  }, [formData.comp_s_dt, formData.COMP_S_DT, formData.comp_e_dt, formData.COMP_E_DT]);

  const runReport = async (e) => {
    e.preventDefault();
    const scheduleNorm = normalizeSchedule(schedule);
    if (!/^\d{1,2}\.\d{2}$/.test(scheduleNorm)) {
      alert('Trading schedule must be in 99.99 format (e.g. 12.10).');
      return;
    }
    const edtOracle = toOracleDate(edt);
    if (!edtOracle) {
      alert('Please select as-on date.');
      return;
    }
    setLoading(true);
    setError('');
    setPlData(null);
    try {
      const { data: tData } = await axios.get(`${apiBase}/api/trading-ac`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          schedule: scheduleNorm,
          code,
          edt: edtOracle,
          mcb,
          mwyn,
          cat_code_yn: catCodeYn,
          m_short_pick: mShortPick,
          mfyn,
          manual_confirmed: 'Y',
        },
        withCredentials: true,
        timeout: 180000,
      });
      if (tData?.requiresManualEntry) {
        alert('Closing stock must be entered in Trading A/C (manual mode) before running P&L. Open Trading A/C, confirm amounts, then try again.');
        return;
      }
      const tRows = Array.isArray(tData?.rows) ? tData.rows : [];
      const stockRows = tRows.filter((r) => String(r?.CODE ?? '').trim() !== '000000');
      const sumGprofit = stockRows.reduce((s, r) => s + num(r?.GPROFIT), 0);
      const sumGloss = stockRows.reduce((s, r) => s + num(r?.GLOSS), 0);

      const { data: pData } = await axios.get(`${apiBase}/api/pl-profit-loss`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          edt: edtOracle,
          sum_gprofit: String(sumGprofit),
          sum_gloss: String(sumGloss),
        },
        withCredentials: true,
        timeout: 120000,
      });
      setPlData(pData);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run P&L');
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    if (!plData?.accounts) return;
    const trading = plData.trading || {};
    const head = [
      {
        SCHEDULE: trading.SCHEDULE,
        SCH_NAME: trading.SCH_NAME,
        CODE: '',
        NAME: '',
        DR_DETAIL: trading.DR_DETAIL,
        CR_DETAIL: trading.CR_DETAIL,
        DR_AMT: trading.DR_AMT,
        CR_AMT: trading.CR_AMT,
      },
      ...plData.accounts.map((r) => ({
        SCHEDULE: r.SCHEDULE,
        SCH_NAME: r.SCH_NAME,
        CODE: r.CODE,
        NAME: r.NAME,
        DR_DETAIL: r.DR_DETAIL,
        CR_DETAIL: r.CR_DETAIL,
        DR_AMT: r.DR_AMT,
        CR_AMT: r.CR_AMT,
      })),
    ];
    downloadExcelWorkbook([{ name: 'PL', data: head }], `${compName}_PL_${compYear}`, { autoOpen: true });
  };

  const downloadPdf = () => {
    if (!plData?.ok) return Promise.resolve();
    return generatePDF('profit-loss', plData, {
      companyName: compName,
      year: compYear,
      period: `As on ${toDisplayDate(edt)}`,
      reportTitle: `Profit & Loss Account As At ${toDisplayDate(edt)}`,
    });
  };

  const shareOnWhatsApp = () => {
    if (!plData?.ok) return Promise.resolve();
    return sharePdfWithWhatsApp(
      'profit-loss',
      plData,
      {
        companyName: compName,
        year: compYear,
        period: `As on ${toDisplayDate(edt)}`,
        reportTitle: `Profit & Loss Account As At ${toDisplayDate(edt)}`,
      },
      [compName, 'Profit & Loss Account', `As on ${toDisplayDate(edt)}`, `FY ${compYear}`].filter(Boolean).join('\n')
    );
  };

  const openAccountLedger = async (accountCode, accountName) => {
    const codeTrim = String(accountCode || '').trim();
    if (!codeTrim) return;
    const sYmd = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const eYmd = toInputDateString(edt);
    if (!sYmd || !eYmd) {
      alert('Financial year start or ending date is missing.');
      return;
    }
    const sDate = toOracleDate(sYmd);
    const eDate = toOracleDate(eYmd);
    if (!sDate || !eDate) {
      alert('Invalid ledger date range.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/ledger`, {
        params: {
          comp_code: compCode,
          code: codeTrim,
          s_date: sDate,
          e_date: eDate,
          comp_uid: compUid,
          voucher_wise_total: 'N',
        },
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        alert('No ledger transactions found for selected account.');
        return;
      }
      setLedgerRows(rows);
      setLedgerCode(codeTrim);
      setLedgerTitle(String(accountName || '').trim() || codeTrim);
      setScreen(SCREEN.LEDGER);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };

  const ledgerPeriodStart = toDisplayDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const ledgerPeriodEnd = toDisplayDate(edt);

  /** SALE.TYPE=LEDGER.VR_TYPE, SALE.BILL_NO=LEDGER.VR_NO, … */
  const openLedgerSaleBill = (row) => {
    const vrType = row.VR_TYPE ?? row.vr_type;
    const ledgerLineType = row.TYPE ?? row.type;
    const billNo = row.VR_NO ?? row.vr_no;
    const billDt = row.VR_DATE ?? row.vr_date;
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    const saleType = vrType != null && String(vrType).trim() !== '' ? String(vrType).trim() : '';
    if (!saleType) {
      alert('Cannot open sale bill: missing vr_type (maps to sale.type).');
      return;
    }
    if (billNo == null || String(billNo).trim() === '' || !oracleDt) {
      alert('Cannot open sale bill: missing vr_no or vr_Date.');
      return;
    }
    const bTypeFromLedger = ledgerLineType != null && String(ledgerLineType).trim() !== '' ? String(ledgerLineType).trim() : ' ';
    setBillPrintParams({
      type: saleType,
      billNo: String(billNo).trim(),
      bType: bTypeFromLedger,
      oracleDt,
      label: `Sale bill — sale.type=${saleType} · bill_no=${String(billNo)} · b_type=${bTypeFromLedger.trim() || ' '} · ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const runLedgerVoucher = async (row) => {
    const vrType = row.VR_TYPE ?? row.vr_type;
    const vrNo = row.VR_NO ?? row.vr_no;
    const vrDate = row.VR_DATE ?? row.vr_date;
    if (!vrType) {
      alert('Cannot open voucher: missing vr_type on this row.');
      return;
    }
    const n = Number(vrNo);
    if (!Number.isFinite(n) || n <= 0) return;
    const ymd = toInputDateString(vrDate);
    if (!ymd) {
      alert('Could not read voucher date on this line.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/ledger-voucher`, {
        params: {
          comp_code: compCode,
          vr_type: String(vrType),
          vr_date: toOracleDate(ymd),
          vr_no: n,
          comp_uid: compUid,
        },
        withCredentials: true,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert('No voucher lines found for this voucher.');
        return;
      }
      setVoucherRows(rows);
      setVoucherTitle(`${String(vrType)} ${n} · ${toDisplayDate(ymd)}`);
      setScreen(SCREEN.VOUCHER);
    } catch (err) {
      alert('Error: ' + formatLedgerVoucherApiError(err, apiBase));
    } finally {
      setLoading(false);
    }
  };

  const ledgerFirstRow = ledgerRows[0];

  if (screen === SCREEN.VOUCHER) {
    return (
      <div className="slide slide-report slide-18 pl-profit-loss">
        <div className="report-toolbar">
          <h2>Voucher entries</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen(SCREEN.LEDGER)}>
              ← Back to ledger
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(voucherRows, 'Voucher', `${compName}_Voucher_${voucherTitle.replace(/\s+/g, '_')}`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
          </div>
        </div>
        <LedgerReportHeader
          compHeader={compLedgerHeader}
          companyNameFallback={compName}
          account={ledgerFirstRow}
          accountNameFallback={ledgerTitle}
          accountCodeFallback={ledgerCode}
          periodLine={`Financial year ${compYear} · ${ledgerPeriodStart} – ${ledgerPeriodEnd}`}
        />
        <p className="ledger-report-voucher-ref">
          Voucher: <strong>{voucherTitle}</strong>
        </p>
        <p className="compdet-date-hint">All accounts posted on this voucher (LEDGER).</p>
        <div className="report-display">
          <ReportTable data={voucherRows} type="ledger-voucher" />
        </div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setScreen(SCREEN.LEDGER)}>
            ← Back to ledger
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setScreen(SCREEN.REPORT)}>
            ← Back to P&amp;L
          </button>
          {typeof onReset === 'function' ? (
            <button type="button" className="btn btn-primary" onClick={onReset}>
              🏠 Home
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (screen === SCREEN.LEDGER) {
    return (
      <div className="slide slide-report slide-18 pl-profit-loss">
        <div className="report-toolbar">
          <h2>Ledger Report</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen(SCREEN.REPORT)}>
              ← Back to P&L
            </button>
          </div>
        </div>
        <LedgerReportHeader
          compHeader={compLedgerHeader}
          companyNameFallback={compName}
          account={ledgerFirstRow}
          accountNameFallback={ledgerTitle}
          accountCodeFallback={ledgerCode}
          periodLine={`Financial year ${compYear} · ${ledgerPeriodStart} – ${ledgerPeriodEnd}`}
          hint="Tap a row for voucher detail; sale bill opens for SL / SE / CN where available."
        />
        <div className="report-display">
          <ReportTable
            data={ledgerRows}
            type="ledger"
            onVoucherClick={runLedgerVoucher}
            onLedgerSaleBillClick={openLedgerSaleBill}
          />
        </div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setScreen(SCREEN.REPORT)}>
            ← Back to P&L
          </button>
        </div>
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
      </div>
    );
  }

  if (plData?.ok) {
    const tr = plData.trading || {};
    const totals = plData.totals || {};
    const blocks = Array.isArray(plData.scheduleBlocks) ? plData.scheduleBlocks : [];

    return (
      <div className="slide slide-report slide-18 pl-profit-loss">
        <div className="report-toolbar">
          <h2>Profit &amp; Loss</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setPlData(null)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={() => downloadPdf().catch((e) => alert(e?.message || String(e)))}>
              Pdf
            </button>
            <button type="button" className="btn btn-excel" onClick={exportExcel}>
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={() => shareOnWhatsApp().catch((e) => alert(e?.message || String(e)))}>
              WhatsApp
            </button>
          </div>
        </div>

        <article className="pl-statement pl-doc" aria-label="Profit and loss statement">
          <header className="pl-doc-titleblock">
            <div className="pl-doc-company">{compName}</div>
            <h1 className="pl-doc-heading">PROFIT &amp; LOSS ACCOUNT</h1>
            <div className="pl-doc-asat">AS AT : {toDisplayDate(edt)}</div>
            {fyPeriodLine ? <div className="pl-doc-fy">Financial year {compYear} &nbsp;·&nbsp; {fyPeriodLine}</div> : (
              <div className="pl-doc-fy">Financial year {compYear}</div>
            )}
          </header>

          <div className="report-display table-responsive pl-pl-wrap">
            <table className="pl-pl-table">
              <caption className="pl-pl-caption">
                Debit and credit columns per schedule; amounts in INR.
              </caption>
              <colgroup>
                <col className="pl-col-particular pl-col-dr" />
                <col className="pl-col-amount" />
                <col className="pl-col-particular pl-col-cr" />
                <col className="pl-col-amount" />
              </colgroup>
              <thead>
                <tr className="pl-pl-thead-row">
                  <th scope="col" className="pl-pl-part">Particulars</th>
                  <th scope="col" className="pl-pl-amt">Amount</th>
                  <th scope="col" className="pl-pl-part">Particulars</th>
                  <th scope="col" className="pl-pl-amt">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  className={plRowClass('pl-pl-section-label', 'pl-section-trading')}
                  onClick={() => setSelectedPlRowKey('pl-section-trading')}
                >
                  <td colSpan={4}>Trading (schedule 12.10)</td>
                </tr>
                <tr
                  className={plRowClass('pl-pl-trading-row', 'pl-trading')}
                  onClick={() => setSelectedPlRowKey('pl-trading')}
                >
                  <td className="pl-pl-particular">{tr.DR_DETAIL || <span className="pl-empty"> </span>}</td>
                  <AmtCell value={tr.DR_AMT} />
                  <td className="pl-pl-particular">{tr.CR_DETAIL || <span className="pl-empty"> </span>}</td>
                  <AmtCell value={tr.CR_AMT} />
                </tr>
                <tr
                  className={plRowClass('pl-pl-schedule-total', 'pl-trading-schedule-total')}
                  onClick={() => setSelectedPlRowKey('pl-trading-schedule-total')}
                >
                  <td className="pl-pl-particular">SCHEDULE TOTAL</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{fmtAmount(tr.DR_AMT || 0)}</strong>
                  </td>
                  <td className="pl-pl-particular" />
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{fmtAmount(tr.CR_AMT || 0)}</strong>
                  </td>
                </tr>

                {blocks.length ? (
                  <tr
                    className={plRowClass('pl-pl-section-label', 'pl-section-sch16')}
                    onClick={() => setSelectedPlRowKey('pl-section-sch16')}
                  >
                    <td colSpan={4}>Schedule 16 onwards</td>
                  </tr>
                ) : null}

                {blocks.map((blk, bi) => (
                  <React.Fragment key={`blk_${bi}_${blk.schedule}_${blk.schName}`}>
                    <tr
                      className={plRowClass('pl-pl-sch-header', `pl-sch-hdr-${bi}`)}
                      onClick={() => setSelectedPlRowKey(`pl-sch-hdr-${bi}`)}
                    >
                      <td colSpan={4} className="pl-pl-sch-title">
                        <span className="pl-pl-sch-code">{fmtSchedule(blk.schedule)}</span>
                        <span className="pl-pl-sch-name">{blk.schName}</span>
                      </td>
                    </tr>
                    {pairDebitCreditRows(blk.lines).map((ln, li) => (
                      <tr
                        key={`ln_${bi}_${li}`}
                        className={plRowClass('pl-pl-line', `pl-line-${bi}-${li}`)}
                        onClick={() => setSelectedPlRowKey(`pl-line-${bi}-${li}`)}
                      >
                        <td className="pl-pl-particular">
                          {ln.drCode && ln.drDetail ? (
                            <button
                              type="button"
                              className="pl-entry-link"
                              onClick={() => openAccountLedger(ln.drCode, ln.drDetail)}
                              title={`Open ledger ${ln.drCode}`}
                            >
                              {ln.drDetail}
                            </button>
                          ) : (
                            ln.drDetail || <span className="pl-empty"> </span>
                          )}
                        </td>
                        <AmtCell value={ln.drAmt} />
                        <td className="pl-pl-particular">
                          {ln.crCode && ln.crDetail ? (
                            <button
                              type="button"
                              className="pl-entry-link"
                              onClick={() => openAccountLedger(ln.crCode, ln.crDetail)}
                              title={`Open ledger ${ln.crCode}`}
                            >
                              {ln.crDetail}
                            </button>
                          ) : (
                            ln.crDetail || <span className="pl-empty"> </span>
                          )}
                        </td>
                        <AmtCell value={ln.crAmt} />
                      </tr>
                    ))}
                    <tr
                      className={plRowClass('pl-pl-schedule-total', `pl-blk-total-${bi}`)}
                      onClick={() => setSelectedPlRowKey(`pl-blk-total-${bi}`)}
                    >
                      <td className="pl-pl-particular">SCHEDULE TOTAL</td>
                      <td className="pl-pl-amt pl-amt text-right">
                        <strong>{fmtAmount(blk.scheduleTotalDr)}</strong>
                      </td>
                      <td className="pl-pl-particular" />
                      <td className="pl-pl-amt pl-amt text-right">
                        <strong>{fmtAmount(blk.scheduleTotalCr)}</strong>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr
                  className={plRowClass('pl-pl-foot-summary', 'pl-foot-summary')}
                  onClick={() => setSelectedPlRowKey('pl-foot-summary')}
                >
                  <td className="pl-pl-particular">TOTAL EXPENSES WITH GL</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{fmtAmount(totals.totalLeftDr)}</strong>
                  </td>
                  <td className="pl-pl-particular">TOTAL INCOME WITHOUT GP</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{fmtAmount(totals.totalIncomeWithoutGp)}</strong>
                  </td>
                </tr>
                <tr
                  className={plRowClass('pl-pl-foot-net', 'pl-foot-net')}
                  onClick={() => setSelectedPlRowKey('pl-foot-net')}
                >
                  <td className="pl-pl-particular">{totals.netProfit > 0 ? 'NET PROFIT' : ''}</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{totals.netProfit > 0 ? fmtAmount(totals.netProfit) : ''}</strong>
                  </td>
                  <td className="pl-pl-particular">{totals.netLoss > 0 ? 'NET LOSS' : ''}</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{totals.netLoss > 0 ? fmtAmount(totals.netLoss) : ''}</strong>
                  </td>
                </tr>
                <tr
                  className={plRowClass('pl-pl-foot-grand', 'pl-foot-grand')}
                  onClick={() => setSelectedPlRowKey('pl-foot-grand')}
                >
                  <td className="pl-pl-particular">TOTAL</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{fmtAmount(totals.grandTotal)}</strong>
                  </td>
                  <td className="pl-pl-particular">TOTAL</td>
                  <td className="pl-pl-amt pl-amt text-right">
                    <strong>{fmtAmount(totals.grandTotal)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </article>
      </div>
    );
  }

  return (
    <div className="slide slide-report slide-18 pl-profit-loss pl-profit-loss--setup">
      <h2>Profit &amp; Loss Account</h2>
      <p className="company-info">
        {compName} | FY {compYear}
      </p>
      <p className="report-info">
        Gross profit/loss uses the same engine as <strong>Trading A/C</strong> (schedule below). P&amp;L lines are ledger balances for schedule ≥ 16 as at the as-on date (VFP PLACT logic).
      </p>
      {error ? <div className="form-api-error">{error}</div> : null}

      <form onSubmit={runReport} className="report-form report-form--trading">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group trading-form-row">
          <label>Trading schedule</label>
          <span className="trading-form-colon">:</span>
          <input
            className="form-input"
            value={schedule}
            onChange={(e) => setSchedule(normalizeSchedule(e.target.value))}
            onBlur={() => {
              const n = normalizeSchedule(schedule);
              if (/^\d{1,2}$/.test(n)) setSchedule(`${n}.00`);
            }}
            placeholder="12.10"
            maxLength={5}
          />
        </div>
        <div className="form-group trading-form-row">
          <label>Specific Trading A/c</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={code} onChange={(e) => setCode(String(e.target.value || '').trim())}>
            <option value="">All</option>
            {accountOptions.map((r) => (
              <option key={String(r.CODE || '').trim()} value={String(r.CODE || '').trim()}>
                {String(r.NAME || '').trim()} [{String(r.CODE || '').trim()}]
              </option>
            ))}
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>As on (ending date)</label>
          <span className="trading-form-colon">:</span>
          <input type="date" className="form-input" value={edt} onChange={(e) => setEdt(e.target.value)} required />
        </div>
        <div className="form-group trading-form-row">
          <label>(C)halan/(B)ikri Wgt</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mcb} onChange={(e) => setMcb(String(e.target.value || 'C').toUpperCase())}>
            <option value="C">C</option>
            <option value="B">B</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Milling Wgt (Y/N)</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mwyn} onChange={(e) => setMwyn(String(e.target.value || 'N').toUpperCase())}>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Cat.Wise (Y/N)</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={catCodeYn} onChange={(e) => setCatCodeYn(String(e.target.value || 'N').toUpperCase())}>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Pick Shortage Y/N</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mShortPick} onChange={(e) => setMShortPick(String(e.target.value || 'N').toUpperCase())}>
            <option value="Y">Y</option>
            <option value="N">N</option>
          </select>
        </div>
        <div className="form-group trading-form-row">
          <label>Cl.Stock Manual/Auto</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={mfyn} onChange={(e) => setMfyn(String(e.target.value || 'A').toUpperCase())}>
            <option value="A">A</option>
            <option value="M">M</option>
          </select>
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
