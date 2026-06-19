import {
  buildTrialMobileGroups,
  trialAccountClosingDisplay,
  trialGroupHeaderAmount,
  trialGroupTitle,
  trialScheduleKey,
  trialRowAmounts,
} from './trialBalanceMobileDisplay';
import { trialBalanceRowKind, trialBalanceRowLabel } from './trialBalanceSort';

export function collectTrialScheduleOptions(rows) {
  const set = new Set();
  (rows || []).forEach((row) => {
    const kind = trialBalanceRowKind(row);
    if (kind !== 0 && kind !== 1) return;
    const sk = trialScheduleKey(row);
    if (sk && sk !== '_none') set.add(sk);
  });
  return Array.from(set).sort((a, b) => {
    const na = parseFloat(a);
    const nb = parseFloat(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

export function collectTrialCityOptions(rows) {
  const set = new Set();
  (rows || []).forEach((row) => {
    if (trialBalanceRowKind(row) !== 0) return;
    const city = String(row.CITY ?? row.city ?? '').trim();
    if (city) set.add(city);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function accountMatchesCity(row, cityFilter) {
  if (!cityFilter || cityFilter === 'all') return true;
  const city = String(row.CITY ?? row.city ?? '').trim();
  return city.toLowerCase() === String(cityFilter).trim().toLowerCase();
}

/** Group trial rows for desktop — schedule header first, detail accounts below. */
export function buildTrialDesktopGroups(rows, { scheduleFilter = 'all', cityFilter = 'all' } = {}) {
  let groups = buildTrialMobileGroups(rows, 'all');

  if (cityFilter !== 'all') {
    groups = groups
      .map((group) => ({
        ...group,
        accounts: group.accounts.filter((row) => accountMatchesCity(row, cityFilter)),
      }))
      .filter((group) => group.accounts.length > 0);
  }

  if (scheduleFilter !== 'all') {
    const sk = String(scheduleFilter).trim();
    groups = groups.filter((group) => group.scheduleKey === sk);
  }

  return groups.filter((group) => group.header || group.accounts.length > 0);
}

export function trialDesktopGroupStats(groups) {
  let accounts = 0;
  groups.forEach((g) => {
    accounts += g.accounts.length;
  });
  return { schedules: groups.length, accounts };
}

export { trialGroupHeaderAmount, trialGroupTitle, trialRowAmounts, trialBalanceRowLabel, trialAccountClosingDisplay };
