import html2pdf from 'html2pdf.js';
import { jsPDF } from 'jspdf';
import { formatLedgerDateDisplay } from './dateFormat';
import { buildBrokerOsDisplayRows, brokerOsBCodeOf, brokerOsCrFirstFromSchedule } from './brokerOsDisplay';
import { buildSaleListDisplayRows, saleListMeas, isSaleListCn } from './saleListDisplay';
import { rupeesToWords } from './rupeesInWords';
import { saleBillStatusUnitLabel } from './saleBillDocTitle';
import { showSaleBillLessBrokerage } from './saleBillBroker';
import {
  rowFieldCI,
  rowFieldAny,
  saleBillEinvoiceText,
  stripLeadingRegistrationJunk,
  saleBillTaxPercentForHeader,
} from './rowFieldCI';
import { ageingCurBalDisplay } from './ageingDisplay';
import {
  sortTrialBalanceRows,
  trialBalanceRowKind,
  trialBalanceRowLabel,
  computeTrialTopSummary,
  findTrialGrandRow,
} from './trialBalanceSort';

/** Keep PDF amount on one line — shrink font to fit column (avoids decimal wrapping on mobile). */
function pdfFitAmountCell(doc, text, maxWidthMm, baseFontSize, fontStyle, minFontSize = 4.5) {
  const raw = String(text ?? '').trim() || '—';
  let fs = baseFontSize;
  doc.setFont('helvetica', fontStyle);
  while (fs > minFontSize) {
    doc.setFontSize(fs);
    if (doc.getTextWidth(raw) <= maxWidthMm) return { text: raw, fontSize: fs, lines: [raw] };
    fs -= 0.25;
  }
  doc.setFontSize(minFontSize);
  let fitted = raw;
  if (doc.getTextWidth(fitted) > maxWidthMm) {
    while (fitted.length > 1 && doc.getTextWidth(`${fitted}…`) > maxWidthMm) fitted = fitted.slice(0, -1);
    fitted = `${fitted}…`;
  }
  return { text: fitted, fontSize: minFontSize, lines: [fitted] };
}

function safeFilenamePart(name) {
  return String(name || 'report').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ledger PDF header: name · city · gst · pan (from MASTER row or first ledger line). */
export function buildLedgerPartyLine(row) {
  if (!row) return '';
  const name = String(row.NAME ?? row.name ?? '').trim();
  const city = String(row.CITY ?? row.city ?? '').trim();
  const gst = String(row.GST_NO ?? row.gst_no ?? '').trim();
  const pan = String(row.PAN ?? row.pan ?? '').trim();
  const parts = [];
  if (name) parts.push(name);
  if (city) parts.push(city);
  if (gst) parts.push(gst);
  if (pan) parts.push(pan);
  return parts.join(' · ');
}

/** Metadata for ledger account statement PDF (company + account address blocks). */
export function buildLedgerStatementPdfMetadata({
  formData,
  compLedgerHeader,
  account,
  ledgerFirstRow,
  year,
  endDate,
  accountNameOverride,
  accountCodeOverride,
}) {
  const fd = formData || {};
  const ch = compLedgerHeader && typeof compLedgerHeader === 'object' ? compLedgerHeader : {};
  const acc = account || ledgerFirstRow || {};
  const nameO =
    accountNameOverride != null && String(accountNameOverride).trim() !== ''
      ? String(accountNameOverride).trim()
      : rowFieldAny(acc, ['NAME', 'name']);
  const codeO =
    accountCodeOverride != null && String(accountCodeOverride).trim() !== ''
      ? String(accountCodeOverride).trim()
      : rowFieldAny(acc, ['CODE', 'code']);
  const companyName =
    rowFieldAny(ch, ['COMP_NAME', 'comp_name']) || String(fd.comp_name ?? fd.COMP_NAME ?? '').trim();
  return {
    companyName,
    year: year ?? fd.comp_year ?? fd.COMP_YEAR ?? '',
    accountName: nameO,
    accountCode: codeO,
    endDate,
    companyAdd1: rowFieldAny(ch, ['COMP_ADD1', 'comp_add1']),
    companyAdd2: rowFieldAny(ch, ['COMP_ADD2', 'comp_add2']),
    companyGst: rowFieldAny(ch, ['GST_NO', 'gst_no', 'comp_gst', 'gstin']),
    accountAdd1: rowFieldAny(acc, ['ADD1', 'add1']),
    accountAdd2: rowFieldAny(acc, ['ADD2', 'add2']),
    accountCity: rowFieldAny(acc, ['CITY', 'city']),
    accountGst: rowFieldAny(acc, ['GST_NO', 'gst_no']),
    accountPan: rowFieldAny(acc, ['PAN', 'pan']),
    accountTel: rowFieldAny(acc, ['TEL_NO_O', 'tel_no_o', 'TEL_NOO', 'tel_noo']),
  };
}

function formatAmtPdf(n) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQtyPdf(n) {
  const v = parseFloat(n);
  if (Number.isNaN(v)) return '0';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function sbCell(row, u, l) {
  if (!row) return '';
  const x = row[u] ?? row[l];
  return x != null && x !== '' ? String(x) : '';
}

function normalizePrintImageSrc(raw, apiBase = '') {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (!s) return '';
  if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s) || /^blob:/i.test(s)) return s;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 24) {
    return `data:image/png;base64,${s.replace(/\s+/g, '')}`;
  }
  if (/[./\\]/.test(s) || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(s)) {
    return `${apiBase || ''}/api/print-image?path=${encodeURIComponent(s)}`;
  }
  return '';
}

function cleanPrintText(raw) {
  if (raw == null) return '';
  return String(raw).trim();
}

/** Shared PDF shell (trial balance + ledger) */
const PDF_REPORT_STYLES = `
        .report-doc { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #1a202c; font-size: 9px; line-height: 1.35; }
        .report-topbar {
          text-align: center;
          padding: 10px 12px 12px;
          border: 2px solid #1e3a5f;
          background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
          margin-bottom: 12px;
        }
        .report-topbar .kicker { font-size: 8px; letter-spacing: 0.2em; color: #475569; font-weight: 700; margin-bottom: 4px; }
        .report-topbar h1 {
          margin: 0 0 10px 0;
          font-size: 17px;
          font-weight: 800;
          color: #1e3a5f;
          letter-spacing: 0.06em;
          border-bottom: 2px solid #1e3a5f;
          padding-bottom: 8px;
        }
        .report-topbar .company { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 10px; }
        .report-grid {
          width: 100%;
          border-collapse: collapse;
          margin: 0 auto;
          max-width: 100%;
        }
        .report-grid td {
          border: 1px solid #94a3b8;
          padding: 5px 8px;
          vertical-align: middle;
        }
        .report-grid td.lbl {
          background: #cbd5e1;
          font-weight: 700;
          color: #1e293b;
          width: 18%;
          white-space: nowrap;
        }
        .report-grid td.val { background: #fff; font-weight: 600; }
        .report-period { font-size: 9px; color: #334155; margin-top: 8px; padding-top: 6px; border-top: 1px solid #94a3b8; }
        .tb-pdf-summary-row {
          display: flex;
          gap: 8px;
          margin-bottom: 10px;
          width: 100%;
          box-sizing: border-box;
        }
        .tb-pdf-summary-box {
          flex: 1;
          min-width: 0;
          border: 1.5px solid #94a3b8;
          border-radius: 6px;
          padding: 6px 8px;
          background: #fff;
        }
        .tb-pdf-summary-box--debit { border-color: #2f855a; }
        .tb-pdf-summary-box--credit { border-color: #c53030; }
        .tb-pdf-summary-label {
          font-size: 7px;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.06em;
          margin-bottom: 3px;
        }
        .tb-pdf-summary-box--debit .tb-pdf-summary-amt { color: #2f855a; font-weight: 800; font-size: 9px; white-space: nowrap; }
        .tb-pdf-summary-box--credit .tb-pdf-summary-amt { color: #c53030; font-weight: 800; font-size: 9px; white-space: nowrap; }
        table.table-report--trial-pdf .col-sch { width: 5%; }
        table.table-report--trial-pdf .col-name { width: 22%; word-break: break-word; font-size: 6.5px; }
        table.table-report--trial-pdf .col-code { width: 6%; font-size: 6.5px; }
        table.table-report--trial-pdf .col-city { width: 8%; font-size: 6px; word-break: break-word; }
        table.table-report--trial-pdf-full td.amount,
        table.table-report--trial-pdf-full th.amount {
          width: 11%;
          white-space: nowrap;
          font-size: 5.5px;
          letter-spacing: -0.04em;
          padding-left: 1px;
          padding-right: 1px;
        }
        table.table-report--trial-pdf-full th.amount:last-child,
        table.table-report--trial-pdf-full td.amount:last-child {
          width: 12%;
        }
        table.table-report--trial-pdf td.amount,
        table.table-report--trial-pdf th.amount {
          white-space: nowrap;
          font-size: 6px;
          letter-spacing: -0.03em;
        }
        table.table-report {
          width: 100%;
          border-collapse: collapse;
          border: 2px solid #1e293b;
          margin: 0;
          table-layout: fixed;
          page-break-inside: auto;
          break-inside: auto;
        }
        table.table-report thead { display: table-header-group; }
        table.table-report tfoot { display: table-footer-group; }
        table.table-report tbody { display: table-row-group; }
        table.table-report thead th {
          background: #1e293b;
          color: #fff;
          font-size: 8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 7px 5px;
          border: 1px solid #0f172a;
          text-align: left;
        }
        table.table-report thead th.amount { text-align: right; }
        table.table-report tbody td {
          border: 1px solid #64748b;
          padding: 4px 5px;
          vertical-align: top;
          font-size: 8.5px;
          page-break-inside: auto;
          break-inside: auto;
        }
        table.table-report tbody tr {
          page-break-inside: auto;
          break-inside: auto;
        }
        table.table-report tbody tr:nth-child(odd) { background: #ffffff; }
        table.table-report tbody tr:nth-child(even) { background: #f1f5f9; }
        table.table-report tbody tr.subtotal-row td {
          background: #e0e7ff !important;
          font-weight: 700;
          color: #1e3a8a;
          border-top: 2px solid #6366f1;
          border-bottom: 1px solid #6366f1;
        }
        table.table-report tbody tr.broker-os-pdf-broker-total td {
          background: #3730a3 !important;
          color: #eef2ff !important;
          font-weight: 700;
          border-top: 2px solid #4f46e5;
        }
        table.table-report tbody tr.broker-os-pdf-bill-total td {
          background: #ecfeff !important;
          color: #0f172a !important;
          font-weight: 700;
          border-top: 1px solid #5eead4;
          border-bottom: 1px solid #99f6e4;
        }
        table.table-report tbody tr.op-row { background: #e0f2fe !important; }
        table.table-report tbody tr.sale-list-pdf-cn td {
          background: #ffedd5 !important;
          color: #7c2d12;
        }
        table.table-report tbody tr.sale-list-pdf-cn td:first-child {
          font-weight: 800;
          color: #c2410c;
        }
        table.table-report tbody tr.sale-list-pdf-bill-gap td {
          height: 2px;
          padding: 5px 0 !important;
          border: none !important;
          border-top: 2px solid #64748b !important;
          background: #fff !important;
          font-size: 0;
          line-height: 0;
        }
        table.table-report tbody tr.sale-list-pdf-bill-total td {
          border-bottom: 2px solid #64748b !important;
        }
        table.table-report td.amount {
          text-align: right;
          font-family: Consolas, 'Courier New', monospace;
          white-space: nowrap;
          word-break: keep-all;
          overflow-wrap: normal;
        }
        table.table-report tr.report-grand-total td.amount,
        table.table-report tr.subtotal-row td.amount {
          font-size: 7px;
          letter-spacing: -0.02em;
        }
        table.table-report td.amount.bal { font-weight: 700; color: #0f766e; }
        table.table-report tr.report-grand-total td {
          border-top: 4px double #1e293b;
          border-left: 1px solid #1e293b;
          border-right: 1px solid #1e293b;
          border-bottom: 3px solid #1e293b;
          background: #1e3a5f !important;
          color: #fff !important;
          font-weight: 800;
          font-size: 9px;
          padding: 9px 6px;
          vertical-align: middle;
        }
        table.table-report tr.report-grand-total td.lbl-total {
          text-align: left;
          font-size: 10px;
          letter-spacing: 0.05em;
        }
        table.table-report tr.report-grand-total td.amount { color: #fff !important; font-size: 10px; }
        table.table-report td.amount.bill-ledger-interest-amt-pdf {
          color: #c2410c !important;
          font-weight: 800;
        }
        table.table-report tr.subtotal-row td.amount.bill-ledger-interest-amt-pdf {
          color: #9a3412 !important;
        }
        table.table-report tr.report-grand-total td.amount.bill-ledger-interest-amt-pdf {
          color: #fdba74 !important;
        }
        table.table-report td.amount.ageing-cur-bal-alert { color: #c53030 !important; font-weight: 700; }
        table.table-report tr.report-grand-total td.amount.ageing-cur-bal-alert { color: #fecaca !important; }
        .report-foot {
          margin-top: 10px;
          padding: 8px;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          font-size: 8px;
          color: #64748b;
          text-align: center;
          page-break-inside: avoid;
          break-inside: avoid;
        }
        table.production-print-lines.table-report { table-layout: fixed; width: 100%; }
        table.production-print-lines .prod-col-sno { width: 5%; }
        table.production-print-lines .prod-col-code { width: 11%; }
        table.production-print-lines .prod-col-name { width: 26%; }
        table.production-print-lines .prod-col-pct { width: 9%; }
        table.production-print-lines .prod-col-qty { width: 11%; }
        table.production-print-lines .prod-col-st { width: 7%; }
        table.production-print-lines .prod-col-wgt { width: 15%; }
        table.production-print-lines .prod-col-short { width: 16%; }
        table.production-print-lines tr.production-print-total-row td {
          background: #f1f5f9 !important;
          color: #0f172a !important;
          font-weight: 700;
          font-size: 9px;
          border-top: 2px solid #1e3a5f;
          padding: 6px 5px;
        }
        table.production-print-lines tr.production-print-total-row--prod td {
          border-top: 1px solid #94a3b8;
        }
        table.production-print-lines .production-print-total-lbl {
          text-align: left;
        }
        table.production-print-lines .production-print-total-st {
          text-align: center;
        }
        .production-print-pdf-doc { width: 100%; max-width: 210mm; margin: 0 auto; }
        .production-print-voucher { width: 100%; }
        .production-print-header h1 { margin: 0 0 4px; font-size: 14px; color: #1e3a5f; }
        .production-print-header h2 { margin: 0 0 6px; font-size: 12px; font-weight: 700; }
        .production-print-voucher-id { margin: 0 0 10px; font-size: 10px; }
        table.production-print-meta .lbl { font-weight: 700; text-align: left; white-space: nowrap; }
        table.table-report .col-sch { white-space: nowrap; width: 6%; }
        table.table-report .col-code { white-space: nowrap; width: 8%; }
        table.table-report .col-name { word-wrap: break-word; min-width: 120px; }
        table.table-report .col-city { word-wrap: break-word; width: 10%; }
        table.table-report .col-date { white-space: nowrap; width: 9%; }
        /* Wide purchase list: compact cells so html2canvas captures all columns on one page width */
        .purchase-list-pdf.report-doc { font-size: 7px; }
        .purchase-list-pdf table.table-report { table-layout: fixed; width: 100%; }
        .purchase-list-pdf table.table-report thead th {
          font-size: 5.5px;
          padding: 4px 2px;
          letter-spacing: 0;
          word-break: break-word;
          hyphens: auto;
        }
        .purchase-list-pdf table.table-report tbody td {
          font-size: 5.5px;
          padding: 2px 2px;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .purchase-list-pdf table.table-report td.amount {
          font-size: 5.5px;
          padding: 2px 2px;
        }
        .purchase-list-pdf table.table-report .col-name {
          min-width: 0;
          max-width: none;
        }
        .purchase-list-pdf { overflow: visible !important; max-width: none !important; width: 100%; }
        /* Wide voucher list: fixed columns, compact cells */
        .voucher-list-pdf.report-doc { font-size: 7px; overflow: visible !important; max-width: none !important; width: 100%; }
        .voucher-list-pdf table.table-report { table-layout: fixed; width: 100%; }
        .voucher-list-pdf table.table-report thead th {
          font-size: 6px;
          padding: 4px 3px;
          letter-spacing: 0;
          word-break: break-word;
          hyphens: auto;
        }
        .voucher-list-pdf table.table-report tbody td {
          font-size: 6px;
          padding: 2px 3px;
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        .voucher-list-pdf table.table-report td.amount {
          font-size: 6px;
          padding: 2px 3px;
        }
        .voucher-list-pdf .col-vr-type { width: 4%; white-space: nowrap; }
        .voucher-list-pdf .col-date { width: 7%; white-space: nowrap; }
        .voucher-list-pdf .col-vr-no { width: 4%; white-space: nowrap; }
        .voucher-list-pdf .col-ac-type { width: 3%; white-space: nowrap; }
        .voucher-list-pdf .col-code { width: 5%; white-space: nowrap; padding-right: 5px !important; }
        .voucher-list-pdf .col-name { width: 11%; word-wrap: break-word; min-width: 0; padding-left: 5px !important; }
        .voucher-list-pdf .col-amt { width: 6%; }
        .voucher-list-pdf .col-bill-no { width: 5%; white-space: nowrap; }
        .voucher-list-pdf .col-btype { width: 3%; white-space: nowrap; }
        .voucher-list-pdf .col-chq { width: 5%; white-space: nowrap; }
        .voucher-list-pdf .col-detail { width: 30%; word-wrap: break-word; min-width: 0; }
        .voucher-list-pdf .col-dc { width: 5%; white-space: nowrap; }
        table.table-report .col-vr { width: 6%; white-space: nowrap; }
        table.table-report .col-type { width: 5%; white-space: nowrap; }
        table.table-report .col-detail { word-wrap: break-word; max-width: 220px; }
        table.table-report.bill-ledger-pdf-report { table-layout: fixed; }
        table.table-report.bill-ledger-pdf-report tbody td {
          font-size: 9.5px;
          padding: 4px 2px;
        }
        table.table-report.bill-ledger-pdf-report thead th.no-upper {
          text-transform: none;
          letter-spacing: 0.02em;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-bt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-bt,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-vt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-vt {
          text-align: center;
          padding: 3px 1px;
          white-space: nowrap;
          font-size: 8.5px;
          min-width: 0;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-date,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-date {
          white-space: nowrap;
          font-size: 8.5px;
          padding: 3px 2px;
          min-width: 0;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-bill-no,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-vr-no {
          overflow: visible;
          text-overflow: clip;
          white-space: nowrap;
          font-size: 8.5px;
          padding: 3px 1px;
        }
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-bill-no,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-vr-no {
          white-space: nowrap;
          font-size: 8.5px;
          padding: 3px 1px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-int-days,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-int-days,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-int-amt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-int-amt,
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-int-close,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-int-close {
          text-align: right;
          white-space: nowrap;
          min-width: 0;
          padding: 3px 2px;
          font-size: 8.5px;
          font-variant-numeric: tabular-nums;
        }
        table.table-report.bill-ledger-pdf-report th.col-bill-ledger-amt,
        table.table-report.bill-ledger-pdf-report td.col-bill-ledger-amt {
          text-align: right;
          padding: 3px 2px;
          font-size: 8.5px;
          font-family: Consolas, 'Courier New', monospace;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          min-width: 0;
        }
        table.table-report.bill-ledger-pdf-report thead th.col-bill-ledger-amt {
          font-size: 7px;
          padding: 5px 2px;
          white-space: normal;
          line-height: 1.2;
          vertical-align: bottom;
        }
        table.table-report.bill-ledger-pdf-report tr.subtotal-row td.col-bill-ledger-amt {
          font-size: 8.5px;
        }
        table.table-report.bill-ledger-pdf-report tr.report-grand-total td.col-bill-ledger-amt {
          font-size: 9px;
          padding: 6px 2px;
        }
        /* Ledger statement: narrow amount columns, more room for detail */
        table.table-report.table-report-ledger { table-layout: fixed; }
        table.table-report.table-report-ledger thead th {
          text-transform: none;
          letter-spacing: 0.02em;
          font-size: 10.4px;
          padding: 8px 4px;
        }
        table.table-report.table-report-ledger .col-detail {
          max-width: none;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
          font-size: 10.6px;
          line-height: 1.4;
        }
        table.table-report.table-report-ledger th.col-ledger-vr-date,
        table.table-report.table-report-ledger td.col-ledger-vr-date,
        table.table-report.table-report-ledger th.col-ledger-value-dt,
        table.table-report.table-report-ledger td.col-ledger-value-dt {
          white-space: nowrap;
          font-size: 9.6px;
        }
        table.table-report.table-report-ledger th.col-ledger-vr-no,
        table.table-report.table-report-ledger td.col-ledger-vr-no,
        table.table-report.table-report-ledger th.col-ledger-vr-type,
        table.table-report.table-report-ledger td.col-ledger-vr-type,
        table.table-report.table-report-ledger th.col-ledger-line-type,
        table.table-report.table-report-ledger td.col-ledger-line-type {
          white-space: nowrap;
          text-align: center;
          font-size: 9.4px;
          padding-left: 2px;
          padding-right: 2px;
        }
        table.table-report.table-report-ledger th.col-ledger-value-dt,
        table.table-report.table-report-ledger td.col-ledger-value-dt {
          width: auto;
          max-width: none;
        }
        table.table-report.table-report-ledger th.ledger-amt-col,
        table.table-report.table-report-ledger td.ledger-amt-col {
          width: auto;
          max-width: none;
          font-size: 10.2px;
          padding: 3px 4px;
          font-variant-numeric: tabular-nums;
        }
        table.table-report.table-report-ledger tbody td {
          font-size: 10.1px;
          padding-top: 5px;
          padding-bottom: 5px;
        }
        table.table-report.table-report-ledger td.ledger-cl-bal-pos {
          font-weight: 700;
          color: #0f766e;
        }
        table.table-report.table-report-ledger td.ledger-cl-bal-neg {
          font-weight: 700;
          color: #c53030 !important;
        }
        table.table-report tr.report-grand-total td.ledger-cl-bal-neg {
          color: #fecaca !important;
        }
        .report-grid td.val-ledger-acct-strong {
          text-align: left;
          font-weight: 700;
        }
        .report-grid td.ledger-party-line {
          text-align: left;
          font-weight: 700;
          font-size: 9px;
        }
        .ledger-pdf-company-block,
        .ledger-pdf-account-block {
          text-align: left;
          margin: 8px auto 0 auto;
          max-width: 100%;
          font-size: 10px;
          color: #0f172a;
        }
        .ledger-pdf-company-block {
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid #94a3b8;
        }
        .ledger-pdf-account-block {
          margin-bottom: 10px;
          font-weight: 600;
        }
        .ledger-pdf-block-title {
          font-size: 8.8px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #475569;
          margin-bottom: 4px;
          font-weight: 700;
        }
        .ledger-pdf-company-name {
          font-size: 12.4px;
          font-weight: 800;
          color: #0f172a;
          margin-bottom: 4px;
        }
        .ledger-pdf-line { margin: 2px 0; line-height: 1.42; }
`;

/** Trial balance PDF — same shell and grid lines as ledger */
function buildTrialBalanceReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const asOf = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let bodyRows = '';
  const htmlSummary = computeTrialTopSummary(data);
  const htmlGcdr = htmlSummary.closingDr;
  const htmlGccr = htmlSummary.closingCr;
  const htmlSchTotals = computeTbScheduleTotals(data);
  let htmlGpdr = 0;
  let htmlGpcr = 0;
  (data || []).forEach((r) => {
    if (trialBalanceRowKind(r) !== 0) return;
    htmlGpdr += parseFloat(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    htmlGpcr += parseFloat(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
  });

  sortTrialBalanceRows(data || []).forEach((row) => {
    const kind = trialBalanceRowKind(row);
    const nameVal = trialBalanceRowLabel(row);
    const schVal = row.SCHEDULE ?? row.schedule ?? '';
    const isTotal = kind >= 1;
    const isGrand = kind === 2;
    const isScheduleTotal = kind === 1;

    const rowClass =
      kind === 2 ? 'report-grand-total' : kind === 1 ? 'subtotal-row' : '';
    const nameCell = kind === 2 ? `<strong>${escHtml(nameVal)}</strong>` : escHtml(nameVal);
    const wrap = (amt) => (isTotal ? `<strong>${formatAmtPdf(amt)}</strong>` : formatAmtPdf(amt));

    const cityVal = row.CITY ?? row.city ?? '';
    const sch = isScheduleTotal ? htmlSchTotals.get(tbScheduleKey(row)) : null;
    const htmlClosingDr = isGrand ? htmlGcdr : sch ? sch.closingDr : row.CLOSING_DR ?? row.closing_dr;
    const htmlClosingCr = isGrand ? htmlGccr : sch ? sch.closingCr : row.CLOSING_CR ?? row.closing_cr;
    const htmlPeriodDr = isGrand ? htmlGpdr : sch ? sch.periodDr : row.DR_AMT ?? row.dr_amt;
    const htmlPeriodCr = isGrand ? htmlGpcr : sch ? sch.periodCr : row.CR_AMT ?? row.cr_amt;

    bodyRows += `
            <tr class="${rowClass}">
              <td class="col-sch">${isTotal && schVal === '' ? '' : escHtml(schVal)}</td>
              <td class="col-name">${nameCell}</td>
              <td class="col-code">${isTotal ? '' : escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-city">${isTotal ? '' : escHtml(cityVal)}</td>
              <td class="amount">${wrap(htmlClosingDr)}</td>
              <td class="amount">${wrap(htmlClosingCr)}</td>
              <td class="amount">${wrap(htmlPeriodDr)}</td>
              <td class="amount">${wrap(htmlPeriodCr)}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>TRIAL BALANCE REPORT</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">As-of date</td><td class="val">${asOf}</td></tr>
        </table>
        <div class="report-period"><strong>Report basis:</strong> Balances as of date above &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>

      <div class="tb-pdf-summary-row">
        <div class="tb-pdf-summary-box tb-pdf-summary-box--debit">
          <div class="tb-pdf-summary-label">TOTAL DEBIT</div>
          <div class="tb-pdf-summary-amt">${formatAmtPdf(htmlGcdr)}</div>
        </div>
        <div class="tb-pdf-summary-box tb-pdf-summary-box--credit">
          <div class="tb-pdf-summary-label">TOTAL CREDIT</div>
          <div class="tb-pdf-summary-amt">${formatAmtPdf(htmlGccr)}</div>
        </div>
      </div>

      <table class="table-report table-report--trial-pdf table-report--trial-pdf-full">
        <thead>
          <tr>
            <th>Sch</th>
            <th>Account</th>
            <th>Code</th>
            <th>City</th>
            <th class="amount">Cl.Dr.Amt</th>
            <th class="amount">Cl.Cr.Amt</th>
            <th class="amount">Tot.Dr.Amt</th>
            <th class="amount">Tot.Cr.Amt</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>

      <div class="report-foot">
        Schedule subtotals follow each schedule block; grand total is across all schedules.
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

/** Trial balance summary — annexure totals only */
function buildTrialBalanceSummaryReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const asOf = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  let bodyRows = '';
  sortTrialBalanceRows(data || [])
    .filter((row) => trialBalanceRowKind(row) === 1 || trialBalanceRowKind(row) === 2)
    .forEach((row) => {
      const kind = trialBalanceRowKind(row);
      const isGrand = kind === 2;
      const nameVal = trialBalanceRowLabel(row);
      const schVal = row.SCHEDULE ?? row.schedule ?? '';
      const wrap = (amt) => (isGrand ? `<strong>${formatAmtPdf(amt)}</strong>` : formatAmtPdf(amt));
      bodyRows += `
            <tr class="${isGrand ? 'report-grand-total' : 'subtotal-row'}">
              <td class="col-sch">${escHtml(schVal)}</td>
              <td class="col-name">${isGrand ? `<strong>${escHtml(nameVal)}</strong>` : escHtml(nameVal)}</td>
              <td class="amount">${wrap(row.CLOSING_DR ?? row.closing_dr)}</td>
              <td class="amount">${wrap(row.CLOSING_CR ?? row.closing_cr)}</td>
              <td class="amount">${wrap(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount">${wrap(row.CR_AMT ?? row.cr_amt)}</td>
            </tr>`;
    });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>TRIAL BALANCE SUMMARY</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">As-of date</td><td class="val">${asOf}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>
      <table class="table-report table-report--trial-pdf">
        <thead>
          <tr>
            <th>Annexure</th>
            <th>Schedule name</th>
            <th class="amount">Cl.Dr.Amt</th>
            <th class="amount">Cl.Cr.Amt</th>
            <th class="amount">Tot.Dr.Amt</th>
            <th class="amount">Tot.Cr.Amt</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/** Trial balance date wise — opening / transactions / closing */
function buildTrialDateWiseReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const period = escHtml(metadata.endDate || metadata.periodLabel);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const num = (row, u, l) => parseFloat(row[u] ?? row[l] ?? 0) || 0;
  let bodyRows = '';

  sortTrialBalanceRows(data || [])
    .filter((row) => trialBalanceRowKind(row) !== 2)
    .forEach((row) => {
      const kind = trialBalanceRowKind(row);
      const isTotal = kind >= 1;
      const nameVal = trialBalanceRowLabel(row);
      const wrap = (v) => (isTotal ? `<strong>${formatAmtPdf(v)}</strong>` : formatAmtPdf(v));
      bodyRows += `
            <tr class="${kind === 1 ? 'subtotal-row' : ''}">
              <td>${isTotal ? '' : escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-name">${isTotal ? `<strong>${escHtml(nameVal)}</strong>` : escHtml(nameVal)}</td>
              <td>${isTotal ? '' : escHtml(row.CITY ?? row.city ?? '')}</td>
              <td>${isTotal ? '' : escHtml(row.PAN ?? row.pan ?? '')}</td>
              <td class="amount">${wrap(num(row, 'OP_DR', 'op_dr'))}</td>
              <td class="amount">${wrap(num(row, 'OP_CR', 'op_cr'))}</td>
              <td class="amount">${wrap(num(row, 'TRN_DR', 'trn_dr'))}</td>
              <td class="amount">${wrap(num(row, 'TRN_CR', 'trn_cr'))}</td>
              <td class="amount">${wrap(num(row, 'CL_DR', 'cl_dr'))}</td>
              <td class="amount">${wrap(num(row, 'CL_CR', 'cl_cr'))}</td>
            </tr>`;
    });

  const grand = findTrialGrandRow(data);
  if (grand) {
    bodyRows += `
            <tr class="report-grand-total">
              <td colspan="4"><strong>GRAND TOTAL</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'OP_DR', 'op_dr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'OP_CR', 'op_cr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'TRN_DR', 'trn_dr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'TRN_CR', 'trn_cr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'CL_DR', 'cl_dr'))}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(num(grand, 'CL_CR', 'cl_cr'))}</strong></td>
            </tr>`;
  }

  return `
    <div class="report-doc report-doc--trial-date-wise">
      <style>${PDF_REPORT_STYLES}
        .table-report--trial-date-wise { font-size: 7px; }
        .table-report--trial-date-wise th { font-size: 6.5px; padding: 3px 2px; }
        .table-report--trial-date-wise td { padding: 2px 2px; }
      </style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>TRIAL BALANCE DATE WISE</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>
      <table class="table-report table-report--trial-date-wise">
        <thead>
          <tr>
            <th rowspan="2">Code</th>
            <th rowspan="2">Name</th>
            <th rowspan="2">City</th>
            <th rowspan="2">Pan</th>
            <th colspan="2" class="amount">Opening Balance</th>
            <th colspan="2" class="amount">Transactions</th>
            <th colspan="2" class="amount">Closing Balance</th>
          </tr>
          <tr>
            <th class="amount">Debit</th>
            <th class="amount">Credit</th>
            <th class="amount">Debit</th>
            <th class="amount">Credit</th>
            <th class="amount">Debit</th>
            <th class="amount">Credit</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
}

/** Ledger PDF */
function buildLedgerReportHtml(data, metadata) {
  const rows = data || [];
  let sumDr = 0;
  let sumCr = 0;
  rows.forEach((row) => {
    sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
    sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
  });
  const last = rows[rows.length - 1];
  const closingBal =
    last != null
      ? parseFloat(last.CL_BALANCE ?? last.cl_balance ?? last.RUN_BAL ?? last.run_bal ?? 0) || 0
      : 0;

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const accName = escHtml(metadata.accountName);
  const accCode = escHtml(metadata.accountCode);
  const period = escHtml(metadata.endDate);
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const cAdd1 = escHtml(String(metadata.companyAdd1 ?? '').trim());
  const cAdd2 = escHtml(String(metadata.companyAdd2 ?? '').trim());
  const cGst = escHtml(String(metadata.companyGst ?? '').trim());
  const aAdd1 = escHtml(String(metadata.accountAdd1 ?? '').trim());
  const aAdd2 = escHtml(String(metadata.accountAdd2 ?? '').trim());
  const aCity = escHtml(String(metadata.accountCity ?? '').trim());
  const aGst = escHtml(String(metadata.accountGst ?? '').trim());
  const aPan = escHtml(String(metadata.accountPan ?? '').trim());
  const aTel = escHtml(String(metadata.accountTel ?? '').trim());

  const companyLines = [
    company ? `<div class="ledger-pdf-company-name">${company}</div>` : '',
    cAdd1 ? `<div class="ledger-pdf-line">${cAdd1}</div>` : '',
    cAdd2 ? `<div class="ledger-pdf-line">${cAdd2}</div>` : '',
    cGst ? `<div class="ledger-pdf-line"><strong>GST:</strong> ${cGst}</div>` : '',
  ]
    .filter(Boolean)
    .join('');
  const companyBlock =
    companyLines !== '' ? `<div class="ledger-pdf-company-block">${companyLines}</div>` : '';

  const accMetaParts = [
    aCity ? `City: ${aCity}` : '',
    aGst ? `GST: ${aGst}` : '',
    aPan ? `PAN: ${aPan}` : '',
    aTel ? `Tel: ${aTel}` : '',
  ]
    .filter(Boolean)
    .join(' &nbsp;|&nbsp; ');
  const accountLines = [
    `<div><strong>${accName}</strong> (${accCode})</div>`,
    aAdd1 ? `<div class="ledger-pdf-line">${aAdd1}</div>` : '',
    aAdd2 ? `<div class="ledger-pdf-line">${aAdd2}</div>` : '',
    accMetaParts ? `<div class="ledger-pdf-line">${accMetaParts}</div>` : '',
  ]
    .filter(Boolean)
    .join('');
  const accountBlock = `<div class="ledger-pdf-account-block"><div class="ledger-pdf-block-title">Account</div>${accountLines}</div>`;

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const amountLen = (n) => formatAmtPdf(n).replace(/\s+/g, '').length;
  const maxAmtChars = Math.max(
    amountLen(sumDr),
    amountLen(sumCr),
    amountLen(closingBal),
    ...rows.map((r) =>
      Math.max(
        amountLen(r.DR_AMT ?? r.dr_amt ?? 0),
        amountLen(r.CR_AMT ?? r.cr_amt ?? 0),
        amountLen(r.CL_BALANCE ?? r.cl_balance ?? r.RUN_BAL ?? r.run_bal ?? 0)
      )
    )
  );
  const maxDetailChars = Math.max(
    12,
    ...rows.map((r) => String(r.DETAIL ?? r.detail ?? '').replace(/\s+/g, ' ').trim().length)
  );
  let amountColW = maxAmtChars >= 14 ? 11.5 : maxAmtChars >= 12 ? 11 : 10.5;
  const vrDateW = 7;
  const valueDateW = 7;
  const vrNoW = 5;
  const vrTypeW = 4.5;
  const typeW = 4.5;
  const fixedW = vrDateW + valueDateW + vrNoW + vrTypeW + typeW;
  let detailW = clamp(31 + Math.floor((maxDetailChars - 20) / 6), 31, 42);
  let total = fixedW + detailW + amountColW * 3;
  if (total > 100) {
    const overflow = total - 100;
    amountColW = clamp(amountColW - overflow / 3, 9.6, 12);
    total = fixedW + detailW + amountColW * 3;
  }
  if (total < 100) {
    detailW = clamp(detailW + (100 - total), 31, 44);
  }
  const ledgerColgroup = `
        <colgroup>
          <col style="width:${vrDateW.toFixed(2)}%" />
          <col style="width:${valueDateW.toFixed(2)}%" />
          <col style="width:${vrNoW.toFixed(2)}%" />
          <col style="width:${vrTypeW.toFixed(2)}%" />
          <col style="width:${typeW.toFixed(2)}%" />
          <col style="width:${detailW.toFixed(2)}%" />
          <col style="width:${amountColW.toFixed(2)}%" />
          <col style="width:${amountColW.toFixed(2)}%" />
          <col style="width:${amountColW.toFixed(2)}%" />
        </colgroup>`;

  let bodyRows = '';
  rows.forEach((row) => {
    const vrType = row.VR_TYPE ?? row.vr_type ?? '';
    const opClass = vrType === 'OP' ? ' op-row' : '';
    const d = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    const vdRaw = row.V_DATE ?? row.v_date;
    const vdDisp = vdRaw != null && vdRaw !== '' ? formatLedgerDateDisplay(vdRaw) : '';
    const vd = escHtml(vdDisp || '—');
    const lineType = row.TYPE ?? row.type ?? '';
    const detail = escHtml(row.DETAIL ?? row.detail ?? '');
    const clBal = row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal;
    const clNum = parseFloat(clBal) || 0;
    const clCls = clNum < 0 ? 'ledger-cl-bal-neg' : 'ledger-cl-bal-pos';
    bodyRows += `
            <tr class="${opClass.trim()}">
              <td class="col-date col-ledger-vr-date">${d}</td>
              <td class="col-date col-ledger-value-dt">${vd}</td>
              <td class="col-vr col-ledger-vr-no">${escHtml(row.VR_NO ?? row.vr_no ?? '—')}</td>
              <td class="col-type col-ledger-vr-type">${escHtml(vrType)}</td>
              <td class="col-type col-ledger-line-type">${escHtml(lineType !== '' ? String(lineType) : '—')}</td>
              <td class="col-detail">${detail}</td>
              <td class="amount ledger-amt-col">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount ledger-amt-col">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount ledger-amt-col ${clCls}">${formatAmtPdf(clBal)}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>LEDGER ACCOUNT STATEMENT</h1>
        ${companyBlock}
        ${accountBlock}
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Account code</td><td class="val">${accCode}</td></tr>
        </table>
        <div class="report-period"><strong>Period: ${period}</strong> &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report table-report-ledger">
        ${ledgerColgroup}
        <thead>
          <tr>
            <th class="col-ledger-vr-date">Vr.Date</th>
            <th class="col-ledger-value-dt">Value Date</th>
            <th class="col-ledger-vr-no">Vr.No.</th>
            <th class="col-ledger-vr-type">Vr.Type</th>
            <th class="col-ledger-line-type">Type</th>
            <th>Detail</th>
            <th class="amount ledger-amt-col">Dr.Amount</th>
            <th class="amount ledger-amt-col">Cr.Amount</th>
            <th class="amount ledger-amt-col">Cl.Balance</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="6" class="lbl-total">GRAND TOTAL</td>
            <td class="amount ledger-amt-col">${formatAmtPdf(sumDr)}</td>
            <td class="amount ledger-amt-col">${formatAmtPdf(sumCr)}</td>
            <td class="amount ledger-amt-col ${closingBal < 0 ? 'ledger-cl-bal-neg' : ''}">${formatAmtPdf(closingBal)}</td>
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Debit and credit columns are period totals; the balance column is the closing running balance.
        <br />
        Computer-generated statement — no signature required.
      </div>
    </div>
  `;
}

/** Trading Ledger PDF (Entry/Date/Month wise). */
function buildTradingLedgerReportHtml(data, metadata) {
  const rows = Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || '');
  const year = escHtml(metadata.year || '');
  const title = escHtml(metadata.reportTitle || 'Trading Ledger');
  const period = escHtml(metadata.period || metadata.endDate || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const fmtDate = (v) => {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    return raw;
  };
  const z = (n, qty = false) => {
    const v = parseFloat(n);
    if (!Number.isFinite(v) || v === 0) return '';
    return qty ? formatQtyPdf(v) : formatAmtPdf(v);
  };

  let sumRQ = 0; let sumRW = 0; let sumDR = 0;
  let sumSQ = 0; let sumSW = 0; let sumCR = 0;
  let lastBQ = 0; let lastBW = 0; let lastCL = 0;

  const bodyRows = rows.map((r) => {
    const rq = parseFloat(r.R_QNTY ?? r.r_qnty ?? 0) || 0;
    const rw = parseFloat(r.R_WEIGHT ?? r.r_weight ?? 0) || 0;
    const dr = parseFloat(r.DR_AMOUNT ?? r.dr_amount ?? r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    const sq = parseFloat(r.S_QNTY ?? r.s_qnty ?? 0) || 0;
    const sw = parseFloat(r.S_WEIGHT ?? r.s_weight ?? 0) || 0;
    const cr = parseFloat(r.CR_AMOUNT ?? r.cr_amount ?? r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    const bq = parseFloat(r.BAL_QNTY ?? r.bal_qnty ?? 0) || 0;
    const bw = parseFloat(r.BAL_WEIGHT ?? r.bal_weight ?? 0) || 0;
    const cl = parseFloat(r.CL_BALANCE ?? r.cl_balance ?? 0) || 0;
    sumRQ += rq; sumRW += rw; sumDR += dr; sumSQ += sq; sumSW += sw; sumCR += cr;
    lastBQ = bq; lastBW = bw; lastCL = cl;
    return `
      <tr>
        <td>${escHtml(String(r.VR_TYPE ?? r.vr_type ?? ''))}</td>
        <td>${escHtml(fmtDate(r.VR_DATE ?? r.vr_date))}</td>
        <td>${escHtml(String(r.VR_NO ?? r.vr_no ?? ''))}</td>
        <td>${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
        <td class="amount">${z(rq, true)}</td>
        <td class="amount">${z(rw, true)}</td>
        <td class="amount">${z(dr)}</td>
        <td class="amount">${z(sq, true)}</td>
        <td class="amount">${z(sw, true)}</td>
        <td class="amount">${z(cr)}</td>
        <td class="amount">${z(bq, true)}</td>
        <td class="amount">${z(bw, true)}</td>
        <td class="amount">${z(cl)}</td>
      </tr>`;
  }).join('');

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>${title}</h1>
        <table class="report-grid">
          <tr><td class="lbl">Company</td><td class="val">${company}</td><td class="lbl">Financial year</td><td class="val">${year}</td></tr>
        </table>
        <div class="report-period"><strong>Period:</strong> ${period} &nbsp;|&nbsp; <strong>Generated:</strong> ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Vr.Type</th><th>Vr.Date</th><th>Vr.No</th><th>Type</th>
            <th class="amount">R.Qnty</th><th class="amount">R.Weight</th><th class="amount">Dr.Amount</th>
            <th class="amount">S.Qnty</th><th class="amount">S.Weight</th><th class="amount">Cr.Amount</th>
            <th class="amount">Bal.Qnty</th><th class="amount">Bal.Weight</th><th class="amount">Cl.Balance</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="4" class="lbl-total">GRAND TOTAL</td>
            <td class="amount">${z(sumRQ, true)}</td>
            <td class="amount">${z(sumRW, true)}</td>
            <td class="amount">${z(sumDR)}</td>
            <td class="amount">${z(sumSQ, true)}</td>
            <td class="amount">${z(sumSW, true)}</td>
            <td class="amount">${z(sumCR)}</td>
            <td class="amount">${z(lastBQ, true)}</td>
            <td class="amount">${z(lastBW, true)}</td>
            <td class="amount">${z(lastCL)}</td>
          </tr>
        </tbody>
      </table>
      <div class="report-foot">Trading Ledger export with quantity, weight and balance columns.</div>
    </div>
  `;
}

/** Bill-wise ledger PDF (BILLS, running balance per bill); optional GETINT columns */
function buildBillLedgerReportHtml(data, metadata) {
  const rows = data || [];
  const useInt = Boolean(metadata.billLedgerInterest);
  const ledgerTitle = escHtml(metadata.billLedgerTitle || 'CustomerLedger');
  const ledgerKind = String(metadata.billLedgerKind || 'customer').toLowerCase() === 'supplier' ? 'supplier' : 'customer';
  const billLedgerCrFirst = ledgerKind === 'supplier';
  let sumDr = 0;
  let sumCr = 0;
  let sumCurrent = 0;
  let sumInterest = 0;
  let sumClosePlusInt = 0;

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const partyNameRaw = String(metadata.partyName || '').trim();
  const partyCityRaw = String(metadata.partyCity ?? '').trim();
  const partyTelRaw = String(metadata.partyTel ?? '').trim();
  const partyParts = [partyNameRaw];
  if (partyCityRaw) partyParts.push(partyCityRaw);
  if (partyTelRaw) partyParts.push(`Tel: ${partyTelRaw}`);
  const party = escHtml(partyParts.join(' · '));
  const pcode = escHtml(metadata.partyCode);
  const period = escHtml(metadata.endDate);
  const payEnd = escHtml(metadata.payEndDate ?? '');
  const filt = escHtml(metadata.filterLabel ?? '');
  const intAsOf = escHtml(metadata.interestAsOfLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const billKeyOf = (row) => {
    const billNo = String(row.BILL_NO ?? row.bill_no ?? '').trim();
    const billDt = formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date);
    const bType = String(row.B_TYPE ?? row.b_type ?? '').trim();
    return `${billDt}__${billNo}__${bType}`;
  };

  const intHead = useInt
    ? '<th class="amount col-bill-ledger-int-days no-upper" title="Interest days">Days</th><th class="amount col-bill-ledger-int-amt no-upper">Int</th><th class="amount col-bill-ledger-int-close no-upper" title="Closing + interest">Cl+int</th>'
    : '';
  const intBlank = useInt
    ? '<td class="amount col-bill-ledger-int-days" style="opacity:.65">—</td><td class="amount col-bill-ledger-int-amt" style="opacity:.65">—</td><td class="amount col-bill-ledger-int-close" style="opacity:.65">—</td>'
    : '';

  let bodyRows = '';
  let billDr = 0;
  let billCr = 0;
  let billCurrent = 0;

  rows.forEach((row, idx) => {
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
    const cl = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? 0) || 0;
    sumDr += dr;
    sumCr += cr;
    billDr += dr;
    billCr += cr;
    billCurrent = cl;

    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const vrDt = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    const vDtRaw = row.V_DATE ?? row.v_date;
    const vDtEsc =
      vDtRaw != null && vDtRaw !== '' ? escHtml(formatLedgerDateDisplay(vDtRaw)) : '—';
    bodyRows += `
            <tr>
              <td class="col-vr col-bill-ledger-bill-no">${escHtml(row.BILL_NO ?? row.bill_no ?? '')}</td>
              <td class="col-date col-bill-ledger-date">${billDt}</td>
              <td class="col-type col-bill-ledger-bt">${escHtml(row.B_TYPE ?? row.b_type ?? '')}</td>
              <td class="col-date col-bill-ledger-date">${vrDt}</td>
              <td class="col-date col-bill-ledger-date">${vDtEsc}</td>
              <td class="col-vr col-bill-ledger-vr-no">${escHtml(row.VR_NO ?? row.vr_no ?? '')}</td>
              <td class="col-type col-bill-ledger-vt">${escHtml(row.VR_TYPE ?? row.vr_type ?? '')}</td>
              <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? row.CR_AMT ?? row.cr_amt : row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? row.DR_AMT ?? row.dr_amt : row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount col-bill-ledger-amt bal">${formatAmtPdf(row.CL_BALANCE ?? row.cl_balance)}</td>
              ${intBlank}
            </tr>`;

    const curKey = billKeyOf(row);
    const next = rows[idx + 1];
    const nextKey = next ? billKeyOf(next) : '';
    const billEnds = !next || curKey !== nextKey;
    if (!billEnds) return;

    const bt = escHtml(String(row.B_TYPE ?? row.b_type ?? ''));
    const bn = escHtml(String(row.BILL_NO ?? row.bill_no ?? ''));
    const intAmt = useInt ? parseFloat(row.INTEREST_AMT ?? row.interest_amt ?? '') || 0 : 0;
    const idays = useInt ? row.INTEREST_DAYS ?? row.interest_days : '';
    const idaysEsc = idays === '' || idays == null ? '—' : escHtml(String(idays));
    const closePlus = useInt ? billCurrent + intAmt : 0;
    if (useInt) {
      sumInterest += intAmt;
      sumClosePlusInt += closePlus;
    }
    const intCells = useInt
      ? `<td class="amount col-bill-ledger-int-days"><strong>${idaysEsc}</strong></td><td class="amount bill-ledger-interest-amt-pdf col-bill-ledger-int-amt"><strong>${formatAmtPdf(intAmt)}</strong></td><td class="amount col-bill-ledger-int-close"><strong>${formatAmtPdf(closePlus)}</strong></td>`
      : '';
    bodyRows += `
            <tr class="subtotal-row">
              <td colspan="7" class="col-name"><strong>Bill total — ${billDt} / ${bn} / ${bt}</strong></td>
              <td class="amount col-bill-ledger-amt"><strong>${formatAmtPdf(billLedgerCrFirst ? billCr : billDr)}</strong></td>
              <td class="amount col-bill-ledger-amt"><strong>${formatAmtPdf(billLedgerCrFirst ? billDr : billCr)}</strong></td>
              <td class="amount col-bill-ledger-amt"><strong>${formatAmtPdf(billCurrent)}</strong></td>
              ${intCells}
            </tr>`;
    sumCurrent += billCurrent;
    billDr = 0;
    billCr = 0;
    billCurrent = 0;
  });

  const intGrand = useInt
    ? `<td class="amount col-bill-ledger-int-days"><strong>—</strong></td><td class="amount bill-ledger-interest-amt-pdf col-bill-ledger-int-amt"><strong>${formatAmtPdf(sumInterest)}</strong></td><td class="amount col-bill-ledger-int-close"><strong>${formatAmtPdf(sumClosePlusInt)}</strong></td>`
    : '';
  const pdfColgroup = useInt
    ? `<colgroup>
            <col style="width:6.5%" /><col style="width:9.5%" /><col style="width:2.5%" /><col style="width:9.5%" /><col style="width:9.5%" />
            <col style="width:5.5%" /><col style="width:2.5%" />
            <col style="width:10%" /><col style="width:10%" /><col style="width:10%" />
            <col style="width:5%" /><col style="width:10%" /><col style="width:9.5%" />
          </colgroup>`
    : `<colgroup>
            <col style="width:10%" /><col style="width:14%" /><col style="width:3%" /><col style="width:14%" /><col style="width:14%" />
            <col style="width:8%" /><col style="width:4%" />
            <col style="width:11%" /><col style="width:11%" /><col style="width:11%" />
          </colgroup>`;
  const filterRowExtra = useInt
    ? `<tr><td class="lbl">Interest as of</td><td class="val" colspan="3">${intAsOf} (Oracle GETINT)</td></tr>`
    : '';

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>${ledgerTitle.toUpperCase()}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Party code</td><td class="val">${pcode}</td></tr>
          <tr><td class="lbl">Party name</td><td class="val" colspan="3">${party}</td></tr>
          <tr><td class="lbl">Bill date range</td><td class="val">${period}</td><td class="lbl">Payment ending</td><td class="val">${payEnd}</td></tr>
          <tr><td class="lbl">Filter</td><td class="val" colspan="3">${filt} (${ledgerKind === 'supplier' ? 'CR - DR' : 'DR - CR'})</td></tr>
          ${filterRowExtra}
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report bill-ledger-pdf-report">
        ${pdfColgroup}
        <thead>
          <tr>
            <th class="col-bill-ledger-bill-no no-upper">Bill no</th>
            <th class="col-bill-ledger-date no-upper">Bill date</th>
            <th class="col-bill-ledger-bt no-upper">BT</th>
            <th class="col-bill-ledger-date no-upper">Vr date</th>
            <th class="col-bill-ledger-date no-upper">V date</th>
            <th class="col-bill-ledger-vr-no no-upper">Vr no</th>
            <th class="col-bill-ledger-vt no-upper">VT</th>
            <th class="amount col-bill-ledger-amt no-upper">${billLedgerCrFirst ? 'Cr.Amount' : 'Dr.Amount'}</th>
            <th class="amount col-bill-ledger-amt no-upper">${billLedgerCrFirst ? 'Dr.Amount' : 'Cr.Amount'}</th>
            <th class="amount col-bill-ledger-amt no-upper">Closing Bal.</th>
            ${intHead}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="7" class="lbl-total">GRAND TOTAL <span style="font-weight:600;opacity:.9">(Dr/Cr sums + current bal total${useInt ? '; interest from GETINT' : ''})</span></td>
            <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? sumCr : sumDr)}</td>
            <td class="amount col-bill-ledger-amt">${formatAmtPdf(billLedgerCrFirst ? sumDr : sumCr)}</td>
            <td class="amount col-bill-ledger-amt">${formatAmtPdf(sumCurrent)}</td>
            ${intGrand}
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Current balance is shown per line and per bill total (Bill date + Bill no + B type), with a final grand total.
        <br />
        Balance formula: ${ledgerKind === 'supplier' ? 'CR - DR' : 'DR - CR'}.
        ${useInt ? `<br />Interest columns use Oracle ${ledgerKind === 'supplier' ? 'GETINT_SUP' : 'GETINT'} logic (legacy VFP9-compatible).` : ''}
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

/** Broker-wise outstanding PDF */
function buildBrokerOsReportHtml(data, metadata) {
  const { displayRows, grandDr, grandCr } = buildBrokerOsDisplayRows(data || []);
  const crFirst = brokerOsCrFirstFromSchedule(metadata?.schedule);

  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const period = escHtml(metadata.endDate);
  const payEnd = escHtml(metadata.payEndDate ?? '');
  const brk = escHtml(metadata.brokerRange ?? '');
  const party = escHtml(metadata.partyLabel ?? '');
  const filt = escHtml(metadata.filterLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const brokerOsLabelColspan = 8;
  let bodyRows = '';
  displayRows.forEach((item) => {
    if (item.kind === 'broker-header') {
      const bkCode = escHtml(brokerOsBCodeOf(item));
      const bkNm = escHtml(String(item.BK_NAME ?? item.bk_name ?? '').trim());
      const line = bkNm ? `Broker ${bkCode} — ${bkNm}` : `Broker ${bkCode}`;
      bodyRows += `
            <tr class="broker-os-pdf-broker-section-head">
              <td colspan="12" class="col-name"><strong>${line}</strong></td>
            </tr>`;
      return;
    }
    if (item.kind === 'bill-total') {
      const code = escHtml(item.CODE ?? '');
      const billDt = escHtml(formatLedgerDateDisplay(item.BILL_DATE ?? item.bill_date));
      const billNo = escHtml(item.BILL_NO ?? '');
      const bType = escHtml(item.B_TYPE ?? item.b_type ?? '');
      const billDrCr = crFirst
        ? `<td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>`
        : `<td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>`;
      bodyRows += `
            <tr class="broker-os-pdf-bill-total">
              <td colspan="${brokerOsLabelColspan}" class="col-name"><strong>Bill total — ${code} / ${billDt} / ${billNo} / ${bType}</strong></td>
              ${billDrCr}
              <td class="amount">—</td>
              <td class="amount"><strong>${formatAmtPdf(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong></td>
            </tr>`;
      return;
    }
    if (item.kind === 'party-total') {
      const label = escHtml(`Party total — ${item.NAME || '—'} (${item.CODE})`);
      const partyDrCr = crFirst
        ? `<td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>`
        : `<td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>`;
      bodyRows += `
            <tr class="subtotal-row">
              <td colspan="${brokerOsLabelColspan}" class="col-name"><strong>${label}</strong></td>
              ${partyDrCr}
              <td class="amount">—</td>
              <td class="amount">—</td>
            </tr>`;
      return;
    }
    if (item.kind === 'broker-total') {
      const bkCode = escHtml(brokerOsBCodeOf(item));
      const bkNm = escHtml(String(item.BK_NAME ?? item.bk_name ?? '').trim());
      const bk = bkNm ? `${bkCode} — ${bkNm}` : bkCode;
      const brkDrCr = crFirst
        ? `<td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>`
        : `<td class="amount"><strong>${formatAmtPdf(item.DR_AMT)}</strong></td>
              <td class="amount"><strong>${formatAmtPdf(item.CR_AMT)}</strong></td>`;
      bodyRows += `
            <tr class="broker-os-pdf-broker-total">
              <td colspan="${brokerOsLabelColspan}" class="col-name"><strong>Broker total — ${bk}</strong></td>
              ${brkDrCr}
              <td class="amount">—</td>
              <td class="amount">—</td>
            </tr>`;
      return;
    }
    const row = item.row;
    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const vrDt = escHtml(formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date));
    const rowDrCr = crFirst
      ? `<td class="amount">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>
              <td class="amount">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>`
      : `<td class="amount">${formatAmtPdf(row.DR_AMT ?? row.dr_amt)}</td>
              <td class="amount">${formatAmtPdf(row.CR_AMT ?? row.cr_amt)}</td>`;
    const det = escHtml(String(row.DETAIL ?? row.detail ?? '').trim());
    bodyRows += `
            <tr>
              <td class="col-code">${escHtml(row.CODE ?? row.code ?? '')}</td>
              <td class="col-name">${escHtml(row.NAME ?? row.name ?? '')}</td>
              <td class="col-vr">${escHtml(row.BILL_NO ?? row.bill_no ?? '')}</td>
              <td class="col-date">${billDt}</td>
              <td class="col-type">${escHtml(row.VR_TYPE ?? row.vr_type ?? '')}</td>
              <td class="col-date">${vrDt}</td>
              <td class="col-vr">${escHtml(row.VR_NO ?? row.vr_no ?? '')}</td>
              <td class="col-detail">${det || '—'}</td>
              ${rowDrCr}
              <td class="amount bal">${formatAmtPdf(row.RUN_BAL ?? row.run_bal)}</td>
              <td class="amount">${formatAmtPdf(row.FINAL_BAL ?? row.final_bal)}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}
        table.broker-os-pdf-table .col-detail { max-width: 200px; word-wrap: break-word; overflow-wrap: break-word; font-size: 8px; line-height: 1.25; }
        tr.broker-os-pdf-broker-section-head td { background: #e0e7ff !important; font-weight: 700; color: #1e3a8a; border-top: 2px solid #6366f1; }
      </style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>BROKER-WISE OUTSTANDING</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Broker range</td><td class="val">${brk}</td></tr>
          <tr><td class="lbl">Party filter</td><td class="val" colspan="3">${party}</td></tr>
          <tr><td class="lbl">Bill dates</td><td class="val">${period}</td><td class="lbl">Payment ending</td><td class="val">${payEnd}</td></tr>
          <tr><td class="lbl">Filter</td><td class="val" colspan="3">${filt}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report broker-os-pdf-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Party</th>
            <th>Bill</th>
            <th>Bill dt</th>
            <th>Vr typ</th>
            <th>Vr dt</th>
            <th>Vr no</th>
            <th>Detail</th>
            ${crFirst ? '<th class="amount">Cr</th><th class="amount">Dr</th>' : '<th class="amount">Dr</th><th class="amount">Cr</th>'}
            <th class="amount">Run</th>
            <th class="amount">Final</th>
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="${brokerOsLabelColspan}" class="lbl-total">GRAND TOTAL (all detail lines)</td>
            ${
              crFirst
                ? `<td class="amount">${formatAmtPdf(grandCr)}</td>
            <td class="amount">${formatAmtPdf(grandDr)}</td>`
                : `<td class="amount">${formatAmtPdf(grandDr)}</td>
            <td class="amount">${formatAmtPdf(grandCr)}</td>`
            }
            <td class="amount">—</td>
            <td class="amount">—</td>
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Broker code and name appear above each broker block. Ordered by broker name (then broker code), then party name (A–Z) and code. Bills included only when BILLS has numeric B_CODE in range with VR_TYPE S, SE, or PU. Credits after payment ending date count as zero.
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

function buildAgeingReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year ?? '');
  const schedule = escHtml(metadata.schedule ?? '');
  const scheduleRaw = metadata.schedule;
  const endingDate = escHtml(metadata.endingDate ?? '');
  const modeLabel = escHtml(metadata.modeLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const labels = Array.isArray(metadata.rangeLabels) && metadata.rangeLabels.length === 5
    ? metadata.rangeLabels
    : ['0 to 30', '31 to 60', '61 to 90', '91 to 180', '181 to 99999'];

  let curBalDisplayed = 0;
  let curBalRaw = 0;
  const totals = [0, 0, 0, 0, 0];
  let bodyRows = '';
  (data || []).forEach((row) => {
    const rawBal = Number(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
    const { display, alert } = ageingCurBalDisplay(scheduleRaw, rawBal);
    curBalDisplayed += display;
    curBalRaw += rawBal;
    const curCellClass = alert ? 'amount ageing-cur-bal-alert' : 'amount';
    const bucketCells = labels
      .map((_, idx) => {
        const value = Number(row[`RANGE_${idx + 1}`] ?? row[`range_${idx + 1}`] ?? 0) || 0;
        totals[idx] += value;
        return `<td class="amount">${formatAmtPdf(value)}</td>`;
      })
      .join('');
    bodyRows += `
          <tr>
            <td class="col-code">${escHtml(row.CODE ?? row.code ?? '')}</td>
            <td class="col-name">${escHtml(row.NAME ?? row.name ?? '')}</td>
            <td>${escHtml(row.CITY ?? row.city ?? '')}</td>
            <td class="${curCellClass}"><strong>${formatAmtPdf(display)}</strong></td>
            ${bucketCells}
          </tr>`;
  });
  const totalCurAlert = ageingCurBalDisplay(scheduleRaw, curBalRaw).alert;
  const grandCurClass = totalCurAlert ? 'amount ageing-cur-bal-alert' : 'amount';

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">ACCOUNTING REPORT</div>
        <h1>AGEING REPORT</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Financial year</td><td class="val">${year}</td><td class="lbl">Schedule</td><td class="val">${schedule}</td></tr>
          <tr><td class="lbl">Ending date</td><td class="val">${endingDate}</td><td class="lbl">Source</td><td class="val">${modeLabel}</td></tr>
        </table>
        <div class="report-period"><strong>Generated:</strong> ${generated}</div>
      </div>

      <table class="table-report">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>City</th>
            <th class="amount">Cur. Bal</th>
            ${labels.map((label) => `<th class="amount">${escHtml(label)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${bodyRows}
          <tr class="report-grand-total">
            <td colspan="3" class="lbl-total">GRAND TOTAL</td>
            <td class="${grandCurClass}">${formatAmtPdf(curBalDisplayed)}</td>
            ${totals.map((value) => `<td class="amount">${formatAmtPdf(value)}</td>`).join('')}
          </tr>
        </tbody>
      </table>

      <div class="report-foot">
        Ageing buckets are based on residual FIFO balance in Ledger mode and grouped outstanding bill balance in Bills mode.
        <br />
        Computer-generated report — no signature required.
      </div>
    </div>
  `;
}

/** Sale list PDF (landscape): day totals (qty, wt, amt, bill amt), grand total, then item-wise summary */
function buildSaleListReportHtml(data, metadata) {
  const company = escHtml(metadata.companyName);
  const year = escHtml(metadata.year);
  const period = escHtml(metadata.endDate ?? '');
  const party = escHtml(metadata.partyLabel ?? '');
  const broker = escHtml(metadata.brokerLabel ?? '');
  const item = escHtml(metadata.itemLabel ?? '');
  const listType = escHtml(metadata.listTypeLabel ?? '');
  const billR = escHtml(metadata.billRangeLabel ?? '');
  const plantL = escHtml(metadata.plantLabel ?? '');
  const markaL = escHtml(metadata.markaLabel ?? '');
  const bTypeL = escHtml(metadata.bTypeLabel ?? '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const { displayRows } = buildSaleListDisplayRows(data);
  const C = 17;

  let body = '';
  displayRows.forEach((item) => {
    if (item.kind === 'day-header') {
      body += `<tr class="sale-list-pdf-banner"><td colspan="${C}"><strong>Day–${escHtml(item.dateLabel)}</strong></td></tr>`;
      return;
    }
    if (item.kind === 'day-total') {
      body += `<tr class="sale-list-pdf-subtotal">
            <td colspan="8"><strong>Day total</strong> — ${escHtml(item.dateLabel)}</td>
            <td class="amount"><strong>${formatAmtPdf(item.qnty)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.weight)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.amount)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.taxable)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.cgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.sgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.igstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.othExp5)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.billAmt)}</strong></td>
          </tr>`;
      return;
    }
    if (item.kind === 'bill-total') {
      const billCap = escHtml(`${item.type} / ${item.billDateLabel} / ${item.billNo} / ${item.bType}`);
      body += `<tr class="sale-list-pdf-subtotal sale-list-pdf-bill-total">
            <td colspan="8" title="Bill total — ${billCap}"><strong>Bill total</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.qnty)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.weight)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.amount)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.taxable)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.cgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.sgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.igstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.othExp5)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.billAmt)}</strong></td>
          </tr>`;
      return;
    }
    if (item.kind === 'bill-gap') {
      body += `<tr class="sale-list-pdf-bill-gap"><td colspan="${C}"></td></tr>`;
      return;
    }
    if (item.kind === 'section-label') {
      body += `<tr class="sale-list-pdf-section"><td colspan="${C}"><strong>${escHtml(item.label)}</strong></td></tr>`;
      return;
    }
    if (item.kind === 'item-col-head') {
      body += `<tr class="sale-list-pdf-item-head">
            <th>Item code</th>
            <th class="col-name">Item name</th>
            <th class="amount">Qty</th>
            <th class="amount">Weight</th>
            <th class="amount">Amount</th>
            <td colspan="12"></td>
          </tr>`;
      return;
    }
    if (item.kind === 'grand-item') {
      body += `<tr class="sale-list-pdf-itemsum">
            <td>${escHtml(item.code && item.code !== '—' ? item.code : '—')}</td>
            <td class="col-name">${escHtml(item.name)}</td>
            <td class="amount">${formatAmtPdf(item.qnty)}</td>
            <td class="amount">${formatAmtPdf(item.weight)}</td>
            <td class="amount">${formatAmtPdf(item.amount)}</td>
            <td colspan="12">—</td>
          </tr>`;
      return;
    }
    if (item.kind === 'grand-total') {
      body += `<tr class="sale-list-pdf-grand">
            <td colspan="8"><strong>Grand total</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.qnty)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.weight)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.amount)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.taxable)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.cgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.sgstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.igstAmt)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.othExp5)}</strong></td>
            <td class="amount"><strong>${formatAmtPdf(item.billAmt)}</strong></td>
          </tr>`;
      return;
    }
    const row = item.row;
    const billDt = escHtml(formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date));
    const typRaw = String(row.TYPE ?? row.type ?? '').trim().toUpperCase();
    const cnClass = isSaleListCn({ TYPE: typRaw }) ? ' class="sale-list-pdf-cn"' : '';
    body += `
            <tr${cnClass}>
              <td>${escHtml(row.TYPE ?? row.type)}</td>
              <td>${billDt}</td>
              <td>${escHtml(row.BILL_NO ?? row.bill_no)}</td>
              <td>${escHtml(row.CODE ?? row.code)}</td>
              <td class="col-name">${escHtml(row.NAME ?? row.name)}</td>
              <td>${escHtml(row.B_CODE ?? row.b_code ?? row.BK_CODE ?? row.bk_code)}</td>
              <td>${escHtml(row.ITEM_CODE ?? row.item_code)}</td>
              <td class="col-name">${escHtml(row.ITEM_NAME ?? row.item_name)}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'QNTY', 'qnty'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'WEIGHT', 'weight'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'AMOUNT', 'amount'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'TAXABLE', 'taxable'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'CGST_AMT', 'cgst_amt'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'SGST_AMT', 'sgst_amt'))}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'IGST_AMT', 'igst_amt'))}</td>
              <td class="amount">${formatAmtPdf(row.OTH_EXP5 ?? row.oth_exp5)}</td>
              <td class="amount">${formatAmtPdf(saleListMeas(row, 'BILL_AMT', 'bill_amt'))}</td>
            </tr>`;
  });

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">SALE BILL LIST</div>
        <h1>Sale bill list</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          FY <strong>${year}</strong> · Period <strong>${period}</strong><br />
          List: ${listType}<br />
          Bills: ${billR} · Party: ${party} · Broker: ${broker} · Item: ${item}<br />
          Plant: ${plantL} · Marka: ${markaL} · B type: ${bTypeL}<br />
          Generated: ${generated}
        </div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Type</th>
            <th>Bill date</th>
            <th>Bill no</th>
            <th>Code</th>
            <th>Name</th>
            <th>Bk</th>
            <th>Item</th>
            <th>Item name</th>
            <th class="amount">Qty</th>
            <th class="amount">Wt</th>
            <th class="amount">Amount</th>
            <th class="amount">Taxable</th>
            <th class="amount">CGST</th>
            <th class="amount">SGST</th>
            <th class="amount">IGST</th>
            <th class="amount">Round off</th>
            <th class="amount">Bill amt</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <div class="report-foot">Item-wise summary: columns Item code, Item name, Qty, Weight, Amount (full period). Final row is grand total. Bill subtotals appear only when a bill has more than one line; single-line bills have a spacer row before the next bill. Bill amount on lines may repeat per bill.</div>
    </div>
  `;
}

const SALE_BILL_PDF_STYLES = `
  .sb-pdf { font-size: 8px; line-height: 1.35; }
  .sb-pdf.sb-pdf-bos { font-size: 9px; line-height: 1.45; }
  .sb-pdf-top { display: grid; grid-template-columns: 132px 1fr 132px; align-items: flex-start; gap: 10px; margin-bottom: 10px; border-bottom: 2px solid #1e3a5f; padding-bottom: 8px; }
  .sb-pdf-logo { flex-shrink: 0; width: 132px; }
  .sb-pdf-logo img { width: 132px; height: 132px; object-fit: contain; display: block; }
  .sb-pdf-logo--empty { min-height: 132px; }
  .sb-pdf-top-main { width: 100%; max-width: 410px; margin: 0 auto; text-align: center; min-width: 0; }
  .sb-pdf-top-right { flex-shrink: 0; width: 132px; text-align: right; }
  .sb-pdf-top-right--empty { min-height: 132px; }
  .sb-pdf-title { font-size: 11px; font-weight: 800; letter-spacing: 0.06em; margin-bottom: 6px; color: #0f172a; }
  .sb-pdf.sb-pdf-bos .sb-pdf-title { font-size: 12px; }
  .sb-pdf-co { font-size: 22px; font-weight: 700; margin-bottom: 4px; color: #0047ab; }
  .sb-pdf.sb-pdf-bos .sb-pdf-co { font-size: 24px; color: #0047ab; }
  .sb-pdf-co { white-space: nowrap; display: block; width: 100%; }
  .sb-pdf-addr { font-size: 8px; color: #334155; }
  .sb-pdf-qr { flex-shrink: 0; width: 132px; }
  .sb-pdf-qr img { width: 132px; height: 132px; object-fit: contain; display: block; }
  .sb-pdf-inv { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 0; }
  .sb-pdf-inv-cn-sub { margin-top: 2px; padding-top: 4px; border-top: 1px dashed #94a3b8; }
  .sb-pdf-inv-cn-sub--3 { grid-template-columns: 1fr 1fr 1fr; }
  .sb-pdf-inv-item { display: block; font-size: 10.5px; font-weight: 700; }
  .sb-pdf-inv-item strong { font-weight: 800; }
  .sb-pdf-inv-rule { border: none; border-top: 2px solid #1e3a5f; margin: 3px 0 6px; }
  .sb-pdf-irn { font-size: 7.5px; color: #334155; margin-bottom: 8px; word-break: break-all; }
  .sb-pdf-party-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 8px; border: 1px solid #94a3b8; }
  .sb-pdf-party-grid td { width: 50%; padding: 6px 8px; vertical-align: top; border-right: 1px solid #cbd5e1; }
  .sb-pdf-party-grid td:last-child { border-right: none; }
  .sb-pdf-party-grid.sb-pdf-party-grid--three td { width: 33.33%; }
  .sb-pdf-two { display: table; width: 100%; border: 1px solid #94a3b8; margin-bottom: 8px; }
  .sb-pdf-two > div { display: table-cell; width: 50%; padding: 6px 8px; vertical-align: top; border-right: 1px solid #cbd5e1; }
  .sb-pdf-two.sb-pdf-three > div { width: 33.33%; }
  .sb-pdf-two > div:last-child { border-right: none; }
  .sb-pdf-h { font-weight: 700; color: #1e3a5f; margin-bottom: 4px; }
  .sb-pdf-broker { margin-bottom: 6px; font-size: 8px; }
  table.sb-pdf-grid { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 7px; }
  table.sb-pdf-grid.sb-pdf-grid-bos { font-size: 8.5px; }
  table.sb-pdf-grid th, table.sb-pdf-grid td { border: 1px solid #64748b; padding: 3px 4px; vertical-align: top; }
  table.sb-pdf-grid th { background: #e2e8f0; font-weight: 700; }
  table.sb-pdf-grid td.num { text-align: right; white-space: nowrap; font-family: Consolas, monospace; }
  table.sb-pdf-sum { width: 220px; margin-left: auto; border-collapse: collapse; font-size: 8px; margin-bottom: 0; }
  .sb-pdf.sb-pdf-bos table.sb-pdf-sum { font-size: 9px; }
  table.sb-pdf-sum td { border: 1px solid #64748b; padding: 4px 6px; }
  table.sb-pdf-sum td.num { text-align: right; }
  .sb-pdf-net-words-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; width: 220px; margin-left: auto; border: 1px solid #64748b; border-top: none; padding: 4px 6px; background: #f1f5f9; font-size: 7.5px; line-height: 1.35; box-sizing: border-box; }
  .sb-pdf.sb-pdf-bos .sb-pdf-net-words-row { font-size: 8.5px; }
  .sb-pdf-words-inline { flex: 1; min-width: 0; }
  .sb-pdf-net-amount { flex-shrink: 0; text-align: right; }
  .sb-pdf-sum-row { display: flex; justify-content: flex-end; width: 100%; align-items: flex-start; gap: 8px; }
  .sb-pdf-sum-row.sb-pdf-sum-row--with-qr { display: grid; grid-template-columns: 132px 220px; justify-content: end; }
  .sb-pdf-sum-main { width: 220px; }
  .sb-pdf-sum-main table.sb-pdf-sum { width: 100%; margin-left: 0; }
  .sb-pdf-sum-main .sb-pdf-net-words-row { width: 100%; margin-left: 0; }
  .sb-pdf-total-side { min-height: 132px; display: flex; align-items: flex-start; justify-content: center; }
  .sb-pdf-total-side-left { justify-content: flex-start; }
  .sb-pdf-total-side--empty { min-height: 132px; }
  .sb-pdf-total-side-left.sb-pdf-total-side--empty { display: none; }
  .sb-pdf-logo2 img { width: 132px; height: 132px; object-fit: contain; display: block; }
  .sb-pdf-footer-rule { border: none; border-top: 1px solid #64748b; margin: 6px 0 5px; }
  .sb-pdf-bank { margin-bottom: 6px; font-size: 7.5px; line-height: 1.35; color: #334155; }
  .sb-pdf-transport { font-size: 7.5px; line-height: 1.35; color: #334155; margin-bottom: 8px; }
  .sb-pdf-transport span { margin-right: 10px; }
  .sb-pdf-terms { margin-bottom: 8px; font-size: 5.6px; line-height: 1.1; color: #334155; }
  .sb-pdf-terms > div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sb-pdf-bottom { display: table; width: 100%; margin-top: 6px; }
  .sb-pdf-bottom-left, .sb-pdf-bottom-right { display: table-cell; vertical-align: top; }
  .sb-pdf-bottom-left { width: 65%; }
  .sb-pdf-bottom-right { width: 35%; text-align: right; }
  .sb-pdf-sign { text-align: right; margin-top: 0; font-size: 8px; }
  .sb-pdf-sign-stamp-gap { display: block; min-height: 30px; margin-top: 4px; }
  .sb-pdf-signature { margin-top: 4px; }
  .sb-pdf-signature img { max-width: 130px; max-height: 65px; object-fit: contain; }
  .sb-pdf-auth { margin-top: 10px; color: #475569; }
  .sb-pdf-party-name { font-weight: 700; }
`;

/** VFP parity: DISPLAY_RATE server-side else RATE_QW when ≠ 0, else RATE. */
function pdfEffectiveSaleBillRate(row) {
  if (!row || typeof row !== 'object') return 0;
  const drRaw = row.DISPLAY_RATE ?? row.display_rate;
  if (drRaw != null && drRaw !== '') {
    const p = parseFloat(drRaw);
    if (!Number.isNaN(p)) return p;
  }
  const rq = parseFloat(row.RATE_QW ?? row.rate_qw ?? 0) || 0;
  if (Math.abs(rq) > 0.000001) return rq;
  return parseFloat(row.RATE ?? row.rate ?? 0) || 0;
}

/** Sale bill / tax invoice PDF (portrait) */
function buildSaleBillReportHtml(data, metadata) {
  const { lines, header, first, docTitle, totals, qrDataUrl } = data;
  const h = header || {};
  const f = first || {};
  const apiBase = String(metadata?.apiBase || '').trim();
  const companyRaw = String(metadata.companyName || '').trim();
  const company = escHtml(companyRaw || 'Company');
  const fv = (logical) => {
    const raw = rowFieldCI(f, logical);
    return raw ? escHtml(raw) : '';
  };

  const saleInv = escHtml(rowFieldCI(f, 'sale_inv_no') || '—');
  const billDt = escHtml(formatLedgerDateDisplay(f.BILL_DATE ?? f.bill_date ?? rowFieldCI(f, 'bill_date')));
  const t = totals || {};
  const taxLabel = (name, perRaw) => {
    const per = Number(perRaw);
    if (!Number.isFinite(per) || Math.abs(per) < 0.0001) return name;
    const clean = Number.isInteger(per) ? String(per) : per.toFixed(2).replace(/\.?0+$/, '');
    return `${name} (${clean}%)`;
  };
  const cgstLabel = taxLabel('CGST', saleBillTaxPercentForHeader(lines, f, 'cgst_per'));
  const sgstLabel = taxLabel('SGST', saleBillTaxPercentForHeader(lines, f, 'sgst_per'));
  const igstLabel = taxLabel('IGST', saleBillTaxPercentForHeader(lines, f, 'igst_per'));
  const taxSumPdf = Math.abs(Number(t.sumC || 0)) + Math.abs(Number(t.sumS || 0)) + Math.abs(Number(t.sumI || 0));
  const docUpper = String(docTitle || '').toUpperCase();
  const isCreditNotePdf = docUpper === 'CREDIT NOTE';
  const cnBillNoEsc = escHtml(rowFieldCI(f, 'bill_no') || '—');
  const sbNoEsc = escHtml(rowFieldAny(f, ['sb_no', 'SB_NO']) || '—');
  const sbTypeEsc = escHtml(rowFieldAny(f, ['sb_type', 'SB_TYPE']) || '—');
  const sbDateEsc = escHtml(formatLedgerDateDisplay(f.SB_DATE ?? f.sb_date) || '—');
  const isBillOfSupplyNoTax =
    taxSumPdf < 0.0001 && (docUpper === 'BILL OF SUPPLY' || docUpper === 'CREDIT NOTE');
  /** Line-level discount column only when CGST+SGST+IGST ≠ 0; else discount only in summary after total amount. */
  const showDiscountColPdf = !isBillOfSupplyNoTax;
  const askGrossDane = String(metadata?.printGrossDane || '').trim().toUpperCase();
  const askPacking = String(metadata?.printPacking || '').trim().toUpperCase();
  const printGWeightDefaultPdf =
    String(rowFieldCI(f, 'print_g_weight') || rowFieldCI(f, 'g_weight') || '')
      .trim()
      .toUpperCase() === 'Y';
  const printGWeightPdf = askGrossDane === 'Y' ? true : askGrossDane === 'N' ? false : printGWeightDefaultPdf;
  const printPackingDefaultPdf = String(rowFieldCI(f, 'print_packing') || '').trim().toUpperCase() === 'Y';
  const printPackingPdf = askPacking === 'Y' ? true : askPacking === 'N' ? false : printPackingDefaultPdf || printGWeightPdf;
  const gWgtKqPdf = String(rowFieldCI(f, 'wgt_k_q') || 'K').trim().toUpperCase() || 'K';
  const gWeightHeaderPdf = escHtml(
    String(rowFieldCI(f, 'g_weight_header') || (gWgtKqPdf === 'K' ? 'In Kg.' : 'In Qtl.')).trim()
  );
  const dWeightHeaderPdf = escHtml(String(rowFieldCI(f, 'd_weight_header') || (gWgtKqPdf === 'K' ? 'In Kg.' : 'In Qtl.')).trim());
  const rateHeaderPdf = escHtml(String(rowFieldCI(f, 'g_rate_header') || 'In Qtl.').trim());
  const companyNameBasePx = isBillOfSupplyNoTax ? 24 : 22;
  const companyNameFontPx = (() => {
    const len = companyRaw.length;
    if (len <= 22) return companyNameBasePx;
    const reduced = companyNameBasePx - (len - 22) * 0.45;
    return Math.max(13, Math.round(reduced * 100) / 100);
  })();

  const qds = qrDataUrl ? String(qrDataUrl) : '';
  const qrSafe =
    qds && (/^https?:\/\//i.test(qds) || qds.startsWith('data:image/')) ? qds : '';
  const qrHtml = qrSafe ? `<div class="sb-pdf-qr"><img src="${qrSafe}" alt="" /></div>` : '';
  const logoSafe = normalizePrintImageSrc(
    rowFieldCI(f, 'sale_logo') || rowFieldCI(h, 'sale_logo'),
    apiBase
  );
  const logoHtml = logoSafe ? `<div class="sb-pdf-logo"><img src="${logoSafe}" alt="" /></div>` : '<div class="sb-pdf-logo sb-pdf-logo--empty"></div>';
  const logo2Safe = normalizePrintImageSrc(
    rowFieldCI(f, 'sale_logo2') || rowFieldCI(h, 'sale_logo2'),
    apiBase
  );
  const signatureSafe = normalizePrintImageSrc(
    rowFieldCI(f, 'signature_file') || rowFieldCI(h, 'signature_file'),
    apiBase
  );
  const signatureHtml = signatureSafe
    ? `<div class="sb-pdf-signature"><img src="${signatureSafe}" alt="" /></div>`
    : '';

  let bodyRows = '';
  (lines || []).forEach((row, i) => {
    const discountCell = showDiscountColPdf
      ? `<td class="num">${formatAmtPdf(row.DIS_AMT ?? row.dis_amt)}</td>`
      : '';
    const taxCellsAfterDisc = !isBillOfSupplyNoTax
      ? `
              <td class="num">${formatAmtPdf(row.TAXABLE ?? row.taxable)}</td>
              <td class="num">${formatAmtPdf(row.CGST_AMT ?? row.cgst_amt)}</td>
              <td class="num">${formatAmtPdf(row.SGST_AMT ?? row.sgst_amt)}</td>
              <td class="num">${formatAmtPdf(row.IGST_AMT ?? row.igst_amt)}</td>`
      : '';
    bodyRows += `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(sbCell(row, 'ITEM_NAME', 'item_name'))}</td>
              ${printPackingPdf ? `<td>${escHtml(String(sbCell(row, 'PACKING', 'packing') || '').slice(0, 3))}</td>` : ''}
              <td>${escHtml(String(sbCell(row, 'HSN_CODE', 'hsn_code') || '').slice(0, 8))}</td>
              <td style="white-space:nowrap;">${escHtml(saleBillStatusUnitLabel(row.STATUS ?? row.status))}</td>
              <td class="num">${formatQtyPdf(row.QNTY ?? row.qnty)}</td>
              ${printGWeightPdf ? `<td class="num">${formatQtyPdf(row.G_WEIGHT ?? row.g_weight)}</td>` : ''}
              ${printGWeightPdf ? `<td class="num">${formatQtyPdf(row.D_WEIGHT ?? row.d_weight)}</td>` : ''}
              <td class="num">${formatQtyPdf(row.WEIGHT ?? row.weight)}</td>
              <td class="num">${formatAmtPdf(pdfEffectiveSaleBillRate(row))}</td>
              <td class="num">${formatAmtPdf(row.AMOUNT ?? row.amount)}</td>
              ${discountCell}${taxCellsAfterDisc}
            </tr>`;
  });

  const netPayPdf =
    typeof t.netPayable === 'number' ? t.netPayable : Number(t.billAmt != null ? t.billAmt : t.sumAmt || 0);
  const words = escHtml(rupeesToWords(netPayPdf || 0));
  let brokerLine =
    [rowFieldCI(f, 'bk_name'), rowFieldCI(f, 'b_code') || rowFieldCI(f, 'bk_code')]
      .filter(Boolean)
      .join(' — ') || '—';
  const bkTelPdf = rowFieldCI(f, 'b_tel_no');
  if (bkTelPdf) brokerLine += (brokerLine === '—' ? '' : ' — ') + `Tel ${bkTelPdf}`;
  const bankAcNo = rowFieldAny(h, ['G_BANK_AC_NO', 'g_bank_ac_no', 'bank_ac_no', 'BANK_AC_NO']);
  const bankAcNo1 = rowFieldAny(h, [
    'G_BANK_AC_NO2',
    'g_bank_ac_no2',
    'bank_ac_no2',
    'BANK_AC_NO2',
    'bank_ac_no1',
    'BANK_AC_NO1',
  ]);
  const bankHtml =
    bankAcNo || bankAcNo1
      ? `<div class="sb-pdf-bank">${bankAcNo ? `<div>${escHtml(bankAcNo)}</div>` : ''}${
          bankAcNo1 ? `<div>${escHtml(bankAcNo1)}</div>` : ''
        }</div>`
      : '';
  const truckNo = rowFieldCI(f, 'truck_no');
  const tptVal = rowFieldCI(f, 'tpt');
  const grNoVal = rowFieldCI(f, 'gr_no');
  const driverVal = rowFieldCI(f, 'driver');
  const detailVal = rowFieldCI(f, 'detail');
  const transportHtml =
    truckNo || tptVal || grNoVal || driverVal || detailVal
      ? `<div class="sb-pdf-transport">${
          truckNo ? `<span><strong>Truck no.:</strong> ${escHtml(truckNo)}</span>` : ''
        }${tptVal ? `<span><strong>Tpt:</strong> ${escHtml(tptVal)}</span>` : ''}${
          driverVal ? `<span><strong>Driver:</strong> ${escHtml(driverVal)}</span>` : ''
        }${grNoVal ? `<span><strong>GR no.:</strong> ${escHtml(grNoVal)}</span>` : ''}${
          detailVal ? `<div><strong>Remarks:</strong> ${escHtml(detailVal)}</div>` : ''
        }</div>`
      : '';
  const godAdd1 = rowFieldCI(f, 'god_add1');
  const godAdd2 = rowFieldCI(f, 'god_add2');
  const godGst = rowFieldCI(f, 'god_gst_no');
  const godState = rowFieldCI(f, 'god_state');
  const godTel1 = rowFieldCI(f, 'god_tel_no_1');
  const godTel2 = rowFieldCI(f, 'god_tel_no_2');
  const godFssai = rowFieldCI(f, 'god_fssai_no');
  const hasDispatchPdf = !!(godAdd1 || godAdd2 || godGst || godState || godTel1 || godTel2 || godFssai);
  const partyColWidth = hasDispatchPdf ? '33.33%' : '50%';
  const dispatchColHtml =
    hasDispatchPdf
      ? `<td style="width:${partyColWidth}; vertical-align:top; padding:6px 8px; border-right:none;">
          <div class="sb-pdf-h">Dispatch From</div>
          ${godAdd1 ? `<div>${escHtml(godAdd1)}</div>` : ''}
          ${godAdd2 ? `<div>${escHtml(godAdd2)}</div>` : ''}
          ${godGst ? `<div>GST No.: ${escHtml(godGst)}</div>` : ''}
          ${godState ? `<div>State: ${escHtml(godState)}</div>` : ''}
          ${godTel1 || godTel2 ? `<div>Tel: ${escHtml([godTel1, godTel2].filter(Boolean).join(', '))}</div>` : ''}
          ${godFssai ? `<div>Fssai No.: ${escHtml(godFssai)}</div>` : ''}
        </td>`
      : '';
  const terms = ['cond1', 'cond2', 'cond3', 'cond4', 'cond5', 'cond6', 'cond7']
    .map((k) => rowFieldCI(f, k))
    .filter((x) => x != null && String(x).trim() !== '');
  const termsHtml =
    terms.length > 0
      ? `<div class="sb-pdf-terms">
          <div class="sb-pdf-h">Terms &amp; Conditions:</div>
          ${terms.map((term) => `<div>${escHtml(term)}</div>`).join('')}
        </div>`
      : '';
  const companyFssaiHeading = stripLeadingRegistrationJunk(
    rowFieldAny(h, ['fssai_no']) || rowFieldAny(h, ['comp_tin', 'iec_no'])
  );
  const llpin = cleanPrintText(rowFieldAny(h, ['llpin']));
  const cinNo = cleanPrintText(rowFieldAny(h, ['cin_no', 'CIN_NO', 'G_CIN_NO', 'g_cin_no']));
  const msmeNo = stripLeadingRegistrationJunk(
    rowFieldAny(h, ['msme_no', 'MSME_no', 'MSME_NO', 'G_MSME_NO', 'g_msme_no'])
  );
  const udyamRegNo = stripLeadingRegistrationJunk(rowFieldAny(h, ['udyam_no', 'G_UDYAM_NO', 'g_udyam_no', 'udyam_reg_no']));
  const emailVal = cleanPrintText(rowFieldAny(h, ['comp_email', 'G_EMAIL', 'g_email', 'email']));
  const websiteVal = cleanPrintText(rowFieldAny(h, ['website', 'web_site', 'comp_website', 'site', 'url']));
  const compAdd1 = cleanPrintText(rowFieldAny(h, ['comp_add1', 'compadd1', 'address1']));
  const compAdd2 = cleanPrintText(rowFieldAny(h, ['comp_add2', 'compadd2', 'address2']));
  const compAdd3 = cleanPrintText(rowFieldAny(h, ['comp_add3', 'compadd3', 'address3']));
  const compTel1 = cleanPrintText(rowFieldAny(h, ['comp_tel1', 'comptel1', 'tel1', 'phone1']));
  const compTel2 = cleanPrintText(rowFieldAny(h, ['comp_tel2', 'comptel2', 'tel2', 'phone2']));
  const compGst = cleanPrintText(rowFieldAny(h, ['gst_no', 'gstno', 'comp_gst', 'gstin']));
  const compPan = cleanPrintText(rowFieldAny(h, ['comp_pan', 'pan', 'company_pan']));
  const headingLines = [];
  if (compAdd1) headingLines.push(compAdd1);
  if (compAdd2) headingLines.push(compAdd2);
  if (compAdd3) headingLines.push(compAdd3);
  const phoneLine = [compTel1, compTel2].filter(Boolean).join(' ');
  if (phoneLine) headingLines.push(`Tel: ${phoneLine}`);
  const gstPanLine = [compGst ? `GST: ${compGst}` : '', compPan ? `PAN: ${compPan}` : '']
    .filter(Boolean)
    .join('    |    ');
  if (gstPanLine) headingLines.push(gstPanLine);
  if (companyFssaiHeading) headingLines.push(`Fssai No.: ${companyFssaiHeading}`);
  if (llpin) headingLines.push(`LLPIN: ${llpin}`);
  if (udyamRegNo) headingLines.push(`Udyam No.: ${udyamRegNo}`);
  const tailHeadingLines = [];
  if (emailVal) tailHeadingLines.push(`Email: ${emailVal}`);
  if (cinNo) tailHeadingLines.push(`CIN: ${cinNo}`);
  if (msmeNo) tailHeadingLines.push(`MSME No.: ${msmeNo}`);
  if (websiteVal) tailHeadingLines.push(`Website: ${websiteVal}`);
  const maxHeadingLines = 8;
  const keepFromMain = Math.max(0, maxHeadingLines - tailHeadingLines.length);
  const mainHeadingLines = [...headingLines.slice(0, keepFromMain), ...tailHeadingLines].slice(0, maxHeadingLines);
  const totalsLeftQrHtml = qrHtml ? `<div class="sb-pdf-total-side sb-pdf-total-side-left">${qrHtml}</div>` : '';
  const totalsRowClass = qrHtml ? 'sb-pdf-sum-row sb-pdf-sum-row--with-qr' : 'sb-pdf-sum-row';
  const topRightLogo2Html = logo2Safe
    ? `<div class="sb-pdf-top-right"><div class="sb-pdf-logo2"><img src="${logo2Safe}" alt="" /></div></div>`
    : '<div class="sb-pdf-top-right sb-pdf-top-right--empty"></div>';

  const irnPdfTxt = saleBillEinvoiceText(f, ['IRN_NO', 'irn_no']);
  const ackPdfTxt = saleBillEinvoiceText(f, ['ACK_NO', 'ack_no']);
  const ewayPdfTxt = saleBillEinvoiceText(f, ['EWAY_NO', 'eway_no']);
  const irnPdfParts = [];
  if (irnPdfTxt) irnPdfParts.push(`<div>IRN: ${escHtml(irnPdfTxt)}</div>`);
  if (ackPdfTxt) irnPdfParts.push(`<div>ACK: ${escHtml(ackPdfTxt)}</div>`);
  if (ewayPdfTxt) irnPdfParts.push(`<div>E-Way: ${escHtml(ewayPdfTxt)}</div>`);
  const irnPdfBlockHtml = irnPdfParts.length ? `<div class="sb-pdf-irn">${irnPdfParts.join('')}</div>` : '';

  return `
    <div class="report-doc sb-pdf${isBillOfSupplyNoTax ? ' sb-pdf-bos' : ''}">
      <style>${PDF_REPORT_STYLES}${SALE_BILL_PDF_STYLES}</style>
      <div class="sb-pdf-top">
        ${logoHtml}
        <div class="sb-pdf-top-main">
          <div class="sb-pdf-title">${escHtml(docTitle || '')}</div>
          <div class="sb-pdf-co" style="font-size:${companyNameFontPx}px">${company}</div>
          ${mainHeadingLines.map((line) => `<div class="sb-pdf-addr">${escHtml(line)}</div>`).join('')}
        </div>
        ${topRightLogo2Html}
      </div>

      ${
        isCreditNotePdf
          ? `<div class="sb-pdf-inv">
        <span class="sb-pdf-inv-item"><strong>Credit Note no.</strong> ${cnBillNoEsc}</span>
        <span class="sb-pdf-inv-item"><strong>Dated</strong> ${billDt}</span>
      </div>
      <div class="sb-pdf-inv sb-pdf-inv-cn-sub sb-pdf-inv-cn-sub--3">
        <span class="sb-pdf-inv-item"><strong>Invoice no.</strong> ${sbNoEsc}</span>
        <span class="sb-pdf-inv-item"><strong>Type</strong> ${sbTypeEsc}</span>
        <span class="sb-pdf-inv-item"><strong>Invoice date</strong> ${sbDateEsc}</span>
      </div>`
          : `<div class="sb-pdf-inv">
        <span class="sb-pdf-inv-item"><strong>Invoice no.</strong> ${saleInv}</span>
        <span class="sb-pdf-inv-item"><strong>Dated</strong> ${billDt}</span>
      </div>`
      }
      <hr class="sb-pdf-inv-rule" />
      ${irnPdfBlockHtml}

      <table class="sb-pdf-party-grid ${dispatchColHtml ? 'sb-pdf-party-grid--three' : ''}" style="width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:8px; border:1px solid #94a3b8;">
        <tr>
        <td style="width:${partyColWidth}; vertical-align:top; padding:6px 8px; border-right:1px solid #cbd5e1;">
          <div class="sb-pdf-h">Buyer (billed to)</div>
          <div class="sb-pdf-party-name">${fv('name')}</div>
          <div>${fv('add1')}</div>
          <div>${fv('add2')}</div>
          <div>${fv('add3')}</div>
          <div>${fv('city')}</div>
          ${fv('tin') ? `<div>TIN: ${fv('tin')}</div>` : ''}
          ${fv('tel_no_o') ? `<div>Tel: ${fv('tel_no_o')}</div>` : ''}
          ${fv('bill_cond') ? `<div>${fv('bill_cond')}</div>` : ''}
          <div>GST: ${fv('gst_no') || '—'}</div>
          <div>PAN: ${fv('pan') || '—'}</div>
        </td>
        <td style="width:${partyColWidth}; vertical-align:top; padding:6px 8px; border-right:${dispatchColHtml ? '1px solid #cbd5e1' : 'none'};">
          <div class="sb-pdf-h">Shipped to</div>
          <div class="sb-pdf-party-name">${fv('delv_name') || '—'}</div>
          <div>${fv('delv_add1') || '—'}</div>
          <div>${fv('delv_add2') || '—'}</div>
          <div>${fv('delv_add3') || ''}</div>
          <div>${fv('delv_city') || '—'}</div>
          ${fv('delv_state_code') || fv('delv_state') ? `<div>${fv('delv_state_code')}${fv('delv_state') ? ` — ${fv('delv_state')}` : ''}</div>` : ''}
          ${fv('delv_tel_no_o') ? `<div>Tel: ${fv('delv_tel_no_o')}</div>` : ''}
          ${fv('delv_fssai_no') ? `<div>FSSAI: ${fv('delv_fssai_no')}</div>` : ''}
          <div>GST: ${fv('delv_gst_no') || '—'}</div>
          <div>PAN: ${fv('delv_pan') || '—'}</div>
        </td>
        ${dispatchColHtml}
        </tr>
      </table>

      <div class="sb-pdf-broker"><strong>Broker:</strong> ${escHtml(brokerLine)}</div>

      <table class="sb-pdf-grid${isBillOfSupplyNoTax ? ' sb-pdf-grid-bos' : ''}">
        <thead>
          <tr>
            <th>Sno</th>
            <th>Particulars</th>
            ${printPackingPdf ? '<th style="width:54px; white-space:nowrap;">Packing</th>' : ''}
            <th style="width:76px; white-space:nowrap;">Hsn Code</th>
            <th style="width:58px; white-space:nowrap;">Unit</th>
            <th class="num">Qty</th>
            ${printGWeightPdf ? `<th class="num">G.Wt<br><small>${gWeightHeaderPdf}</small></th>` : ''}
            ${printGWeightPdf ? `<th class="num">Dane<br><small>${dWeightHeaderPdf}</small></th>` : ''}
            <th class="num">Wt<br><small>${gWeightHeaderPdf}</small></th>
            <th class="num">Rate<br><small>${rateHeaderPdf}</small></th>
            <th class="num">Amount<br><small>In Rs.</small></th>
            ${showDiscountColPdf ? `<th class="num">Disc</th>` : ''}
            ${
              !isBillOfSupplyNoTax
                ? `<th class="num">Taxable</th><th class="num">${escHtml(cgstLabel)}</th><th class="num">${escHtml(sgstLabel)}</th><th class="num">${escHtml(igstLabel)}</th>`
                : ''
            }
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <div class="${totalsRowClass}">
        ${totalsLeftQrHtml}
        <div class="sb-pdf-sum-main">
          <table class="sb-pdf-sum">
            <tbody>
              <tr><td>Total amount</td><td class="num">${formatAmtPdf(t.sumAmt)}</td></tr>
              ${showSaleBillLessBrokerage(f, t) ? `<tr><td>Less brokerage</td><td class="num">${formatAmtPdf(t.sumBk)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumDami || 0)) > 0.0001 ? `<tr><td>Dami</td><td class="num">${formatAmtPdf(t.sumDami)}</td></tr>` : ''}
              ${Math.abs(Number(t.disAmt || 0)) > 0.0001 ? `<tr><td>Discount${Math.abs(Number(t.disPerBill || 0)) > 0.0001 ? ` @ ${formatAmtPdf(t.disPerBill)}%` : ''}</td><td class="num">${formatAmtPdf(t.disAmt)}</td></tr>` : ''}
              ${
                !isBillOfSupplyNoTax
                  ? `${Math.abs(Number(t.sumTax || 0)) > 0.0001 ? `<tr><td>Total taxable</td><td class="num">${formatAmtPdf(t.sumTax)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumC || 0)) > 0.0001 ? `<tr><td>${escHtml(cgstLabel)}</td><td class="num">${formatAmtPdf(t.sumC)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumS || 0)) > 0.0001 ? `<tr><td>${escHtml(sgstLabel)}</td><td class="num">${formatAmtPdf(t.sumS)}</td></tr>` : ''}
              ${Math.abs(Number(t.sumI || 0)) > 0.0001 ? `<tr><td>${escHtml(igstLabel)}</td><td class="num">${formatAmtPdf(t.sumI)}</td></tr>` : ''}`
                  : ''
              }
              ${Math.abs(Number(t.freight || 0)) > 0.0001 ? `<tr><td>Freight</td><td class="num">${formatAmtPdf(t.freight)}</td></tr>` : ''}
              ${Math.abs(Number(t.labourBill || 0)) > 0.0001 ? `<tr><td>Labour</td><td class="num">${formatAmtPdf(t.labourBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.insuranceBill || 0)) > 0.0001 ? `<tr><td>Insurance</td><td class="num">${formatAmtPdf(t.insuranceBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.othExpBill || 0)) > 0.0001 ? `<tr><td>${escHtml(t.othNameBill || 'Other expense')}</td><td class="num">${formatAmtPdf(t.othExpBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.labAmtBill || 0)) > 0.0001 ? `<tr><td>Lab amount</td><td class="num">${formatAmtPdf(t.labAmtBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.bardAmtBill || 0)) > 0.0001 ? `<tr><td>Bardana</td><td class="num">${formatAmtPdf(t.bardAmtBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.fgtAmtBill || 0)) > 0.0001 ? `<tr><td>Freight (FGT)</td><td class="num">${formatAmtPdf(t.fgtAmtBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.insAmtBill || 0)) > 0.0001 ? `<tr><td>Insurance (alloc.)</td><td class="num">${formatAmtPdf(t.insAmtBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.othAmtBill || 0)) > 0.0001 ? `<tr><td>Other charges</td><td class="num">${formatAmtPdf(t.othAmtBill)}</td></tr>` : ''}
              ${Math.abs(Number(t.tcsAmt || 0)) > 0.0001 ? `<tr><td>TCS${Math.abs(Number(t.tcsPerBill || 0)) > 0.0001 ? ` @ ${formatAmtPdf(t.tcsPerBill)}%` : ''}</td><td class="num">${formatAmtPdf(t.tcsAmt)}</td></tr>` : ''}
              ${(Array.isArray(t.expenseItems) ? t.expenseItems : [])
                .map(
                  (item) =>
                    `<tr><td>${escHtml(item.label || 'Other expense')}</td><td class="num">${formatAmtPdf(item.amount)}</td></tr>`
                )
                .join('')}
              ${Math.abs(Number(t.othExp5 || 0)) > 0.0001 ? `<tr><td>Round off</td><td class="num">${formatAmtPdf(t.othExp5)}</td></tr>` : ''}
              <tr><td><strong>Net amount</strong></td><td class="num"><strong>${formatAmtPdf(t.billAmt)}</strong></td></tr>
              ${Math.abs(Number(t.tdsAmt || 0)) > 0.0001 ? `<tr><td>Less TDS${Math.abs(Number(t.tdsPerBill || 0)) > 0.0001 ? ` @ ${formatAmtPdf(t.tdsPerBill)}%` : ''}${Math.abs(Number(t.tdsOnBill || 0)) > 0.0001 ? ` on ${formatAmtPdf(t.tdsOnBill)}` : ''}</td><td class="num">${formatAmtPdf(t.tdsAmt)}</td></tr>` : ''}
              ${Math.abs(Number(t.tdsAmt || 0)) > 0.0001 ? `<tr><td><strong>Net amount payable</strong></td><td class="num"><strong>${formatAmtPdf(t.netPayable)}</strong></td></tr>` : ''}
            </tbody>
          </table>
          <div class="sb-pdf-net-words-row">
            <div class="sb-pdf-words-inline"><strong>Rs in words:</strong> ${words}</div>
            <div class="sb-pdf-net-amount">
              <div><strong>Net amount payable</strong></div>
              <div class="num"><strong>${formatAmtPdf(t.netPayable != null ? t.netPayable : t.billAmt)}</strong></div>
            </div>
          </div>
        </div>
      </div>
      ${bankHtml}
      ${transportHtml}
      <hr class="sb-pdf-footer-rule" />
      <div class="sb-pdf-bottom">
        <div class="sb-pdf-bottom-left">${termsHtml}</div>
        <div class="sb-pdf-bottom-right">
          <div class="sb-pdf-sign">
            <div>For ${company}</div>
            <div class="sb-pdf-sign-stamp-gap"></div>
            ${signatureHtml}
            <div class="sb-pdf-auth">Authorised signatory</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function stockNum(row, u, l) {
  const v = row?.[u] ?? row?.[l];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function formatStockPdf(n, frac = 2) {
  const v = parseFloat(n) || 0;
  return v.toLocaleString('en-IN', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

/** Item-wise stock summary (STOCK) */
function buildStockSumReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const startDt = escHtml(metadata.startDate || '');
  const endDt = escHtml(metadata.endDate || '');
  const itemLabel = escHtml(metadata.itemLabel ?? 'All');
  const plantLabel = escHtml(metadata.plantLabel ?? 'All');
  const catLabel = escHtml(metadata.catLabel ?? 'All');
  const rfLabel = escHtml(metadata.rfLabel ?? 'All');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tPur = 0;
  let tOp = 0;
  let tProd = 0;
  let tJb = 0;
  let tJi = 0;
  let tMill = 0;
  let tSale = 0;
  let tCnote = 0;
  let tCl = 0;

  let body = '';
  rows.forEach((r) => {
    tOp += stockNum(r, 'OP_BALANCE', 'op_balance');
    tPur += stockNum(r, 'PUR_WT', 'pur_wt');
    tProd += stockNum(r, 'PROD_WT', 'prod_wt');
    tJb += stockNum(r, 'JB_WT', 'jb_wt');
    tJi += stockNum(r, 'JI_WT', 'ji_wt');
    tMill += stockNum(r, 'MILLING_WT', 'milling_wt');
    tSale += stockNum(r, 'SALE_WT', 'sale_wt');
    tCnote += stockNum(r, 'CNOTE_WT', 'cnote_wt');
    tCl += stockNum(r, 'CL_WT', 'cl_wt');
    body += `<tr>
      <td>${escHtml(r.MAIN_CAT ?? r.main_cat ?? '')}</td>
      <td>${escHtml(r.CAT_CODE ?? r.cat_code ?? '')}</td>
      <td>${escHtml(r.ITEM_CODE ?? r.item_code ?? '')}</td>
      <td class="col-name">${escHtml(r.ITEM_NAME ?? r.item_name ?? '')}</td>
      <td>${escHtml(r.PLANT_CODE ?? r.plant_code ?? '')}</td>
      <td>${escHtml(r.R_F ?? r.r_f ?? '')}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'OP_BALANCE', 'op_balance'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'PUR_WT', 'pur_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'PROD_WT', 'prod_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'JB_WT', 'jb_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'JI_WT', 'ji_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'MILLING_WT', 'milling_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'SALE_WT', 'sale_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'CNOTE_WT', 'cnote_wt'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'CL_WT', 'cl_wt'))}</td>
    </tr>`;
  });

  const grandRow = `<tr class="report-grand-total">
    <td colspan="6" class="lbl-total">Grand total (${rows.length} rows)</td>
    <td class="amount">${formatStockPdf(tOp)}</td>
    <td class="amount">${formatStockPdf(tPur)}</td>
    <td class="amount">${formatStockPdf(tProd)}</td>
    <td class="amount">${formatStockPdf(tJb)}</td>
    <td class="amount">${formatStockPdf(tJi)}</td>
    <td class="amount">${formatStockPdf(tMill)}</td>
    <td class="amount">${formatStockPdf(tSale)}</td>
    <td class="amount">${formatStockPdf(tCnote)}</td>
    <td class="amount">${formatStockPdf(tCl)}</td>
  </tr>`;

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock sum</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          Date <strong>${startDt}</strong> – <strong>${endDt}</strong> · Item: <strong>${itemLabel}</strong><br />
          Plant: <strong>${plantLabel}</strong> · Cat: <strong>${catLabel}</strong> · R/F: <strong>${rfLabel}</strong><br />
          Generated: ${generated}
        </div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Main cat</th>
            <th>Cat</th>
            <th>Item</th>
            <th>Name</th>
            <th>Plant</th>
            <th>R/F</th>
            <th class="amount">Op bal</th>
            <th class="amount">Pur wt</th>
            <th class="amount">Prod wt</th>
            <th class="amount">JB wt</th>
            <th class="amount">JI wt</th>
            <th class="amount">Milling wt</th>
            <th class="amount">Sale wt</th>
            <th class="amount">CNote wt</th>
            <th class="amount">CL wt</th>
          </tr>
        </thead>
        <tbody>${body}${grandRow}</tbody>
      </table>
      <div class="report-foot">StockSum summary from STOCK table with item/plant/category filters.</div>
    </div>
  `;
}

/** Lot-wise lines for one item with running balance */
function buildStockSumDetailReportHtml(data, metadata) {
  const raw = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const endDt = escHtml(metadata.endDate || '');
  const god = escHtml(metadata.godLabel ?? '');
  const itemCode = escHtml(metadata.itemCode || '');
  const itemName = escHtml(metadata.itemName || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let runQ = 0;
  let runW = 0;
  let runG = 0;
  let body = '';
  raw.forEach((r) => {
    const rq = stockNum(r, 'R_QNTY', 'r_qnty');
    const sq = stockNum(r, 'S_QNTY', 's_qnty');
    const rw = stockNum(r, 'R_WEIGHT', 'r_weight');
    const sw = stockNum(r, 'S_WEIGHT', 's_weight');
    const rg = stockNum(r, 'R_G_WEIGHT', 'r_g_weight');
    const sg = stockNum(r, 'SG_WEIGHT', 'sg_weight');
    runQ += rq - sq;
    runW += rw - sw;
    runG += rg - sg;
    const vdt = escHtml(formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date));
    body += `<tr>
      <td>${vdt}</td>
      <td>${escHtml(String(r.VR_NO ?? r.vr_no ?? ''))}</td>
      <td>${escHtml(String(r.VR_TYPE ?? r.vr_type ?? ''))}</td>
      <td>${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
      <td>${escHtml(String(r.LOT ?? r.lot ?? ''))}</td>
      <td>${escHtml(String(r.STATUS ?? r.status ?? ''))}</td>
      <td>${escHtml(String(r.B_NO ?? r.b_no ?? ''))}</td>
      <td>${escHtml(String(r.GOD_CODE ?? r.god_code ?? ''))}</td>
      <td class="amount">${formatStockPdf(rq, 3)}</td>
      <td class="amount">${formatStockPdf(sq, 3)}</td>
      <td class="amount">${formatStockPdf(rw)}</td>
      <td class="amount">${formatStockPdf(sw)}</td>
      <td class="amount">${formatStockPdf(rg)}</td>
      <td class="amount">${formatStockPdf(sg)}</td>
      <td class="amount bal">${formatStockPdf(runQ, 3)}</td>
      <td class="amount bal">${formatStockPdf(runW)}</td>
      <td class="amount bal">${formatStockPdf(runG)}</td>
    </tr>`;
  });

  const grandRow = `<tr class="report-grand-total">
    <td colspan="8" class="lbl-total">Closing balance (running total)</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">—</td>
    <td class="amount">${formatStockPdf(runQ, 3)}</td>
    <td class="amount">${formatStockPdf(runW)}</td>
    <td class="amount">${formatStockPdf(runG)}</td>
  </tr>`;

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock detail — ${itemCode}</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          ${itemName}<br />
          As on <strong>${endDt}</strong> · Godown: <strong>${god}</strong><br />
          Generated: ${generated}
        </div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Vr dt</th>
            <th>Vr no</th>
            <th>Vr typ</th>
            <th>Type</th>
            <th>Lot</th>
            <th>St</th>
            <th>B no</th>
            <th>God</th>
            <th class="amount">R qty</th>
            <th class="amount">S qty</th>
            <th class="amount">R wt</th>
            <th class="amount">S wt</th>
            <th class="amount">R g wt</th>
            <th class="amount">S g wt</th>
            <th class="amount">Run qty</th>
            <th class="amount">Run wt</th>
            <th class="amount">Run g wt</th>
          </tr>
        </thead>
        <tbody>${body}${raw.length ? grandRow : ''}</tbody>
      </table>
      <div class="report-foot">Running balance = cumulative (R − S) per row for qty, weight, and gross weight.</div>
    </div>
  `;
}

/** StockSum ledger (row-wise stock movement) */
function buildStockSumLedgerReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const itemCode = escHtml(metadata.itemCode || '');
  const itemName = escHtml(metadata.itemName || '');
  const plantCode = escHtml(metadata.plantCode || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tPur = 0;
  let tProd = 0;
  let tJb = 0;
  let tJi = 0;
  let tMill = 0;
  let tSale = 0;
  let tCnote = 0;
  let tCl = 0;
  const body = rows
    .map((r) => {
      tPur += stockNum(r, 'PUR_WT', 'pur_wt');
      tProd += stockNum(r, 'PROD_WT', 'prod_wt');
      tJb += stockNum(r, 'JB_WT', 'jb_wt');
      tJi += stockNum(r, 'JI_WT', 'ji_wt');
      tMill += stockNum(r, 'MILLING_WT', 'milling_wt');
      tSale += stockNum(r, 'SALE_WT', 'sale_wt');
      tCnote += stockNum(r, 'CNOTE_WT', 'cnote_wt');
      tCl = stockNum(r, 'CL_BAL', 'cl_bal');
      return `<tr>
        <td>${escHtml(formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date))}</td>
        <td>${escHtml(r.VR_NO ?? r.vr_no ?? '')}</td>
        <td>${escHtml(r.TYPE ?? r.type ?? '')}</td>
        <td>${escHtml(r.B_TYPE ?? r.b_type ?? '')}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'PUR_WT', 'pur_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'PROD_WT', 'prod_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'JB_WT', 'jb_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'JI_WT', 'ji_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'MILLING_WT', 'milling_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'SALE_WT', 'sale_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'CNOTE_WT', 'cnote_wt'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'CL_BAL', 'cl_bal'))}</td>
      </tr>`;
    })
    .join('');

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock ledger</h1>
        <div class="company">${company}</div>
        <div class="report-period">
          Date <strong>${sdt}</strong> – <strong>${edt}</strong> · Item <strong>${itemCode}</strong> ${itemName}<br />
          Plant <strong>${plantCode || 'All'}</strong> · Generated: ${generated}
        </div>
      </div>
      <table class="table-report stock-sum-ledger-pdf">
        <thead>
          <tr>
            <th>Vr date</th>
            <th>Vr no</th>
            <th>Type</th>
            <th>B type</th>
            <th class="amount">Pur wt</th>
            <th class="amount">Prod wt</th>
            <th class="amount">JB wt</th>
            <th class="amount">JI wt</th>
            <th class="amount">Milling wt</th>
            <th class="amount">Sale wt</th>
            <th class="amount">CNote wt</th>
            <th class="amount">CL bal</th>
          </tr>
        </thead>
        <tbody>
          ${body}
          <tr class="report-grand-total">
            <td colspan="4" class="lbl-total">Grand total</td>
            <td class="amount">${formatStockPdf(tPur)}</td>
            <td class="amount">${formatStockPdf(tProd)}</td>
            <td class="amount">${formatStockPdf(tJb)}</td>
            <td class="amount">${formatStockPdf(tJi)}</td>
            <td class="amount">${formatStockPdf(tMill)}</td>
            <td class="amount">${formatStockPdf(tSale)}</td>
            <td class="amount">${formatStockPdf(tCnote)}</td>
            <td class="amount">${formatStockPdf(tCl)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

/** Production / jobwork lines opened from Stock ledger row (slide 9). */
function buildStockLedgerEntryDetailReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const kind = String(metadata.entryKind || data?.entryKind || 'prod').toLowerCase();
  const title = escHtml(metadata.title || 'Ledger detail');
  const company = escHtml(metadata.companyName || '');
  const itemCode = escHtml(metadata.itemCode || '');
  const plantCode = escHtml(metadata.plantCode || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  if (kind === 'jobwork') {
    const body = rows
      .map(
        (r) => `<tr>
        <td>${escHtml(r.TYPE ?? r.type ?? '')}</td>
        <td>${escHtml(formatLedgerDateDisplay(r.R_DATE ?? r.r_date))}</td>
        <td>${escHtml(r.R_NO ?? r.r_no ?? '')}</td>
        <td>${escHtml(r.B_TYPE ?? r.b_type ?? '')}</td>
        <td>${escHtml(r.TRN_NO ?? r.trn_no ?? '')}</td>
        <td>${escHtml(r.ITEM_CODE ?? r.item_code ?? '')}</td>
        <td>${escHtml(r.ITEM_NAME ?? r.item_name ?? '')}</td>
        <td>${escHtml(r.STATUS ?? r.status ?? '')}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'QNTY', 'qnty'), 3)}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'WEIGHT', 'weight'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'RATE', 'rate'))}</td>
        <td class="amount">${formatStockPdf(stockNum(r, 'AMOUNT', 'amount'))}</td>
      </tr>`
      )
      .join('');
    return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <div class="report-period">Item <strong>${itemCode}</strong> · Plant <strong>${plantCode || 'All'}</strong> · Generated ${generated}</div>
      </div>
      <table class="table-report stock-sum-ledger-pdf">
        <thead>
          <tr>
            <th>Type</th>
            <th>R date</th>
            <th>R no</th>
            <th>B type</th>
            <th>Trn</th>
            <th>Item</th>
            <th>Name</th>
            <th>Status</th>
            <th class="amount">Qty</th>
            <th class="amount">Weight</th>
            <th class="amount">Rate</th>
            <th class="amount">Amt</th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="12">(No rows)</td></tr>`}</tbody>
      </table>
    </div>
  `;
  }

  const body = rows
    .map(
      (r) => `<tr>
      <td>${escHtml(formatLedgerDateDisplay(r.S_DATE ?? r.s_date))}</td>
      <td>${escHtml(r.S_NO ?? r.s_no ?? '')}</td>
      <td>${escHtml(r.TRN_NO ?? r.trn_no ?? '')}</td>
      <td>${escHtml(r.PLANT_CODE ?? r.plant_code ?? '')}</td>
      <td>${escHtml(r.ITEM ?? r.item ?? '')}</td>
      <td>${escHtml(r.ITEM_NAME_IN ?? r.item_name_in ?? '')}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'M_QNTY', 'm_qnty'), 3)}</td>
      <td>${escHtml(r.M_STATUS ?? r.m_status ?? '')}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'M_WEIGHT', 'm_weight'))}</td>
      <td>${escHtml(r.ITEM_CODE ?? r.item_code ?? '')}</td>
      <td>${escHtml(r.ITEM_NAME_CODE ?? r.item_name_code ?? '')}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'PROD_PER', 'prod_per'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'PROD_QNTY', 'prod_qnty'), 3)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'PROD_WEIGHT', 'prod_weight'))}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'SHORT', 'short'))}</td>
    </tr>`
    )
    .join('');

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <div class="report-period">Item <strong>${itemCode}</strong> · Plant <strong>${plantCode || 'All'}</strong> · Generated ${generated}</div>
      </div>
      <table class="table-report stock-sum-ledger-pdf">
        <thead>
          <tr>
            <th>S date</th>
            <th>S no</th>
            <th>Trn</th>
            <th>Plant</th>
            <th>Item</th>
            <th>Name in</th>
            <th class="amount">M qnty</th>
            <th>M stat</th>
            <th class="amount">M wt</th>
            <th>Out code</th>
            <th>Out nm</th>
            <th class="amount">Prod %</th>
            <th class="amount">PQ</th>
            <th class="amount">PW</th>
            <th class="amount">Short</th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="15">(No rows)</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

/** Stock lot summary with optional filters */
function buildStockLotReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const endDt = escHtml(metadata.endDate || '');
  const god = escHtml(metadata.godLabel || 'All godowns');
  const item = escHtml(metadata.itemLabel || 'All items');
  const sup = escHtml(metadata.supplierLabel || 'All suppliers');
  const cost = escHtml(metadata.costLabel || 'All cost codes');
  const bNo = escHtml(metadata.bNo || 'All');
  const lot = escHtml(metadata.lot || 'All');
  const co = escHtml(metadata.coLabel || 'Outstanding');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tq = 0;
  let tb = 0;
  let tk = 0;
  let th = 0;
  let tw = 0;
  let tgw = 0;
  let body = '';
  rows.forEach((r) => {
    const q = stockNum(r, 'QNTY', 'qnty');
    const b = stockNum(r, 'BAGS', 'bags');
    const k = stockNum(r, 'KATTA', 'katta');
    const h = stockNum(r, 'HKATTA', 'hkatta');
    const w = stockNum(r, 'WEIGHT', 'weight');
    const gw = stockNum(r, 'G_WEIGHT', 'g_weight');
    tq += q;
    tb += b;
    tk += k;
    th += h;
    tw += w;
    tgw += gw;
    body += `<tr>
      <td>${escHtml(String(r.ITEM_CODE ?? r.item_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.ITEM_NAME ?? r.item_name ?? ''))}</td>
      <td>${escHtml(String(r.LOT ?? r.lot ?? ''))}</td>
      <td>${escHtml(String(r.B_NO ?? r.b_no ?? ''))}</td>
      <td>${escHtml(String(r.SUP_CODE ?? r.sup_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.SUP_NAME ?? r.sup_name ?? ''))}</td>
      <td>${escHtml(String(r.SCHEDULE ?? r.schedule ?? ''))}</td>
      <td>${escHtml(String(r.GOD_CODE ?? r.god_code ?? ''))}</td>
      <td>${escHtml(String(r.GOD_NAME ?? r.god_name ?? ''))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date))}</td>
      <td>${escHtml(String(r.COST_CODE ?? r.cost_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.REMARKS ?? r.remarks ?? ''))}</td>
      <td class="amount">${formatStockPdf(q, 3)}</td>
      <td class="amount">${formatStockPdf(b, 3)}</td>
      <td class="amount">${formatStockPdf(k, 3)}</td>
      <td class="amount">${formatStockPdf(h, 3)}</td>
      <td class="amount">${formatStockPdf(w)}</td>
      <td class="amount">${formatStockPdf(gw)}</td>
    </tr>`;
  });

  const grand = rows.length
    ? `<tr class="report-grand-total">
      <td colspan="12" class="lbl-total">Grand total</td>
      <td class="amount">${formatStockPdf(tq, 3)}</td>
      <td class="amount">${formatStockPdf(tb, 3)}</td>
      <td class="amount">${formatStockPdf(tk, 3)}</td>
      <td class="amount">${formatStockPdf(th, 3)}</td>
      <td class="amount">${formatStockPdf(tw)}</td>
      <td class="amount">${formatStockPdf(tgw)}</td>
    </tr>`
    : '';

  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">INVENTORY</div>
        <h1>Stock lot</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">As on</td><td class="val">${endDt}</td><td class="lbl">C/O</td><td class="val">${co}</td></tr>
          <tr><td class="lbl">Godown</td><td class="val">${god}</td><td class="lbl">Item</td><td class="val">${item}</td></tr>
          <tr><td class="lbl">Supplier</td><td class="val">${sup}</td><td class="lbl">Cost</td><td class="val">${cost}</td></tr>
          <tr><td class="lbl">Bikri no</td><td class="val">${bNo}</td><td class="lbl">Lot</td><td class="val">${lot}</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Item</th>
            <th>Item name</th>
            <th>Lot</th>
            <th>Bikri</th>
            <th>Sup</th>
            <th>Supplier name</th>
            <th>Sch</th>
            <th>God</th>
            <th>God name</th>
            <th>Vr dt</th>
            <th>Cost</th>
            <th>Remarks</th>
            <th class="amount">Qty</th>
            <th class="amount">Bags</th>
            <th class="amount">Katta</th>
            <th class="amount">H katta</th>
            <th class="amount">Weight</th>
            <th class="amount">G weight</th>
          </tr>
        </thead>
        <tbody>${body}${grand}</tbody>
      </table>
      <div class="report-foot">Outstanding mode excludes rows whose net quantity is zero.</div>
    </div>
  `;
}

function purchaseDnSigned(row, upper, lower) {
  const v = stockNum(row, upper, lower);
  const t = String(row?.TYPE ?? row?.type ?? '').trim().toUpperCase();
  return t === 'DN' ? -Math.abs(v) : v;
}

/** Purchase bill / debit note PDF (portrait) */
function buildPurchaseBillReportHtml(data, metadata) {
  const { lines, header, first, docTitle, totals } = data;
  const h = header || {};
  const f = first || {};
  const t = totals || {};
  const company = escHtml(metadata.companyName || '');

  const hv = (logical) => {
    const raw = rowFieldCI(h, logical);
    return raw ? escHtml(raw) : '';
  };
  const fv = (logical) => {
    const raw = rowFieldCI(f, logical);
    return raw ? escHtml(raw) : '';
  };

  const billAmtNum = Number(t.billAmt) || 0;
  const wordsRaw =
    billAmtNum < 0 ? 'Minus ' + rupeesToWords(Math.abs(billAmtNum)) : rupeesToWords(billAmtNum || Number(t.sumAmt) || 0);
  const words = escHtml(wordsRaw);

  let bodyRows = '';
  (lines || []).forEach((row, i) => {
    bodyRows += `
            <tr>
              <td>${i + 1}</td>
              <td>${escHtml(sbCell(row, 'ITEM_CODE', 'item_code'))}</td>
              <td>${escHtml(sbCell(row, 'ITEM_NAME', 'item_name'))}</td>
              <td class="num">${formatQtyPdf(purchaseDnSigned(row, 'QNTY', 'qnty'))}</td>
              <td class="num">${formatQtyPdf(purchaseDnSigned(row, 'WEIGHT', 'weight'))}</td>
              <td class="num">${formatAmtPdf(stockNum(row, 'RATE', 'rate'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'AMOUNT', 'amount'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'TAXABLE', 'taxable'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'CGST_AMT', 'cgst_amt'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'SGST_AMT', 'sgst_amt'))}</td>
              <td class="num">${formatAmtPdf(purchaseDnSigned(row, 'IGST_AMT', 'igst_amt'))}</td>
            </tr>`;
  });

  const brokerLine =
    [rowFieldCI(f, 'bk_name'), rowFieldCI(f, 'b_code')].filter(Boolean).join(' — ') || '—';
  const bankAcNo = rowFieldAny(h, ['bank_ac_no', 'BANK_AC_NO']);
  const bankAcNo1 = rowFieldAny(h, ['bank_ac_no1', 'BANK_AC_NO1']);
  const bankHtml =
    bankAcNo || bankAcNo1
      ? `<div class="sb-pdf-bank">${bankAcNo ? `<div>${escHtml(bankAcNo)}</div>` : ''}${
          bankAcNo1 ? `<div>${escHtml(bankAcNo1)}</div>` : ''
        }</div>`
      : '';
  const truckNo = rowFieldCI(f, 'truck');
  const tptVal = rowFieldCI(f, 'tpt');
  const grNoVal = rowFieldCI(f, 'gr_no');
  const transportHtml =
    truckNo || tptVal || grNoVal
      ? `<div class="sb-pdf-transport">${
          truckNo ? `<span><strong>Truck:</strong> ${escHtml(truckNo)}</span>` : ''
        }${tptVal ? `<span><strong>Tpt:</strong> ${escHtml(tptVal)}</span>` : ''}${
          grNoVal ? `<span><strong>GR no.:</strong> ${escHtml(grNoVal)}</span>` : ''
        }</div>`
      : '';

  const sumPairs = [
    ['Total amount', t.sumAmt],
    ['Taxable', t.sumTax],
    ['CGST', t.sumC],
    ['SGST', t.sumS],
    ['IGST', t.sumI],
    ['Discount', t.sumDis],
    ['Dami amount', t.damiAmt],
    ['MFee amount', t.mfeeAmt],
    ['Labour', t.labourExp],
    ['Freight paid', t.freightPaid],
    ['Add exp', t.addExp],
    ['Less exp', t.lessExp],
    ['TDS', t.tdsAmt],
    ['Bill amt', t.billAmt],
  ];
  let sumBody = '';
  sumPairs.forEach(([lbl, val]) => {
    sumBody += `<tr><td>${escHtml(lbl)}</td><td class="num">${formatAmtPdf(val)}</td></tr>`;
  });

  return `
    <div class="report-doc sb-pdf">
      <style>${PDF_REPORT_STYLES}${SALE_BILL_PDF_STYLES}</style>
      <div class="sb-pdf-top">
        <div class="sb-pdf-top-main">
          <div class="sb-pdf-title">${escHtml(docTitle || '')}</div>
          <div class="sb-pdf-co">${company}</div>
          ${hv('comp_add1') ? `<div class="sb-pdf-addr">${hv('comp_add1')}</div>` : ''}
          ${hv('comp_add2') ? `<div class="sb-pdf-addr">${hv('comp_add2')}</div>` : ''}
          ${hv('comp_add3') ? `<div class="sb-pdf-addr">${hv('comp_add3')}</div>` : ''}
          <div class="sb-pdf-addr">
            ${hv('comp_tel1') ? `Tel: ${hv('comp_tel1')}` : ''}
            ${hv('comp_tel2') ? ` ${hv('comp_tel2')}` : ''}
          </div>
          <div class="sb-pdf-addr">GstNo: ${escHtml(rowFieldAny(h, ['gst_no', 'gstno', 'comp_gst', 'gstin']) || '—')} · pan: ${escHtml(rowFieldAny(h, ['comp_pan', 'pan', 'company_pan']) || '—')}</div>
          ${hv('email') ? `<div class="sb-pdf-addr">EMAIL: ${hv('email')}</div>` : ''}
        </div>
      </div>

      <div class="sb-pdf-inv">
        <span><strong>R no.</strong> ${escHtml(String(f.R_NO ?? f.r_no ?? '—'))}</span>
        <span><strong>R date</strong> ${escHtml(formatLedgerDateDisplay(f.R_DATE ?? f.r_date))}</span>
        <span><strong>Bill no.</strong> ${escHtml(String(f.BILL_NO ?? f.bill_no ?? '—'))}</span>
        <span><strong>Bill date</strong> ${escHtml(formatLedgerDateDisplay(f.BILL_DATE ?? f.bill_date))}</span>
      </div>

      <div class="sb-pdf-two">
        <div>
          <div class="sb-pdf-h">Party name</div>
          <div>${fv('name')}</div>
          <div>${fv('add1')}</div>
          <div>${fv('add2')}</div>
          <div>${fv('add3')}</div>
          <div>${fv('city')}</div>
          <div>GST: ${fv('gst_no') || '—'}</div>
          <div>PAN: ${fv('pan') || '—'}</div>
        </div>
        <div></div>
      </div>

      <div class="sb-pdf-broker"><strong>Broker:</strong> ${escHtml(brokerLine)}</div>

      <table class="sb-pdf-grid">
        <thead>
          <tr>
            <th>Sno</th>
            <th>Item</th>
            <th>Item name</th>
            <th class="num">Qty</th>
            <th class="num">Wt</th>
            <th class="num">Rate</th>
            <th class="num">Amt</th>
            <th class="num">Taxable</th>
            <th class="num">CGST</th>
            <th class="num">SGST</th>
            <th class="num">IGST</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>

      <table class="sb-pdf-sum" style="width:100%;max-width:320px">
        <tbody>${sumBody}</tbody>
      </table>
      <div class="sb-pdf-net-words-row" style="width:100%;max-width:320px">
        <div class="sb-pdf-words-inline"><strong>Rs in words:</strong> ${words}</div>
      </div>
      <hr class="sb-pdf-footer-rule" />
      ${bankHtml}
      ${transportHtml}
      <div class="sb-pdf-sign">
        <div>For ${company}</div>
        <div class="sb-pdf-auth">Authorised signatory</div>
      </div>
    </div>
  `;
}

const DISPATCH_CHALLAN_PRINT_STYLES = `
  .dc-pdf { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 14px; line-height: 1.45; color: #0f172a; }
  .dc-pdf-pages-wrap { display: block; }
  .dc-pdf-page {
    display: block;
    width: 100%;
    max-width: 210mm;
    margin: 0 auto 20px;
    padding: 10mm 12mm;
    background: #fff;
    box-sizing: border-box;
    page-break-inside: avoid;
    break-inside: avoid-page;
    page-break-after: always;
    break-after: page;
  }
  .dc-pdf-page--new {
    page-break-before: always !important;
    break-before: page !important;
    margin-top: 0;
  }
  .dc-pdf-page:last-child {
    page-break-after: auto;
    break-after: auto;
    margin-bottom: 0;
  }
  .dc-pdf-page-header { display: grid; grid-template-columns: 120px 1fr; align-items: flex-start; gap: 12px; margin-bottom: 12px; border-bottom: 2px solid #1e3a5f; padding-bottom: 10px; }
  .dc-pdf-logo img { width: 110px; height: 110px; object-fit: contain; display: block; }
  .dc-pdf-logo--empty { min-height: 80px; }
  .dc-pdf-page-header-main { text-align: center; min-width: 0; }
  .dc-pdf-doc-title { font-size: 17px; font-weight: 800; letter-spacing: 0.08em; margin-bottom: 6px; color: #0f172a; }
  .dc-pdf-co-name { font-size: 20px; font-weight: 700; color: #0047ab; margin-bottom: 4px; }
  .dc-pdf-co-line { font-size: 13px; color: #334155; margin: 2px 0; }
  .dc-pdf-ch-meta { display: flex; flex-wrap: wrap; gap: 14px 24px; font-size: 14px; font-weight: 600; margin: 10px 0 12px; }
  .dc-pdf-party-box { width: 100%; border-collapse: collapse; margin: 0 0 12px; border: 1px solid #94a3b8; }
  .dc-pdf-party-box td { padding: 8px 10px; vertical-align: top; font-size: 13px; }
  .dc-pdf-party-lbl { font-weight: 700; color: #1e3a5f; font-size: 14px; margin-bottom: 4px; }
  .dc-pdf-party-name { font-weight: 700; font-size: 15px; margin-bottom: 4px; }
  .dc-pdf-grid-wrap {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin-bottom: 12px;
  }
  table.dc-pdf-grid {
    width: 100%;
    min-width: 0;
    border-collapse: collapse;
    margin-bottom: 0;
    font-size: 13px;
    table-layout: fixed;
  }
  table.dc-pdf-grid th, table.dc-pdf-grid td { border: 1px solid #64748b; padding: 6px 8px; vertical-align: top; word-break: normal; overflow-wrap: normal; }
  table.dc-pdf-grid th:nth-child(1), table.dc-pdf-grid td:nth-child(1) { width: 5%; }
  table.dc-pdf-grid th:nth-child(2), table.dc-pdf-grid td:nth-child(2) { width: 18%; }
  table.dc-pdf-grid th:nth-child(3), table.dc-pdf-grid td:nth-child(3) { width: 12%; }
  table.dc-pdf-grid th:nth-child(4), table.dc-pdf-grid td:nth-child(4) { width: 10%; }
  table.dc-pdf-grid th:nth-child(5), table.dc-pdf-grid td:nth-child(5) { width: 8%; }
  table.dc-pdf-grid th:nth-child(6), table.dc-pdf-grid td:nth-child(6) { width: 8%; }
  table.dc-pdf-grid th:nth-child(7), table.dc-pdf-grid td:nth-child(7) { width: 12%; }
  table.dc-pdf-grid th:nth-child(8), table.dc-pdf-grid td:nth-child(8) { width: 12%; }
  table.dc-pdf-grid th:nth-child(9), table.dc-pdf-grid td:nth-child(9) { width: 15%; }
  table.dc-pdf-grid th { background: #e2e8f0; font-weight: 700; font-size: 12px; text-transform: uppercase; }
  table.dc-pdf-grid td.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.dc-pdf-grid tr.report-grand-total td { font-weight: 700; background: #f1f5f9; }
  .dc-pdf-footer-fields { margin: 12px 0; font-size: 13px; line-height: 1.55; }
  .dc-pdf-bottom-row {
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
    margin-top: 28px;
    min-height: 72px;
  }
  .dc-pdf-sign-block { text-align: right; flex-shrink: 0; }
  .dc-pdf-for-co {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #0f172a;
  }
  .dc-pdf-signature img { max-height: 64px; max-width: 180px; object-fit: contain; display: block; margin-left: auto; }
  .dc-pdf-sign-lbl { font-size: 13px; margin-top: 6px; color: #475569; }
  @media screen {
    .dc-pdf-pages-wrap {
      padding: 8px 10px;
      box-sizing: border-box;
    }
    .dc-pdf-page {
      width: 100% !important;
      max-width: 794px !important;
      margin-left: auto !important;
      margin-right: auto !important;
      box-sizing: border-box;
    }
  }
  @media screen and (max-width: 768px) {
    .dc-pdf-page {
      width: 100% !important;
      max-width: 100% !important;
      padding: 10px 12px !important;
      margin: 0 auto 12px !important;
      box-sizing: border-box;
    }
    .dc-pdf-page-header {
      grid-template-columns: 56px 1fr;
      gap: 8px;
    }
    .dc-pdf-logo img { width: 52px; height: 52px; }
    .dc-pdf-co-name { font-size: 16px; }
    .dc-pdf-doc-title { font-size: 14px; }
    table.dc-pdf-grid { font-size: 11px; table-layout: fixed; width: 100%; }
    table.dc-pdf-grid th, table.dc-pdf-grid td { padding: 4px 5px; word-break: break-word; }
    table.dc-pdf-grid td.num { white-space: nowrap; }
    table.dc-pdf-grid th:nth-child(2), table.dc-pdf-grid td:nth-child(2) { width: 22%; }
    table.dc-pdf-grid th:nth-child(3), table.dc-pdf-grid td:nth-child(3) { width: 14%; }
  }
  @media print {
    .dc-pdf { font-size: 14px; }
    .dc-pdf-pages-wrap { background: transparent !important; padding: 0 !important; }
    .dc-pdf-page {
      width: 210mm;
      max-width: none;
      margin: 0 !important;
      padding: 10mm 12mm;
      box-shadow: none !important;
      page-break-inside: avoid;
      break-inside: avoid-page;
      page-break-after: always;
      break-after: page;
    }
    .dc-pdf-page--new {
      page-break-before: always !important;
      break-before: page !important;
    }
    .dc-pdf-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
  }
`;

/** Dispatch challan print — one full page per R_NO (company header + footer on each page). */
function buildDispatchChallanPrintReportHtml(data, metadata) {
  const challans = Array.isArray(data?.challans) ? data.challans : [];
  const h = data?.compdet || {};
  const apiBase = String(metadata?.apiBase || '').trim();
  const company = escHtml(cleanPrintText(metadata?.companyName || rowFieldCI(h, 'comp_name') || 'Company'));

  const logoSafe = normalizePrintImageSrc(rowFieldCI(h, 'sale_logo'), apiBase);
  const signatureSafe = normalizePrintImageSrc(rowFieldCI(h, 'signature_file'), apiBase);

  const compLines = [];
  for (const k of ['comp_add1', 'comp_add2', 'comp_add3', 'compadd1', 'compadd2']) {
    const v = cleanPrintText(rowFieldCI(h, k));
    if (v) compLines.push(v);
  }
  const compTel = [cleanPrintText(rowFieldCI(h, 'comp_tel1')), cleanPrintText(rowFieldCI(h, 'comp_tel2'))]
    .filter(Boolean)
    .join(' ');
  if (compTel) compLines.push(`Tel: ${compTel}`);
  const compGst = cleanPrintText(rowFieldCI(h, 'gst_no') || rowFieldCI(h, 'comp_gst'));
  const compPan = cleanPrintText(rowFieldCI(h, 'comp_pan') || rowFieldCI(h, 'pan'));
  if (compGst || compPan) {
    compLines.push([compGst ? `GST: ${compGst}` : '', compPan ? `PAN: ${compPan}` : ''].filter(Boolean).join('    |    '));
  }

  const logoBlock = logoSafe
    ? `<div class="dc-pdf-logo"><img src="${logoSafe}" alt="" /></div>`
    : '<div class="dc-pdf-logo dc-pdf-logo--empty"></div>';
  const pageHeaderHtml = `
    <header class="dc-pdf-page-header">
      ${logoBlock}
      <div class="dc-pdf-page-header-main">
        <div class="dc-pdf-doc-title">DISPATCH CHALLAN</div>
        <div class="dc-pdf-co-name">${company}</div>
        ${compLines.map((line) => `<div class="dc-pdf-co-line">${escHtml(line)}</div>`).join('')}
      </div>
    </header>`;

  let docBody = '';
  for (let i = 0; i < challans.length; i++) {
    const ch = challans[i];
    const pageCls = i > 0 ? 'dc-pdf-page dc-pdf-page--new' : 'dc-pdf-page';
    const lines = Array.isArray(ch.lines) ? ch.lines : [];
    const p = ch.party || {};
    const f = ch.footer || {};
    let tq = 0;
    let tw = 0;
    let ta = 0;
    let grid = '';
    lines.forEach((row) => {
      const q = Number(row.QNTY ?? row.qnty ?? 0) || 0;
      const w = Number(row.WEIGHT ?? row.weight ?? 0) || 0;
      const a = Number(row.AMOUNT ?? row.amount ?? 0) || 0;
      tq += q;
      tw += w;
      ta += a;
      grid += `<tr>
        <td class="num">${escHtml(String(row.TRN_NO ?? row.trn_no ?? ''))}</td>
        <td>${escHtml(String(row.ITEM_NAME ?? row.item_name ?? row.ITEM_CODE ?? ''))}</td>
        <td>${escHtml(String(row.MARKA ?? row.marka ?? ''))}</td>
        <td>${escHtml(String(row.HSN_CODE ?? row.hsn_code ?? '').slice(0, 8))}</td>
        <td>${escHtml(saleBillStatusUnitLabel(row.STATUS ?? row.status))}</td>
        <td class="num">${formatQtyPdf(q)}</td>
        <td class="num">${formatQtyPdf(w)}</td>
        <td class="num">${formatAmtPdf(row.RATE ?? row.rate)}</td>
        <td class="num">${formatAmtPdf(a)}</td>
      </tr>`;
    });
    const partyName = escHtml(String(p.name || p.NAME || ''));
    const sigHtml = signatureSafe
      ? `<div class="dc-pdf-signature"><img src="${signatureSafe}" alt="" /></div>`
      : '';
    docBody += `
      <section class="${pageCls}">
        ${pageHeaderHtml}
        <div class="dc-pdf-ch-meta">
          <span><strong>Ch.Type</strong> ${escHtml(String(ch.ch_type ?? ''))}</span>
          <span><strong>Ch.No.</strong> ${escHtml(String(ch.r_no ?? ''))}</span>
          <span><strong>Date</strong> ${escHtml(String(ch.r_date_display ?? ''))}</span>
        </div>
        <table class="dc-pdf-party-box">
          <tr><td>
            <div class="dc-pdf-party-lbl">Party</div>
            <div class="dc-pdf-party-name">${partyName}</div>
            <div>${escHtml(String(p.add1 || p.ADD1 || ''))}</div>
            <div>${escHtml(String(p.add2 || p.ADD2 || ''))}</div>
            <div>${escHtml(String(p.city || p.CITY || ''))}</div>
            <div>GST: ${escHtml(String(p.gst || p.GST_NO || '—'))}</div>
            <div>PAN: ${escHtml(String(p.pan || p.PAN || '—'))}</div>
            ${p.tel ? `<div>Tel: ${escHtml(String(p.tel))}</div>` : ''}
          </td></tr>
        </table>
        <div class="dc-pdf-grid-wrap">
        <table class="dc-pdf-grid">
          <thead>
            <tr>
              <th>Trn</th><th>Item name</th><th>Marka</th><th>HSN</th><th>Unit</th>
              <th class="num">Qty</th><th class="num">Weight</th><th class="num">Rate</th><th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${grid || '<tr><td colspan="9">(No lines)</td></tr>'}
            <tr class="report-grand-total">
              <td colspan="5" class="lbl-total">Total</td>
              <td class="num">${formatQtyPdf(tq)}</td>
              <td class="num">${formatQtyPdf(tw)}</td>
              <td></td>
              <td class="num">${formatAmtPdf(ta)}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <div class="dc-pdf-footer-fields">
          ${f.remarks ? `<div><strong>Remarks:</strong> ${escHtml(String(f.remarks))}</div>` : ''}
          ${f.truck_no ? `<div><strong>Truck no:</strong> ${escHtml(String(f.truck_no))}</div>` : ''}
          ${f.tpt ? `<div><strong>Tpt:</strong> ${escHtml(String(f.tpt))}</div>` : ''}
          ${f.gr_no ? `<div><strong>GR no:</strong> ${escHtml(String(f.gr_no))}</div>` : ''}
        </div>
        <div class="dc-pdf-bottom-row">
          <div class="dc-pdf-sign-block">
            <div class="dc-pdf-for-co">For ${company}</div>
            ${sigHtml}
            <div class="dc-pdf-sign-lbl">Authorised signatory</div>
          </div>
        </div>
      </section>`;
  }

  const html = `
    <div class="dc-pdf">
      <style>${DISPATCH_CHALLAN_PRINT_STYLES}</style>
      <div class="dc-pdf-pages-wrap">
        ${docBody || '<p class="dc-pdf-co-line">(No challans in range)</p>'}
      </div>
    </div>
  `;

  return html;
}

/** Sales order print — one page per SO_NO (same layout as dispatch challan). */
function buildSalesOrderPrintReportHtml(data, metadata) {
  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const h = data?.compdet || {};
  const apiBase = String(metadata?.apiBase || '').trim();
  const company = escHtml(cleanPrintText(metadata?.companyName || rowFieldCI(h, 'comp_name') || 'Company'));

  const logoSafe = normalizePrintImageSrc(rowFieldCI(h, 'sale_logo'), apiBase);
  const signatureSafe = normalizePrintImageSrc(rowFieldCI(h, 'signature_file'), apiBase);

  const compLines = [];
  for (const k of ['comp_add1', 'comp_add2', 'comp_add3', 'compadd1', 'compadd2']) {
    const v = cleanPrintText(rowFieldCI(h, k));
    if (v) compLines.push(v);
  }
  const compTel = [cleanPrintText(rowFieldCI(h, 'comp_tel1')), cleanPrintText(rowFieldCI(h, 'comp_tel2'))]
    .filter(Boolean)
    .join(' ');
  if (compTel) compLines.push(`Tel: ${compTel}`);
  const compGst = cleanPrintText(rowFieldCI(h, 'gst_no') || rowFieldCI(h, 'comp_gst'));
  const compPan = cleanPrintText(rowFieldCI(h, 'comp_pan') || rowFieldCI(h, 'pan'));
  if (compGst || compPan) {
    compLines.push([compGst ? `GST: ${compGst}` : '', compPan ? `PAN: ${compPan}` : ''].filter(Boolean).join('    |    '));
  }

  const logoBlock = logoSafe
    ? `<div class="dc-pdf-logo"><img src="${logoSafe}" alt="" /></div>`
    : '<div class="dc-pdf-logo dc-pdf-logo--empty"></div>';
  const pageHeaderHtml = `
    <header class="dc-pdf-page-header">
      ${logoBlock}
      <div class="dc-pdf-page-header-main">
        <div class="dc-pdf-doc-title">${escHtml(String(metadata?.orderDocTitle || 'SALES ORDER').toUpperCase())}</div>
        <div class="dc-pdf-co-name">${company}</div>
        ${compLines.map((line) => `<div class="dc-pdf-co-line">${escHtml(line)}</div>`).join('')}
      </div>
    </header>`;

  let docBody = '';
  for (let i = 0; i < orders.length; i++) {
    const ord = orders[i];
    const pageCls = i > 0 ? 'dc-pdf-page dc-pdf-page--new' : 'dc-pdf-page';
    const lines = Array.isArray(ord.lines) ? ord.lines : [];
    const p = ord.party || {};
    const f = ord.footer || {};
    let tq = 0;
    let tw = 0;
    let ta = 0;
    let grid = '';
    lines.forEach((row) => {
      const q = Number(row.QNTY ?? row.qnty ?? 0) || 0;
      const w = Number(row.WEIGHT ?? row.weight ?? 0) || 0;
      const a = Number(row.AMOUNT ?? row.amount ?? 0) || 0;
      tq += q;
      tw += w;
      ta += a;
      grid += `<tr>
        <td class="num">${escHtml(String(row.TRN_NO ?? row.trn_no ?? ''))}</td>
        <td>${escHtml(String(row.ITEM_NAME ?? row.item_name ?? row.ITEM_CODE ?? ''))}</td>
        <td>${escHtml(String(row.MARKA ?? row.marka ?? ''))}</td>
        <td>${escHtml(String(row.HSN_CODE ?? row.hsn_code ?? '').slice(0, 8))}</td>
        <td>${escHtml(saleBillStatusUnitLabel(row.STATUS ?? row.status))}</td>
        <td class="num">${formatQtyPdf(q)}</td>
        <td class="num">${formatQtyPdf(w)}</td>
        <td class="num">${formatAmtPdf(row.RATE ?? row.rate)}</td>
        <td class="num">${formatAmtPdf(a)}</td>
      </tr>`;
    });
    const partyName = escHtml(String(p.name || p.NAME || ''));
    const sigHtml = signatureSafe
      ? `<div class="dc-pdf-signature"><img src="${signatureSafe}" alt="" /></div>`
      : '';
    const footerLeft = [
      f.po_no ? `<div><strong>PO no:</strong> ${escHtml(String(f.po_no))}</div>` : '',
      f.remarks ? `<div><strong>Remarks:</strong> ${escHtml(String(f.remarks))}</div>` : '',
      f.remarks2 ? `<div><strong>Remarks 2:</strong> ${escHtml(String(f.remarks2))}</div>` : '',
    ]
      .filter(Boolean)
      .join('');
    docBody += `
      <section class="${pageCls}">
        ${pageHeaderHtml}
        <div class="dc-pdf-ch-meta">
          <span><strong>SO no.</strong> ${escHtml(String(ord.so_no ?? ''))}</span>
          <span><strong>Date</strong> ${escHtml(String(ord.so_date_display ?? ''))}</span>
        </div>
        <table class="dc-pdf-party-box">
          <tr><td>
            <div class="dc-pdf-party-lbl">Customer</div>
            <div class="dc-pdf-party-name">${partyName}</div>
            <div>${escHtml(String(p.add1 || p.ADD1 || ''))}</div>
            <div>${escHtml(String(p.add2 || p.ADD2 || ''))}</div>
            <div>${escHtml(String(p.city || p.CITY || ''))}</div>
            <div>GST: ${escHtml(String(p.gst || p.GST_NO || '—'))}</div>
            <div>PAN: ${escHtml(String(p.pan || p.PAN || '—'))}</div>
            ${p.tel ? `<div>Tel: ${escHtml(String(p.tel))}</div>` : ''}
          </td></tr>
        </table>
        <div class="dc-pdf-grid-wrap">
        <table class="dc-pdf-grid">
          <thead>
            <tr>
              <th>Trn</th><th>Item name</th><th>Marka</th><th>HSN</th><th>Unit</th>
              <th class="num">Qty</th><th class="num">Weight</th><th class="num">Rate</th><th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${grid || '<tr><td colspan="9">(No lines)</td></tr>'}
            <tr class="report-grand-total">
              <td colspan="5" class="lbl-total">Total</td>
              <td class="num">${formatQtyPdf(tq)}</td>
              <td class="num">${formatQtyPdf(tw)}</td>
              <td></td>
              <td class="num">${formatAmtPdf(ta)}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <div class="dc-pdf-footer-row" style="display:flex;justify-content:space-between;align-items:flex-start;margin-top:12px;gap:16px;">
          <div class="dc-pdf-footer-fields" style="text-align:left;flex:1;">${footerLeft}</div>
          <div class="dc-pdf-sign-block">
            <div class="dc-pdf-for-co">For ${company}</div>
            ${sigHtml}
            <div class="dc-pdf-sign-lbl">Authorised signatory</div>
          </div>
        </div>
      </section>`;
  }

  return `
    <div class="dc-pdf">
      <style>${DISPATCH_CHALLAN_PRINT_STYLES}</style>
      <div class="dc-pdf-pages-wrap">
        ${docBody || '<p class="dc-pdf-co-line">(No sales orders in range)</p>'}
      </div>
    </div>
  `;
}

/** Production records list (PROD line detail). */
function buildProductionListReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  const voucherKey = (r) => `${String(r.S_DATE ?? '')}|${String(r.S_NO ?? '')}`;
  let body = '';
  let tmW = 0;
  let tmQ = 0;
  let tpQ = 0;
  let tpW = 0;
  let tpS = 0;

  let i = 0;
  while (i < rows.length) {
    const key = voucherKey(rows[i]);
    const group = [];
    while (i < rows.length && voucherKey(rows[i]) === key) {
      group.push(rows[i]);
      i++;
    }
    const first = group[0];
    const vmW = Number(first?.MILLING) || 0;
    const vmQ = Number(first?.M_QNTY) || 0;
    let vpQ = 0;
    let vpW = 0;
    let vpS = 0;
    for (const r of group) {
      const pq = Number(r.QNTY) || 0;
      const pw = Number(r.WEIGHT) || 0;
      const ps = Number(r.SHORT) || 0;
      vpQ += pq;
      vpW += pw;
      vpS += ps;
      body += `<tr>
      <td>${escHtml(String(r.S_DATE ?? ''))}</td>
      <td>${escHtml(String(r.S_NO ?? ''))}</td>
      <td>${escHtml(String(r.ITEM ?? ''))}</td>
      <td>${escHtml(String(r.MILL_ITEM_NAME ?? ''))}</td>
      <td class="amount">${formatStockPdf(Number(r.MILLING) || 0, 3)}</td>
      <td class="amount">${formatStockPdf(Number(r.M_QNTY) || 0, 3)}</td>
      <td>${escHtml(String(r.M_STATUS ?? ''))}</td>
      <td>${escHtml(String(r.TRN_NO ?? ''))}</td>
      <td>${escHtml(String(r.ITEM_CODE ?? ''))}</td>
      <td>${escHtml(String(r.LINE_ITEM_NAME ?? ''))}</td>
      <td class="amount">${formatStockPdf(Number(r.PROD_PER) || 0, 3)}</td>
      <td class="amount">${formatStockPdf(pq, 3)}</td>
      <td>${escHtml(String(r.STATUS ?? ''))}</td>
      <td class="amount">${formatStockPdf(pw, 3)}</td>
      <td class="amount">${formatStockPdf(ps, 3)}</td>
      <td>${escHtml(String(r.PLANT_CODE ?? ''))}</td>
    </tr>`;
    }
    tmW += vmW;
    tmQ += vmQ;
    tpQ += vpQ;
    tpW += vpW;
    tpS += vpS;
    body += `<tr class="prod-list-pdf-hr"><td colspan="16"><hr/></td></tr>`;
    body += `<tr class="report-voucher-total">
      <td>${escHtml(String(first?.S_DATE ?? ''))}</td>
      <td>${escHtml(String(first?.S_NO ?? ''))}</td>
      <td colspan="2"><strong>Total</strong></td>
      <td class="amount">${formatStockPdf(vmW, 3)}</td>
      <td class="amount">${formatStockPdf(vmQ, 3)}</td>
      <td colspan="5"></td>
      <td class="amount">${formatStockPdf(vpQ, 3)}</td>
      <td></td>
      <td class="amount">${formatStockPdf(vpW, 3)}</td>
      <td class="amount">${formatStockPdf(vpS, 3)}</td>
      <td></td>
    </tr>`;
    body += `<tr class="prod-list-pdf-hr"><td colspan="16"><hr/></td></tr>`;
  }

  const grand = `<tr class="prod-list-pdf-hr"><td colspan="16"><hr/></td></tr>
  <tr class="report-grand-total">
    <td colspan="2" class="lbl-total">Grand total</td>
    <td colspan="2"></td>
    <td class="amount">${formatStockPdf(tmW, 3)}</td>
    <td class="amount">${formatStockPdf(tmQ, 3)}</td>
    <td colspan="5"></td>
    <td class="amount">${formatStockPdf(tpQ, 3)}</td>
    <td></td>
    <td class="amount">${formatStockPdf(tpW, 3)}</td>
    <td class="amount">${formatStockPdf(tpS, 3)}</td>
    <td></td>
  </tr>`;

  return `
    <div class="pdf-report-wrap">
      <div class="pdf-report-header">
        <h1>${company}</h1>
        <h2>Production records list</h2>
        <p>Period: ${sdt} to ${edt}</p>
        <p class="pdf-meta">Generated: ${generated}</p>
      </div>
      <table class="table-report production-list-pdf">
        <thead>
          <tr>
            <th>Date</th><th>SrNo</th><th>M.Item</th><th>M.Item name</th>
            <th class="amount">M.Weight</th><th class="amount">M.Qty</th><th>B/K/H</th>
            <th>Sno</th><th>Item</th><th>Item name</th><th class="amount">Prod%</th>
            <th class="amount">P.Qty</th><th>B/K/H</th><th class="amount">P.Weight</th>
            <th class="amount">P.Short</th><th>Plant</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="16">(No rows)</td></tr>'}${rows.length ? grand : ''}</tbody>
      </table>
    </div>
  `;
}

/** Production voucher print (single PROD document). */
function buildProductionPrintReportHtml(data, metadata) {
  const header = data?.header || {};
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const company = escHtml(metadata.companyName || '');
  const sDate = escHtml(metadata.sDate || toDisplayDateFromYmd(header.s_date) || '');
  const sNo = escHtml(String(header.s_no ?? metadata.sNo ?? ''));
  const millName = escHtml(String(header.item_name || header.mill_item_name || ''));
  const millCode = escHtml(String(header.item || ''));
  const plant = escHtml(String(header.plant_code || ''));
  const mW = Number(header.milling) || 0;
  const mQ = Number(header.m_qnty) || 0;
  const mSt = escHtml(String(header.m_status || ''));

  let tpQ = 0;
  let tpW = 0;
  let tpS = 0;
  let body = '';
  lines.forEach((L, i) => {
    const pq = Number(L.qnty) || 0;
    const pw = Number(L.weight) || 0;
    const ps = Number(L.short) || 0;
    tpQ += pq;
    tpW += pw;
    tpS += ps;
    body += `<tr>
      <td>${i + 1}</td>
      <td>${escHtml(String(L.item_code ?? ''))}</td>
      <td>${escHtml(String(L.item_name ?? ''))}</td>
      <td class="amount">${formatStockPdf(Number(L.prod_per) || 0, 3)}</td>
      <td class="amount">${formatStockPdf(pq, 3)}</td>
      <td>${escHtml(String(L.status ?? ''))}</td>
      <td class="amount">${formatStockPdf(pw, 3)}</td>
      <td class="amount">${formatStockPdf(ps, 3)}</td>
    </tr>`;
  });

  return `
    <div class="pdf-report-wrap production-print-voucher">
      <div class="production-print-topbar">
        <div class="production-print-co-name">${company}</div>
        <div class="production-print-doc-title">Production entry</div>
        <div class="production-print-voucher-id"><strong>Date:</strong> ${sDate} &nbsp;&nbsp; <strong>Sr.No.:</strong> ${sNo}</div>
      </div>
      <table class="table-report production-print-meta" cellspacing="0" cellpadding="0">
        <colgroup>
          <col class="prod-meta-col-lbl" />
          <col class="prod-meta-col-val" />
        </colgroup>
        <tbody>
          <tr>
            <th class="prod-meta-lbl" scope="row">Milling item</th>
            <td class="prod-meta-val">${millCode}${millName ? ` — ${millName}` : ''}</td>
          </tr>
          <tr>
            <th class="prod-meta-lbl" scope="row">Milling weight</th>
            <td class="prod-meta-val amount">${formatStockPdf(mW, 3)}</td>
          </tr>
          <tr>
            <th class="prod-meta-lbl" scope="row">Milling qty</th>
            <td class="prod-meta-val amount">${formatStockPdf(mQ, 3)}</td>
          </tr>
          <tr>
            <th class="prod-meta-lbl" scope="row">B/K/H</th>
            <td class="prod-meta-val">${mSt}</td>
          </tr>
          <tr>
            <th class="prod-meta-lbl" scope="row">Plant</th>
            <td class="prod-meta-val">${plant}</td>
          </tr>
        </tbody>
      </table>
      <table class="table-report production-print-lines" cellspacing="0" cellpadding="0">
        <colgroup>
          <col class="prod-col-sno" />
          <col class="prod-col-code" />
          <col class="prod-col-name" />
          <col class="prod-col-pct" />
          <col class="prod-col-qty" />
          <col class="prod-col-st" />
          <col class="prod-col-wgt" />
          <col class="prod-col-short" />
        </colgroup>
        <thead>
          <tr>
            <th>Sno</th><th>Item code</th><th>Item name</th><th class="amount">Prod%</th>
            <th class="amount">Qty</th><th>B/K/H</th><th class="amount">Weight</th><th class="amount">Short</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="8">(No lines)</td></tr>'}</tbody>
        <tfoot>
          <tr class="production-print-total-row">
            <td colspan="3" class="production-print-total-lbl">Milling total</td>
            <td class="amount"></td>
            <td class="amount">${formatStockPdf(mQ, 3)}</td>
            <td class="production-print-total-st">${mSt}</td>
            <td class="amount">${formatStockPdf(mW, 3)}</td>
            <td class="amount"></td>
          </tr>
          <tr class="production-print-total-row production-print-total-row--prod">
            <td colspan="3" class="production-print-total-lbl">Production total</td>
            <td class="amount"></td>
            <td class="amount">${formatStockPdf(tpQ, 3)}</td>
            <td></td>
            <td class="amount">${formatStockPdf(tpW, 3)}</td>
            <td class="amount">${formatStockPdf(tpS, 3)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

/** Dedicated styles for production print PDF / preview (borders + header colours). */
const PRODUCTION_PRINT_PDF_STYLES = `
  html, body {
    margin: 0;
    padding: 10px;
    background: #fff;
    color: #0f172a;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .report-doc, .production-print-pdf-doc {
    font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
    font-size: 10px;
    line-height: 1.35;
    width: 794px;
    min-width: 794px;
    max-width: 794px;
    margin: 0 auto;
    box-sizing: border-box;
  }
  .production-print-voucher {
    width: 794px;
    min-width: 794px;
    box-sizing: border-box;
  }
  .production-print-topbar {
    text-align: center;
    padding: 10px 12px;
    margin-bottom: 10px;
    border: 2px solid #1e3a5f;
    background: linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%);
  }
  .production-print-co-name {
    font-size: 14px;
    font-weight: 800;
    color: #1e3a5f;
    margin-bottom: 4px;
  }
  .production-print-doc-title {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    margin-bottom: 6px;
    letter-spacing: 0.04em;
  }
  .production-print-voucher-id {
    font-size: 10px;
    color: #475569;
  }
  table.table-report {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    border: 2px solid #1e293b;
    margin: 0 0 10px;
  }
  table.production-print-meta {
    margin-bottom: 12px;
  }
  table.production-print-meta .prod-meta-col-lbl { width: 28%; }
  table.production-print-meta .prod-meta-col-val { width: 72%; }
  table.production-print-meta th.prod-meta-lbl {
    background: #cbd5e1 !important;
    color: #1e293b !important;
    font-weight: 700;
    text-align: left;
    padding: 6px 8px;
    border: 1px solid #64748b;
    font-size: 9px;
    white-space: normal;
    vertical-align: top;
    width: 28%;
  }
  table.production-print-meta td.prod-meta-val {
    background: #fff !important;
    padding: 6px 8px;
    border: 1px solid #64748b;
    font-size: 9px;
    word-break: break-word;
    vertical-align: top;
    width: 72%;
  }
  table.production-print-lines thead th {
    background: #1e293b !important;
    color: #fff !important;
    font-weight: 700;
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 6px 4px;
    border: 1px solid #0f172a;
    text-align: left;
  }
  table.production-print-lines thead th.amount { text-align: right; }
  table.production-print-lines tbody td {
    border: 1px solid #64748b;
    padding: 4px 5px;
    font-size: 9px;
    vertical-align: top;
    word-break: break-word;
  }
  table.production-print-lines tbody tr:nth-child(odd) td { background: #fff !important; }
  table.production-print-lines tbody tr:nth-child(even) td { background: #f8fafc !important; }
  table.production-print-lines .prod-col-sno { width: 5%; }
  table.production-print-lines .prod-col-code { width: 10%; }
  table.production-print-lines .prod-col-name { width: 26%; }
  table.production-print-lines .prod-col-pct { width: 9%; }
  table.production-print-lines .prod-col-qty { width: 11%; }
  table.production-print-lines .prod-col-st { width: 7%; }
  table.production-print-lines .prod-col-wgt { width: 16%; }
  table.production-print-lines .prod-col-short { width: 16%; }
  table.production-print-lines tr.production-print-total-row td {
    background: #e2e8f0 !important;
    color: #0f172a !important;
    font-weight: 700;
    font-size: 9px;
    border-top: 2px solid #1e3a5f;
    padding: 5px 4px;
  }
  table.production-print-lines tr.production-print-total-row--prod td {
    border-top: 1px solid #94a3b8;
  }
  table.production-print-lines .production-print-total-lbl { text-align: left; }
  table.production-print-lines .production-print-total-st { text-align: center; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  @media print {
    html, body { padding: 0; }
  }
`;

/** Full HTML document for production print / PDF (includes styled tables). */
export function buildProductionPrintDocumentHtml(data, metadata) {
  const body = buildProductionPrintReportHtml(data, metadata);
  const title = `Production ${String(metadata?.sNo ?? data?.header?.s_no ?? '').trim()}`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=794" />
    <title>${escHtml(title)}</title>
    <style>${PRODUCTION_PRINT_PDF_STYLES}</style>
  </head>
  <body class="report-doc production-print-pdf-doc" style="margin:0;padding:10px;background:#fff;width:794px;min-width:794px;box-sizing:border-box;">${body}</body>
</html>`;
}

function toDisplayDateFromYmd(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split('-');
    return `${d}-${m}-${y}`;
  }
  return s;
}

/** Dispatch challan list (ISSUE type S line detail). */
function buildDispatchChallanListReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const party = escHtml(metadata.partyLabel || 'All parties');
  const item = escHtml(metadata.itemLabel || 'All items');
  const marka = escHtml(metadata.markaLabel || 'All markas');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tq = 0;
  let tw = 0;
  let ta = 0;
  let body = '';
  rows.forEach((r) => {
    const q = Number(r.QNTY) || 0;
    const w = Number(r.WEIGHT) || 0;
    const a = Number(r.AMOUNT) || 0;
    tq += q;
    tw += w;
    ta += a;
    body += `<tr>
      <td>${escHtml(String(r.CH_TYPE ?? ''))}</td>
      <td>${escHtml(String(r.R_NO ?? ''))}</td>
      <td>${escHtml(String(r.R_DATE ?? ''))}</td>
      <td>${escHtml(String(r.CODE ?? ''))}</td>
      <td class="col-party">${escHtml(`[${String(r.CODE ?? '').trim()}] ${String(r.PARTY_NAME ?? '').trim()}`.trim())}</td>
      <td>${escHtml(String(r.SO_NO ?? ''))}</td>
      <td>${escHtml(String(r.ITEM_CODE ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.ITEM_NAME ?? ''))}</td>
      <td>${escHtml(String(r.MARKA ?? ''))}</td>
      <td class="amount">${formatStockPdf(q, 3)}</td>
      <td>${escHtml(String(r.STATUS ?? ''))}</td>
      <td class="amount">${formatStockPdf(w, 3)}</td>
      <td class="amount">${formatStockPdf(Number(r.RATE) || 0)}</td>
      <td class="amount">${formatStockPdf(a)}</td>
    </tr>`;
  });

  const grand = `<tr class="report-grand-total">
    <td colspan="9" class="lbl-total">Grand total</td>
    <td class="amount">${formatStockPdf(tq, 3)}</td>
    <td></td>
    <td class="amount">${formatStockPdf(tw, 3)}</td>
    <td>—</td>
    <td class="amount">${formatStockPdf(ta)}</td>
  </tr>`;

  return `
    <div class="pdf-report-wrap">
      <div class="pdf-report-header">
        <h1>${company}</h1>
        <h2>Dispatch challan list</h2>
        <p>Period: ${sdt} to ${edt} · Party: ${party} · Item: ${item} · Marka: ${marka}</p>
        <p class="pdf-meta">Generated: ${generated}</p>
      </div>
      <table class="table-report dispatch-challan-list-pdf">
        <thead>
          <tr>
            <th>Tp</th><th>No</th><th>Date</th><th>Code</th><th>Party</th><th>SO</th>
            <th>Item</th><th>Item name</th><th>Marka</th><th class="amount">Qty</th><th>St</th>
            <th class="amount">Weight</th><th class="amount">Rate</th><th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="14">(No rows)</td></tr>'}${rows.length ? grand : ''}</tbody>
      </table>
    </div>
  `;
}

/** Goods receipt note print (ISSUE type I) — same layout as dispatch challan. */
function buildGrnPrintReportHtml(data, metadata) {
  return buildDispatchChallanPrintReportHtml(data, metadata).replace(/DISPATCH CHALLAN/g, 'GOODS RECEIPT NOTE');
}

/** Goods receipt note list (ISSUE type I line detail). */
function buildGrnListReportHtml(data, metadata) {
  return buildDispatchChallanListReportHtml(data, metadata)
    .replace(/Dispatch challan list/g, 'Goods receipt note list')
    .replace(/<th>SO<\/th>/g, '<th>PO</th>');
}

/** Sales order list (SORDER type SO). */
function buildSalesOrderListReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const party = escHtml(metadata.partyLabel || 'All parties');
  const item = escHtml(metadata.itemLabel || 'All items');
  const marka = escHtml(metadata.markaLabel || 'All markas');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tq = 0;
  let tw = 0;
  let ta = 0;
  let body = '';
  rows.forEach((r) => {
    const q = Number(r.QNTY) || 0;
    const w = Number(r.WEIGHT) || 0;
    const a = Number(r.AMOUNT) || 0;
    tq += q;
    tw += w;
    ta += a;
    const partyLine = `[${String(r.CODE ?? '').trim()}] ${String(r.PARTY_NAME ?? '').trim()}`.trim();
    body += `<tr>
      <td>${escHtml(String(r.SO_NO ?? ''))}</td>
      <td>${escHtml(String(r.SO_DATE ?? ''))}</td>
      <td class="col-party">${escHtml(partyLine)}</td>
      <td>${escHtml(String(r.ITEM_CODE ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.ITEM_NAME ?? ''))}</td>
      <td>${escHtml(String(r.MARKA ?? ''))}</td>
      <td class="amount">${formatStockPdf(q, 3)}</td>
      <td>${escHtml(String(r.STATUS ?? ''))}</td>
      <td class="amount">${formatStockPdf(w, 3)}</td>
      <td class="amount">${formatStockPdf(Number(r.RATE) || 0)}</td>
      <td class="amount">${formatStockPdf(a)}</td>
    </tr>`;
  });

  const grand = `<tr class="report-grand-total">
    <td colspan="6" class="lbl-total">Grand total</td>
    <td class="amount">${formatStockPdf(tq, 3)}</td>
    <td></td>
    <td class="amount">${formatStockPdf(tw, 3)}</td>
    <td>—</td>
    <td class="amount">${formatStockPdf(ta)}</td>
  </tr>`;

  return `
    <div class="pdf-report-wrap sales-order-list-pdf-wrap">
      <div class="pdf-report-header">
        <h1>${company}</h1>
        <h2>${escHtml(metadata?.listDocTitle || 'Sales order list')}</h2>
        <p>Period: ${sdt} to ${edt} · Party: ${party} · Item: ${item} · Marka: ${marka}</p>
        <p class="pdf-meta">Generated: ${generated}</p>
      </div>
      <table class="table-report sales-order-list-pdf">
        <thead>
          <tr>
            <th>SO no</th><th>Date</th><th>Party</th><th>Item</th><th>Item name</th><th>Marka</th>
            <th class="amount">Qty</th><th>St</th><th class="amount">Weight</th><th class="amount">Rate</th><th class="amount">Amount</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="11">(No rows)</td></tr>'}${rows.length ? grand : ''}</tbody>
      </table>
    </div>
  `;
}

/** Purchase list */
function buildPurchaseListReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const type = escHtml(metadata.type || 'PU');
  const sdt = escHtml(metadata.startDate || '');
  const edt = escHtml(metadata.endDate || '');
  const party = escHtml(metadata.supplierLabel || 'All');
  const broker = escHtml(metadata.brokerLabel || 'All');
  const item = escHtml(metadata.itemLabel || 'All');
  const plant = escHtml(metadata.plantLabel || 'All');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tq = 0;
  let tw = 0;
  let tsw = 0;
  let ta = 0;
  let td = 0;
  let tt = 0;
  let tc = 0;
  let ts = 0;
  let ti = 0;
  let ttds = 0;
  let tb = 0;
  let body = '';
  rows.forEach((r) => {
    const q = stockNum(r, 'QNTY', 'qnty');
    const w = stockNum(r, 'WEIGHT', 'weight');
    const sw = stockNum(r, 'STK_WEIGHT', 'stk_weight');
    const a = stockNum(r, 'AMOUNT', 'amount');
    const dis = stockNum(r, 'DIS_AMT', 'dis_amt');
    const tx = stockNum(r, 'TAXABLE', 'taxable');
    const c = stockNum(r, 'CGST_AMT', 'cgst_amt');
    const s = stockNum(r, 'SGST_AMT', 'sgst_amt');
    const i = stockNum(r, 'IGST_AMT', 'igst_amt');
    const tds = stockNum(r, 'TDS_AMT', 'tds_amt');
    const b = stockNum(r, 'BILL_AMT', 'bill_amt');
    tq += q;
    tw += w;
    tsw += sw;
    ta += a;
    td += dis;
    tt += tx;
    tc += c;
    ts += s;
    ti += i;
    ttds += tds;
    tb += b;
    body += `<tr>
      <td>${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.R_DATE ?? r.r_date))}</td>
      <td>${escHtml(String(r.R_NO ?? r.r_no ?? ''))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date))}</td>
      <td>${escHtml(formatLedgerDateDisplay(r.STK_DATE ?? r.stk_date))}</td>
      <td>${escHtml(String(r.BILL_NO ?? r.bill_no ?? ''))}</td>
      <td>${escHtml(String(r.CODE ?? r.code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.NAME ?? r.name ?? ''))}</td>
      <td>${escHtml(String(r.TRN_NO ?? r.trn_no ?? ''))}</td>
      <td>${escHtml(String(r.BK_CODE ?? r.bk_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.BK_NAME ?? r.bk_name ?? ''))}</td>
      <td>${escHtml(String(r.ITEM_CODE ?? r.item_code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.ITEM_NAME ?? r.item_name ?? ''))}</td>
      <td>${escHtml(String(r.PLANT_CODE ?? r.plant_code ?? ''))}</td>
      <td>${escHtml(String(r.P_CODE ?? r.p_code ?? ''))}</td>
      <td>${escHtml(String(r.STATUS ?? r.status ?? ''))}</td>
      <td class="amount">${formatStockPdf(q, 3)}</td>
      <td class="amount">${formatStockPdf(w)}</td>
      <td class="amount">${formatStockPdf(sw)}</td>
      <td class="amount">${formatStockPdf(stockNum(r, 'RATE', 'rate'))}</td>
      <td class="amount">${formatStockPdf(a)}</td>
      <td class="amount">${formatStockPdf(dis)}</td>
      <td class="amount">${formatStockPdf(tx)}</td>
      <td class="amount">${formatStockPdf(c)}</td>
      <td class="amount">${formatStockPdf(s)}</td>
      <td class="amount">${formatStockPdf(i)}</td>
      <td class="amount">${formatStockPdf(tds)}</td>
      <td class="amount">${formatStockPdf(b)}</td>
    </tr>`;
  });

  const grand = `<tr class="report-grand-total">
      <td colspan="16" class="lbl-total">Grand total</td>
      <td class="amount">${formatStockPdf(tq, 3)}</td>
      <td class="amount">${formatStockPdf(tw)}</td>
      <td class="amount">${formatStockPdf(tsw)}</td>
      <td class="amount">—</td>
      <td class="amount">${formatStockPdf(ta)}</td>
      <td class="amount">${formatStockPdf(td)}</td>
      <td class="amount">${formatStockPdf(tt)}</td>
      <td class="amount">${formatStockPdf(tc)}</td>
      <td class="amount">${formatStockPdf(ts)}</td>
      <td class="amount">${formatStockPdf(ti)}</td>
      <td class="amount">${formatStockPdf(ttds)}</td>
      <td class="amount">${formatStockPdf(tb)}</td>
    </tr>`;

  return `
    <div class="report-doc purchase-list-pdf">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">PURCHASE</div>
        <h1>Purchase list</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Type</td><td class="val">${type}</td><td class="lbl">Dates</td><td class="val">${sdt} to ${edt}</td></tr>
          <tr><td class="lbl">Party</td><td class="val">${party}</td><td class="lbl">Broker</td><td class="val">${broker}</td></tr>
          <tr><td class="lbl">Item</td><td class="val">${item}</td><td class="lbl">Plant</td><td class="val">${plant}</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th>Type</th><th>R date</th><th>R no</th><th>Bill dt</th><th>Stk dt</th><th>Bill no</th><th>Code</th><th>Name</th><th>Trn</th>
            <th>Broker</th><th>Broker name</th><th>Item</th><th>Item name</th><th>Plant</th><th>P code</th><th>Status</th>
            <th class="amount">Qty</th><th class="amount">Wt</th><th class="amount">Stk wt</th><th class="amount">Rate</th><th class="amount">Amt</th>
            <th class="amount">Dis amt</th>
            <th class="amount">Taxable</th><th class="amount">CGST</th><th class="amount">SGST</th><th class="amount">IGST</th>
            <th class="amount">TDS</th><th class="amount">Bill amt</th>
          </tr>
        </thead>
        <tbody>${body}${grand}</tbody>
      </table>
      <div class="report-foot">Report generated from PURCHASE with selected filters.</div>
    </div>
  `;
}

function buildGstr1ReportHtml(payload, metadata) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const sheets = data.sheets && typeof data.sheets === 'object' ? data.sheets : {};
  const activeSheet = String(metadata?.activeSheet || Object.keys(sheets)[0] || '').trim();
  const rows = Array.isArray(sheets[activeSheet]) ? sheets[activeSheet] : [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const company = escHtml(metadata?.companyName || '');
  const fy = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.period || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const thead = columns.map((c) => `<th>${escHtml(c)}</th>`).join('');
  const tbody = rows
    .map((r) => {
      const tds = columns
        .map((c) => {
          const v = r[c];
          const isNum = typeof v === 'number';
          return `<td class="${isNum ? 'amount' : ''}">${escHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">GST</div>
        <h1>GSTR-1</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
          <tr><td class="lbl">Sheet</td><td class="val" colspan="3">${escHtml(activeSheet)} (${rows.length} rows)</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td>(No rows)</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function buildHsnSalesReportHtml(payload, metadata) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const normalizeColKey = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const columns = (rows.length > 0 ? Object.keys(rows[0]) : []).filter((c) => normalizeColKey(c) !== 'HSNUNIT');
  const company = escHtml(metadata?.companyName || '');
  const fy = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.period || '');
  const title = escHtml(metadata?.reportTitle || 'HSN Sales');
  const view = escHtml(metadata?.activeView || '');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const thead = columns
    .map((c) => `<th${normalizeColKey(c).includes('BILLDATE') ? ' style="white-space: nowrap !important;"' : ''}>${escHtml(c)}</th>`)
    .join('');
  const tbody = rows
    .map((r) => {
      const tds = columns
        .map((c) => {
          const v = r[c];
          const isNum = typeof v === 'number';
          const billDateNoWrap = normalizeColKey(c).includes('BILLDATE') ? ' style="white-space: nowrap !important;"' : '';
          return `<td class="${isNum ? 'amount' : ''}"${billDateNoWrap}>${escHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">HSN SALES</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
          <tr><td class="lbl">View</td><td class="val" colspan="3">${view || '—'} (${rows.length} rows)</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td>(No rows)</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function buildStateWiseSalesReportHtml(payload, metadata) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const columns =
    rows.length > 0
      ? Object.keys(rows[0])
      : ['State Code', 'State', 'Gst%', 'Qty.', 'Weight', 'Taxable', 'Cgst Amt.', 'Sgst Amt.', 'Igst Amt.'];
  const company = escHtml(metadata?.companyName || '');
  const fy = escHtml(metadata?.year || '');
  const period = escHtml(metadata?.period || '');
  const stateFilter = escHtml(metadata?.stateFilter || 'All states');
  const title = escHtml(metadata?.reportTitle || 'State Wise Sales');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  const thead = columns.map((c) => `<th>${escHtml(c)}</th>`).join('');
  const tbody = rows
    .map((r) => {
      const tds = columns
        .map((c) => {
          const v = r[c];
          const isNum = typeof v === 'number';
          return `<td class="${isNum ? 'amount' : ''}">${escHtml(v == null ? '' : String(v))}</td>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">${escHtml(String(metadata?.reportTitle || 'State Wise Sales').toUpperCase())}</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
          <tr><td class="lbl">State</td><td class="val" colspan="3">${stateFilter} (${rows.length} rows)</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody || '<tr><td>(No rows)</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function buildBalanceSheetReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Balance Sheet');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const totals = metadata.totals || {};
  const fmt = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isMainSch = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 && n <= 11 && Math.abs(n - Math.trunc(n)) < 0.0001;
  };
  const body = rows
    .map((r) => {
      const lSch = rowFieldAny(r, ['L_SCH_NO']) || '';
      const lDetail = rowFieldAny(r, ['L_DETAIL']) || '';
      const lAmt = Number(rowFieldAny(r, ['CR_AMT'])) || Number(rowFieldAny(r, ['L_AMOUNT'])) || 0;
      const lMain = isMainSch(lSch);
      const aSch = rowFieldAny(r, ['A_SCH_NO']) || '';
      const aDetail = rowFieldAny(r, ['A_DETAIL']) || '';
      const aAmt = Number(rowFieldAny(r, ['DR_AMT'])) || Number(rowFieldAny(r, ['A_AMOUNT'])) || 0;
      const aMain = isMainSch(aSch);
      return `<tr>
        <td class="${lMain ? 'bs-main' : ''}">${escHtml(String(lSch || '').trim())}</td>
        <td class="${lMain ? 'bs-main' : ''}">${escHtml(String(lDetail || '').trim())}</td>
        <td class="num ${lMain ? 'bs-main' : ''}">${lAmt ? escHtml(fmt(lAmt)) : ''}</td>
        <td class="${aMain ? 'bs-main' : ''}">${escHtml(String(aSch || '').trim())}</td>
        <td class="${aMain ? 'bs-main' : ''}">${escHtml(String(aDetail || '').trim())}</td>
        <td class="num ${aMain ? 'bs-main' : ''}">${aAmt ? escHtml(fmt(aAmt)) : ''}</td>
      </tr>`;
    })
    .join('');
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .bs-pdf .report-topbar { padding-bottom: 8px; }
        .bs-pdf h1 { font-size: 18px; margin-bottom: 4px; }
        .bs-pdf .company { font-size: 14px; }
        .bs-pdf .report-grid { font-size: 11px; }
        .bs-pdf .table-report { width: 100%; table-layout: fixed; font-size: 9px; }
        .bs-pdf .table-report th,
        .bs-pdf .table-report td { padding: 3px 5px; line-height: 1.15; }
        .bs-pdf .table-report th:nth-child(1),
        .bs-pdf .table-report td:nth-child(1),
        .bs-pdf .table-report th:nth-child(4),
        .bs-pdf .table-report td:nth-child(4) { width: 7%; }
        .bs-pdf .table-report th:nth-child(2),
        .bs-pdf .table-report td:nth-child(2),
        .bs-pdf .table-report th:nth-child(5),
        .bs-pdf .table-report td:nth-child(5) { width: 28%; white-space: nowrap; }
        .bs-pdf .table-report th:nth-child(3),
        .bs-pdf .table-report td:nth-child(3),
        .bs-pdf .table-report th:nth-child(6),
        .bs-pdf .table-report td:nth-child(6) { width: 15%; }
        .bs-pdf .table-report td.num,
        .bs-pdf .table-report th.num { text-align: right; white-space: nowrap; }
        .bs-pdf .bs-main { color: #b91c1c; font-weight: 700; }
      </style>
      <div class="report-topbar bs-pdf">
        <div class="kicker">BALANCE SHEET</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr>
        </table>
      </div>
      <table class="table-report bs-pdf">
        <thead>
          <tr>
            <th>L Sch</th>
            <th>Liabilities</th>
            <th class="num">Amount</th>
            <th>A Sch</th>
            <th>Assets</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="6">(No rows)</td></tr>'}</tbody>
        <tfoot>
          <tr>
            <td></td>
            <td class="bs-main">TOTAL</td>
            <td class="num bs-main">${escHtml(fmt(totals.liabilitiesTotal || 0))}</td>
            <td></td>
            <td class="bs-main">TOTAL</td>
            <td class="num bs-main">${escHtml(fmt(totals.assetsTotal || 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function buildTradingAccountReportHtml(data, metadata) {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const stockRows = Array.isArray(payload.stockRows) ? payload.stockRows : [];
  const expenseRows = Array.isArray(payload.expenseRows) ? payload.expenseRows : [];
  const summary = payload.summary || {};
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Trading A/C');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const fmt = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qty = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const body = [];
  stockRows.forEach((r) => {
    const titleText = escHtml(String(r.NAME || r.CODE || '').trim());
    const lTotal = (Number(r.OAMT) || 0) + (Number(r.PAMT) || 0) + (Number(r.GPROFIT) || 0);
    const rTotal = (Number(r.SAMT) || 0) + (Number(r.CAMT) || 0) + (Number(r.GLOSS) || 0);
    const showOpening = (Number(r.OWGT) || 0) !== 0;
    const showPurchase = (Number(r.PWGT) || 0) !== 0;
    const showSales = (Number(r.SWGT) || 0) !== 0;
    const showShort = (Number(r.SHORT) || 0) !== 0;
    body.push(`<tr class="trading-title"><td colspan="8">${titleText}</td></tr>`);
    if (showOpening || showSales) {
      body.push(
        `<tr><td>${showOpening ? 'OPENING' : ''}</td><td class="num">${showOpening ? qty(r.OWGT) : ''}</td><td class="num">${showOpening ? fmt(r.OAMT) : ''}</td><td class="num"></td><td>${showSales ? 'SALES' : ''}</td><td class="num">${showSales ? qty(r.SWGT) : ''}</td><td class="num">${showSales ? fmt(r.SAMT) : ''}</td><td class="num"></td></tr>`
      );
    }
    if (showPurchase || showShort) {
      body.push(
        `<tr><td>${showPurchase ? 'PURCHASE' : ''}</td><td class="num">${showPurchase ? qty(r.PWGT) : ''}</td><td class="num">${showPurchase ? fmt(r.PAMT) : ''}</td><td class="num"></td><td>${showShort ? 'SHORT/ACCESS' : ''}</td><td class="num">${showShort ? qty(r.SHORT) : ''}</td><td class="num"></td><td class="num"></td></tr>`
      );
    }
    body.push(`<tr><td>G.PROFIT</td><td class="num"></td><td class="num">${fmt(r.GPROFIT)}</td><td class="num"></td><td>CLOSING</td><td class="num">${qty(r.CWGT)}</td><td class="num">${fmt(r.CAMT)}</td><td class="num"></td></tr>`);
    if ((Number(r.GLOSS) || 0) !== 0) {
      body.push(`<tr><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td>G.LOSS</td><td class="num"></td><td class="num">${fmt(r.GLOSS)}</td><td class="num"></td></tr>`);
    }
    body.push(`<tr class="trading-total"><td>TOTAL</td><td class="num"></td><td class="num">${fmt(lTotal)}</td><td class="num"></td><td>TOTAL</td><td class="num"></td><td class="num">${fmt(rTotal)}</td><td class="num"></td></tr>`);
  });
  expenseRows.forEach((r) => {
    body.push(`<tr><td>${escHtml(String(r.NAME || '').trim())}</td><td class="num"></td><td class="num">${Number(r.DR_AMT) ? fmt(r.DR_AMT) : ''}</td><td class="num"></td><td></td><td class="num"></td><td class="num">${Number(r.CR_AMT) ? fmt(r.CR_AMT) : ''}</td><td class="num"></td></tr>`);
  });
  const summaryRows = `
    <tr class="trading-summary-head"><td colspan="8">SUMMARY</td></tr>
    <tr><td>OPENING</td><td class="num"></td><td class="num">${fmt(summary.opening)}</td><td class="num"></td><td>SALES</td><td class="num"></td><td class="num">${fmt(summary.sales)}</td><td class="num">${fmt(summary.salesRate)}</td></tr>
    <tr><td>PURCHASE</td><td class="num"></td><td class="num">${fmt(summary.purchase)}</td><td class="num">${fmt(summary.purchaseRate)}</td><td>CL.STOCK</td><td class="num"></td><td class="num">${fmt(summary.closing)}</td><td class="num"></td></tr>
    <tr><td>DIRECT EXP.</td><td class="num"></td><td class="num">${fmt(summary.directExp)}</td><td class="num"></td><td>DIRECT INCOME</td><td class="num"></td><td class="num">${fmt(summary.directInc)}</td><td class="num"></td></tr>
    <tr class="trading-total"><td>G.TOTAL</td><td class="num"></td><td class="num">${fmt(summary.leftTotal)}</td><td class="num"></td><td>G.TOTAL</td><td class="num"></td><td class="num">${fmt(summary.rightTotal)}</td><td class="num"></td></tr>
    <tr class="trading-total"><td>TOTAL GROSS PROFIT/LOSS</td><td class="num"></td><td class="num">${fmt(summary.grossProfitLoss)}</td><td class="num"></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td></tr>
  `;
  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .trading-ac-pdf .table-report { width: 100%; table-layout: fixed; font-size: 10px; }
        .trading-ac-pdf .table-report th, .trading-ac-pdf .table-report td { padding: 3px 4px; line-height: 1.12; }
        .trading-ac-pdf .table-report td.num, .trading-ac-pdf .table-report th.num { text-align: right; white-space: nowrap; }
        .trading-ac-pdf .trading-title td { font-weight: 700; border-top: 1px solid #999; }
        .trading-ac-pdf .trading-total td { font-weight: 700; border-top: 1px solid #ccc; }
        .trading-ac-pdf .trading-summary-head td { font-weight: 700; text-align: center; border-top: 2px solid #999; }
      </style>
      <div class="report-topbar trading-ac-pdf">
        <div class="kicker">TRADING A/C</div>
        <h1>${title}</h1>
        <div class="company">${company}</div>
        <table class="report-grid"><tr><td class="lbl">FY</td><td class="val">${fy}</td><td class="lbl">Period</td><td class="val">${period}</td></tr></table>
      </div>
      <table class="table-report trading-ac-pdf">
        <thead>
          <tr>
            <th>Particulars</th><th class="num">Weight</th><th class="num">Amount</th><th class="num">Avg.Rate</th>
            <th>Particulars</th><th class="num">Weight</th><th class="num">Amount</th><th class="num">Avg.Rate</th>
          </tr>
        </thead>
        <tbody>${body.join('')}${summaryRows}</tbody>
      </table>
    </div>
  `;
}

function buildProfitLossReportHtml(data, metadata) {
  const payload = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const trading = payload.trading || {};
  const blocks = Array.isArray(payload.scheduleBlocks) ? payload.scheduleBlocks : [];
  const totals = payload.totals || {};
  const company = escHtml(metadata.companyName || 'Company');
  const title = escHtml(metadata.reportTitle || 'Profit & Loss Account');
  const fy = escHtml(metadata.year || '—');
  const period = escHtml(metadata.period || '—');
  const fmt = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pairDebitCreditRows = (lines) => {
    const debit = [];
    const credit = [];
    (lines || []).forEach((ln) => {
      const drAmt = Number(ln?.DR_AMT) || 0;
      const crAmt = Number(ln?.CR_AMT) || 0;
      const drDetail = String(ln?.DR_DETAIL || '').trim();
      const crDetail = String(ln?.CR_DETAIL || '').trim();
      if (drAmt !== 0 || drDetail) debit.push({ detail: drDetail, amount: drAmt });
      if (crAmt !== 0 || crDetail) credit.push({ detail: crDetail, amount: crAmt });
    });
    const rowCount = Math.max(debit.length, credit.length);
    const out = [];
    for (let i = 0; i < rowCount; i += 1) {
      out.push({
        drDetail: debit[i]?.detail || '',
        drAmt: debit[i]?.amount || 0,
        crDetail: credit[i]?.detail || '',
        crAmt: credit[i]?.amount || 0,
      });
    }
    return out;
  };

  const amountCell = (v) => ((Number(v) || 0) ? escHtml(fmt(v)) : '');
  const lineRow = (lPart, lAmt, rPart, rAmt, cls = '') => `<tr class="${cls}">
    <td>${escHtml(String(lPart || '').trim()) || '&nbsp;'}</td>
    <td class="num">${amountCell(lAmt)}</td>
    <td>${escHtml(String(rPart || '').trim()) || '&nbsp;'}</td>
    <td class="num">${amountCell(rAmt)}</td>
  </tr>`;

  const sectionRows = [];
  sectionRows.push(`<tr class="pl-section"><td colspan="4">TRADING (SCHEDULE 12.10)</td></tr>`);
  sectionRows.push(lineRow(trading.DR_DETAIL, trading.DR_AMT, trading.CR_DETAIL, trading.CR_AMT));
  sectionRows.push(lineRow('SCHEDULE TOTAL', trading.DR_AMT, '', trading.CR_AMT, 'pl-total'));
  if (blocks.length) sectionRows.push(`<tr class="pl-section"><td colspan="4">SCHEDULE 16 ONWARDS</td></tr>`);
  blocks.forEach((blk) => {
    sectionRows.push(`<tr class="pl-schedule"><td colspan="4">${escHtml(String(blk.schedule || ''))} ${escHtml(String(blk.schName || ''))}</td></tr>`);
    const paired = pairDebitCreditRows(Array.isArray(blk.lines) ? blk.lines : []);
    paired.forEach((ln) => {
      sectionRows.push(lineRow(ln.drDetail, ln.drAmt, ln.crDetail, ln.crAmt));
    });
    sectionRows.push(lineRow('SCHEDULE TOTAL', blk.scheduleTotalDr, '', blk.scheduleTotalCr, 'pl-total'));
  });
  sectionRows.push(lineRow('TOTAL EXPENSES WITH GL', totals.totalLeftDr, 'TOTAL INCOME WITHOUT GP', totals.totalIncomeWithoutGp, 'pl-total'));
  sectionRows.push(lineRow(totals.netProfit ? 'NET PROFIT' : '', totals.netProfit, totals.netLoss ? 'NET LOSS' : '', totals.netLoss, 'pl-total'));
  sectionRows.push(lineRow('TOTAL', totals.grandTotal, 'TOTAL', totals.grandTotal, 'pl-grand'));

  return `
    <div class="report-doc">
      <style>
        ${PDF_REPORT_STYLES}
        .pl-pdf.report-doc { border: 1px solid #c8c8c8; padding: 12px 14px; }
        .pl-pdf .pl-header { text-align: center; margin-bottom: 10px; }
        .pl-pdf .pl-company { font-size: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
        .pl-pdf .pl-title { font-size: 18px; font-weight: 700; margin-top: 2px; text-transform: uppercase; }
        .pl-pdf .pl-period { font-size: 11px; margin-top: 4px; color: #444; }
        .pl-pdf .table-report { width: 100%; table-layout: fixed; font-size: 11px; border-collapse: collapse; }
        .pl-pdf .table-report th, .pl-pdf .table-report td { padding: 2px 3px; line-height: 1.08; vertical-align: top; }
        .pl-pdf .table-report thead th { text-align: left; border-top: 1px solid #999; border-bottom: 1px solid #999; background: #fff; color: #111; }
        .pl-pdf .table-report thead th.num, .pl-pdf .table-report td.num { text-align: right; white-space: nowrap; }
        .pl-pdf .table-report th:nth-child(1), .pl-pdf .table-report td:nth-child(1) { width: 39%; }
        .pl-pdf .table-report th:nth-child(2), .pl-pdf .table-report td:nth-child(2) { width: 11%; border-right: 1px solid #c8c8c8; }
        .pl-pdf .table-report th:nth-child(3), .pl-pdf .table-report td:nth-child(3) { width: 39%; }
        .pl-pdf .table-report th:nth-child(4), .pl-pdf .table-report td:nth-child(4) { width: 11%; }
        .pl-pdf .table-report td:nth-child(1),
        .pl-pdf .table-report td:nth-child(3) { white-space: normal; overflow-wrap: anywhere; }
        .pl-pdf .pl-section td { padding-top: 7px; padding-bottom: 3px; font-weight: 700; text-transform: uppercase; }
        .pl-pdf .pl-schedule td { padding-top: 5px; padding-bottom: 2px; font-weight: 700; }
        .pl-pdf .pl-total td { font-weight: 700; border-top: 1px solid #d8d8d8; }
        .pl-pdf .pl-grand td { font-weight: 700; border-top: 1px solid #777; }
      </style>
      <div class="pl-pdf report-doc">
        <div class="pl-header">
          <div class="pl-company">${company}</div>
          <div class="pl-title">${title}</div>
          <div class="pl-period">Financial year ${fy} &nbsp; | &nbsp; ${period}</div>
        </div>
        <table class="table-report">
          <thead>
            <tr>
              <th>Particulars</th>
              <th class="num">Amount</th>
              <th>Particulars</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>${sectionRows.join('') || '<tr><td colspan="4">(No rows)</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

/** Voucher entry list (Slide 28 list / Slide 14). */
function buildVoucherListReportHtml(data, metadata) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const company = escHtml(metadata.companyName || '');
  const sdt = escHtml(formatLedgerDateDisplay(metadata.startDate) || metadata.startDate || '');
  const edt = escHtml(formatLedgerDateDisplay(metadata.endDate) || metadata.endDate || '');
  const vtype = escHtml(metadata.vrTypeLabel || 'All types');
  const generated = escHtml(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));

  let tdr = 0;
  let tcr = 0;
  let body = '';
  rows.forEach((r) => {
    const dr = Number(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    const cr = Number(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
    tdr += dr;
    tcr += cr;
    body += `<tr>
      <td class="col-vr-type">${escHtml(String(r.VR_TYPE ?? r.vr_type ?? ''))}</td>
      <td class="col-date">${escHtml(formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date))}</td>
      <td class="col-vr-no">${escHtml(String(r.VR_NO ?? r.vr_no ?? ''))}</td>
      <td class="col-ac-type">${escHtml(String(r.TYPE ?? r.type ?? ''))}</td>
      <td class="col-code">${escHtml(String(r.CODE ?? r.code ?? ''))}</td>
      <td class="col-name">${escHtml(String(r.NAME ?? r.name ?? ''))}</td>
      <td class="amount col-amt">${formatStockPdf(dr)}</td>
      <td class="amount col-amt">${formatStockPdf(cr)}</td>
      <td class="col-date">${escHtml(formatLedgerDateDisplay(r.BILL_DATE ?? r.bill_date))}</td>
      <td class="col-bill-no">${escHtml(String(r.BILL_NO ?? r.bill_no ?? ''))}</td>
      <td class="col-btype">${escHtml(String(r.B_TYPE ?? r.b_type ?? ''))}</td>
      <td class="col-chq">${escHtml(String(r.CHQ_NO ?? r.chq_no ?? ''))}</td>
      <td class="col-detail">${escHtml(String(r.DETAIL ?? r.detail ?? ''))}</td>
      <td class="col-dc">${escHtml(String(r.DC_CODE ?? r.dc_code ?? ''))}</td>
    </tr>`;
  });

  const grand = `<tr class="report-grand-total">
    <td colspan="6" class="lbl-total">Grand total (${rows.length} lines)</td>
    <td class="amount col-amt">${formatStockPdf(tdr)}</td>
    <td class="amount col-amt">${formatStockPdf(tcr)}</td>
    <td colspan="6"></td>
  </tr>`;

  return `
    <div class="report-doc voucher-list-pdf">
      <style>${PDF_REPORT_STYLES}</style>
      <div class="report-topbar">
        <div class="kicker">VOUCHER</div>
        <h1>Cash / bank / journal voucher list</h1>
        <div class="company">${company}</div>
        <table class="report-grid">
          <tr><td class="lbl">Period</td><td class="val">${sdt} to ${edt}</td><td class="lbl">Voucher type</td><td class="val">${vtype}</td></tr>
        </table>
        <div class="report-period">Generated: ${generated}</div>
      </div>
      <table class="table-report">
        <thead>
          <tr>
            <th class="col-vr-type">Vr type</th><th class="col-date">Vr date</th><th class="col-vr-no">Vr no</th>
            <th class="col-ac-type">Type</th><th class="col-code">Code</th><th class="col-name">Name</th>
            <th class="amount col-amt">Dr amt</th><th class="amount col-amt">Cr amt</th><th class="col-date">Bill date</th>
            <th class="col-bill-no">Bill no</th><th class="col-btype">B type</th><th class="col-chq">Chq no</th>
            <th class="col-detail">Detail</th><th class="col-dc">Dc code</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="14">(No rows)</td></tr>'}${rows.length ? grand : ''}</tbody>
      </table>
      <div class="report-foot">Report generated from voucher list with selected filters.</div>
    </div>
  `;
}

/** Single voucher print (VouPrn) — FoxPro-style layout. */
function voucherPrintDocTitle(vrType) {
  const t = String(vrType ?? '').trim().toUpperCase();
  if (t === 'CV') return 'CASH VOUCHER';
  if (t === 'BV') return 'BANK VOUCHER';
  if (t === 'JV') return 'JOURNAL VOUCHER';
  return t ? `${t} VOUCHER` : 'VOUCHER';
}

function voucherPrintAmtCell(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 0.0005) return '';
  return v.toFixed(2);
}

function voucherPrintLineSubtext(line) {
  const detail = String(line.detail ?? '').trim();
  if (detail) return detail;
  const bd = String(line.bill_date ?? '').trim();
  const bn = String(line.bill_no ?? '').trim();
  if (bd && bn) return `Bill ${bd} #${bn}`;
  if (bd) return `Bill ${bd}`;
  const chq = String(line.chq_no ?? '').trim();
  if (chq) return `Chq ${chq}`;
  return '';
}

function voucherPrintAmountInWords(amount) {
  const raw = rupeesToWords(amount);
  if (!raw) return '';
  let s = raw.replace(/^Rupees\s+/i, '');
  s = s.replace(/\s+and\s+(.+?)\s+Paise\s+Only$/i, ' AND PAISE $1 ONLY');
  if (!/\sONLY$/i.test(s)) s = `${s} ONLY`;
  return `RS. ${s.toUpperCase()}`;
}

export function isCashReceiptVoucher(header) {
  return (
    String(header?.vr_type ?? '').trim().toUpperCase() === 'CV' &&
    String(header?.type ?? '').trim().toUpperCase() === 'R'
  );
}

function cashReceiptFmtAmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.00';
  return v.toFixed(2);
}

function cashReceiptLineAmounts(line) {
  const cr = Number(line.cr_amt ?? 0) || 0;
  const dr = Number(line.dr_amt ?? 0) || 0;
  const intAmt = Number(line.int_amt ?? 0) || 0;
  const cashReceived = cr || dr;
  const total = cashReceived;
  const billAmt = Math.max(0, total - intAmt);
  return { billAmt, intAmt, total, cashReceived };
}

function cashReceiptTelLine(metadata) {
  const parts = [
    cleanPrintText(metadata?.compTel1),
    cleanPrintText(metadata?.compTel2),
    cleanPrintText(metadata?.compTel3),
  ].filter(Boolean);
  return parts.length ? `Tel: ${parts.join(', ')}` : '';
}

function buildCashReceiptCopyHtml(data, metadata) {
  const header = data?.header || {};
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const company = escHtml(metadata.companyName || '');
  const add1 = escHtml(metadata.compAdd1 || '');
  const add2 = escHtml(metadata.compAdd2 || '');
  const compPan = escHtml(metadata.compPan || '');
  const fssai = escHtml(metadata.compFssai || '');
  const telLine = escHtml(cashReceiptTelLine(metadata));
  const receiptDate = escHtml(String(header.vr_date ?? ''));
  const receiptNo = escHtml(String(header.vr_no ?? ''));
  const partyLabel = escHtml(
    String(metadata.partyName || metadata.partyCode || '').trim() || '—'
  );
  const partyPan = escHtml(String(metadata.partyPan || '').trim() || '—');
  const forCompany = company || 'Company';

  let totalCash = 0;
  let body = '';
  lines.forEach((l) => {
    const { billAmt, intAmt, total, cashReceived } = cashReceiptLineAmounts(l);
    totalCash += cashReceived;
    body += `<tr>
      <td style="padding:4px 2px;text-align:left;">${escHtml(String(l.bill_date ?? ''))}</td>
      <td style="padding:4px 2px;text-align:center;">${escHtml(String(l.bill_no ?? ''))}</td>
      <td style="padding:4px 2px;text-align:center;">${escHtml(String(l.v_date ?? ''))}</td>
      <td style="padding:4px 2px;text-align:right;">${cashReceiptFmtAmt(billAmt)}</td>
      <td style="padding:4px 2px;text-align:right;">${cashReceiptFmtAmt(intAmt)}</td>
      <td style="padding:4px 2px;text-align:right;">${cashReceiptFmtAmt(total)}</td>
      <td style="padding:4px 2px;text-align:right;">${cashReceiptFmtAmt(cashReceived)}</td>
    </tr>`;
  });
  const blankRows = Math.max(0, 4 - lines.length);
  for (let i = 0; i < blankRows; i += 1) {
    body += `<tr class="cash-receipt-blank-row"><td colspan="7" style="padding:7px 2px;">&nbsp;</td></tr>`;
  }

  const fssaiHtml = fssai ? `FSSAI No. ${fssai}` : '';
  const panHtml = compPan ? `PAN ${compPan}` : '';

  return `
    <div class="cash-receipt-copy">
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:9pt;">
        <tr>
          <td colspan="3" align="center" style="font-weight:700;font-size:11pt;padding-bottom:3px;">${company}</td>
        </tr>
        <tr>
          <td width="22%" align="left" valign="top" style="font-size:8pt;padding-bottom:2px;">${panHtml}</td>
          <td width="56%" align="center" valign="top" style="font-size:8pt;line-height:1.3;padding-bottom:2px;">
            ${add1 ? `<div>${add1}</div>` : ''}
            ${add2 ? `<div>${add2}</div>` : ''}
          </td>
          <td width="22%">&nbsp;</td>
        </tr>
        <tr>
          <td align="left" style="font-size:8pt;">&nbsp;</td>
          <td align="center" style="font-size:8pt;">${fssaiHtml}</td>
          <td align="right" style="font-size:8pt;white-space:nowrap;">${telLine}</td>
        </tr>
      </table>
      <hr class="cash-receipt-rule" />
      <table width="100%" cellspacing="0" cellpadding="2" style="border-collapse:collapse;font-size:9pt;">
        <tr>
          <td width="33%" align="left">Receipt Date ${receiptDate}</td>
          <td width="34%" align="center" style="font-weight:700;font-size:10pt;">CASH RECEIPT</td>
          <td width="33%" align="right">Receipt No. ${receiptNo}</td>
        </tr>
      </table>
      <hr class="cash-receipt-rule" />
      <table width="100%" cellspacing="0" cellpadding="2" style="border-collapse:collapse;font-size:9pt;margin-bottom:4px;">
        <tr>
          <td width="55%" align="left">Party&nbsp;&nbsp;${partyLabel}</td>
          <td width="45%" align="right">PAN&nbsp;&nbsp;${partyPan}</td>
        </tr>
      </table>
      <hr class="cash-receipt-rule" />
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:8.5pt;table-layout:fixed;">
        <colgroup>
          <col style="width:14%;" />
          <col style="width:10%;" />
          <col style="width:14%;" />
          <col style="width:14%;" />
          <col style="width:14%;" />
          <col style="width:12%;" />
          <col style="width:22%;" />
        </colgroup>
        <thead>
          <tr>
            <th align="left" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">Bill Date</th>
            <th align="center" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">Bill No.</th>
            <th align="center" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">V. Date</th>
            <th align="right" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">Bill Amount</th>
            <th align="right" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">Int. Amount</th>
            <th align="right" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">Total</th>
            <th align="right" style="font-weight:700;padding:2px;border-bottom:1px solid #000;">Cash Received</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="7" style="padding:8px 2px;">&nbsp;</td></tr>'}</tbody>
        <tfoot>
          <tr>
            <td colspan="6" style="border-top:1px solid #000;padding-top:4px;"></td>
            <td align="right" style="border-top:1px solid #000;padding-top:4px;font-weight:700;white-space:nowrap;">
              TOTAL&nbsp;&nbsp;<span style="display:inline-block;border-top:3px double #000;border-bottom:1px solid #000;padding:2px 0 3px;min-width:4.5rem;">${cashReceiptFmtAmt(totalCash)}</span>
            </td>
          </tr>
        </tfoot>
      </table>
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:8.5pt;margin-top:10px;">
        <tr>
          <td align="left" valign="top">E. &amp; O.E.</td>
          <td align="right" valign="top" style="font-weight:700;">For ${forCompany}</td>
        </tr>
        <tr>
          <td>&nbsp;</td>
          <td align="right" style="padding-top:28px;">Auth. Signatory</td>
        </tr>
      </table>
    </div>
  `;
}

function buildCashReceiptPrintReportHtml(data, metadata) {
  const copy = buildCashReceiptCopyHtml(data, metadata);
  return `
    <div class="voucher-doc cash-receipt-sheet">
      ${copy}
      ${copy}
    </div>
  `;
}

const CASH_RECEIPT_PRINT_DOC_CSS = `
  html, body {
    margin: 0;
    padding: 0;
    background: #fff !important;
    width: 210mm;
    box-sizing: border-box;
  }
  .cash-receipt-sheet {
    font-family: 'Times New Roman', Times, serif;
    font-size: 9pt;
    color: #000;
    width: 210mm;
    max-width: 210mm;
    margin: 0 auto;
    padding: 4mm 0 6mm;
    box-sizing: border-box;
    background: #fff !important;
  }
  .cash-receipt-copy {
    width: 148mm;
    max-width: 148mm;
    min-height: 132mm;
    margin: 0 auto;
    padding: 2mm 3mm;
    box-sizing: border-box;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .cash-receipt-copy + .cash-receipt-copy {
    border-top: 1px dashed #444;
    margin-top: 3mm;
    padding-top: 4mm;
  }
  .cash-receipt-rule {
    border: none;
    border-top: 1px solid #000;
    margin: 4px 0;
    height: 0;
  }
  @page {
    size: A4 portrait;
    margin: 6mm;
  }
  @media print {
    html, body { width: auto; }
    .cash-receipt-sheet { width: 100%; max-width: none; padding: 0; }
    .cash-receipt-copy + .cash-receipt-copy {
      border-top: 1px dashed #444;
    }
  }
`;

const VOUCHER_PRINT_DOC_CSS = `
  html, body {
    margin: 0;
    padding: 0;
    background: #fff !important;
    width: 794px;
    box-sizing: border-box;
  }
  .voucher-doc {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    color: #000;
    width: 754px;
    max-width: 754px;
    margin: 0 auto;
    padding: 8px 0 24px;
    box-sizing: border-box;
    background: #fff !important;
  }
  .voucher-doc table { border-collapse: collapse; }
  .voucher-doc__rule {
    border: none;
    border-top: 1px solid #000;
    margin: 6px 0;
    height: 0;
  }
  @media print {
    html, body { width: auto; }
    .voucher-doc { width: 100%; max-width: none; padding: 0; }
  }
`;

function buildVoucherPrintReportHtml(data, metadata) {
  const header = data?.header || {};
  if (isCashReceiptVoucher(header)) {
    return buildCashReceiptPrintReportHtml(data, metadata);
  }
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const company = escHtml(metadata.companyName || header.comp_name || '');
  const add1 = escHtml(metadata.compAdd1 || '');
  const add2 = escHtml(metadata.compAdd2 || '');
  const addressLine = [add1, add2].filter(Boolean).join(', ');
  const vrTypeRaw = String(header.vr_type ?? '');
  const vrDate = escHtml(String(header.vr_date ?? ''));
  const vrNo = escHtml(String(header.vr_no ?? ''));
  const docTitle = escHtml(voucherPrintDocTitle(vrTypeRaw));
  const preparedBy = escHtml(String(metadata.userName || metadata.preparedBy || '').trim());
  const printedOn = escHtml(String(metadata.printedDate || metadata.printDate || ''));

  let tdr = 0;
  let tcr = 0;
  let body = '';
  lines.forEach((l) => {
    const dr = Number(l.dr_amt ?? 0) || 0;
    const cr = Number(l.cr_amt ?? 0) || 0;
    tdr += dr;
    tcr += cr;
    const name = escHtml(String(l.name ?? '').trim() || String(l.code ?? ''));
    const sub = voucherPrintLineSubtext(l);
    const subHtml = sub
      ? `<div style="margin-top:2px;padding-left:18px;font-weight:400;line-height:1.25;">${escHtml(sub)}</div>`
      : '';
    body += `<tr>
      <td style="width:68%;text-align:left;vertical-align:top;padding:6px 8px 8px 0;">
        <div style="font-weight:700;line-height:1.25;">${name}</div>
        ${subHtml}
      </td>
      <td style="width:16%;text-align:right;vertical-align:top;padding:6px 4px 8px 0;">${escHtml(voucherPrintAmtCell(dr))}</td>
      <td style="width:16%;text-align:right;vertical-align:top;padding:6px 0 8px 4px;">${escHtml(voucherPrintAmtCell(cr))}</td>
    </tr>`;
  });

  const amountForWords = Math.max(tdr, tcr) || tdr || tcr;
  const words = escHtml(voucherPrintAmountInWords(amountForWords));
  const forCompany = company || 'Company';

  return `
    <div class="voucher-doc voucher-print-pdf-wrap">
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
        <tr>
          <td align="center" style="font-weight:700;font-size:13px;padding-bottom:4px;">${company}</td>
        </tr>
        ${
          addressLine
            ? `<tr><td align="center" style="font-size:10px;line-height:1.35;padding-bottom:8px;">${addressLine}</td></tr>`
            : ''
        }
      </table>
      <hr class="voucher-doc__rule" />
      <table width="100%" cellspacing="0" cellpadding="2" style="border-collapse:collapse;font-size:11px;">
        <tr>
          <td width="33%" align="left" style="vertical-align:middle;">Vr.Date ${vrDate}</td>
          <td width="34%" align="center" style="vertical-align:middle;font-weight:700;letter-spacing:0.04em;">${docTitle}</td>
          <td width="33%" align="right" style="vertical-align:middle;">Vr.No. ${vrNo}</td>
        </tr>
      </table>
      <hr class="voucher-doc__rule" />
      <table width="100%" cellspacing="0" cellpadding="4" style="border-collapse:collapse;table-layout:fixed;">
        <colgroup>
          <col style="width:68%;" />
          <col style="width:16%;" />
          <col style="width:16%;" />
        </colgroup>
        <thead>
          <tr>
            <th align="left" style="font-weight:700;font-size:11px;padding:4px 8px 6px 0;border-bottom:1px solid #000;">PARTICULARS</th>
            <th align="right" style="font-weight:700;font-size:11px;padding:4px 4px 6px 0;border-bottom:1px solid #000;">Dr.Amount</th>
            <th align="right" style="font-weight:700;font-size:11px;padding:4px 0 6px 4px;border-bottom:1px solid #000;">Cr.Amount</th>
          </tr>
        </thead>
        <tbody>${body || '<tr><td colspan="3">(No lines)</td></tr>'}</tbody>
        <tfoot>
          <tr>
            <td style="border-top:1px solid #000;padding-top:6px;"></td>
            <td align="right" style="border-top:1px solid #000;padding-top:6px;font-weight:700;">${escHtml(voucherPrintAmtCell(tdr))}</td>
            <td align="right" style="border-top:1px solid #000;padding-top:6px;font-weight:700;">${escHtml(voucherPrintAmtCell(tcr))}</td>
          </tr>
        </tfoot>
      </table>
      <hr class="voucher-doc__rule" />
      <div style="font-size:10.5px;line-height:1.4;margin:8px 0 12px;text-transform:uppercase;">${words}</div>
      <hr class="voucher-doc__rule" />
      <div style="text-align:right;font-weight:700;margin:18px 0 28px;">For ${forCompany}</div>
      <table width="100%" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:10.5px;margin-top:8px;">
        <tr>
          <td width="33%" align="center" valign="top">
            <div>Prepared By</div>
            <div style="margin-top:28px;font-size:10px;text-transform:uppercase;">${preparedBy}${preparedBy && printedOn ? ' ' : ''}${printedOn}</div>
          </td>
          <td width="34%" align="center" valign="top">Checked By</td>
          <td width="33%" align="center" valign="top">Auth.Signatory</td>
        </tr>
      </table>
    </div>
  `;
}

/** Full HTML document for voucher print / PDF (styles in head — html2pdf needs this). */
export function buildVoucherPrintDocumentHtml(data, metadata) {
  const header = data?.header || {};
  const bodyHtml = buildVoucherPrintReportHtml(data, metadata);
  const isReceipt = isCashReceiptVoucher(header);
  const css = isReceipt ? CASH_RECEIPT_PRINT_DOC_CSS : VOUCHER_PRINT_DOC_CSS;
  const bodyStyle = isReceipt
    ? 'margin:0;padding:0;background:#fff;width:210mm;box-sizing:border-box;'
    : 'margin:0;padding:20px 20px 24px;background:#fff;width:794px;box-sizing:border-box;';
  const viewport = isReceipt ? 'width=794' : 'width=794';
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="${viewport}" />
    <style>${css}</style>
  </head>
  <body style="${bodyStyle}">${bodyHtml}</body>
</html>`;
}

function removeStrayHtml2pdfNodes() {
  try {
    document.querySelectorAll('.html2pdf__container, .html2pdf-container').forEach((n) => n.remove());
  } catch {
    /* ignore */
  }
}

function wrapReportHtmlForPdf(htmlContent) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1280" />
  </head>
  <body style="margin:0;padding:0;background:#fff;">${htmlContent}</body>
</html>`;
}

async function withPdfGenerationGuard(work) {
  removeStrayHtml2pdfNodes();
  const overlay = document.createElement('div');
  overlay.className = 'windal-pdf-busy-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = '<div class="windal-pdf-busy-overlay__inner">Preparing PDF…</div>';
  document.body.appendChild(overlay);
  try {
    return await work();
  } finally {
    overlay.remove();
    removeStrayHtml2pdfNodes();
  }
}

function assertPdfBlob(blob) {
  if (!blob || blob.size < 4000) {
    throw new Error('PDF could not be generated on this device. Try again or use Excel export.');
  }
}

function createJsPdfA4Portrait() {
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
}

function pdfPageLayout(doc, marginMm = 8) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const lm = marginMm;
  const contentW = pw - lm * 2;
  return { pw, ph, lm, contentW };
}

function scalePdfCols(cols, contentW) {
  const total = cols.reduce((s, c) => s + c.w, 0);
  if (total <= 0) return cols;
  const scale = contentW / total;
  let used = 0;
  cols.forEach((c, i) => {
    if (i === cols.length - 1) {
      c.w = Math.max(8, contentW - used);
    } else {
      c.w = c.w * scale;
      used += c.w;
    }
  });
  return cols;
}

function pdfColLayout(cols, lm) {
  const xAt = [];
  let x = lm;
  cols.forEach((c) => {
    xAt.push(x);
    x += c.w;
  });
  return { xAt, tableW: x - lm };
}

/** Trial balance: text cols on the left; amount cols packed flush to the right edge. */
function pdfTrialBalanceColLayout(leftDefs, amtDefs, lm, contentW) {
  const gap = 0.5;
  const rightEdge = lm + contentW;
  const amtBlockW = contentW * 0.58;

  const scaleGroup = (defs, budget) => {
    const sum = defs.reduce((s, c) => s + c.w, 0);
    const scale = budget / sum;
    return defs.map((c) => ({ ...c, w: c.w * scale }));
  };

  const leftBudget = Math.max(36, contentW - amtBlockW - gap);
  const leftCols = scaleGroup(leftDefs, leftBudget);
  const amtCols = scaleGroup(amtDefs, amtBlockW);
  const cols = [...leftCols, ...amtCols];

  const xAt = [];
  let x = lm;
  leftCols.forEach((c) => {
    xAt.push(x);
    x += c.w;
  });

  const amtStartX = rightEdge - amtCols.reduce((s, c) => s + c.w, 0);
  let xAmt = amtStartX;
  amtCols.forEach((c) => {
    xAt.push(xAmt);
    xAmt += c.w;
  });

  return { cols, xAt, rightEdge };
}

/** One-line text for narrow PDF columns (city, short codes). */
function pdfTruncateLine(doc, text, maxWidthMm, fontSize, fontStyle = 'normal') {
  const raw = String(text ?? '').trim();
  if (!raw) return '—';
  doc.setFont('helvetica', fontStyle);
  doc.setFontSize(fontSize);
  if (doc.getTextWidth(raw) <= maxWidthMm) return raw;
  let s = raw;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxWidthMm) s = s.slice(0, -1);
  return `${s}…`;
}

function tbScheduleKey(row) {
  const v = row?.SCHEDULE ?? row?.schedule ?? row?.SCH_NO ?? row?.sch_no;
  if (v == null) return '';
  return String(v).trim();
}

function tbNum(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/,/g, '').trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function computeTbScheduleTotals(rows) {
  const m = new Map();
  (rows || []).forEach((r) => {
    if (trialBalanceRowKind(r) !== 0) return;
    const key = tbScheduleKey(r);
    if (!key) return;
    const curr = m.get(key) || { closingDr: 0, closingCr: 0, periodDr: 0, periodCr: 0 };
    curr.closingDr += tbNum(r.CLOSING_DR ?? r.closing_dr);
    curr.closingCr += tbNum(r.CLOSING_CR ?? r.closing_cr);
    curr.periodDr += tbNum(r.DR_AMT ?? r.dr_amt);
    curr.periodCr += tbNum(r.CR_AMT ?? r.cr_amt);
    m.set(key, curr);
  });
  return m;
}

/** Trial balance PDF via jsPDF (reliable on iPhone; html2canvas often yields blank multi-page PDFs). */
function buildTrialBalanceJsPdfBlob(data, metadata) {
  const doc = createJsPdfA4Portrait();
  const { pw, ph, lm, contentW } = pdfPageLayout(doc, 3.5);
  const MIN_ROW_H = 4.8;
  const LINE_H = 2.65;
  const ROW_PAD_TOP = 1.5;
  const ROW_GAP = 0.45;
  const SUBTOTAL_GAP = 1.1;
  const TB_BODY_FS = 5;
  const TB_HEAD_FS = 5.5;
  const TB_AMT_FS = 5;
  const TB_AMT_MIN = 2;
  const TB_HEAD_AMT_FS = 4.2;
  const NAVY = [15, 30, 60];
  const ACCENT = [0, 194, 168];
  const INDIGO = [42, 79, 168];
  const PANEL = [234, 238, 253];
  const STRIPE = [244, 246, 251];
  const SUBTOTAL = [224, 231, 255];
  const RED = [197, 48, 48];
  const GREEN = [47, 133, 90];
  const BORDER = [180, 192, 214];

  const cols = scalePdfCols(
    [
      { label: 'Sch', w: 7 },
      { label: 'Account', w: 30 },
      { label: 'Code', w: 8 },
      { label: 'City', w: 10, text: true },
      { label: 'Cl.Dr.Amt', w: 24, right: true, debit: true },
      { label: 'Cl.Cr.Amt', w: 24, right: true, credit: true },
      { label: 'Tot.Dr.Amt', w: 24, right: true },
      { label: 'Tot.Cr.Amt', w: 24, right: true },
    ],
    contentW
  );
  const { xAt } = pdfColLayout(cols, lm);
  const rightEdge = lm + contentW;

  const fillBand = (y0, h, rgb) => {
    doc.setFillColor(...rgb);
    doc.rect(lm, y0, contentW, h, 'F');
  };

  const hline = (y0, color = BORDER) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.25);
    doc.line(lm, y0, lm + contentW, y0);
  };

  const colTextX = (colIndex) => {
    const c = cols[colIndex];
    if (!c.right) return xAt[colIndex] + 0.6;
    // Keep right-most numeric column slightly inset from page edge.
    return Math.min(xAt[colIndex] + c.w - 0.9, rightEdge - 0.9);
  };

  let y = 8;

  // Title band
  fillBand(y, 10, NAVY);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('TRIAL BALANCE REPORT', lm + contentW / 2, y + 6.2, { align: 'center' });
  y += 11;

  // Company panel
  fillBand(y, 12, PANEL);
  doc.setDrawColor(...INDIGO);
  doc.setLineWidth(0.35);
  doc.rect(lm, y, contentW, 12, 'S');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(String(metadata?.companyName || ''), lm + 2, y + 4.8, { maxWidth: contentW - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 106, 138);
  doc.text(`${metadata?.year || ''}   ${metadata?.endDate || ''}`, lm + 2, y + 9.2, { maxWidth: contentW - 4 });
  y += 14;

  const tbSummary = computeTrialTopSummary(data);
  const gcdr = tbSummary.closingDr;
  const gccr = tbSummary.closingCr;
  const schTotals = computeTbScheduleTotals(data);
  // For PDF grand row, period totals must come from detail rows (same basis as on-screen grid).
  let gpdr = 0;
  let gpcr = 0;
  (data || []).forEach((r) => {
    if (trialBalanceRowKind(r) !== 0) return;
    gpdr += parseFloat(r.DR_AMT ?? r.dr_amt ?? 0) || 0;
    gpcr += parseFloat(r.CR_AMT ?? r.cr_amt ?? 0) || 0;
  });

  const boxW = (contentW - 4) / 2;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.35);
  doc.rect(lm, y, boxW, 8, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.5);
  doc.setTextColor(120, 130, 150);
  doc.text('TOTAL DEBIT', lm + 2, y + 2.8);
  doc.setTextColor(...GREEN);
  const drBoxFit = pdfFitAmountCell(doc, formatAmtPdf(gcdr), boxW - 3, 7, 'bold', 4);
  doc.setFontSize(drBoxFit.fontSize);
  doc.text(drBoxFit.text, lm + 2, y + 6.2, { maxWidth: boxW - 3 });

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...RED);
  doc.rect(lm + boxW + 4, y, boxW, 8, 'FD');
  doc.setTextColor(120, 130, 150);
  doc.setFontSize(5.5);
  doc.text('TOTAL CREDIT', lm + boxW + 6, y + 2.8);
  doc.setTextColor(...RED);
  const crBoxFit = pdfFitAmountCell(doc, formatAmtPdf(gccr), boxW - 3, 7, 'bold', 4);
  doc.setFontSize(crBoxFit.fontSize);
  doc.text(crBoxFit.text, lm + boxW + 6, y + 6.2, { maxWidth: boxW - 3 });
  y += 10;

  const drawColHead = () => {
    const headH = 6.2;
    fillBand(y, headH, NAVY);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    cols.forEach((c, i) => {
      const tx = colTextX(i);
      const headFs = c.right ? TB_HEAD_AMT_FS : TB_HEAD_FS;
      doc.setFontSize(headFs);
      doc.text(c.label, tx, y + 4.2, {
        align: c.right ? 'right' : 'left',
        maxWidth: Math.max(2, c.w - 0.6),
      });
    });
    y += headH + 0.35;
    hline(y);
    y += 0.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(TB_BODY_FS);
    doc.setTextColor(...NAVY);
  };

  drawColHead();

  const pageBottom = ph - 12;
  let rowStripe = 0;

  const cellContent = (txt, col, fontSize, fontStyle, rowStyle = 'normal') => {
    const raw = String(txt ?? '').trim();
    if (!raw) return { lines: ['—'], fontSize };
    if (col.right) {
      const minFs =
        rowStyle === 'grand' ? TB_AMT_MIN : rowStyle === 'subtotal' ? TB_AMT_MIN + 0.15 : TB_AMT_MIN + 0.25;
      const fit = pdfFitAmountCell(doc, raw, col.w - 0.8, fontSize, fontStyle, minFs);
      return { lines: fit.lines, fontSize: fit.fontSize };
    }
    if (col.text) {
      return {
        lines: [pdfTruncateLine(doc, raw, col.w - 1.2, fontSize, fontStyle)],
        fontSize,
      };
    }
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', fontStyle);
    const maxLines = col.label === 'Account' ? 2 : 1;
    const parts = doc.splitTextToSize(raw, Math.max(2, col.w - 1.2));
    return {
      lines: parts.slice(0, maxLines),
      fontSize,
    };
  };

  const measureRowHeight = (cells, textFs, amtFs, fontStyle, rowStyle = 'normal') => {
    let maxLines = 1;
    cells.forEach((txt, i) => {
      const fs = cols[i].right ? amtFs : textFs;
      const { lines } = cellContent(txt, cols[i], fs, fontStyle, rowStyle);
      maxLines = Math.max(maxLines, lines.length);
    });
    return Math.max(MIN_ROW_H, ROW_PAD_TOP + maxLines * LINE_H + 1);
  };

  const amountHasValue = (txt) => {
    const s = String(txt ?? '').trim();
    return s && s !== '—' && s !== '-';
  };

  const newPageIfNeeded = (neededH) => {
    if (y + neededH > pageBottom) {
      doc.addPage();
      y = 10;
      drawColHead();
      rowStripe = 0;
    }
  };

  const writeCells = (cells, style = 'normal') => {
    const isSubtotal = style === 'subtotal';
    const isGrand = style === 'grand';
    const fontSize = isGrand ? TB_HEAD_FS : TB_BODY_FS;
    const fontStyle = style === 'normal' ? 'normal' : 'bold';
    const amtBaseFs = isGrand ? TB_HEAD_FS : TB_AMT_FS;
    const rowH = measureRowHeight(cells, fontSize, amtBaseFs, fontStyle, style);
    const leadGap = isSubtotal || isGrand ? SUBTOTAL_GAP : 0;

    newPageIfNeeded(leadGap + rowH + ROW_GAP);
    if (leadGap > 0) y += leadGap;

    const rowTop = y;

    if (style === 'stripe') {
      fillBand(rowTop, rowH, rowStripe % 2 === 0 ? [255, 255, 255] : STRIPE);
      rowStripe += 1;
    } else if (isSubtotal) {
      fillBand(rowTop, rowH, SUBTOTAL);
    } else if (isGrand) {
      fillBand(rowTop, rowH, NAVY);
    }

    cells.forEach((txt, i) => {
      const c = cols[i];
      const cellFsBase = c.right ? amtBaseFs : fontSize;
      const { lines, fontSize: cellFs } = cellContent(txt, c, cellFsBase, fontStyle, style);
      const tx = colTextX(i);

      if (isGrand) doc.setTextColor(255, 255, 255);
      else if (c.credit && amountHasValue(txt)) doc.setTextColor(...RED);
      else if (c.debit && amountHasValue(txt)) doc.setTextColor(...GREEN);
      else if (isSubtotal) doc.setTextColor(...INDIGO);
      else doc.setTextColor(...NAVY);

      doc.setFont('helvetica', fontStyle);
      doc.setFontSize(cellFs);

      let lineY = rowTop + ROW_PAD_TOP + LINE_H - 0.5;
      lines.forEach((line) => {
        const drawX = c.right ? Math.min(tx, rightEdge - 0.35) : tx;
        doc.text(line, drawX, lineY, { align: c.right ? 'right' : 'left', maxWidth: c.right ? c.w - 0.6 : undefined });
        lineY += LINE_H;
      });
    });

    y = rowTop + rowH + ROW_GAP;
    if (isSubtotal || isGrand) {
      hline(y, isGrand ? ACCENT : INDIGO);
      y += 0.5;
    }
  };

  sortTrialBalanceRows(data || []).forEach((row) => {
    const kind = trialBalanceRowKind(row);
    const nameVal = trialBalanceRowLabel(row);
    const schVal = row.SCHEDULE ?? row.schedule ?? '';
    const isTotal = kind >= 1;
    const isGrand = kind === 2;
    const isScheduleTotal = kind === 1;
    const style = kind === 2 ? 'grand' : kind === 1 ? 'subtotal' : 'stripe';

    const cityVal = row.CITY ?? row.city ?? '';
    const rowDrAmt = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
    const rowCrAmt = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
    const rowClosingDr = parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
    const rowClosingCr = parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
    const sch = isScheduleTotal ? schTotals.get(tbScheduleKey(row)) : null;

    // Keep grand row aligned with top cards + period totals.
    const grandAlignedClosingDr = isGrand ? gcdr : sch ? sch.closingDr : rowClosingDr;
    const grandAlignedClosingCr = isGrand ? gccr : sch ? sch.closingCr : rowClosingCr;
    const grandAlignedDr = isGrand ? gpdr : sch ? sch.periodDr : rowDrAmt;
    const grandAlignedCr = isGrand ? gpcr : sch ? sch.periodCr : rowCrAmt;

    writeCells(
      [
        isTotal && (schVal === '' || schVal == null) ? '' : schVal,
        nameVal,
        isTotal ? '' : (row.CODE ?? row.code ?? ''),
        isTotal ? '' : cityVal,
        formatAmtPdf(grandAlignedClosingDr),
        formatAmtPdf(grandAlignedClosingCr),
        formatAmtPdf(grandAlignedDr),
        formatAmtPdf(grandAlignedCr),
      ],
      style
    );
  });

  // Page numbers
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(120, 130, 150);
    doc.text(`Page ${p} of ${pageCount}`, pw - lm, ph - 5, { align: 'right' });
  }

  doc.setProperties({ title: 'Trial Balance', keywords: 'tb-pdf-layout-6' });

  return doc.output('blob');
}

/** Ledger PDF via jsPDF (styled like trial balance; reliable on mobile). */
function buildLedgerJsPdfBlob(data, metadata) {
  const rows = Array.isArray(data) ? data : [];
  const doc = createJsPdfA4Portrait();
  const { pw, ph, lm, contentW } = pdfPageLayout(doc);
  const MIN_ROW_H = 5.8;
  const LINE_H = 3.1;
  const ROW_PAD_TOP = 2;
  const ROW_GAP = 0.6;
  const NAVY = [15, 30, 60];
  const ACCENT = [0, 194, 168];
  const INDIGO = [42, 79, 168];
  const PANEL = [234, 238, 253];
  const STRIPE = [244, 246, 251];
  const RED = [197, 48, 48];
  const GREEN = [47, 133, 90];
  const BORDER = [180, 192, 214];

  const cols = scalePdfCols(
    [
      { label: 'Vr dt', w: 17 },
      { label: 'Val dt', w: 17 },
      { label: 'No', w: 11 },
      { label: 'Vr', w: 9 },
      { label: 'Ty', w: 8 },
      { label: 'Detail', w: 58 },
      { label: 'Dr', w: 22, right: true, debit: true },
      { label: 'Cr', w: 22, right: true, credit: true },
      { label: 'Balance', w: 24, right: true },
    ],
    contentW
  );
  const { xAt, tableW } = pdfColLayout(cols, lm);

  const fillBand = (y0, h, rgb) => {
    doc.setFillColor(...rgb);
    doc.rect(lm, y0, contentW, h, 'F');
  };

  const hline = (y0, color = BORDER) => {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.25);
    doc.line(lm, y0, lm + tableW, y0);
  };

  let y = 8;

  fillBand(y, 10, NAVY);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('LEDGER ACCOUNT', lm + contentW / 2, y + 6.5, { align: 'center' });
  y += 12;

  const panelH = 20;
  fillBand(y, panelH, PANEL);
  doc.setDrawColor(...INDIGO);
  doc.setLineWidth(0.35);
  doc.rect(lm, y, contentW, panelH, 'S');
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(String(metadata?.companyName || ''), lm + 2, y + 5, { maxWidth: tableW - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 106, 138);
  const addr = [metadata?.companyAdd1, metadata?.companyAdd2].filter(Boolean).join(', ');
  if (addr) doc.text(addr, lm + 2, y + 9, { maxWidth: tableW - 4 });
  if (metadata?.companyGst) doc.text(`GST: ${metadata.companyGst}`, lm + 2, y + 12.5, { maxWidth: tableW - 4 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY);
  const accLine = [metadata?.accountName, metadata?.accountCode ? `(${metadata.accountCode})` : '']
    .filter(Boolean)
    .join(' ');
  doc.text(accLine, lm + 2, y + 16.5, { maxWidth: tableW - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 106, 138);
  doc.text(`${metadata?.year || ''}   ${metadata?.endDate || ''}`, lm + 2, y + 19.5, { maxWidth: tableW - 4 });
  y += panelH + 2;

  let opening = 0;
  let sumDr = 0;
  let sumCr = 0;
  rows.forEach((row) => {
    const vr = String(row.VR_TYPE ?? row.vr_type ?? '').trim().toUpperCase();
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt) || 0;
    if (vr === 'OP') {
      opening = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal) || 0;
    } else {
      sumDr += dr;
      sumCr += cr;
    }
  });

  const boxW = (tableW - 8) / 3;
  const drawSummaryBox = (bx, label, val, borderRgb, valRgb) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...borderRgb);
    doc.setLineWidth(0.35);
    doc.rect(bx, y, boxW, 9, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(120, 130, 150);
    doc.text(label, bx + 2, y + 3.2);
    doc.setTextColor(...valRgb);
    doc.setFontSize(8.5);
    doc.text(formatAmtPdf(val), bx + 2, y + 7, { maxWidth: boxW - 4 });
  };
  drawSummaryBox(lm, 'OPENING', opening, INDIGO, INDIGO);
  drawSummaryBox(lm + boxW + 4, 'TOTAL CR', sumCr, RED, RED);
  drawSummaryBox(lm + (boxW + 4) * 2, 'TOTAL DR', sumDr, GREEN, GREEN);
  y += 11;

  const drawColHead = () => {
    const headH = 7;
    fillBand(y, headH, NAVY);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    cols.forEach((c, i) => {
      const tx = c.right ? xAt[i] + c.w - 1 : xAt[i] + 1;
      doc.text(c.label, tx, y + 4.6, { align: c.right ? 'right' : 'left', maxWidth: c.w - 2 });
    });
    y += headH + 0.5;
    hline(y);
    y += 0.8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...NAVY);
  };

  drawColHead();

  const pageBottom = ph - 12;
  let rowStripe = 0;

  const cellLines = (txt, col, fontSize, fontStyle) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', fontStyle);
    const raw = String(txt ?? '').trim();
    if (!raw) return ['—'];
    return doc.splitTextToSize(raw, Math.max(2, col.w - 2));
  };

  const measureRowHeight = (cells, fontSize, fontStyle) => {
    let maxLines = 1;
    cells.forEach((txt, i) => {
      const lines = cellLines(txt, cols[i], fontSize, fontStyle);
      maxLines = Math.max(maxLines, lines.length);
    });
    return Math.max(MIN_ROW_H, ROW_PAD_TOP + maxLines * LINE_H + 1.2);
  };

  const amountHasValue = (txt) => {
    const s = String(txt ?? '').trim();
    return s && s !== '—' && s !== '-';
  };

  const newPageIfNeeded = (neededH) => {
    if (y + neededH > pageBottom) {
      doc.addPage();
      y = 10;
      drawColHead();
      rowStripe = 0;
    }
  };

  const writeCells = (cells, style = 'normal') => {
    const isGrand = style === 'grand';
    const fontSize = isGrand ? 7.5 : 6.5;
    const fontStyle = style === 'normal' ? 'normal' : 'bold';
    const rowH = measureRowHeight(cells, fontSize, fontStyle);

    newPageIfNeeded(rowH + ROW_GAP);
    const rowTop = y;

    if (style === 'stripe') {
      fillBand(rowTop, rowH, rowStripe % 2 === 0 ? [255, 255, 255] : STRIPE);
      rowStripe += 1;
    } else if (isGrand) {
      fillBand(rowTop, rowH, NAVY);
    }

    cells.forEach((txt, i) => {
      const c = cols[i];
      const lines = cellLines(txt, c, fontSize, fontStyle);
      const tx = c.right ? xAt[i] + c.w - 1 : xAt[i] + 1;

      if (isGrand) doc.setTextColor(255, 255, 255);
      else if (c.credit && amountHasValue(txt)) doc.setTextColor(...RED);
      else if (c.debit && amountHasValue(txt)) doc.setTextColor(...GREEN);
      else doc.setTextColor(...NAVY);

      doc.setFont('helvetica', fontStyle);
      doc.setFontSize(fontSize);

      let lineY = rowTop + ROW_PAD_TOP + LINE_H - 0.5;
      lines.forEach((line) => {
        doc.text(line, tx, lineY, { align: c.right ? 'right' : 'left' });
        lineY += LINE_H;
      });
    });

    y = rowTop + rowH + ROW_GAP;
    if (isGrand) {
      hline(y, ACCENT);
      y += 0.5;
    }
  };

  let gDr = 0;
  let gCr = 0;

  rows.forEach((row) => {
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt) || 0;
    gDr += dr;
    gCr += cr;
    writeCells(
      [
        formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date),
        formatLedgerDateDisplay(row.V_DATE ?? row.v_date) || '—',
        String(row.VR_NO ?? row.vr_no ?? '—'),
        String(row.VR_TYPE ?? row.vr_type ?? ''),
        String(row.TYPE ?? row.type ?? '—'),
        String(row.DETAIL ?? row.detail ?? ''),
        formatAmtPdf(dr),
        formatAmtPdf(cr),
        formatAmtPdf(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal),
      ],
      'stripe'
    );
  });

  const last = rows[rows.length - 1];
  const closing = last
    ? parseFloat(last.CL_BALANCE ?? last.cl_balance ?? last.RUN_BAL ?? last.run_bal) || 0
    : 0;

  doc.setFont('helvetica', 'bold');
  writeCells(
    ['', '', '', '', '', 'GRAND TOTAL', formatAmtPdf(gDr), formatAmtPdf(gCr), formatAmtPdf(closing)],
    'grand'
  );

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 130, 150);
    doc.text(`Page ${p} of ${pageCount}`, pw - lm, ph - 5, { align: 'right' });
  }

  return doc.output('blob');
}

/** Production entry print PDF via jsPDF (reliable borders/colours on mobile). */
function buildProductionJsPdfBlob(data, metadata) {
  const header = data?.header || {};
  const lines = Array.isArray(data?.lines) ? data.lines : [];
  const doc = createJsPdfA4Portrait();
  const { pw, ph, lm, contentW } = pdfPageLayout(doc, 10);
  const NAVY = [30, 58, 95];
  const HEAD = [30, 41, 59];
  const LABEL = [203, 213, 225];
  const BORDER = [100, 116, 139];
  const STRIPE = [248, 250, 252];
  const TOTAL = [226, 232, 240];

  const fillRect = (x, y0, w, h, rgb) => {
    doc.setFillColor(...rgb);
    doc.rect(x, y0, w, h, 'F');
  };

  const strokeRect = (x, y0, w, h, rgb = BORDER, lw = 0.25) => {
    doc.setDrawColor(...rgb);
    doc.setLineWidth(lw);
    doc.rect(x, y0, w, h, 'S');
  };

  let y = 10;

  fillRect(lm, y, contentW, 14, [248, 250, 252]);
  strokeRect(lm, y, contentW, 14, NAVY, 0.5);
  doc.setTextColor(...NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(String(metadata?.companyName || ''), lm + contentW / 2, y + 5.5, { align: 'center', maxWidth: contentW - 4 });
  doc.setFontSize(10);
  doc.text('Production entry', lm + contentW / 2, y + 10.5, { align: 'center' });
  y += 16;

  const sDate = String(metadata?.sDate || toDisplayDateFromYmd(header.s_date) || '');
  const sNo = String(header.s_no ?? metadata?.sNo ?? '');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(`Date: ${sDate}     Sr.No.: ${sNo}`, lm + 2, y + 3);
  y += 6;

  const millCode = String(header.item || '').trim();
  const millName = String(header.item_name || header.mill_item_name || '').trim();
  const millItem = [millCode, millName].filter(Boolean).join(' — ');
  const mW = Number(header.milling) || 0;
  const mQ = Number(header.m_qnty) || 0;
  const mSt = String(header.m_status || '');
  const plant = String(header.plant_code || '');

  const metaRows = [
    ['Milling item', millItem || '—'],
    ['Milling weight', formatStockPdf(mW, 3)],
    ['Milling qty', formatStockPdf(mQ, 3)],
    ['B/K/H', mSt || '—'],
    ['Plant', plant || '—'],
  ];
  const lblW = contentW * 0.28;
  const valW = contentW - lblW;
  const metaRowH = 6.2;
  metaRows.forEach(([lbl, val], idx) => {
    fillRect(lm, y, lblW, metaRowH, LABEL);
    fillRect(lm + lblW, y, valW, metaRowH, [255, 255, 255]);
    strokeRect(lm, y, contentW, metaRowH, BORDER, 0.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text(lbl, lm + 2, y + 4.2, { maxWidth: lblW - 4 });
    doc.setFont('helvetica', 'normal');
    doc.text(String(val), lm + lblW + 2, y + 4.2, { maxWidth: valW - 4 });
    y += metaRowH;
    if (idx === 0) y += 0.5;
  });
  y += 4;

  const cols = scalePdfCols(
    [
      { label: 'Sno', w: 8, right: false },
      { label: 'Item code', w: 18, right: false },
      { label: 'Item name', w: 42, right: false },
      { label: 'Prod%', w: 14, right: true },
      { label: 'Qty', w: 14, right: true },
      { label: 'B/K/H', w: 10, right: false, center: true },
      { label: 'Weight', w: 18, right: true },
      { label: 'Short', w: 18, right: true },
    ],
    contentW
  );
  const { xAt, tableW } = pdfColLayout(cols, lm);
  const headH = 7;

  const drawLineHead = () => {
    fillRect(lm, y, tableW, headH, HEAD);
    strokeRect(lm, y, tableW, headH, HEAD, 0.2);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    cols.forEach((c, i) => {
      const tx = c.right ? xAt[i] + c.w - 1.5 : c.center ? xAt[i] + c.w / 2 : xAt[i] + 1.5;
      doc.text(c.label, tx, y + 4.8, { align: c.right ? 'right' : c.center ? 'center' : 'left', maxWidth: c.w - 2 });
    });
    y += headH;
  };

  drawLineHead();

  let tpQ = 0;
  let tpW = 0;
  let tpS = 0;
  const rowH = 6.5;
  const pageBottom = ph - 12;

  lines.forEach((L, i) => {
    const pq = Number(L.qnty) || 0;
    const pw = Number(L.weight) || 0;
    const ps = Number(L.short) || 0;
    tpQ += pq;
    tpW += pw;
    tpS += ps;
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = 10;
      drawLineHead();
    }
    const bg = i % 2 === 0 ? [255, 255, 255] : STRIPE;
    fillRect(lm, y, tableW, rowH, bg);
    strokeRect(lm, y, tableW, rowH, BORDER, 0.15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(15, 23, 42);
    const cells = [
      String(i + 1),
      String(L.item_code ?? ''),
      String(L.item_name ?? ''),
      formatStockPdf(Number(L.prod_per) || 0, 3),
      formatStockPdf(pq, 3),
      String(L.status ?? ''),
      formatStockPdf(pw, 3),
      formatStockPdf(ps, 3),
    ];
    cells.forEach((txt, ci) => {
      const c = cols[ci];
      const tx = c.right ? xAt[ci] + c.w - 1.5 : c.center ? xAt[ci] + c.w / 2 : xAt[ci] + 1.5;
      doc.text(String(txt), tx, y + 4.5, { align: c.right ? 'right' : c.center ? 'center' : 'left', maxWidth: c.w - 2 });
    });
    y += rowH;
  });

  if (!lines.length) {
    fillRect(lm, y, tableW, rowH, [255, 255, 255]);
    strokeRect(lm, y, tableW, rowH, BORDER, 0.15);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('(No lines)', lm + tableW / 2, y + 4.5, { align: 'center' });
    y += rowH;
  }

  const drawTotalRow = (label, qty, st, wgt, short, isFirst) => {
    if (y + rowH > pageBottom) {
      doc.addPage();
      y = 10;
      drawLineHead();
    }
    fillRect(lm, y, tableW, rowH, TOTAL);
    strokeRect(lm, y, tableW, rowH, NAVY, isFirst ? 0.4 : 0.2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(15, 23, 42);
    doc.text(label, xAt[0] + 1.5, y + 4.5, { maxWidth: xAt[3] - xAt[0] - 2 });
    if (qty) doc.text(qty, xAt[4] + cols[4].w - 1.5, y + 4.5, { align: 'right' });
    if (st) doc.text(st, xAt[5] + cols[5].w / 2, y + 4.5, { align: 'center' });
    if (wgt) doc.text(wgt, xAt[6] + cols[6].w - 1.5, y + 4.5, { align: 'right' });
    if (short) doc.text(short, xAt[7] + cols[7].w - 1.5, y + 4.5, { align: 'right' });
    y += rowH;
  };

  drawTotalRow('Milling total', formatStockPdf(mQ, 3), mSt, formatStockPdf(mW, 3), '', true);
  drawTotalRow('Production total', formatStockPdf(tpQ, 3), '', formatStockPdf(tpW, 3), formatStockPdf(tpS, 3), false);

  return doc.output('blob');
}

async function htmlDocumentToPdfBlob(documentHtml, options) {
  const landscape = options?.jsPDF?.orientation === 'landscape';
  const frameW = landscape ? 1280 : 794;
  const frameH = landscape ? 1100 : 1123;
  const mobileCapture = shouldPreferNativeFileShare();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', 'PDF render');
  iframe.style.cssText = [
    'position:fixed',
    mobileCapture ? 'left:0' : 'left:-12000px',
    'top:0',
    `width:${frameW}px`,
    `min-height:${frameH}px`,
    `height:${frameH}px`,
    'border:0',
    mobileCapture ? 'opacity:0.01' : 'opacity:0',
    'pointer-events:none',
    mobileCapture ? 'z-index:11999' : 'z-index:-9999',
  ].join(';');
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!idoc) {
    document.body.removeChild(iframe);
    throw new Error('Could not create print frame for PDF.');
  }
  idoc.open();
  idoc.write(documentHtml);
  idoc.close();
  await new Promise((resolve) => {
    const done = () => resolve();
    if (iframe.contentWindow?.document?.readyState === 'complete') done();
    else iframe.onload = done;
  });
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  try {
    const root =
      idoc.querySelector('.cash-receipt-sheet') ||
      idoc.querySelector('.voucher-doc') ||
      idoc.querySelector('.production-print-pdf-doc') ||
      idoc.querySelector('.report-doc') ||
      idoc.querySelector('.dc-pdf') ||
      idoc.body;
    const contentH = Math.min(Math.max((root?.scrollHeight || frameH) + 32, frameH), 14000);
    iframe.style.height = `${contentH}px`;
    if (mobileCapture) {
      await new Promise((r) => setTimeout(r, 400));
    }
    const blob = await html2pdf().set(options).from(root).outputPdf('blob');
    assertPdfBlob(blob);
    return blob;
  } finally {
    iframe.remove();
    removeStrayHtml2pdfNodes();
  }
}

export function buildReportHtml(reportType, data, metadata) {
  if (reportType === 'ledger') return buildLedgerReportHtml(data, metadata);
  if (reportType === 'trading-ledger') return buildTradingLedgerReportHtml(data, metadata);
  if (reportType === 'bill-ledger') return buildBillLedgerReportHtml(data, metadata);
  if (reportType === 'broker-os') return buildBrokerOsReportHtml(data, metadata);
  if (reportType === 'ageing') return buildAgeingReportHtml(data, metadata);
  if (reportType === 'sale-list') return buildSaleListReportHtml(data, metadata);
  if (reportType === 'sale-bill') return buildSaleBillReportHtml(data, metadata);
  if (reportType === 'stock-sum') return buildStockSumReportHtml(data, metadata);
  if (reportType === 'stock-sum-detail') return buildStockSumDetailReportHtml(data, metadata);
  if (reportType === 'stock-sum-ledger') return buildStockSumLedgerReportHtml(data, metadata);
  if (reportType === 'stock-sum-ledger-entry') return buildStockLedgerEntryDetailReportHtml(data, metadata);
  if (reportType === 'stock-lot') return buildStockLotReportHtml(data, metadata);
  if (reportType === 'purchase-list') return buildPurchaseListReportHtml(data, metadata);
  if (reportType === 'purchase-bill') return buildPurchaseBillReportHtml(data, metadata);
  if (reportType === 'gstr1') return buildGstr1ReportHtml(data, metadata);
  if (reportType === 'hsn-sales') return buildHsnSalesReportHtml(data, metadata);
  if (reportType === 'hsn-purchase') return buildHsnSalesReportHtml(data, metadata);
  if (reportType === 'state-wise-sales' || reportType === 'state-wise-purchase') return buildStateWiseSalesReportHtml(data, metadata);
  if (reportType === 'balance-sheet') return buildBalanceSheetReportHtml(data, metadata);
  if (reportType === 'trading-account') return buildTradingAccountReportHtml(data, metadata);
  if (reportType === 'profit-loss') return buildProfitLossReportHtml(data, metadata);
  if (reportType === 'production-list') return buildProductionListReportHtml(data, metadata);
  if (reportType === 'production-print') return buildProductionPrintReportHtml(data, metadata);
  if (reportType === 'dispatch-challan-list') return buildDispatchChallanListReportHtml(data, metadata);
  if (reportType === 'grn-list') return buildGrnListReportHtml(data, metadata);
  if (reportType === 'dispatch-challan-print') return buildDispatchChallanPrintReportHtml(data, metadata);
  if (reportType === 'grn-print') return buildGrnPrintReportHtml(data, metadata);
  if (reportType === 'sales-order-list') return buildSalesOrderListReportHtml(data, metadata);
  if (reportType === 'sales-order-print') return buildSalesOrderPrintReportHtml(data, metadata);
  if (reportType === 'purchase-order-list') {
    return buildSalesOrderListReportHtml(data, {
      ...metadata,
      listDocTitle: metadata?.listDocTitle || 'Purchase order list',
    });
  }
  if (reportType === 'purchase-order-print') {
    return buildSalesOrderPrintReportHtml(data, {
      ...metadata,
      orderDocTitle: metadata?.orderDocTitle || 'PURCHASE ORDER',
    });
  }
  if (reportType === 'voucher-list') return buildVoucherListReportHtml(data, metadata);
  if (reportType === 'voucher-print') return buildVoucherPrintReportHtml(data, metadata);
  if (reportType === 'trial-balance-summary') return buildTrialBalanceSummaryReportHtml(data, metadata);
  if (reportType === 'trial-date-wise') return buildTrialDateWiseReportHtml(data, metadata);
  if (reportType === 'trial-balance') return buildTrialBalanceReportHtml(data, metadata);
  return buildTrialBalanceReportHtml(data, metadata);
}

function getPdfOptions(metadata, reportType, data) {
  const rowCount = Array.isArray(data) ? data.length : 0;
  const cashReceiptPrint = reportType === 'voucher-print' && isCashReceiptVoucher(data?.header);
  const stamp = new Date().toISOString().split('T')[0];
  const inv = safeFilenamePart(metadata.invoiceNo || metadata.saleInvNo || '');
  const pbKey = safeFilenamePart(metadata.purchaseBillKey || '');
  const filename =
    reportType === 'sale-bill'
      ? `${safeFilenamePart(metadata.companyName)}_SaleBill_${inv || 'inv'}_${stamp}.pdf`
      : reportType === 'purchase-bill'
        ? `${safeFilenamePart(metadata.companyName)}_PurchaseBill_${pbKey || 'bill'}_${stamp}.pdf`
        : reportType === 'voucher-print'
          ? cashReceiptPrint
            ? `${safeFilenamePart(metadata.companyName)}_CashReceipt_${safeFilenamePart(data?.header?.vr_no || metadata.voucherKey || 'rcpt')}_${stamp}.pdf`
            : `${safeFilenamePart(metadata.companyName)}_Voucher_${safeFilenamePart(metadata.voucherKey || 'vr')}_${stamp}.pdf`
        : reportType === 'stock-sum-detail'
          ? `${safeFilenamePart(metadata.companyName)}_StockDetail_${safeFilenamePart(metadata.itemCode || 'item')}_${stamp}.pdf`
          : `${safeFilenamePart(metadata.companyName)}_${reportType}_${stamp}.pdf`;
  const html2canvas =
    reportType === 'purchase-list' || reportType === 'voucher-list'
      ? {
          scale: 1.75,
          useCORS: true,
          logging: false,
          windowWidth: 2000,
          scrollX: 0,
          scrollY: 0,
        }
      : reportType === 'hsn-sales'
        ? {
            scale: 1,
            useCORS: true,
            logging: false,
            windowWidth: 1800,
            scrollX: 0,
            scrollY: 0,
          }
        : reportType === 'state-wise-sales' || reportType === 'state-wise-purchase'
          ? {
              scale: 1,
              useCORS: true,
              logging: false,
              windowWidth: 1800,
              scrollX: 0,
              scrollY: 0,
            }
        : reportType === 'balance-sheet'
          ? {
              scale: 1.35,
              useCORS: true,
              logging: false,
              windowWidth: 2200,
              scrollX: 0,
              scrollY: 0,
            }
      : reportType === 'broker-os'
        ? {
            scale: rowCount > 550 ? 1.1 : rowCount > 350 ? 1.25 : rowCount > 180 ? 1.45 : rowCount > 90 ? 1.7 : 2,
            useCORS: true,
            logging: false,
          }
        : reportType === 'dispatch-challan-print' ||
            reportType === 'grn-print' ||
            reportType === 'production-print'
          ? {
              scale: 2,
              useCORS: true,
              logging: false,
              backgroundColor: '#ffffff',
              windowWidth: 794,
              width: 794,
              scrollX: 0,
              scrollY: 0,
            }
          : reportType === 'voucher-print'
            ? {
                scale: cashReceiptPrint ? 1.85 : 2,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                windowWidth: 794,
                width: 794,
                scrollX: 0,
                scrollY: 0,
              }
          : reportType === 'trial-balance' ||
              reportType === 'trial-balance-summary' ||
              reportType === 'trial-date-wise' ||
              reportType === 'ledger'
            ? {
                scale: shouldPreferNativeFileShare() ? 1 : 1.5,
                useCORS: true,
                logging: false,
                backgroundColor: '#ffffff',
                windowWidth: reportType === 'trial-date-wise' ? 1400 : 1200,
                scrollX: 0,
                scrollY: 0,
              }
            : { scale: 2, useCORS: true };

  const base = {
    margin:
      reportType === 'sale-bill' ||
      reportType === 'purchase-bill' ||
      reportType === 'dispatch-challan-print' ||
      reportType === 'grn-print' ||
      reportType === 'production-print' ||
      reportType === 'sales-order-print' ||
      reportType === 'purchase-order-print' ||
      reportType === 'voucher-print'
        ? cashReceiptPrint
          ? 5
          : 8
        : reportType === 'balance-sheet'
          ? 6
          : 10,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas,
    jsPDF: {
      orientation:
        reportType === 'trial-balance' ||
        reportType === 'trial-balance-summary' ||
        reportType === 'trial-date-wise' ||
        reportType === 'ledger' ||
        reportType === 'sale-bill' ||
        reportType === 'purchase-bill' ||
        reportType === 'dispatch-challan-print' ||
        reportType === 'production-print' ||
        reportType === 'sales-order-print' ||
        reportType === 'purchase-order-print' ||
        reportType === 'voucher-print'
          ? 'portrait'
          : 'landscape',
      unit: 'mm',
      format: 'a4',
    },
  };

  if (reportType === 'dispatch-challan-print' || reportType === 'grn-print' || reportType === 'sales-order-print' || reportType === 'purchase-order-print') {
    base.pagebreak = {
      mode: ['css', 'legacy'],
      before: '.dc-pdf-page--new',
      avoid: ['.dc-pdf-page', '.dc-pdf-page-header'],
    };
  }

  if (reportType === 'voucher-print') {
    base.pagebreak = { mode: ['avoid-all', 'css', 'legacy'] };
  }

  if (
    reportType === 'trial-balance' ||
    reportType === 'trial-balance-summary' ||
    reportType === 'trial-date-wise' ||
    reportType === 'ledger'
  ) {
    base.pagebreak = { mode: ['css', 'legacy'] };
  }

  return base;
}

/**
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
export async function getPdfBlob(reportType, data, metadata) {
  return withPdfGenerationGuard(async () => {
    const options = getPdfOptions(metadata, reportType, data);
    if (reportType === 'trial-balance') {
      try {
        const blob = buildTrialBalanceJsPdfBlob(data, metadata);
        assertPdfBlob(blob);
        return { blob, filename: options.filename };
      } catch (err) {
        // Safety fallback for mobile runtime issues in jsPDF path.
        const htmlContent = buildReportHtml(reportType, data, metadata);
        const docHtml = wrapReportHtmlForPdf(htmlContent);
        const blob = await htmlDocumentToPdfBlob(docHtml, options);
        return { blob, filename: options.filename };
      }
    }
    if (reportType === 'ledger') {
      const blob = buildLedgerJsPdfBlob(data, metadata);
      assertPdfBlob(blob);
      return { blob, filename: options.filename };
    }
    if (reportType === 'voucher-print') {
      const docHtml = buildVoucherPrintDocumentHtml(data, metadata);
      const blob = await htmlDocumentToPdfBlob(docHtml, options);
      return { blob, filename: options.filename };
    }
    if (reportType === 'production-print') {
      try {
        const blob = buildProductionJsPdfBlob(data, metadata);
        assertPdfBlob(blob);
        return { blob, filename: options.filename };
      } catch (err) {
        const docHtml = buildProductionPrintDocumentHtml(data, metadata);
        const blob = await htmlDocumentToPdfBlob(docHtml, options);
        return { blob, filename: options.filename };
      }
    }
    const htmlContent = buildReportHtml(reportType, data, metadata);
    const docHtml = wrapReportHtmlForPdf(htmlContent);
    const blob = await htmlDocumentToPdfBlob(docHtml, options);
    return { blob, filename: options.filename };
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openBlobInNewTab(blob) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) return;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Digits-only number for https://wa.me/… (no +). If `raw` is a 10-digit Indian mobile (6–9),
 * prefixes `countryCode` (default 91). Override with metadata.shareWhatsAppCountryCode.
 */
function normalizeWhatsAppPhoneDigits(raw, countryCode = '91') {
  if (raw == null || raw === '') return '';
  let d = String(raw).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  const cc = String(countryCode || '91').replace(/\D/g, '') || '91';
  if (d.length >= 11 && d.startsWith(cc)) return d;
  if (d.length === 10 && /^[6-9]/.test(d)) return cc + d;
  if (d.length >= 10) return d;
  return '';
}

function pickWhatsAppDigitsFromMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return '';
  const cc = metadata.shareWhatsAppCountryCode ?? '91';
  const explicit = normalizeWhatsAppPhoneDigits(
    metadata.shareWhatsAppPhone ?? metadata.whatsappPhone ?? '',
    cc
  );
  if (explicit.length >= 10) return explicit;
  for (const key of ['partyTel', 'accountTel', 'customerTel', 'brokerTel', 'dispatchTel']) {
    const n = normalizeWhatsAppPhoneDigits(metadata[key], cc);
    if (n.length >= 10) return n;
  }
  return '';
}

/** wa.me URLs have practical length limits; shrink message if needed. */
function buildWhatsAppWebUrl(phoneDigits, messageBody, maxUrlLength = 2000) {
  const base = phoneDigits ? `https://wa.me/${phoneDigits}?text=` : 'https://wa.me/?text=';
  let msg = String(messageBody ?? '');
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = base + encodeURIComponent(msg);
    if (url.length <= maxUrlLength) return url;
    msg =
      msg.slice(0, Math.max(180, Math.floor(msg.length * 0.72))) +
      '\n… (see PDF in Downloads — attach with paperclip.)';
  }
  return base + encodeURIComponent(String(messageBody ?? '').slice(0, 160));
}

function shouldPreferNativeFileShare() {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '').toLowerCase();
  const mobileUa = /android|iphone|ipad|ipod|windows phone|mobile/i.test(ua);
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const likelyMobile = mobileUa || touchPoints > 1;
  return likelyMobile;
}

/** Download PDF (browser save dialog). */
export const generatePDF = async (reportType, data, metadata) => {
  const { blob, filename } = await getPdfBlob(reportType, data, metadata);
  if (metadata?.autoOpen) openBlobInNewTab(blob);
  downloadBlob(blob, filename);
};

/**
 * WhatsApp + PDF:
 * - On mobile-like devices with Web Share support, shares the PDF file so WhatsApp can receive
 *   the attachment (user picks WhatsApp, then the contact). A wa.me link is included in the message
 *   text when we have partyTel / accountTel so the right chat is one tap away.
 * - On desktop, skips the OS share sheet (often no WhatsApp target), downloads the PDF, and opens
 *   wa.me (with phone when known).
 * - If mobile sharing is not available or fails: downloads the PDF and opens wa.me (with phone when known)
 *   and explains attaching from Downloads / Files (URLs cannot attach files by themselves).
 */
/**
 * @param {object} [options]
 * @param {string} [options.phoneDigits] — override metadata phone (e.g. broker vs customer)
 * @param {boolean} [options.skipPdfDownload] — wa.me only; PDF already saved (e.g. second of two chats)
 */
export async function sharePdfWithWhatsApp(reportType, data, metadata, shareText, options = {}) {
  let blob;
  let filename;
  try {
    ({ blob, filename } = await getPdfBlob(reportType, data, metadata));
  } catch (err) {
    // Final fallback for mobile runtime errors: produce HTML PDF so share flow still works.
    const fallbackOptions = getPdfOptions(metadata, reportType, data);
    const htmlContent = buildReportHtml(reportType, data, metadata);
    const docHtml = wrapReportHtmlForPdf(htmlContent);
    blob = await htmlDocumentToPdfBlob(docHtml, fallbackOptions);
    filename = fallbackOptions.filename;
  }
  const file = new File([blob], filename, { type: 'application/pdf', lastModified: Date.now() });
  const reportLabel =
    reportType === 'trial-balance'
      ? 'Trial Balance'
      : reportType === 'trading-account'
        ? 'Trading A/C'
        : reportType === 'profit-loss'
          ? 'Profit & Loss Account'
          : reportType === 'balance-sheet'
            ? 'Balance Sheet'
      : reportType === 'bill-ledger'
        ? metadata?.billLedgerTitle || 'CustomerLedger'
        : reportType === 'broker-os'
          ? 'Broker outstanding'
          : reportType === 'sale-list'
            ? 'Sale list'
            : reportType === 'sale-bill'
              ? 'Sale bill'
              : reportType === 'purchase-bill'
                ? 'Purchase bill'
                : reportType === 'stock-sum'
                  ? 'Stock sum'
                  : reportType === 'stock-sum-detail'
                    ? 'Stock detail'
                    : reportType === 'stock-lot'
                      ? 'Stock lot'
                      : reportType === 'purchase-list'
                        ? 'Purchase list'
                        : reportType === 'gstr1'
                          ? 'GSTR-1'
                          : reportType === 'hsn-sales'
                            ? 'HSN Sales'
                            : reportType === 'state-wise-sales'
                              ? 'State Wise Sales'
                              : reportType === 'state-wise-purchase'
                                ? 'State Wise Purchase'
                            : reportType === 'production-list'
                              ? 'Production list'
                              : reportType === 'production-print'
                                ? 'Production entry'
                                : reportType === 'dispatch-challan-list'
                                  ? 'Dispatch challan list'
                                  : reportType === 'dispatch-challan-print'
                                    ? 'Dispatch challan'
                        : 'Ledger';
  const text =
    shareText || `${metadata.companyName}\n${reportLabel}\n${metadata.endDate || ''}`;

  const cc = metadata?.shareWhatsAppCountryCode ?? '91';
  const overridePhone =
    options?.phoneDigits != null && String(options.phoneDigits).trim() !== ''
      ? normalizeWhatsAppPhoneDigits(options.phoneDigits, cc)
      : '';
  const waDigits = overridePhone.length >= 10 ? overridePhone : pickWhatsAppDigitsFromMetadata(metadata);
  const hasTargetPhone = waDigits.length >= 10;
  const skipPdfDownload = !!options?.skipPdfDownload;
  const preferDirectNumber = !!metadata?.preferWhatsAppDirectToNumber;
  const phoneHint = hasTargetPhone
    ? `Send to +${waDigits}\nOpen chat: https://wa.me/${waDigits}\n\n`
    : '';

  const attachHintLong = hasTargetPhone
    ? `\n\nPDF: ${filename}\nTap Attach (paperclip) and pick this PDF from Downloads/Files, then send.`
    : `\n\nPDF: ${filename}\nIn WhatsApp, tap Attach (paperclip) and select this file from Downloads or Files.`;
  const attachHintShort = `\n\n📎 ${filename}\nAttach via paperclip in WhatsApp.`;
  const preferShortHint = String(text ?? '').length > 700;
  const attachHint = preferShortHint ? attachHintShort : attachHintLong;
  const body = text + attachHint;

  /**
   * Direct-number mode: open target chat via wa.me so WhatsApp does not ask for contact selection first.
   * Attachment still cannot be auto-inserted by URL; save PDF locally and user attaches in that chat.
   */
  if (hasTargetPhone && preferDirectNumber) {
    if (!skipPdfDownload) downloadBlob(blob, filename);
    const url = buildWhatsAppWebUrl(waDigits, body);
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  let canShareFiles = false;
  try {
    canShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
  } catch {
    canShareFiles = false;
  }

  if (canShareFiles && shouldPreferNativeFileShare()) {
    try {
      await navigator.share({
        files: [file],
        title: text.split('\n')[0],
        text: phoneHint + text,
      });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  if (shouldPreferNativeFileShare()) {
    if (!skipPdfDownload) downloadBlob(blob, filename);
    alert(
      `${reportLabel} PDF saved as ${filename}.\n\nOpen WhatsApp, tap Attach (paperclip), and choose this file from Downloads or Files.`
    );
    return;
  }

  if (!skipPdfDownload) downloadBlob(blob, filename);
  const url = buildWhatsAppWebUrl(hasTargetPhone ? waDigits : '', body);
  window.open(url, '_blank', 'noopener,noreferrer');
}
