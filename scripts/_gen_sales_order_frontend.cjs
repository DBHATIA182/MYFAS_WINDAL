const fs = require('fs');
const path = require('path');
const root = 'e:/WINDAL/APPTEST';

function w(rel, content) {
  const p = path.join(root, rel);
  fs.writeFileSync(p, content, 'utf8');
  console.log('wrote', rel);
}

// --- List screen from dispatch list ---
let list = fs.readFileSync(path.join(root, 'SRC/slides/DispatchChallanListScreen.jsx'), 'utf8');
list = list
  .replace(/DispatchChallanListScreen/g, 'SalesOrderListScreen')
  .replace(/dispatch-challan-list-report/g, 'sales-order-list-report')
  .replace(/dispatch-challan-list/g, 'sales-order-list')
  .replace(/slide-22-dispatch-challan-list/g, 'slide-23-sales-order-list')
  .replace(/Dispatch challan list/g, 'Sales order list')
  .replace(/DispatchChallanList/g, 'SalesOrderList')
  .replace(/Dispatch challan/g, 'Sales order')
  .replace(/lookups\?\.parties/g, 'lookups?.customers')
  .replace(/CH_TYPE: String\(r\.CH_TYPE[^}]+\},?\n\s*/g, '')
  .replace(/CH_TYPE: r\.CH_TYPE \?\? r\.ch_type,\n\s*/g, '')
  .replace(/PLANT_CODE: r\.PLANT_CODE \?\? r\.plant_code,\n\s*/g, '')
  .replace(/mapReportRow\(r\) \{\n  return \{\n    SO_NO:/, 'mapReportRow(r) {\n  return {\n    SO_NO:')
  .replace(
    /function mapReportRow\(r\) \{\n  return \{\n/,
    `function mapReportRow(r) {
  return {
    SO_NO: r.SO_NO ?? r.so_no,
    SO_DATE: toDisplayDate(toInputDateString(r.SO_DATE ?? r.so_date)),
`
  );
list = list.replace(
  /return \{\n    SO_NO: r\.SO_NO \?\? r\.so_no,\n    SO_DATE: toDisplayDate\(toInputDateString\(r\.SO_DATE \?\? r\.so_date\)\),\n    SO_NO: r\.SO_NO \?\? r\.so_no,\n    SO_DATE: toDisplayDate/,
  'return {\n    SO_NO: r.SO_NO ?? r.so_no,\n    SO_DATE: toDisplayDate'
);
// Fix mapReportRow - read original and rebuild
list = fs.readFileSync(path.join(root, 'SRC/slides/DispatchChallanListScreen.jsx'), 'utf8');
list = list
  .replace(/export default function DispatchChallanListScreen/, 'export default function SalesOrderListScreen')
  .replace(/dispatch-challan-list-report/g, 'sales-order-list-report')
  .replace(/dispatch-challan-list/g, 'sales-order-list')
  .replace(/slide-22-dispatch-challan-list/g, 'slide-23-sales-order-list')
  .replace(/Dispatch challan list/g, 'Sales order list')
  .replace(/DispatchChallanList/g, 'SalesOrderList')
  .replace(/Dispatch challan/g, 'Sales order')
  .replace(/lookups\?\.parties/g, 'lookups?.customers')
  .replace(/const parties = lookups\?\.parties/g, 'const parties = lookups?.customers')
  .replace(/function mapReportRow\(r\) \{[\s\S]*?\n\}/, `function mapReportRow(r) {
  return {
    SO_NO: r.SO_NO ?? r.so_no,
    SO_DATE: toDisplayDate(toInputDateString(r.SO_DATE ?? r.so_date)),
    CODE: r.CODE ?? r.code,
    PARTY_NAME: r.PARTY_NAME ?? r.party_name ?? r.NAME ?? r.name,
    ITEM_CODE: r.ITEM_CODE ?? r.item_code,
    ITEM_NAME: r.ITEM_NAME ?? r.item_name,
    MARKA: r.MARKA ?? r.marka,
    QNTY: Number(r.QNTY ?? r.qnty ?? 0),
    STATUS: r.STATUS ?? r.status,
    WEIGHT: Number(r.WEIGHT ?? r.weight ?? 0),
    RATE: Number(r.RATE ?? r.rate ?? 0),
    AMOUNT: Number(r.AMOUNT ?? r.amount ?? 0),
    TRN_NO: r.TRN_NO ?? r.trn_no,
    PO_NO: r.PO_NO ?? r.po_no,
    REMARKS: r.REMARKS ?? r.remarks,
    REMARKS2: r.REMARKS2 ?? r.remarks2,
  };
}`)
  .replace(/onOpenChallan/g, 'onOpenOrder')
  .replace(/CH_TYPE|Ch\.Type|ch_type|Ch No|R_NO|R_DATE/g, (m) => {
    const map = {
      CH_TYPE: 'SO_NO',
      'Ch.Type': 'SO no',
      ch_type: 'so_no',
      'Ch No': 'SO no',
      R_NO: 'SO_NO',
      R_DATE: 'SO_DATE',
    };
    return map[m] || m;
  });
w('SRC/slides/SalesOrderListScreen.jsx', list);

// --- Print screen ---
let pr = fs.readFileSync(path.join(root, 'SRC/slides/DispatchChallanPrintScreen.jsx'), 'utf8');
pr = pr
  .replace(/DispatchChallanPrintScreen/g, 'SalesOrderPrintScreen')
  .replace(/dispatch-challan-print/g, 'sales-order-print')
  .replace(/buildDispatchChallanIframeDoc/g, 'buildSalesOrderIframeDoc')
  .replace(/buildDispatchChallanPreviewDocument/g, 'buildSalesOrderPreviewDocument')
  .replace(/groupDispatchPrintRows/g, 'groupSalesOrderPrintRows')
  .replace(/normChType|ch_type|chType|Ch\.Type|challan|Challan|Ch\.No|R_NO|r_no|R_DATE|defaultChType|defaultRNo/g, (m) => {
    const map = {
      normChType: 'noopCh',
      ch_type: 'so_no',
      chType: 'soNo',
      'Ch.Type': 'SO',
      challan: 'order',
      Challan: 'Order',
      'Ch.No': 'SO no',
      R_NO: 'SO_NO',
      r_no: 'so_no',
      R_DATE: 'SO_DATE',
      defaultChType: 'defaultSoNo',
      defaultRNo: 'defaultSoNo',
    };
    return map[m] || m;
  });
// Manual fix print screen - too many bad replacements. Copy and do targeted replace instead.
pr = fs.readFileSync(path.join(root, 'SRC/slides/DispatchChallanPrintScreen.jsx'), 'utf8');
pr = pr
  .replace(/export default function DispatchChallanPrintScreen/, 'export default function SalesOrderPrintScreen')
  .replace(/DispatchChallanPrintScreen/g, 'SalesOrderPrintScreen')
  .replace(/buildDispatchChallanIframeDoc/g, 'buildSalesOrderIframeDoc')
  .replace(/dispatch-challan-print/g, 'sales-order-print')
  .replace(/slide-22-dispatch-challan-print/g, 'slide-23-sales-order-print')
  .replace(/Dispatch challan print/g, 'Sales order print')
  .replace(/Dispatch challan/g, 'Sales order')
  .replace(/groupDispatchPrintRows/g, 'groupSalesOrderPrintRows')
  .replace(/function normChType[\s\S]*?^}\n\nfunction groupDispatchPrintRows/, `function groupSalesOrderPrintRows`)
  .replace(/function groupDispatchPrintRows[\s\S]*?^}\n\n\/\*\*/, (match) => {
    return `function groupSalesOrderPrintRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const rn = r.SO_NO ?? r.so_no;
    const key = String(rn);
    if (!map.has(key)) {
      const rd = r.SO_DATE ?? r.so_date;
      map.set(key, {
        so_no: rn,
        so_date_display: toDisplayDate(toInputDateString(rd)),
        party: {
          name: r.NAME ?? r.name,
          add1: r.ADD1 ?? r.add1,
          add2: r.ADD2 ?? r.add2,
          city: r.CITY ?? r.city,
          gst: r.GST_NO ?? r.gst_no,
          pan: r.PAN ?? r.pan,
          tel: r.TEL_NO_O ?? r.tel_no_o,
        },
        footer: {
          po_no: r.PO_NO ?? r.po_no,
          remarks: r.REMARKS ?? r.remarks,
          remarks2: r.REMARKS2 ?? r.remarks2,
        },
        lines: [],
      });
    }
    map.get(key).lines.push(r);
  }
  return Array.from(map.values()).sort((a, b) => (Number(a.so_no) || 0) - (Number(b.so_no) || 0));
}

/**`);
  });
// Remove ch_type from component props and filters - do simpler second pass
pr = pr.replace(/defaultChType[^,]+,\s*/g, '');
pr = pr.replace(/const \[chType[\s\S]*?setChType[\s\S]*?\);\n\n/g, '');
pr = pr.replace(/chTypeLabel[^,]+,\n/g, '');
pr = pr.replace(/chType[^,]*,?\s*/g, '');
w('SRC/slides/SalesOrderPrintScreen.jsx', pr);

console.log('done (print may need manual fix)');
