const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..'),
  'E:/GFASORCL/APPTEST',
];

const SLIDES = [
  { file: 'SRC/slides/Slide4.jsx', reportId: 'trial-balance' },
  { file: 'SRC/slides/Slide5.jsx', reportId: 'ledger', dynamic: 'ledger' },
  { file: 'SRC/slides/Slide6.jsx', reportId: 'customer-ledger' },
  { file: 'SRC/slides/Slide7.jsx', reportId: 'broker-os' },
  { file: 'SRC/slides/Slide8.jsx', reportId: 'sale-list' },
  { file: 'SRC/slides/Slide9.jsx', reportId: 'stock-sum' },
  { file: 'SRC/slides/Slide10.jsx', reportId: 'stock-lot' },
  { file: 'SRC/slides/Slide11.jsx', reportId: 'purchase-list' },
  { file: 'SRC/slides/Slide12.jsx', reportId: 'ageing' },
  { file: 'SRC/slides/Slide13.jsx', reportId: 'sale-bill-printing' },
  { file: 'SRC/slides/Slide14.jsx', reportId: 'voucher-list' },
  { file: 'SRC/slides/Slide15.jsx', reportId: 'gstr1' },
  { file: 'SRC/slides/Slide16.jsx', reportId: 'hsn-sales', dynamic: 'hsn' },
  { file: 'SRC/slides/Slide17TradingAc.jsx', reportId: 'trading-ac' },
  { file: 'SRC/slides/Slide18PlProfitLoss.jsx', reportId: 'pl-profit-loss' },
  { file: 'SRC/slides/Slide19BalanceSheet.jsx', reportId: 'balance-sheet' },
  { file: 'SRC/slides/Slide21SaleBill.jsx', reportId: 'sale-bill-entry', header: 'sale-bill-page__title-row' },
  { file: 'SRC/slides/Slide22DispatchChallan.jsx', reportId: 'dispatch-challan-entry', header: 'sale-bill-page__title-row' },
  { file: 'SRC/slides/Slide23SalesOrder.jsx', reportId: 'sales-order-entry', header: 'sale-bill-page__title-row' },
];

const IMPORT_LINE = "import ReportHelpButton from '../components/ReportHelpButton';\n";

function helpSnippet(entry, gfas) {
  if (entry.dynamic === 'ledger') {
    return '<ReportHelpButton reportId={isLedgerInterest ? \'ledger-interest\' : \'ledger\'} />\n            ';
  }
  if (entry.dynamic === 'hsn') {
    return '<ReportHelpButton reportId={reportMode === \'purchase\' ? \'hsn-purchase\' : \'hsn-sales\'} />\n            ';
  }
  const stockLot = entry.reportId === 'stock-lot';
  const salesEntry = ['sale-bill-entry', 'dispatch-challan-entry', 'sales-order-entry'].includes(entry.reportId);
  const extra =
    gfas && salesEntry
      ? null
      : `<ReportHelpButton reportId="${entry.reportId}"${gfas ? ' includeSalesEntry={false} includeStockLot={true} appName="GFASORCL Accounting"' : ''} />\n            `;
  if (!extra && salesEntry) return '';
  return extra;
}

function patchFile(root, entry, gfas) {
  const fp = path.join(root, entry.file);
  if (!fs.existsSync(fp)) return 'skip-missing';
  let s = fs.readFileSync(fp, 'utf8');
  if (s.includes('ReportHelpButton')) return 'already';

  if (!s.includes(IMPORT_LINE.trim())) {
    const m = s.match(/^import .+;\n/m);
    if (m) {
      const idx = s.lastIndexOf(m[0]) + m[0].length;
      let last = 0;
      let pos = 0;
      while ((pos = s.indexOf('import ', pos)) >= 0) {
        const end = s.indexOf('\n', pos) + 1;
        last = end;
        pos = end;
      }
      s = s.slice(0, last) + IMPORT_LINE + s.slice(last);
    }
  }

  const snippet = helpSnippet(entry, gfas);
  if (!snippet) return 'skip-snippet';

  if (entry.header) {
    const marker = `className="${entry.header}"`;
    if (!s.includes(marker)) return 'skip-header';
    if (s.includes(marker) && !s.includes(`ReportHelpButton reportId="${entry.reportId}"`)) {
      s = s.replace(
        marker,
        `${marker} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}`
      );
      s = s.replace(
        /(<header className="sale-bill-page__header">[\s\S]*?<div className="sale-bill-page__title-row"[^>]*>)([\s\S]*?)(<\/div>)/,
        (full, open, inner, close) => {
          if (inner.includes('ReportHelpButton')) return full;
          return `${open}<h2 className="sale-bill-page__title">${inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] || 'Entry'}</h2>${snippet.trimEnd()}${close}`;
        }
      );
    }
  } else {
    const re = /<div className="toolbar-actions">/g;
    if (!re.test(s)) return 'skip-toolbar';
    s = s.replace(/<div className="toolbar-actions">/g, (m) => `${m}\n            ${snippet}`);
  }

  fs.writeFileSync(fp, s);
  return 'patched';
}

for (const root of roots) {
  const gfas = root.includes('GFASORCL');
  if (!fs.existsSync(root)) {
    console.log('skip root', root);
    continue;
  }
  console.log('===', root, '===');
  for (const entry of SLIDES) {
    if (gfas && ['Slide21SaleBill', 'Slide22', 'Slide23'].some((x) => entry.file.includes(x))) {
      console.log(entry.file, 'skip-sales-entry');
      continue;
    }
    if (!gfas && entry.file === 'SRC/slides/Slide10.jsx' && !fs.existsSync(path.join(root, entry.file))) {
      console.log(entry.file, 'skip');
      continue;
    }
    console.log(entry.file, patchFile(root, entry, gfas));
  }
}
