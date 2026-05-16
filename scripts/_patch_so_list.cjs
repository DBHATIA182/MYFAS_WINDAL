const fs = require('fs');
const p = 'e:/WINDAL/APPTEST/SRC/slides/SalesOrderListScreen.jsx';
let s = fs.readFileSync(p, 'utf8');
const reps = [
  ['DispatchChallanListScreen', 'SalesOrderListScreen'],
  ['dispatch-challan-list-report', 'sales-order-list-report'],
  ['dispatch-challan-list', 'sales-order-list'],
  ['slide-22-dispatch-challan-list', 'slide-23-sales-order-list'],
  ['Dispatch challan list', 'Sales order list'],
  ['Dispatch challan', 'Sales order'],
  ['DispatchChallan', 'SalesOrder'],
  ['lookups?.parties', 'lookups?.customers'],
  ['const parties = lookups?.parties', 'const parties = lookups?.customers'],
  ['onOpenChallan', 'onOpenOrder'],
  ['open that challan', 'open that sales order'],
];
for (const [a, b] of reps) s = s.split(a).join(b);
s = s.replace(/function mapReportRow\(r\) \{[\s\S]*?\n\}/, `function mapReportRow(r) {
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
}`);
s = s.replace(/ChType: r\.CH_TYPE[\s\S]*?Plant: r\.PLANT_CODE,\n        Remarks: r\.REMARKS,/,
  'SoNo: r.SO_NO,\n        SoDate: r.SO_DATE,\n        PoNo: r.PO_NO,\n        Remarks: r.REMARKS,\n        Remarks2: r.REMARKS2,');
s = s.replace(/<th>Type<\/th>\n                  <th>No<\/th>/, '<th>SO no</th>');
s = s.replace(/<td>\{r\.CH_TYPE\}<\/td>\n                      <td>\{r\.R_NO\}<\/td>\n                      <td>\{r\.R_DATE\}<\/td>/,
  '<td>{r.SO_NO}</td>\n                      <td>{r.SO_DATE}</td>');
s = s.replace(/<th>SO<\/th>\n                  <th>Item<\/th>/, '<th>Item</th>');
s = s.replace(/<td>\{r\.SO_NO \?\? ''\}<\/td>\n                      <td>\{r\.ITEM_CODE\}/, '<td>{r.ITEM_CODE}');
s = s.replace(/key=\{`\$\{r\.CH_TYPE\}-\$\{r\.R_NO\}-\$\{r\.TRN_NO\}-\$\{i\}`\}/, 'key={`${r.SO_NO}-${r.TRN_NO}-${i}`}');
s = s.replace(/onOpenOrder\?\.\(\{\s*CH_TYPE: r\.CH_TYPE,\s*R_NO: r\.R_NO,\s*\}\)/, 'onOpenOrder?.({ SO_NO: r.SO_NO })');
s = s.replace(/colSpan=\{12\}/, 'colSpan={11}');
fs.writeFileSync(p, s);
console.log('patched list');
