/**
 * Ageing "Cur. Bal" display rules:
 * - Schedule 8.10 (debtors): negative balance → show as negative, highlighted.
 * - Other schedules (creditors): positive balance → show as negative, highlighted.
 */

export function isAgeingSchedule810(scheduleRaw) {
  const n = parseFloat(String(scheduleRaw ?? '').trim());
  if (!Number.isFinite(n)) return false;
  return Math.round(n * 100) / 100 === 8.1;
}

/**
 * @param {unknown} scheduleRaw
 * @param {unknown} curBalRaw
 * @returns {{ display: number, alert: boolean }}
 */
export function ageingCurBalDisplay(scheduleRaw, curBalRaw) {
  const bal = parseFloat(curBalRaw) || 0;
  if (isAgeingSchedule810(scheduleRaw)) {
    if (bal < 0) return { display: bal, alert: true };
    return { display: bal, alert: false };
  }
  if (bal > 0) return { display: -bal, alert: true };
  return { display: bal, alert: false };
}
