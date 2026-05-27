import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import LedgerReportHeader from '../components/LedgerReportHeader';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { generatePDF, sharePdfWithWhatsApp, buildLedgerStatementPdfMetadata } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { formatLedgerVoucherApiError } from '../utils/apiLabel';
import { sortTrialBalanceRows } from '../utils/trialBalanceSort';
import SessionInfoLine from '../components/SessionInfoLine';

const VIEW = { FORM: 'form', TRIAL: 'trial', LEDGER: 'ledger', VOUCHER: 'voucher' };

export default function Slide4({ apiBase, formData, onPrev, onReset }) {
  const [viewMode, setViewMode] = useState(VIEW.FORM);
  const [loading, setLoading] = useState(false);

  const [trialRows, setTrialRows] = useState([]);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerTitle, setLedgerTitle] = useState('');
  const [voucherRows, setVoucherRows] = useState([]);
  const [voucherTitle, setVoucherTitle] = useState('');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  /** Schedule filter NUMBER(5,2); 0 = all */
  const [schedule, setSchedule] = useState('0.00');

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const periodStartLabel = toDisplayDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const periodEndLabel = toDisplayDate(toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [
    formData.comp_s_dt,
    formData.comp_e_dt,
    formData.COMP_S_DT,
    formData.COMP_E_DT,
  ]);

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

  const formatScheduleParam = () => {
    const n = parseFloat(String(schedule).replace(',', '.'));
    if (Number.isNaN(n) || n === 0) return 0;
    return Math.round(n * 100) / 100;
  };

  const runTrialBalance = async () => {
    if (!endDate) {
      alert('Please set the ending date (as-of date).');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/trial-balance`, {
        params: {
          comp_code: compCode,
          e_date: toOracleDate(endDate),
          schedule: formatScheduleParam(),
          comp_uid: compUid,
        },
      });
      setTrialRows(sortTrialBalanceRows(Array.isArray(data) ? data : []));
      setViewMode(VIEW.TRIAL);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  /** Ledger from trial row: comp_code, account code, period = compdet comp_s_dt → comp_e_dt */
  const runLedger = async (code, nameHint) => {
    const ledgerCode = code != null && code !== '' ? String(code).trim() : '';
    if (!ledgerCode) {
      alert('No account code on this row.');
      return;
    }

    const sRaw = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const eRaw = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (!sRaw || !eRaw) {
      alert('Financial year dates (comp_s_dt / comp_e_dt) are missing. Go back and re-select the year.');
      return;
    }

    setLoading(true);
    const title = nameHint || ledgerCode;
    setLedgerTitle(title);

    try {
      const { data } = await axios.get(`${apiBase}/api/ledger`, {
        params: {
          comp_code: compCode,
          code: ledgerCode,
          s_date: toOracleDate(sRaw),
          e_date: toOracleDate(eRaw),
          comp_uid: compUid,
        },
      });
      setLedgerRows(Array.isArray(data) ? data : []);
      setViewMode(VIEW.LEDGER);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  /** SALE.TYPE=LEDGER.VR_TYPE, SALE.BILL_NO=LEDGER.VR_NO, SALE.B_TYPE=LEDGER.TYPE, BILL_DATE=VR_DATE */
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
    const ptypeNum =
      typeof vrType === 'number' ? vrType : parseInt(String(vrType ?? '').trim(), 10);
    setBillPrintParams({
      type: saleType,
      ...(Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9 ? { oracleTypeNum: ptypeNum } : {}),
      billNo: String(billNo).trim(),
      bType: bTypeFromLedger,
      oracleDt,
      compYear: String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim(),
      label: `Sale bill — sale.type=${saleType} · bill_no=${String(billNo)} · b_type=${bTypeFromLedger.trim() || ' '} · ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  /** Full voucher (all ledger lines) when user clicks a ledger row */
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
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        alert('No voucher lines found for this voucher.');
        return;
      }
      setVoucherRows(rows);
      setVoucherTitle(`${String(vrType)} ${n} · ${toDisplayDate(ymd)}`);
      setViewMode(VIEW.VOUCHER);
    } catch (err) {
      alert('Error: ' + formatLedgerVoucherApiError(err, apiBase));
    } finally {
      setLoading(false);
    }
  };

  const trialPdfMeta = {
    companyName: compName,
    year: compYear,
    endDate: `As of ${toDisplayDate(endDate)}`,
  };

  const downloadTrialPdf = () =>
    generatePDF('trial-balance', trialRows, trialPdfMeta);

  const shareTrialWhatsApp = () =>
    sharePdfWithWhatsApp(
      'trial-balance',
      trialRows,
      trialPdfMeta,
      `Trial Balance — ${compName}\nFY ${compYear}\nAs of ${toDisplayDate(endDate)}`
    );

  const ledgerAccountCode = String(ledgerRows[0]?.CODE ?? ledgerRows[0]?.code ?? '');
  const ledgerFirstRow = ledgerRows[0];

  const ledgerPdfMeta = buildLedgerStatementPdfMetadata({
    formData,
    compLedgerHeader,
    ledgerFirstRow,
    year: compYear,
    endDate: `${periodStartLabel} – ${periodEndLabel}`,
    accountNameOverride: ledgerTitle,
    accountCodeOverride: ledgerAccountCode,
  });

  const downloadLedgerPdf = () => generatePDF('ledger', ledgerRows, ledgerPdfMeta);

  const shareLedgerWhatsApp = () =>
    sharePdfWithWhatsApp(
      'ledger',
      ledgerRows,
      ledgerPdfMeta,
      `Ledger — ${compName}\n${ledgerTitle} (${ledgerAccountCode})\n${periodStartLabel} → ${periodEndLabel}`
    );

  if (viewMode === VIEW.VOUCHER) {
    return (
      <div className="slide slide-report">
        <SessionInfoLine formData={formData} helpReportId="trial-balance" helpViewKey="voucher" />
        <div className="report-toolbar">
          <h2>Voucher entries</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.LEDGER)}>
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
          account={ledgerRows[0]}
          accountNameFallback={ledgerTitle}
          accountCodeFallback={ledgerAccountCode}
          periodLine={`Financial year ${compYear} · ${periodStartLabel} – ${periodEndLabel}`}
        />
        <p className="ledger-report-voucher-ref">
          Voucher: <strong>{voucherTitle}</strong>
        </p>
        <p className="compdet-date-hint">All accounts posted on this voucher (LEDGER).</p>
        <ReportTable data={voucherRows} type="ledger-voucher" />
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setViewMode(VIEW.LEDGER)}>
            ← Back to ledger
          </button>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            🏠 Home
          </button>
        </div>
      </div>
    );
  }

  if (viewMode === VIEW.LEDGER) {
    return (
      <div className="slide slide-report">
        <SessionInfoLine formData={formData} helpReportId="trial-balance" helpViewKey="ledger" />
        <div className="report-toolbar">
          <h2>Ledger Account</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.TRIAL)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-export"
              onClick={() => downloadLedgerPdf().catch((e) => alert(e?.message || String(e)))}
            >
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(ledgerRows, 'Ledger', `${compName}_Ledger_${ledgerAccountCode}`);
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
              onClick={() => shareLedgerWhatsApp().catch((e) => alert(e?.message || String(e)))}
            >
              💬 WhatsApp
            </button>
          </div>
        </div>
        <LedgerReportHeader
          compHeader={compLedgerHeader}
          companyNameFallback={compName}
          account={ledgerFirstRow}
          accountNameFallback={ledgerTitle}
          accountCodeFallback={ledgerAccountCode}
          periodLine={`Financial year ${compYear} · ${periodStartLabel} – ${periodEndLabel}`}
          hint="Tap a row for voucher detail; sale bill print opens where mapping is available."
        />
        <ReportTable
          data={ledgerRows}
          type="ledger"
          onVoucherClick={runLedgerVoucher}
          onLedgerSaleBillClick={openLedgerSaleBill}
        />
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setViewMode(VIEW.TRIAL)}>
            ← Back to Trial Balance
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setViewMode(VIEW.FORM)}>
            ← Parameters
          </button>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            🏠 Home
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

  if (viewMode === VIEW.TRIAL) {
    return (
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>Trial Balance Report</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.FORM)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-export"
              onClick={() => downloadTrialPdf().catch((e) => alert(e?.message || String(e)))}
            >
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(trialRows, 'TrialBalance', `${compName}_TrialBalance`);
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
              onClick={() => shareTrialWhatsApp().catch((e) => alert(e?.message || String(e)))}
            >
              💬 WhatsApp
            </button>
          </div>
        </div>
        <SessionInfoLine formData={formData} as="div" helpReportId="trial-balance">
          <br />
          As of {toDisplayDate(endDate)}
        </SessionInfoLine>
        <ReportTable
          data={trialRows}
          type="trial-balance"
          onLedgerClick={(code, name) => runLedger(code, name)}
        />
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setViewMode(VIEW.FORM)}>
            ← Parameters
          </button>
          <button type="button" className="btn btn-primary" onClick={onReset}>
            🏠 Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-4">
      <h2>Trial Balance — parameters</h2>
      <div className="form-top-bar">
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
        <button type="button" className="btn btn-primary form-top-bar__run" onClick={runTrialBalance} disabled={loading}>
          {loading ? 'Loading…' : 'Run'}
        </button>
      </div>
      <SessionInfoLine formData={formData} helpReportId="trial-balance">
        <br />
        <span className="compdet-date-hint">
          Set the as-of date (comp_e_dt) and optional schedule. Only Trial Balance runs from this screen; open a ledger
          from a row after the report loads.
        </span>
      </SessionInfoLine>

      <div className="form-group">
        <label htmlFor="tb-end-date">Ending date — as-of (comp_e_dt)</label>
        <input
          id="tb-end-date"
          type="date"
          lang="en-GB"
          className="form-input"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label htmlFor="tb-schedule">Schedule (NUMBER 5,2) — 0.00 = all schedules</label>
        <input
          id="tb-schedule"
          type="number"
          className="form-input"
          step="0.01"
          min="0"
          inputMode="decimal"
          placeholder="0.00"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
        />
      </div>
    </div>
  );
}
