import { toInputDateString, toDisplayDate } from './dateFormat';

function n(row, upperKey, lowerKey) {
  const v = row[upperKey] ?? row[lowerKey];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

/** Credit-style sale lines: VFP ptype 8 / TYPE 8, or CHAR CN / GN / CX. */
export function isSaleListCn(row) {
  const raw = row?.TYPE ?? row?.type;
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '').trim());
  if (Number.isFinite(num) && Math.round(num) === 8) return true;
  const t = String(raw ?? '').trim().toUpperCase();
  return t === 'CN' || t === 'GN' || t === 'CX';
}

export function saleListMeas(row, upperKey, lowerKey) {
  const v = n(row, upperKey, lowerKey);
  return isSaleListCn(row) ? -v : v;
}

function dayKey(row) {
  return toInputDateString(row.BILL_DATE ?? row.bill_date) || '_nodate';
}

function itemCode(row) {
  return String(row.ITEM_CODE ?? row.item_code ?? '').trim();
}

function itemName(row) {
  return String(row.ITEM_NAME ?? row.item_name ?? '').trim();
}

function textOf(row, upper, lower) {
  return String(row?.[upper] ?? row?.[lower] ?? '').trim();
}

function cmpText(a, b) {
  return String(a).localeCompare(String(b), 'en', { sensitivity: 'base', numeric: true });
}

function compareLines(a, b) {
  const da = dayKey(a).localeCompare(dayKey(b));
  if (da !== 0) return da;
  const ta = String(a.TYPE ?? a.type ?? '').trim().toUpperCase();
  const tb = String(b.TYPE ?? b.type ?? '').trim().toUpperCase();
  const dt = ta.localeCompare(tb);
  if (dt !== 0) return dt;
  const bn = String(a.BILL_NO ?? a.bill_no ?? '').localeCompare(String(b.BILL_NO ?? b.bill_no ?? ''), undefined, {
    numeric: true,
  });
  if (bn !== 0) return bn;
  const bt = String(a.B_TYPE ?? a.b_type ?? '').localeCompare(String(b.B_TYPE ?? b.b_type ?? ''));
  if (bt !== 0) return bt;
  return (parseFloat(a.TRN_NO ?? a.trn_no) || 0) - (parseFloat(b.TRN_NO ?? b.trn_no) || 0);
}

function compareByParty(a, b) {
  const nCmp = cmpText(textOf(a, 'NAME', 'name'), textOf(b, 'NAME', 'name'));
  if (nCmp !== 0) return nCmp;
  const cCmp = cmpText(textOf(a, 'CODE', 'code'), textOf(b, 'CODE', 'code'));
  if (cCmp !== 0) return cCmp;
  return compareLines(a, b);
}

function compareByItem(a, b) {
  const nCmp = cmpText(textOf(a, 'ITEM_NAME', 'item_name'), textOf(b, 'ITEM_NAME', 'item_name'));
  if (nCmp !== 0) return nCmp;
  const cCmp = cmpText(textOf(a, 'ITEM_CODE', 'item_code'), textOf(b, 'ITEM_CODE', 'item_code'));
  if (cCmp !== 0) return cCmp;
  return compareLines(a, b);
}

function compareByBroker(a, b) {
  const nCmp = cmpText(textOf(a, 'BK_NAME', 'bk_name'), textOf(b, 'BK_NAME', 'bk_name'));
  if (nCmp !== 0) return nCmp;
  const cCmp = cmpText(
    textOf(a, 'B_CODE', 'b_code') || textOf(a, 'BK_CODE', 'bk_code'),
    textOf(b, 'B_CODE', 'b_code') || textOf(b, 'BK_CODE', 'bk_code')
  );
  if (cCmp !== 0) return cCmp;
  return compareLines(a, b);
}

function compareSaleRows(a, b, sortMode) {
  if (sortMode === 'party') return compareByParty(a, b);
  if (sortMode === 'item') return compareByItem(a, b);
  if (sortMode === 'broker') return compareByBroker(a, b);
  return compareLines(a, b);
}

function billKeyOf(row) {
  return [
    String(row.TYPE ?? row.type ?? '').trim().toUpperCase(),
    toInputDateString(row.BILL_DATE ?? row.bill_date) || '_nodate',
    String(row.BILL_NO ?? row.bill_no ?? '').trim(),
    String(row.B_TYPE ?? row.b_type ?? '').trim(),
  ].join('__');
}

/**
 * Day blocks → day totals → item-wise summary (qty, weight, amount) → **grand total last** (all measure columns).
 *
 * @returns {{ displayRows: Array<{kind:string,...}> }}
 */
export function buildSaleListDisplayRows(data, sortMode = 'date') {
  const raw = [...(data || [])];
  raw.sort((a, b) => compareSaleRows(a, b, sortMode));

  if (sortMode !== 'date') {
    const displayRows = [];
    const showBillTotals = sortMode === 'party' || sortMode === 'broker';
    let grandQ = 0;
    let grandW = 0;
    let grandA = 0;
    let grandTax = 0;
    let grandC = 0;
    let grandS = 0;
    let grandI = 0;
    let grandB = 0;
    let grandOth = 0;
    let bQ = 0;
    let bW = 0;
    let bA = 0;
    let bTax = 0;
    let bCgst = 0;
    let bSgst = 0;
    let bIgst = 0;
    let bBill = 0;
    let bOth = 0;
    let billType = '';
    let billNo = '';
    let billBType = '';
    let billDateLabel = '';
    let activeBillKey = '';
    /** Bill total row only when the bill has more than one line (single-line bills stay clean). */
    let linesInCurrentBill = 0;
    const flushBillGroup = () => {
      if (!showBillTotals || !activeBillKey) return;
      if (linesInCurrentBill > 1) {
        displayRows.push({
          kind: 'bill-total',
          type: billType || '—',
          billNo: billNo || '—',
          bType: billBType || '—',
          billDateLabel: billDateLabel || '—',
          qnty: bQ,
          weight: bW,
          amount: bA,
          taxable: bTax,
          cgstAmt: bCgst,
          sgstAmt: bSgst,
          igstAmt: bIgst,
          billAmt: bBill,
          othExp5: bOth,
        });
      } else if (linesInCurrentBill === 1) {
        displayRows.push({ kind: 'bill-gap' });
      }
      bQ = 0;
      bW = 0;
      bA = 0;
      bTax = 0;
      bCgst = 0;
      bSgst = 0;
      bIgst = 0;
      bBill = 0;
      bOth = 0;
      activeBillKey = '';
      linesInCurrentBill = 0;
    };

    for (let i = 0; i < raw.length; i += 1) {
      const row = raw[i];
      if (showBillTotals) {
        const currentBillKey = billKeyOf(row);
        if (!activeBillKey || currentBillKey !== activeBillKey) {
          flushBillGroup();
          activeBillKey = currentBillKey;
          billType = String(row.TYPE ?? row.type ?? '').trim().toUpperCase();
          billNo = String(row.BILL_NO ?? row.bill_no ?? '').trim();
          billBType = String(row.B_TYPE ?? row.b_type ?? '').trim();
          billDateLabel = toDisplayDate(toInputDateString(row.BILL_DATE ?? row.bill_date));
        }
      }
      displayRows.push({ kind: 'detail', row });
      if (showBillTotals) linesInCurrentBill += 1;
      const q = saleListMeas(row, 'QNTY', 'qnty');
      const w = saleListMeas(row, 'WEIGHT', 'weight');
      const a = saleListMeas(row, 'AMOUNT', 'amount');
      const tax = saleListMeas(row, 'TAXABLE', 'taxable');
      const cgst = saleListMeas(row, 'CGST_AMT', 'cgst_amt');
      const sgst = saleListMeas(row, 'SGST_AMT', 'sgst_amt');
      const igst = saleListMeas(row, 'IGST_AMT', 'igst_amt');
      const b = saleListMeas(row, 'BILL_AMT', 'bill_amt');
      const oth = n(row, 'OTH_EXP5', 'oth_exp5');

      grandQ += q;
      grandW += w;
      grandA += a;
      grandTax += tax;
      grandC += cgst;
      grandS += sgst;
      grandI += igst;
      grandB += b;
      grandOth += oth;
      if (showBillTotals) {
        bQ += q;
        bW += w;
        bA += a;
        bTax += tax;
        bCgst += cgst;
        bSgst += sgst;
        bIgst += igst;
        bBill += b;
        bOth += oth;
      }
    }
    flushBillGroup();

    displayRows.push({
      kind: 'grand-total',
      qnty: grandQ,
      weight: grandW,
      amount: grandA,
      taxable: grandTax,
      cgstAmt: grandC,
      sgstAmt: grandS,
      igstAmt: grandI,
      billAmt: grandB,
      othExp5: grandOth,
    });

    return { displayRows };
  }

  const byDay = new Map();
  for (const row of raw) {
    const k = dayKey(row);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(row);
  }

  const sortedDays = [...byDay.keys()].filter((k) => k !== '_nodate').sort();
  if (byDay.has('_nodate')) sortedDays.push('_nodate');

  const displayRows = [];
  const grandItemAgg = new Map();

  let grandQ = 0;
  let grandW = 0;
  let grandA = 0;
  let grandTax = 0;
  let grandC = 0;
  let grandS = 0;
  let grandI = 0;
  let grandB = 0;
  let grandOth = 0;

  for (const dk of sortedDays) {
    const dayRows = byDay.get(dk) || [];
    const dateLabel = dk === '_nodate' ? '—' : toDisplayDate(dk);

    displayRows.push({ kind: 'day-header', dateKey: dk, dateLabel });

    let bQ = 0;
    let bW = 0;
    let bA = 0;
    let bTax = 0;
    let bCgst = 0;
    let bSgst = 0;
    let bIgst = 0;
    let bBill = 0;
    let bOth = 0;
    let billType = '';
    let billNo = '';
    let billBType = '';
    let billDateLabel = '';
    let hasBillGroup = false;
    /** Bill total row only when the bill has more than one line on this day. */
    let linesInCurrentBill = 0;
    const flushBillGroup = () => {
      if (!hasBillGroup) return;
      if (linesInCurrentBill > 1) {
        displayRows.push({
          kind: 'bill-total',
          type: billType || '—',
          billNo: billNo || '—',
          bType: billBType || '—',
          billDateLabel: billDateLabel || '—',
          qnty: bQ,
          weight: bW,
          amount: bA,
          taxable: bTax,
          cgstAmt: bCgst,
          sgstAmt: bSgst,
          igstAmt: bIgst,
          billAmt: bBill,
          othExp5: bOth,
        });
      } else if (linesInCurrentBill === 1) {
        displayRows.push({ kind: 'bill-gap' });
      }
      bQ = 0;
      bW = 0;
      bA = 0;
      bTax = 0;
      bCgst = 0;
      bSgst = 0;
      bIgst = 0;
      bBill = 0;
      bOth = 0;
      hasBillGroup = false;
      linesInCurrentBill = 0;
    };
    for (let i = 0; i < dayRows.length; i += 1) {
      const row = dayRows[i];
      const currentBillKey = billKeyOf(row);
      const prevBillKey = i > 0 ? billKeyOf(dayRows[i - 1]) : '';
      if (i === 0 || currentBillKey !== prevBillKey) {
        flushBillGroup();
        billType = String(row.TYPE ?? row.type ?? '').trim().toUpperCase();
        billNo = String(row.BILL_NO ?? row.bill_no ?? '').trim();
        billBType = String(row.B_TYPE ?? row.b_type ?? '').trim();
        billDateLabel = toDisplayDate(toInputDateString(row.BILL_DATE ?? row.bill_date));
        hasBillGroup = true;
      }

      displayRows.push({ kind: 'detail', row });
      linesInCurrentBill += 1;

      const q = saleListMeas(row, 'QNTY', 'qnty');
      const w = saleListMeas(row, 'WEIGHT', 'weight');
      const a = saleListMeas(row, 'AMOUNT', 'amount');
      const tax = saleListMeas(row, 'TAXABLE', 'taxable');
      const cgst = saleListMeas(row, 'CGST_AMT', 'cgst_amt');
      const sgst = saleListMeas(row, 'SGST_AMT', 'sgst_amt');
      const igst = saleListMeas(row, 'IGST_AMT', 'igst_amt');
      const b = saleListMeas(row, 'BILL_AMT', 'bill_amt');
      const oth = n(row, 'OTH_EXP5', 'oth_exp5');

      bQ += q;
      bW += w;
      bA += a;
      bTax += tax;
      bCgst += cgst;
      bSgst += sgst;
      bIgst += igst;
      bBill += b;
      bOth += oth;
    }
    flushBillGroup();

    let dQ = 0;
    let dW = 0;
    let dA = 0;
    let dTax = 0;
    let dCgst = 0;
    let dSgst = 0;
    let dIgst = 0;
    let dB = 0;
    let dOth = 0;

    for (const row of dayRows) {
      const q = saleListMeas(row, 'QNTY', 'qnty');
      const w = saleListMeas(row, 'WEIGHT', 'weight');
      const a = saleListMeas(row, 'AMOUNT', 'amount');
      const tax = saleListMeas(row, 'TAXABLE', 'taxable');
      const cgst = saleListMeas(row, 'CGST_AMT', 'cgst_amt');
      const sgst = saleListMeas(row, 'SGST_AMT', 'sgst_amt');
      const igst = saleListMeas(row, 'IGST_AMT', 'igst_amt');
      const b = saleListMeas(row, 'BILL_AMT', 'bill_amt');
      const oth = n(row, 'OTH_EXP5', 'oth_exp5');
      dQ += q;
      dW += w;
      dA += a;
      dTax += tax;
      dCgst += cgst;
      dSgst += sgst;
      dIgst += igst;
      dB += b;
      dOth += oth;

      const ic = itemCode(row) || '—';
      if (!grandItemAgg.has(ic)) {
        grandItemAgg.set(ic, { code: ic, name: itemName(row) || '—', qnty: 0, weight: 0, amount: 0 });
      }
      const g = grandItemAgg.get(ic);
      g.qnty += q;
      g.weight += w;
      g.amount += a;
    }

    grandQ += dQ;
    grandW += dW;
    grandA += dA;
    grandTax += dTax;
    grandC += dCgst;
    grandS += dSgst;
    grandI += dIgst;
    grandB += dB;
    grandOth += dOth;

    displayRows.push({
      kind: 'day-total',
      dateLabel,
      qnty: dQ,
      weight: dW,
      amount: dA,
      taxable: dTax,
      cgstAmt: dCgst,
      sgstAmt: dSgst,
      igstAmt: dIgst,
      billAmt: dB,
      othExp5: dOth,
    });
  }

  displayRows.push({ kind: 'section-label', label: 'Item-wise summary (full period)' });
  displayRows.push({ kind: 'item-col-head' });

  const grandItems = [...grandItemAgg.values()].sort((x, y) =>
    String(x.code).localeCompare(String(y.code), 'en', { sensitivity: 'base', numeric: true })
  );
  for (const it of grandItems) {
    displayRows.push({ kind: 'grand-item', ...it });
  }

  displayRows.push({
    kind: 'grand-total',
    qnty: grandQ,
    weight: grandW,
    amount: grandA,
    taxable: grandTax,
    cgstAmt: grandC,
    sgstAmt: grandS,
    igstAmt: grandI,
    billAmt: grandB,
    othExp5: grandOth,
  });

  return { displayRows };
}
