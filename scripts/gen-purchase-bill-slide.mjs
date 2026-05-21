import fs from 'fs';

let c = fs.readFileSync('SRC/slides/Slide21SaleBill.jsx', 'utf8');

const reps = [
  ['Slide21SaleBill', 'Slide25PurchaseBill'],
  ['slide-21-sale-bill', 'slide-25-purchase-bill'],
  ['sale-bill-user-permissions', 'purchase-bill-user-permissions'],
  ['sale-bill-form-context', 'purchase-bill-form-context'],
  ['sale-bill-master-by-schedule', 'purchase-bill-lookups'],
  ['sale-bill-lookups', 'purchase-bill-lookups'],
  ['sale-bill-next-bill-no', 'purchase-bill-next-r-no'],
  ['sale-bill-raw', 'purchase-bill-raw'],
  ['sale-bill-save', 'purchase-bill-save'],
  ['sale-bill-pending-challans', 'purchase-bill-__skip__'],
  ['sale-bill-pending-orders', 'purchase-bill-__skip__'],
  ['sale-bill-inv-no-preview', 'purchase-bill-__skip__'],
  ['sale-bill-printing-list', 'purchase-bill-__skip__'],
  ['SaleBillPrintModal', 'PurchaseBillPrintModal'],
  ['sale-bill-entry', 'purchase-bill-entry'],
  ['Sale bill', 'Purchase bill'],
  ['sale bill', 'purchase bill'],
  ['Access denied (F1', 'Access denied (F2'],
  ['F1 position', 'F2 position'],
  ['no access (F1)', 'no access (F2)'],
  ['SALE_LIST_NUMTYPE_TO_PRINT', 'PU_PRINT_TYPE'],
  ['billDateYmd', 'rDateYmd'],
  ['setBillDateYmd', 'setRDateYmd'],
  ['billDateOracle', 'rDateOracle'],
  ['billNoRef', 'rNoRef'],
  ['billSlotFetchGenRef', 'rSlotFetchGenRef'],
  ['billNo', 'rNo'],
  ['setBillNo', 'setRNo'],
  ['Bill date', 'R date'],
  ['Bill no', 'R no'],
  ['bill number', 'R number'],
  ['Bill number', 'R number'],
  ['billed-to', 'supplier'],
  ['Billed-to', 'Supplier'],
  ['billed to', 'supplier'],
  ['schedule 8.1', 'supplier list'],
  ['schedule 11.2', 'schedule 11.20'],
  ['11.2 broker', '11.20 broker'],
  ['customers', 'parties'],
  ['lookups.customers', 'lookups.parties'],
  ['{ customers:', '{ parties:'],
  ['defaultSchedule={8.1}', 'defaultSchedule={11.1}'],
  ['G_ROUNDOFF', 'G_PUR_DANE'],
  ['G_ROFF_CODE', 'G_OTH_CODE'],
  ['G_INS_CODE', 'G_PUR_STK_G_N'],
  ['G_TDS_CODE', 'G_NTDS_CODE'],
  ['tds_on_amt', 'ntds_on_amt'],
  ['tds_per', 'ntds_per'],
  ['tds_amt', 'ntds_amt'],
  ['Tds', 'Tds'],
  ['typeNum', 'puType'],
  ['setTypeNum', 'setPuType'],
  ['vrType', 'puVrType'],
  ['bType', 'puBType'],
  ['saleInvNo', 'extBillNo'],
  ['setSaleInvNo', 'setExtBillNo'],
  ['delvCode', 'plantCodeHdr'],
  ['setDelvCode', 'setPlantCodeHdr'],
  ['bCode', 'bkCode'],
  ['setBCode', 'setBkCode'],
  ['brokerSearch', 'brokerSearch'],
  ['B code', 'Broker'],
  ['b_code', 'bk_code'],
  ['othExp', 'addExp'],
  ['setOthExp', 'setAddExp'],
  ['ins', 'lessExp'],
  ['setIns', 'setLessExp'],
  ['truckNo', 'truck'],
  ['setTruckNo', 'setTruck'],
];

for (const [a, b] of reps) c = c.split(a).join(b);

// Fixed PU type
c = c.replace(/const \[puType, setPuType\] = useState\(\d+\)/, "const puType = 'PU'");
c = c.replace(/const \[puBType, setPuBType\] = useState\([^)]+\)/, "const puBType = 'N'");
c = c.replace(/const \[puVrType, setPuVrType\] = useState\([^)]+\)/, "const puVrType = 'PU'");

// External supplier bill no field name
c = c.replace(
  /const \[extBillNo, setExtBillNo\] = useState\(''\)/,
  "const [supplierBillNo, setSupplierBillNo] = useState('')"
);
c = c.replace(/\bextBillNo\b/g, 'supplierBillNo');
c = c.replace(/\bsetExtBillNo\b/g, 'setSupplierBillNo');

// Remove duplicate lookup fetch blocks for skip APIs (comment out lines with __skip__)
c = c.replace(/[`'"]\/api\/purchase-bill-__skip__[^`'"]*[`'"]/g, "''");

fs.writeFileSync('SRC/slides/Slide25PurchaseBill.jsx', c);
console.log('Wrote Slide25PurchaseBill.jsx — manual cleanup required');
