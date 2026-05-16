const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..');
const dst = 'E:/GFASORCL/APPTEST';

const copyFiles = [
  'SRC/data/reportHelpContent.js',
  'SRC/components/ReportHelpButton.jsx',
  'SRC/utils/reportHelpPdf.js',
  'SRC/slides/Slide3.jsx',
];

for (const f of copyFiles) {
  const from = path.join(src, f);
  const to = path.join(dst, f);
  if (!fs.existsSync(from)) continue;
  let content = fs.readFileSync(from, 'utf8');
  if (f.includes('Slide3')) {
    content = content.replace(/showFullGuidePdf/g, 'showFullGuidePdf');
    content = content.replace(
      /<ReportHelpButton[\s\S]*?label="Menu help"[\s\S]*?\/>/,
      `<ReportHelpButton
            reportId="reports-menu"
            companyName={formData.comp_name ?? formData.COMP_NAME}
            showFullGuidePdf
            includeSalesEntry={false}
            includeStockLot={true}
            appName="GFASORCL Accounting"
            label="Menu help"
          />`
    );
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, content);
  console.log('copied', f);
}

const cssMarker = '.btn-report-help {';
const windalCss = fs.readFileSync(path.join(src, 'SRC/App.css'), 'utf8');
let gfasCss = fs.readFileSync(path.join(dst, 'SRC/App.css'), 'utf8');
if (!gfasCss.includes(cssMarker)) {
  const start = windalCss.indexOf(cssMarker);
  const end = windalCss.indexOf('.slide-3-menu-help {', start) + '.slide-3-menu-help {'.length;
  const end2 = windalCss.indexOf('}', end) + 1;
  const block = windalCss.slice(start, end2);
  const insertAt = gfasCss.indexOf('.toolbar-actions {');
  const insertEnd = gfasCss.indexOf('}', insertAt) + 1;
  gfasCss = gfasCss.slice(0, insertEnd) + '\n\n' + block + gfasCss.slice(insertEnd);
  fs.writeFileSync(path.join(dst, 'SRC/App.css'), gfasCss);
  console.log('merged help CSS');
}

console.log('done');
