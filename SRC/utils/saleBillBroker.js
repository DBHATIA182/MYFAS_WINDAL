/** Broker MASTER.SELF_BROK — "Less brokerage" prints only when Y. */
export function isSaleBillSelfBroker(row) {
  if (!row || typeof row !== 'object') return false;
  const v =
    row.BROKER_SELF_BROK ??
    row.broker_self_brok ??
    row.SELF_BROK ??
    row.self_brok;
  return String(v ?? 'N').trim().toUpperCase() === 'Y';
}

export function showSaleBillLessBrokerage(firstRow, totals) {
  if (!isSaleBillSelfBroker(firstRow)) return false;
  return Math.abs(Number(totals?.sumBk ?? 0)) > 0.0001;
}
