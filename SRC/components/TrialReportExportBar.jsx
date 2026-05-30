import React from 'react';

export default function TrialReportExportBar({
  pdfBusy,
  onPdf,
  onExcel,
  onPrint,
  onWhatsApp,
  printDisabled,
}) {
  return (
    <div className="fas-tb-export-bar">
      <button type="button" className="btn btn-export" disabled={pdfBusy} onClick={onPdf}>
        Pdf
      </button>
      <button type="button" className="btn btn-excel" onClick={onExcel}>
        📊 Excel
      </button>
      {onPrint ? (
        <button type="button" className="btn btn-secondary" disabled={printDisabled} onClick={onPrint}>
          Print
        </button>
      ) : null}
      <button type="button" className="btn btn-whatsapp" disabled={pdfBusy} onClick={onWhatsApp}>
        💬 WhatsApp
      </button>
    </div>
  );
}
