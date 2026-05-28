/** Opening balance + movement totals for ledger summary cards / PDF. */
export function computeLedgerSummary(rows) {
  let opening = 0;
  let sumDr = 0;
  let sumCr = 0;
  (rows || []).forEach((row) => {
    const vr = String(row.VR_TYPE ?? row.vr_type ?? '').trim().toUpperCase();
    const dr = parseFloat(row.DR_AMT ?? row.dr_amt) || 0;
    const cr = parseFloat(row.CR_AMT ?? row.cr_amt) || 0;
    if (vr === 'OP') {
      opening = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal) || 0;
    } else {
      sumDr += dr;
      sumCr += cr;
    }
  });
  const last = rows?.length ? rows[rows.length - 1] : null;
  const closing = last
    ? parseFloat(last.CL_BALANCE ?? last.cl_balance ?? last.RUN_BAL ?? last.run_bal) || 0
    : 0;
  return { opening, sumDr, sumCr, closing };
}
