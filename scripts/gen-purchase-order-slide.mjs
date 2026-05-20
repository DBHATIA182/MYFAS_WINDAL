import fs from 'fs';

let c = fs.readFileSync('SRC/slides/Slide23SalesOrder.jsx', 'utf8');

const reps = [
  ['Slide23SalesOrder', 'Slide24PurchaseOrder'],
  ['slide-23-sales-order', 'slide-24-purchase-order'],
  ['SalesOrderListScreen', 'PurchaseOrderListScreen'],
  ['SalesOrderPrintScreen', 'PurchaseOrderPrintScreen'],
  ['/api/sales-order-', '/api/purchase-order-'],
  ['sales-order-entry', 'purchase-order-entry'],
  ['Sales order', 'Purchase order'],
  ['sales order', 'purchase order'],
  ['Access denied (F12', 'Access denied (F13'],
  ['F12 position', 'F13 position'],
  ['{ customers:', '{ suppliers:'],
  ['customers: lRes', 'suppliers: lRes'],
  ['lookups.customers', 'lookups.suppliers'],
  ['prev.customers', 'prev.suppliers'],
  ['lRes.data?.customers', 'lRes.data?.suppliers'],
  ['>Customer<', '>Supplier<'],
  ['customer —', 'supplier —'],
  ['Customer matches', 'Supplier matches'],
  ['new customer', 'new supplier'],
  ['defaultSchedule={8.1}', 'defaultSchedule={11.1}'],
  ['dc-header-k">SO no', 'dc-header-k">PO no'],
  ['dc-header-k">SO date', 'dc-header-k">PO date'],
  ['SO date must', 'PO date must'],
  ['fetchNextSoNo', 'fetchNextPoNo'],
  ['sales-order-next-so-no', 'purchase-order-next-po-no'],
  ['next_so_no', 'next_po_no'],
  ['soNavButtons', 'poNavButtons'],
  ['showSoNav', 'showPoNav'],
  ['stepSoNo', 'stepPoNo'],
  ['defaultSoNo', 'defaultPoNo'],
  ['defaultSoDateYmd', 'defaultPoDateYmd'],
  ['loadBySlot', 'loadByPoSlot'],
  ['targetSoNo', 'targetPoNo'],
];

for (const [a, b] of reps) c = c.split(a).join(b);

c = c.replace(/const soNoRef/g, 'const poNoRef');
c = c.replace(/soNoRef/g, 'poNoRef');
c = c.replace(/\[soNo, setSoNo\]/, '[poNo, setPoNo]');
c = c.replace(/setSoNo/g, 'setPoNo');
c = c.replace(/\bsoNo\b/g, 'poNo');

c = c.replace(
  /const \[poNo, setPoNo\] = useState\(''\);\n  const \[remarks/,
  "const [refNo, setRefNo] = useState('');\n  const [remarks"
);
c = c.replace(/setPoNo\(String\(h0\.PO_NO/g, 'setRefNo(String(h0.PO_NO');
c = c.replace(/setPoNo\(''\);\n    setRemarks/, "setRefNo('');\n    setRemarks");
c = c.replace(/po_no: poNo,/, 'po_no: refNo,');

c = c.replace(
  /<span className="sale-bill-field__label">PO no<\/span>\s*<input\s*className="form-input dc-footer-field-input"\s*value={poNo}\s*disabled={fieldsDisabled}\s*onChange=\{\(e\) => setPoNo\(e\.target\.value\)\}/,
  `<span className="sale-bill-field__label">Ref no</span>
            <input
              className="form-input dc-footer-field-input"
              value={refNo}
              disabled={fieldsDisabled}
              onChange={(e) => setRefNo(e.target.value)}`
);

c = c.replace(/\[soDateYmd, setSoDateYmd\]/g, '[poDateYmd, setPoDateYmd]');
c = c.replace(/\bsetSoDateYmd\b/g, 'setPoDateYmd');
c = c.replace(/\bsoDateYmd\b/g, 'poDateYmd');
c = c.replace(/\bsoDateOracle\b/g, 'poDateOracle');
c = c.replace(/sales-order-next-so-no/g, 'purchase-order-next-po-no');
c = c.replace(/so_no: targetPoNo/g, 'po_no: targetPoNo');

fs.writeFileSync('SRC/slides/Slide24PurchaseOrder.jsx', c);
console.log('Wrote Slide24PurchaseOrder.jsx');
