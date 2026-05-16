/** In-app and PDF user help for reports and modules. */

export const APP_HELP_NAMES = {
  windal: 'Windal Accounting',
  gfasorcl: 'GFASORCL Accounting',
};

function section(title, bullets) {
  return { title, bullets: bullets.filter(Boolean) };
}

export const REPORT_HELP = {
  'reports-menu': {
    title: 'Reports & Modules',
    summary: 'Main menu after you select company and financial year.',
    sections: [
      section('How to open a report', [
        'All modules start collapsed.',
        'Click a module header (1–7) to expand it — only one module stays open at a time.',
        'Click a report name to open it immediately (Next is optional).',
        'Use ↑ / ↓ to highlight a report, then Enter to open it.',
      ]),
      section('Modules', [
        '1 Final Accounts — Trial Balance, Trading A/C, P&L, Balance Sheet',
        '2 Ledger — Account ledger, interest ledger, customer/supplier/broker, ageing',
        '3 Stock — Stock sum, HSN sales/purchase (and Stock Lot on some installs)',
        '4 Sales — Bill printing, sale list, GSTR-1',
        '5 Sales Entry — Order, dispatch challan, sale bill (where enabled)',
        '6 Purchase — Purchase list',
        '7 Voucher — Cash / bank / journal voucher list',
      ]),
    ],
  },

  'trial-balance': {
    title: 'Trial Balance',
    summary: 'Account balances as of a date, with optional schedule filter.',
    sections: [
      section('Parameters', [
        'Set As-of (ending) date — required.',
        'Schedule: 0 = all schedules; or enter a schedule number to filter.',
        'Run Report to load balances.',
      ]),
      section('On the report', [
        'Each row is an account with opening, debit, credit, and closing balances.',
        'Export: Pdf, Excel, or WhatsApp from the toolbar.',
      ]),
      section('Drill-down (important)', [
        'Click any account row → opens Ledger for that account (full financial year from company dates).',
        'On Ledger: click a transaction row → opens full Voucher (all ledger lines for that voucher).',
        'On some ledger lines: Sale Bill print may open when the voucher is mapped to a sale bill.',
        'Use ← Back to return: Voucher → Ledger → Trial Balance.',
      ]),
    ],
    views: {
      ledger: {
        title: 'Ledger (from Trial Balance)',
        bullets: [
          'Opened from a trial row; period is company FY start to end.',
          'Click a line to see voucher detail; sale bill icon/click where available.',
          '← Back to Trial Balance returns to the trial list.',
        ],
      },
      voucher: {
        title: 'Voucher detail',
        bullets: [
          'Shows all ledger lines for one voucher (type, date, number).',
          '← Back returns to the ledger you came from.',
        ],
      },
    },
  },

  ledger: {
    title: 'Ledger Report',
    summary: 'Detailed transactions for one account over a date range.',
    sections: [
      section('Parameters', [
        'Pick account (code/name search), start and end dates, then Run.',
      ]),
      section('On screen', [
        'Running balance after each line; Dr/Cr amounts and voucher references.',
        'Click a row → Voucher detail for that voucher.',
        'Sale bill print on supported lines.',
        'Pdf / Excel / WhatsApp from toolbar.',
      ]),
    ],
    views: {
      voucher: {
        title: 'Voucher (from Ledger)',
        bullets: ['Full voucher lines. ← Back returns to ledger.'],
      },
    },
  },

  'ledger-interest': {
    title: 'Ledger With Interest',
    summary: 'Same as ledger plus interest columns (rate, grace days, interest date).',
    sections: [
      section('Use', [
        'Set interest rate, grace days, and interest calculation date on the form.',
        'Dr/Cr interest columns appear on the ledger grid.',
        'Click rows for voucher detail like standard ledger.',
      ]),
    ],
  },

  'customer-ledger': {
    title: 'Customer Ledger',
    summary: 'Customer bills with balance per bill (DR − CR).',
    sections: [
      section('Use', [
        'Filter by customer, dates, and options on the form.',
        'Click a bill row where enabled → bill ledger / voucher / sale bill flows.',
        'Export from toolbar when the report is shown.',
      ]),
    ],
  },

  'supplier-ledger': {
    title: 'Supplier Ledger',
    summary: 'Supplier bills with balance per bill (CR − DR).',
    sections: [
      section('Use', [
        'Similar to customer ledger for suppliers.',
        'Drill to detail rows where the screen allows clicks.',
      ]),
    ],
  },

  'broker-os': {
    title: 'Broker OS (Outstanding)',
    summary: 'Broker-wise outstanding from linked sale/purchase bills.',
    sections: [
      section('Use', [
        'Set broker range and as-on date.',
        'Review outstanding per broker; export Pdf/Excel/WhatsApp.',
      ]),
    ],
  },

  ageing: {
    title: 'Ageing Report',
    summary: 'Outstanding in ageing buckets by schedule and day ranges.',
    sections: [
      section('Use', [
        'Choose Ledger or Bills basis, schedules, and bucket days.',
        'Expand rows for party/detail where the grid allows.',
      ]),
    ],
  },

  'stock-sum': {
    title: 'Stock Sum',
    summary: 'Item-wise stock movement and totals.',
    sections: [
      section('Drill-down', [
        'Run with date, godown, and filters.',
        'Click an item row → item detail / lot movement (where implemented).',
        'Further clicks may open stock ledger or entry detail screens.',
      ]),
    ],
  },

  'stock-lot': {
    title: 'Stock Lot Wise',
    summary: 'LOTSTOCK lot-wise position with filters.',
    sections: [
      section('Use', [
        'Filter godown, item, supplier, lot, cost, Complete/Outstanding.',
        'Click rows for lot detail when available.',
      ]),
    ],
  },

  'hsn-sales': {
    title: 'HSN Sales',
    summary: 'HSN-wise GST sales in tabs (date wise, monthly, etc.).',
    sections: [
      section('Use', [
        'Set date range and run.',
        'Switch tabs for different HSN layouts; export from toolbar.',
      ]),
    ],
  },

  'hsn-purchase': {
    title: 'HSN Purchase',
    summary: 'HSN-wise purchase — same tab idea as HSN sales.',
    sections: [
      section('Use', ['Set dates, run report, use tabs and exports.']),
    ],
  },

  'sale-bill-printing': {
    title: 'Sale Bill Printing',
    summary: 'Find sale bills and open print layout.',
    sections: [
      section('Use', [
        'Search by bill no, party, type, or filters on the form.',
        'Click a row in the list → printable sale bill opens.',
      ]),
    ],
  },

  'sale-list': {
    title: 'Sale Bill List',
    summary: 'Filtered list of sale bills (VFP-style filters).',
    sections: [
      section('Use', [
        'Set TYPE, dates, party, broker, item, plant, etc.',
        'Run list; export Pdf/Excel/WhatsApp.',
        'Click rows only where drill-down is enabled on that screen.',
      ]),
    ],
  },

  gstr1: {
    title: 'GSTR-1',
    summary: 'GST return sheets B2B, B2CL, B2CS, CDNR, exports, HSN, DOCS.',
    sections: [
      section('Use', [
        'Enter period and generate.',
        'Use sheet tabs; export PDF and Excel from toolbar.',
      ]),
    ],
  },

  'sales-order-entry': {
    title: 'Sales Order Entry',
    summary: 'Add, edit, delete sales orders (SORDER type SO).',
    sections: [
      section('Use', [
        'F12 permissions: open/add/edit/delete from your user rights.',
        'Enter party, lines, manual SO number on add; Prev/Next/List/Print on toolbar.',
        'List screen: Pdf, Excel, WhatsApp.',
      ]),
    ],
  },

  'dispatch-challan-entry': {
    title: 'Dispatch Challan Entry',
    summary: 'Dispatch challans (ISSUE type S).',
    sections: [
      section('Use', [
        'Party schedule 11.20; pick pending SO on lines where shown.',
        'Manual challan number on add; save posts issue stock.',
        'List and print screens from action bar.',
      ]),
    ],
  },

  'sale-bill-entry': {
    title: 'Sale Bill Entry',
    summary: 'Sale bills posting SALE, LEDGER, STOCK, BILLS.',
    sections: [
      section('Use', [
        'Add/edit/delete per permissions.',
        'Manual bill no on add; print after save from entry or list.',
      ]),
    ],
  },

  'purchase-list': {
    title: 'Purchase List',
    summary: 'PU/DN purchase lines with filters.',
    sections: [
      section('Use', [
        'DN values show negative.',
        'Filter supplier, item, codes; export from report toolbar.',
        'Click purchase bill print where row action exists.',
      ]),
    ],
  },

  'voucher-list': {
    title: 'Voucher List',
    summary: 'Cash, bank, and journal vouchers in a date range.',
    sections: [
      section('Use', [
        'Set dates, party, cash/bank code, Dr/Cr filter.',
        'Click a row → voucher detail lines.',
        '← Back returns to list.',
      ]),
    ],
    views: {
      voucher: {
        title: 'Voucher detail (from list)',
        bullets: ['All lines for selected voucher. ← Back to list.'],
      },
    },
  },

  'trading-ac': {
    title: 'Trading A/C',
    summary: 'Trading account with sales, purchases, shortages, closing stock.',
    sections: [
      section('Drill-down', [
        'Run with schedule, account, ending date, shortage/closing options.',
        'Click amounts or account rows where highlighted → ledger or detail.',
        'Use ← Back on each nested screen.',
      ]),
    ],
  },

  'pl-profit-loss': {
    title: 'Profit & Loss',
    summary: 'P&L from trading gross plus schedule ≥ 16 balances.',
    sections: [
      section('Use', [
        'Set as-on date and run.',
        'Click ledger-linked rows where enabled → account ledger.',
      ]),
    ],
  },

  'balance-sheet': {
    title: 'Balance Sheet',
    summary: 'Assets vs liabilities with P&L and stock adjustments.',
    sections: [
      section('Drill-down', [
        'Tree of schedules and accounts as on date.',
        'Click account rows → ledger for that account.',
        'From ledger → voucher on line click (same as trial flow).',
      ]),
    ],
  },
};

const PDF_ORDER = [
  'reports-menu',
  'trial-balance',
  'ledger',
  'ledger-interest',
  'customer-ledger',
  'supplier-ledger',
  'broker-os',
  'ageing',
  'stock-sum',
  'stock-lot',
  'hsn-sales',
  'hsn-purchase',
  'sale-bill-printing',
  'sale-list',
  'gstr1',
  'sales-order-entry',
  'dispatch-challan-entry',
  'sale-bill-entry',
  'purchase-list',
  'voucher-list',
  'trading-ac',
  'pl-profit-loss',
  'balance-sheet',
];

export function getReportHelp(reportId, viewKey) {
  const base = REPORT_HELP[reportId] || {
    title: 'Report',
    summary: 'Use the form to set filters, then run the report.',
    sections: [section('Tips', ['Use toolbar ← Back to return.', 'Use 🏠 Home to return to the menu.'])],
  };
  const extra = viewKey && base.views?.[viewKey];
  if (!extra) return base;
  return {
    ...base,
    sections: [...base.sections, section(extra.title, extra.bullets)],
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSectionsHtml(sections) {
  return (sections || [])
    .map(
      (sec) => `
      <div class="ug-section">
        <h3>${escapeHtml(sec.title)}</h3>
        <ul>${(sec.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      </div>`
    )
    .join('');
}

export function buildUserGuideHtml({ companyName = '', appName = 'Windal Accounting', includeReportIds } = {}) {
  const ids = includeReportIds || PDF_ORDER;
  const blocks = ids
    .filter((id) => REPORT_HELP[id])
    .map((id) => {
      const h = REPORT_HELP[id];
      return `
        <div class="ug-report">
          <h2>${escapeHtml(h.title)}</h2>
          <p class="ug-summary">${escapeHtml(h.summary)}</p>
          ${renderSectionsHtml(h.sections)}
        </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(appName)} — User Guide</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1e293b; margin: 0; padding: 16px 20px; }
    h1 { font-size: 18pt; color: #1e3a8a; margin: 0 0 8px; }
    .ug-meta { font-size: 9.5pt; color: #64748b; margin-bottom: 20px; }
    .ug-intro { background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 14px; border-radius: 8px; margin-bottom: 22px; }
    .ug-report { page-break-inside: avoid; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; }
    .ug-report h2 { font-size: 13pt; color: #3349d1; margin: 0 0 6px; }
    .ug-summary { margin: 0 0 8px; font-size: 10pt; color: #475569; }
    .ug-section h3 { font-size: 10.5pt; margin: 10px 0 4px; color: #0f172a; }
    .ug-section ul { margin: 0 0 8px; padding-left: 18px; }
    .ug-section li { margin-bottom: 4px; line-height: 1.35; }
    .ug-flow { font-weight: 600; color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>${escapeHtml(appName)} — Reports User Guide</h1>
  <p class="ug-meta">${companyName ? escapeHtml(companyName) + ' · ' : ''}Generated ${escapeHtml(new Date().toLocaleString())}</p>
  <div class="ug-intro">
    <p><span class="ug-flow">Common navigation:</span> Trial Balance → click account → <strong>Ledger</strong> → click line → <strong>Voucher</strong>. Use ← Back on each screen. Many other reports use similar click-through where rows are highlighted.</p>
    <p>On each screen, tap the <strong>?</strong> help button for a short guide. This PDF lists all modules in depth.</p>
  </div>
  ${blocks}
</body>
</html>`;
}

export function getPdfReportIdsForApp({ includeSalesEntry = true, includeStockLot = false } = {}) {
  return PDF_ORDER.filter((id) => {
    if (!includeSalesEntry && (id === 'sales-order-entry' || id === 'dispatch-challan-entry' || id === 'sale-bill-entry')) {
      return false;
    }
    if (!includeStockLot && id === 'stock-lot') return false;
    return Boolean(REPORT_HELP[id]);
  });
}
