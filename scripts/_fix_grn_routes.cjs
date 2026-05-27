const fs = require('fs');
const path = require('path');
const serverPath = path.join(__dirname, '..', 'server.cjs');
let src = fs.readFileSync(serverPath, 'utf8');

const dispatchStart = src.indexOf("app.get('/api/dispatch-challan-next-r-no'");
const dispatchEnd = src.indexOf("app.get('/api/dispatch-challan-pending-orders'");
const dispatchBlock = src.slice(dispatchStart, dispatchEnd);

let fix = dispatchBlock
  .replace(/dispatch-challan/g, 'grn')
  .replace(/DISPATCH_CHALLAN_TYPE/g, 'GRN_TYPE')
  .replace(/Dispatch challan print/g, 'Goods receipt note print')
  .replace(/Dispatch challan list report/g, 'Goods receipt note list report')
  .replace(/Fox dispatch challan F1 pending SO/g, 'Fox GRN F1 pending PO')
  .replace(/fetchDispatchChallanPendingOrders/g, 'fetchGrnPendingOrders')
  .replace(/X1 SORDER TYPE=SO · X2 ISSUE TYPE=S/g, 'X1 SORDER TYPE=PO · X2 ISSUE TYPE=I')
  .replace(/TRIM\(TO_CHAR\(A\.TYPE\)\) = 'SO'/g, "TRIM(TO_CHAR(A.TYPE)) = 'PO'")
  .replace(/TRIM\(TO_CHAR\(A\.TYPE\)\) = 'S'/g, "TRIM(TO_CHAR(A.TYPE)) = 'I'");

const corruptStart = src.indexOf("app.get('/api/grn-next-r-no'");
const corruptEnd = src.indexOf("app.get('/api/grn-pending-orders'");
if (corruptStart < 0 || corruptEnd < 0) {
  console.error('Could not find corrupt GRN section');
  process.exit(1);
}

src = src.slice(0, corruptStart) + fix + src.slice(corruptEnd);
fs.writeFileSync(serverPath, src, 'utf8');
console.log('Fixed GRN routes section.');
