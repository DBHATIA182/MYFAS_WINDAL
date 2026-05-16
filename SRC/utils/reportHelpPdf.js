import html2pdf from 'html2pdf.js';
import { buildUserGuideHtml, getPdfReportIdsForApp } from '../data/reportHelpContent';

export async function downloadUserGuidePdf({
  companyName = '',
  appName = 'Windal Accounting',
  includeSalesEntry = true,
  includeStockLot = false,
} = {}) {
  const includeReportIds = getPdfReportIdsForApp({ includeSalesEntry, includeStockLot });
  const html = buildUserGuideHtml({ companyName, appName, includeReportIds });
  const stamp = new Date().toISOString().split('T')[0];
  const filename = `${String(companyName || appName).replace(/[^\w.-]+/g, '_')}_Reports_User_Guide_${stamp}.pdf`;
  const options = {
    margin: [10, 10, 12, 10],
    filename,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };
  await html2pdf().set(options).from(html).save();
}
