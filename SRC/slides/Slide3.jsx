import React, { useEffect, useRef, useState } from 'react';

const SALES_MODULE_ID = '__sales-module__';

const SALES_REPORT_ORDER = ['sales-order-entry', 'dispatch-challan-entry', 'sale-bill-entry'];

const MAIN_REPORT_ORDER = [
  'trial-balance',
  'ledger',
  'ledger-interest',
  'customer-ledger',
  'supplier-ledger',
  'broker-os',
  'sale-bill-printing',
  'sale-list',
  'stock-sum',
  'ageing',
  'purchase-list',
  'voucher-list',
  'gstr1',
  'hsn-sales',
  'hsn-purchase',
  'trading-ac',
  'pl-profit-loss',
  'balance-sheet',
  SALES_MODULE_ID,
];

function ReportOption({ id, selected, title, description, onSelect }) {
  return (
    <div className={`report-option ${selected ? 'selected' : ''}`} onClick={() => onSelect(id)}>
      <input type="radio" name="reportType" value={id} checked={selected} onChange={() => onSelect(id)} />
      <label>
        <h3>{title}</h3>
        <p>{description}</p>
      </label>
    </div>
  );
}

export default function Slide3({ onPrev, onNext, formData }) {
  const [menuView, setMenuView] = useState('main');
  const [reportType, setReportType] = useState('trial-balance');
  const reportMenuRef = useRef(null);

  const activeReportOrder = menuView === 'sales' ? SALES_REPORT_ORDER : MAIN_REPORT_ORDER;

  const openSalesModule = () => {
    setMenuView('sales');
    if (!SALES_REPORT_ORDER.includes(reportType)) {
      setReportType('sales-order-entry');
    }
  };

  const moveReportSelection = (delta) => {
    const order = activeReportOrder;
    let currentId = reportType;
    if (menuView === 'main' && currentId === SALES_MODULE_ID) {
      /* keep */
    } else if (menuView === 'sales' && !order.includes(currentId)) {
      currentId = order[0];
    } else if (menuView === 'main' && !order.includes(currentId)) {
      currentId = order[0];
    }
    const idx = order.indexOf(currentId);
    const current = idx >= 0 ? idx : 0;
    const next = (current + delta + order.length) % order.length;
    setReportType(order[next]);
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      moveReportSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      moveReportSelection(-1);
    } else if (e.key === 'Enter') {
      if (menuView === 'main' && reportType === SALES_MODULE_ID) {
        e.preventDefault();
        e.stopPropagation();
        openSalesModule();
      }
    }
  };

  useEffect(() => {
    const el = reportMenuRef.current;
    if (el && typeof el.focus === 'function') {
      el.focus();
    }

    const onDocKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveReportSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveReportSelection(-1);
      } else if (e.key === 'Enter') {
        if (menuView === 'main' && reportType === SALES_MODULE_ID) {
          e.preventDefault();
          openSalesModule();
        }
      }
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [reportType, menuView]);

  useEffect(() => {
    const root = reportMenuRef.current;
    if (!root) return;
    const selected = root.querySelector('.report-option.selected');
    if (selected && typeof selected.scrollIntoView === 'function') {
      selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [reportType, menuView]);

  const handleNext = () => {
    if (menuView === 'main' && reportType === SALES_MODULE_ID) {
      openSalesModule();
      return;
    }
    if (menuView === 'sales') {
      onNext({ reportType });
      return;
    }
    onNext({ reportType });
  };

  const handleBack = () => {
    if (menuView === 'sales') {
      setMenuView('main');
      setReportType(SALES_MODULE_ID);
      return;
    }
    onPrev();
  };

  const selectReport = (id) => {
    if (id === SALES_MODULE_ID) {
      openSalesModule();
      return;
    }
    setReportType(id);
  };

  return (
    <div className="slide slide-3">
      <p className="company-info">
        {formData.comp_name} | {formData.comp_year}
      </p>

      {menuView === 'sales' ? (
        <p className="report-submenu-title">Sales Module</p>
      ) : null}

      <div
        ref={reportMenuRef}
        className={`report-options${menuView === 'sales' ? ' report-options--sales' : ''}`}
        tabIndex={0}
        onKeyDown={handleMenuKeyDown}
        aria-label={menuView === 'sales' ? 'Sales module menu' : 'Report type menu'}
      >
        {menuView === 'sales' ? (
          <div className="report-options-sales">
            <p className="report-submenu-head">Choose: Sales Order, Dispatch Challan, or Sale Bill</p>
            <ReportOption
              id="sales-order-entry"
              selected={reportType === 'sales-order-entry'}
              title="Sales Order"
              description="Add, edit, or delete sales orders (SORDER type SO); F12 permissions; manual SO number."
              onSelect={selectReport}
            />
            <ReportOption
              id="dispatch-challan-entry"
              selected={reportType === 'dispatch-challan-entry'}
              title="Dispatch Challan"
              description="Add, edit, or delete dispatch challans (ISSUE type S); party schedule 11.20, pending SO pick on lines."
              onSelect={selectReport}
            />
            <ReportOption
              id="sale-bill-entry"
              selected={reportType === 'sale-bill-entry'}
              title="Sale Bill"
              description="Add, edit, or delete sale bills; posts SALE, LEDGER, STOCK, and BILLS. Print from entry after save."
              onSelect={selectReport}
            />
          </div>
        ) : (
        <div className="report-options-main">
        <div
          className={`report-option ${reportType === 'trial-balance' ? 'selected' : ''}`}
          onClick={() => setReportType('trial-balance')}
        >
          <input
            type="radio"
            name="reportType"
            value="trial-balance"
            checked={reportType === 'trial-balance'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Trial Balance Report</h3>
            <p>View account balances as of a specific date</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'ledger' ? 'selected' : ''}`}
          onClick={() => setReportType('ledger')}
        >
          <input
            type="radio"
            name="reportType"
            value="ledger"
            checked={reportType === 'ledger'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Ledger Report</h3>
            <p>View detailed transactions for a specific account</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'ledger-interest' ? 'selected' : ''}`}
          onClick={() => setReportType('ledger-interest')}
        >
          <input
            type="radio"
            name="reportType"
            value="ledger-interest"
            checked={reportType === 'ledger-interest'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Ledger With Interest</h3>
            <p>Ledger with Dr/Cr interest columns using rate, grace days, and interest calculation date</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'customer-ledger' ? 'selected' : ''}`}
          onClick={() => setReportType('customer-ledger')}
        >
          <input
            type="radio"
            name="reportType"
            value="customer-ledger"
            checked={reportType === 'customer-ledger'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>CustomerLedger</h3>
            <p>Customer bills with running balance per bill (DR - CR)</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'supplier-ledger' ? 'selected' : ''}`}
          onClick={() => setReportType('supplier-ledger')}
        >
          <input
            type="radio"
            name="reportType"
            value="supplier-ledger"
            checked={reportType === 'supplier-ledger'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>SupplierLedger</h3>
            <p>Supplier bills with running balance per bill (CR - DR)</p>
          </label>
        </div>

        <div 
          className={`report-option ${reportType === 'broker-os' ? 'selected' : ''}`}
          onClick={() => setReportType('broker-os')}
        >
          <input
            type="radio"
            name="reportType"
            value="broker-os"
            checked={reportType === 'broker-os'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>BrokerOs</h3>
            <p>Broker-wise outstanding (numeric B_CODE range, bills linked via S / SE / PU)</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'sale-bill-printing' ? 'selected' : ''}`}
          onClick={() => setReportType('sale-bill-printing')}
        >
          <input
            type="radio"
            name="reportType"
            value="sale-bill-printing"
            checked={reportType === 'sale-bill-printing'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Sale Bill Printing</h3>
            <p>Find bills by TYPE/bill fields or party search, then click a row to open printable sale bill</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'sale-list' ? 'selected' : ''}`}
          onClick={() => setReportType('sale-list')}
        >
          <input
            type="radio"
            name="reportType"
            value="sale-list"
            checked={reportType === 'sale-list'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Sale bill list</h3>
            <p>VFP sale bill list: numeric SALE.TYPE 1–9, dates, bill range, party, broker (11.20), item, plant, marka, B type</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'stock-sum' ? 'selected' : ''}`}
          onClick={() => setReportType('stock-sum')}
        >
          <input
            type="radio"
            name="reportType"
            value="stock-sum"
            checked={reportType === 'stock-sum'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Stock sum</h3>
            <p>Stock movement summary with item totals and grand total</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'ageing' ? 'selected' : ''}`}
          onClick={() => setReportType('ageing')}
        >
          <input
            type="radio"
            name="reportType"
            value="ageing"
            checked={reportType === 'ageing'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Ageing report</h3>
            <p>Schedule-wise outstanding grouped into configurable day ranges from Ledger or Bills</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'purchase-list' ? 'selected' : ''}`}
          onClick={() => setReportType('purchase-list')}
        >
          <input
            type="radio"
            name="reportType"
            value="purchase-list"
            checked={reportType === 'purchase-list'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Purchase list</h3>
            <p>PURCHASE lines (PU, DN) with supplier/item/purchase code/godown filters and DN values shown as negative</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'voucher-list' ? 'selected' : ''}`}
          onClick={() => setReportType('voucher-list')}
        >
          <input
            type="radio"
            name="reportType"
            value="voucher-list"
            checked={reportType === 'voucher-list'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Cash/Bank/Journal Voucher List</h3>
            <p>Voucher list with date range, party, cash/bank code, and debit/credit filter</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'gstr1' ? 'selected' : ''}`}
          onClick={() => setReportType('gstr1')}
        >
          <input
            type="radio"
            name="reportType"
            value="gstr1"
            checked={reportType === 'gstr1'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>GSTR-1 (sheet-wise)</h3>
            <p>Generate GSTR-1 in screen, PDF, and Excel with B2B/B2CL/B2CS/CDNR/CDNUR/EXP/HSN/DOCS tabs</p>
          </label>
        </div>
        <div
          className={`report-option ${reportType === 'hsn-sales' ? 'selected' : ''}`}
          onClick={() => setReportType('hsn-sales')}
        >
          <input
            type="radio"
            name="reportType"
            value="hsn-sales"
            checked={reportType === 'hsn-sales'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>HsnSales</h3>
            <p>HSN Sales with Date Wise, Monthly HSN Wise, and HSN Wise Monthly tabs</p>
          </label>
        </div>
        <div
          className={`report-option ${reportType === 'hsn-purchase' ? 'selected' : ''}`}
          onClick={() => setReportType('hsn-purchase')}
        >
          <input
            type="radio"
            name="reportType"
            value="hsn-purchase"
            checked={reportType === 'hsn-purchase'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>HsnPurchase</h3>
            <p>HSN Purchase with Date Wise, Monthly HSN Wise, and HSN Wise Monthly tabs</p>
          </label>
        </div>
        <div
          className={`report-option ${reportType === 'trading-ac' ? 'selected' : ''}`}
          onClick={() => setReportType('trading-ac')}
        >
          <input
            type="radio"
            name="reportType"
            value="trading-ac"
            checked={reportType === 'trading-ac'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Trading A/C</h3>
            <p>Trading account report with schedule, account code, ending date, shortage, and closing stock options</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === 'pl-profit-loss' ? 'selected' : ''}`}
          onClick={() => setReportType('pl-profit-loss')}
        >
          <input
            type="radio"
            name="reportType"
            value="pl-profit-loss"
            checked={reportType === 'pl-profit-loss'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Profit &amp; Loss Account</h3>
            <p>Gross from Trading A/C (schedule 12.10 style) plus schedule ≥ 16 ledger balances as on date (VFP PLACT)</p>
          </label>
        </div>
        <div
          className={`report-option ${reportType === 'balance-sheet' ? 'selected' : ''}`}
          onClick={() => setReportType('balance-sheet')}
        >
          <input
            type="radio"
            name="reportType"
            value="balance-sheet"
            checked={reportType === 'balance-sheet'}
            onChange={(e) => setReportType(e.target.value)}
          />
          <label>
            <h3>Balance Sheet</h3>
            <p>Liabilities vs Assets tree (NO&lt;12) with profit/loss and closing stock adjustments as of date</p>
          </label>
        </div>

        <div
          className={`report-option ${reportType === SALES_MODULE_ID ? 'selected' : ''}`}
          onClick={() => selectReport(SALES_MODULE_ID)}
        >
          <input
            type="radio"
            name="reportType"
            value={SALES_MODULE_ID}
            checked={reportType === SALES_MODULE_ID}
            onChange={() => selectReport(SALES_MODULE_ID)}
          />
          <label>
            <h3>Sales Module</h3>
            <p>Sales Order, Dispatch Challan, and Sale Bill entry screens</p>
          </label>
        </div>
        </div>
        )}

      </div>

      <div className="button-group">
        <button onClick={handleBack} className="btn btn-secondary">
          ← Back
        </button>
        <button onClick={handleNext} className="btn btn-primary">
          Next →
        </button>
      </div>
    </div>
  );
}