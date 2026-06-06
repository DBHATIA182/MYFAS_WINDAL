import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import SessionInfoLine, { SessionLineText } from '../components/SessionInfoLine';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import PurchaseBillPrintModal from '../components/PurchaseBillPrintModal';
import { downloadExcelRows } from '../utils/excelExport';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { buildReportHtml, generatePDF } from '../utils/pdfgenerator';
import { printHtmlDocument } from '../utils/openPrintPreviewWindow';

const SALE_LIST_NUMTYPE_TO_PRINT = {
  1: 'SL',
  2: 'CH',
  3: 'SL',
  6: 'SE',
  8: 'CN',
  9: 'RC',
};

const REPORT_CFG = {
  sales: {
    apiPrefix: 'state-wise-sales',
    helpId: 'state-wise-sales',
    pdfType: 'state-wise-sales',
    title: 'State Wise Sales',
    detailHint: 'Click a row to open the sale bill.',
    summaryHint: 'Click a row to open all sale bills for that state and Gst%.',
    emptyMsg: 'No sales for this period / state.',
    excelSummary: 'StateWiseSales',
    excelDetail: 'StateWiseSalesDetail',
  },
  purchase: {
    apiPrefix: 'state-wise-purchase',
    helpId: 'state-wise-purchase',
    pdfType: 'state-wise-purchase',
    title: 'State Wise Purchase',
    detailHint: 'Click a row to open the purchase bill.',
    summaryHint: 'Click a row to open all purchase bills for that state and Gst%.',
    emptyMsg: 'No purchases for this period / state.',
    excelSummary: 'StateWisePurchase',
    excelDetail: 'StateWisePurchaseDetail',
  },
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v) {
  if (typeof v === 'number') {
    return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  return v == null ? '' : String(v);
}

function fmtCell(col, val) {
  if (typeof val === 'number') return fmt(val);
  if (String(col).toUpperCase().includes('DATE')) return toDisplayDate(String(val || ''));
  return val == null ? '' : String(val);
}

const SUMMARY_COLUMNS = ['STATE_CODE', 'STATE', 'GST_PER', 'QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'];
const TOTAL_COLUMNS = ['QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'];
const NUMERIC_COLUMNS = new Set([...TOTAL_COLUMNS, 'GST_PER']);

function isNumericColumn(col) {
  return NUMERIC_COLUMNS.has(col);
}

const COLUMN_LABELS = {
  STATE_CODE: 'State Code',
  STATE: 'State',
  GST_PER: 'Gst%',
  QNTY: 'Qty.',
  WEIGHT: 'Weight',
  TAXABLE: 'Taxable',
  CGST_AMT: 'Cgst Amt.',
  SGST_AMT: 'Sgst Amt.',
  IGST_AMT: 'Igst Amt.',
  R_DATE: 'R Date',
  R_NO: 'R No',
  BILL_DATE: 'Bill Date',
  BILL_NO: 'Bill No',
  B_TYPE: 'B Type',
  TYPE: 'Type',
  CODE: 'Code',
  NAME: 'Name',
  CITY: 'City',
};

function summaryExportRow(row) {
  return {
    'State Code': row.STATE_CODE ?? '',
    State: row.STATE ?? '',
    'Gst%': row.GST_PER ?? '',
    'Qty.': row.QNTY ?? '',
    Weight: row.WEIGHT ?? '',
    Taxable: row.TAXABLE ?? '',
    'Cgst Amt.': row.CGST_AMT ?? '',
    'Sgst Amt.': row.SGST_AMT ?? '',
    'Igst Amt.': row.IGST_AMT ?? '',
  };
}

function grandTotalExportRow(totals) {
  return {
    'State Code': '',
    State: 'GRAND TOTAL',
    'Gst%': '',
    'Qty.': totals.QNTY ?? 0,
    Weight: totals.WEIGHT ?? 0,
    Taxable: totals.TAXABLE ?? 0,
    'Cgst Amt.': totals.CGST_AMT ?? 0,
    'Sgst Amt.': totals.SGST_AMT ?? 0,
    'Igst Amt.': totals.IGST_AMT ?? 0,
  };
}

function ExportToolbar({ pdfBusy, onPdf, onPrint, onExcel, printDisabled, excelDisabled }) {
  return (
    <>
      <button type="button" className="btn btn-export" disabled={pdfBusy || excelDisabled} onClick={onPdf}>
        {pdfBusy ? 'Preparing PDF…' : 'Pdf'}
      </button>
      <button type="button" className="btn btn-secondary" disabled={printDisabled} onClick={onPrint}>
        Print
      </button>
      <button type="button" className="btn btn-excel" disabled={excelDisabled} onClick={onExcel}>
        📊 Excel
      </button>
    </>
  );
}

function GrandTotalRow({ totals, labelColSpan = 3 }) {
  return (
    <>
      <hr className="sale-bill-print-footer-rule" />
      <table className="report-table report-table--grand-total report-table--state-wise-sales">
        <tbody>
          <tr className="stock-sum-grand">
            <td colSpan={labelColSpan}>
              <strong>GRAND TOTAL</strong>
            </td>
            {TOTAL_COLUMNS.map((c) => (
              <td key={c} className="text-right">
                <strong>{fmt(totals[c])}</strong>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="report-info state-wise-sales-grand-summary">
        <p>
          <strong>Grand Total:</strong>{' '}
          {TOTAL_COLUMNS.map((c) => `${COLUMN_LABELS[c] || c}: ${fmt(totals[c])}`).join(' · ')}
        </p>
      </div>
    </>
  );
}

function purchaseHeadName(typeRaw) {
  const t = String(typeRaw ?? '').trim().toUpperCase();
  if (t === 'DN') return 'DEBIT NOTE';
  if (t === 'DX') return 'DEBIT NOTE OTHERS';
  if (t === 'CX') return 'CREDIT NOTE OTHERS';
  if (t === 'EV') return 'PURCHASE BILL OTHERS';
  return 'PURCHASE BILL';
}

/** State Wise Sales / Purchase — summary by party state (MASTER) + GST%. */
export default function SlideStateWiseReport({ apiBase, formData, onPrev, onReset, reportMode = 'sales', slideClass = 'slide-35-state-wise' }) {
  const cfg = REPORT_CFG[reportMode] || REPORT_CFG.sales;
  const isPurchase = reportMode === 'purchase';

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';

  const [sDate, setSDate] = useState('');
  const [eDate, setEDate] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [stateOptions, setStateOptions] = useState([]);
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState('form');
  const [detailRows, setDetailRows] = useState([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  const slideCls = `slide slide-report ${slideClass}`;

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setSDate(s);
    if (e) setEDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    axios
      .get(`${apiBase}/api/${cfg.apiPrefix}/states`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
      })
      .then((r) => setStateOptions(Array.isArray(r.data) ? r.data : []))
      .catch(() => setStateOptions([]));
  }, [apiBase, cfg.apiPrefix, compCode, compUid]);

  const totals = useMemo(() => {
    const out = {};
    TOTAL_COLUMNS.forEach((c) => {
      out[c] = (rows || []).reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    return out;
  }, [rows]);

  const detailColumns =
    detailRows.length > 0 ? Object.keys(detailRows[0]).filter((k) => !k.startsWith('_')) : [];
  const detailTotals = useMemo(() => {
    const out = {};
    TOTAL_COLUMNS.forEach((c) => {
      if (detailColumns.includes(c)) out[c] = detailRows.reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    return out;
  }, [detailRows, detailColumns]);

  const periodLabel = `${toDisplayDate(sDate)} – ${toDisplayDate(eDate)}`;
  const stateFilterLabel = stateCode
    ? stateOptions.find((s) => String(s.STATE_CODE ?? s.state_code ?? '') === stateCode)?.STATE ||
      stateOptions.find((s) => String(s.STATE_CODE ?? s.state_code ?? '') === stateCode)?.state ||
      stateCode
    : 'All states';

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      year: String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim(),
      period: periodLabel,
      reportTitle: cfg.title,
      stateFilter: stateFilterLabel,
    }),
    [compName, formData.comp_year, formData.COMP_YEAR, periodLabel, stateFilterLabel, cfg.title]
  );

  const summaryExportRows = useMemo(() => {
    if (!rows?.length) return [];
    return [...rows.map(summaryExportRow), grandTotalExportRow(totals)];
  }, [rows, totals]);

  const runPdfAction = async (fn) => {
    setPdfBusy(true);
    try {
      await fn();
    } finally {
      setPdfBusy(false);
    }
  };

  const exportSummaryPdf = () =>
    runPdfAction(() => generatePDF(cfg.pdfType, { rows: summaryExportRows }, pdfMeta)).catch((err) =>
      alert(err?.message || String(err))
    );

  const exportSummaryPrint = () => {
    if (!summaryExportRows.length) {
      alert('No rows to print.');
      return;
    }
    const html = buildReportHtml(cfg.pdfType, { rows: summaryExportRows }, pdfMeta);
    printHtmlDocument(html, { title: cfg.title });
  };

  const exportDetailPdf = () =>
    runPdfAction(() =>
      generatePDF(
        cfg.pdfType,
        {
          rows: detailRows.map((row) => {
            const out = {};
            detailColumns.forEach((c) => {
              out[COLUMN_LABELS[c] || c] = row[c];
            });
            return out;
          }),
        },
        { ...pdfMeta, reportTitle: `${cfg.title} — ${detailTitle}` }
      )
    ).catch((err) => alert(err?.message || String(err)));

  const exportDetailPrint = () => {
    if (!detailRows.length) return;
    const rowsForPrint = detailRows.map((row) => {
      const out = {};
      detailColumns.forEach((c) => {
        out[COLUMN_LABELS[c] || c] = row[c];
      });
      return out;
    });
    const html = buildReportHtml(cfg.pdfType, { rows: rowsForPrint }, { ...pdfMeta, reportTitle: `${cfg.title} — ${detailTitle}` });
    printHtmlDocument(html, { title: `${cfg.title} Detail` });
  };

  const runReport = async (e) => {
    e.preventDefault();
    const s = toOracleDate(sDate);
    const ed = toOracleDate(eDate);
    if (!s || !ed) {
      alert('Please select starting and ending date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/${cfg.apiPrefix}`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          state_code: stateCode || undefined,
        },
        withCredentials: true,
        timeout: 180000,
      });
      setRows(Array.isArray(data?.rows) ? data.rows : []);
      setScreen('main');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run report');
    } finally {
      setLoading(false);
    }
  };

  const openStateDetail = async (row) => {
    const s = toOracleDate(sDate);
    const ed = toOracleDate(eDate);
    if (!s || !ed) return;
    setDetailLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/${cfg.apiPrefix}/detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          state_code: row.STATE_CODE,
          state: row.STATE,
          gst_per: row.GST_PER,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setDetailTitle(`${row.STATE_CODE || '—'} · ${row.STATE || '—'} · Gst ${fmt(row.GST_PER)}%`);
      setDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setScreen('detail');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const exportExcel = () => {
    if (!summaryExportRows.length) {
      alert('No rows to export.');
      return;
    }
    downloadExcelRows(summaryExportRows, cfg.excelSummary, `${compName}_${cfg.excelSummary}`, { autoOpen: true });
  };

  const exportDetailExcel = () => {
    if (!detailRows.length) return;
    downloadExcelRows(detailRows, cfg.excelDetail, `${compName}_${cfg.excelDetail}`, { autoOpen: true });
  };

  const openSaleBill = (row) => {
    const typRaw = row.TYPE ?? row.type;
    const typU = String(typRaw ?? '')
      .trim()
      .toUpperCase();
    const numType = typeof typRaw === 'number' ? typRaw : parseInt(String(typRaw ?? '').trim(), 10);
    let printType = typU;
    if (Number.isFinite(numType) && numType >= 1 && numType <= 9) {
      const mapped = SALE_LIST_NUMTYPE_TO_PRINT[numType];
      if (mapped) printType = mapped;
      else if (numType === 4 || numType === 7) printType = String(numType);
      else {
        alert('Print preview is not mapped for this document type number.');
        return;
      }
    } else if (typU === 'GN') {
      printType = 'CN';
    } else if (!['SL', 'SE', 'CN', 'CH', 'RC', 'CX'].includes(typU)) {
      alert('Print preview supports SL, SE, CN, GN, CH, RC, CX, or numeric TYPE 1–9.');
      return;
    }
    const billNo = row.BILL_NO ?? row.bill_no;
    const billDt = row.BILL_DATE ?? row.bill_date;
    const bType = row.B_TYPE ?? row.b_type ?? ' ';
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    if (typRaw == null || typRaw === '' || billNo == null || !oracleDt) {
      alert('Cannot open bill: missing type, bill no, or date.');
      return;
    }
    const oracleExact =
      typeof typRaw === 'number'
        ? typRaw
        : Number.isFinite(numType) && numType >= 1 && numType <= 9
          ? numType
          : null;
    setBillPrintParams({
      type: printType,
      oracleTypeNum: oracleExact ?? undefined,
      billNo: String(billNo).trim(),
      bType: String(bType).trim() || ' ',
      oracleDt,
      compYear: String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim(),
      label: `Sale bill — ${typU || typRaw} / ${billNo} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const openPurchaseBill = (row) => {
    const typ = row.TYPE ?? row.type;
    const rNo = row.R_NO ?? row.r_no;
    const rDt = row.R_DATE ?? row.r_date;
    const ymd = toInputDateString(rDt);
    const oracleDt = toOracleDate(ymd);
    if (!typ || rNo == null || rNo === '' || !oracleDt) {
      alert('Cannot open bill: missing type, R no, or R date.');
      return;
    }
    setBillPrintParams({
      type: String(typ).trim(),
      rNo: String(rNo).trim(),
      oracleDt,
      label: `${purchaseHeadName(typ)} — ${String(typ).trim()} / ${String(rNo).trim()} / ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const openBill = isPurchase ? openPurchaseBill : openSaleBill;

  const billPrintModal = isPurchase ? (
    <PurchaseBillPrintModal
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
  ) : (
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
  );

  const formIdPrefix = isPurchase ? 'swp' : 'sws';

  if (screen === 'detail') {
    return (
      <>
        {billPrintModal}
        <div className={`${slideCls} slide-report--mobile-toolbar-row`}>
          <SessionInfoLine formData={formData} helpReportId={cfg.helpId} />
          <div className="report-toolbar">
            <h2>{cfg.title} — Detail</h2>
            <div className="toolbar-actions">
              <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('main')}>
                ← Back
              </button>
              <ExportToolbar
                pdfBusy={pdfBusy}
                onPdf={() => exportDetailPdf()}
                onPrint={exportDetailPrint}
                onExcel={exportDetailExcel}
                printDisabled={!detailRows.length}
                excelDisabled={!detailRows.length}
              />
            </div>
          </div>
          <div className="report-info">
            <p>
              <strong>Dates</strong> {periodLabel} · <strong>State filter</strong> {stateFilterLabel}
            </p>
            <p>{detailTitle}</p>
            <p className="sale-bill-section__hint">{cfg.detailHint}</p>
          </div>
          <div className="report-display state-wise-sales-report">
            <div className="table-responsive table-responsive--hsn-sales">
              <table className="report-table report-table--click-rows report-table--state-wise-sales">
                <thead>
                  <tr>
                    {detailColumns.map((c) => (
                      <th key={c} className={isNumericColumn(c) ? 'text-right' : ''}>
                        {COLUMN_LABELS[c] || c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detailRows.map((row, i) => (
                    <tr
                      key={i}
                      className="sale-list-row-clickable account-master-table__row"
                      onClick={() => openBill(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openBill(row);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {detailColumns.map((c) => (
                        <td key={c} className={isNumericColumn(c) ? 'text-right' : ''}>
                          {fmtCell(c, row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detailRows.length > 0 ? (
              <>
                <hr className="sale-bill-print-footer-rule" />
                <div className="report-info state-wise-sales-grand-summary">
                  <p>
                    <strong>GRAND TOTAL</strong> ·{' '}
                    {TOTAL_COLUMNS.filter((c) => detailColumns.includes(c))
                      .map((c) => `${COLUMN_LABELS[c] || c}: ${fmt(detailTotals[c])}`)
                      .join(' · ')}
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  if (rows) {
    return (
      <>
        {billPrintModal}
        <div className={`${slideCls} slide-report--mobile-toolbar-row`}>
          <SessionInfoLine formData={formData} helpReportId={cfg.helpId} />
          <div className="report-toolbar">
            <h2>{cfg.title}</h2>
            <div className="toolbar-actions">
              <button type="button" className="btn btn-toolbar-back" onClick={() => setRows(null)}>
                ← Back
              </button>
              <ExportToolbar
                pdfBusy={pdfBusy}
                onPdf={() => exportSummaryPdf()}
                onPrint={exportSummaryPrint}
                onExcel={exportExcel}
                printDisabled={!summaryExportRows.length}
                excelDisabled={!summaryExportRows.length}
              />
            </div>
          </div>
          <div className="report-info">
            <p>
              <strong>Dates</strong> {periodLabel} · <strong>State</strong> {stateFilterLabel}
            </p>
            <p>
              <SessionLineText formData={formData} />
            </p>
            <p className="sale-bill-section__hint">{cfg.summaryHint}</p>
          </div>
          {error ? <p className="form-api-error">{error}</p> : null}
          {detailLoading ? <p className="loading-msg">Loading detail…</p> : null}
          <div className="report-display state-wise-sales-report">
            <div className="table-responsive table-responsive--hsn-sales">
              <table className="report-table report-table--click-rows report-table--state-wise-sales">
                <thead>
                  <tr>
                    {SUMMARY_COLUMNS.map((c) => (
                      <th key={c} className={isNumericColumn(c) ? 'text-right' : ''}>
                        {COLUMN_LABELS[c] || c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={SUMMARY_COLUMNS.length} className="account-master-table__empty">
                        {cfg.emptyMsg}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => (
                      <tr
                        key={`${row.STATE_CODE}-${row.STATE}-${row.GST_PER}-${i}`}
                        className="account-master-table__row"
                        onClick={() => void openStateDetail(row)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void openStateDetail(row);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        {SUMMARY_COLUMNS.map((c) => (
                          <td
                            key={c}
                            className={isNumericColumn(c) ? 'text-right' : ''}
                            style={c === 'STATE' ? { maxWidth: '14rem' } : undefined}
                          >
                            {fmtCell(c, row[c])}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {rows.length > 0 ? <GrandTotalRow totals={totals} labelColSpan={3} /> : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {billPrintModal}
      <div className={slideCls}>
        <SessionInfoLine formData={formData} helpReportId={cfg.helpId} />
        <div className="report-toolbar">
          <h2>{cfg.title}</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={onPrev}>
              ← Back
            </button>
          </div>
        </div>
        <form className="report-form" onSubmit={runReport}>
          <div className="form-row-broker form-row-broker--dates">
            <div className="form-group">
              <label htmlFor={`${formIdPrefix}-start`}>Starting date</label>
              <input
                id={`${formIdPrefix}-start`}
                type="date"
                lang="en-GB"
                className="form-input"
                value={sDate}
                onChange={(e) => setSDate(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor={`${formIdPrefix}-end`}>Ending date</label>
              <input
                id={`${formIdPrefix}-end`}
                type="date"
                lang="en-GB"
                className="form-input"
                value={eDate}
                onChange={(e) => setEDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor={`${formIdPrefix}-state`}>Specific state</label>
            <select
              id={`${formIdPrefix}-state`}
              className="form-input"
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
            >
              <option value="">All states</option>
              {stateOptions.map((s) => {
                const code = String(s.STATE_CODE ?? s.state_code ?? '').trim();
                const name = String(s.STATE ?? s.state ?? '').trim();
                return (
                  <option key={code || name} value={code}>
                    {code ? `${code} — ${name}` : name}
                  </option>
                );
              })}
            </select>
          </div>
          {error ? <p className="form-api-error">{error}</p> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Running…' : 'Run'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onReset}>
              Home
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
