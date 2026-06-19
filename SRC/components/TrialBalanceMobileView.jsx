import React, { useLayoutEffect, useMemo, useState } from 'react';
import SessionToolbarChrome from './SessionToolbarChrome';
import { mountLedgerFullBleedLayout } from '../utils/ledgerFullBleedLayout';
import {
  buildTrialMobileGroups,
  formatTrialIndianAmount,
  trialAccountClosingDisplay,
  trialAccountCode,
  trialAccountRowKey,
  trialGroupHeaderAmount,
  trialGroupTitle,
  trialRowAmounts,
  trialScheduleKey,
} from '../utils/trialBalanceMobileDisplay';

function TrialMobileAmountDetail({ row }) {
  const { closingDr, closingCr, drAmt, crAmt } = trialRowAmounts(row);
  const fmt = (n) => (n > 0 ? `₹${formatTrialIndianAmount(n)}` : '—');
  return (
    <div className="tb-mobile__amount-detail">
      <div className="tb-mobile__amount-detail-cell">
        <span className="tb-mobile__amount-detail-label">Closing Dr</span>
        <span className="tb-mobile__amount-detail-value tb-mobile__amount-detail-value--dr">{fmt(closingDr)}</span>
      </div>
      <div className="tb-mobile__amount-detail-cell">
        <span className="tb-mobile__amount-detail-label">Closing Cr</span>
        <span className="tb-mobile__amount-detail-value tb-mobile__amount-detail-value--cr">{fmt(closingCr)}</span>
      </div>
      <div className="tb-mobile__amount-detail-cell">
        <span className="tb-mobile__amount-detail-label">Total Dr</span>
        <span className="tb-mobile__amount-detail-value tb-mobile__amount-detail-value--dr">{fmt(drAmt)}</span>
      </div>
      <div className="tb-mobile__amount-detail-cell">
        <span className="tb-mobile__amount-detail-label">Total Cr</span>
        <span className="tb-mobile__amount-detail-value tb-mobile__amount-detail-value--cr">{fmt(crAmt)}</span>
      </div>
    </div>
  );
}

/** Mobile card trial balance — tap code → ledger; tap amount → Total Dr / Total Cr detail. */
export default function TrialBalanceMobileView({
  rows,
  compName,
  compYear,
  periodStartLabel,
  periodEndLabel,
  endDateDisplay,
  closingDr,
  closingCr,
  onBack,
  onLedgerClick,
  onExportPdf,
  onExportExcel,
  onExportWhatsApp,
  pdfBusy = false,
  helpReportId = 'trial-balance',
}) {
  const [filter, setFilter] = useState('all');
  const [listMode, setListMode] = useState('cards');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [expandedAmountKey, setExpandedAmountKey] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useLayoutEffect(() => mountLedgerFullBleedLayout(), []);

  const groups = useMemo(() => buildTrialMobileGroups(rows, filter), [rows, filter]);
  const groupKeys = useMemo(() => groups.map((g) => g.scheduleKey), [groups]);
  const allSchedulesExpanded = groupKeys.length > 0 && groupKeys.every((key) => !collapsedGroups[key]);
  const diff = Math.abs((parseFloat(closingDr) || 0) - (parseFloat(closingCr) || 0));
  const fyLine = [compYear ? `FY ${compYear}` : '', periodStartLabel && periodEndLabel ? `${periodStartLabel} – ${periodEndLabel}` : '']
    .filter(Boolean)
    .join(' | ');

  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAllSchedules = () => {
    if (allSchedulesExpanded) {
      const next = {};
      groupKeys.forEach((key) => {
        next[key] = true;
      });
      setCollapsedGroups(next);
    } else {
      setCollapsedGroups({});
    }
  };

  const handleCodePress = (row, e) => {
    e?.stopPropagation?.();
    const code = trialAccountCode(row);
    if (!code || typeof onLedgerClick !== 'function') return;
    const name = String(row.NAME ?? row.name ?? '').trim();
    onLedgerClick(code, name);
  };

  const handleAmountPress = (rowKey) => {
    setExpandedAmountKey((prev) => (prev === rowKey ? null : rowKey));
  };

  return (
    <div className="slide slide-4 tb-mobile ledger-full-bleed">
      <header className="tb-mobile__header">
        <button type="button" className="tb-mobile__header-back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="tb-mobile__header-text">
          <div className="tb-mobile__header-title">Trial Balance</div>
          {fyLine ? <div className="tb-mobile__header-sub">{fyLine}</div> : null}
        </div>
        <div className="tb-mobile__header-actions">
          <SessionToolbarChrome helpReportId={helpReportId} helpCompanyName={compName} />
          <div className="tb-mobile__menu-wrap">
            <button
              type="button"
              className="tb-mobile__menu-btn"
              aria-label="Export options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              ⋮
            </button>
            {menuOpen ? (
              <div className="tb-mobile__menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="tb-mobile__menu-item"
                  disabled={pdfBusy}
                  onClick={() => {
                    setMenuOpen(false);
                    onExportPdf?.();
                  }}
                >
                  PDF
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="tb-mobile__menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onExportExcel?.();
                  }}
                >
                  Excel
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="tb-mobile__menu-item"
                  disabled={pdfBusy}
                  onClick={() => {
                    setMenuOpen(false);
                    onExportWhatsApp?.();
                  }}
                >
                  WhatsApp
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="tb-mobile__sticky">
        <div className="tb-mobile__session">
          <div className="tb-mobile__session-company">{compName || '—'}</div>
          {endDateDisplay ? (
            <div className="tb-mobile__asof">
              <span aria-hidden="true">📅</span> As of {endDateDisplay}
            </div>
          ) : null}
        </div>

        <div className="tb-mobile__summary">
          <div className="tb-mobile__summary-card tb-mobile__summary-card--debit">
            <span className="tb-mobile__summary-label">Total Debit</span>
            <span className="tb-mobile__summary-value">₹{formatTrialIndianAmount(closingDr)}</span>
          </div>
          <div className="tb-mobile__summary-card tb-mobile__summary-card--credit">
            <span className="tb-mobile__summary-label">Total Credit</span>
            <span className="tb-mobile__summary-value">₹{formatTrialIndianAmount(closingCr)}</span>
          </div>
        </div>
        {diff > 0.005 ? (
          <div className="tb-mobile__diff">⚠️ Diff ₹{formatTrialIndianAmount(diff)}</div>
        ) : null}

        <div className="tb-mobile__filters" role="group" aria-label="Account filters">
          {[
            { id: 'all', label: 'All Accounts' },
            { id: 'balance', label: 'With Balance' },
            { id: 'unbalanced', label: 'Unbalanced' },
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`tb-mobile__filter${filter === id ? ' is-active' : ''}`}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="tb-mobile__list-toolbar">
          <button
            type="button"
            className="tb-mobile__expand-all"
            disabled={groupKeys.length === 0}
            onClick={toggleAllSchedules}
          >
            {allSchedulesExpanded ? 'Collapse All' : 'Expand All'}
          </button>
          <div className="tb-mobile__view-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`tb-mobile__view-btn${listMode === 'cards' ? ' is-active' : ''}`}
              aria-pressed={listMode === 'cards'}
              onClick={() => setListMode('cards')}
            >
              Cards
            </button>
            <button
              type="button"
              className={`tb-mobile__view-btn${listMode === 'table' ? ' is-active' : ''}`}
              aria-pressed={listMode === 'table'}
              onClick={() => setListMode('table')}
            >
              Table
            </button>
          </div>
        </div>
      </div>

      <div className="tb-mobile__list">
        {groups.length === 0 ? (
          <p className="tb-mobile__empty">No accounts match this filter.</p>
        ) : listMode === 'table' ? (
          groups.map((group) => {
            const gKey = group.scheduleKey;
            const collapsed = Boolean(collapsedGroups[gKey]);
            const headerAmt = trialGroupHeaderAmount(group);
            return (
              <div key={gKey} className="tb-mobile__table-group">
                <button type="button" className="tb-mobile__table-group-head" onClick={() => toggleGroup(gKey)}>
                  <span className="tb-mobile__table-group-title">{trialGroupTitle(group)}</span>
                  <span className="tb-mobile__table-group-right">
                    {headerAmt.amount > 0 ? (
                      <span className={`tb-mobile__table-group-amt tb-mobile__table-group-amt--${headerAmt.tone}`}>
                        ₹{formatTrialIndianAmount(headerAmt.amount)}
                      </span>
                    ) : null}
                    <span className="tb-mobile__chevron" aria-hidden="true">
                      {collapsed ? '▸' : '▾'}
                    </span>
                  </span>
                </button>
                {!collapsed
                  ? group.accounts.map((row, i) => {
                      const code = trialAccountCode(row);
                      const closing = trialAccountClosingDisplay(row);
                      const rowKey = trialAccountRowKey(row, i);
                      return (
                        <div key={rowKey} className="tb-mobile__table-row">
                          <button
                            type="button"
                            className="tb-mobile__code-pill"
                            disabled={!code}
                            onClick={(e) => handleCodePress(row, e)}
                          >
                            {code || '—'}
                          </button>
                          <span className="tb-mobile__table-name">{String(row.NAME ?? row.name ?? '—')}</span>
                          <button
                            type="button"
                            className={`tb-mobile__table-amt tb-mobile__table-amt--${closing.tone}`}
                            onClick={() => handleAmountPress(rowKey)}
                          >
                            {closing.amount > 0 ? `₹${formatTrialIndianAmount(closing.amount)}` : '—'}
                          </button>
                          {expandedAmountKey === rowKey ? <TrialMobileAmountDetail row={row} /> : null}
                        </div>
                      );
                    })
                  : null}
              </div>
            );
          })
        ) : (
          groups.map((group) => {
            const gKey = group.scheduleKey;
            const collapsed = Boolean(collapsedGroups[gKey]);
            const headerAmt = trialGroupHeaderAmount(group);
            return (
              <section key={gKey} className="tb-mobile__group">
                <button type="button" className="tb-mobile__group-head" onClick={() => toggleGroup(gKey)}>
                  <span className="tb-mobile__group-title">{trialGroupTitle(group)}</span>
                  <span className="tb-mobile__group-right">
                    {headerAmt.amount > 0 ? (
                      <span className={`tb-mobile__group-amt tb-mobile__group-amt--${headerAmt.tone}`}>
                        ₹{formatTrialIndianAmount(headerAmt.amount)}
                        {headerAmt.side ? ` ${headerAmt.side}` : ''}
                      </span>
                    ) : null}
                    <span className="tb-mobile__chevron" aria-hidden="true">
                      {collapsed ? '▸' : '▾'}
                    </span>
                  </span>
                </button>

                {!collapsed ? (
                  <div className="tb-mobile__group-body">
                    {group.accounts.map((row, i) => {
                      const code = trialAccountCode(row);
                      const sch = trialScheduleKey(row);
                      const name = String(row.NAME ?? row.name ?? '—');
                      const city = String(row.CITY ?? row.city ?? '').trim();
                      const closing = trialAccountClosingDisplay(row);
                      const rowKey = trialAccountRowKey(row, i);
                      const expanded = expandedAmountKey === rowKey;

                      return (
                        <article key={rowKey} className={`tb-mobile__card${expanded ? ' tb-mobile__card--expanded' : ''}`}>
                          <div className="tb-mobile__card-top">
                            <div className="tb-mobile__card-main">
                              <div className="tb-mobile__card-name">
                                {sch ? `${sch} ` : ''}
                                {name}
                              </div>
                              <div className="tb-mobile__card-meta">
                                {code ? (
                                  <button
                                    type="button"
                                    className="tb-mobile__code-pill"
                                    onClick={(e) => handleCodePress(row, e)}
                                  >
                                    {code}
                                  </button>
                                ) : null}
                                {city ? <span className="tb-mobile__city-pill">{city}</span> : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`tb-mobile__card-amt tb-mobile__card-amt--${closing.tone}`}
                              onClick={() => handleAmountPress(rowKey)}
                            >
                              <span className="tb-mobile__card-amt-value">
                                {closing.amount > 0 ? `₹${formatTrialIndianAmount(closing.amount)}` : '—'}
                              </span>
                              {closing.side ? (
                                <span className="tb-mobile__card-amt-side">Closing {closing.side}</span>
                              ) : null}
                            </button>
                          </div>
                          {expanded ? <TrialMobileAmountDetail row={row} /> : null}
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
