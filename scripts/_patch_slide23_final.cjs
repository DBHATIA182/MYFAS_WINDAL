const fs = require('fs');
const p = 'e:/WINDAL/APPTEST/SRC/slides/Slide23SalesOrder.jsx';
let s = fs.readFileSync(p, 'utf8');

s = s.replace("import DispatchChallanListScreen from './DispatchChallanListScreen';", "import SalesOrderListScreen from './SalesOrderListScreen';");
s = s.replace("import DispatchChallanPrintScreen from './DispatchChallanPrintScreen';", "import SalesOrderPrintScreen from './SalesOrderPrintScreen';");
s = s.replace('export default function Slide22DispatchChallan', 'export default function Slide23SalesOrder');
s = s.replace(/slide-22-dispatch-challan/g, 'slide-23-sales-order');
s = s.replace(/DEFAULT_CH_TYPE = 'I';\n\nfunction normChType[\s\S]*?^}\n\n/, '');
s = s.replace(/dispatch-challan/g, 'sales-order');
s = s.replace(/Dispatch challan/g, 'Sales order');
s = s.replace(/F11/g, 'F12');
s = s.replace(/schedule 11\.20/g, 'master list');
s = s.replace(/\{ parties: \[\], plants: \[\], markas: \[\], items: \[\] \}/, '{ customers: [], markas: [], items: [] }');
s = s.replace(/parties: lRes\.data\?\.parties/g, 'customers: lRes.data?.customers');
s = s.replace(/plants: lRes\.data\?\.plants \|\| \[\],\n\s*/g, '');
s = s.replace(/const rNoRef = useRef\(''\);\n  const chTypeRef = useRef\(DEFAULT_CH_TYPE\);/, "const soNoRef = useRef('');");
s = s.replace(/const \[chType, setChType\] = useState\(DEFAULT_CH_TYPE\);\n  const \[rNo, setRNo\]/, 'const [soNo, setSoNo]');
s = s.replace(/const \[rDateYmd, setRDateYmd\]/, 'const [soDateYmd, setSoDateYmd]');
s = s.replace(/const \[plantCode, setPlantCode\] = useState\(''\);\n/, '');
s = s.replace(/const \[truckNo, setTruckNo\] = useState\(''\);\n  const \[tpt, setTpt\] = useState\(''\);\n  const \[grNo, setGrNo\] = useState\(''\);\n/, '');
s = s.replace(/const \[soPick[\s\S]*?useState\(\{ open: false[\s\S]*?\}\);\n\n/, '');
s = s.replace(/rNoRef\.current/g, 'soNoRef.current');
s = s.replace(/chTypeRef\.current/g, "''");
s = s.replace(/setRNo/g, 'setSoNo');
s = s.replace(/rNo/g, 'soNo');
s = s.replace(/rDateYmd/g, 'soDateYmd');
s = s.replace(/setRDateYmd/g, 'setSoDateYmd');
s = s.replace(/rDateOracle/g, 'soDateOracle');
s = s.replace(/toOracleDate\(soDateYmd\)/g, 'toOracleDate(soDateYmd)');
s = s.replace(/fetchNextRNo/g, 'fetchNextSoNo');
s = s.replace(/next-r-no/g, 'next-so-no');
s = s.replace(/next_r_no/g, 'next_so_no');
s = s.replace(/loadBySlot\(([^,]+), [^)]+\)/g, 'loadBySlot($1)');
s = s.replace(/async \(targetRNo, targetChType\)/g, 'async (targetSoNo)');
s = s.replace(/ch_type: targetChType,\n\s*r_no: targetRNo/g, 'so_no: targetSoNo');
s = s.replace(/setChType\(targetChType\);\n\s*/g, '');
s = s.replace(/setSoNo\(String\(targetRNo\)\)/g, 'setSoNo(String(targetSoNo))');
s = s.replace(/stepChNo/g, 'stepSoNo');
s = s.replace(/chNavButtons/g, 'soNavButtons');
s = s.replace(/showChNav/g, 'showSoNav');
s = s.replace(/openSoPick[\s\S]*?};\n\n  const applySoPick[\s\S]*?};\n\n/g, '');
s = s.replace(/soPickColumns[\s\S]*?\);\n\n/g, '');
s = s.replace(/<DispatchPickModal[\s\S]*?\/>/g, '');
s = s.replace(/setPlantCode[\s\S]*?setGrNo\(''\);\n/, "setPoNo('');\n    setRemarks('');\n    setRemarks2('');\n");
s = s.replace(/plant_code: plantCode, remarks, truck_no: truckNo, tpt, gr_no: grNo/, 'po_no: poNo, remarks, remarks2: remarks2');
s = s.replace(/ch_type: normChType\(chType\),\n\s*r_date:/, 'so_date:');
s = s.replace(/data\?\.r_no/g, 'data?.so_no');
s = s.replace(/openChallanFromList/g, 'openOrderFromList');
s = s.replace(/DispatchChallanListScreen/g, 'SalesOrderListScreen');
s = s.replace(/DispatchChallanPrintScreen/g, 'SalesOrderPrintScreen');
s = s.replace(/onOpenChallan/g, 'onOpenOrder');
s = s.replace(/defaultChType=\{chType\}\n\s*defaultRNo=\{soNo\}\n\s*defaultRDateYmd=\{soDateYmd\}/, 'defaultSoNo={soNo}\n        defaultSoDateYmd={soDateYmd}');
s = s.replace(/lookups\.parties/g, 'lookups.customers');
s = s.replace(/Challan date/g, 'SO date');
s = s.replace(/Challan saved/g, 'Sales order saved');
s = s.replace(/Challan updated/g, 'Sales order updated');
s = s.replace(/Challan deleted/g, 'Sales order deleted');
s = s.replace(/No challan at/g, 'No sales order at');
s = s.replace(/function emptyLine\(\) \{[\s\S]*?};\n}/, `function emptyLine() {
  return {
    trn_no: 1,
    item_code: '',
    item_name: '',
    marka: '',
    qnty: 0,
    status: 'B',
    weight: 0,
    rate: 0,
    amount: 0,
    weight_manual: false,
  };
}`);
s = s.replace(/applyRowsFromApi[\s\S]*?\[itemByCode\]\s*\);/, `applyRowsFromApi = useCallback(
    (rows) => {
      if (!rows?.length) return;
      const h0 = rows[0];
      setCode(String(h0.CODE ?? h0.code ?? '').trim());
      setPoNo(String(h0.PO_NO ?? h0.po_no ?? '').trim());
      setRemarks(String(h0.REMARKS ?? h0.remarks ?? '').trim());
      setRemarks2(String(h0.REMARKS2 ?? h0.remarks2 ?? '').trim());
      setPartyFinderOpen(false);
      setLines(
        rows.map((r, i) => {
          const ic = String(r.ITEM_CODE ?? r.item_code ?? '').trim();
          const it = itemByCode(ic);
          return {
            trn_no: Number(r.TRN_NO ?? r.trn_no ?? i + 1) || i + 1,
            item_code: ic,
            item_name: it ? String(it.ITEM_NAME ?? it.item_name ?? '').trim() : ic,
            marka: String(r.MARKA ?? r.marka ?? '').trim(),
            qnty: Number(r.QNTY ?? r.qnty ?? 0) || 0,
            status: String(r.STATUS ?? r.status ?? 'B').trim().slice(0, 1) || 'B',
            weight: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
            rate: roundRate2(Number(r.RATE ?? r.rate ?? 0) || 0),
            amount: Number(r.AMOUNT ?? r.amount ?? 0) || 0,
            weight_manual: true,
          };
        })
      );
    },
    [itemByCode]
  );`);
// Add poNo state if missing
if (!s.includes('const [poNo, setPoNo]')) {
  s = s.replace(/const \[remarks, setRemarks\]/, "const [poNo, setPoNo] = useState('');\n  const [remarks, setRemarks]");
}
if (!s.includes('remarks2')) {
  s = s.replace(/const \[remarks, setRemarks\] = useState\(''\);/, "const [remarks, setRemarks] = useState('');\n  const [remarks2, setRemarks2] = useState('');");
}
fs.writeFileSync(p, s);
console.log('slide23 patched');
