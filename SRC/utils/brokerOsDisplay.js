import { rowFieldCI } from './rowFieldCI';

/** Single broker-range token: plain number or strip leading non-digits (B26001 → 26001). */
export function parseBrokerOsRangeForUi(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  const stripped = s.replace(/^[^0-9]+/, '');
  if (stripped === '') return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/** Helpers for broker outstanding: alpha party order within broker, party/broker/grand subtotals.
 * BILLS.B_CODE only (BK_CODE is not on BILLS in this schema). */
export function brokerOsBCodeOf(row) {
  if (!row) return '';
  const direct = row.B_CODE ?? row.b_code;
  if (direct != null && direct !== '') return String(direct).trim();
  const ci = rowFieldCI(row, 'B_CODE');
  if (ci !== '') return ci;
  for (const k of Object.keys(row)) {
    if (String(k).replace(/_/g, '').toLowerCase() === 'bcode') {
      const v = row[k];
      if (v != null && v !== '') return String(v).trim();
    }
  }
  return '';
}

/**
 * Schedule 11.10 = creditors style: Cr column before Dr on broker outstanding.
 * Any other value or blank: Dr before Cr (debtors / default).
 */
export function brokerOsCrFirstFromSchedule(raw) {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return false;
  const cleaned = s.replace(/[^\d.-]/g, '');
  if (!cleaned) return false;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return false;
  return Math.round(n * 100 + 1e-6) === 1110;
}

function bCodeOf(row) {
  return brokerOsBCodeOf(row);
}
function codeOf(row) {
  return String(row.CODE ?? row.code ?? '').trim();
}
function nameOf(row) {
  return String(row.NAME ?? row.name ?? '').trim();
}
function brokerNameOf(row) {
  return String(row.BK_NAME ?? row.bk_name ?? '').trim();
}
function billNoOf(row) {
  return String(row.BILL_NO ?? row.bill_no ?? '').trim();
}
function billDateOf(row) {
  const raw = row.BILL_DATE ?? row.bill_date;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? '' : String(t);
}
function bTypeOf(row) {
  return String(row.B_TYPE ?? row.b_type ?? '').trim();
}
function numDr(row) {
  return parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
}
function numCr(row) {
  return parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
}
function numFinal(row) {
  return parseFloat(row.FINAL_BAL ?? row.final_bal ?? 0) || 0;
}
function ts(raw) {
  if (raw == null || raw === '') return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function vrNo(row) {
  return parseFloat(row.VR_NO ?? row.vr_no ?? 0) || 0;
}
function drFlag(row) {
  return parseFloat(row.DR_CR_FLAG ?? row.dr_cr_flag ?? 2) || 2;
}

/** Broker → party name (A–Z) → party code → bill / voucher order */
export function sortBrokerOsRawRows(rows) {
  const r = [...(rows || [])];
  r.sort((a, b) => {
    const c1 = bCodeOf(a).localeCompare(bCodeOf(b), undefined, { numeric: true });
    if (c1 !== 0) return c1;
    const c2 = nameOf(a).localeCompare(nameOf(b), 'en', { sensitivity: 'base', numeric: true });
    if (c2 !== 0) return c2;
    const c3 = codeOf(a).localeCompare(codeOf(b), undefined, { numeric: true });
    if (c3 !== 0) return c3;
    const bd = ts(a.BILL_DATE ?? a.bill_date) - ts(b.BILL_DATE ?? b.bill_date);
    if (bd !== 0) return bd;
    const bn = billNoOf(a).localeCompare(billNoOf(b), undefined, { numeric: true });
    if (bn !== 0) return bn;
    const bt = bTypeOf(a).localeCompare(bTypeOf(b));
    if (bt !== 0) return bt;
    const vd = ts(a.VR_DATE ?? a.vr_date) - ts(b.VR_DATE ?? b.vr_date);
    if (vd !== 0) return vd;
    const df = drFlag(a) - drFlag(b);
    if (df !== 0) return df;
    return vrNo(a) - vrNo(b);
  });
  return r;
}

/**
 * @returns {{ displayRows: Array<{kind:'detail',row}|{kind:'party-total',...}|{kind:'broker-total',...}>, grandDr: number, grandCr: number }}
 */
export function buildBrokerOsDisplayRows(rawRows) {
  const sorted = sortBrokerOsRawRows(rawRows);
  const displayRows = [];
  let grandDr = 0;
  let grandCr = 0;

  let i = 0;
  const n = sorted.length;
  while (i < n) {
    const bk = bCodeOf(sorted[i]);
    const brokerName = brokerNameOf(sorted[i]);
    let brokerDr = 0;
    let brokerCr = 0;

    while (i < n && bCodeOf(sorted[i]) === bk) {
      const code = codeOf(sorted[i]);
      const name = nameOf(sorted[i]);
      let partyDr = 0;
      let partyCr = 0;
      let billDr = 0;
      let billCr = 0;
      let billFinal = 0;
      let billNo = '';
      let billDateRaw = '';
      let billType = '';
      let hasBill = false;

      while (i < n && bCodeOf(sorted[i]) === bk && codeOf(sorted[i]) === code) {
        const row = sorted[i];
        const rowBillNo = billNoOf(row);
        const rowBillDate = row.BILL_DATE ?? row.bill_date ?? '';
        const rowBillType = bTypeOf(row);
        const billChanged = hasBill && (
          rowBillNo !== billNo ||
          String(rowBillDate ?? '') !== String(billDateRaw ?? '') ||
          rowBillType !== billType
        );
        if (billChanged) {
          displayRows.push({
            kind: 'bill-total',
            B_CODE: bk,
            CODE: code,
            NAME: name,
            BILL_NO: billNo,
            BILL_DATE: billDateRaw,
            B_TYPE: billType,
            DR_AMT: billDr,
            CR_AMT: billCr,
            FINAL_BAL: billFinal,
          });
          billDr = 0;
          billCr = 0;
          billFinal = 0;
        }
        billNo = rowBillNo;
        billDateRaw = rowBillDate;
        billType = rowBillType;
        hasBill = true;
        partyDr += numDr(row);
        partyCr += numCr(row);
        billDr += numDr(row);
        billCr += numCr(row);
        billFinal = numFinal(row);
        displayRows.push({ kind: 'detail', row });
        i++;
      }
      if (hasBill) {
        displayRows.push({
          kind: 'bill-total',
          B_CODE: bk,
          CODE: code,
          NAME: name,
          BILL_NO: billNo,
          BILL_DATE: billDateRaw,
          B_TYPE: billType,
          DR_AMT: billDr,
          CR_AMT: billCr,
          FINAL_BAL: billFinal,
        });
      }

      brokerDr += partyDr;
      brokerCr += partyCr;
      displayRows.push({
        kind: 'party-total',
        B_CODE: bk,
        CODE: code,
        NAME: name,
        DR_AMT: partyDr,
        CR_AMT: partyCr,
        FINAL_BAL: partyDr - partyCr,
      });
    }

    grandDr += brokerDr;
    grandCr += brokerCr;
    displayRows.push({
      kind: 'broker-total',
      B_CODE: bk,
      BK_NAME: brokerName,
      DR_AMT: brokerDr,
      CR_AMT: brokerCr,
      FINAL_BAL: brokerDr - brokerCr,
    });
  }

  return { displayRows, grandDr, grandCr };
}
