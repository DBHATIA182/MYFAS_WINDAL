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

/**
 * Sale chart month key (YYYY-MM) → start/end yyyy-mm-dd for that calendar month,
 * clipped to optional financial-year bounds (yyyy-mm-dd).
 */
export function monthKeyToInputDateRange(monthKey, fyStartYmd = '', fyEndYmd = '') {
  const mk = String(monthKey ?? '').trim();
  if (!mk || mk.startsWith('__prev_pad')) return null;
  const seg = mk.split('-');
  if (seg.length < 2) return null;
  const y = parseInt(seg[0], 10);
  const m = parseInt(seg[1], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;

  let start = new Date(y, m - 1, 1);
  let end = new Date(y, m, 0);

  const clipStart = toInputDateString(fyStartYmd);
  const clipEnd = toInputDateString(fyEndYmd);
  if (clipStart) {
    const [ys, ms, ds] = clipStart.split('-').map(Number);
    const fyS = new Date(ys, ms - 1, ds);
    if (start < fyS) start = fyS;
  }
  if (clipEnd) {
    const [ye, me, de] = clipEnd.split('-').map(Number);
    const fyE = new Date(ye, me - 1, de);
    if (end > fyE) end = fyE;
  }
  if (start > end) return null;
  return { start: localYmd(start), end: localYmd(end) };
}

/** yyyy-mm-dd → dd/mm/yyyy for labels */
export function toDisplayDate(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const parts = String(yyyyMmDd).split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

/** Keep only a valid yyyy-mm-dd for `<input type="date">` (rejects pasted dd/mm/yyyy garbage). */
export function normalizeHtmlDateValue(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return toInputDateString(raw);
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
