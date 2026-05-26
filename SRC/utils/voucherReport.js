import { buildReportHtml, buildVoucherPrintDocumentHtml } from './pdfgenerator';

/** Full HTML document for iframe / print preview. */
export function buildVoucherReportPreviewHtml(reportType, data, metadata) {
  if (reportType === 'voucher-print') {
    return buildVoucherPrintDocumentHtml(data, metadata);
  }
  return buildVoucherIframeDoc(buildReportHtml(reportType, data, metadata));
}

/** Minimal iframe document for browser print preview (generic reports). */
export function buildVoucherIframeDoc(bodyHtml) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
      @media print {
        html, body { margin: 0; }
      }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

export function openVoucherHtmlPrint(documentHtml) {
  if (!documentHtml) {
    alert('Nothing to print.');
    return null;
  }
  const w = window.open('', '_blank');
  if (!w) {
    alert('Allow pop-ups to print.');
    return null;
  }
  w.document.write(documentHtml);
  w.document.close();
  w.onload = () => w.print();
  return w;
}

/** Opens report in a new window and triggers browser print (used from preview modal). */
export function openVoucherReportPrint(reportType, data, metadata) {
  const documentHtml = buildVoucherReportPreviewHtml(reportType, data, metadata);
  return openVoucherHtmlPrint(documentHtml);
}
