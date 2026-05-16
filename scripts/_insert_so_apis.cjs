const fs = require('fs');
const p = 'e:/WINDAL/APPTEST/server.cjs';
const snip = fs.readFileSync('e:/WINDAL/APPTEST/scripts/_sales_order_apis_snippet.cjs', 'utf8');
let s = fs.readFileSync(p, 'utf8');
const anchor = "app.get('/api/sale-bill-inv-no-preview'";
if (!s.includes(anchor)) throw new Error('anchor missing');
if (s.includes('/api/sales-order-user-permissions')) {
  console.log('already inserted');
  process.exit(0);
}
s = s.replace(anchor, snip + '\n' + anchor);
fs.writeFileSync(p, s);
console.log('inserted sales-order APIs');
