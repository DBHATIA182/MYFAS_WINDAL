import {
  sortTrialBalanceRows,
  trialBalanceRowKind,
  trialBalanceRowLabel,
} from './trialBalanceSort';

export function trialScheduleKey(row) {
  return String(row?.SCHEDULE ?? row?.schedule ?? row?.SCH_NO ?? row?.sch_no ?? '').trim();
}

export function trialRowAmounts(row) {
  return {
    closingDr: parseFloat(row?.CLOSING_DR ?? row?.closing_dr ?? 0) || 0,
    closingCr: parseFloat(row?.CLOSING_CR ?? row?.closing_cr ?? 0) || 0,
    drAmt: parseFloat(row?.DR_AMT ?? row?.dr_amt ?? 0) || 0,
    crAmt: parseFloat(row?.CR_AMT ?? row?.cr_amt ?? 0) || 0,
  };
}

export function formatTrialIndianAmount(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Primary closing balance display for account card header. */
export function trialAccountClosingDisplay(row) {
  const { closingDr, closingCr } = trialRowAmounts(row);
  if (closingDr > 0) return { amount: closingDr, side: 'Dr', tone: 'dr' };
  if (closingCr > 0) return { amount: closingCr, side: 'Cr', tone: 'cr' };
  return { amount: 0, side: '', tone: 'neutral' };
}

export function trialAccountCode(row) {
  const code = row?.CODE ?? row?.code;
  if (code == null || String(code).trim() === '' || String(code).trim() === '0') return '';
  return String(code).trim();
}

export function filterTrialAccountRow(row, filter) {
  if (trialBalanceRowKind(row) !== 0) return false;
  const a = trialRowAmounts(row);
  if (filter === 'all') return true;
  if (filter === 'balance') return a.closingDr > 0 || a.closingCr > 0;
  if (filter === 'unbalanced') return a.drAmt > 0 && a.crAmt > 0;
  return true;
}

export function buildTrialMobileGroups(rows, filter = 'all') {
  const sorted = sortTrialBalanceRows(rows || []).filter((r) => trialBalanceRowKind(r) !== 2);
  const groupsMap = new Map();

  sorted.forEach((row) => {
    const kind = trialBalanceRowKind(row);
    const sk = trialScheduleKey(row) || '_none';
    if (!groupsMap.has(sk)) {
      groupsMap.set(sk, { scheduleKey: sk, header: null, accounts: [] });
    }
    const group = groupsMap.get(sk);
    if (kind === 1) {
      group.header = row;
    } else if (kind === 0 && filterTrialAccountRow(row, filter)) {
      group.accounts.push(row);
    }
  });

  return Array.from(groupsMap.values()).filter((g) => g.header || g.accounts.length > 0);
}

export function trialGroupTitle(group) {
  if (group.header) return trialBalanceRowLabel(group.header);
  const first = group.accounts[0];
  if (!first) return group.scheduleKey === '_none' ? 'Accounts' : `Schedule ${group.scheduleKey}`;
  const schName = String(first.SCH_NAME ?? first.sch_name ?? '').trim();
  const sk = trialScheduleKey(first);
  if (schName && sk) return `${sk} ${schName}`;
  return schName || (sk ? `Schedule ${sk}` : 'Accounts');
}

export function trialGroupHeaderAmount(group) {
  if (group.header) {
    const { closingDr, closingCr } = trialRowAmounts(group.header);
    if (closingDr > 0) return { amount: closingDr, side: 'Dr', tone: 'dr' };
    if (closingCr > 0) return { amount: closingCr, side: 'Cr', tone: 'cr' };
    const dr = parseFloat(group.header.DR_AMT ?? group.header.dr_amt ?? 0) || 0;
    const cr = parseFloat(group.header.CR_AMT ?? group.header.cr_amt ?? 0) || 0;
    if (dr >= cr && dr > 0) return { amount: dr, side: 'Dr', tone: 'dr' };
    if (cr > 0) return { amount: cr, side: 'Cr', tone: 'cr' };
  }
  let dr = 0;
  let cr = 0;
  group.accounts.forEach((row) => {
    const a = trialAccountClosingDisplay(row);
    if (a.tone === 'dr') dr += a.amount;
    else if (a.tone === 'cr') cr += a.amount;
  });
  if (dr >= cr && dr > 0) return { amount: dr, side: 'Dr', tone: 'dr' };
  if (cr > 0) return { amount: cr, side: 'Cr', tone: 'cr' };
  return { amount: 0, side: '', tone: 'neutral' };
}

export function trialAccountRowKey(row, index) {
  const code = trialAccountCode(row);
  return code ? `acc-${code}` : `acc-${index}-${trialScheduleKey(row)}`;
}
