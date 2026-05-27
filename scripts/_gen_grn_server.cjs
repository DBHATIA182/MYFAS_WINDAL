const fs = require('fs');
const path = require('path');
const serverPath = path.join(__dirname, '..', 'server.cjs');
let src = fs.readFileSync(serverPath, 'utf8');

const marker = '/** Sales order (SORDER TYPE=SO): DAL.USERS F12';
const startMarker = '/** Dispatch challan (ISSUE TYPE S): DAL.USERS F11';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(marker);
if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) {
  console.error('Could not find dispatch challan block markers');
  process.exit(1);
}

let block = src.slice(startIdx, endIdx);

block = block
  .replace(/\/\*\* Dispatch challan \(ISSUE TYPE S\): DAL\.USERS F11[^*]*\*\//, '/** Goods receipt note (ISSUE TYPE I): DAL.USERS F11 — pos 1–4 = open, add, edit, delete. */')
  .replace(/fetchDispatchChallanUserF11String/g, 'fetchGrnUserF11String')
  .replace(/dispatchChallanPermissionsFromF11/g, 'grnPermissionsFromF11')
  .replace(/DISPATCH_CHALLAN_TYPE/g, 'GRN_TYPE')
  .replace(/DISPATCH_CHALLAN_CO/g, 'GRN_CO')
  .replace(/DISPATCH_PARTY_SCHEDULE/g, 'GRN_PARTY_SCHEDULE')
  .replace(/clampDispatchWeightSql/g, 'clampGrnWeightSql')
  .replace(/clampDispatchAmountSql/g, 'clampGrnAmountSql')
  .replace(/dispatch-challan/g, 'grn')
  .replace(/fetchDispatchChallanPendingOrders/g, 'fetchGrnPendingOrders')
  .replace(/Dispatch challan/g, 'Goods receipt note')
  .replace(/Fox dispatch challan F1 pending SO/g, 'Fox GRN F1 pending PO')
  .replace(/X1 SORDER TYPE=SO · X2 ISSUE TYPE=S/g, 'X1 SORDER TYPE=PO · X2 ISSUE TYPE=I')
  .replace(/TRIM\(TO_CHAR\(A\.TYPE\)\) = 'SO'/g, "TRIM(TO_CHAR(A.TYPE)) = 'PO'")
  .replace(/TRIM\(TO_CHAR\(A\.TYPE\)\) = 'S'/g, "TRIM(TO_CHAR(A.TYPE)) = 'I'")
  .replace(/AND TRIM\(TO_CHAR\(A\.TYPE\)\) = 'S'/g, "AND TRIM(TO_CHAR(A.TYPE)) = 'I'")
  .replace(/const DISPATCH_CHALLAN_TYPE = 'S'/g, "const GRN_TYPE = 'I'")
  .replace(/const DISPATCH_CHALLAN_CO = 'O'/g, "const GRN_CO = 'I'")
  .replace(/const DISPATCH_PARTY_SCHEDULE = 11\.2/g, 'const GRN_PARTY_SCHEDULE = null');

// Fix constants at top of block (after replace may be wrong)
block = block.replace(/const GRN_TYPE = 'S';\s*\nconst GRN_CO = 'O';\s*\nconst GRN_PARTY_SCHEDULE = 11\.2;/, "const GRN_TYPE = 'I';\nconst GRN_CO = 'I';\nconst GRN_PARTY_SCHEDULE = null;");

// Supplier lookup — all parties (like purchase order)
block = block.replace(
  /const partySql = `[\s\S]*?ORDER BY M\.NAME, M\.CITY, M\.CODE`;/,
  `const partySql = \`
      SELECT M.CODE, M.NAME, M.CITY, M.GST_NO
      FROM MASTER M
      WHERE M.COMP_CODE = :comp_code
      ORDER BY M.NAME, M.CITY, M.CODE\`;`
);

block = block.replace(
  /runQuery\(partySql, \{ comp_code, sched: GRN_PARTY_SCHEDULE \}, comp_uid\)/,
  'runQuery(partySql, { comp_code }, comp_uid)'
);

// pending orders x2 type I
block = block.replace(
  /FROM ISSUE A[\s\S]*?GROUP BY A\.SO_NO, A\.ITEM_CODE, A\.STATUS, A\.RATE[\s\S]*?ORDER BY A\.SO_NO`;/,
  `FROM ISSUE A
    WHERE A.COMP_CODE = :comp_code
      AND TRIM(TO_CHAR(A.TYPE)) = 'I'
      AND TRIM(TO_CHAR(A.CODE)) = TRIM(TO_CHAR(:party_code))
    GROUP BY A.SO_NO, A.ITEM_CODE, A.STATUS, A.RATE
    ORDER BY A.SO_NO\`;`
);

if (src.includes('/** Goods receipt note (ISSUE TYPE I)')) {
  console.log('GRN server block already present — skipping insert');
  process.exit(0);
}

const insert = '\n' + block;
src = src.slice(0, endIdx) + insert + src.slice(endIdx);
fs.writeFileSync(serverPath, src, 'utf8');
console.log('Inserted GRN server block before sales order section.');
