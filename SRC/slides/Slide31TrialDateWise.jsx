import React, { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import LedgerReportContextCard from '../components/LedgerReportContextCard';
import FasReportHeader from '../components/FasReportHeader';
import TrialBalanceSessionCard from '../components/TrialBalanceSessionCard';
import TrialReportExportBar from '../components/TrialReportExportBar';
import FlexAmount from '../components/FlexAmount';
import { computeLedgerSummary } from '../utils/ledgerSummary';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import {
  generatePDF,
  sharePdfWithWhatsApp,
  buildReportHtml,
  buildLedgerStatementPdfMetadata,
} from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { printHtmlDocument } from '../utils/openPrintPreviewWindow';
import { sortTrialBalanceRows, findTrialGrandRow } from '../utils/trialBalanceSort';
import { useTrialLedgerDrilldown } from '../utils/useTrialLedgerDrilldown';
import SessionInfoLine from '../components/SessionInfoLine';

const VIEW = { FORM: 'form', REPORT: 'report', LEDGER: 'ledger', VOUCHER: 'voucher' };

function TrialShell({ className = '', header, exportBar = null, children }) {
  return (
    <div className={`slide slide-31-tb-date-wise fas-tb-host${className ? ` ${className}` : ''}`}>
      <div className="fas-flow fas-tb-flow">
        {header}
        {exportBar}
        <div className="fas-flow-body fas-tb-body">{children}</div>
      </div>
    </div>
  );
}

function formatIndianAmount(val) {
  return (parseFloat(val) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function rowNum(row, ...keys) {
  for (const k of keys) {
    const v = row[k];
    if (v == null || v === '') continue;
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

export default function Slide31TrialDateWise({ apiBase, formData, onPrev, onReset }) {
  const [viewMode, setViewMode] = useState(VIEW.FORM);
  const [loading, setLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [rows, setRows] = useState([]);
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const periodStartLabel = toDisplayDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const periodEndLabel = toDisplayDate(toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));

  const drill = useTrialLedgerDrilldown({ apiBase, formData, compCode, compUid });

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

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

  const runReport = async () => {
    if (!startDate || !endDate) {
      alert('Please set starting and ending dates.');
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/trial-date-wise`, {
        params: {
          comp_code: compCode,
          s_date: toOracleDate(startDate),
          e_date: toOracleDate(endDate),
          schedule: '0',
          comp_uid: compUid,
        },
        withCredentials: true,
      });
      setRows(sortTrialBalanceRows(Array.isArray(data) ? data : []));
      setViewMode(VIEW.REPORT);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const ledgerDateOverride = useMemo(() => ({ sDate: startDate, eDate: endDate }), [startDate, endDate]);

  const runLedgerFromRow = async (code, name) => {
    const result = await drill.runLedger(code, name, ledgerDateOverride);
    if (result) setViewMode(VIEW.LEDGER);
  };

  const grand = useMemo(() => findTrialGrandRow(rows), [rows]);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: compYear,
      endDate: `From ${toDisplayDate(startDate)} TO ${toDisplayDate(endDate)}`,
      periodLabel: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    }),
    [compName, compYear, startDate, endDate]
  );

  const runPdfAction = async (fn) => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      await fn();
    } finally {
      setPdfBusy(false);
    }
  };

  const exportPdf = () => runPdfAction(() => generatePDF('trial-date-wise', rows, pdfMeta));
  const exportWhatsApp = () =>
    runPdfAction(() =>
      sharePdfWithWhatsApp(
        'trial-date-wise',
        rows,
        pdfMeta,
        `Trial Date Wise — ${compName}\n${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`
      )
    );
  const exportExcel = () => {
    try {
      downloadExcelRows(rows, 'TrialDateWise', `${compName}_TrialDateWise`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  };
  const exportPrint = () => {
    printHtmlDocument(buildReportHtml('trial-date-wise', rows, pdfMeta), { title: 'Trial Date Wise' });
  };

  const ledgerAccountCode = String(drill.ledgerRows[0]?.CODE ?? drill.ledgerRows[0]?.code ?? '');
  const ledgerPdfMeta = buildLedgerStatementPdfMetadata({
    formData,
    compLedgerHeader,
    ledgerFirstRow: drill.ledgerRows[0],
    year: compYear,
    endDate: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    accountNameOverride: drill.ledgerTitle,
    accountCodeOverride: ledgerAccountCode,
  });
  const ledgerTotals = useMemo(() => computeLedgerSummary(drill.ledgerRows), [drill.ledgerRows]);

  if (viewMode === VIEW.VOUCHER) {
    return (
      <div className="slide slide-report">
        <SessionInfoLine formData={formData} helpReportId="trial-date-wise" helpViewKey="voucher" />
        <div className="report-toolbar">
          <h2>Voucher — {drill.voucherTitle}</h2>
          <button type="button" className="btn btn-toolbar-back" onClick={() => setViewMode(VIEW.LEDGER)}>
            ← Ledger
          </button>
        </div>
        <ReportTable data={drill.voucherRows} type="ledger-voucher" />
      </div>
    );
  }

  if (viewMode === VIEW.LEDGER) {
    return (
      <TrialShell
        header={
          <FasReportHeader
            title={`Ledger — ${drill.ledgerTitle}`}
            onBack={() => setViewMode(VIEW.REPORT)}
            rightSlot={
              <span className="fas-report-header__meta">
                {toDisplayDate(startDate)} – {toDisplayDate(endDate)}
              </span>
            }
          />
        }
        exportBar={
          <TrialReportExportBar
            pdfBusy={pdfBusy}
            onPdf={() =>
              runPdfAction(() => generatePDF('ledger', drill.ledgerRows, ledgerPdfMeta)).catch((e) =>
                alert(e?.message || String(e))
              )
            }
            onExcel={() =>
              downloadExcelRows(drill.ledgerRows, 'Ledger', `${compName}_Ledger_${ledgerAccountCode}`)
            }
            onWhatsApp={() =>
              runPdfAction(() =>
                sharePdfWithWhatsApp('ledger', drill.ledgerRows, ledgerPdfMeta, `Ledger — ${drill.ledgerTitle}`)
              ).catch((e) => alert(e?.message || String(e)))
            }
          />
        }
      >
        <LedgerReportContextCard
          compHeader={compLedgerHeader}
          companyNameFallback={compName}
          account={drill.ledgerRows[0]}
          accountNameFallback={drill.ledgerTitle}
          accountCodeFallback={ledgerAccountCode}
          fyLine={`${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`}
          hint="Ledger for the report date range. Tap a row for voucher detail."
        />
        <div className="fas-ledger-totals">
          <div className="fas-tb-total-card">
            <div className="fas-tb-total-card__label">Opening</div>
            <FlexAmount className="fas-tb-total-card__value" value={formatIndianAmount(ledgerTotals.opening)} prefix="₹" />
          </div>
          <div className="fas-tb-total-card fas-tb-total-card--debit">
            <div className="fas-tb-total-card__label">Total Dr</div>
            <FlexAmount className="fas-tb-total-card__value" value={formatIndianAmount(ledgerTotals.sumDr)} prefix="₹" />
          </div>
          <div className="fas-tb-total-card fas-tb-total-card--credit">
            <div className="fas-tb-total-card__label">Total Cr</div>
            <FlexAmount className="fas-tb-total-card__value" value={formatIndianAmount(ledgerTotals.sumCr)} prefix="₹" />
          </div>
        </div>
        <ReportTable
          data={drill.ledgerRows}
          type="ledger"
          onVoucherClick={async (row) => {
            const ok = await drill.runLedgerVoucher(row);
            if (ok) setViewMode(VIEW.VOUCHER);
          }}
          onLedgerSaleBillClick={drill.openLedgerSaleBill}
        />
        <SaleBillPrintModal
          open={drill.billPrintOpen}
          onClose={() => drill.setBillPrintOpen(false)}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={drill.billPrintParams}
          companyName={compName}
        />
      </TrialShell>
    );
  }

  if (viewMode === VIEW.REPORT) {
    const g = grand || {};
    return (
      <TrialShell
        className="fas-tb-host--results"
        header={
          <FasReportHeader
            title="Trial Balance Date Wise"
            onBack={() => setViewMode(VIEW.FORM)}
            rightSlot={
              <span className="fas-report-header__meta">
                {toDisplayDate(startDate)} – {toDisplayDate(endDate)}
              </span>
            }
          />
        }
        exportBar={
          <TrialReportExportBar
            pdfBusy={pdfBusy}
            onPdf={() => exportPdf().catch((e) => alert(e?.message || String(e)))}
            onExcel={exportExcel}
            onPrint={exportPrint}
            onWhatsApp={() => exportWhatsApp().catch((e) => alert(e?.message || String(e)))}
            printDisabled={!rows.length}
          />
        }
      >
        {loading ? <p className="fas-tb-status-hint">Loading…</p> : null}
        <TrialBalanceSessionCard formData={formData} />
        <p className="sale-list-hint">Tap an account row to open ledger for the selected date range.</p>
        {grand ? (
          <div className="fas-tb-totals fas-tb-totals--debit-first fas-tb-totals--date-wise">
            <div className="fas-tb-total-card">
              <div className="fas-tb-total-card__label">Closing Dr</div>
              <FlexAmount
                className="fas-tb-total-card__value"
                value={formatIndianAmount(rowNum(g, 'CL_DR', 'cl_dr'))}
                prefix="₹"
              />
            </div>
            <div className="fas-tb-total-card">
              <div className="fas-tb-total-card__label">Closing Cr</div>
              <FlexAmount
                className="fas-tb-total-card__value"
                value={formatIndianAmount(rowNum(g, 'CL_CR', 'cl_cr'))}
                prefix="₹"
              />
            </div>
          </div>
        ) : null}
        <div className="fas-tb-table-wrap">
          <ReportTable data={rows} type="trial-date-wise" onLedgerClick={runLedgerFromRow} />
        </div>
      </TrialShell>
    );
  }

  return (
    <TrialShell
      className="fas-tb-host--form"
      header={
        <FasReportHeader
          title="Trial Balance Date Wise"
          onBack={onPrev}
          rightSlot={
            <button type="button" className="fas-report-header__run" onClick={runReport} disabled={loading}>
              {loading ? 'Running…' : '▶ Run'}
            </button>
          }
        />
      }
    >
      <TrialBalanceSessionCard formData={formData} />
      <div className="fas-field-group">
        <div className="fas-field-label">Starting date</div>
        <div className="fas-field-input fas-tb-date-field">
          <input type="date" lang="en-GB" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
      </div>
      <div className="fas-field-group">
        <div className="fas-field-label">Ending date</div>
        <div className="fas-field-input fas-tb-date-field">
          <input type="date" lang="en-GB" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>
      <div className="fas-info-tip">
        Opening balance is before the starting date. Transactions are between the two dates. Closing balance is as of the
        ending date.
      </div>
      <div className="fas-tb-form-footer">
        <button type="button" className="fas-btn fas-btn-primary" onClick={runReport} disabled={loading}>
          {loading ? 'Running…' : '▶ Run Report'}
        </button>
      </div>
    </TrialShell>
  );
}
