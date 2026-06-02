/** GFASORCL menu — copied to E:/GFASORCL/APPTEST/SRC/data/reportMenuConfig.js by sync script. */
module.exports = `/** GFASORCL main menu — original reports only, plus Sale Chart & Overdue Customers. */

export const REPORT_MENU = [
  {
    id: 'final-accounts',
    index: 1,
    sidebarLabel: 'Financial',
    sidebarIcon: '📊',
    title: 'Final Accounts',
    subtitle: 'Trial, P&L, Balance Sheet',
    tileColor: '#2a4fa8',
    items: [
      { id: 'trial-balance', title: 'Trial Balance', shortTitle: 'Trial Balance', description: 'Balances as of date' },
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
    subtitle: 'Inventory & HSN',
    tileColor: '#e67e22',
    items: [
      { id: 'stock-sum', title: 'Stock Sum', shortTitle: 'Stock Summary', description: 'Item movement totals' },
      { id: 'stock-lot', title: 'Stock Lot Wise', shortTitle: 'Stock Lot', description: 'Lot-wise stock' },
      { id: 'hsn-sales', title: 'HSN Sales', shortTitle: 'HSN Sales', description: 'HSN-wise sales' },
      { id: 'hsn-purchase', title: 'HSN Purchase', shortTitle: 'HSN Purchase', description: 'HSN-wise purchase' },
    ],
  },
  {
    id: 'sales-module',
    index: 4,
    sidebarLabel: 'Sales',
    sidebarIcon: '🛒',
    title: 'Sales',
    subtitle: 'Bills, list, GSTR-1',
    tileColor: '#7c3aed',
    items: [
      { id: 'sale-bill-printing', title: 'Sale Bill Printing', shortTitle: 'Sale Print', description: 'Print sale bills' },
      { id: 'sale-list', title: 'Sale Bill List', shortTitle: 'Sale List', description: 'List & filters' },
      {
        id: 'sale-chart',
        title: 'Sale Chart',
        shortTitle: 'Sale Chart',
        description: 'Month-wise weight & amount by item',
      },
      { id: 'gstr1', title: 'GSTR-1', shortTitle: 'GSTR-1', description: 'GST return sheets' },
    ],
  },
  {
    id: 'purchase-module',
    index: 5,
    sidebarLabel: 'Purchase',
    sidebarIcon: '🧾',
    title: 'Purchase',
    subtitle: 'Purchase list',
    tileColor: '#e74c3c',
    items: [
      { id: 'purchase-list', title: 'Purchase List', shortTitle: 'Purchase List', description: 'List & filters' },
    ],
  },
  {
    id: 'voucher-module',
    index: 6,
    sidebarLabel: 'Vouchers',
    sidebarIcon: '💵',
    title: 'Vouchers',
    subtitle: 'Voucher list',
    tileColor: '#374151',
    items: [
      { id: 'voucher-list', title: 'Voucher List', shortTitle: 'Voucher List', description: 'Find vouchers' },
    ],
  },
];

export const HOME_MODULE_ID = '__home__';

export const QUICK_ACCESS = [
  { reportId: 'trial-balance', label: 'Trial Balance', icon: '⚖️', color: '#0891b2' },
  { reportId: 'sale-list', label: 'Sale List', icon: '📑', color: '#b91c1c' },
  { reportId: 'sale-chart', label: 'Sale Chart', icon: '📈', color: '#0d9488' },
  { reportId: 'customer-ledger', label: 'Customer Ledger', icon: '👥', color: '#0284c7' },
  { reportId: 'overdue-customers', label: 'Overdue Customer', icon: '⏰', color: '#dc2626' },
  { reportId: 'ledger', label: 'Ledger', icon: '📒', color: '#4f46e5' },
  { reportId: 'stock-sum', label: 'Stock Summary', icon: '📦', color: '#ca8a04' },
  { reportId: 'stock-lot', label: 'Stock Lot', icon: '📊', color: '#d97706' },
  { reportId: 'gstr1', label: 'GSTR-1', icon: '📋', color: '#db2777' },
  { reportId: 'broker-os', label: 'Broker OS', icon: '🤝', color: '#7c3aed' },
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
`;
