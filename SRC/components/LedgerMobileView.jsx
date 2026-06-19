import React, { useLayoutEffect, useMemo, useState } from 'react';
import SessionToolbarChrome from './SessionToolbarChrome';
import { mountLedgerFullBleedLayout } from '../utils/ledgerFullBleedLayout';
import {
  filterLedgerMobileRows,
  formatBalanceDrCr,
  formatIndianLedgerAmount,
  formatLedgerMobileShortDate,
  formatParamMobileDate,
  formatLedgerMobileRowBal,
  ledgerMobileRowClickable,
  ledgerMobileRowTitle,
  ledgerMobileVrMeta,
  splitLedgerMobileRows,
} from '../utils/ledgerMobileDisplay';

function LedgerMobileTxnCard({ row, onVoucherClick, onLedgerSaleBillClick }) {
  const vrType = row.VR_TYPE ?? row.vr_type;
  const vrDate = row.VR_DATE ?? row.vr_date;
  const vrNo = row.VR_NO ?? row.vr_no;
  const drAmt = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
  const crAmt = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
  const meta = ledgerMobileVrMeta(vrType);
  const { clickable, canSaleBill, canDrill } = ledgerMobileRowClickable(row, {
    onVoucherClick,
    onLedgerSaleBillClick,
  });
  const isDebit = drAmt > 0;
  const isCredit = crAmt > 0;
  const amount = isDebit ? drAmt : isCredit ? crAmt : 0;

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
          {amount > 0 ? (
            <>
              {isCredit ? '+' : '−'}₹{formatIndianLedgerAmount(amount)}
            </>
          ) : (
            '—'
          )}
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
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => mountLedgerFullBleedLayout(), []);

  const { openingRows, txnRows } = useMemo(() => splitLedgerMobileRows(rows), [rows]);
  const filteredTxn = useMemo(
    () => filterLedgerMobileRows(txnRows.map((t) => t.row), search),
    [txnRows, search]
  );

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
            <span className="ledger-new-mobile__summary-value">₹{formatBalanceDrCr(closing)}</span>
          </div>
        </div>

        <label className="ledger-new-mobile__search">
          <span className="ledger-new-mobile__search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            className="ledger-new-mobile__search-input"
            placeholder="Search transactions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
        </label>

        <div className="ledger-new-mobile__opening">
          <span>Opening Balance</span>
          <strong>{formatBalanceDrCr(openingBal)}</strong>
        </div>
      </div>

      <div className="ledger-new-mobile__list">
        {filteredTxn.length === 0 ? (
          <p className="ledger-new-mobile__empty">No transactions match your search.</p>
        ) : (
          filteredTxn.map((row, i) => (
            <LedgerMobileTxnCard
              key={`${row.VR_NO ?? row.vr_no ?? i}-${row.VR_DATE ?? row.vr_date ?? i}`}
              row={row}
              onVoucherClick={onVoucherClick}
              onLedgerSaleBillClick={onLedgerSaleBillClick}
            />
          ))
        )}
      </div>

      <footer className="ledger-new-mobile__closing">
        <span>Closing Balance</span>
        <strong>{formatBalanceDrCr(closing)}</strong>
      </footer>
    </div>
  );
}
