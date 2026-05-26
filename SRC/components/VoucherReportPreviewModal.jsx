import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { generatePDF, isCashReceiptVoucher, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { buildVoucherReportPreviewHtml } from '../utils/voucherReport';

function defaultTitle(reportType, data) {
  if (reportType === 'voucher-print' && isCashReceiptVoucher(data?.header)) {
    const no = String(data?.header?.vr_no ?? '').trim();
    return no ? `Cash receipt · ${no}` : 'Cash receipt';
  }
  if (reportType === 'voucher-print') return 'Voucher print preview';
  if (reportType === 'voucher-list') return 'Voucher list preview';
  return 'Report preview';
}

export default function VoucherReportPreviewModal({
  open,
  onClose,
  reportType,
  data,
  metadata,
  shareText = '',
  title,
  showPdf = true,
  showExcel = false,
  onExcel,
  excelDisabled = false,
}) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const previewHtml = useMemo(() => {
    if (!open || !reportType) return '';
    return buildVoucherReportPreviewHtml(reportType, data, metadata);
  }, [open, reportType, data, metadata]);

  const cashReceipt = reportType === 'voucher-print' && isCashReceiptVoucher(data?.header);
  const modalTitle = title || defaultTitle(reportType, data);
  const showPdfBtn = showPdf && !cashReceipt;

  const handleBrowserPrint = useCallback(() => {
    if (!previewHtml) return;
    const w = window.open('', '_blank');
    if (!w) {
      alert('Allow pop-ups to print.');
      return;
    }
    w.document.write(previewHtml);
    w.document.close();
    w.onload = () => w.print();
  }, [previewHtml]);

  const handlePdf = useCallback(() => {
    generatePDF(reportType, data, metadata).catch((e) => alert(e?.message || String(e)));
  }, [reportType, data, metadata]);

  const handleWhatsApp = useCallback(() => {
    sharePdfWithWhatsApp(reportType, data, metadata, shareText).catch((e) => alert(e?.message || String(e)));
  }, [reportType, data, metadata, shareText]);

  if (!open) return null;

  return createPortal(
    <div
      className="sale-bill-modal-backdrop sale-bill-print-backdrop dc-print-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={[
          'sale-bill-modal',
          'sale-bill-print-modal',
          isMobile ? 'sale-bill-print-modal--mobile' : '',
          cashReceipt ? 'sale-bill-print-modal--cash-receipt' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-labelledby="voucher-report-preview-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sale-bill-modal-head no-print">
          <h3 id="voucher-report-preview-title">{modalTitle}</h3>
          <div className="sale-bill-print-actions">
            <button type="button" className="btn btn-secondary" disabled={!previewHtml} onClick={handleBrowserPrint}>
              Print
            </button>
            {showPdfBtn ? (
              <button type="button" className="btn btn-export" onClick={handlePdf}>
                Pdf
              </button>
            ) : null}
            {showExcel ? (
              <button type="button" className="btn btn-excel" disabled={excelDisabled} onClick={onExcel}>
                Excel
              </button>
            ) : null}
            <button type="button" className="btn btn-whatsapp" onClick={handleWhatsApp}>
              WhatsApp
            </button>
            <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        </div>
        <div className="sale-bill-modal-body sale-bill-print-body">
          {previewHtml ? (
            <iframe
              title={modalTitle}
              className="sale-bill-mobile-pdf-preview"
              srcDoc={previewHtml}
            />
          ) : (
            <p className="sale-bill-section__hint">Nothing to preview.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
