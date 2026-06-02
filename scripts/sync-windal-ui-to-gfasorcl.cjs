/**
 * Sync WINDAL UI (login, company/year, dashboard, sale chart, overdue) → E:/GFASORCL/APPTEST
 * Run: node scripts/sync-windal-ui-to-gfasorcl.cjs
 */
const fs = require('fs');
const path = require('path');

const srcRoot = path.join(__dirname, '..');
const dstRoot = 'E:/GFASORCL/APPTEST';

const FILES = [
  'SRC/components/WindalInitialFlowCard.jsx',
  'SRC/components/WindalDashboardMenu.jsx',
  'SRC/components/SaleGraphCharts.jsx',
  'SRC/components/FasReportHeader.jsx',
  'SRC/components/SessionToolbarChrome.jsx',
  'SRC/components/SessionInfoLine.jsx',
  'SRC/components/AppSessionContext.jsx',
  'SRC/components/AppSessionLine.jsx',
  'SRC/components/ToolbarIcons.jsx',
  'SRC/components/ReportHelpButton.jsx',
  'SRC/utils/appSessionLine.js',
  'SRC/utils/saleEntryFinYear.js',
  'SRC/utils/masterSearchFilter.js',
  // reportMenuConfig.js is GFAS-specific — see scripts/gfas-reportMenuConfig.js
  'SRC/slides/LoginSlide.jsx',
  'SRC/slides/Slide1.jsx',
  'SRC/slides/slide2.jsx',
  'SRC/slides/Slide3.jsx',
  'SRC/slides/Slide33SaleGraph.jsx',
  'SRC/slides/Slide34OverdueCustomers.jsx',
  'SRC/styles/windalInitialFlow.css',
  'SRC/styles/fasFlowTheme.css',
  'SRC/styles/windalDashboard.css',
  'SRC/styles/saleGraph.css',
  'SRC/styles/overdueCustomers.css',
  'SRC/utils/dateFormat.js',
];

const SERVER_SALE_START = 'function formatDateDmyFromRaw(raw)';
const SERVER_SALE_END = '// 3. Trial Balance (The Main Report)';
const SERVER_OVERDUE_START = "app.get('/api/overdue-customers'";
const SERVER_OVERDUE_END = "app.get('/api/ageing-bills-detail'";

function copyFile(rel) {
  const from = path.join(srcRoot, rel);
  const to = path.join(dstRoot, rel);
  if (!fs.existsSync(from)) {
    console.warn('SKIP (missing source):', rel);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log('Copied', rel);
}

function patchGfasSaleGraphSql() {
  const serverPath = path.join(dstRoot, 'server.cjs');
  if (!fs.existsSync(serverPath)) return;
  let s = fs.readFileSync(serverPath, 'utf8');
  if (s.includes("SALE_GRAPH_TYPE_SQL")) {
    console.log('server.cjs already has GFAS sale-graph SQL');
    return;
  }
  if (!s.includes("app.get('/api/sale-graph-monthly'")) {
    console.warn('SKIP GFAS sale-graph patch — route missing');
    return;
  }
  s = s.replace(
    /const SALE_GRAPH_WT_EXPR =[\s\S]*?function saleGraphItemFilterSql\(item_code\) \{[\s\S]*?^\}/m,
    `/** GFASORCL: SALE.TYPE is SL/SE/CN; ITEM_CODE is NUMBER. */
const SALE_GRAPH_TYPE_SQL = "UPPER(TRIM(A.TYPE)) IN ('SL', 'SE', 'CN')";
const SALE_GRAPH_WT_EXPR =
  "CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.WEIGHT, 0) ELSE NVL(A.WEIGHT, 0) END";
const SALE_GRAPH_AMT_EXPR =
  "CASE WHEN UPPER(TRIM(A.TYPE)) = 'CN' THEN -NVL(A.BILL_AMT, 0) ELSE NVL(A.BILL_AMT, 0) END";

function parseItemCodeForSql(raw) {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function saleGraphItemFilterSql(item_code) {
  const code = parseItemCodeForSql(item_code);
  if (code === undefined) return { sql: '', binds: {} };
  return {
    sql: ' AND A.ITEM_CODE = :item_code ',
    binds: { item_code: code },
  };
}`
  );
  s = s.replace(/AND A\.TYPE BETWEEN 1 AND 9/g, 'AND ${SALE_GRAPH_TYPE_SQL}');
  s = s.replace(
    /SELECT\s+TRIM\(TO_CHAR\(A\.ITEM_CODE\)\) AS ITEM_CODE,[\s\S]*?ORDER BY ITEM_CODE, MONTH_KEY`;/,
    `SELECT
      A.ITEM_CODE,
      NVL(MAX(C.ITEM_NAME), TO_CHAR(A.ITEM_CODE)) AS ITEM_NAME,
      TO_CHAR(TRUNC(A.BILL_DATE, 'MM'), 'YYYY-MM') AS MONTH_KEY,
      SUM(\${SALE_GRAPH_WT_EXPR}) AS TOTAL_WEIGHT,
      SUM(\${SALE_GRAPH_AMT_EXPR}) AS TOTAL_AMOUNT,
      COUNT(*) AS LINE_COUNT
    FROM SALE A
    LEFT JOIN ITEMMAST C
      ON A.COMP_CODE = C.COMP_CODE
     AND A.ITEM_CODE = C.ITEM_CODE
    WHERE A.COMP_CODE = :comp_code
      AND \${SALE_GRAPH_TYPE_SQL}
      AND A.ITEM_CODE IS NOT NULL
      AND TRUNC(A.BILL_DATE) BETWEEN TRUNC(TO_DATE(:s_date, 'DD-MM-YYYY'))
                                  AND TRUNC(TO_DATE(:e_date, 'DD-MM-YYYY'))
    GROUP BY A.ITEM_CODE,
             TRUNC(A.BILL_DATE, 'MM'),
             TO_CHAR(A.BILL_DATE, 'MON', 'NLS_DATE_LANGUAGE=ENGLISH')
    ORDER BY A.ITEM_CODE, MONTH_KEY\`;`
  );
  fs.writeFileSync(serverPath, s, 'utf8');
  console.log('Patched GFAS sale-graph SQL in server.cjs');
}

function patchGfasReportMenu() {
  const templatePath = path.join(__dirname, 'gfas-reportMenuConfig.js');
  const dst = path.join(dstRoot, 'SRC/data/reportMenuConfig.js');
  if (!fs.existsSync(templatePath)) {
    console.warn('SKIP GFAS menu — gfas-reportMenuConfig.js missing');
    return;
  }
  const { module.exports: content } = require(templatePath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, content, 'utf8');
  console.log('Wrote GFAS-specific reportMenuConfig.js');
}

function patchGfasBrand() {
  const brandPath = path.join(dstRoot, 'SRC/utils/windalBrand.js');
  const content = `/** Initial-flow branding (reads product from connection.config when set). */
import connectionConfig from '../../connection.config.json';

const product = connectionConfig.product || {};
const displayName = String(product.displayName || 'GRAINFAS').trim() || 'GRAINFAS';
const displayTitle =
  String(product.displayTitle || '').trim() || \`(FAS) \${displayName} - Financial Accounting System\`;

export const WINDAL_BRAND = {
  fasPrefix: '(FAS)',
  productName: displayName,
  tagline: 'Financial Accounting System',
  logoLetter: displayName.charAt(0).toUpperCase() || 'G',
  documentTitle: displayTitle,
  footerNote: \`Oracle • \${displayName}\`,
};

export function getWindalDocumentTitle(configTitle) {
  const custom = String(configTitle || '').trim();
  if (custom && !/mahavira|mffas/i.test(custom)) {
    return custom;
  }
  return WINDAL_BRAND.documentTitle;
}
`;
  fs.mkdirSync(path.dirname(brandPath), { recursive: true });
  fs.writeFileSync(brandPath, content, 'utf8');
  console.log('Wrote', brandPath);
}

function patchConnectionConfig() {
  const cfgPath = path.join(dstRoot, 'connection.config.json');
  if (!fs.existsSync(cfgPath)) return;
  const raw = fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, '');
  const cfg = JSON.parse(raw);
  if (!cfg.product) {
    cfg.product = {
      displayName: 'GRAINFAS',
      displayTitle: '(FAS) GRAINFAS - Financial Accounting System',
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 4), 'utf8');
    console.log('Added product section to connection.config.json');
  }
}

function patchServerApis() {
  const serverPath = path.join(dstRoot, 'server.cjs');
  const windalServer = fs.readFileSync(path.join(srcRoot, 'server.cjs'), 'utf8');
  if (!fs.existsSync(serverPath)) {
    console.warn('SKIP server.cjs — target missing');
    return;
  }
  let gfas = fs.readFileSync(serverPath, 'utf8');

  if (!gfas.includes("app.get('/api/sale-graph-monthly'")) {
    const start = windalServer.indexOf(SERVER_SALE_START);
    const end = windalServer.indexOf(SERVER_SALE_END, start);
    if (start < 0 || end < 0) {
      console.warn('SKIP sale-graph API extract — markers not found');
    } else {
      const block = windalServer.slice(start, end);
      const insertAt = gfas.indexOf(SERVER_SALE_END);
      if (insertAt < 0) {
        console.warn('SKIP sale-graph insert — trial balance marker missing');
      } else {
        gfas = gfas.slice(0, insertAt) + block + '\n' + gfas.slice(insertAt);
        console.log('Inserted sale-graph APIs into server.cjs');
      }
    }
  } else {
    console.log('server.cjs already has sale-graph API');
  }

  if (!gfas.includes("app.get('/api/overdue-customers'")) {
    const oStart = windalServer.indexOf(SERVER_OVERDUE_START);
    const oEnd = windalServer.indexOf(SERVER_OVERDUE_END, oStart);
    if (oStart < 0 || oEnd < 0) {
      console.warn('SKIP overdue API extract — markers not found');
    } else {
      const overdueBlock = windalServer.slice(oStart, oEnd);
      const ageingErr = "console.error('❌ Ageing report error:'";
      const insertAt = gfas.indexOf(ageingErr);
      if (insertAt < 0) {
        const fallback = gfas.lastIndexOf('});');
        gfas = gfas + '\n\n' + overdueBlock;
        console.log('Appended overdue API to server.cjs (fallback)');
      } else {
        const afterRoute = gfas.indexOf('});', insertAt);
        const pos = afterRoute >= 0 ? afterRoute + 4 : insertAt;
        gfas = gfas.slice(0, pos) + '\n\n' + overdueBlock + gfas.slice(pos);
        console.log('Inserted overdue API after ageing report');
      }
    }
  } else {
    console.log('server.cjs already has overdue API');
  }

  fs.writeFileSync(serverPath, gfas, 'utf8');
}

function patchSlide6() {
  const p = path.join(dstRoot, 'SRC/slides/Slide6.jsx');
  const windal = fs.readFileSync(path.join(srcRoot, 'SRC/slides/Slide6.jsx'), 'utf8');
  fs.copyFileSync(path.join(srcRoot, 'SRC/slides/Slide6.jsx'), p);
  console.log('Copied Slide6.jsx (customer ledger + overdue back)');
}

function patchSlide8() {
  const p = path.join(dstRoot, 'SRC/slides/Slide8.jsx');
  if (!fs.existsSync(p)) {
    console.warn('SKIP Slide8 — not in GFASORCL');
    return;
  }
  let s8 = fs.readFileSync(p, 'utf8');
  if (s8.includes('saleChartDrilldown')) {
    console.log('Slide8 already has sale chart drilldown');
    return;
  }
  const windal = fs.readFileSync(path.join(srcRoot, 'SRC/slides/Slide8.jsx'), 'utf8');
  const m = windal.match(
    /useEffect\(\(\) => \{[\s\S]*?formData\.saleChartDrilldown[\s\S]*?\}, \[formData\.saleChartDrilldown\]\);/
  );
  if (!m) {
    console.warn('SKIP Slide8 drilldown — pattern not found in WINDAL');
    return;
  }
  const insertAfter = s8.indexOf('const saleChartDrillRanRef = useRef(null);');
  if (insertAfter < 0) {
    const refLine = '  const lookupRequestSeqRef = useRef(0);';
    const pos = s8.indexOf(refLine);
    if (pos >= 0) {
      s8 =
        s8.slice(0, pos + refLine.length) +
        '\n  const saleChartDrillRanRef = useRef(null);' +
        s8.slice(pos + refLine.length);
    }
  }
  if (!s8.includes('saleChartDrillRanRef')) {
    s8 = s8.replace(
      '  const lookupRequestSeqRef = useRef(0);',
      '  const lookupRequestSeqRef = useRef(0);\n  const saleChartDrillRanRef = useRef(null);'
    );
  }
  const hookPos = s8.indexOf('  }, [apiBase, compCode, compUid, startDate, endDate]);');
  if (hookPos > 0 && !s8.includes('saleChartDrilldown')) {
    s8 = s8.slice(0, hookPos + '  }, [apiBase, compCode, compUid, startDate, endDate]);'.length) + '\n\n' + m[0] + s8.slice(hookPos + '  }, [apiBase, compCode, compUid, startDate, endDate]);'.length);
  }
  fs.writeFileSync(p, s8, 'utf8');
  console.log('Patched Slide8.jsx sale chart drilldown');
}

function mergeReportHelp() {
  const dst = path.join(dstRoot, 'SRC/data/reportHelpContent.js');
  const src = path.join(srcRoot, 'SRC/data/reportHelpContent.js');
  if (!fs.existsSync(dst) || !fs.existsSync(src)) return;
  let dstText = fs.readFileSync(dst, 'utf8');
  const srcText = fs.readFileSync(src, 'utf8');
  for (const id of ['sale-chart', 'sale-graph', 'overdue-customers']) {
    if (dstText.includes(`'${id}'`)) continue;
    const re = new RegExp(`'${id.replace('-', '\\-')}':\\s*\\{[\\s\\S]*?\\n  \\},`, 'm');
    const hit = srcText.match(re);
    if (hit) {
      const insertBefore = "export const REPORT_HELP_BY_ID";
      const pos = dstText.indexOf(insertBefore);
      if (pos > 0) {
        dstText = dstText.slice(0, pos) + hit[0] + '\n\n' + dstText.slice(pos);
        console.log('Merged help:', id);
      }
    }
  }
  if (!dstText.includes("'sale-chart'") && dstText.includes('PDF_ORDER')) {
    const pdfRe = /export const PDF_ORDER = \[([\s\S]*?)\];/;
    const m = dstText.match(pdfRe);
    if (m && !m[1].includes('sale-chart')) {
      dstText = dstText.replace(
        pdfRe,
        (full, inner) =>
          `export const PDF_ORDER = [${inner.trim().replace(/,\s*$/, '')},\n  'sale-chart',\n  'overdue-customers',\n];`
      );
    }
  }
  fs.writeFileSync(dst, dstText, 'utf8');
}

function patchIndexHtml() {
  const p = path.join(dstRoot, 'index.html');
  if (!fs.existsSync(p)) return;
  let html = fs.readFileSync(p, 'utf8');
  if (!html.includes('fonts.googleapis.com')) {
    html = html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Sora:wght@300;400;500;600;700&display=swap"
      rel="stylesheet"
    />`
    );
  }
  if (!html.includes('maximum-scale')) {
    html = html.replace(
      'width=device-width, initial-scale=1.0, viewport-fit=cover',
      'width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover'
    );
  }
  fs.writeFileSync(p, html, 'utf8');
  console.log('Patched index.html fonts/viewport');
}

if (!fs.existsSync(dstRoot)) {
  console.error('Target missing:', dstRoot);
  process.exit(1);
}

console.log('Sync WINDAL UI → GFASORCL\n');
for (const f of FILES) copyFile(f);
patchGfasReportMenu();
patchGfasSaleGraphSql();
patchGfasBrand();
patchConnectionConfig();
patchServerApis();
patchSlide6();
patchSlide8();
mergeReportHelp();
patchIndexHtml();
console.log('\nDone. Patch GFASORCL SRC/App.jsx manually or re-run app.jsx patch script.');
