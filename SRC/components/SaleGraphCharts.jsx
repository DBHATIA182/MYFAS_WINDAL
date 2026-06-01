import React, { useMemo } from 'react';

function fmtWt(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmt(n) {
  return (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtShort(n, isAmount) {
  const v = Math.abs(Number(n) || 0);
  if (v === 0) return '0';
  if (isAmount) {
    if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
    if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return String(Math.round(v));
  }
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

function isMonthClickable(month) {
  const mk = String(month?.monthKey ?? '').trim();
  return mk && !mk.startsWith('__prev_pad');
}

/** CSS column chart — weight + amount rows with values shown per month. */
function CombinedWtAmtChart({ months, hasPrevious, currentLabel, previousLabel, compact, onMonthClick }) {
  const weightsCur = months.map((m) => Math.max(0, Number(m.current?.weight) || 0));
  const weightsPrev = hasPrevious ? months.map((m) => Math.max(0, Number(m.previous?.weight) || 0)) : [];
  const amtsCur = months.map((m) => Math.max(0, Number(m.current?.amount) || 0));
  const amtsPrev = hasPrevious ? months.map((m) => Math.max(0, Number(m.previous?.amount) || 0)) : [];

  const maxWt = Math.max(1, ...weightsCur, ...(hasPrevious ? weightsPrev : [0]));
  const maxAmt = Math.max(1, ...amtsCur, ...(hasPrevious ? amtsPrev : [0]));

  const pct = (v, max) => `${Math.max(2, (v / max) * 100)}%`;

  return (
    <div className={`sale-chart-viz${compact ? ' sale-chart-viz--compact' : ''}`}>
      <div className="sale-chart-viz__legend">
        <span className="sale-chart-viz__legend-item sale-chart-viz__legend-item--wt-cur">Wt {currentLabel}</span>
        {hasPrevious ? (
          <span className="sale-chart-viz__legend-item sale-chart-viz__legend-item--wt-prev">Wt {previousLabel}</span>
        ) : null}
        <span className="sale-chart-viz__legend-item sale-chart-viz__legend-item--amt-cur">Amt {currentLabel}</span>
        {hasPrevious ? (
          <span className="sale-chart-viz__legend-item sale-chart-viz__legend-item--amt-prev">Amt {previousLabel}</span>
        ) : null}
      </div>
      <div className="sale-chart-viz__side-labels" aria-hidden="true">
        <span>Weight</span>
        <span>Amount</span>
      </div>
      <div className="sale-chart-viz__scroll" role="region" aria-label="Month-wise weight and amount">
        <div className="sale-chart-viz__cols" style={{ '--month-count': months.length }}>
          {months.map((m, i) => {
            const clickable = Boolean(onMonthClick) && isMonthClickable(m);
            const ColTag = clickable ? 'button' : 'div';
            const colProps = clickable
              ? {
                  type: 'button',
                  className: 'sale-chart-viz__col sale-chart-viz__col--clickable',
                  onClick: () => onMonthClick(m),
                  title: `Open sale list for ${m.label}`,
                }
              : { className: 'sale-chart-viz__col' };
            return (
            <ColTag key={m.monthKey || i} {...colProps}>
              <div className="sale-chart-viz__row sale-chart-viz__row--wt">
                <div className="sale-chart-viz__bar-group">
                  {hasPrevious ? (
                    <div
                      className="sale-chart-viz__bar sale-chart-viz__bar--wt-prev"
                      style={{ height: pct(weightsPrev[i], maxWt) }}
                      title={`${previousLabel} Wt: ${fmtWt(weightsPrev[i])}`}
                    />
                  ) : null}
                  <div
                    className="sale-chart-viz__bar sale-chart-viz__bar--wt-cur"
                    style={{ height: pct(weightsCur[i], maxWt) }}
                    title={`${currentLabel} Wt: ${fmtWt(weightsCur[i])}`}
                  />
                </div>
                <div className="sale-chart-viz__bar-labels">
                  {hasPrevious && weightsPrev[i] > 0 ? (
                    <span className="sale-chart-viz__bar-val sale-chart-viz__bar-val--prev" title={fmtWt(weightsPrev[i])}>
                      {fmtShort(weightsPrev[i], false)}
                    </span>
                  ) : null}
                  <span className="sale-chart-viz__bar-val sale-chart-viz__bar-val--wt" title={fmtWt(weightsCur[i])}>
                    {fmtShort(weightsCur[i], false)}
                  </span>
                </div>
              </div>
              <div className="sale-chart-viz__row sale-chart-viz__row--amt">
                <div className="sale-chart-viz__bar-group">
                  {hasPrevious ? (
                    <div
                      className="sale-chart-viz__bar sale-chart-viz__bar--amt-prev"
                      style={{ height: pct(amtsPrev[i], maxAmt) }}
                      title={`${previousLabel} Amt: ${fmtAmt(amtsPrev[i])}`}
                    />
                  ) : null}
                  <div
                    className="sale-chart-viz__bar sale-chart-viz__bar--amt-cur"
                    style={{ height: pct(amtsCur[i], maxAmt) }}
                    title={`${currentLabel} Amt: ${fmtAmt(amtsCur[i])}`}
                  />
                </div>
                <div className="sale-chart-viz__bar-labels">
                  {hasPrevious && amtsPrev[i] > 0 ? (
                    <span className="sale-chart-viz__bar-val sale-chart-viz__bar-val--prev" title={fmtAmt(amtsPrev[i])}>
                      {fmtShort(amtsPrev[i], true)}
                    </span>
                  ) : null}
                  <span className="sale-chart-viz__bar-val sale-chart-viz__bar-val--amt" title={fmtAmt(amtsCur[i])}>
                    {fmtShort(amtsCur[i], true)}
                  </span>
                </div>
              </div>
              <div className="sale-chart-viz__month">{m.label}</div>
              <div className="sale-chart-viz__month-totals">
                <span className="sale-chart-viz__month-wt">W:{fmtShort(weightsCur[i], false)}</span>
                <span className="sale-chart-viz__month-amt">₹{fmtShort(amtsCur[i], true)}</span>
              </div>
            </ColTag>
            );
          })}
        </div>
      </div>
      <p className="sale-chart-viz__hint">
        {onMonthClick ? 'Tap a month to open sale list · scroll on small screens' : 'Scroll horizontally on small screens'}
      </p>
    </div>
  );
}

function SummaryTable({ data, months, hasPrevious, currentLabel, previousLabel, onMonthClick }) {
  return (
    <div className="sale-chart-table-wrap">
      <table className="sale-chart-table">
        <thead>
          <tr>
            <th>Month</th>
            <th className="num">{currentLabel} Wt</th>
            <th className="num">{currentLabel} Amt</th>
            {hasPrevious ? (
              <>
                <th className="num">{previousLabel} Wt</th>
                <th className="num">{previousLabel} Amt</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr
              key={m.monthKey}
              className={onMonthClick && isMonthClickable(m) ? 'sale-chart-table__row--clickable' : undefined}
              onClick={onMonthClick && isMonthClickable(m) ? () => onMonthClick(m) : undefined}
              title={onMonthClick && isMonthClickable(m) ? `Open sale list for ${m.label}` : undefined}
            >
              <td>{m.label}</td>
              <td className="num">{fmtWt(m.current?.weight)}</td>
              <td className="num">{fmtAmt(m.current?.amount)}</td>
              {hasPrevious ? (
                <>
                  <td className="num">{fmtWt(m.previous?.weight)}</td>
                  <td className="num">{fmtAmt(m.previous?.amount)}</td>
                </>
              ) : null}
            </tr>
          ))}
          <tr className="sale-chart-table__total">
            <td>Total</td>
            <td className="num">{fmtWt(data?.totals?.current?.weight)}</td>
            <td className="num">{fmtAmt(data?.totals?.current?.amount)}</td>
            {hasPrevious ? (
              <>
                <td className="num">{fmtWt(data?.totals?.previous?.weight)}</td>
                <td className="num">{fmtAmt(data?.totals?.previous?.amount)}</td>
              </>
            ) : null}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ItemDropdown({ items, selectedItemCode, onItemChange, itemLoading }) {
  return (
    <div className="sale-chart-item-select">
      <label className="sale-chart-item-select__label" htmlFor="sale-chart-item">
        Item
      </label>
      <select
        id="sale-chart-item"
        className="sale-chart-item-select__input"
        value={selectedItemCode}
        onChange={(e) => onItemChange?.(e.target.value)}
        disabled={itemLoading}
      >
        <option value="">All items (company total)</option>
        {items.map((it) => (
          <option key={it.itemCode} value={it.itemCode}>
            {it.itemName} — Wt {fmtShort(it.totals?.current?.weight, false)} · ₹{fmtAmt(it.totals?.current?.amount)}
          </option>
        ))}
      </select>
      {itemLoading ? <span className="sale-chart-item-select__loading">Refreshing…</span> : null}
      {items.length > 0 ? (
        <span className="sale-chart-item-select__count">{items.length} items with sales</span>
      ) : null}
    </div>
  );
}

export default function SaleGraphCharts({
  data,
  items = [],
  selectedItemCode = '',
  onItemChange,
  itemLoading = false,
  onMonthClick,
}) {
  const months = data?.months || [];
  const hasPrevious = Boolean(data?.hasPrevious);
  const currentLabel = data?.currentYearLabel ? `FY ${data.currentYearLabel}` : 'Current';
  const previousLabel = data?.previousYearLabel ? `FY ${data.previousYearLabel}` : 'Previous';

  const chartTitle = useMemo(() => {
    if (selectedItemCode) {
      const fromList = items.find((it) => it.itemCode === selectedItemCode);
      const name = data?.itemName || fromList?.itemName;
      if (name) return `${name} (${selectedItemCode})`;
      return `Item ${selectedItemCode}`;
    }
    return 'All items (company total)';
  }, [selectedItemCode, data?.itemName, items]);

  if (!months.length) {
    return <p className="sale-chart-empty">No sale data for this period.</p>;
  }

  return (
    <div className="sale-chart-charts">
      <ItemDropdown
        items={items}
        selectedItemCode={selectedItemCode}
        onItemChange={onItemChange}
        itemLoading={itemLoading}
      />

      <section className={`sale-chart-panel${itemLoading ? ' sale-chart-panel--loading' : ''}`}>
        {itemLoading ? <div className="sale-chart-panel__overlay">Refreshing chart…</div> : null}
        <h3 className="sale-chart-panel__title">Month-wise · Weight &amp; Amount</h3>
        <p className="sale-chart-panel__subtitle">{chartTitle}</p>
        <CombinedWtAmtChart
          key={selectedItemCode || 'all'}
          months={months}
          hasPrevious={hasPrevious}
          currentLabel={currentLabel}
          previousLabel={previousLabel}
          compact={false}
          onMonthClick={onMonthClick}
        />
      </section>

      <SummaryTable
        data={data}
        months={months}
        hasPrevious={hasPrevious}
        currentLabel={currentLabel}
        previousLabel={previousLabel}
        onMonthClick={onMonthClick}
      />
    </div>
  );
}
