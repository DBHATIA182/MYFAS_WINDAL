import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import LedgerReportContextCard from '../components/LedgerReportContextCard';
import LedgerMobileView from '../components/LedgerMobileView';
import FasReportHeader from '../components/FasReportHeader';
import FlexAmount from '../components/FlexAmount';
import { generatePDF, sharePdfWithWhatsApp, buildLedgerStatementPdfMetadata, buildReportHtml } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { printHtmlDocument } from '../utils/openPrintPreviewWindow';
import LedgerExportMenu from '../components/LedgerExportMenu';
import LedgerRowFilterBar from '../components/LedgerRowFilterBar';
import { filterLedgerRows, countLedgerFilterStats, ledgerFilterIsActive, collectLedgerVrTypes } from '../utils/ledgerMobileDisplay';
import { toInputDateString, toOracleDate, toDisplayDate, formatCurBal, getCurBal } from '../utils/dateFormat';
import { formatLedgerVoucherApiError } from '../utils/apiLabel';
import { computeLedgerSummary } from '../utils/ledgerSummary';
import SessionInfoLine from '../components/SessionInfoLine';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import VoiceSearchButton from '../components/VoiceSearchButton';
import { filterAccountRowsSmart, SEARCH_NO_MATCH, SEARCH_TYPE_HINT } from '../utils/masterSearchFilter';
import { applyVoiceAccountSearch } from '../utils/voiceSearchApply';
import { LEDGER_FLOW_STYLE, LEDGER_SHELL_STYLE, mountLedgerFullBleedLayout } from '../utils/ledgerFullBleedLayout';

function formatIndianAmount(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function LedgerReportShell({ className = '', header, exportBar = null, children }) {
  useLayoutEffect(() => mountLedgerFullBleedLayout(), []);

  return (
    <div
      className={`slide slide-5 fas-tb-host ledger-full-bleed${className ? ` ${className}` : ''}`}
      style={LEDGER_SHELL_STYLE}
    >
      <div className="fas-flow fas-tb-flow" style={LEDGER_FLOW_STYLE}>
        <div className="fas-ledger-sticky-top">
          {header}
          {exportBar}
        </div>
        <div className="fas-flow-body fas-tb-body">{children}</div>
      </div>
    </div>
  );
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

export default function Slide5({ apiBase, onPrev, onReset, formData, viewMode = 'desktop' }) {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reportData, setReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const startDateInputRef = useRef(null);
  const accountSearchInputRef = useRef(null);
  const [listHighlight, setListHighlight] = useState(0);
  const [voucherRows, setVoucherRows] = useState(null);
  const [voucherTitle, setVoucherTitle] = useState('');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);
  const [ledgerRowFilter, setLedgerRowFilter] = useState('');
  const [ledgerAmountSide, setLedgerAmountSide] = useState('all');
  const [ledgerVrType, setLedgerVrType] = useState('all');
  const [interestRate, setInterestRate] = useState('12');
  const [graceDrDays, setGraceDrDays] = useState('0');
  const [graceCrDays, setGraceCrDays] = useState('0');
  const [interestCalcDate, setInterestCalcDate] = useState('');
  const [voucherWiseTotal, setVoucherWiseTotal] = useState('N');
  const isLedgerInterest = String(formData.reportType || '').toLowerCase() === 'ledger-interest';

  // Period from compdet (passed via Slide2 → App as comp_s_dt / comp_e_dt)
  useEffect(() => {
    const sRaw = formData.comp_s_dt ?? formData.COMP_S_DT;
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const s = toInputDateString(sRaw);
    const e = toInputDateString(eRaw);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
    if (e) setInterestCalcDate(e);
  }, [
    formData.comp_s_dt,
    formData.comp_e_dt,
    formData.COMP_S_DT,
    formData.COMP_E_DT,
  ]);

  useEffect(() => {
    const fetchAccounts = async () => {
      const code = formData.comp_code || formData.COMP_CODE;
      const uid = formData.comp_uid || formData.COMP_UID;
      if (!code || !uid) return;
      try {
        const response = await axios.get(`${apiBase}/api/accounts`, {
          params: { comp_code: code, comp_uid: uid },
        });
        setAccounts(response.data || []);
      } catch (err) {
        console.error('Failed to load accounts:', err);
      }
    };
    fetchAccounts();
  }, [apiBase, formData]);

  useEffect(() => {
    const code = formData.comp_code || formData.COMP_CODE;
    const uid = formData.comp_uid || formData.COMP_UID;
    if (!code || uid == null || String(uid).trim() === '') {
      setCompLedgerHeader(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
          params: { comp_code: code, comp_uid: uid },
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
  }, [apiBase, formData.comp_code, formData.COMP_CODE, formData.comp_uid, formData.COMP_UID]);

  const filteredAccounts = useMemo(
    () => filterAccountRowsSmart(accounts, accountSearch, getCurBal, 50),
    [accounts, accountSearch]
  );

  useEffect(() => {
    setListHighlight(0);
  }, [accountSearch]);

  const accountListMaxIdx = Math.max(0, filteredAccounts.length - 1);
  const safeHighlight = Math.min(listHighlight, accountListMaxIdx);

  const focusStartDate = () => {
    setTimeout(() => {
      const el = startDateInputRef.current;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus({ preventScroll: true });
      }
    }, 0);
  };

  const selectAccount = (account) => {
    setSelectedAccount(String(account.CODE));
    setAccountSearch('');
    focusStartDate();
  };

  const applyAccountVoiceSearch = (transcript) => {
    applyVoiceAccountSearch({
      transcript,
      rows: accounts,
      getCurBal,
      setQuery: setAccountSearch,
      setHighlight: setListHighlight,
      clearSelection: () => setSelectedAccount(''),
      inputRef: accountSearchInputRef,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedAccount) {
      alert('Please select an account');
      return;
    }
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }
    if (isLedgerInterest && !interestCalcDate) {
      alert('Please select interest calculation date');
      return;
    }

    setLoading(true);
    try {
      const sDate = toOracleDate(startDate);
      const eDate = toOracleDate(endDate);

      const params = {
        comp_code: formData.comp_code || formData.COMP_CODE,
        code: String(selectedAccount).trim(),
        s_date: sDate,
        e_date: eDate,
        comp_uid: formData.comp_uid || formData.COMP_UID,
        voucher_wise_total: voucherWiseTotal,
      };
      if (isLedgerInterest) {
        params.int_date = toOracleDate(interestCalcDate);
        params.int_rate = String(interestRate).trim() || '0';
        params.grace_dr_days = String(graceDrDays).trim() || '0';
        params.grace_cr_days = String(graceCrDays).trim() || '0';
      }

      const response = await axios.get(`${apiBase}${isLedgerInterest ? '/api/ledger-interest' : '/api/ledger'}`, {
        params,
        withCredentials: true,
        timeout: 30000
      });
      
      if (response.data && response.data.length > 0) {
        setLedgerRowFilter('');
        setLedgerAmountSide('all');
        setLedgerVrType('all');
        setReportData(response.data);
        setShowReport(true);
      } else {
        alert('No transactions found for this account');
      }
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Sale bill: SALE.TYPE = LEDGER.VR_TYPE, SALE.BILL_NO = LEDGER.VR_NO, SALE.B_TYPE = LEDGER.TYPE, date = VR_DATE.
   * (Sale list screen uses SALE.TYPE / BILL_NO / BILL_DATE / B_TYPE from list rows — different column names.)
   */
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
      const response = await axios.get(`${apiBase}/api/ledger-voucher`, {
        params: {
          comp_code: formData.comp_code || formData.COMP_CODE,
          vr_type: String(vrType),
          vr_date: toOracleDate(ymd),
          vr_no: n,
          comp_uid: formData.comp_uid || formData.COMP_UID,
        },
        withCredentials: true,
        timeout: 30000,
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      if (rows.length === 0) {
        alert('No voucher lines found for this voucher.');
        return;
      }
      setVoucherRows(rows);
      setVoucherTitle(`${String(vrType)} ${n} · ${toDisplayDate(ymd)}`);
    } catch (error) {
      alert('Error: ' + formatLedgerVoucherApiError(error, apiBase));
    } finally {
      setLoading(false);
    }
  };

  const ledgerPdfMeta = () => {
    const account = accounts.find((a) => String(a.CODE) === String(selectedAccount));
    return buildLedgerStatementPdfMetadata({
      formData,
      compLedgerHeader,
      account,
      year: formData.comp_year ?? formData.COMP_YEAR,
      endDate: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    });
  };

  const downloadPDF = async () => {
    await generatePDF('ledger', reportData, ledgerPdfMeta());
  };

  const shareWhatsApp = async () => {
    const account = accounts.find((a) => String(a.CODE) === String(selectedAccount));
    const shareText = [
      `Ledger Report — ${formData.comp_name}`,
      `${formData.comp_year} | ${account?.NAME ?? 'Account'} (${String(account?.CODE ?? selectedAccount)})`,
      `${toDisplayDate(startDate)} → ${toDisplayDate(endDate)}`,
    ].join('\n');
    await sharePdfWithWhatsApp('ledger', reportData, ledgerPdfMeta(), shareText);
  };

  const ledgerTotals = useMemo(() => computeLedgerSummary(reportData), [reportData]);
  const ledgerVrTypeOptions = useMemo(() => collectLedgerVrTypes(reportData), [reportData]);
  const ledgerFilterStats = useMemo(
    () =>
      countLedgerFilterStats(reportData, ledgerRowFilter, {
        includeInterest: isLedgerInterest,
        amountSide: ledgerAmountSide,
        vrType: ledgerVrType,
      }),
    [reportData, ledgerRowFilter, isLedgerInterest, ledgerAmountSide, ledgerVrType]
  );
  const filteredReportData = useMemo(
    () =>
      filterLedgerRows(reportData, ledgerRowFilter, {
        keepOpening: true,
        includeInterest: isLedgerInterest,
        amountSide: ledgerAmountSide,
        vrType: ledgerVrType,
      }),
    [reportData, ledgerRowFilter, isLedgerInterest, ledgerAmountSide, ledgerVrType]
  );
  const useMobileLedgerCards = viewMode === 'mobile' && !isLedgerInterest;
  const isDesktopLedgerView = viewMode === 'desktop';

  if (showReport && reportData.length > 0) {
    const account = accounts.find((a) => String(a.CODE) === String(selectedAccount));
    const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
    const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';
    const accountName = account?.NAME ?? '';
    const periodLine = isDesktopLedgerView
      ? `FY ${compYear} / ${toDisplayDate(startDate)} - ${toDisplayDate(endDate)}`
      : `Financial year ${compYear} · ${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`;
    const ledgerHint = isLedgerInterest
      ? `Interest date ${toDisplayDate(interestCalcDate)} · Rate ${String(interestRate).trim() || '0'}% · Grace DR ${String(
          graceDrDays
        ).trim() || '0'} · Grace CR ${String(graceCrDays).trim() || '0'}`
      : `Tap a row for voucher detail; sale bill print opens where mapping is available. · Voucher Wise Total: ${voucherWiseTotal}`;
    const closeReport = () => {
      setVoucherRows(null);
      setVoucherTitle('');
      setShowReport(false);
      setLedgerRowFilter('');
      setLedgerAmountSide('all');
      setLedgerVrType('all');
      setBillPrintOpen(false);
      setBillPrintParams(null);
    };

    const saleBillModal = (
      <SaleBillPrintModal
        open={billPrintOpen}
        onClose={() => {
          setBillPrintOpen(false);
          setBillPrintParams(null);
        }}
        apiBase={apiBase}
        compCode={formData.comp_code ?? formData.COMP_CODE}
        compUid={formData.comp_uid ?? formData.COMP_UID}
        billParams={billPrintParams}
        companyName={formData.comp_name ?? formData.COMP_NAME ?? ''}
      />
    );

    const handleLedgerExportPdf = () => downloadPDF().catch((e) => alert(e?.message || String(e)));
    const handleLedgerExportExcel = () => {
      try {
        const code = String(selectedAccount || 'account');
        downloadExcelRows(reportData, 'Ledger', `${compName}_Ledger_${code}`);
      } catch (e) {
        alert(String(e?.message || e));
      }
    };
    const handleLedgerExportWhatsApp = () => shareWhatsApp().catch((e) => alert(e?.message || String(e)));
    const handleLedgerExportPrint = () => {
      if (!reportData.length) return;
      const html = buildReportHtml('ledger', reportData, ledgerPdfMeta());
      printHtmlDocument(html, { title: isLedgerInterest ? 'Ledger With Interest' : 'Ledger Report' });
    };

    const ledgerHeaderRightSlot = (
      <>
        {isDesktopLedgerView ? (
          <LedgerExportMenu
            showPdf={!isLedgerInterest}
            showWhatsApp={!isLedgerInterest}
            printDisabled={!reportData.length}
            onPdf={handleLedgerExportPdf}
            onWhatsApp={handleLedgerExportWhatsApp}
            onExcel={handleLedgerExportExcel}
            onPrint={handleLedgerExportPrint}
          />
        ) : null}
        <SessionToolbarChrome
          helpReportId={isLedgerInterest ? 'ledger-interest' : 'ledger'}
          helpCompanyName={compName}
        />
      </>
    );

    if (voucherRows != null) {
      return (
        <LedgerReportShell
          className="fas-tb-host--results fas-ledger-host"
          header={
            <FasReportHeader
              className="fas-report-header--ledger-toolbar"
              title="Voucher entries"
              backLabel="← Ledger"
              onBack={() => setVoucherRows(null)}
              rightSlot={
                <SessionToolbarChrome
                  helpReportId={isLedgerInterest ? 'ledger-interest' : 'ledger'}
                  helpCompanyName={compName}
                />
              }
            />
          }
          exportBar={
            <div className="fas-tb-export-bar fas-tb-export-bar--icons">
              <button
                type="button"
                className="fas-tb-export-icon fas-tb-export-icon--back-nav btn btn-secondary"
                aria-label="Back to ledger"
                title="Back to ledger"
                onClick={() => setVoucherRows(null)}
              >
                <span aria-hidden="true">←</span>
              </button>
              <button
                type="button"
                className="fas-tb-export-icon btn btn-excel"
                aria-label="Excel"
                title="Excel"
                onClick={() => {
                  try {
                    const tag = String(voucherTitle || 'voucher').replace(/\s+/g, '_');
                    downloadExcelRows(voucherRows, 'Voucher', `${compName}_${tag}`);
                  } catch (e) {
                    alert(String(e?.message || e));
                  }
                }}
              >
                <span aria-hidden="true">📊</span>
              </button>
            </div>
          }
        >
          <LedgerReportContextCard
            compHeader={compLedgerHeader}
            companyNameFallback={compName}
            account={account}
            accountCodeFallback={selectedAccount}
            fyLine={periodLine}
            hint={`Voucher: ${voucherTitle}`}
          />

          <div className="fas-ledger-table-wrap">
            <ReportTable data={voucherRows} type="ledger-voucher" />
          </div>

          <div className="fas-ledger-footer fas-ledger-footer--mobile-only">
            <button type="button" className="fas-btn fas-btn--outline" onClick={() => setVoucherRows(null)}>
              ← Back to ledger
            </button>
            <button type="button" className="fas-btn fas-btn--outline" onClick={closeReport}>
              ← Parameters
            </button>
          </div>
          {saleBillModal}
        </LedgerReportShell>
      );
    }

    if (useMobileLedgerCards) {
      return (
        <>
          <LedgerMobileView
            companyName={compName}
            accountName={account?.NAME ?? ''}
            accountCode={String(selectedAccount || (account?.CODE ?? ''))}
            startDate={startDate}
            endDate={endDate}
            opening={ledgerTotals.opening}
            sumDr={ledgerTotals.sumDr}
            sumCr={ledgerTotals.sumCr}
            closing={ledgerTotals.closing}
            rows={reportData}
            onBack={closeReport}
            onVoucherClick={runLedgerVoucher}
            onLedgerSaleBillClick={openLedgerSaleBill}
            onExportPdf={() => downloadPDF().catch((e) => alert(e?.message || String(e)))}
            onExportExcel={() => {
              try {
                const code = String(selectedAccount || 'account');
                downloadExcelRows(reportData, 'Ledger', `${compName}_Ledger_${code}`);
              } catch (e) {
                alert(String(e?.message || e));
              }
            }}
            onExportWhatsApp={() => shareWhatsApp().catch((e) => alert(e?.message || String(e)))}
            helpReportId="ledger"
            helpCompanyName={compName}
          />
          {saleBillModal}
        </>
      );
    }

    return (
      <LedgerReportShell
        className={`fas-tb-host--results fas-ledger-host${isDesktopLedgerView ? ' fas-ledger-host--desktop' : ''}`}
        header={
          <FasReportHeader
            className={isDesktopLedgerView ? 'fas-report-header--ledger-desktop' : 'fas-report-header--ledger-toolbar'}
            title={isLedgerInterest ? 'Ledger With Interest' : 'Ledger Report'}
            onBack={closeReport}
            rightSlot={ledgerHeaderRightSlot}
          />
        }
        exportBar={
          isDesktopLedgerView ? null : (
            <div className="fas-tb-export-bar fas-tb-export-bar--icons">
              <button
                type="button"
                className="fas-tb-export-icon fas-tb-export-icon--back-nav btn btn-secondary"
                aria-label="Parameters"
                title="Parameters"
                onClick={closeReport}
              >
                <span aria-hidden="true">←</span>
              </button>
              {!isLedgerInterest ? (
                <button
                  type="button"
                  className="fas-tb-export-icon btn btn-export"
                  aria-label="PDF"
                  title="PDF"
                  onClick={handleLedgerExportPdf}
                >
                  <span aria-hidden="true">📄</span>
                </button>
              ) : null}
              <button
                type="button"
                className="fas-tb-export-icon btn btn-excel"
                aria-label="Excel"
                title="Excel"
                onClick={handleLedgerExportExcel}
              >
                <span aria-hidden="true">📊</span>
              </button>
              {!isLedgerInterest ? (
                <button
                  type="button"
                  className="fas-tb-export-icon btn btn-whatsapp"
                  aria-label="WhatsApp"
                  title="WhatsApp"
                  onClick={handleLedgerExportWhatsApp}
                >
                  <span aria-hidden="true">💬</span>
                </button>
              ) : null}
            </div>
          )
        }
      >
        {isDesktopLedgerView ? (
          <nav className="fas-ledger-desktop-crumb" aria-label="Breadcrumb">
            <span className="fas-ledger-desktop-crumb__sep">/</span>
            <span>Ledger</span>
            <span className="fas-ledger-desktop-crumb__sep">/</span>
            <span className="fas-ledger-desktop-crumb__account" title={accountName}>
              {accountName || 'Account'}
            </span>
          </nav>
        ) : null}

        <LedgerReportContextCard
          compHeader={compLedgerHeader}
          companyNameFallback={compName}
          account={account}
          accountCodeFallback={selectedAccount}
          fyLine={periodLine}
          hint={ledgerHint}
        />

        <div className="fas-ledger-totals">
          <div className="fas-tb-total-card fas-ledger-total-card--opening">
            <div className="fas-tb-total-card__label">{isDesktopLedgerView ? 'Opening Balance' : 'Opening'}</div>
            <FlexAmount
              className="fas-tb-total-card__value"
              value={formatIndianAmount(ledgerTotals.opening)}
              prefix="₹"
            />
          </div>
          <div className="fas-tb-total-card fas-tb-total-card--debit fas-ledger-total-card--debit">
            <div className="fas-tb-total-card__label">{isDesktopLedgerView ? 'Total Debit' : 'Total Dr'}</div>
            <FlexAmount
              className="fas-tb-total-card__value"
              value={formatIndianAmount(ledgerTotals.sumDr)}
              prefix="₹"
            />
          </div>
          <div className="fas-tb-total-card fas-tb-total-card--credit fas-ledger-total-card--credit">
            <div className="fas-tb-total-card__label">{isDesktopLedgerView ? 'Total Credit' : 'Total Cr'}</div>
            <FlexAmount
              className="fas-tb-total-card__value"
              value={formatIndianAmount(ledgerTotals.sumCr)}
              prefix="₹"
            />
          </div>
        </div>

        <LedgerRowFilterBar
          value={ledgerRowFilter}
          onChange={setLedgerRowFilter}
          amountSide={ledgerAmountSide}
          onAmountSideChange={setLedgerAmountSide}
          vrType={ledgerVrType}
          vrTypeOptions={ledgerVrTypeOptions}
          onVrTypeChange={setLedgerVrType}
          shownCount={ledgerFilterStats.shown}
          totalCount={ledgerFilterStats.total}
          className={isDesktopLedgerView ? 'fas-ledger-filter--desktop' : ''}
        />

        <div className="fas-ledger-table-wrap">
          <ReportTable
            data={filteredReportData}
            type={isLedgerInterest ? 'ledger-interest' : 'ledger'}
            onVoucherClick={runLedgerVoucher}
            onLedgerSaleBillClick={openLedgerSaleBill}
            filterActive={ledgerFilterIsActive(ledgerRowFilter, ledgerAmountSide, ledgerVrType)}
          />
        </div>

        <div className="fas-ledger-footer fas-ledger-footer--mobile-only">
          <button type="button" className="fas-btn fas-btn--outline" onClick={closeReport}>
            ← Parameters
          </button>
        </div>
        {saleBillModal}
      </LedgerReportShell>
    );
  }

  return (
    <div className="slide slide-5">
      <h2>{isLedgerInterest ? 'Ledger With Interest Parameters' : 'Ledger Report Parameters'}</h2>
      
      <SessionInfoLine formData={formData} helpReportId={isLedgerInterest ? 'ledger-interest' : 'ledger'}>
        <br />
        <span className="compdet-date-hint">
          Dates below are comp_s_dt / comp_e_dt for this year (FY may span two calendar years).
        </span>
      </SessionInfoLine>

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>
        <div className="form-group account-search-group">
          <label htmlFor="account-search">Search account:</label>
          <div className="account-search-input-row">
            <input
              id="account-search"
              ref={accountSearchInputRef}
              type="search"
              autoComplete="off"
              placeholder="Type code, name, or city… (↑↓ Enter)"
              value={accountSearch}
              onChange={(e) => setAccountSearch(e.target.value)}
              onKeyDown={(e) => {
              if (selectedAccount) return;
              const max = Math.max(0, filteredAccounts.length - 1);
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (filteredAccounts.length === 0) return;
                setListHighlight((h) => Math.min(max, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setListHighlight((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                const acc = filteredAccounts[safeHighlight];
                if (acc) {
                  e.preventDefault();
                  selectAccount(acc);
                }
              }
              }}
              className="form-input account-search-input-row__field"
            />
            <VoiceSearchButton
              disabled={!!selectedAccount}
              title="Speak party name to search"
              onTranscript={applyAccountVoiceSearch}
            />
          </div>
          {selectedAccount ? (
            <p className="account-selected-hint">
              Selected: <strong>{accounts.find((a) => String(a.CODE) === String(selectedAccount))?.NAME ?? '—'}</strong>
              {' '}(<code>{selectedAccount}</code>)
              <button
                type="button"
                className="btn-text-clear"
                onClick={() => {
                  setSelectedAccount('');
                  setAccountSearch('');
                  setListHighlight(0);
                  setTimeout(() => accountSearchInputRef.current?.focus(), 0);
                }}
              >
                Clear
              </button>
            </p>
          ) : null}
          {!selectedAccount && accountSearch.trim() ? (
            <div className="account-search-results" role="listbox" aria-label="Matching accounts">
              <div className="account-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
                <span>City</span>
                <span className="account-search-bal-h">Bal</span>
              </div>
              {filteredAccounts.length === 0 ? (
                <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
              ) : (
                filteredAccounts.map((account, index) => {
                  const bal = getCurBal(account);
                  const n = Number(bal);
                  const dc =
                    bal != null && bal !== '' && !Number.isNaN(n)
                      ? n < 0
                        ? 'Cr'
                        : 'Dr'
                      : '';
                  const rowHi = safeHighlight === index;
                  return (
                    <button
                      key={account.CODE}
                      type="button"
                      role="option"
                      aria-selected={rowHi}
                      className={`account-search-row${String(selectedAccount) === String(account.CODE) ? ' is-active' : ''}${rowHi ? ' is-highlight' : ''}`}
                      onMouseEnter={() => setListHighlight(index)}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectAccount(account);
                      }}
                    >
                      <span className="account-search-code">{highlightMatch(account.CODE, accountSearch)}</span>
                      <span className="account-search-name" title={account.NAME}>
                        {highlightMatch(account.NAME, accountSearch)}
                      </span>
                      <span className="account-search-city" title={account.CITY || ''}>
                        {account.CITY || '—'}
                      </span>
                      <span
                        className={`account-search-bal ${dc === 'Cr' ? 'is-cr' : dc === 'Dr' ? 'is-dr' : ''}`}
                      >
                        {formatCurBal(bal)}
                        {dc ? <span className="account-search-bal-dc">{dc}</span> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : !selectedAccount ? (
            <p className="sale-bill-section__hint dc-party-search-hint">{SEARCH_TYPE_HINT}</p>
          ) : null}
        </div>

        <div className="form-group">
          <label htmlFor="start-date">Starting date (financial year from compdet)</label>
          <input
            id="start-date"
            ref={startDateInputRef}
            type="date"
            lang="en-GB"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="form-input"
          />
        </div>

        <div className="form-group">
          <label htmlFor="end-date">Ending date (financial year from compdet)</label>
          <input
            id="end-date"
            type="date"
            lang="en-GB"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="form-input"
          />
        </div>

        {!isLedgerInterest ? (
          <div className="form-group">
            <span className="form-label-block">Voucher Wise Total</span>
            <div className="radio-row">
              <label className="radio-inline">
                <input
                  type="radio"
                  name="voucher-wise-total"
                  value="N"
                  checked={voucherWiseTotal === 'N'}
                  onChange={() => setVoucherWiseTotal('N')}
                />
                No (N)
              </label>
              <label className="radio-inline">
                <input
                  type="radio"
                  name="voucher-wise-total"
                  value="Y"
                  checked={voucherWiseTotal === 'Y'}
                  onChange={() => setVoucherWiseTotal('Y')}
                />
                Yes (Y)
              </label>
            </div>
          </div>
        ) : null}

        {isLedgerInterest ? (
          <>
            <div className="form-group">
              <label htmlFor="interest-date">Interest calculation date</label>
              <input
                id="interest-date"
                type="date"
                lang="en-GB"
                value={interestCalcDate}
                onChange={(e) => setInterestCalcDate(e.target.value)}
                className="form-input"
              />
            </div>
            <div className="form-row-broker">
              <div className="form-group">
                <label htmlFor="interest-rate">Rate of interest (%)</label>
                <input
                  id="interest-rate"
                  type="number"
                  step="0.01"
                  className="form-input"
                  value={interestRate}
                  onChange={(e) => setInterestRate(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="grace-dr">Grace days Debit</label>
                <input
                  id="grace-dr"
                  type="number"
                  step="1"
                  className="form-input"
                  value={graceDrDays}
                  onChange={(e) => setGraceDrDays(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label htmlFor="grace-cr">Grace days Credit</label>
                <input
                  id="grace-cr"
                  type="number"
                  step="1"
                  className="form-input"
                  value={graceCrDays}
                  onChange={(e) => setGraceCrDays(e.target.value)}
                />
              </div>
            </div>
          </>
        ) : null}

        <div className="button-group">
          <button type="button" onClick={onPrev} className="btn btn-secondary">
            ← Back
          </button>
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? 'Loading...' : 'Run'}
          </button>
        </div>
      </form>
    </div>
  );
}