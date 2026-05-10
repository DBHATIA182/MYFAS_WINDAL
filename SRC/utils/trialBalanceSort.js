/** Numeric schedule for ordering; null/empty → last (e.g. ROLLUP grand total). */
export function trialScheduleSortKey(row) {
  const s = row.SCHEDULE ?? row.schedule ?? row.SCH_NO ?? row.sch_no;
  if (s == null || s === '') return Number.POSITIVE_INFINITY;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n;
  return Number.POSITIVE_INFINITY;
}

/** 0 = detail, 1 = schedule (or other) total row, 2 = grand total — keeps ROLLUP-style rows after accounts. */
export function trialBalanceRowKind(row) {
  const codeVal = row.CODE ?? row.code;
  const nameVal = row.NAME ?? row.name;
  const nameUpper = String(nameVal ?? '').toUpperCase();
  const isTotal =
    codeVal == null || codeVal === '' || (nameVal && nameUpper.includes('TOTAL'));
  if (!isTotal) return 0;
  if (nameUpper.includes('GRAND')) return 2;
  return 1;
}

export function compareTrialBalanceRows(a, b) {
  const d = trialScheduleSortKey(a) - trialScheduleSortKey(b);
  if (d !== 0) return d;
  const ka = trialBalanceRowKind(a);
  const kb = trialBalanceRowKind(b);
  if (ka !== kb) return ka - kb;
  return String(a.NAME ?? a.name ?? '').localeCompare(String(b.NAME ?? b.name ?? ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

export function sortTrialBalanceRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];
  return [...rows].sort(compareTrialBalanceRows);
}
