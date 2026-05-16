const fs = require('fs');
const p = 'e:/WINDAL/APPTEST/SRC/slides/Slide23SalesOrder.jsx';
let s = fs.readFileSync(p, 'utf8');
// imports
s = s.replace("import DispatchChallanListScreen from './DispatchChallanListScreen';", "import SalesOrderListScreen from './SalesOrderListScreen';");
s = s.replace("import DispatchChallanPrintScreen from './DispatchChallanPrintScreen';", "import SalesOrderPrintScreen from './SalesOrderPrintScreen';");
s = s.replace('Slide22DispatchChallan', 'Slide23SalesOrder');
s = s.replace(/slide-22-dispatch-challan/g, 'slide-23-sales-order');
s = s.replace(/DEFAULT_CH_TYPE = 'I';\n\nfunction normChType[\s\S]*?^}\n\n/, '');
s = s.replace(/dispatch-challan/g, 'sales-order');
s = s.replace(/Dispatch challan/g, 'Sales order');
s = s.replace(/F11/g, 'F12');
s = s.replace(/chType|ch_type|ChType|Ch\.Type|Ch\.No|Ch\.Date|challan|Challan/g, (m) => {
  const m2 = {
    chType: 'soNo',
    ch_type: 'so_no',
    ChType: 'SoNo',
    'Ch.Type': '',
    'Ch.No': 'SO no',
    'Ch.Date': 'SO date',
    challan: 'order',
    Challan: 'Order',
  };
  return m2[m] || m;
});
// Remove SO pick modal and plant - big blocks - simplified removals
s = s.replace(/const \[soPick[\s\S]*?const soPickColumns[\s\S]*?\);\n\n/, '');
s = s.replace(/openSoPick[\s\S]*?const soPickColumns[\s\S]*?\);\n\n/, '');
s = s.replace(/<DispatchPickModal[\s\S]*?\/>\n/g, '');
s = s.replace(/DispatchPickModal/g, 'SoPickModalRemoved');
s = s.replace(/plantCode|plant_code|Plant|PLANT|truckNo|truck_no|tpt|grNo|gr_no|so_no|soPick|SO pick|pending SO|schedule 11\.20/gi, (m) => {
  if (/plant|truck|tpt|gr_no|soPick|SO pick|pending|schedule/i.test(m)) return 'REMOVED';
  return m;
});
fs.writeFileSync(p, s);
console.log('slide23 partial - needs manual cleanup');
