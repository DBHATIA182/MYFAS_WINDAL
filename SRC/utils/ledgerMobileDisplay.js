import { formatLedgerDateDisplay, toDisplayDate } from './dateFormat';

export const LEDGER_SALE_VR_TYPES_SET = new Set(['SL', 'SE', 'CN']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Ignore sub-paisa noise when classifying Dr vs Cr on a row. */
export const LEDGER_AMT_EPS = 0.005;

/** Parse ledger amount fields (handles commas / string numbers from Oracle). */
export function parseLedgerAmount(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const cleaned = String(val).replace(/,/g, '').replace(/\s/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeLedgerAmountSide(amountSide) {
  const side = String(amountSide ?? 'all')
    .trim()
    .toLowerCase();
  if (side === 'dr' || side === 'debit') return 'dr';
  if (side === 'cr' || side === 'credit') return 'cr';
  return 'all';
}

/** dd/mm/yyyy or ISO → "15 Apr 2023" for mobile cards */
export function formatLedgerMobileShortDate(raw) {
  const ddmmyyyy = formatLedgerDateDisplay(raw);
  if (!ddmmyyyy) return '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddmmyyyy);
  if (!m) return ddmmyyyy;
  const day = parseInt(m[1], 10);
  const mon = parseInt(m[2], 10);
  const year = m[3];
  const label = MONTHS[mon - 1];
  if (!label) return ddmmyyyy;
  return `${day} ${label} ${year}`;
}

/** yyyy-mm-dd → "01 Apr 2023" */
export function formatParamMobileDate(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const parts = String(yyyyMmDd).split('-');
  if (parts.length !== 3) return toDisplayDate(yyyyMmDd);
  const day = parseInt(parts[2], 10);
  const mon = parseInt(parts[1], 10);
  const label = MONTHS[mon - 1];
  if (!label) return toDisplayDate(yyyyMmDd);
  return `${String(day).padStart(2, '0')} ${label} ${parts[0]}`;
}

export function formatIndianLedgerAmount(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Dr = positive, Cr = negative — signed amount string with ₹ prefix. */
export function formatSignedLedgerAmount(signedVal) {
  const n = parseLedgerAmount(signedVal);
  if (Math.abs(n) < LEDGER_AMT_EPS) return '₹0.00';
  const abs = formatIndianLedgerAmount(Math.abs(n));
  if (n < 0) return `−₹${abs}`;
  return `₹${abs}`;
}

/** Signed line amount: Dr column → +, Cr column → −. */
export function ledgerRowSignedAmount(row) {
  const side = ledgerRowEntrySide(row);
  const dr = ledgerRowDrAmt(row);
  const cr = ledgerRowCrAmt(row);
  if (side === 'dr') return dr;
  if (side === 'cr') return -cr;
  return 0;
}

export function formatBalanceDrCr(val) {
  return formatSignedLedgerAmount(val);
}

/** Running balance from ledger row (CL_BALANCE / RUN_BAL). */
export function ledgerMobileRowRunBal(row) {
  return (
    parseFloat(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal ?? 0) || 0
  );
}

/** Compact running balance — Dr positive, Cr negative. */
export function formatLedgerMobileRowBal(row) {
  const n = ledgerMobileRowRunBal(row);
  return `Bal ${formatSignedLedgerAmount(n)}`;
}

/** Voucher type → { tone, icon, label } for mobile chips */
export function ledgerMobileVrMeta(vrType) {
  const code = String(vrType ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!code || code === 'OP') {
    return { tone: 'neutral', icon: '📒', label: code || '—' };
  }
  if (['SL', 'SE', 'CN', 'SALE', 'SALES'].includes(code) || code.startsWith('SL')) {
    return { tone: 'sale', icon: '🛒', label: code };
  }
  if (['PR', 'PU', 'PI', 'PUCH', 'PUR', 'PURCHASE'].includes(code) || code.startsWith('PR')) {
    return { tone: 'purchase', icon: '📦', label: code };
  }
  if (['RC', 'RV', 'CR', 'RECEIPT', 'REC'].includes(code) || code.startsWith('RC')) {
    return { tone: 'receipt', icon: '💰', label: code };
  }
  if (['PY', 'PT', 'PV', 'PAY', 'PAYMENT'].includes(code) || code.startsWith('PY')) {
    return { tone: 'payment', icon: '💸', label: code };
  }
  if (['JV', 'JN', 'JOURNAL', 'JNL'].includes(code) || code.startsWith('JV')) {
    return { tone: 'journal', icon: '📝', label: code };
  }
  if (['EX', 'EP', 'EXP', 'EXPENSE'].includes(code) || code.startsWith('EX')) {
    return { tone: 'expense', icon: '🧾', label: code };
  }
  return { tone: 'neutral', icon: '📄', label: code };
}

export function ledgerMobileRowTitle(row) {
  const detail = String(row.DETAIL ?? row.detail ?? '').trim();
  if (detail) return detail;
  const vrType = row.VR_TYPE ?? row.vr_type;
  const vrNo = row.VR_NO ?? row.vr_no;
  const meta = ledgerMobileVrMeta(vrType);
  if (vrNo != null && String(vrNo).trim() !== '') {
    return `${meta.label} · ${vrNo}`;
  }
  return meta.label;
}

export function ledgerMobileRowClickable(row, { onVoucherClick, onLedgerSaleBillClick }) {
  const vrType = row.VR_TYPE ?? row.vr_type;
  const vrNo = row.VR_NO ?? row.vr_no;
  const vrUpper = vrType ? String(vrType).toUpperCase() : '';
  const canSaleBill =
    typeof onLedgerSaleBillClick === 'function' &&
    vrUpper &&
    LEDGER_SALE_VR_TYPES_SET.has(vrUpper) &&
    vrNo != null &&
    String(vrNo).trim() !== '' &&
    Number(vrNo) > 0;
  const canDrill =
    !canSaleBill &&
    typeof onVoucherClick === 'function' &&
    vrNo != null &&
    String(vrNo).trim() !== '' &&
    Number(vrNo) > 0;
  return { canSaleBill, canDrill, clickable: canSaleBill || canDrill };
}

export function isLedgerOpeningRow(row) {
  return (
    String(row?.VR_TYPE ?? row?.vr_type ?? '')
      .trim()
      .toUpperCase() === 'OP'
  );
}

function fieldStr(v) {
  if (v == null) return '';
  return String(v).trim();
}

function amtSearchParts(val) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return [];
  const abs = Math.abs(n);
  const parts = [
    String(n),
    String(abs),
    formatIndianLedgerAmount(n),
    formatIndianLedgerAmount(abs),
    n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  ];
  if (Number.isInteger(abs)) parts.push(String(Math.trunc(abs)));
  return parts;
}

/** Lowercase haystack from every ledger column (for filter matching). */
export function buildLedgerRowSearchText(row, { includeInterest = false } = {}) {
  const vrDate = row.VR_DATE ?? row.vr_date;
  const valueDate = row.V_DATE ?? row.v_date;
  const clBal = ledgerMobileRowRunBal(row);
  const drAmt = ledgerRowDrAmt(row);
  const crAmt = ledgerRowCrAmt(row);

  const parts = [
    fieldStr(vrDate),
    formatLedgerDateDisplay(vrDate),
    formatLedgerMobileShortDate(vrDate),
    fieldStr(valueDate),
    formatLedgerDateDisplay(valueDate),
    formatLedgerMobileShortDate(valueDate),
    fieldStr(row.VR_NO ?? row.vr_no),
    fieldStr(row.VR_TYPE ?? row.vr_type),
    fieldStr(row.TYPE ?? row.type),
    fieldStr(row.DETAIL ?? row.detail),
    ...amtSearchParts(row.DR_AMT ?? row.dr_amt),
    ...amtSearchParts(row.CR_AMT ?? row.cr_amt),
    ...amtSearchParts(clBal),
    formatSignedLedgerAmount(clBal),
    formatSignedLedgerAmount(-Math.abs(clBal)),
    formatIndianLedgerAmount(Math.abs(clBal)),
    clBal < 0 ? 'cr credit' : clBal > 0 ? 'dr debit' : '',
    drAmt > 0 ? 'dr debit' : '',
    crAmt > 0 ? 'cr credit' : '',
  ];

  if (includeInterest) {
    const drDays = parseFloat(row.DR_DAYS ?? row.dr_days ?? 0) || 0;
    const crDays = parseFloat(row.CR_DAYS ?? row.cr_days ?? 0) || 0;
    parts.push(
      fieldStr(row.DR_DAYS ?? row.dr_days),
      fieldStr(row.CR_DAYS ?? row.cr_days),
      String(drDays),
      String(crDays),
      ...amtSearchParts(row.DR_INTEREST ?? row.dr_interest),
      ...amtSearchParts(row.CR_INTEREST ?? row.cr_interest)
    );
  }

  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function ledgerRowMatchesFilter(row, query, options = {}) {
  const tokens = String(query ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return true;
  const blob = buildLedgerRowSearchText(row, options);
  const vrCode = ledgerRowVrTypeCode(row).toLowerCase();
  const lineType = String(row?.TYPE ?? row?.type ?? '')
    .trim()
    .toLowerCase();
  return tokens.every((t) => {
    if (t.length <= 4 && (t === vrCode || (lineType && t === lineType))) return true;
    return blob.includes(t);
  });
}

export function ledgerRowDrAmt(row) {
  return parseLedgerAmount(row?.DR_AMT ?? row?.dr_amt);
}

export function ledgerRowCrAmt(row) {
  return parseLedgerAmount(row?.CR_AMT ?? row?.cr_amt);
}

/** Which side this ledger line posts on (Dr or Cr column). */
export function ledgerRowEntrySide(row) {
  const dr = ledgerRowDrAmt(row);
  const cr = ledgerRowCrAmt(row);
  const hasDr = dr > LEDGER_AMT_EPS;
  const hasCr = cr > LEDGER_AMT_EPS;
  if (hasDr && !hasCr) return 'dr';
  if (hasCr && !hasDr) return 'cr';
  if (hasDr && hasCr) return dr >= cr ? 'dr' : 'cr';
  return 'none';
}

/** @param {'all'|'dr'|'cr'} amountSide */
export function ledgerRowMatchesAmountSide(row, amountSide) {
  const side = normalizeLedgerAmountSide(amountSide);
  if (side === 'all') return true;
  return ledgerRowEntrySide(row) === side;
}

export function ledgerRowVrTypeCode(row) {
  return String(row?.VR_TYPE ?? row?.vr_type ?? '')
    .trim()
    .toUpperCase();
}

/** Unique Vr.Type codes from transaction rows (excludes OP), sorted. */
export function collectLedgerVrTypes(rows) {
  const set = new Set();
  (rows || []).forEach((row) => {
    if (isLedgerOpeningRow(row)) return;
    const code = ledgerRowVrTypeCode(row);
    if (code) set.add(code);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function ledgerRowMatchesVrType(row, vrTypeFilter) {
  if (!vrTypeFilter || vrTypeFilter === 'all') return true;
  return ledgerRowVrTypeCode(row) === String(vrTypeFilter).trim().toUpperCase();
}

export function ledgerRowMatchesFilters(
  row,
  query,
  { includeInterest = false, amountSide = 'all', vrType = 'all' } = {}
) {
  if (!ledgerRowMatchesAmountSide(row, amountSide)) return false;
  if (!ledgerRowMatchesVrType(row, vrType)) return false;
  return ledgerRowMatchesFilter(row, query, { includeInterest });
}

export function filterLedgerMobileRows(rows, query, options = {}) {
  const amountSide = normalizeLedgerAmountSide(options.amountSide);
  const vrType = options.vrType ?? 'all';
  const { amountSide: _dropSide, vrType: _dropVr, ...rest } = options;
  if (!ledgerFilterIsActive(query, amountSide, vrType)) return rows || [];
  return (rows || []).filter((row) =>
    ledgerRowMatchesFilters(row, query, { ...rest, amountSide, vrType })
  );
}

export function ledgerFilterIsActive(query, amountSide = 'all', vrType = 'all') {
  const side = normalizeLedgerAmountSide(amountSide);
  return (
    Boolean(String(query ?? '').trim()) ||
    side === 'dr' ||
    side === 'cr' ||
    (vrType && vrType !== 'all')
  );
}

/** Filter ledger rows; opening (OP) rows stay visible when keepOpening is true. */
export function filterLedgerRows(
  rows,
  query,
  { keepOpening = true, includeInterest = false, amountSide = 'all', vrType = 'all' } = {}
) {
  const side = normalizeLedgerAmountSide(amountSide);
  if (!ledgerFilterIsActive(query, side, vrType)) return rows || [];

  const list = rows || [];
  const opening = keepOpening ? list.filter(isLedgerOpeningRow) : [];
  const txn = keepOpening ? list.filter((r) => !isLedgerOpeningRow(r)) : list;
  const filteredTxn = txn.filter((row) =>
    ledgerRowMatchesFilters(row, query, { includeInterest, amountSide: side, vrType })
  );
  return [...opening, ...filteredTxn];
}

export function countLedgerFilterStats(rows, query, { includeInterest = false, amountSide = 'all', vrType = 'all' } = {}) {
  const side = normalizeLedgerAmountSide(amountSide);
  const list = rows || [];
  const txn = list.filter((r) => !isLedgerOpeningRow(r));
  if (!ledgerFilterIsActive(query, side, vrType)) return { shown: txn.length, total: txn.length };
  const shown = txn.filter((row) =>
    ledgerRowMatchesFilters(row, query, { includeInterest, amountSide: side, vrType })
  ).length;
  return { shown, total: txn.length };
}

export function splitLedgerMobileRows(rows) {
  const openingRows = [];
  const txnRows = [];
  (rows || []).forEach((row, i) => {
    const vr = String(row.VR_TYPE ?? row.vr_type ?? '')
      .trim()
      .toUpperCase();
    if (vr === 'OP') openingRows.push({ row, i });
    else txnRows.push({ row, i });
  });
  return { openingRows, txnRows };
}
