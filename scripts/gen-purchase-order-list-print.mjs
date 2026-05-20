import fs from 'fs';

function poFromSo(src, isList) {
  let c = src;
  const reps = [
    ['SalesOrderListScreen', 'PurchaseOrderListScreen'],
    ['SalesOrderPrintScreen', 'PurchaseOrderPrintScreen'],
    ['slide-23-sales-order-list', 'slide-24-purchase-order-list'],
    ['slide-23-sales-order-print', 'slide-24-purchase-order-print'],
    ['/api/sales-order-list-report', '/api/purchase-order-list-report'],
    ['/api/sales-order-print', '/api/purchase-order-print'],
    ['sales-order-list', 'purchase-order-list'],
    ['sales-order-print', 'purchase-order-print'],
    ['Sales order list', 'Purchase order list'],
    ['Sales order print', 'Purchase order print'],
    ['Sales order', 'Purchase order'],
    ['SalesOrder', 'PurchaseOrder'],
    ['Sales order ·', 'Purchase order ·'],
    ['Sales order mobile', 'Purchase order mobile'],
    ['Sales order print preview', 'Purchase order print preview'],
    ['that sales order', 'that purchase order'],
    ['dc-print-modal-title', 'po-print-modal-title'],
    ['id="dc-print-modal-title"', 'id="po-print-modal-title"'],
    ['lookups?.customers', 'lookups?.suppliers'],
    ['defaultSoNo', 'defaultPoNo'],
    ['defaultSoDateYmd', 'defaultPoDateYmd'],
    ['buildSalesOrderIframeDoc', 'buildPurchaseOrderIframeDoc'],
    ['groupSalesOrderPrintRows', 'groupPurchaseOrderPrintRows'],
  ];
  for (const [a, b] of reps) c = c.split(a).join(b);

  if (isList) {
    c = c.replace(/All parties/g, 'All suppliers');
    c = c.replace(/Specific party/g, 'Specific supplier');
    c = c.replace(/Clear party \/ item \/ marka/g, 'Clear supplier / item / marka');
    c = c.replace(/title="Open this challan in entry"/g, 'title="Open this purchase order in entry"');
    c = c.replace(/list="dc-list-markas"/g, 'list="po-list-markas"');
    c = c.replace(/id="dc-list-markas"/g, 'id="po-list-markas"');
  } else {
    c = c.replace(
      /export default function PurchaseOrderPrintScreen\(\{[^}]+\}\) \{/,
      `export default function PurchaseOrderPrintScreen({
  apiBase,
  formData,
  defaultPoNo = '',
  defaultPoDateYmd = '',
  onClose,
}) {`
    );
  }

  return c;
}

const listSrc = fs.readFileSync('SRC/slides/SalesOrderListScreen.jsx', 'utf8');
const printSrc = fs.readFileSync('SRC/slides/SalesOrderPrintScreen.jsx', 'utf8');

fs.writeFileSync('SRC/slides/PurchaseOrderListScreen.jsx', poFromSo(listSrc, true));
fs.writeFileSync('SRC/slides/PurchaseOrderPrintScreen.jsx', poFromSo(printSrc, false));
console.log('Wrote PurchaseOrderListScreen.jsx and PurchaseOrderPrintScreen.jsx');
