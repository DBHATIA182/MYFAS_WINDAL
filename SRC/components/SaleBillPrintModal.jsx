import React, { useEffect, useState, useMemo, useCallback } from 'react';
import axios from 'axios';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { rupeesToWords } from '../utils/rupeesInWords';
import { signedQrCodeToDataUrl, dataUrlToObjectUrl } from '../utils/qrDataUrl';
import { buildReportHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelWorkbook } from '../utils/excelExport';
import { rowFieldCI, rowFieldAny } from '../utils/rowFieldCI';

function signedQrRaw(row) {
  if (!row) return null;
  const preferKeys = [
    'SIGNED_QR_CODE',
    'signed_Qr_code',
    'signed_qr_code',
    'Signed_Qr_Code',
    'SIGNED_QR_code',
  ];
  for (const k of preferKeys) {
    const v = row[k];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) return v;
    if (typeof v === 'string' && v.trim()) return v;
  }
  const ci = rowFieldCI(row, 'signed_qr_code');
  if (ci) return ci;
  for (const k of Object.keys(row)) {
    const kl = k.toLowerCase();
    if (kl.includes('hsn')) continue;
    if (
      (kl.includes('signed') && kl.includes('qr')) ||
      (kl.includes('einvoice') && kl.includes('qr')) ||
      (kl.includes('qr') && (kl.includes('code') || kl.includes('image') || kl.includes('sign')))
    ) {
      const val = row[k];
      if (val == null || val === '') continue;
      if (typeof val === 'object' && val.type === 'Buffer' && Array.isArray(val.data)) return val;
      if (String(val).trim() !== '') return val;
    }
  }
  return null;
}

function v(row, upper, lower) {
  if (!row) return '';
  const x = row[upper] ?? row[lower];
  return x != null && x !== '' ? String(x) : '';
}

function n(row, upper, lower) {
  const x = row?.[upper] ?? row?.[lower];
  if (x == null || x === '') return 0;
  const p = parseFloat(x);
  return Number.isNaN(p) ? 0 : p;
}

function fmtAmt(val) {
  const x = parseFloat(val) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(val) {
  const x = parseFloat(val);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function printImageSrc(raw, apiBase = '') {
  if (raw == null || raw === '') return '';
  if (typeof raw === 'object' && raw.type === 'Buffer' && Array.isArray(raw.data)) {
    raw = btoa(String.fromCharCode(...raw.data));
  }
  const s = String(raw).trim();
  if (!s) return '';
  if (/^data:image\//i.test(s) || /^https?:\/\//i.test(s) || /^blob:/i.test(s)) return s;
  if (/^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 24) {
    const compact = s.replace(/\s+/g, '');
    return `data:image/png;base64,${compact}`;
  }
  if (/[./\\]/.test(s) || /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(s)) {
    return `${apiBase || ''}/api/print-image?path=${encodeURIComponent(s)}`;
  }
  return '';
}

function cleanPrintText(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  return s;
}

export default function SaleBillPrintModal({ open, onClose, apiBase, compCode, compUid, billParams, companyName = '' }) {
  const [header, setHeader] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [mobilePdfPreview, setMobilePdfPreview] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setMobilePdfPreview(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!open || !billParams) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, billParams, onClose]);

  useEffect(() => {
    if (!open || !billParams || !compCode || !compUid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      setHeader(null);
      setLines([]);
      try {
        const [hRes, lRes] = await Promise.all([
          axios.get(`${apiBase}/api/compdet-print-header`, {
            params: { comp_code: compCode, comp_uid: compUid },
            withCredentials: true,
            timeout: 120000,
          }),
          axios.get(`${apiBase}/api/sale-bill-print`, {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              type: billParams.type,
              bill_no: billParams.billNo,
              b_type: billParams.bType,
              bill_date: billParams.oracleDt,
            },
            withCredentials: true,
            timeout: 120000,
          }),
        ]);
        if (cancelled) return;
        setHeader(hRes.data || null);
        setLines(Array.isArray(lRes.data) ? lRes.data : []);
      } catch (e) {
        if (!cancelled) {
          setErr(e.response?.data?.error || e.message || 'Failed to load bill');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, billParams, apiBase, compCode, compUid]);

  const first = lines[0];
  const totals = useMemo(() => {
    let sumAmt = 0;
    let sumTax = 0;
    let sumC = 0;
    let sumS = 0;
    let sumI = 0;
    for (const r of lines) {
      sumAmt += n(r, 'AMOUNT', 'amount');
      sumTax += n(r, 'TAXABLE', 'taxable');
      sumC += n(r, 'CGST_AMT', 'cgst_amt');
      sumS += n(r, 'SGST_AMT', 'sgst_amt');
      sumI += n(r, 'IGST_AMT', 'igst_amt');
    }
    const freight = first ? n(first, 'FREIGHT', 'freight') : 0;
    const billAmt = first ? n(first, 'BILL_AMT', 'bill_amt') : 0;
    const expenseItems = first
      ? [
          {
            label: rowFieldCI(first, 'oth_exp_name1') || 'Other expense 1',
            amount: n(first, 'OTH_EXP1', 'oth_exp1'),
          },
          {
            label: rowFieldCI(first, 'oth_exp_name2') || 'Other expense 2',
            amount: n(first, 'OTH_EXP2', 'oth_exp2'),
          },
          {
            label: rowFieldCI(first, 'oth_exp_name3') || 'Other expense 3',
            amount: n(first, 'OTH_EXP3', 'oth_exp3'),
          },
          {
            label: rowFieldCI(first, 'oth_exp_name4') || 'Other expense 4',
            amount: n(first, 'OTH_EXP4', 'oth_exp4'),
          },
        ].filter((item) => Math.abs(item.amount) > 0.0001)
      : [];
    let disAmt = 0;
    let othExp5 = 0;
    for (const r of lines) {
      disAmt += n(r, 'DIS_AMT', 'dis_amt');
      othExp5 += n(r, 'OTH_EXP5', 'oth_exp5');
    }
    return { sumAmt, sumTax, sumC, sumS, sumI, freight, billAmt, disAmt, othExp5, expenseItems };
  }, [lines, first]);

  const saleTypeFromBillParams = useMemo(() => {
    if (!billParams?.type) return '';
    return String(billParams.type).trim().toUpperCase();
  }, [billParams]);

  const saleTypeFromFirstLine = useMemo(() => {
    if (!first) return '';
    const t = rowFieldCI(first, 'type');
    if (t) return String(t).trim().toUpperCase();
    const raw = first.TYPE ?? first.type;
    return raw != null && String(raw).trim() !== '' ? String(raw).trim().toUpperCase() : '';
  }, [first]);

  const isCreditNoteSale = saleTypeFromBillParams === 'CN' || saleTypeFromFirstLine === 'CN';

  const docTitle = useMemo(() => {
    if (isCreditNoteSale) return 'CREDIT NOTE';
    if (totals.sumC + totals.sumS + totals.sumI === 0) return 'BILL OF SUPPLY';
    return 'TAX INVOICE';
  }, [isCreditNoteSale, totals]);

  const isBillOfSupplyNoTax = useMemo(() => {
    const taxTotal = Math.abs(totals.sumC) + Math.abs(totals.sumS) + Math.abs(totals.sumI);
    if (taxTotal >= 0.0001) return false;
    return docTitle === 'BILL OF SUPPLY' || docTitle === 'CREDIT NOTE';
  }, [docTitle, totals]);

  /** Discount column in line grid only when bill has tax (CGST+SGST+IGST ≠ 0); if tax is zero, discount appears in summary only. */
  const showDiscountColumn = !isBillOfSupplyNoTax;
  const printGWeightFromAsk = String(billParams?.printGrossDane || '').trim().toUpperCase();
  const printPackingFromAsk = String(billParams?.printPacking || '').trim().toUpperCase();
  const printGWeightDefault =
    String(rowFieldCI(first || {}, 'print_g_weight') || rowFieldCI(first || {}, 'g_weight') || '')
      .trim()
      .toUpperCase() === 'Y';
  const printGWeight = printGWeightFromAsk === 'Y' ? true : printGWeightFromAsk === 'N' ? false : printGWeightDefault;
  const printPackingDefault = String(rowFieldCI(first || {}, 'print_packing') || '').trim().toUpperCase() === 'Y';
  const printPacking =
    printPackingFromAsk === 'Y' ? true : printPackingFromAsk === 'N' ? false : printPackingDefault || printGWeight;
  const gWgtKq = String(rowFieldCI(first || {}, 'wgt_k_q') || 'K').trim().toUpperCase() || 'K';
  const gWeightHeader = String(
    rowFieldCI(first || {}, 'g_weight_header') || (gWgtKq === 'K' ? 'In Kg.' : 'In Qtl.')
  ).trim();
  const dWeightHeader = String(rowFieldCI(first || {}, 'd_weight_header') || gWeightHeader).trim();
  const rateHeader = String(rowFieldCI(first || {}, 'g_rate_header') || 'In Qtl.').trim();

  const amountInWords = useMemo(() => rupeesToWords(totals.billAmt || totals.sumAmt), [totals]);

  const qrSourceRow = useMemo(() => {
    if (!lines.length) return null;
    const hit = lines.find((r) => signedQrRaw(r));
    return hit ?? lines[0];
  }, [lines]);

  const qrDataUrl = useMemo(() => signedQrCodeToDataUrl(signedQrRaw(qrSourceRow)), [qrSourceRow]);

  const [qrObjectUrl, setQrObjectUrl] = useState(null);
  useEffect(() => {
    let created = null;
    if (qrDataUrl && typeof qrDataUrl === 'string' && qrDataUrl.startsWith('data:image/')) {
      created = dataUrlToObjectUrl(qrDataUrl);
      if (created) setQrObjectUrl(created);
      else setQrObjectUrl(null);
    } else {
      setQrObjectUrl(null);
    }
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [qrDataUrl]);

  const qrImgSrc = qrObjectUrl || qrDataUrl;

  const pdfData = useMemo(() => {
    if (!lines.length || !first) return null;
    return {
      lines,
      header,
      first,
      docTitle,
      totals,
      qrDataUrl,
    };
  }, [lines, header, first, docTitle, totals, qrDataUrl]);

  const compDisplayName = useMemo(() => {
    const fromDet = rowFieldCI(header || {}, 'comp_name');
    const fromForm = String(companyName || '').trim();
    return (fromDet || fromForm || 'Company').trim();
  }, [header, companyName]);

  const compNameFontRem = useMemo(() => {
    const nameLen = String(compDisplayName || '').length;
    const base = isBillOfSupplyNoTax ? 2.1 : 1.9;
    if (nameLen <= 22) return base;
    const reduced = base - (nameLen - 22) * 0.035;
    return Math.max(1.05, Math.round(reduced * 100) / 100);
  }, [compDisplayName, isBillOfSupplyNoTax]);

  const pdfMeta = useMemo(
    () => ({
      companyName: compDisplayName,
      apiBase,
      printGrossDane: billParams?.printGrossDane,
      printPacking: billParams?.printPacking,
      invoiceNo: first
        ? isCreditNoteSale
          ? rowFieldCI(first, 'bill_no') || rowFieldCI(first, 'sale_inv_no') || 'bill'
          : rowFieldCI(first, 'sale_inv_no') || rowFieldCI(first, 'bill_no') || 'bill'
        : 'bill',
    }),
    [apiBase, billParams?.printGrossDane, billParams?.printPacking, compDisplayName, first, isCreditNoteSale]
  );

  const handleDownloadPdf = useCallback(() => {
    if (!pdfData) return;
    generatePDF('sale-bill', pdfData, pdfMeta).catch((e) => alert(String(e?.message || e)));
  }, [pdfData, pdfMeta]);

  const handleDownloadExcel = useCallback(() => {
    if (!lines.length) return;
    try {
      const sheets = [{ name: 'Lines', data: lines }];
      if (header && typeof header === 'object' && Object.keys(header).length) {
        sheets.unshift({ name: 'Company', data: [header] });
      }
      downloadExcelWorkbook(sheets, `${compDisplayName}_SaleBill`);
    } catch (e) {
      alert(String(e?.message || e));
    }
  }, [lines, header, compDisplayName]);

  const handleShareWhatsApp = useCallback(() => {
    if (!pdfData) return;
    const refNo = first
      ? isCreditNoteSale
        ? rowFieldCI(first, 'bill_no') || '—'
        : rowFieldCI(first, 'sale_inv_no') || '—'
      : '—';
    const head = isCreditNoteSale ? 'Credit note — ' : 'Sale bill — ';
    const shareText = [head + refNo, compDisplayName, formatLedgerDateDisplay(first?.BILL_DATE ?? first?.bill_date)].join('\n');
    sharePdfWithWhatsApp('sale-bill', pdfData, pdfMeta, shareText).catch((e) => alert(String(e?.message || e)));
  }, [pdfData, pdfMeta, first, compDisplayName, isCreditNoteSale]);

  const mobilePreviewHtml = useMemo(() => {
    if (!mobilePdfPreview || !pdfData) return '';
    const body = buildReportHtml('sale-bill', pdfData, pdfMeta);
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
      .report-doc { box-sizing: border-box; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
  }, [mobilePdfPreview, pdfData, pdfMeta]);

  if (!open || !billParams) return null;

  const h = header || {};
  const compAdd1 = rowFieldAny(h, ['comp_add1', 'compadd1', 'address1']);
  const compAdd2 = rowFieldAny(h, ['comp_add2', 'compadd2', 'address2']);
  const compAdd3 = rowFieldAny(h, ['comp_add3', 'compadd3', 'address3']);
  const tel1 = rowFieldAny(h, ['comp_tel1', 'comptel1', 'tel1', 'phone1']);
  const tel2 = rowFieldAny(h, ['comp_tel2', 'comptel2', 'tel2', 'phone2']);
  const gstNo = rowFieldAny(h, ['gst_no', 'gstno', 'comp_gst', 'gstin']);
  const compPan = rowFieldAny(h, ['comp_pan', 'pan', 'company_pan']);
  const iecNo = cleanPrintText(rowFieldAny(h, ['comp_tin', 'iec_no']));
  const compFssaiNo = cleanPrintText(rowFieldAny(h, ['fssai_no']));
  const compLlpin = cleanPrintText(rowFieldAny(h, ['llpin']));
  const compCin = cleanPrintText(rowFieldAny(h, ['cin_no']));
  const compUdyam = cleanPrintText(rowFieldAny(h, ['udyam_reg_no']));
  const email = rowFieldCI(h, 'email');
  const website = cleanPrintText(rowFieldAny(h, ['website', 'web_site', 'comp_website', 'site', 'url']));
  const headingLines = [];
  if (compAdd1) headingLines.push(compAdd1);
  if (compAdd2) headingLines.push(compAdd2);
  if (compAdd3) headingLines.push(compAdd3);
  const phoneLine = [tel1, tel2].filter(Boolean).join(' ');
  if (phoneLine) headingLines.push(`Tel: ${phoneLine}`);
  const gstPanLine = [
    gstNo ? `GST No: ${gstNo}` : '',
    compPan ? `PAN: ${compPan}` : '',
  ]
    .filter(Boolean)
    .join('    |    ');
  if (gstPanLine) headingLines.push(gstPanLine);
  const iecFssaiLine = [
    iecNo ? `IEC No.: ${iecNo}` : '',
    compFssaiNo ? `FSSAI No.: ${compFssaiNo}` : '',
  ]
    .filter(Boolean)
    .join('    |    ');
  if (iecFssaiLine) headingLines.push(iecFssaiLine);
  if (compLlpin) headingLines.push(`LLPIN: ${compLlpin}`);
  const cinUdyamLine = [
    compCin ? `CIN: ${compCin}` : '',
    compUdyam ? `UDAYM: ${compUdyam}` : '',
  ]
    .filter(Boolean)
    .join('    |    ');
  if (cinUdyamLine) headingLines.push(cinUdyamLine);
  const tailHeadingLines = [];
  if (email) tailHeadingLines.push(`Email: ${email}`);
  if (website) tailHeadingLines.push(`Website: ${website}`);
  const maxHeadingLines = 6;
  const keepFromMain = Math.max(0, maxHeadingLines - tailHeadingLines.length);
  const mainHeadingLines = [...headingLines.slice(0, keepFromMain), ...tailHeadingLines].slice(0, maxHeadingLines);
  const bankAcNo = rowFieldAny(h, ['bank_ac_no', 'BANK_AC_NO']);
  const bankAcNo1 = rowFieldAny(h, ['bank_ac_no1', 'BANK_AC_NO1']);
  const truckNo = first ? v(first, 'TRUCK_NO', 'truck_no') : '';
  const tpt = first ? v(first, 'TPT', 'tpt') : '';
  const grNo = first ? v(first, 'GR_NO', 'gr_no') : '';
  const saleLogoSrc = printImageSrc(
    rowFieldCI(first || {}, 'sale_logo') || rowFieldCI(header || {}, 'sale_logo'),
    apiBase
  );
  const saleLogo2Src = printImageSrc(
    rowFieldCI(first || {}, 'sale_logo2') || rowFieldCI(header || {}, 'sale_logo2'),
    apiBase
  );
  const signatureImgSrc = printImageSrc(
    rowFieldCI(first || {}, 'signature_file') || rowFieldCI(header || {}, 'signature_file'),
    apiBase
  );
  const godPrintInSale = first ? String(rowFieldCI(first, 'god_print_in_sale') || '').trim().toUpperCase() : '';
  const dispatchAdd1 = first ? rowFieldCI(first, 'god_add1') : '';
  const dispatchAdd2 = first ? rowFieldCI(first, 'god_add2') : '';
  const dispatchTel1 = first ? rowFieldCI(first, 'god_tel_no_1') : '';
  const dispatchTel2 = first ? rowFieldCI(first, 'god_tel_no_2') : '';
  const dispatchFssai = first ? rowFieldCI(first, 'god_fssai_no') : '';
  const dispatchGst = first ? rowFieldCI(first, 'god_gst_no') : '';
  const terms = first
    ? ['cond1', 'cond2', 'cond3', 'cond4', 'cond5', 'cond6', 'cond7'].map((k) => rowFieldCI(first, k)).filter(Boolean)
    : [];
  const showDispatchBlock =
    godPrintInSale === 'Y' && !!(dispatchAdd1 || dispatchAdd2 || dispatchTel1 || dispatchTel2 || dispatchFssai || dispatchGst);
  const formatTaxLabel = (name, perRaw) => {
    const per = Number(perRaw);
    if (!Number.isFinite(per) || Math.abs(per) < 0.0001) return name;
    const clean = Number.isInteger(per) ? String(per) : per.toFixed(2).replace(/\.?0+$/, '');
    return `${name} (${clean}%)`;
  };
  const cgstLabel = formatTaxLabel('CGST', first?.CGST_PER ?? first?.cgst_per);
  const sgstLabel = formatTaxLabel('SGST', first?.SGST_PER ?? first?.sgst_per);
  const igstLabel = formatTaxLabel('IGST', first?.IGST_PER ?? first?.igst_per);

  return (
    <div className="sale-bill-modal-backdrop sale-bill-print-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sale-bill-modal sale-bill-print-modal"
        role="dialog"
        aria-labelledby="sale-bill-print-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sale-bill-modal-head no-print">
          <h3 id="sale-bill-print-title">{billParams.label || 'Sale bill'}</h3>
          <div className="sale-bill-print-actions">
            <button
              type="button"
              className="btn btn-export"
              disabled={!pdfData}
              onClick={handleDownloadPdf}
            >
              Pdf
            </button>
            <button type="button" className="btn btn-excel" disabled={!lines.length} onClick={handleDownloadExcel}>
              📊 Excel
            </button>
            <button
              type="button"
              className="btn btn-whatsapp"
              disabled={!pdfData}
              onClick={handleShareWhatsApp}
            >
              💬 WhatsApp
            </button>
            <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        <div className="sale-bill-modal-body sale-bill-print-body">
          {loading ? <p className="sale-bill-modal-loading">Loading bill…</p> : null}
          {err ? (
            <p className="form-api-error" role="alert">
              {err}
            </p>
          ) : null}
          {!loading && !err && lines.length === 0 ? <p>No lines returned for this bill.</p> : null}

          {!loading && !err && lines.length > 0 ? (
            mobilePdfPreview ? (
              <iframe
                title="Sale bill mobile preview"
                className="sale-bill-mobile-pdf-preview"
                srcDoc={mobilePreviewHtml}
              />
            ) : (
            <div
              id="sale-bill-print-area"
              className={`sale-bill-print-doc${isBillOfSupplyNoTax ? ' sale-bill-print-doc--bill-of-supply' : ''}`}
            >
              <div className="sale-bill-print-doc-banner">
                <div className={`sale-bill-print-logo${saleLogoSrc ? '' : ' sale-bill-print-logo--empty'}`}>
                  {saleLogoSrc ? <img src={saleLogoSrc} alt="Sale logo" /> : null}
                </div>
                <div className="sale-bill-print-banner-text">
                  <div className="sale-bill-print-doc-title">{docTitle}</div>
                  <div className="sale-bill-print-company">
                    {compDisplayName ? (
                      <div className="sale-bill-print-comp-name" style={{ fontSize: `${compNameFontRem}rem` }}>
                        {compDisplayName}
                      </div>
                    ) : null}
                    {mainHeadingLines.map((line, idx) => (
                      <div key={idx}>{line}</div>
                    ))}
                  </div>
                </div>
                <div className={`sale-bill-print-right-top${saleLogo2Src ? '' : ' sale-bill-print-right-top--empty'}`}>
                  {saleLogo2Src ? (
                    <div className="sale-bill-print-logo2 sale-bill-print-logo2--top">
                      <img src={saleLogo2Src} alt="Sale logo 2" />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className={isCreditNoteSale ? 'sale-bill-print-inv-cn' : undefined}>
                <div className="sale-bill-print-inv-row">
                  {isCreditNoteSale ? (
                    <>
                      <span>
                        <strong>Credit Note no.</strong> {rowFieldCI(first, 'bill_no') || '—'}
                      </span>
                      <span>
                        <strong>Dated</strong> {formatLedgerDateDisplay(first.BILL_DATE ?? first.bill_date)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>
                        <strong>Invoice no.</strong> {rowFieldCI(first, 'sale_inv_no') || '—'}
                      </span>
                      <span>
                        <strong>Dated</strong> {formatLedgerDateDisplay(first.BILL_DATE ?? first.bill_date)}
                      </span>
                    </>
                  )}
                </div>
                {isCreditNoteSale ? (
                  <div className="sale-bill-print-inv-row sale-bill-print-inv-cn-ref">
                    <span>
                      <strong>Invoice no.</strong> {rowFieldAny(first, ['sb_no', 'SB_NO']) || '—'}
                    </span>
                    <span>
                      <strong>Type</strong> {rowFieldAny(first, ['sb_type', 'SB_TYPE']) || '—'}
                    </span>
                    <span>
                      <strong>Invoice date</strong>{' '}
                      {formatLedgerDateDisplay(first.SB_DATE ?? first.sb_date) || '—'}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="sale-bill-print-irn">
                <div>IRN: {rowFieldCI(first, 'irn_no') || v(first, 'IRN_NO', 'irn_no') || '—'}</div>
                <div>ACK: {rowFieldCI(first, 'ack_no') || v(first, 'ACK_NO', 'ack_no') || '—'}</div>
                <div>E-Way: {rowFieldCI(first, 'eway_no') || v(first, 'EWAY_NO', 'eway_no') || '—'}</div>
              </div>

              <div className={`sale-bill-print-two-col${showDispatchBlock ? ' sale-bill-print-three-col' : ''}`}>
                <div className="sale-bill-print-col">
                  <div className="sale-bill-print-col-h">Buyer (billed to)</div>
                  <div className="sale-bill-party-name">{v(first, 'NAME', 'name')}</div>
                  <div>{v(first, 'ADD1', 'add1')}</div>
                  <div>{v(first, 'ADD2', 'add2')}</div>
                  <div>{v(first, 'CITY', 'city')}</div>
                  <div>GST: {v(first, 'GST_NO', 'gst_no')}</div>
                  <div>PAN: {v(first, 'PAN', 'pan')}</div>
                </div>
                <div className="sale-bill-print-col">
                  <div className="sale-bill-print-col-h">Shipped to</div>
                  <div className="sale-bill-party-name">{v(first, 'DELV_NAME', 'delv_name') || '—'}</div>
                  <div>{v(first, 'DELV_ADD1', 'delv_add1') || '—'}</div>
                  <div>{v(first, 'DELV_ADD2', 'delv_add2') || '—'}</div>
                  <div>{v(first, 'DELV_CITY', 'delv_city') || '—'}</div>
                  <div>GST: {v(first, 'DELV_GST_NO', 'delv_gst_no') || '—'}</div>
                  <div>PAN: {v(first, 'DELV_PAN', 'delv_pan') || '—'}</div>
                </div>
                {showDispatchBlock ? (
                  <div className="sale-bill-print-col">
                    <div className="sale-bill-print-col-h">Dispatch From</div>
                    {dispatchAdd1 ? <div>{dispatchAdd1}</div> : null}
                    {dispatchAdd2 ? <div>{dispatchAdd2}</div> : null}
                    {dispatchTel1 || dispatchTel2 ? (
                      <div>
                        Tel: {[dispatchTel1, dispatchTel2].filter(Boolean).join(', ')}
                      </div>
                    ) : null}
                    {dispatchFssai ? <div>FSSAI No.: {dispatchFssai}</div> : null}
                    {dispatchGst ? <div>GST No.: {dispatchGst}</div> : null}
                  </div>
                ) : null}
              </div>

              <div className="sale-bill-print-broker">
                <strong>Broker:</strong>{' '}
                {[
                  v(first, 'BK_NAME', 'bk_name'),
                  v(first, 'B_CODE', 'b_code') || v(first, 'BK_CODE', 'bk_code'),
                ]
                  .filter(Boolean)
                  .join(' — ') || '—'}
              </div>

              <table className="sale-bill-print-table">
                <thead>
                  <tr>
                    <th style={{ width: 40, whiteSpace: 'nowrap' }}>Sno</th>
                    <th>Particulars</th>
                    {printPacking ? <th style={{ width: 54, whiteSpace: 'nowrap' }}>Packing</th> : null}
                    <th style={{ width: 76, whiteSpace: 'nowrap' }}>Hsn Code</th>
                    <th className="num">Qty</th>
                    {printGWeight ? (
                      <th className="num">
                        G.Weight
                        <br />
                        <small>{gWeightHeader}</small>
                      </th>
                    ) : null}
                    {printGWeight ? (
                      <th className="num">
                        Dane
                        <br />
                        <small>{dWeightHeader}</small>
                      </th>
                    ) : null}
                    <th className="num">
                      Weight
                      <br />
                      <small>{gWeightHeader}</small>
                    </th>
                    <th className="num">
                      Rate
                      <br />
                      <small>{rateHeader}</small>
                    </th>
                    <th className="num">
                      Amount
                      <br />
                      <small>In Rs.</small>
                    </th>
                    {showDiscountColumn ? <th className="num">Discount</th> : null}
                    {!isBillOfSupplyNoTax ? <th className="num">Taxable</th> : null}
                    {!isBillOfSupplyNoTax ? <th className="num">{cgstLabel}</th> : null}
                    {!isBillOfSupplyNoTax ? <th className="num">{sgstLabel}</th> : null}
                    {!isBillOfSupplyNoTax ? <th className="num">{igstLabel}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{v(row, 'ITEM_NAME', 'item_name')}</td>
                      {printPacking ? <td>{String(v(row, 'PACKING', 'packing') || '').slice(0, 3)}</td> : null}
                      <td>{String(v(row, 'HSN_CODE', 'hsn_code') || '').slice(0, 8)}</td>
                      <td className="num">{fmtQty(row.QNTY ?? row.qnty)}</td>
                      {printGWeight ? <td className="num">{fmtQty(row.G_WEIGHT ?? row.g_weight)}</td> : null}
                      {printGWeight ? <td className="num">{fmtQty(row.D_WEIGHT ?? row.d_weight)}</td> : null}
                      <td className="num">{fmtQty(row.WEIGHT ?? row.weight)}</td>
                      <td className="num">{fmtAmt(row.RATE ?? row.rate)}</td>
                      <td className="num">{fmtAmt(row.AMOUNT ?? row.amount)}</td>
                      {showDiscountColumn ? <td className="num">{fmtAmt(row.DIS_AMT ?? row.dis_amt)}</td> : null}
                      {!isBillOfSupplyNoTax ? <td className="num">{fmtAmt(row.TAXABLE ?? row.taxable)}</td> : null}
                      {!isBillOfSupplyNoTax ? <td className="num">{fmtAmt(row.CGST_AMT ?? row.cgst_amt)}</td> : null}
                      {!isBillOfSupplyNoTax ? <td className="num">{fmtAmt(row.SGST_AMT ?? row.sgst_amt)}</td> : null}
                      {!isBillOfSupplyNoTax ? <td className="num">{fmtAmt(row.IGST_AMT ?? row.igst_amt)}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="sale-bill-print-sum-section">
                <div className={`sale-bill-print-sum-side sale-bill-print-sum-side--left${qrImgSrc ? '' : ' sale-bill-print-sum-side--empty'}`}>
                  {qrImgSrc ? (
                    <div className="sale-bill-print-qr sale-bill-print-qr--totals">
                      <img src={qrImgSrc} alt="Signed invoice QR" />
                    </div>
                  ) : null}
                </div>
                <div className="sale-bill-print-sum-block">
                  <table className="sale-bill-print-totals">
                    <tbody>
                      <tr>
                        <td>Total amount</td>
                        <td className="num">{fmtAmt(totals.sumAmt)}</td>
                      </tr>
                      {Math.abs(totals.disAmt) > 0.0001 ? (
                        <tr>
                          <td>Discount</td>
                          <td className="num">{fmtAmt(totals.disAmt)}</td>
                        </tr>
                      ) : null}
                      {!isBillOfSupplyNoTax && Math.abs(totals.sumTax) > 0.0001 ? (
                        <tr>
                          <td>Total taxable</td>
                          <td className="num">{fmtAmt(totals.sumTax)}</td>
                        </tr>
                      ) : null}
                      {!isBillOfSupplyNoTax && Math.abs(totals.sumC) > 0.0001 ? (
                        <tr>
                          <td>{cgstLabel}</td>
                          <td className="num">{fmtAmt(totals.sumC)}</td>
                        </tr>
                      ) : null}
                      {!isBillOfSupplyNoTax && Math.abs(totals.sumS) > 0.0001 ? (
                        <tr>
                          <td>{sgstLabel}</td>
                          <td className="num">{fmtAmt(totals.sumS)}</td>
                        </tr>
                      ) : null}
                      {!isBillOfSupplyNoTax && Math.abs(totals.sumI) > 0.0001 ? (
                        <tr>
                          <td>{igstLabel}</td>
                          <td className="num">{fmtAmt(totals.sumI)}</td>
                        </tr>
                      ) : null}
                      {Math.abs(totals.freight) > 0.0001 ? (
                        <tr>
                          <td>Freight</td>
                          <td className="num">{fmtAmt(totals.freight)}</td>
                        </tr>
                      ) : null}
                      {totals.expenseItems.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.label}</td>
                          <td className="num">{fmtAmt(item.amount)}</td>
                        </tr>
                      ))}
                      {Math.abs(totals.othExp5) > 0.0001 ? (
                        <tr>
                          <td>Round off</td>
                          <td className="num">{fmtAmt(totals.othExp5)}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  <div className="sale-bill-print-net-words-row">
                    <div className="sale-bill-print-words-inline">
                      <strong>Rs in words:</strong> {amountInWords}
                    </div>
                    <div className="sale-bill-print-net-amount">
                      <div>
                        <strong>Net amount</strong>
                      </div>
                      <div className="num sale-bill-print-net-figure">
                        <strong>{fmtAmt(totals.billAmt)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {bankAcNo || bankAcNo1 ? (
                <div className="sale-bill-print-bank">
                  {bankAcNo ? <div>{bankAcNo}</div> : null}
                  {bankAcNo1 ? <div>{bankAcNo1}</div> : null}
                </div>
              ) : null}

              {truckNo || tpt || grNo ? (
                <div className="sale-bill-print-transport">
                  {truckNo ? (
                    <span className="sale-bill-print-transport-item">
                      <strong>Truck no.:</strong> {truckNo}
                    </span>
                  ) : null}
                  {tpt ? (
                    <span className="sale-bill-print-transport-item">
                      <strong>Tpt:</strong> {tpt}
                    </span>
                  ) : null}
                  {grNo ? (
                    <span className="sale-bill-print-transport-item">
                      <strong>GR no.:</strong> {grNo}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <hr className="sale-bill-print-footer-rule" />

              <div className="sale-bill-print-bottom-row">
                {terms.length > 0 ? (
                  <div className="sale-bill-print-terms">
                    <div className="sale-bill-print-col-h">Terms &amp; Conditions:</div>
                    {terms.map((term, idx) => (
                      <div key={idx}>{term}</div>
                    ))}
                  </div>
                ) : (
                  <div />
                )}
                <div className="sale-bill-print-sign">
                  <div>For {compDisplayName}</div>
                  {signatureImgSrc ? (
                    <div className="sale-bill-print-signature">
                      <img src={signatureImgSrc} alt="Authorised signature" />
                    </div>
                  ) : null}
                  <div className="sale-bill-print-auth">Authorised signatory</div>
                </div>
              </div>
            </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
