const fs = require('fs');
const p = 'e:/WINDAL/APPTEST/SRC/slides/SalesOrderPrintScreen.jsx';
let s = fs.readFileSync(p, 'utf8');
const reps = [
  ['DispatchChallanPrintScreen', 'SalesOrderPrintScreen'],
  ['buildDispatchChallanIframeDoc', 'buildSalesOrderIframeDoc'],
  ['groupDispatchPrintRows', 'groupSalesOrderPrintRows'],
  ['function normChType(raw) {\n  const c = String(raw ?? \'I\')\n    .trim()\n    .toUpperCase()\n    .slice(0, 1);\n  return c || \'I\';\n}\n\n', ''],
  ['dispatch-challan-print', 'sales-order-print'],
  ['slide-22-dispatch-challan-print', 'slide-23-sales-order-print'],
  ['Dispatch challan', 'Sales order'],
  ['challan', 'order'],
  ['Challan', 'Order'],
  ['challans', 'orders'],
  ['Challans', 'Orders'],
  ['defaultChType = \'I\',\n  defaultRNo', 'defaultSoNo'],
  ['defaultRNo', 'defaultSoDateYmd'],
  ['defaultRDateYmd', 'defaultSoDateYmd'],
  ['const [chType, setChType] = useState(() => normChType(defaultChType));\n\n', ''],
  ['chTypeLabel: chType,\n      ', ''],
  ['ch_type: normChType(chType),\n          ', ''],
  [', chType', ''],
  ['`Type ${normChType(chType)} · Ch ${sNo', '`SO ${sNo'],
  ['Ch ${sNo', 'SO ${sNo'],
  ['Ch.No.', 'SO no.'],
  ['Ch.no.', 'SO no.'],
  ['Ch.type', ''],
  ['ch.no.', 'SO no.'],
  ['dc-print-ch-type', ''],
  ['          <label className="sale-bill-field">\n            <span className="sale-bill-field__label">Ch.type</span>\n            <input\n              className="form-input dc-print-ch-type"\n              maxLength={1}\n              value={chType}\n              onChange={(e) => setChType(normChType(e.target.value))}\n            />\n          </label>\n', ''],
];
for (const [a, b] of reps) s = s.split(a).join(b);
// Fix group function body
s = s.replace(
  /function groupSalesOrderPrintRows\(rows\) \{[\s\S]*?^}\n\n\/\*\*/,
  `function groupSalesOrderPrintRows(rows) {
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

/**`
);
s = s.replace(/challans/g, 'orders').replace(/Challans/g, 'Orders');
s = s.replace(/pdfData = useMemo\(\s*\(\) => \(\{\s*compdet: compdet \|\| \{\},\s*challans,\s*\}\)/, 'pdfData = useMemo(\n    () => ({\n      compdet: compdet || {},\n      orders,\n    })');
s = s.replace(/ChType: r\.CH_TYPE \?\? r\.ch_type,\n        ChNo: r\.R_NO \?\? r\.r_no,\n        ChDate: toDisplayDate\(toInputDateString\(r\.R_DATE \?\? r\.r_date\)\),/, 'SoNo: r.SO_NO ?? r.so_no,\n        SoDate: toDisplayDate(toInputDateString(r.SO_DATE ?? r.so_date)),');
s = s.replace(/TruckNo: r\.TRUCK_NO \?\? r\.truck_no,\n        Tpt: r\.TPT \?\? r\.tpt,\n        GRNo: r\.GR_NO \?\? r\.gr_no,/, 'PoNo: r.PO_NO ?? r.po_no,\n        Remarks2: r.REMARKS2 ?? r.remarks2,');
s = s.replace(/DispatchChallanPrint/g, 'SalesOrderPrint');
s = s.replace(/defaultSoNo = '',\n  defaultSoDateYmd = '',/g, "defaultSoNo = '',\n  defaultSoDateYmd = '',");
s = s.replace(/defaultSoDateYmd \|\| fyStart/g, '(defaultSoDateYmd || defaultSoNo ? defaultSoDateYmd : fyStart)');
// fix props - defaultSoNo used for sNo init
s = s.replace(/useState\(\(\) => String\(defaultSoDateYmd \?\? ''\)\.trim\(\)\)/g, "useState(() => String(defaultSoNo ?? '').trim())");
fs.writeFileSync(p, s);
console.log('patched print');
