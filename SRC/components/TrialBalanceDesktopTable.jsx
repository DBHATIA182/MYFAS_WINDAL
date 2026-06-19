import React, { useMemo, useState } from 'react';
import {
  buildTrialDesktopGroups,
  collectTrialCityOptions,
  collectTrialScheduleOptions,
  trialDesktopGroupStats,
  trialGroupHeaderAmount,
  trialGroupTitle,
  trialBalanceRowLabel,
} from '../utils/trialBalanceDesktopDisplay';
import { computeTrialTopSummary } from '../utils/trialBalanceSort';

function fmt(val) {
  const num = parseFloat(val) || 0;
  return num === 0 ? '—' : num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function fmtAlways(val) {
  const num = parseFloat(val) || 0;
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

/** Desktop trial balance — expand/collapse schedules + Schedule / City filters. */
export default function TrialBalanceDesktopTable({ data, onLedgerClick }) {
  const [scheduleFilter, setScheduleFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [collapsedSchedules, setCollapsedSchedules] = useState({});
  const [selectedKey, setSelectedKey] = useState(null);

  const scheduleOptions = useMemo(() => collectTrialScheduleOptions(data), [data]);
  const cityOptions = useMemo(() => collectTrialCityOptions(data), [data]);

  const groups = useMemo(
    () => buildTrialDesktopGroups(data, { scheduleFilter, cityFilter }),
    [data, scheduleFilter, cityFilter]
  );

  const stats = useMemo(() => trialDesktopGroupStats(groups), [groups]);
  const summary = useMemo(() => computeTrialTopSummary(data || []), [data]);
  const filterActive = scheduleFilter !== 'all' || cityFilter !== 'all';

  const groupKeys = useMemo(() => groups.map((g) => g.scheduleKey), [groups]);
  const allExpanded = groupKeys.length > 0 && groupKeys.every((key) => !collapsedSchedules[key]);
  const allCollapsed = groupKeys.length > 0 && groupKeys.every((key) => collapsedSchedules[key]);

  const toggleSchedule = (scheduleKey) => {
    setCollapsedSchedules((prev) => ({ ...prev, [scheduleKey]: !prev[scheduleKey] }));
  };

  const expandAll = () => setCollapsedSchedules({});
  const collapseAll = () => {
    const next = {};
    groupKeys.forEach((key) => {
      next[key] = true;
    });
    setCollapsedSchedules(next);
  };

  if (!data || data.length === 0) {
    return <p className="no-data">No data available.</p>;
  }

  return (
    <div className="trial-desktop">
      <div className="trial-desktop__toolbar">
        <label className="trial-desktop__filter">
          <span className="trial-desktop__filter-label">Schedule</span>
          <select
            className="trial-desktop__filter-select"
            value={scheduleFilter}
            onChange={(e) => setScheduleFilter(e.target.value)}
            aria-label="Filter by schedule"
          >
            <option value="all">All schedules</option>
            {scheduleOptions.map((sch) => (
              <option key={sch} value={sch}>
                {sch}
              </option>
            ))}
          </select>
        </label>

        <label className="trial-desktop__filter">
          <span className="trial-desktop__filter-label">City</span>
          <select
            className="trial-desktop__filter-select"
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            aria-label="Filter by city"
          >
            <option value="all">All cities</option>
            {cityOptions.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>

        <div className="trial-desktop__expand-actions">
          <button type="button" className="trial-desktop__expand-btn" onClick={expandAll} disabled={allExpanded}>
            Expand all
          </button>
          <button
            type="button"
            className="trial-desktop__expand-btn"
            onClick={collapseAll}
            disabled={groupKeys.length === 0 || allCollapsed}
          >
            Collapse all
          </button>
        </div>

        {filterActive ? (
          <span className="trial-desktop__filter-count">
            {stats.schedules} schedule{stats.schedules === 1 ? '' : 's'} · {stats.accounts} account
            {stats.accounts === 1 ? '' : 's'}
            {scheduleFilter !== 'all' ? ` · Sch ${scheduleFilter}` : ''}
            {cityFilter !== 'all' ? ` · ${cityFilter}` : ''}
          </span>
        ) : null}
      </div>

      <div className="table-responsive table-responsive--trial">
        <table className="report-table report-table--trial">
          <thead>
            <tr>
              <th scope="col" className="trial-desktop__col-expand" aria-label="Expand" />
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
            {groups.length === 0 ? (
              <tr>
                <td colSpan={9} className="trial-desktop__empty">
                  No accounts match the selected filters.
                </td>
              </tr>
            ) : (
              groups.map((group) => {
                const gKey = group.scheduleKey;
                const collapsed = Boolean(collapsedSchedules[gKey]);
                const headerRow = group.header;
                const headerAmt = trialGroupHeaderAmount(group);
                const schVal = headerRow
                  ? headerRow.SCHEDULE ?? headerRow.schedule ?? headerRow.SCH_NO ?? headerRow.sch_no ?? gKey
                  : gKey;
                const headerName = trialGroupTitle(group);
                const headerKey = `sch-${gKey}`;

                const renderAmountCells = (cdr, ccr, dr, cr) => (
                  <>
                    <td className={`text-right ${cdr > 0 ? 'dr-amt' : ''}`}>{cdr > 0 ? fmt(cdr) : '—'}</td>
                    <td className={`text-right ${ccr > 0 ? 'cr-amt' : ''}`}>{ccr > 0 ? fmt(ccr) : '—'}</td>
                    <td className={`text-right ${dr > 0 ? 'dr-amt' : ''}`}>{dr > 0 ? fmt(dr) : '—'}</td>
                    <td className={`text-right ${cr > 0 ? 'cr-amt' : ''}`}>{cr > 0 ? fmt(cr) : '—'}</td>
                  </>
                );

                let headerCdr = 0;
                let headerCcr = 0;
                let headerDr = 0;
                let headerCr = 0;
                if (headerRow) {
                  headerCdr = parseFloat(headerRow.CLOSING_DR ?? headerRow.closing_dr ?? 0) || 0;
                  headerCcr = parseFloat(headerRow.CLOSING_CR ?? headerRow.closing_cr ?? 0) || 0;
                  headerDr = parseFloat(headerRow.DR_AMT ?? headerRow.dr_amt ?? 0) || 0;
                  headerCr = parseFloat(headerRow.CR_AMT ?? headerRow.cr_amt ?? 0) || 0;
                } else {
                  group.accounts.forEach((row) => {
                    headerCdr += parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
                    headerCcr += parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
                    headerDr += parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
                    headerCr += parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
                  });
                }
                if (headerAmt.amount > 0 && headerRow) {
                  if (headerAmt.tone === 'dr') headerCdr = headerAmt.amount;
                  if (headerAmt.tone === 'cr') headerCcr = headerAmt.amount;
                }

                return (
                  <React.Fragment key={gKey}>
                    <tr
                      className={[
                        'trial-schedule-total-row',
                        'trial-desktop-schedule-row',
                        selectedKey === headerKey ? 'trial-row-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td className="trial-desktop__col-expand">
                        <button
                          type="button"
                          className="trial-desktop-expand-btn"
                          aria-label={collapsed ? 'Expand schedule' : 'Collapse schedule'}
                          aria-expanded={!collapsed}
                          onClick={() => toggleSchedule(gKey)}
                        >
                          {collapsed ? '▸' : '▾'}
                        </button>
                      </td>
                      <td className="trial-sch">{schVal != null && schVal !== '' ? schVal : '—'}</td>
                      <td className="trial-name" colSpan={2}>
                        <span className="name-text">{headerName}</span>
                      </td>
                      <td className="trial-city">—</td>
                      {renderAmountCells(headerCdr, headerCcr, headerDr, headerCr)}
                    </tr>

                    {!collapsed
                      ? group.accounts.map((row, idx) => {
                          const codeVal = row.CODE ?? row.code;
                          const nameVal = trialBalanceRowLabel(row);
                          const cityVal = row.CITY ?? row.city;
                          const schAccount = row.SCHEDULE ?? row.schedule ?? row.SCH_NO ?? row.sch_no;
                          const cdr = parseFloat(row.CLOSING_DR ?? row.closing_dr ?? 0) || 0;
                          const ccr = parseFloat(row.CLOSING_CR ?? row.closing_cr ?? 0) || 0;
                          const drAmt = parseFloat(row.DR_AMT ?? row.dr_amt ?? 0) || 0;
                          const crAmt = parseFloat(row.CR_AMT ?? row.cr_amt ?? 0) || 0;
                          const rowKey = `acc-${gKey}-${codeVal ?? idx}`;
                          return (
                            <tr
                              key={rowKey}
                              className={[
                                'clickable-row',
                                'trial-desktop-detail-row',
                                selectedKey === rowKey ? 'trial-row-selected' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => {
                                setSelectedKey(rowKey);
                                if (onLedgerClick) onLedgerClick(codeVal, nameVal);
                              }}
                            >
                              <td className="trial-desktop__col-expand" />
                              <td className="trial-sch">{schAccount != null && schAccount !== '' ? schAccount : '—'}</td>
                              <td className="trial-name">
                                <span className="name-text">{nameVal}</span>
                              </td>
                              <td className="trial-code">{codeVal != null && codeVal !== '' ? codeVal : '—'}</td>
                              <td className="trial-city">{cityVal != null && cityVal !== '' ? cityVal : '—'}</td>
                              {renderAmountCells(cdr, ccr, drAmt, crAmt)}
                            </tr>
                          );
                        })
                      : null}
                  </React.Fragment>
                );
              })
            )}

            <tr
              className={[
                'trial-grand-total',
                'trial-grand-total-footer',
                selectedKey === 'trial-grand-footer' ? 'trial-row-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelectedKey('trial-grand-footer')}
            >
              <td colSpan={5}>
                <strong>GRAND TOTAL</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(summary.closingDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(summary.closingCr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(summary.periodDr)}</strong>
              </td>
              <td className="text-right">
                <strong>{fmtAlways(summary.periodCr)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
