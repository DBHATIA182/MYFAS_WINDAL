import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SessionInfoLine from '../components/SessionInfoLine';

/** Grouped report / module menu (order matches business workflow). */
const REPORT_MENU = [
  {
    id: 'final-accounts',
    index: 1,
    title: 'Final Accounts & Core Financials',
    subtitle: 'Trial, P&L, Balance Sheet',
    items: [
      { id: 'trial-balance', title: 'Trial Balance Report', description: 'View account balances as of a specific date' },
      { id: 'trading-ac', title: 'Trading A/C', description: 'Trading account with schedule, shortage, and closing stock options' },
      { id: 'pl-profit-loss', title: 'Profit & Loss Account', description: 'Gross from Trading A/C plus schedule ≥ 16 ledger balances (VFP PLACT)' },
      { id: 'balance-sheet', title: 'Balance Sheet', description: 'Liabilities vs Assets with profit/loss and closing stock adjustments' },
    ],
  },
  {
    id: 'ledger-reports',
    index: 2,
    title: 'Ledger Reports',
    subtitle: 'Account, party & outstanding analysis',
    items: [
      { id: 'ledger', title: 'Ledger Report', description: 'Detailed transactions for a specific account' },
      { id: 'ledger-interest', title: 'Ledger With Interest', description: 'Ledger with Dr/Cr interest using rate, grace days, and interest date' },
      { id: 'customer-ledger', title: 'Customer Ledger', description: 'Customer bills with running balance per bill (DR − CR)' },
      { id: 'supplier-ledger', title: 'Supplier Ledger', description: 'Supplier bills with running balance per bill (CR − DR)' },
      { id: 'broker-os', title: 'Broker OS (Outstanding)', description: 'Broker-wise outstanding; bills linked via S / SE / PU' },
      { id: 'ageing', title: 'Ageing Report', description: 'Schedule-wise outstanding in configurable day ranges' },
    ],
  },
  {
    id: 'stock-reports',
    index: 3,
    title: 'Stock Reports',
    subtitle: 'Inventory & HSN tax tracking',
    items: [
      { id: 'stock-sum', title: 'Stock Sum', description: 'Stock movement summary with item totals and grand total' },
      { id: 'hsn-sales', title: 'HSN Sales', description: 'HSN-wise sales: date wise, monthly HSN wise, and HSN wise monthly' },
      { id: 'hsn-purchase', title: 'HSN Purchase', description: 'HSN-wise purchase with the same tab layout as HSN sales' },
    ],
  },
  {
    id: 'sales-module',
    index: 4,
    title: 'Sales Module',
    subtitle: 'Printing, lists & GST returns',
    items: [
      { id: 'sale-bill-printing', title: 'Sale Bill Printing', description: 'Find bills and open printable sale bill' },
      { id: 'sale-list', title: 'Sale Bill List', description: 'Sale bill list with TYPE, dates, party, broker, item, and filters' },
      { id: 'gstr1', title: 'GSTR-1 (Sheet-wise)', description: 'GSTR-1 on screen, PDF, and Excel (B2B, B2CL, HSN, DOCS, etc.)' },
    ],
  },
  {
    id: 'sales-entry',
    index: 5,
    title: 'Sales Entry Module',
    subtitle: 'Order → challan → bill',
    entry: true,
    items: [
      { id: 'sales-order-entry', title: 'Sales Order', description: 'Add, edit, or delete sales orders (SORDER type SO)' },
      { id: 'dispatch-challan-entry', title: 'Dispatch Challan', description: 'Dispatch challans (ISSUE type S); pending SO on lines' },
      { id: 'sale-bill-entry', title: 'Sale Bill', description: 'Sale bills; posts SALE, LEDGER, STOCK, and BILLS' },
    ],
  },
  {
    id: 'purchase-module',
    index: 6,
    title: 'Purchase Module',
    subtitle: 'Purchase documents',
    items: [
      { id: 'purchase-order-entry', title: 'Purchase Order', description: 'Add, edit, or delete purchase orders (SORDER type PO)' },
      { id: 'purchase-bill-entry', title: 'Purchase Bill', description: 'Add, edit, or delete purchase bills (PURCHASE type PU); posts stock & ledger' },
      { id: 'purchase-list', title: 'Purchase List', description: 'PURCHASE lines (PU, DN) with filters; DN shown as negative' },
    ],
  },
  {
    id: 'voucher-module',
    index: 7,
    title: 'Voucher Module',
    subtitle: 'Cash, bank & journal',
    entry: true,
    items: [
      {
        id: 'voucher-entry',
        title: 'Cash / Bank / Journal Entry',
        description: 'Add, edit, or delete CV, BV, and JV vouchers; posts VOUCHER, LEDGER, and BILLS',
      },
      { id: 'voucher-list', title: 'Cash / Bank / Journal Voucher List', description: 'Vouchers with date range, party, cash/bank code, Dr/Cr filter' },
    ],
  },
  {
    id: 'master-module',
    index: 8,
    title: 'Master Module',
    subtitle: 'Account & item maintenance',
    entry: true,
    items: [
      {
        id: 'account-master',
        title: 'A/c Master',
        description: 'Add, edit, or delete accounts in MASTER (party, broker, supplier, etc.)',
      },
      {
        id: 'item-master',
        title: 'Item Master',
        description: 'Add, edit, or delete items in ITEMMAST with sale/purchase GL codes',
      },
    ],
  },
];

const FLAT_REPORT_ORDER = REPORT_MENU.flatMap((c) => c.items.map((i) => i.id));

const REPORT_TO_CATEGORY = Object.fromEntries(
  REPORT_MENU.flatMap((cat) => cat.items.map((item) => [item.id, cat.id]))
);

function categoryForReport(reportId) {
  return REPORT_TO_CATEGORY[reportId] || REPORT_MENU[0].id;
}

function ReportOption({ id, selected, title, description, entry, onSelect }) {
  const pick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(id);
  };
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`report-option${selected ? ' selected' : ''}${entry ? ' report-option--entry' : ''}`}
      onClick={pick}
    >
      <span className="report-option__bullet" aria-hidden="true">
        {selected ? '●' : '○'}
      </span>
      <span className="report-option__text">
        <span className="report-option__title">{title}</span>
        {description ? <span className="report-option__desc">{description}</span> : null}
      </span>
    </button>
  );
}

function ReportBucket({ category, expanded, onToggle, children }) {
  const panelId = `report-bucket-${category.id}`;
  return (
    <section
      className={`report-bucket${expanded ? ' report-bucket--open' : ''}`}
      data-category={category.id}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        type="button"
        className="report-bucket-head"
        onClick={() => onToggle(category.id)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="report-bucket-head__index" aria-hidden="true">
          {category.index}
        </span>
        <span className="report-bucket-head__text">
          <span className="report-bucket-head__title">{category.title}</span>
          {category.subtitle ? <span className="report-bucket-head__subtitle">{category.subtitle}</span> : null}
        </span>
        <span className="report-bucket-head__meta">
          <span className="report-bucket-head__count">{category.items.length}</span>
          <span className="report-bucket-head__chevron" aria-hidden="true" />
        </span>
      </button>
      {expanded ? (
        <div id={panelId} className="report-bucket-body" role="group" aria-label={category.title}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

export default function Slide3({ onPrev, onNext, formData }) {
  const [reportType, setReportType] = useState('trial-balance');
  const [expandedBuckets, setExpandedBuckets] = useState(() => new Set());
  const reportMenuRef = useRef(null);

  const ensureBucketOpen = useCallback((reportId) => {
    const catId = categoryForReport(reportId);
    setExpandedBuckets(new Set([catId]));
  }, []);

  const openReport = useCallback(
    (id) => {
      setReportType(id);
      ensureBucketOpen(id);
      onNext({ reportType: id });
    },
    [ensureBucketOpen, onNext]
  );

  const toggleBucket = useCallback((categoryId) => {
    setExpandedBuckets((prev) => {
      if (prev.has(categoryId) && prev.size === 1) return new Set();
      return new Set([categoryId]);
    });
  }, []);

  const moveReportSelection = useCallback(
    (delta) => {
      const idx = FLAT_REPORT_ORDER.indexOf(reportType);
      const current = idx >= 0 ? idx : 0;
      const nextIdx = (current + delta + FLAT_REPORT_ORDER.length) % FLAT_REPORT_ORDER.length;
      const nextId = FLAT_REPORT_ORDER[nextIdx];
      setReportType(nextId);
      ensureBucketOpen(nextId);
    },
    [reportType, ensureBucketOpen]
  );

  const handleMenuKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onNext({ reportType });
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      moveReportSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      moveReportSelection(-1);
    }
  };

  useEffect(() => {
    const onDocKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (document.body.classList.contains('report-help-open')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveReportSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveReportSelection(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onNext({ reportType });
      }
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [moveReportSelection, onNext, reportType]);

  useEffect(() => {
    const root = reportMenuRef.current;
    if (!root) return;
    const selected = root.querySelector('.report-option.selected');
    if (selected?.scrollIntoView) selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [reportType, expandedBuckets]);

  useEffect(() => {
    if (expandedBuckets.size !== 1) return;
    const catId = [...expandedBuckets][0];
    const root = reportMenuRef.current;
    const section = root?.querySelector(`[data-category="${catId}"]`);
    if (section?.scrollIntoView) section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [expandedBuckets]);

  const collapseAll = () => setExpandedBuckets(new Set());

  const hasExpandedSection = expandedBuckets.size > 0;

  const selectedMeta = useMemo(() => {
    for (const cat of REPORT_MENU) {
      const item = cat.items.find((i) => i.id === reportType);
      if (item) return { category: cat.title, item: item.title };
    }
    return null;
  }, [reportType]);

  return (
    <div className="slide slide-3">
      <SessionInfoLine
        formData={formData}
        helpReportId="reports-menu"
        helpShowFullGuidePdf
        helpLabel="Menu help"
      />

      <header className="slide-3-menu-header">
        <h2 className="slide-3-menu-header__title">Reports &amp; Modules</h2>
        <p className="slide-3-menu-header__hint">Open a module, then click a report to run it (Next is optional)</p>
        {selectedMeta ? (
          <p className="slide-3-menu-header__selection">
            <span className="slide-3-menu-header__selection-label">Selected</span>
            {selectedMeta.item}
            <span className="slide-3-menu-header__selection-cat">· {selectedMeta.category}</span>
          </p>
        ) : null}
        <div className="slide-3-menu-help">
          {hasExpandedSection ? (
            <button type="button" className="slide-3-menu-toolbar__btn" onClick={collapseAll}>
              Collapse section
            </button>
          ) : null}
        </div>
      </header>

      <div
        ref={reportMenuRef}
        className="report-options report-options--bucketed"
        onKeyDown={handleMenuKeyDown}
        aria-label="Reports and modules menu"
      >
        {REPORT_MENU.map((category) => (
          <ReportBucket
            key={category.id}
            category={category}
            expanded={expandedBuckets.has(category.id)}
            onToggle={toggleBucket}
          >
            {category.items.map((item) => (
              <ReportOption
                key={item.id}
                id={item.id}
                selected={reportType === item.id}
                title={item.title}
                description={item.description}
                entry={Boolean(category.entry)}
                onSelect={openReport}
              />
            ))}
          </ReportBucket>
        ))}
      </div>

      <div className="button-group">
        <button type="button" onClick={onPrev} className="btn btn-secondary">
          ← Back
        </button>
        <button type="button" onClick={() => onNext({ reportType })} className="btn btn-primary">
          Next →
        </button>
      </div>
    </div>
  );
}
