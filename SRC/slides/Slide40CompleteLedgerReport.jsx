import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import LedgerReportHeader from '../components/LedgerReportHeader';
import SessionInfoLine from '../components/SessionInfoLine';
import {
  generatePDF,
  sharePdfWithWhatsApp,
  buildLedgerStatementPdfMetadata,
} from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { formatLedgerVoucherApiError } from '../utils/apiLabel';
import {
  advanceReportFormOnEnter,
  focusNextReportField,
  handleReportDateEnter,
  scrollReportFieldIntoView,
} from '../utils/reportFormFocus';

const reqOpts = { withCredentials: true, timeout: 120000 };

export default function Slide40CompleteLedgerReport({ apiBase, onPrev, onReset, formData, slideClass = '' }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [scheduleNo, setScheduleNo] = useState('');
  const [startCode, setStartCode] = useState('1');
  const [endCode, setEndCode] = useState('999999');
  const [voucherWiseTotal, setVoucherWiseTotal] = useState('N');
  const [schedules, setSchedules] = useState([]);
  const [reportPayload, setReportPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);
  const [voucherRows, setVoucherRows] = useState(null);
  const [voucherTitle, setVoucherTitle] = useState('');
  const [voucherAccount, setVoucherAccount] = useState(null);
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  const formRef = useRef(null);
  const startDateRef = useRef(null);
  const endDateRef = useRef(null);
  const scheduleRef = useRef(null);
  const startCodeRef = useRef(null);
  const endCodeRef = useRef(null);

  useEffect(() => {
    const sRaw = formData.comp_s_dt ?? formData.COMP_S_DT;
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const s = toInputDateString(sRaw);
    const e = toInputDateString(eRaw);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    const code = formData.comp_code || formData.COMP_CODE;
    const uid = formData.comp_uid || formData.COMP_UID;
    if (!code || !uid) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/api/master-party-schedules`, {
          params: { comp_code: code, comp_uid: uid },
          ...reqOpts,
        });
        if (!cancelled) setSchedules(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setSchedules([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, formData.comp_code, formData.COMP_CODE, formData.comp_uid, formData.COMP_UID]);

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

  const scheduleLabel = useMemo(() => {
    const q = String(scheduleNo ?? '').trim();
    if (!q) return '';
    const hit = schedules.find((s) => String(s.NO ?? s.no) === q);
    return hit ? String(hit.NAME ?? hit.name ?? '') : '';
  }, [scheduleNo, schedules]);

  const periodLine = `Financial year ${formData.comp_year ?? formData.COMP_YEAR ?? ''} · ${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!startDate || !endDate) {
      alert('Please select both start and end dates');
      return;
    }
    const sCode = String(startCode ?? '').trim();
    const eCode = String(endCode ?? '').trim();
    if (!sCode || !eCode) {
      alert('Please enter starting and ending account codes');
      return;
    }
    if (Number(sCode) > Number(eCode)) {
      alert('Starting code cannot be greater than ending code');
      return;
    }

    setLoading(true);
    try {
      const params = {
        comp_code: formData.comp_code || formData.COMP_CODE,
        comp_uid: formData.comp_uid || formData.COMP_UID,
        s_date: toOracleDate(startDate),
        e_date: toOracleDate(endDate),
        s_code: sCode,
        e_code: eCode,
        voucher_wise_total: voucherWiseTotal,
      };
      const sched = String(scheduleNo ?? '').trim();
      if (sched) params.schedule = sched;

      const { data } = await axios.get(`${apiBase}/api/complete-ledger-report`, {
        params,
        ...reqOpts,
      });
      const sections = data?.sections || [];
      if (!sections.length) {
        alert('No accounts found for the selected filters');
        return;
      }
      setReportPayload(data);
      setShowReport(true);
      setVoucherRows(null);
      setVoucherTitle('');
      setVoucherAccount(null);
    } catch (error) {
      alert('Error: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

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
    const ptypeNum = typeof vrType === 'number' ? vrType : parseInt(String(vrType ?? '').trim(), 10);
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

  const runLedgerVoucher = async (row, accountMeta) => {
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
          comp_code: formData.comp_code || formData.COMP_CODE,
          vr_type: String(vrType),
          vr_date: toOracleDate(ymd),
          vr_no: n,
          comp_uid: formData.comp_uid || formData.COMP_UID,
        },
        withCredentials: true,
        timeout: 30000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        alert('No voucher lines found for this voucher.');
        return;
      }
      setVoucherAccount(accountMeta);
      setVoucherRows(rows);
      setVoucherTitle(`${String(vrType)} ${n} · ${toDisplayDate(ymd)}`);
    } catch (error) {
      alert('Error: ' + formatLedgerVoucherApiError(error, apiBase));
    } finally {
      setLoading(false);
    }
  };

  const completeLedgerPdfMeta = () => ({
    formData,
    compLedgerHeader,
    companyName: String(formData.comp_name ?? formData.COMP_NAME ?? '').trim(),
    year: formData.comp_year ?? formData.COMP_YEAR,
    endDate: `${toDisplayDate(startDate)} – ${toDisplayDate(endDate)}`,
    scheduleNo: String(scheduleNo ?? '').trim(),
    scheduleLabel,
    startCode: String(startCode ?? '').trim(),
    endCode: String(endCode ?? '').trim(),
    accountCount: reportPayload?.account_count ?? 0,
  });

  const downloadPDF = async () => {
    await generatePDF('complete-ledger', reportPayload, completeLedgerPdfMeta());
  };

  const shareWhatsApp = async () => {
    const shareText = [
      `Complete Ledger — ${formData.comp_name}`,
      `${formData.comp_year} · ${toDisplayDate(startDate)} → ${toDisplayDate(endDate)}`,
      `Codes ${startCode}–${endCode}${scheduleNo ? ` · Schedule ${scheduleNo}` : ''}`,
      `${reportPayload?.account_count ?? 0} account(s)`,
    ].join('\n');
    await sharePdfWithWhatsApp('complete-ledger', reportPayload, completeLedgerPdfMeta(), shareText);
  };

  const closeReport = () => {
    setVoucherRows(null);
    setVoucherTitle('');
    setVoucherAccount(null);
    setShowReport(false);
    setReportPayload(null);
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

  if (showReport && reportPayload?.sections?.length) {
    if (voucherRows != null) {
      const account = voucherAccount || {};
      return (
        <div className={`slide slide-report ${slideClass}`.trim()}>
          <SessionInfoLine formData={formData} helpReportId="complete-ledger" />
          <div className="report-toolbar">
            <h2>Voucher entries</h2>
            <div className="toolbar-actions">
              <button type="button" className="btn btn-toolbar-back" onClick={() => setVoucherRows(null)}>
                ← Back to complete ledger
              </button>
              <button
                type="button"
                className="btn btn-excel"
                onClick={() => {
                  try {
                    const tag = String(voucherTitle || 'voucher').replace(/\s+/g, '_');
                    downloadExcelRows(voucherRows, 'Voucher', `${formData.comp_name ?? 'Company'}_${tag}`);
                  } catch (err) {
                    alert(String(err?.message || err));
                  }
                }}
              >
                📊 Excel
              </button>
            </div>
          </div>

          <LedgerReportHeader
            compHeader={compLedgerHeader}
            companyNameFallback={formData.comp_name ?? formData.COMP_NAME ?? ''}
            account={account}
            accountCodeFallback={account.code}
            periodLine={periodLine}
          />
          <p className="ledger-report-voucher-ref">
            Voucher: <strong>{voucherTitle}</strong>
          </p>

          <div className="report-display">
            <ReportTable data={voucherRows} type="ledger-voucher" />
          </div>

          <div className="button-group">
            <button type="button" onClick={() => setVoucherRows(null)} className="btn btn-secondary">
              ← Back to complete ledger
            </button>
            <button type="button" onClick={closeReport} className="btn btn-secondary">
              ← Back
            </button>
          </div>
          {saleBillModal}
        </div>
      );
    }

    const sections = reportPayload.sections;
    return (
      <div className={`slide slide-report complete-ledger-report ${slideClass}`.trim()}>
        <SessionInfoLine formData={formData} helpReportId="complete-ledger" />
        <div className="report-toolbar">
          <h2>Complete Ledger</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={closeReport}>
              ← Back
            </button>
            <button type="button" onClick={() => downloadPDF().catch((e) => alert(e?.message || String(e)))} className="btn btn-export">
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  const flat = sections.flatMap((sec) =>
                    (sec.rows || []).map((r) => ({
                      ...r,
                      ACCOUNT_CODE: sec.code,
                      ACCOUNT_NAME: sec.name,
                    }))
                  );
                  downloadExcelRows(flat, 'CompleteLedger', `${formData.comp_name ?? 'Company'}_Complete_Ledger`);
                } catch (err) {
                  alert(String(err?.message || err));
                }
              }}
            >
              📊 Excel
            </button>
            <button type="button" onClick={() => shareWhatsApp().catch((e) => alert(e?.message || String(e)))} className="btn btn-whatsapp">
              💬 WhatsApp
            </button>
          </div>
        </div>

        <p className="complete-ledger-report-meta">
          {periodLine}
          {scheduleNo ? ` · Schedule ${scheduleNo}${scheduleLabel ? ` (${scheduleLabel})` : ''}` : ''}
          {` · Codes ${startCode}–${endCode} · ${sections.length} account(s)`}
          {` · Voucher Wise Total: ${voucherWiseTotal}`}
        </p>

        <div className="complete-ledger-report-scroll">
          {sections.map((sec, idx) => {
            const account = { CODE: sec.code, NAME: sec.name, CITY: sec.city };
            return (
              <section key={String(sec.code)} className={`complete-ledger-section${idx > 0 ? ' complete-ledger-section--break' : ''}`}>
                <LedgerReportHeader
                  compHeader={compLedgerHeader}
                  companyNameFallback={formData.comp_name ?? formData.COMP_NAME ?? ''}
                  account={account}
                  accountCodeFallback={sec.code}
                  periodLine={periodLine}
                  hint="Tap a row for voucher detail; sale bill print opens where mapping is available."
                />
                <div className="report-display">
                  <ReportTable
                    data={sec.rows}
                    type="ledger"
                    onVoucherClick={(row) => runLedgerVoucher(row, { code: sec.code, name: sec.name, CITY: sec.city })}
                    onLedgerSaleBillClick={openLedgerSaleBill}
                  />
                </div>
              </section>
            );
          })}
        </div>

        <div className="button-group complete-ledger-report-actions">
          <button type="button" onClick={closeReport} className="btn btn-secondary">
            ← Back
          </button>
        </div>
        {saleBillModal}
      </div>
    );
  }

  const onFormFieldEnter = (e) => advanceReportFormOnEnter(e, formRef.current);
  const onDateEnter = (e) => handleReportDateEnter(e, formRef.current);

  return (
    <div className={`slide complete-ledger-entry ${slideClass}`.trim()}>
      <div className="report-toolbar report-toolbar--ledger-form">
        <h2>Complete Ledger</h2>
        <div className="toolbar-actions">
          <button type="button" onClick={onPrev} className="btn btn-secondary btn-toolbar-back">
            ← Back
          </button>
          <button
            type="submit"
            form="complete-ledger-form"
            className="btn btn-primary btn-toolbar-run"
            disabled={loading}
          >
            {loading ? 'Running…' : 'Run report'}
          </button>
        </div>
      </div>

      <SessionInfoLine formData={formData} helpReportId="complete-ledger">
        <span className="compdet-date-hint">
          Prints one ledger per account with period transactions (Dr or Cr &ne; 0). Leave schedule blank for all schedules.
        </span>
      </SessionInfoLine>

      <form
        id="complete-ledger-form"
        ref={formRef}
        className="report-form report-form--complete-ledger"
        autoComplete="off"
        onSubmit={handleSubmit}
        onKeyDown={onFormFieldEnter}
      >
        <section className="complete-ledger-form-section" aria-labelledby="cl-section-dates">
          <h3 id="cl-section-dates" className="complete-ledger-form-section__title">
            Date range
          </h3>
          <div className="form-row-broker complete-ledger-form-dates">
            <div className="form-group">
              <label htmlFor="cl-start-date">Starting date</label>
              <input
                id="cl-start-date"
                ref={startDateRef}
                type="date"
                lang="en-GB"
                className="form-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                onKeyDown={onDateEnter}
                onFocus={() => scrollReportFieldIntoView(startDateRef)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="cl-end-date">Ending date</label>
              <input
                id="cl-end-date"
                ref={endDateRef}
                type="date"
                lang="en-GB"
                className="form-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                onKeyDown={onDateEnter}
                onFocus={() => scrollReportFieldIntoView(endDateRef)}
                required
              />
            </div>
          </div>
        </section>

        <section className="complete-ledger-form-section" aria-labelledby="cl-section-filter">
          <h3 id="cl-section-filter" className="complete-ledger-form-section__title">
            Schedule &amp; account codes
          </h3>
          <div className="form-group">
            <label htmlFor="cl-schedule">Specific schedule no.</label>
            <input
              id="cl-schedule"
              ref={scheduleRef}
              list="cl-schedule-list"
              className="form-input"
              value={scheduleNo}
              onChange={(e) => setScheduleNo(e.target.value)}
              onFocus={() => scrollReportFieldIntoView(scheduleRef)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  focusNextReportField(formRef.current, e.target);
                }
              }}
              placeholder="Optional — pick from list or type schedule no."
              autoComplete="off"
            />
            <datalist id="cl-schedule-list">
              {schedules.map((s) => (
                <option key={String(s.NO ?? s.no)} value={String(s.NO ?? s.no)}>
                  {s.NAME ?? s.name}
                </option>
              ))}
            </datalist>
            {scheduleLabel ? (
              <p className="complete-ledger-schedule-pick">
                Selected schedule: <strong>{scheduleLabel}</strong> ({scheduleNo})
              </p>
            ) : (
              <p className="complete-ledger-field-note">
                Help lists schedule name and no. from SCHEDULE for this company. Blank = all schedules.
              </p>
            )}
          </div>

          <div className="form-row-broker complete-ledger-form-codes">
            <div className="form-group">
              <label htmlFor="cl-start-code">Starting code</label>
              <input
                id="cl-start-code"
                ref={startCodeRef}
                type="number"
                min="0"
                className="form-input"
                value={startCode}
                onChange={(e) => setStartCode(e.target.value)}
                onFocus={() => scrollReportFieldIntoView(startCodeRef)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="cl-end-code">Ending code</label>
              <input
                id="cl-end-code"
                ref={endCodeRef}
                type="number"
                min="0"
                className="form-input"
                value={endCode}
                onChange={(e) => setEndCode(e.target.value)}
                onFocus={() => scrollReportFieldIntoView(endCodeRef)}
                required
              />
            </div>
          </div>
        </section>

        <section className="complete-ledger-form-section complete-ledger-form-section--last" aria-labelledby="cl-section-options">
          <h3 id="cl-section-options" className="complete-ledger-form-section__title">
            Options
          </h3>
          <div className="form-group complete-ledger-form-vwt">
            <label htmlFor="cl-vwt">Voucher wise total</label>
            <select
              id="cl-vwt"
              className="form-input form-select"
              value={voucherWiseTotal}
              onChange={(e) => setVoucherWiseTotal(e.target.value)}
            >
              <option value="N">No — show each ledger line</option>
              <option value="Y">Yes — one total per voucher</option>
            </select>
          </div>
        </section>
      </form>

      <div className="form-actions form-actions--complete-ledger">
        <button type="button" onClick={onReset} className="btn btn-secondary">
          Reset session
        </button>
      </div>
    </div>
  );
}
