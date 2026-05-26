/** FoxPro BROWCAL / CD_CAL — cash discount on bill amount (DR_AMT). */

export function calcCdAmtFromPercent(drAmt, cdPer) {
  const dr = Number(drAmt) || 0;
  const pct = Number(cdPer) || 0;
  if (pct === 0) return 0;
  return Math.round(((dr * pct) / 100) * 100) / 100;
}

/** ADJ_AMT = (DR_AMT + INT_AMT) - CD_AMT when CD_PER <> 0 (VFP CD_CAL). */
export function calcAdjAmtAfterCd({ drAmt, intAmt, cdPer, cdAmt }) {
  const dr = Number(drAmt) || 0;
  const intVal = Number(intAmt) || 0;
  const pct = Number(cdPer) || 0;
  const cd =
    pct !== 0
      ? calcCdAmtFromPercent(dr, pct)
      : Math.max(0, Number(cdAmt) || 0);
  const adj = dr + intVal - cd;
  return Math.round(Math.max(0, adj) * 100) / 100;
}

/** Apply CD_CAL to a pending-bill row; returns patched row fields. */
export function applyCdCalToBillRow(row) {
  const drAmt = Number(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
  const intAmt = Number(row.INT_AMT ?? row.int_amt ?? 0) || 0;
  const cdPerRaw = String(row.CD_PER ?? row.cd_per ?? '').replace(/,/g, '').trim();
  const cdPer = cdPerRaw === '' ? 0 : Number(cdPerRaw) || 0;
  const cdAmt = calcCdAmtFromPercent(drAmt, cdPer);
  const adjAmt = calcAdjAmtAfterCd({ drAmt, intAmt, cdPer, cdAmt });
  return {
    CD_PER: cdPerRaw,
    CD_AMT: cdAmt > 0 ? cdAmt.toFixed(2) : '',
    ADJ_AMT: adjAmt > 0 ? adjAmt.toFixed(2) : '',
  };
}
