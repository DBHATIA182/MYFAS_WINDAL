/** Main menu modules and report items (Slide 3 dashboard). */

export const REPORT_MENU = [
  {
    id: 'final-accounts',
    index: 1,
    sidebarLabel: 'Financial',
    sidebarIcon: '📊',
    title: 'Final Accounts & Core Financials',
    subtitle: 'Trial, P&L, Balance Sheet',
    tileColor: '#2a4fa8',
    items: [
      { id: 'trial-balance', title: 'Trial Balance', shortTitle: 'Trial Balance', description: 'Balances as of date' },
      { id: 'trial-balance-summary', title: 'Trial Balance Summary', shortTitle: 'TB Summary', description: 'Annexure-wise totals' },
      { id: 'trial-date-wise', title: 'Trial Balance Date Wise', shortTitle: 'TB Date Wise', description: 'Opening, movement, closing' },
      { id: 'trading-ac', title: 'Trading A/C', shortTitle: 'Trading A/C', description: 'Trading account' },
      { id: 'pl-profit-loss', title: 'Profit & Loss', shortTitle: 'P & L', description: 'Profit & loss account' },
      { id: 'balance-sheet', title: 'Balance Sheet', shortTitle: 'Balance Sheet', description: 'Assets & liabilities' },
    ],
  },
  {
    id: 'ledger-reports',
    index: 2,
    sidebarLabel: 'Ledgers',
    sidebarIcon: '📒',
    title: 'Ledger Reports',
    subtitle: 'Account & outstanding',
    tileColor: '#0ca678',
    items: [
      { id: 'ledger', title: 'Ledger Report', shortTitle: 'Ledger', description: 'Account transactions' },
      { id: 'ledger-interest', title: 'Ledger With Interest', shortTitle: 'Ledger + Int.', description: 'Interest calculation' },
      { id: 'customer-ledger', title: 'Customer Ledger', shortTitle: 'Customer Ledger', description: 'Customer bills' },
      {
        id: 'overdue-customers',
        title: 'Overdue Customers',
        shortTitle: 'Overdue Customer',
        description: 'Customers with bills pending over 30 days',
      },
      { id: 'supplier-ledger', title: 'Supplier Ledger', shortTitle: 'Supplier Ledger', description: 'Supplier bills' },
      { id: 'broker-os', title: 'Broker OS', shortTitle: 'Broker OS', description: 'Broker outstanding' },
      { id: 'ageing', title: 'Ageing Report', shortTitle: 'Ageing', description: 'Outstanding by days' },
    ],
  },
  {
    id: 'stock-reports',
    index: 3,
    sidebarLabel: 'Stock',
    sidebarIcon: '📦',
    title: 'Stock Reports',
    subtitle: 'Inventory movement',
    tileColor: '#e67e22',
    items: [
      { id: 'stock-sum', title: 'Stock Sum', shortTitle: 'Stock Summary', description: 'Item movement totals' },
    ],
  },
  {
    id: 'gst-reports',
    index: 4,
    sidebarLabel: 'GST',
    sidebarIcon: '📋',
    title: 'GST Reports',
    subtitle: 'GSTR-1, HSN & state wise',
    tileColor: '#db2777',
    items: [
      { id: 'gstr1', title: 'GSTR-1', shortTitle: 'GSTR-1', description: 'GST return sheets' },
      { id: 'hsn-sales', title: 'HSN Sales', shortTitle: 'HSN Sales', description: 'HSN-wise sales' },
      { id: 'hsn-purchase', title: 'HSN Purchase', shortTitle: 'HSN Purchase', description: 'HSN-wise purchase' },
      { id: 'state-wise-sales', title: 'State Wise Sales', shortTitle: 'State Sales', description: 'Sales by party state & GST%' },
      { id: 'state-wise-purchase', title: 'State Wise Purchase', shortTitle: 'State Purchase', description: 'Purchase by party state & GST%' },
    ],
  },
  {
    id: 'sales-module',
    index: 5,
    sidebarLabel: 'Sales',
    sidebarIcon: '🛒',
    title: 'Sales Module',
    subtitle: 'Orders, bills & charts',
    tileColor: '#7c3aed',
    items: [
      { id: 'sales-order-entry', title: 'Sales Order', shortTitle: 'Sales Order', description: 'SO entry' },
      { id: 'dispatch-challan-entry', title: 'Dispatch Challan', shortTitle: 'Dispatch', description: 'Challan entry' },
      { id: 'sale-bill-entry', title: 'Sale Bill', shortTitle: 'Sale Bill', description: 'Sale bill entry' },
      { id: 'sale-bill-printing', title: 'Sale Bill Printing', shortTitle: 'Sale Print', description: 'Print sale bills' },
      { id: 'sale-list', title: 'Sale Bill List', shortTitle: 'Sale List', description: 'List & filters' },
      { id: 'pending-sales-order', title: 'Pending Sales Order', shortTitle: 'Pending SO', description: 'Open SO qty vs billed/challan' },
      { id: 'pending-dispatch-challan', title: 'Pending Dispatch Challan', shortTitle: 'Pending Ch', description: 'Challan qty not yet sale-billed' },
      { id: 'sale-chart', title: 'Sale Chart', shortTitle: 'Sale Chart', description: 'Month-wise weight & amount by item' },
    ],
  },
  {
    id: 'purchase-module',
    index: 6,
    sidebarLabel: 'Purchase',
    sidebarIcon: '🧾',
    title: 'Purchase Module',
    subtitle: 'PO, GRN, bills',
    tileColor: '#e74c3c',
    items: [
      { id: 'purchase-order-entry', title: 'Purchase Order', shortTitle: 'Purchase Order', description: 'PO entry' },
      { id: 'grn-entry', title: 'Goods Receipt Note', shortTitle: 'GRN', description: 'GRN entry' },
      { id: 'purchase-bill-entry', title: 'Purchase Bill', shortTitle: 'Purchase Bill', description: 'Purchase bill entry' },
      { id: 'purchase-list', title: 'Purchase List', shortTitle: 'Purchase List', description: 'List & filters' },
      { id: 'pending-purchase-order', title: 'Pending Purchase Order', shortTitle: 'Pending PO', description: 'Open PO qty vs GRN/bill' },
    ],
  },
  {
    id: 'voucher-module',
    index: 7,
    sidebarLabel: 'Vouchers',
    sidebarIcon: '💵',
    title: 'Voucher Module',
    subtitle: 'Cash, bank, journal',
    tileColor: '#374151',
    entry: true,
    items: [
      { id: 'voucher-entry', title: 'Cash / Bank / Journal', shortTitle: 'Voucher Entry', description: 'CV, BV, JV' },
      { id: 'voucher-list', title: 'Voucher List', shortTitle: 'Voucher List', description: 'Find vouchers' },
    ],
  },
  {
    id: 'production-module',
    index: 8,
    sidebarLabel: 'Production',
    sidebarIcon: '⚙️',
    title: 'Production Records',
    subtitle: 'Production entry',
    tileColor: '#0f766e',
    entry: true,
    items: [
      { id: 'production-entry', title: 'Production Entry', shortTitle: 'Production', description: 'TYPE PR entry' },
    ],
  },
  {
    id: 'master-module',
    index: 9,
    sidebarLabel: 'Master',
    sidebarIcon: '👤',
    title: 'Master Module',
    subtitle: 'Accounts & items',
    tileColor: '#2563eb',
    entry: true,
    items: [
      { id: 'account-master', title: 'A/c Master', shortTitle: 'A/c Master', description: 'Account master' },
      { id: 'item-master', title: 'Item Master', shortTitle: 'Item Master', description: 'Item master' },
    ],
  },
];

export const HOME_MODULE_ID = '__home__';

/** Popular shortcuts (mixed modules) — shown on Home. */
export const QUICK_ACCESS = [
  { reportId: 'account-master', label: 'A/c Master', icon: '👤', color: '#2563eb' },
  { reportId: 'voucher-entry', label: 'Voucher', icon: '💵', color: '#374151' },
  { reportId: 'purchase-bill-entry', label: 'Purchase Bill', icon: '🧾', color: '#ea580c' },
  { reportId: 'purchase-list', label: 'Purchase List', icon: '📋', color: '#c2410c' },
  { reportId: 'sale-bill-entry', label: 'Sale Bill', icon: '🛒', color: '#dc2626' },
  { reportId: 'sale-bill-printing', label: 'Sale Bill Print', icon: '🖨️', color: '#9333ea' },
  { reportId: 'sale-list', label: 'Sale List', icon: '📑', color: '#b91c1c' },
  { reportId: 'sale-chart', label: 'Sale Chart', icon: '📈', color: '#0d9488' },
  { reportId: 'ledger', label: 'Ledger', icon: '📒', color: '#4f46e5' },
  { reportId: 'customer-ledger', label: 'Customer Ledger', icon: '👥', color: '#0284c7' },
  { reportId: 'overdue-customers', label: 'Overdue Customer', icon: '⏰', color: '#dc2626' },
  { reportId: 'broker-os', label: 'Broker OS', icon: '🤝', color: '#7c3aed' },
  { reportId: 'gstr1', label: 'GSTR-1', icon: '📋', color: '#db2777' },
  { reportId: 'stock-sum', label: 'Stock Summary', icon: '📦', color: '#ca8a04' },
  { reportId: 'trial-balance', label: 'Trial Balance', icon: '⚖️', color: '#0891b2' },
  { reportId: 'item-master', label: 'Item Master', icon: '📁', color: '#059669' },
];

export const FLAT_REPORT_ORDER = REPORT_MENU.flatMap((c) => c.items.map((i) => i.id));

export const REPORT_TO_CATEGORY = Object.fromEntries(
  REPORT_MENU.flatMap((cat) => cat.items.map((item) => [item.id, cat.id]))
);

export function categoryForReport(reportId) {
  return REPORT_TO_CATEGORY[reportId] || REPORT_MENU[0].id;
}

export function findReportItem(reportId) {
  for (const cat of REPORT_MENU) {
    const item = cat.items.find((i) => i.id === reportId);
    if (item) return { ...item, category: cat };
  }
  return null;
}
