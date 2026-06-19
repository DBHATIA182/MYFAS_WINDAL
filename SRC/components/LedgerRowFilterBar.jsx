import React from 'react';

const AMOUNT_SIDES = [
  { id: 'all', label: 'All' },
  { id: 'dr', label: 'Dr only' },
  { id: 'cr', label: 'Cr only' },
];

/** Search/filter bar for ledger — text, Vr.Type, Dr/Cr toggles. */
export default function LedgerRowFilterBar({
  value,
  onChange,
  amountSide = 'all',
  onAmountSideChange,
  vrType = 'all',
  vrTypeOptions = [],
  onVrTypeChange,
  shownCount,
  totalCount,
  className = '',
  placeholder = 'Filter all columns — date, voucher no., type, detail, Dr, Cr, balance…',
}) {
  const textActive = String(value ?? '').trim().length > 0;
  const amountActive = amountSide === 'dr' || amountSide === 'cr';
  const vrTypeActive = vrType && vrType !== 'all';
  const filterActive = textActive || amountActive || vrTypeActive;

  const filterHints = [];
  if (vrTypeActive) filterHints.push(`Vr ${vrType}`);
  if (amountActive) filterHints.push(amountSide === 'dr' ? 'Dr only' : 'Cr only');

  return (
    <div className={`fas-ledger-filter${className ? ` ${className}` : ''}`}>
      <div className="fas-ledger-filter__main">
        <label className="fas-ledger-filter__label">
          <span className="fas-ledger-filter__icon" aria-hidden="true">
            🔍
          </span>
          <input
            type="search"
            className="fas-ledger-filter__input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            aria-label="Filter ledger rows"
          />
          {textActive ? (
            <button
              type="button"
              className="fas-ledger-filter__clear"
              aria-label="Clear text filter"
              onClick={() => onChange('')}
            >
              ×
            </button>
          ) : null}
        </label>

        {onVrTypeChange && vrTypeOptions.length > 0 ? (
          <label className="fas-ledger-filter__vr-type">
            <span className="fas-ledger-filter__vr-type-label">Vr.Type</span>
            <select
              className="fas-ledger-filter__vr-type-select"
              value={vrType}
              onChange={(e) => onVrTypeChange(e.target.value)}
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

        {onAmountSideChange ? (
          <div className="fas-ledger-filter__sides" role="group" aria-label="Filter by amount type">
            {AMOUNT_SIDES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`fas-ledger-filter__side${amountSide === id ? ' is-active' : ''}${
                  id === 'dr' ? ' fas-ledger-filter__side--dr' : id === 'cr' ? ' fas-ledger-filter__side--cr' : ''
                }`}
                aria-pressed={amountSide === id}
                onClick={() => onAmountSideChange(id)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {filterActive && totalCount != null ? (
        <span className="fas-ledger-filter__count">
          Showing {shownCount ?? 0} of {totalCount} entries
          {filterHints.length ? ` · ${filterHints.join(' · ')}` : ''}
        </span>
      ) : null}
    </div>
  );
}
