import { formatLedgerDateDisplay, toDisplayDate } from './dateFormat';

export const LEDGER_SALE_VR_TYPES_SET = new Set(['SL', 'SE', 'CN']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

export function formatBalanceDrCr(val) {
  const n = parseFloat(val) || 0;
  const abs = formatIndianLedgerAmount(Math.abs(n));
  if (n < 0) return `${abs} Cr`;
  if (n > 0) return `${abs} Dr`;
  return abs;
}

/** Running balance from ledger row (CL_BALANCE / RUN_BAL). */
export function ledgerMobileRowRunBal(row) {
  return (
    parseFloat(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal ?? 0) || 0
  );
}

/** Compact "Bal ₹1,32,500" for transaction cards */
export function formatLedgerMobileRowBal(row) {
  const n = ledgerMobileRowRunBal(row);
  const abs = formatIndianLedgerAmount(Math.abs(n));
  if (n < 0) return `Bal ₹${abs} Cr`;
  if (n > 0) return `Bal ₹${abs} Dr`;
  return `Bal ₹${abs}`;
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

export function filterLedgerMobileRows(rows, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const vr = String(row.VR_TYPE ?? row.vr_type ?? '').toLowerCase();
    const vrNo = String(row.VR_NO ?? row.vr_no ?? '').toLowerCase();
    const detail = String(row.DETAIL ?? row.detail ?? '').toLowerCase();
    const dt = formatLedgerMobileShortDate(row.VR_DATE ?? row.vr_date).toLowerCase();
    return vr.includes(q) || vrNo.includes(q) || detail.includes(q) || dt.includes(q);
  });
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
