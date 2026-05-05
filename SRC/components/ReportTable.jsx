import React, { useEffect, useRef, useState } from 'react';
import { formatLedgerDateDisplay } from '../utils/dateFormat';
import { buildBrokerOsDisplayRows, brokerOsBCodeOf, brokerOsCrFirstFromSchedule } from '../utils/brokerOsDisplay';
import { buildSaleListDisplayRows, saleListMeas, isSaleListCn } from '../utils/saleListDisplay';
import { ageingCurBalDisplay } from '../utils/ageingDisplay';

const LEDGER_SALE_VR_TYPES = new Set(['SL', 'SE', 'CN']);

/** <colgroup> px widths (no InvDate column — date is on the Day banner row only) */
const SALE_LIST_COL_WIDTHS_PX = [
  18, 32, 12, 44, 208, 96, 124, 118, 50, 168, 42, 56, 146, 20,
  /* Qty, Wt, Rate, Amount, Taxable, CGST, SGST, IGST, Round off, Bill amt */
  78, 108, 78, 132, 92, 76, 76, 76, 58, 100,
];

const SALE_LIST_TABLE_WIDTH_PX = SALE_LIST_COL_WIDTHS_PX.reduce((s, w) => s + w, 0);

/** Locks lead columns via CSS vars (--sl-col-1 … 5) + exact table width (fixed layout). */
const SALE_LIST_TABLE_STYLE = {
  width: `${SALE_LIST_TABLE_WIDTH_PX}px`,
  ...Object.fromEntries(SALE_LIST_COL_WIDTHS_PX.slice(0, 5).map((w, i) => [`--sl-col-${i + 1}`, `${w}px`])),
};

function formatBillLedgerPartyCaption(name, code, city, tel) {
  const n = String(name || '').trim();
  const c = String(code || '').trim();
  const cityStr = String(city || '').trim();
  const telStr = String(tel || '').trim();
  const head = c ? `${n || 'Party'} (${c})` : n || 'Party';
  const bits = [head];
  if (cityStr) bits.push(cityStr);
  if (telStr) bits.push(`Tel: ${telStr}`);
  return bits.join(' · ');
}

export default function ReportTable({
  data,
  type,
  onLedgerClick,
  onSaleBillClick,
  onVoucherClick,
  onLedgerSaleBillClick,
  meta,
  saleListSortMode = 'date',
  billLedgerInterest = false,
  billLedgerKind = 'customer',
}) {
  const [trialSelectedKey, setTrialSelectedKey] = useState(null);
  const [ledgerSelectedKey, setLedgerSelectedKey] = useState(null);
  const [ageingListSelectedKey, setAgeingListSelectedKey] = useState(null);
  const [ageingDrillSelectedKey, setAgeingDrillSelectedKey] = useState(null);

  const saleListTopScrollRef = useRef(null);
  const saleListTopInnerRef = useRef(null);
  const saleListGridScrollRef = useRef(null);

  useEffect(() => {
    if (type !== 'sale-list') return;
    const top = saleListTopScrollRef.current;
    const topInner = saleListTopInnerRef.current;
    const grid = saleListGridScrollRef.current;
    if (!top || !topInner || !grid) return;

    let syncingFromTop = false;
    let syncingFromGrid = false;

    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth ? 'block' : 'none';
    };

    const onTopScroll = () => {
      if (syncingFromGrid) return;
      syncingFromTop = true;
      grid.scrollLeft = top.scrollLeft;
      syncingFromTop = false;
    };

    const onGridScroll = () => {
      if (syncingFromTop) return;
      syncingFromGrid = true;
      top.scrollLeft = grid.scrollLeft;
      syncingFromGrid = false;
    };

    syncWidths();
    top.addEventListener('scroll', onTopScroll, { passive: true });
    grid.addEventListener('scroll', onGridScroll, { passive: true });
    window.addEventListener('resize', syncWidths);

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncWidths);
      ro.observe(grid);
      const tableEl = grid.querySelector('table');
      if (tableEl) ro.observe(tableEl);
    }

    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
      if (ro) ro.disconnect();
    };
  }, [type, data]);

  useEffect(() => {
    if (type === 'trial-balance') setTrialSelectedKey(null);
  }, [type, data]);

  useEffect(() => {
    if (type === 'ledger' || type === 'ledger-interest') setLedgerSelectedKey(null);
  }, [type, data]);

  useEffect(() => {
    if (type === 'ageing') setAgeingListSelectedKey(null);
  }, [type, data]);

  useEffect(() => {
    if (type === 'ageing-ledger-detail' || type === 'ageing-bills-detail') setAgeingDrillSelectedKey(null);
  }, [type, data]);

  if (!data || data.length === 0) return <p className="no-data">No data available.</p>;

  // Indian Currency Formatter
  const fmt = (val) => {
    const num = parseFloat(val) || 0;
    return num === 0 ? '-' : num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  const fmtAlways = (val) => {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  };

  const fmtDays = (val) => {
    const num = parseFloat(val);
    if (!Number.isFinite(num)) return '0';
    return Math.max(0, Math.trunc(num)).toLocaleString('en-IN');
  };

  const clampText = (value, maxLen = 25) => {
    const s = String(value ?? '');
    if (s.length <= maxLen) return s;
    return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
  };

  // --- TRIAL BALANCE VIEW (full grid + grand total; scrolls horizontally on small screens) ---
  if (type === 'trial-balance') {
    let gDr = 0;
    let gCr = 0;
    let gCdr = 0;
    let gCcr = 0;
    data.forEach((row) => {
      gDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      gCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
      gCdr += parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
      gCcr += parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
    });

    return (
      <div className="table-responsive table-responsive--trial">
        <table className="report-table report-table--trial">
          <thead>
            <tr>
              <th scope="col">Sch</th>
              <th scope="col">Account</th>
              <th scope="col">Code</th>
              <th scope="col">City</th>
              <th scope="col" className="text-right">
                Clos. Dr
              </th>
              <th scope="col" className="text-right">
                Clos. Cr
              </th>
              <th scope="col" className="text-right">
                Dr amt
              </th>
              <th scope="col" className="text-right">
                Cr amt
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const codeVal = row.CODE ?? row.code;
              const nameVal = row.NAME ?? row.name;
              const cityVal = row.CITY ?? row.city;
              const schVal = row.SCHEDULE ?? row.schedule ?? row.SCH_NO ?? row.sch_no;

              const cdr = parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
              const ccr = parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
              const drAmt = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
              const crAmt = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;

              const isTotal =
                codeVal == null ||
                codeVal === '' ||
                (nameVal && String(nameVal).toUpperCase().includes('TOTAL'));
              const nameUpper = String(nameVal ?? '').toUpperCase();
              const isGrandTotal = nameUpper.includes('GRAND TOTAL');
              const isScheduleTotal = isTotal && !isGrandTotal;
              const rowClassName = isGrandTotal
                ? 'trial-grand-total'
                : isScheduleTotal
                  ? 'trial-schedule-total-row'
                  : isTotal
                    ? 'trial-subtotal-row'
                    : 'clickable-row';
              const trialRowKey = `trial-row-${idx}`;
              const isTrialSelected = trialSelectedKey === trialRowKey;

              return (
                <tr
                  key={idx}
                  className={[rowClassName, isTrialSelected ? 'trial-row-selected' : ''].filter(Boolean).join(' ')}
                  onClick={() => {
                    setTrialSelectedKey(trialRowKey);
                    if (!isTotal && onLedgerClick) onLedgerClick(codeVal, nameVal);
                  }}
                >
                  <td className="trial-sch">{schVal != null && schVal !== '' ? schVal : '—'}</td>
                  <td className="trial-name">
                    <span className="name-text">{nameVal}</span>
                  </td>
                  <td className="trial-code">{codeVal != null && codeVal !== '' ? codeVal : '—'}</td>
                  <td className="trial-city">
                    {isScheduleTotal ? '—' : cityVal != null && cityVal !== '' ? cityVal : '—'}
                  </td>
                  <td className={`text-right ${cdr > 0 ? 'dr-amt' : ''}`}>{cdr > 0 ? fmt(cdr) : '—'}</td>
                  <td className={`text-right ${ccr > 0 ? 'cr-amt' : ''}`}>{ccr > 0 ? fmt(ccr) : '—'}</td>
                  <td className={`text-right ${drAmt > 0 ? 'dr-amt' : ''}`}>{drAmt > 0 ? fmt(drAmt) : '—'}</td>
                  <td className={`text-right ${crAmt > 0 ? 'cr-amt' : ''}`}>{crAmt > 0 ? fmt(crAmt) : '—'}</td>
                </tr>
              );
            })}
            <tr
              className={[
                'trial-grand-total',
                'trial-grand-total-footer',
                trialSelectedKey === 'trial-grand-footer' ? 'trial-row-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setTrialSelectedKey('trial-grand-footer')}
            >
              <td colSpan={4}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gCdr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gCcr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(gCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- LEDGER VIEW ---
  if (type === 'ledger' || type === 'ledger-interest') {
    const showInterestCols = type === 'ledger-interest';
    let sumDr = 0;
    let sumCr = 0;
    let sumDays = 0;
    let sumDrInt = 0;
    let sumCrInt = 0;
    data.forEach((row) => {
      sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
      if (showInterestCols) {
        const drAmtNum = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
        const crAmtNum = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
        const drDays = parseFloat(row.DR_DAYS ?? row.dr_days ?? 0) || 0;
        const crDays = parseFloat(row.CR_DAYS ?? row.cr_days ?? 0) || 0;
        sumDays += drAmtNum > 0 ? drDays : crAmtNum > 0 ? crDays : 0;
        sumDrInt += parseFloat(row.DR_INTEREST ?? row.dr_interest ?? 0) || 0;
        sumCrInt += parseFloat(row.CR_INTEREST ?? row.cr_interest ?? 0) || 0;
      }
    });
    const lastRow = data[data.length - 1];
    const closingBal =
      lastRow != null
        ? parseFloat(lastRow.CL_BALANCE ?? lastRow.cl_balance ?? lastRow.RUN_BAL ?? lastRow.run_bal ?? 0) || 0
        : 0;
    const closingNeg = closingBal < 0;

    return (
      <div className="table-responsive table-responsive--ledger">
        <table className="report-table report-table--ledger report-table--ledger-compact">
          <thead>
            <tr>
              <th className="col-ledger-dt">Vr.Date</th>
              <th className="col-ledger-dt col-ledger-value-dt">Value Date</th>
              <th className="col-ledger-vr-no">Vr.No.</th>
              <th className="col-ledger-type">Vr.Type</th>
              <th className="col-ledger-line-type">Type</th>
              <th className="ledger-detail col-ledger-detail-narrow">Detail</th>
              <th className="text-right col-ledger-amt">Dr.Amount</th>
              <th className="text-right col-ledger-amt">Cr.Amount</th>
              <th className="text-right col-ledger-amt">Cl.Balance</th>
              {showInterestCols ? <th className="text-right col-ledger-amt col-ledger-days">Days</th> : null}
              {showInterestCols ? <th className="text-right col-ledger-amt col-ledger-int">Dr.Int</th> : null}
              {showInterestCols ? <th className="text-right col-ledger-amt col-ledger-int">Cr.Int</th> : null}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const vrType = row.VR_TYPE ?? row.vr_type;
              const vrDate = row.VR_DATE ?? row.vr_date;
              const valueDate = row.V_DATE ?? row.v_date;
              const vrNo = row.VR_NO ?? row.vr_no;
              const lineType = row.TYPE ?? row.type;
              const drAmtNum = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
              const crAmtNum = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
              const clBal = row.CL_BALANCE ?? row.cl_balance ?? row.RUN_BAL ?? row.run_bal;
              const clBalNum = parseFloat(clBal) || 0;
              const vrUpper = vrType ? String(vrType).toUpperCase() : '';
              const canSaleBill =
                typeof onLedgerSaleBillClick === 'function' &&
                vrUpper &&
                LEDGER_SALE_VR_TYPES.has(vrUpper) &&
                vrNo != null &&
                String(vrNo).trim() !== '' &&
                Number(vrNo) > 0;
              const canDrill =
                !canSaleBill &&
                onVoucherClick &&
                vrNo != null &&
                String(vrNo).trim() !== '' &&
                Number(vrNo) > 0;
              const clickable = canSaleBill || canDrill;
              const ledgerRowKey = `ledger-row-${i}`;
              const isLedgerSelected = ledgerSelectedKey === ledgerRowKey;
              return (
                <tr
                  key={i}
                  className={
                    [
                      vrType === 'OP' ? 'opening-row' : '',
                      clickable ? 'clickable-row' : 'ledger-row-focusable',
                      isLedgerSelected ? 'ledger-row-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ') || undefined
                  }
                  onClick={() => {
                    setLedgerSelectedKey(ledgerRowKey);
                    if (canSaleBill) onLedgerSaleBillClick(row);
                    else if (canDrill) onVoucherClick(row);
                  }}
                >
                  <td className="col-ledger-dt">{formatLedgerDateDisplay(vrDate)}</td>
                  <td className="col-ledger-dt col-ledger-value-dt">
                    {valueDate != null && valueDate !== '' ? formatLedgerDateDisplay(valueDate) : '—'}
                  </td>
                  <td className="col-ledger-vr-no">{vrNo != null && vrNo !== '' ? String(vrNo) : '—'}</td>
                  <td className="col-ledger-type">
                    <span className={`badge-type ${String(vrType ?? '').replace(/\s+/g, '')}`}>{vrType ?? '—'}</span>
                  </td>
                  <td className="col-ledger-line-type">
                    {lineType != null && lineType !== '' ? String(lineType) : '—'}
                  </td>
                  <td className="ledger-detail col-ledger-detail-narrow" title={String(row.DETAIL ?? row.detail ?? '')}>
                    {row.DETAIL ?? row.detail}
                  </td>
                  <td className="text-right dr-amt col-ledger-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt col-ledger-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td
                    className={`text-right col-ledger-amt ledger-cl-balance${
                      clBalNum < 0 ? ' ledger-cl-balance--negative' : ''
                    }`}
                  >
                    {fmt(clBal)}
                  </td>
                  {showInterestCols ? (
                    <td className="text-right col-ledger-amt col-ledger-days">
                      {drAmtNum > 0
                        ? fmtDays(row.DR_DAYS ?? row.dr_days)
                        : crAmtNum > 0
                          ? fmtDays(row.CR_DAYS ?? row.cr_days)
                          : '—'}
                    </td>
                  ) : null}
                  {showInterestCols ? (
                    <td className="text-right dr-amt col-ledger-amt col-ledger-int">
                      {fmt(row.DR_INTEREST ?? row.dr_interest)}
                    </td>
                  ) : null}
                  {showInterestCols ? (
                    <td className="text-right cr-amt col-ledger-amt col-ledger-int">
                      {fmt(row.CR_INTEREST ?? row.cr_interest)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
            <tr
              className={[
                'ledger-grand-total',
                ledgerSelectedKey === 'ledger-footer-total' ? 'ledger-row-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setLedgerSelectedKey('ledger-footer-total')}
            >
              <td colSpan={6}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right col-ledger-amt">
                <strong>{fmt(sumDr)}</strong>
              </td>
              <td className="text-right col-ledger-amt">
                <strong>{fmt(sumCr)}</strong>
              </td>
              <td
                className={`text-right col-ledger-amt ledger-cl-balance-total${
                  closingNeg ? ' ledger-cl-balance-total--negative' : ''
                }`}
              >
                <strong>{fmt(closingBal)}</strong>
              </td>
              {showInterestCols ? (
                <td className="text-right col-ledger-amt col-ledger-days">
                  <strong>—</strong>
                </td>
              ) : null}
              {showInterestCols ? (
                <td className="text-right col-ledger-amt col-ledger-int">
                  <strong>{fmt(sumDrInt)}</strong>
                </td>
              ) : null}
              {showInterestCols ? (
                <td className="text-right col-ledger-amt col-ledger-int">
                  <strong>{fmt(sumCrInt)}</strong>
                </td>
              ) : null}
            </tr>
            {showInterestCols ? (
              <tr
                className={[
                  'ledger-grand-total',
                  ledgerSelectedKey === 'ledger-footer-net-int' ? 'ledger-row-selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setLedgerSelectedKey('ledger-footer-net-int')}
              >
                <td colSpan={9}>
                  <strong>NET INTEREST</strong>
                </td>
                <td className="text-right col-ledger-amt col-ledger-int">
                  <strong>{fmt(sumDrInt - sumCrInt)}</strong>
                </td>
                <td className="text-right col-ledger-amt col-ledger-int">
                  <strong>—</strong>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    );
  }

  // --- Voucher detail: all LEDGER lines for one VR_DATE + VR_TYPE + VR_NO ---
  if (type === 'ledger-voucher') {
    let sumDr = 0;
    let sumCr = 0;
    data.forEach((row) => {
      sumDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      sumCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
    });

    return (
      <div className="table-responsive table-responsive--ledger table-responsive--ledger-voucher">
        <table className="report-table report-table--ledger report-table--voucher">
          <thead>
            <tr>
              <th scope="col" className="col-voucher-code">Account</th>
              <th scope="col" className="col-voucher-name">Name</th>
              <th scope="col" className="col-voucher-city">City</th>
              <th scope="col" className="col-voucher-type">Type</th>
              <th scope="col" className="col-voucher-detail">Detail</th>
              <th scope="col" className="col-voucher-dc">DC</th>
              <th scope="col" className="text-right col-voucher-amt">Dr Amt</th>
              <th scope="col" className="text-right col-voucher-amt">Cr Amt</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const code = row.CODE ?? row.code;
              const lineType = row.TYPE ?? row.type;
              return (
                <tr key={i}>
                  <td className="col-voucher-code">{code != null && code !== '' ? code : '—'}</td>
                  <td className="ledger-detail col-voucher-name">{row.NAME ?? row.name ?? '—'}</td>
                  <td className="col-voucher-city">{row.CITY ?? row.city ?? '—'}</td>
                  <td className="col-voucher-type">
                    <span className="type-label">{lineType != null && lineType !== '' ? lineType : '—'}</span>
                  </td>
                  <td className="ledger-detail col-voucher-detail">{row.DETAIL ?? row.detail ?? '—'}</td>
                  <td
                    className="ledger-detail col-voucher-dc"
                    title={
                      (row.DC_CODE ?? row.dc_code) != null && (row.DC_CODE ?? row.dc_code) !== ''
                        ? `${row.DC_CODE ?? row.dc_code}${(row.DC_NAME ?? row.dc_name) ? ` — ${row.DC_NAME ?? row.dc_name}` : ''}`
                        : String(row.DC_NAME ?? row.dc_name ?? '')
                    }
                  >
                    {(row.DC_CODE ?? row.dc_code) != null && (row.DC_CODE ?? row.dc_code) !== ''
                      ? `${row.DC_CODE ?? row.dc_code}${(row.DC_NAME ?? row.dc_name) ? ` — ${row.DC_NAME ?? row.dc_name}` : ''}`
                      : '—'}
                  </td>
                  <td className="text-right dr-amt col-voucher-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt col-voucher-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                </tr>
              );
            })}
            <tr className="ledger-grand-total">
              <td colSpan={6}>
                <strong>VOUCHER TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(sumDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmt(sumCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'ageing-ledger-detail') {
    let totalPending = 0;
    return (
      <div className="table-responsive table-responsive--ledger table-responsive--ageing-drill">
        <table className="report-table report-table--ledger report-table--ageing-ledger-detail">
          <thead>
            <tr>
              <th scope="col" className="col-ageing-ld-date">Date</th>
              <th scope="col" className="col-ageing-ld-type">Type</th>
              <th scope="col" className="col-ageing-ld-detail">Detail</th>
              <th scope="col" className="text-right col-ageing-ld-amt">Dr Amt</th>
              <th scope="col" className="text-right col-ageing-ld-amt">Cr Amt</th>
              <th scope="col" className="text-right col-ageing-ld-pending">Pending Bal</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const pending = parseFloat(row.PENDING_BAL ?? row.pending_bal ?? 0) || 0;
              totalPending += pending;
              const vrType = row.VR_TYPE ?? row.vr_type;
              const rowKey = `ageing-ld-${i}`;
              const isSel = ageingDrillSelectedKey === rowKey;
              return (
                <tr
                  key={i}
                  className={['ledger-row-focusable', isSel ? 'ledger-row-selected' : ''].filter(Boolean).join(' ') || undefined}
                  onClick={() => setAgeingDrillSelectedKey(rowKey)}
                >
                  <td className="col-ageing-ld-date">{formatLedgerDateDisplay(row.VR_DATE ?? row.vr_date)}</td>
                  <td className="col-ageing-ld-type">
                    <span className={`badge-type ${vrType}`}>{vrType ?? '—'}</span>
                  </td>
                  <td className="ledger-detail col-ageing-ld-detail">{row.DETAIL ?? row.detail ?? '—'}</td>
                  <td className="text-right dr-amt col-ageing-ld-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt col-ageing-ld-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right col-ageing-ld-pending" style={{ fontWeight: 'bold', color: '#2c7a7b' }}>
                    {fmtAlways(pending)}
                  </td>
                </tr>
              );
            })}
            <tr
              className={[
                'ledger-grand-total',
                ageingDrillSelectedKey === 'ageing-ld-grand' ? 'ledger-row-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setAgeingDrillSelectedKey('ageing-ld-grand')}
            >
              <td colSpan={5}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(totalPending)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- BILL-WISE LEDGER (BILLS + running balance per bill) ---
  if (type === 'bill-ledger') {
    const billLedgerCrFirst = String(billLedgerKind).toLowerCase() === 'supplier';

    const billKeyOf = (row) => {
      const billNo = String(row.BILL_NO ?? row.bill_no ?? '').trim();
      const billDt = formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date);
      const bType = String(row.B_TYPE ?? row.b_type ?? '').trim();
      return `${billDt}__${billNo}__${bType}`;
    };

    let sumDr = 0;
    let sumCr = 0;
    let sumCurrent = 0;
    let sumInterest = 0;
    let sumClosePlusInt = 0;
    const displayRows = [];

    let billDr = 0;
    let billCr = 0;
    let billCurrent = 0;

    data.forEach((row, idx) => {
      const dr = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
      const cr = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
      const cl = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? 0) || 0;

      sumDr += dr;
      sumCr += cr;
      billDr += dr;
      billCr += cr;
      billCurrent = cl;

      displayRows.push({ kind: 'detail', row, idx });

      const curKey = billKeyOf(row);
      const next = data[idx + 1];
      const nextKey = next ? billKeyOf(next) : '';
      const billEnds = !next || curKey !== nextKey;
      if (!billEnds) return;

      sumCurrent += billCurrent;
      const intAmt = billLedgerInterest ? parseFloat(row.INTEREST_AMT ?? row.interest_amt ?? '') || 0 : 0;
      const idays = billLedgerInterest ? (row.INTEREST_DAYS ?? row.interest_days ?? '') : '';
      const closePlusInt = billLedgerInterest ? billCurrent + intAmt : null;
      if (billLedgerInterest) {
        sumInterest += intAmt;
        sumClosePlusInt += closePlusInt ?? 0;
      }
      displayRows.push({
        kind: 'bill-total',
        CODE: row.CODE ?? row.code ?? '',
        NAME: row.NAME ?? row.name ?? '',
        BILL_NO: row.BILL_NO ?? row.bill_no ?? '',
        BILL_DATE: row.BILL_DATE ?? row.bill_date ?? '',
        B_TYPE: row.B_TYPE ?? row.b_type ?? '',
        DR_AMT: billDr,
        CR_AMT: billCr,
        CL_BALANCE: billCurrent,
        INTEREST_DAYS: idays === '' || idays == null ? null : idays,
        INTEREST_AMT: intAmt,
        CLOSE_PLUS_INT: closePlusInt,
      });

      billDr = 0;
      billCr = 0;
      billCurrent = 0;
    });

    const intHead = billLedgerInterest ? (
      <>
        <th className="text-right col-bill-ledger-int-days" scope="col" title="Interest days">
          Days
        </th>
        <th className="text-right bill-ledger-th-interest col-bill-ledger-int-amt" scope="col">
          Int
        </th>
        <th className="text-right col-bill-ledger-int-close" scope="col" title="Closing + interest">
          Cl+int
        </th>
      </>
    ) : null;

    const firstRow = data?.[0] || {};
    const partyCodeTop = String(meta?.billLedgerPartyCode ?? firstRow.CODE ?? firstRow.code ?? '').trim();
    const partyNameTop = String(meta?.billLedgerPartyName ?? firstRow.NAME ?? firstRow.name ?? '').trim();
    const partyCityTop = String(meta?.billLedgerPartyCity ?? firstRow.CITY ?? firstRow.city ?? '').trim();
    const partyTelTop = String(meta?.billLedgerPartyTel ?? firstRow.TEL_NO_O ?? firstRow.tel_no_o ?? '').trim();
    const compTop = String(meta?.billLedgerCompanyName ?? '').trim();
    const partyLineTop = formatBillLedgerPartyCaption(partyNameTop, partyCodeTop, partyCityTop, partyTelTop);

    return (
      <div className="table-responsive table-responsive--bill-ledger">
        {compTop ? (
          <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#0f172a' }}>{compTop}</p>
        ) : null}
        {partyCodeTop || partyNameTop ? (
          <p style={{ margin: compTop ? '0 0 8px' : '0 0 8px', fontWeight: 700, color: '#0f172a' }}>{partyLineTop}</p>
        ) : null}
        <table
          className={`report-table report-table--bill-ledger ${
            billLedgerInterest
              ? 'report-table--bill-ledger-with-interest'
              : 'report-table--bill-ledger-no-interest'
          }`}
        >
          <colgroup>
            {/*
              One <col> per table column (must match thead th count exactly).
              With interest: 7 + Dr/Cr/Bal + Days/Int/Cl+int = 13 cols.
              Without: 7 + Dr/Cr/Bal = 10 cols.
            */}
            {billLedgerInterest ? (
              <>
                <col style={{ width: '6.5%' }} />
                <col style={{ width: '9.5%' }} />
                <col style={{ width: '2.5%' }} />
                <col style={{ width: '9.5%' }} />
                <col style={{ width: '9.5%' }} />
                <col style={{ width: '5.5%' }} />
                <col style={{ width: '2.5%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '9.5%' }} />
              </>
            ) : (
              <>
                <col style={{ width: '10%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '3%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '8%' }} />
                <col style={{ width: '4%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
              </>
            )}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="col-bill-ledger-bill-no">
                Bill no
              </th>
              <th scope="col" className="col-bill-ledger-date">
                Bill date
              </th>
              <th scope="col" className="col-bill-ledger-bt" title="Bill type">
                BT
              </th>
              <th scope="col" className="col-bill-ledger-date">
                Vr date
              </th>
              <th scope="col" className="col-bill-ledger-date">
                V date
              </th>
              <th scope="col" className="col-bill-ledger-vr-no">
                Vr no
              </th>
              <th scope="col" className="col-bill-ledger-vt" title="Voucher type">
                VT
              </th>
              <th
                className="text-right col-bill-ledger-amt"
                scope="col"
                title={billLedgerCrFirst ? 'Credit amount' : 'Debit amount'}
              >
                {billLedgerCrFirst ? 'Cr.Amount' : 'Dr.Amount'}
              </th>
              <th
                className="text-right col-bill-ledger-amt"
                scope="col"
                title={billLedgerCrFirst ? 'Debit amount' : 'Credit amount'}
              >
                {billLedgerCrFirst ? 'Dr.Amount' : 'Cr.Amount'}
              </th>
              <th className="text-right col-bill-ledger-amt" scope="col" title="Closing balance">
                Closing Bal.
              </th>
              {intHead}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((item, i) => {
              if (item.kind === 'bill-total') {
                const billNo = item.BILL_NO ?? '—';
                const billDt = formatLedgerDateDisplay(item.BILL_DATE ?? item.bill_date);
                const bType = item.B_TYPE ?? item.b_type ?? '—';
                return (
                  <tr key={`bt-${i}`} className="bill-ledger-bill-total">
                    <td colSpan={7}>
                      <strong>Bill total — {billDt} / {billNo} / {bType}</strong>
                    </td>
                    <td className="text-right col-bill-ledger-amt">
                      <strong>{fmtAlways(billLedgerCrFirst ? item.CR_AMT : item.DR_AMT)}</strong>
                    </td>
                    <td className="text-right col-bill-ledger-amt">
                      <strong>{fmtAlways(billLedgerCrFirst ? item.DR_AMT : item.CR_AMT)}</strong>
                    </td>
                    <td className="text-right col-bill-ledger-amt">
                      <strong>{fmtAlways(item.CL_BALANCE)}</strong>
                    </td>
                    {billLedgerInterest ? (
                      <>
                        <td className="text-right col-bill-ledger-int-days">
                          <strong>{item.INTEREST_DAYS != null && item.INTEREST_DAYS !== '' ? item.INTEREST_DAYS : '—'}</strong>
                        </td>
                        <td className="text-right bill-ledger-interest-amt col-bill-ledger-int-amt">
                          <strong>{fmtAlways(item.INTEREST_AMT)}</strong>
                        </td>
                        <td className="text-right col-bill-ledger-int-close">
                          <strong>{fmtAlways(item.CLOSE_PLUS_INT)}</strong>
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              }

              const row = item.row;
              const billDt = row.BILL_DATE ?? row.bill_date;
              const vrDt = row.VR_DATE ?? row.vr_date;
              const vDt = row.V_DATE ?? row.v_date;
              const cl = parseFloat(row.CL_BALANCE ?? row.cl_balance ?? 0) || 0;
              return (
                <tr key={i}>
                  <td
                    className="col-bill-ledger-bill-no"
                    title={String(row.BILL_NO ?? row.bill_no ?? '')}
                  >
                    {row.BILL_NO ?? row.bill_no ?? '—'}
                  </td>
                  <td className="col-bill-ledger-date">{formatLedgerDateDisplay(billDt)}</td>
                  <td className="col-bill-ledger-bt">{row.B_TYPE ?? row.b_type ?? '—'}</td>
                  <td className="col-bill-ledger-date">{formatLedgerDateDisplay(vrDt)}</td>
                  <td className="col-bill-ledger-date">
                    {vDt != null && vDt !== '' ? formatLedgerDateDisplay(vDt) : '—'}
                  </td>
                  <td
                    className="col-bill-ledger-vr-no"
                    title={String(row.VR_NO ?? row.vr_no ?? '')}
                  >
                    {row.VR_NO ?? row.vr_no ?? '—'}
                  </td>
                  <td className="col-bill-ledger-vt">
                    <span className={`badge-type ${row.VR_TYPE ?? row.vr_type ?? ''}`}>
                      {row.VR_TYPE ?? row.vr_type ?? '—'}
                    </span>
                  </td>
                  <td className={`text-right col-bill-ledger-amt ${billLedgerCrFirst ? 'cr-amt' : 'dr-amt'}`}>
                    {fmt(billLedgerCrFirst ? row.CR_AMT ?? row.cr_amt : row.DR_AMT ?? row.dr_amt)}
                  </td>
                  <td className={`text-right col-bill-ledger-amt ${billLedgerCrFirst ? 'dr-amt' : 'cr-amt'}`}>
                    {fmt(billLedgerCrFirst ? row.DR_AMT ?? row.dr_amt : row.CR_AMT ?? row.cr_amt)}
                  </td>
                  <td className="text-right col-bill-ledger-amt" style={{ fontWeight: 700, color: '#2c7a7b' }}>
                    {fmtAlways(cl)}
                  </td>
                  {billLedgerInterest ? (
                    <>
                      <td className="text-right col-bill-ledger-int-days" style={{ opacity: 0.65 }}>
                        —
                      </td>
                      <td className="text-right col-bill-ledger-int-amt" style={{ opacity: 0.65 }}>
                        —
                      </td>
                      <td className="text-right col-bill-ledger-int-close" style={{ opacity: 0.65 }}>
                        —
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
            <tr className="bill-ledger-grand-total">
              <td colSpan={7}>
                <strong>GRAND TOTAL</strong>
                <span className="bill-ledger-grand-note">
                  {' '}
                  (Dr/Cr totals + sum of bill current balances
                  {billLedgerInterest ? `; interest per bill (${String(billLedgerKind).toLowerCase() === 'supplier' ? 'GETINT_SUP' : 'GETINT'})` : ''})
                </span>
              </td>
              <td className="text-right col-bill-ledger-amt">
                <strong>{fmtAlways(billLedgerCrFirst ? sumCr : sumDr)}</strong>
              </td>
              <td className="text-right col-bill-ledger-amt">
                <strong>{fmtAlways(billLedgerCrFirst ? sumDr : sumCr)}</strong>
              </td>
              <td className="text-right col-bill-ledger-amt">
                <strong>{fmtAlways(sumCurrent)}</strong>
              </td>
              {billLedgerInterest ? (
                <>
                  <td className="text-right col-bill-ledger-int-days">
                    <strong>—</strong>
                  </td>
                  <td className="text-right bill-ledger-interest-amt col-bill-ledger-int-amt">
                    <strong>{fmtAlways(sumInterest)}</strong>
                  </td>
                  <td className="text-right col-bill-ledger-int-close">
                    <strong>{fmtAlways(sumClosePlusInt)}</strong>
                  </td>
                </>
              ) : null}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'ageing-bills-detail') {
    let totalBal = 0;
    return (
      <div className="table-responsive table-responsive--bill-ledger table-responsive--ageing-drill">
        <table className="report-table report-table--bill-ledger report-table--ageing-bills-detail">
          <thead>
            <tr>
              <th scope="col" className="col-ageing-bd-code">Code</th>
              <th scope="col" className="col-ageing-bd-name">Name</th>
              <th scope="col" className="col-ageing-bd-bill">Bill no</th>
              <th scope="col" className="col-ageing-bd-date">Bill date</th>
              <th scope="col" className="col-ageing-bd-bt">B type</th>
              <th className="text-right col-ageing-bd-amt" scope="col">Dr amt</th>
              <th className="text-right col-ageing-bd-amt" scope="col">Cr amt</th>
              <th className="text-right col-ageing-bd-pending" scope="col">Pending bal</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const bal = parseFloat(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
              totalBal += bal;
              const rowKey = `ageing-bd-${i}`;
              const isSel = ageingDrillSelectedKey === rowKey;
              return (
                <tr
                  key={i}
                  className={['ledger-row-focusable', isSel ? 'ledger-row-selected' : ''].filter(Boolean).join(' ') || undefined}
                  onClick={() => setAgeingDrillSelectedKey(rowKey)}
                >
                  <td className="bill-code col-ageing-bd-code">{row.CODE ?? row.code ?? '—'}</td>
                  <td className="ledger-detail col-ageing-bd-name">{row.NAME ?? row.name ?? '—'}</td>
                  <td className="col-ageing-bd-bill">{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td className="col-ageing-bd-date">{formatLedgerDateDisplay(row.BILL_DATE ?? row.bill_date)}</td>
                  <td className="col-ageing-bd-bt">{row.B_TYPE ?? row.b_type ?? '—'}</td>
                  <td className="text-right dr-amt col-ageing-bd-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                  <td className="text-right cr-amt col-ageing-bd-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                  <td className="text-right col-ageing-bd-pending" style={{ fontWeight: 700, color: '#2c7a7b' }}>
                    {fmtAlways(bal)}
                  </td>
                </tr>
              );
            })}
            <tr
              className={[
                'bill-ledger-grand-total',
                ageingDrillSelectedKey === 'ageing-bd-grand' ? 'ledger-row-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setAgeingDrillSelectedKey('ageing-bd-grand')}
            >
              <td colSpan={7}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(totalBal)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  // --- SALE LIST (SALE + MASTER + ITEMMAST); day / grand totals + item summaries; detail row opens bill ---
  if (type === 'sale-list') {
    const { displayRows } = buildSaleListDisplayRows(data, saleListSortMode);
    const clickable = typeof onSaleBillClick === 'function';
    return (
      <div className="table-responsive table-responsive--sale-list" ref={saleListGridScrollRef}>
        {onSaleBillClick ? (
          <p className="sale-list-hint">
            Use the <strong>horizontal scrollbar</strong> in this grid (or Shift+mouse wheel) to see all columns.             A <strong>Bill total</strong> appears only when that bill has more than one line; single-line bills get a
            spacer row with the same horizontal rule. Every bill ends with a full-width line under it. Day totals always
            show. Click a detail row to open the full sale bill.
          </p>
        ) : null}
        <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={saleListTopScrollRef}>
          <div className="sale-list-scroll-sync-inner" ref={saleListTopInnerRef} />
        </div>
        <table
          className={[
            'report-table',
            'report-table--sale-list',
            saleListSortMode !== 'date' ? 'report-table--sale-list-grouped' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={SALE_LIST_TABLE_STYLE}
        >
          <colgroup>
            {SALE_LIST_COL_WIDTHS_PX.map((w, idx) => (
              <col key={`slc-${idx}`} style={{ width: `${w}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Tp</th>
              <th scope="col" title="Invoice number">
                InvNo
              </th>
              <th scope="col">Bt</th>
              <th scope="col" title="Party code">
                Party
              </th>
              <th scope="col">Name</th>
              <th scope="col">City</th>
              <th scope="col">PAN</th>
              <th scope="col">GST</th>
              <th scope="col">Bk</th>
              <th scope="col">Bk name</th>
              <th scope="col">Trn</th>
              <th scope="col">Item</th>
              <th scope="col">Item name</th>
              <th scope="col">BKH</th>
              <th className="text-right" scope="col">
                Qty
              </th>
              <th className="text-right" scope="col">
                Wt
              </th>
              <th className="text-right" scope="col">
                Rate
              </th>
              <th className="text-right" scope="col">
                Amount
              </th>
              <th className="text-right" scope="col">
                Taxable
              </th>
              <th className="text-right" scope="col">
                CGST
              </th>
              <th className="text-right" scope="col">
                SGST
              </th>
              <th className="text-right" scope="col">
                IGST
              </th>
              <th className="text-right" scope="col">
                Round off
              </th>
              <th className="text-right" scope="col">
                Bill amt
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((item, i) => {
              if (item.kind === 'day-header') {
                return (
                  <tr key={`dh-${i}`} className="sale-list-day-banner">
                    <td colSpan={24}>
                      <strong>Day–{item.dateLabel}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'day-total') {
                const dayTotalCaption = `Day total — ${item.dateLabel}`;
                return (
                  <tr key={`dt-${i}`} className="sale-list-day-total">
                    <td colSpan={14} className="sale-list-subtotal-label" title={dayTotalCaption}>
                      <strong>Day total</strong>
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td className="text-right">{fmtAlways(item.taxable)}</td>
                    <td className="text-right">{fmtAlways(item.cgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.sgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.igstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.othExp5)}</td>
                    <td className="text-right">{fmtAlways(item.billAmt)}</td>
                  </tr>
                );
              }
              if (item.kind === 'bill-gap') {
                return (
                  <tr key={`bg-${i}`} className="sale-list-bill-gap" aria-hidden="true">
                    <td colSpan={24} />
                  </tr>
                );
              }
              if (item.kind === 'bill-total') {
                const billTotalCaption = `Bill total — ${item.type} / ${item.billDateLabel} / ${item.billNo} / ${item.bType}`;
                return (
                  <tr key={`bt-${i}`} className="sale-list-bill-total">
                    <td colSpan={14} className="sale-list-subtotal-label" title={billTotalCaption}>
                      <strong>Bill total</strong>
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td className="text-right">{fmtAlways(item.taxable)}</td>
                    <td className="text-right">{fmtAlways(item.cgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.sgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.igstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.othExp5)}</td>
                    <td className="text-right">{fmtAlways(item.billAmt)}</td>
                  </tr>
                );
              }
              if (item.kind === 'section-label') {
                return (
                  <tr key={`sl-${i}`} className="sale-list-section-label">
                    <td colSpan={24}>
                      <strong>{item.label}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'item-col-head') {
                return (
                  <tr key={`ich-${i}`} className="sale-list-item-col-head sale-list-item-summary-head">
                    <th
                      colSpan={14}
                      scope="colgroup"
                      className="sale-list-item-summary-lead"
                      title="Item code · Item name"
                    >
                      <div className="sale-list-item-sum-lead-inner">
                        <span className="sale-list-item-sum-h-code">Code</span>
                        <span className="sale-list-item-sum-h-name">Name</span>
                      </div>
                    </th>
                    <th scope="col" className="text-right sale-list-item-sum-measure-head">
                      Qty
                    </th>
                    <th scope="col" className="text-right sale-list-item-sum-measure-head">
                      Wt
                    </th>
                    <th scope="col" className="sale-list-item-summary-rate-head" title="Rate (not in item totals)">
                      —
                    </th>
                    <th scope="col" className="text-right sale-list-item-sum-measure-head">
                      Amount
                    </th>
                    <td colSpan={6} className="sale-list-item-summary-filler sale-list-item-summary-filler--trail" />
                  </tr>
                );
              }
              if (item.kind === 'grand-item') {
                const codeShown = item.code && item.code !== '—' ? item.code : '—';
                return (
                  <tr key={`gi-${i}-${item.code}`} className="sale-list-grand-item sale-list-item-summary-row">
                    <td colSpan={14} className="sale-list-item-summary-lead">
                      <div className="sale-list-item-sum-lead-inner">
                        <span className="sale-list-item-sum-code bill-code" title={String(codeShown).trim() || undefined}>
                          {codeShown}
                        </span>
                        <span className="sale-list-item-sum-name ledger-detail" title={String(item.name ?? '').trim() || undefined}>
                          <strong>{item.name}</strong>
                        </span>
                      </div>
                    </td>
                    <td className="text-right sale-list-item-sum-measure">{fmtAlways(item.qnty)}</td>
                    <td className="text-right sale-list-item-sum-measure">{fmtAlways(item.weight)}</td>
                    <td className="sale-list-item-summary-rate-pad sale-list-item-sum-rate-dash" title="Rate (not summed)">
                      —
                    </td>
                    <td className="text-right sale-list-item-sum-measure">{fmtAlways(item.amount)}</td>
                    <td colSpan={6} className="sale-list-item-summary-filler sale-list-item-summary-filler--trail">
                      —
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'grand-total') {
                return (
                  <tr key={`gt-${i}`} className="sale-list-grand-total">
                    <td colSpan={14}>
                      <strong>Grand total</strong>
                    </td>
                    <td className="text-right">{fmtAlways(item.qnty)}</td>
                    <td className="text-right">{fmtAlways(item.weight)}</td>
                    <td className="text-right">—</td>
                    <td className="text-right">{fmtAlways(item.amount)}</td>
                    <td className="text-right">{fmtAlways(item.taxable)}</td>
                    <td className="text-right">{fmtAlways(item.cgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.sgstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.igstAmt)}</td>
                    <td className="text-right">{fmtAlways(item.othExp5)}</td>
                    <td className="text-right">{fmtAlways(item.billAmt)}</td>
                  </tr>
                );
              }
              const row = item.row;
              const isCreditNote = isSaleListCn(row);
              const rowClass = [
                'sale-list-line',
                clickable && 'sale-list-row-clickable',
                isCreditNote && 'sale-list-row-cn',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr
                  key={`d-${i}`}
                  className={rowClass || undefined}
                  onClick={clickable ? () => onSaleBillClick(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSaleBillClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? 'button' : undefined}
                >
                  <td>{row.TYPE ?? row.type ?? '—'}</td>
                  <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td>{row.B_TYPE ?? row.b_type ?? '—'}</td>
                  <td className="bill-code" title={String(row.CODE ?? row.code ?? '').trim() || undefined}>
                    {row.CODE ?? row.code ?? '—'}
                  </td>
                  <td className="ledger-detail">{row.NAME ?? row.name ?? '—'}</td>
                  <td title={String(row.CITY ?? row.city ?? '').trim() || undefined}>
                    {row.CITY ?? row.city ?? '—'}
                  </td>
                  <td title={String(row.PAN ?? row.pan ?? '').trim() || undefined}>
                    {row.PAN ?? row.pan ?? '—'}
                  </td>
                  <td>{row.GST_NO ?? row.gst_no ?? '—'}</td>
                  <td
                    className="bill-code"
                    title={String(row.B_CODE ?? row.b_code ?? row.BK_CODE ?? row.bk_code ?? '').trim() || undefined}
                  >
                    {row.B_CODE ?? row.b_code ?? row.BK_CODE ?? row.bk_code ?? '—'}
                  </td>
                  <td className="ledger-detail" title={row.BK_NAME ?? row.bk_name ?? ''}>
                    {clampText(row.BK_NAME ?? row.bk_name ?? '—', 25)}
                  </td>
                  <td title={String(row.TRN_NO ?? row.trn_no ?? '').trim() || undefined}>
                    {row.TRN_NO ?? row.trn_no ?? '—'}
                  </td>
                  <td
                    className="bill-code"
                    title={String(row.ITEM_CODE ?? row.item_code ?? '').trim() || undefined}
                  >
                    {row.ITEM_CODE ?? row.item_code ?? '—'}
                  </td>
                  <td
                    className="ledger-detail"
                    title={String(row.ITEM_NAME ?? row.item_name ?? '').trim() || undefined}
                  >
                    {row.ITEM_NAME ?? row.item_name ?? '—'}
                  </td>
                  <td>{row.STATUS ?? row.status ?? '—'}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'QNTY', 'qnty'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'WEIGHT', 'weight'))}</td>
                  <td className="text-right">{fmt(row.RATE ?? row.rate)}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'AMOUNT', 'amount'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'TAXABLE', 'taxable'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'CGST_AMT', 'cgst_amt'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'SGST_AMT', 'sgst_amt'))}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'IGST_AMT', 'igst_amt'))}</td>
                  <td className="text-right">{fmt(row.OTH_EXP5 ?? row.oth_exp5)}</td>
                  <td className="text-right">{fmt(saleListMeas(row, 'BILL_AMT', 'bill_amt'))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // --- BROKER-WISE OUTSTANDING (alpha party within broker + party / broker / grand totals) ---
  if (type === 'broker-os') {
    const { displayRows, grandDr, grandCr } = buildBrokerOsDisplayRows(data);
    const brokerOsCrFirst = brokerOsCrFirstFromSchedule(meta?.schedule);

    return (
      <div className="table-responsive table-responsive--broker-os">
        <table className="report-table report-table--broker-os">
          <thead>
            <tr>
              <th scope="col">Broker</th>
              <th scope="col">Code</th>
              <th scope="col">Party</th>
              <th scope="col">Bill no</th>
              <th scope="col">Bill date</th>
              <th scope="col">Vr type</th>
              <th scope="col">Vr date</th>
              <th scope="col">Vr no</th>
              {brokerOsCrFirst ? (
                <>
                  <th className="text-right" scope="col">
                    Cr amt
                  </th>
                  <th className="text-right" scope="col">
                    Dr amt
                  </th>
                </>
              ) : (
                <>
                  <th className="text-right" scope="col">
                    Dr amt
                  </th>
                  <th className="text-right" scope="col">
                    Cr amt
                  </th>
                </>
              )}
              <th className="text-right" scope="col">
                Run bal
              </th>
              <th className="text-right" scope="col">
                Final bal
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((item, i) => {
              if (item.kind === 'bill-total') {
                const code = item.CODE || '—';
                const billDt = formatLedgerDateDisplay(item.BILL_DATE ?? item.bill_date);
                const billNo = item.BILL_NO || '—';
                const bType = item.B_TYPE || '—';
                return (
                  <tr key={`blt-${i}`} className="broker-os-bill-total">
                    <td colSpan={8}>
                      <strong>
                        Bill total — {code} / {billDt} / {billNo} / {bType}
                      </strong>
                    </td>
                    {brokerOsCrFirst ? (
                      <>
                        <td className="text-right cr-amt">
                          <strong>{fmtAlways(item.CR_AMT)}</strong>
                        </td>
                        <td className="text-right dr-amt">
                          <strong>{fmtAlways(item.DR_AMT)}</strong>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-right dr-amt">
                          <strong>{fmtAlways(item.DR_AMT)}</strong>
                        </td>
                        <td className="text-right cr-amt">
                          <strong>{fmtAlways(item.CR_AMT)}</strong>
                        </td>
                      </>
                    )}
                    <td className="text-right">—</td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'party-total') {
                const label = `Party total — ${item.NAME || '—'} (${item.CODE})`;
                return (
                  <tr key={`pt-${i}`} className="broker-os-party-total">
                    <td colSpan={8}>
                      <strong>{label}</strong>
                    </td>
                    {brokerOsCrFirst ? (
                      <>
                        <td className="text-right cr-amt">
                          <strong>{fmtAlways(item.CR_AMT)}</strong>
                        </td>
                        <td className="text-right dr-amt">
                          <strong>{fmtAlways(item.DR_AMT)}</strong>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-right dr-amt">
                          <strong>{fmtAlways(item.DR_AMT)}</strong>
                        </td>
                        <td className="text-right cr-amt">
                          <strong>{fmtAlways(item.CR_AMT)}</strong>
                        </td>
                      </>
                    )}
                    <td className="text-right">—</td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong>
                    </td>
                  </tr>
                );
              }
              if (item.kind === 'broker-total') {
                return (
                  <tr key={`bt-${i}`} className="broker-os-broker-total">
                    <td colSpan={8}>
                      <strong>
                        Broker total — {brokerOsBCodeOf(item) || '—'}
                      </strong>
                    </td>
                    {brokerOsCrFirst ? (
                      <>
                        <td className="text-right cr-amt">
                          <strong>{fmtAlways(item.CR_AMT)}</strong>
                        </td>
                        <td className="text-right dr-amt">
                          <strong>{fmtAlways(item.DR_AMT)}</strong>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="text-right dr-amt">
                          <strong>{fmtAlways(item.DR_AMT)}</strong>
                        </td>
                        <td className="text-right cr-amt">
                          <strong>{fmtAlways(item.CR_AMT)}</strong>
                        </td>
                      </>
                    )}
                    <td className="text-right">—</td>
                    <td className="text-right">
                      <strong>{fmtAlways(item.FINAL_BAL ?? ((item.DR_AMT ?? 0) - (item.CR_AMT ?? 0)))}</strong>
                    </td>
                  </tr>
                );
              }
              const row = item.row;
              const billDt = row.BILL_DATE ?? row.bill_date;
              const vrDt = row.VR_DATE ?? row.vr_date;
              const runB = parseFloat(row.RUN_BAL ?? row.run_bal ?? 0) || 0;
              const finB = parseFloat(row.FINAL_BAL ?? row.final_bal ?? 0) || 0;
              return (
                <tr key={`d-${i}`}>
                  <td className="bill-code">{brokerOsBCodeOf(row) || '—'}</td>
                  <td>{row.CODE ?? row.code ?? '—'}</td>
                  <td className="ledger-detail">{row.NAME ?? row.name ?? '—'}</td>
                  <td>{row.BILL_NO ?? row.bill_no ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(billDt)}</td>
                  <td>
                    <span className={`badge-type ${row.VR_TYPE ?? row.vr_type ?? ''}`}>
                      {row.VR_TYPE ?? row.vr_type ?? '—'}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(vrDt)}</td>
                  <td>{row.VR_NO ?? row.vr_no ?? '—'}</td>
                  {brokerOsCrFirst ? (
                    <>
                      <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                      <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                    </>
                  ) : (
                    <>
                      <td className="text-right dr-amt">{fmt(row.DR_AMT ?? row.dr_amt)}</td>
                      <td className="text-right cr-amt">{fmt(row.CR_AMT ?? row.cr_amt)}</td>
                    </>
                  )}
                  <td className="text-right" style={{ fontWeight: 700, color: '#2c7a7b' }}>
                    {fmtAlways(runB)}
                  </td>
                  <td className="text-right" style={{ fontWeight: 600, color: '#1e3a5f' }}>
                    {fmtAlways(finB)}
                  </td>
                </tr>
              );
            })}
            <tr className="bill-ledger-grand-total">
              <td colSpan={8}>
                <strong>GRAND TOTAL</strong>
                <span className="bill-ledger-grand-note"> (all detail lines)</span>
              </td>
              {brokerOsCrFirst ? (
                <>
                  <td className="text-right">
                    <strong>{fmtAlways(grandCr)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAlways(grandDr)}</strong>
                  </td>
                </>
              ) : (
                <>
                  <td className="text-right">
                    <strong>{fmtAlways(grandDr)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtAlways(grandCr)}</strong>
                  </td>
                </>
              )}
              <td className="text-right">
                <strong>—</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(grandDr - grandCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (type === 'ageing') {
    const labels = Array.isArray(meta?.rangeLabels) && meta.rangeLabels.length === 5
      ? meta.rangeLabels
      : ['0 to 30', '31 to 60', '61 to 90', '91 to 180', '181 to 99999'];
    const scheduleRaw = meta?.schedule;
    const totals = {
      curBalDisplayed: 0,
      curBalRaw: 0,
      ranges: [0, 0, 0, 0, 0],
    };
    data.forEach((row) => {
      const rawBal = parseFloat(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
      const { display } = ageingCurBalDisplay(scheduleRaw, rawBal);
      totals.curBalDisplayed += display;
      totals.curBalRaw += rawBal;
      for (let i = 0; i < 5; i += 1) {
        totals.ranges[i] += parseFloat(row[`RANGE_${i + 1}`] ?? row[`range_${i + 1}`] ?? 0) || 0;
      }
    });
    const totalCurAlert = ageingCurBalDisplay(scheduleRaw, totals.curBalRaw).alert;

    return (
      <div className="table-responsive table-responsive--trial">
        <table className="report-table report-table--trial">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>City</th>
              <th className="text-right">Cur. Bal</th>
              {labels.map((label, idx) => (
                <th key={idx} className="text-right">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => {
              const rawBal = parseFloat(row.CUR_BAL ?? row.cur_bal ?? 0) || 0;
              const curDisp = ageingCurBalDisplay(scheduleRaw, rawBal);
              const ageingRowKey = `ageing-main-${idx}`;
              const isAgeingSel = ageingListSelectedKey === ageingRowKey;
              return (
              <tr
                key={idx}
                className={
                  [
                    typeof onLedgerClick === 'function' ? 'clickable-row' : '',
                    isAgeingSel ? 'trial-row-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onClick={() => {
                  setAgeingListSelectedKey(ageingRowKey);
                  if (typeof onLedgerClick === 'function') onLedgerClick(row.CODE ?? row.code, row.NAME ?? row.name, row);
                }}
              >
                <td>{row.CODE ?? row.code ?? '—'}</td>
                <td className="trial-name">
                  <span className="name-text">{row.NAME ?? row.name ?? '—'}</span>
                </td>
                <td>{row.CITY ?? row.city ?? '—'}</td>
                <td className={`text-right${curDisp.alert ? ' ageing-cur-bal-alert' : ''}`}>
                  <strong>{fmtAlways(curDisp.display)}</strong>
                </td>
                {labels.map((_, i) => (
                  <td key={i} className="text-right">
                    {fmt(row[`RANGE_${i + 1}`] ?? row[`range_${i + 1}`])}
                  </td>
                ))}
              </tr>
              );
            })}
            <tr className="trial-grand-total">
              <td colSpan={3}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className={`text-right${totalCurAlert ? ' ageing-cur-bal-alert' : ''}`}>
                <strong>{fmtAlways(totals.curBalDisplayed)}</strong>
              </td>
              {totals.ranges.map((value, idx) => (
                <td key={idx} className="text-right">
                  <strong>{fmtAlways(value)}</strong>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}