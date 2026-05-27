const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}
function write(rel, content) {
  const p = path.join(root, rel);
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel);
}

function genMainSlide() {
  let s = read('SRC/slides/Slide22DispatchChallan.jsx');
  s = s
    .replace(/Slide22DispatchChallan/g, 'Slide29Grn')
    .replace(/DispatchChallanListScreen/g, 'GrnListScreen')
    .replace(/DispatchChallanPrintScreen/g, 'GrnPrintScreen')
    .replace(/dispatch-challan-entry/g, 'grn-entry')
    .replace(/dispatch-challan-user-permissions/g, 'grn-user-permissions')
    .replace(/dispatch-challan-form-context/g, 'grn-form-context')
    .replace(/dispatch-challan-lookups/g, 'grn-lookups')
    .replace(/dispatch-challan-next-r-no/g, 'grn-next-r-no')
    .replace(/dispatch-challan-raw/g, 'grn-raw')
    .replace(/dispatch-challan-pending-orders/g, 'grn-pending-orders')
    .replace(/dispatch-challan-save/g, 'grn-save')
    .replace(/slide-22-dispatch-challan/g, 'slide-29-grn')
    .replace(/Dispatch challan/g, 'Goods receipt note')
    .replace(/dispatch-challan-entry/g, 'grn-entry')
    .replace(/helpReportId="grn-entry"/g, 'helpReportId="grn-entry"')
    .replace(/DISPATCH_PARTY_SCHEDULE = 11\.2;\n\n/, '')
    .replace(/DISPATCH_PARTY_SCHEDULE/g, '0')
    .replace(/schedule 11\.20/g, 'supplier')
    .replace(/schedule 11\.2/g, 'supplier')
    .replace(/pending SO/g, 'pending PO')
    .replace(/SO no/g, 'PO no')
    .replace(/label: 'PO no', render: \(r\) => displayLineInt6\(r\.SO_NO\)/g, "label: 'PO no', render: (r) => displayLineInt6(r.SO_NO ?? r.PO_NO)")
    .replace(/showNotice\('Select party \(supplier\) before pending PO \(F1\)\.'\)/g, "showNotice('Select supplier before pending PO (F1).')")
    .replace(/showNotice\('Select party \(supplier\)\.'\)/g, "showNotice('Select supplier.')")
    .replace(/title="Add new party \(supplier\)"/g, 'title="Add new supplier"')
    .replace(/placeholder="Search party — code, name, or city \(supplier\)"/g, 'placeholder="Search supplier — code, name, or city"')
    .replace(/helpReportId="dispatch-challan-entry"/g, 'helpReportId="grn-entry"');
  write('SRC/slides/Slide29Grn.jsx', s);
}

function genListScreen() {
  let s = read('SRC/slides/DispatchChallanListScreen.jsx');
  s = s
    .replace(/DispatchChallanListScreen/g, 'GrnListScreen')
    .replace(/dispatch-challan-list-report/g, 'grn-list-report')
    .replace(/dispatch-challan-list/g, 'grn-list')
    .replace(/slide-22-dispatch-challan-list/g, 'slide-29-grn-list')
    .replace(/Dispatch challan list/g, 'Goods receipt note list')
    .replace(/DispatchChallanList/g, 'GrnList')
    .replace(/Dispatch challan/g, 'Goods receipt note')
    .replace(/onOpenChallan/g, 'onOpenGrn');
  write('SRC/slides/GrnListScreen.jsx', s);
}

function genPrintScreen() {
  let s = read('SRC/slides/DispatchChallanPrintScreen.jsx');
  s = s
    .replace(/DispatchChallanPrintScreen/g, 'GrnPrintScreen')
    .replace(/dispatch-challan-print/g, 'grn-print')
    .replace(/slide-22-dispatch-challan-print/g, 'slide-29-grn-print')
    .replace(/Dispatch challan print/g, 'Goods receipt note print')
    .replace(/DispatchChallanPrint/g, 'GrnPrint')
    .replace(/Dispatch challan/g, 'Goods receipt note')
    .replace(/groupDispatchPrintRows/g, 'groupGrnPrintRows')
    .replace(/buildDispatchChallanIframeDoc/g, 'buildGrnIframeDoc')
    .replace(/'dispatch-challan-print'/g, "'grn-print'");
  write('SRC/slides/GrnPrintScreen.jsx', s);
}

genMainSlide();
genListScreen();
genPrintScreen();
console.log('GRN frontend files generated.');
