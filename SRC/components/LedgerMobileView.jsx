import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import SessionToolbarChrome from './SessionToolbarChrome';
import { mountLedgerFullBleedLayout } from '../utils/ledgerFullBleedLayout';
import {
  filterLedgerMobileRows,
  ledgerFilterIsActive,
  collectLedgerVrTypes,
  formatBalanceDrCr,
  formatIndianLedgerAmount,
  formatLedgerMobileShortDate,
  formatParamMobileDate,
  formatLedgerMobileRowBal,
  formatSignedLedgerAmount,
  ledgerMobileRowClickable,
  ledgerMobileRowTitle,
  ledgerMobileVrMeta,
  ledgerRowSignedAmount,
  LEDGER_AMT_EPS,
  splitLedgerMobileRows,
} from '../utils/ledgerMobileDisplay';

function LedgerMobileTxnCard({ row, onVoucherClick, onLedgerSaleBillClick }) {
  const vrType = row.VR_TYPE ?? row.vr_type;
  const vrDate = row.VR_DATE ?? row.vr_date;
  const vrNo = row.VR_NO ?? row.vr_no;
  const signedAmt = ledgerRowSignedAmount(row);
  const meta = ledgerMobileVrMeta(vrType);
  const { clickable, canSaleBill, canDrill } = ledgerMobileRowClickable(row, {
    onVoucherClick,
    onLedgerSaleBillClick,
  });
  const isDebit = signedAmt > 0;
  const isCredit = signedAmt < 0;

  const handleClick = () => {
    if (canSaleBill) onLedgerSaleBillClick(row);
    else if (canDrill) onVoucherClick(row);
  };

  return (
    <button
      type="button"
      className={`ledger-new-mobile__card${clickable ? ' ledger-new-mobile__card--clickable' : ''}`}
      onClick={clickable ? handleClick : undefined}
      disabled={!clickable}
    >
      <span className={`ledger-new-mobile__card-icon ledger-new-mobile__card-icon--${meta.tone}`} aria-hidden="true">
        {meta.icon}
      </span>
      <span className="ledger-new-mobile__card-body">
        <span className="ledger-new-mobile__card-title">{ledgerMobileRowTitle(row)}</span>
        <span className="ledger-new-mobile__card-meta">
          <span className="ledger-new-mobile__chip ledger-new-mobile__chip--date">
            {formatLedgerMobileShortDate(vrDate) || '—'}
          </span>
          {vrNo != null && String(vrNo).trim() !== '' ? (
            <span className="ledger-new-mobile__chip ledger-new-mobile__chip--vr">Vr: {String(vrNo)}</span>
          ) : null}
          {vrType ? (
            <span className={`ledger-new-mobile__chip ledger-new-mobile__chip--type ledger-new-mobile__chip--${meta.tone}`}>
              {meta.label}
            </span>
          ) : null}
        </span>
      </span>
      <span className="ledger-new-mobile__card-right">
        <span
          className={`ledger-new-mobile__card-amt${
            isCredit ? ' ledger-new-mobile__card-amt--credit' : isDebit ? ' ledger-new-mobile__card-amt--debit' : ''
          }`}
        >
          {Math.abs(signedAmt) >= LEDGER_AMT_EPS ? formatSignedLedgerAmount(signedAmt) : '—'}
        </span>
        <span className="ledger-new-mobile__card-bal">{formatLedgerMobileRowBal(row)}</span>
      </span>
    </button>
  );
}

/** Mobile-only card ledger (LEDGERNEW layout). Desktop keeps table view. */
export default function LedgerMobileView({
  companyName,
  accountName,
  accountCode,
  startDate,
  endDate,
  opening,
  sumDr,
  sumCr,
  closing,
  rows,
  onBack,
  onVoucherClick,
  onLedgerSaleBillClick,
  onExportPdf,
  onExportExcel,
  onExportWhatsApp,
  showPdf = true,
  showWhatsApp = true,
  helpReportId = 'ledger',
  helpCompanyName = '',
}) {
  const [search, setSearch] = useState('');
  const [amountSideFilter, setAmountSideFilter] = useState('all');
  const [vrTypeFilter, setVrTypeFilter] = useState('all');
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef(null);

  useLayoutEffect(() => mountLedgerFullBleedLayout(), []);

  const vrTypeOptions = useMemo(() => collectLedgerVrTypes(rows), [rows]);
  const { openingRows, txnRows } = useMemo(() => splitLedgerMobileRows(rows), [rows]);

  const { visibleTxn, filterStats, filterActive } = useMemo(() => {
    const txn = txnRows.map((t) => t.row);
    const filters = { amountSide: amountSideFilter, vrType: vrTypeFilter };
    const active = ledgerFilterIsActive(search, filters.amountSide, filters.vrType);
    const visible = filterLedgerMobileRows(txn, search, filters);
    return {
      visibleTxn: visible,
      filterStats: { shown: visible.length, total: txn.length },
      filterActive: active,
    };
  }, [txnRows, search, amountSideFilter, vrTypeFilter]);

  const listFilterKey = `${search}|${amountSideFilter}|${vrTypeFilter}`;

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [listFilterKey]);

  const openingBal =
    openingRows.length > 0
      ? parseFloat(
          openingRows[0].row.CL_BALANCE ??
            openingRows[0].row.cl_balance ??
            openingRows[0].row.RUN_BAL ??
            openingRows[0].row.run_bal ??
            opening
        ) || 0
      : opening;

  return (
    <div className="slide slide-5 ledger-new-mobile ledger-full-bleed">
      <header className="ledger-new-mobile__header">
        <button type="button" className="ledger-new-mobile__header-back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="ledger-new-mobile__header-text">
          <div className="ledger-new-mobile__header-company">{companyName || 'Ledger'}</div>
          <div className="ledger-new-mobile__header-sub">Ledger Account</div>
          {accountName ? (
            <div className="ledger-new-mobile__header-account">
              {accountName}
              {accountCode ? ` · ${accountCode}` : ''}
            </div>
          ) : null}
        </div>
        <div className="ledger-new-mobile__header-actions">
          <SessionToolbarChrome helpReportId={helpReportId} helpCompanyName={helpCompanyName} />
          <div className="ledger-new-mobile__menu-wrap">
            <button
              type="button"
              className="ledger-new-mobile__menu-btn"
              aria-label="Export options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋮
            </button>
            {menuOpen ? (
              <div className="ledger-new-mobile__menu" role="menu">
                {showPdf && onExportPdf ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="ledger-new-mobile__menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPdf();
                    }}
                  >
                    📄 PDF
                  </button>
                ) : null}
                {onExportExcel ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="ledger-new-mobile__menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportExcel();
                    }}
                  >
                    📊 Excel
                  </button>
                ) : null}
                {showWhatsApp && onExportWhatsApp ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="ledger-new-mobile__menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportWhatsApp();
                    }}
                  >
                    💬 WhatsApp
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="ledger-new-mobile__sticky">
        <div className="ledger-new-mobile__dates">
          <span className="ledger-new-mobile__date-pill">{formatParamMobileDate(startDate)}</span>
          <span className="ledger-new-mobile__date-arrow" aria-hidden="true">
            →
          </span>
          <span className="ledger-new-mobile__date-pill">{formatParamMobileDate(endDate)}</span>
        </div>

        <div className="ledger-new-mobile__summary">
          <div className="ledger-new-mobile__summary-card ledger-new-mobile__summary-card--debit">
            <span className="ledger-new-mobile__summary-label">Total Dr</span>
            <span className="ledger-new-mobile__summary-value">₹{formatIndianLedgerAmount(sumDr)}</span>
          </div>
          <div className="ledger-new-mobile__summary-card ledger-new-mobile__summary-card--credit">
            <span className="ledger-new-mobile__summary-label">Total Cr</span>
            <span className="ledger-new-mobile__summary-value">₹{formatIndianLedgerAmount(sumCr)}</span>
          </div>
          <div
            className={`ledger-new-mobile__summary-card ledger-new-mobile__summary-card--balance${
              closing < 0 ? ' ledger-new-mobile__summary-card--balance-cr' : ' ledger-new-mobile__summary-card--balance-dr'
            }`}
          >
            <span className="ledger-new-mobile__summary-label">Balance</span>
            <span className="ledger-new-mobile__summary-value">{formatBalanceDrCr(closing)}</span>
          </div>
        </div>

        <label className="ledger-new-mobile__search">
          <span className="ledger-new-mobile__search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            className="ledger-new-mobile__search-input"
            placeholder="Filter all fields — date, voucher, detail, amounts, Dr/Cr…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </label>

        {vrTypeOptions.length > 0 ? (
          <label className="ledger-new-mobile__vr-type">
            <span className="ledger-new-mobile__vr-type-label">Vr.Type</span>
            <select
              className="ledger-new-mobile__vr-type-select"
              value={vrTypeFilter}
              onChange={(e) => setVrTypeFilter(e.target.value)}
              aria-label="Filter by voucher type"
            >
              <option value="all">All types</option>
              {vrTypeOptions.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="ledger-new-mobile__amount-sides" role="group" aria-label="Filter by amount type">
          {[
            { id: 'all', label: 'All' },
            { id: 'dr', label: 'Dr only' },
            { id: 'cr', label: 'Cr only' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`ledger-new-mobile__amount-side${amountSideFilter === id ? ' is-active' : ''}${
                id === 'dr' ? ' ledger-new-mobile__amount-side--dr' : id === 'cr' ? ' ledger-new-mobile__amount-side--cr' : ''
              }`}
              aria-pressed={amountSideFilter === id}
              onClick={() => setAmountSideFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {filterActive ? (
          <p className="ledger-new-mobile__filter-count">
            Showing {filterStats.shown} of {filterStats.total} entries
            {vrTypeFilter !== 'all' ? ` · Vr ${vrTypeFilter}` : ''}
            {amountSideFilter === 'dr' ? ' · Dr only' : amountSideFilter === 'cr' ? ' · Cr only' : ''}
          </p>
        ) : null}

        <div className="ledger-new-mobile__opening">
          <span>Opening Balance</span>
          <strong>{formatBalanceDrCr(openingBal)}</strong>
        </div>
      </div>

      <div ref={listRef} className="ledger-new-mobile__list" key={listFilterKey}>
        {visibleTxn.length > 0 ? (
          visibleTxn.map((row, i) => (
            <LedgerMobileTxnCard
              key={`${listFilterKey}-${row.VR_NO ?? row.vr_no ?? 'n'}-${row.VR_DATE ?? row.vr_date ?? 'd'}-${row.VR_TYPE ?? row.vr_type ?? 't'}-${row.TRN_NO ?? row.trn_no ?? i}`}
              row={row}
              onVoucherClick={onVoucherClick}
              onLedgerSaleBillClick={onLedgerSaleBillClick}
            />
          ))
        ) : filterActive ? (
          <p className="ledger-new-mobile__empty">No transactions match your filter.</p>
        ) : null}
      </div>

      <footer className="ledger-new-mobile__closing">
        <span>Closing Balance</span>
        <strong>{formatBalanceDrCr(closing)}</strong>
      </footer>
    </div>
  );
}
