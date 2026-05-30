/** Group production list rows by Date + Sr.No. with voucher subtotals. */

export function productionVoucherKey(r) {
  return `${String(r.S_DATE ?? '')}|${String(r.S_NO ?? '')}`;
}

export function sumProductionVoucherGroup(group) {
  if (!group?.length) return { mW: 0, mQ: 0, pQ: 0, pW: 0, pS: 0, S_DATE: '', S_NO: '' };
  const first = group[0];
  let pQ = 0;
  let pW = 0;
  let pS = 0;
  for (const r of group) {
    pQ += Number(r.QNTY) || 0;
    pW += Number(r.WEIGHT) || 0;
    pS += Number(r.SHORT) || 0;
  }
  return {
    S_DATE: first.S_DATE,
    S_NO: first.S_NO,
    mW: Number(first.MILLING) || 0,
    mQ: Number(first.M_QNTY) || 0,
    pQ,
    pW,
    pS,
  };
}

/** @returns {{ kind: 'row', row } | { kind: 'hr' } | { kind: 'subtotal', ... }}[]} */
export function buildProductionListDisplayEntries(reportRows) {
  const rows = Array.isArray(reportRows) ? reportRows : [];
  if (!rows.length) return [];

  const entries = [];
  let group = [rows[0]];

  const flushGroup = () => {
    if (!group.length) return;
    for (const row of group) entries.push({ kind: 'row', row });
    entries.push({ kind: 'hr' });
    entries.push({ kind: 'subtotal', ...sumProductionVoucherGroup(group) });
    entries.push({ kind: 'hr' });
    group = [];
  };

  for (let i = 1; i < rows.length; i++) {
    if (productionVoucherKey(rows[i]) === productionVoucherKey(group[0])) {
      group.push(rows[i]);
    } else {
      flushGroup();
      group = [rows[i]];
    }
  }
  flushGroup();
  return entries;
}

export function sumProductionListGrandTotals(reportRows) {
  const rows = Array.isArray(reportRows) ? reportRows : [];
  if (!rows.length) return { mW: 0, mQ: 0, pQ: 0, pW: 0, pS: 0 };

  let mW = 0;
  let mQ = 0;
  let pQ = 0;
  let pW = 0;
  let pS = 0;
  let i = 0;
  while (i < rows.length) {
    const key = productionVoucherKey(rows[i]);
    const first = rows[i];
    mW += Number(first.MILLING) || 0;
    mQ += Number(first.M_QNTY) || 0;
    while (i < rows.length && productionVoucherKey(rows[i]) === key) {
      pQ += Number(rows[i].QNTY) || 0;
      pW += Number(rows[i].WEIGHT) || 0;
      pS += Number(rows[i].SHORT) || 0;
      i++;
    }
  }
  return { mW, mQ, pQ, pW, pS };
}
