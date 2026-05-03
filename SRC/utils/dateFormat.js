/** Local calendar yyyy-mm-dd (avoids UTC shift from toISOString). */
function localYmd(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** HTML date value or API strings → yyyy-mm-dd for <input type="date"> */
export function toInputDateString(raw) {
  if (raw == null || raw === '') return '';
  if (Object.prototype.toString.call(raw) === '[object Date]' && !isNaN(raw)) {
    return localYmd(raw);
  }
  const s = String(raw).trim();
  // Datetime string → use local calendar day (fixes Z/UTC off-by-one)
  if (/^\d{4}-\d{2}-\d{2}/.test(s) && /[T ]\d/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return localYmd(d);
  }
  const isoOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoOnly) return `${isoOnly[1]}-${isoOnly[2]}-${isoOnly[3]}`;
  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoPrefix && !/[T ]/.test(s)) {
    return `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;
  }
  const dmy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return localYmd(parsed);
  return '';
}

/** yyyy-mm-dd → DD-MM-YYYY for Oracle APIs */
export function toOracleDate(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const parts = String(yyyyMmDd).split('-');
  if (parts.length !== 3 || parts[0].length !== 4) return '';
  const [y, m, d] = parts;
  return `${d}-${m}-${y}`;
}

/** yyyy-mm-dd → dd/mm/yyyy for labels */
export function toDisplayDate(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const parts = String(yyyyMmDd).split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

/** Ledger VR_DATE (ISO, Oracle, etc.) → dd/mm/yyyy */
export function formatLedgerDateDisplay(raw) {
  if (raw == null || raw === '') return '';
  const ymd = toInputDateString(raw);
  if (ymd) return toDisplayDate(ymd);
  const s = String(raw).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  return s;
}

/** Account row from /api/accounts (Oracle may return UPPER or lower case keys). */
export function getCurBal(row) {
  if (!row) return undefined;
  return row.CUR_BAL ?? row.cur_bal;
}

/** Ledger / account list balance column */
export function formatCurBal(val) {
  if (val == null || val === '') return '—';
  const n = Number(val);
  if (Number.isNaN(n)) return String(val);
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
