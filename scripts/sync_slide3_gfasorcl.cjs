const fs = require('fs');
const path = require('path');

const windalRoot = path.join(__dirname, '..');
const gfasRoot = 'E:/GFASORCL/APPTEST';

const windalCss = fs.readFileSync(path.join(windalRoot, 'SRC/App.css'), 'utf8');
let gfasCss = fs.readFileSync(path.join(gfasRoot, 'SRC/App.css'), 'utf8');

const cssStart = windalCss.indexOf('/* Step 3: grouped report menu (buckets) */');
const cssEnd = windalCss.indexOf('/* TABLE STYLING */', cssStart);
if (cssStart < 0 || cssEnd < 0) throw new Error('WINDAL slide-3 CSS block not found');

const cssBlock = windalCss.slice(cssStart, cssEnd);

const gCssStart = gfasCss.indexOf('/* Step 3 report list');
const gCssEnd = gfasCss.indexOf('/* TABLE STYLING */', gCssStart);
if (gCssStart < 0 || gCssEnd < 0) throw new Error('GFASORCL slide-3 CSS block not found');

gfasCss = gfasCss.slice(0, gCssStart) + cssBlock + gfasCss.slice(gCssEnd);

gfasCss = gfasCss.replace(
  /\.slide-3 \{\s*max-width: 920px;\s*\}/,
  `.slide-3 {
  max-width: 920px;
  width: 100%;
  height: calc(100dvh - 5.5rem);
  max-height: calc(100dvh - 5.5rem);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.slide-3 .company-info,
.slide-3-menu-header,
.slide-3 .button-group {
  flex-shrink: 0;
}`
);

gfasCss = gfasCss.replace(
  /\.app-main \{\s*flex: 1;\s*padding: 1rem;\s*display: flex;\s*justify-content: center;\s*align-items: flex-start;\s*\}/,
  `.app-main {
  flex: 1;
  min-height: 0;
  padding: 1rem;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  overflow: hidden;
}`
);

gfasCss = gfasCss.replace(
  /\.app--selector \.app-main \{\s*align-items: center;\s*\}/,
  `.app--selector .app-main {
  align-items: center;
  overflow-x: hidden;
  overflow-y: auto;
}`
);

const mobileBlock = `
  .slide-3-menu-header__title {
    font-size: 1.08rem;
  }

  .slide-3-menu-header__hint {
    font-size: 0.72rem;
  }

  .slide-3-menu-header__selection {
    font-size: 0.78rem;
    padding: 0.4rem 0.55rem;
  }

  .slide-3-menu-toolbar__btn {
    font-size: 0.74rem;
    padding: 0.32rem 0.72rem;
    min-height: 2rem;
  }

  .slide-3 {
    height: calc(100dvh - 4.25rem);
    max-height: calc(100dvh - 4.25rem);
    padding: 0.85rem;
  }

  .slide-3 .report-options {
    flex: 1 1 0;
    min-height: 0;
    max-height: 100%;
    border-radius: 10px;
    padding: 0.28rem;
    padding-bottom: 0.75rem;
    gap: 0.32rem;
  }

  .slide-3 .report-options::-webkit-scrollbar {
    width: 6px;
  }

  .slide-3 .report-bucket-head {
    padding: 0.62rem 0.55rem;
    gap: 0.55rem;
  }

  .slide-3 .report-bucket-head__index {
    min-width: 1.65rem;
    height: 1.65rem;
    font-size: 0.78rem;
  }

  .slide-3 .report-bucket-head__title {
    font-size: 0.88rem;
  }

  .slide-3 .report-bucket-head__subtitle {
    font-size: 0.7rem;
  }

  .slide-3 .report-bucket-body .report-option {
    margin: 0 0.22rem 0.28rem;
    padding: 0.58rem 0.52rem;
  }

  .slide-3 .report-option {
    gap: 0.38rem 0.58rem;
    padding: 0.56rem 0.56rem;
  }

  .slide-3 .report-option input[type='radio'] {
    transform: scale(1.08);
    margin-top: 0.14rem;
  }

  .slide-3 .report-option__title {
    font-size: 0.92rem;
  }
`;

gfasCss = gfasCss.replace(
  /  \.slide-3 \.report-options \{\s*max-height: min\(58vh, 560px\);[\s\S]*?  \.slide-3 \.report-option label p \{\s*font-size: 0\.76rem;\s*\}/,
  mobileBlock.trim()
);

fs.writeFileSync(path.join(gfasRoot, 'SRC/App.css'), gfasCss);

let slide3 = fs.readFileSync(path.join(windalRoot, 'SRC/slides/Slide3.jsx'), 'utf8');
const stockItems = `    items: [
      { id: 'stock-sum', title: 'Stock Sum', description: 'LOTSTOCK item-wise totals by ending date and godown — click an item for lot detail' },
      { id: 'stock-lot', title: 'Stock Lot Wise', description: 'LOTSTOCK lot-wise position with filters (godown/item/supplier) and Complete/Outstanding view' },
      { id: 'hsn-sales', title: 'HSN Sales', description: 'HSN-wise sales: date wise, monthly HSN wise, and HSN wise monthly' },
      { id: 'hsn-purchase', title: 'HSN Purchase', description: 'HSN-wise purchase with the same tab layout as HSN sales' },
    ],`;
slide3 = slide3.replace(
  /id: 'stock-reports',[\s\S]*?items: \[[\s\S]*?\],\n  \},/,
  `id: 'stock-reports',
    index: 3,
    title: 'Stock Reports',
    subtitle: 'Inventory & HSN tax tracking',
${stockItems}
  },`
);

/* GFASORCL has no sales-entry screens — drop that bucket and renumber. */
slide3 = slide3.replace(
  /\s*\{\s*id: 'sales-entry',[\s\S]*?\},\s*(?=\{\s*id: 'purchase-module')/,
  '\n  '
);
slide3 = slide3.replace(/id: 'purchase-module',\s*index: 6,/g, "id: 'purchase-module',\n    index: 5,");
slide3 = slide3.replace(/id: 'voucher-module',\s*index: 7,/g, "id: 'voucher-module',\n    index: 6,");

fs.writeFileSync(path.join(gfasRoot, 'SRC/slides/Slide3.jsx'), slide3);
console.log('Synced Slide3.jsx and App.css to', gfasRoot);
