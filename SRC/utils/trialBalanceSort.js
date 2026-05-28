/** Numeric schedule for ordering; null/empty → last (e.g. ROLLUP grand total). */
export function trialScheduleSortKey(row) {
  const s = row.SCHEDULE ?? row.schedule ?? row.SCH_NO ?? row.sch_no;
  if (s == null || s === '') return Number.POSITIVE_INFINITY;
  const n = parseFloat(s);
  if (Number.isFinite(n)) return n;
  return Number.POSITIVE_INFINITY;
}

function isBlankAccountCode(codeVal) {
  if (codeVal == null || codeVal === '') return true;
  const s = String(codeVal).trim();
  return s === '' || s === '0';
}

function rowNum(row, ...keys) {
  for (const k of keys) {
    if (row[k] == null || row[k] === '') continue;
    const n = parseFloat(row[k]);
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

/** 0 = detail, 1 = schedule (or other) total row, 2 = grand total — keeps ROLLUP-style rows after accounts. */
export function trialBalanceRowKind(row) {
  const codeVal = row.CODE ?? row.code;
  const nameVal = row.NAME ?? row.name;
  const nameUpper = String(nameVal ?? '').toUpperCase();
  const isTotal =
    isBlankAccountCode(codeVal) || (nameVal && nameUpper.includes('TOTAL'));
  if (!isTotal) return 0;
  if (nameUpper.includes('GRAND')) return 2;
  return 1;
}

export function findTrialGrandRow(rows) {
  return (rows || []).find((r) => trialBalanceRowKind(r) === 2) ?? null;
}

function sumTrialDetailAmounts(rows, ...keys) {
  let total = 0;
  (rows || []).forEach((row) => {
    if (trialBalanceRowKind(row) !== 0) return;
    total += rowNum(row, ...keys);
  });
  return total;
}

/** Top summary cards + PDF boxes: closing balances from grand total (matches table footer). */
export function computeTrialTopSummary(rows) {
  const list = rows || [];
  const grand = findTrialGrandRow(list);
  let closingDr = 0;
  let closingCr = 0;
  let periodDr = 0;
  let periodCr = 0;

  if (grand) {
    closingDr = rowNum(grand, 'CLOSING_DR', 'closing_dr');
    closingCr = rowNum(grand, 'CLOSING_CR', 'closing_cr');
    periodDr = rowNum(grand, 'DR_AMT', 'dr_amt');
    periodCr = rowNum(grand, 'CR_AMT', 'cr_amt');
  } else {
    list.forEach((row) => {
      if (trialBalanceRowKind(row) !== 1) return;
      closingDr += rowNum(row, 'CLOSING_DR', 'closing_dr');
      closingCr += rowNum(row, 'CLOSING_CR', 'closing_cr');
      periodDr += rowNum(row, 'DR_AMT', 'dr_amt');
      periodCr += rowNum(row, 'CR_AMT', 'cr_amt');
    });
  }

  const detailClosingDr = sumTrialDetailAmounts(list, 'CLOSING_DR', 'closing_dr');
  const detailClosingCr = sumTrialDetailAmounts(list, 'CLOSING_CR', 'closing_cr');
  const detailPeriodDr = sumTrialDetailAmounts(list, 'DR_AMT', 'dr_amt');
  const detailPeriodCr = sumTrialDetailAmounts(list, 'CR_AMT', 'cr_amt');
  if (detailClosingDr > closingDr + 0.005) closingDr = detailClosingDr;
  if (detailClosingCr > closingCr + 0.005) closingCr = detailClosingCr;
  if (detailPeriodDr > periodDr + 0.005) periodDr = detailPeriodDr;
  if (detailPeriodCr > periodCr + 0.005) periodCr = detailPeriodCr;

  return { closingDr, closingCr, periodDr, periodCr };
}

/** Display name for PDF / screen (Oracle ROLLUP: TOTAL {schedule name} {no}). */
export function trialBalanceRowLabel(row) {
  const nameVal = String(row.NAME ?? row.name ?? '').trim();
  const schName = String(row.SCH_NAME ?? row.sch_name ?? '').trim();
  const sch = row.SCHEDULE ?? row.schedule ?? '';
  const kind = trialBalanceRowKind(row);

  if (kind === 2) {
    const u = nameVal.toUpperCase();
    return u.includes('GRAND') ? nameVal || 'GRAND TOTAL' : nameVal || 'GRAND TOTAL';
  }
  if (kind === 1) {
    if (nameVal && /TOTAL/i.test(nameVal)) return nameVal;
    if (schName) {
      const schPart = sch !== '' && sch != null ? ` ${sch}` : '';
      return `TOTAL ${schName}${schPart}`.trim();
    }
    return nameVal || (sch !== '' && sch != null ? `Schedule ${sch}` : 'Schedule total');
  }
  return nameVal;
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
