/**
 * VFP MHEAD from SALE.TYPE numeric 1–9 (GrainFAS sale bill print).
 * Type 1 also depends on global MON (retail); when unknown, use tax heuristic.
 */
export function saleBillDocTitleFromVfpType(typeNum, options = {}) {
  const n = Number(typeNum);
  if (!Number.isFinite(n)) return null;
  const monO = options.monO;
  const billTaxSum = Number(options.billTaxSum);
  const taxOk = Number.isFinite(billTaxSum) && Math.abs(billTaxSum) > 0.0001;

  switch (n) {
    case 1: {
      if (monO === true || monO === 'O' || monO === 'Y' || monO === 'y') return 'RETAIL INVOICE';
      if (monO === false || monO === 'N' || monO === 'n') return 'BILL OF SUPPLY';
      return taxOk ? 'RETAIL INVOICE' : 'BILL OF SUPPLY';
    }
    case 2:
      return 'BILL OF SUPPLY';
    case 3:
    case 6:
    case 9:
      return 'TAX INVOICE';
    case 4:
    case 8:
      return 'CREDIT NOTE';
    case 5:
      return 'GOODS RETURN NOTE';
    case 7:
      return 'DEBIT NOTE';
    default:
      return null;
  }
}

/** True when SALE.TYPE corresponds to ledger / print “credit note” UX (bill no emphasis). */
export function saleBillOracleTypeIsCreditNote(typeNum) {
  const n = Number(typeNum);
  return n === 4 || n === 8;
}

/** Printable “Unit” from SALE.STATUS on bill lines (Fox-style bag / katta / hkatta). */
export function saleBillStatusUnitLabel(statusRaw) {
  const c = String(statusRaw ?? '').trim().toUpperCase().charAt(0);
  if (c === 'B') return 'Bags';
  if (c === 'K') return 'Katta';
  if (c === 'H') return 'HKATTA';
  return '';
}
