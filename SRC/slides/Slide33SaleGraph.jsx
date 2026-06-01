import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import FasReportHeader from '../components/FasReportHeader';
import SaleGraphCharts from '../components/SaleGraphCharts';
import SessionToolbarChrome from '../components/SessionToolbarChrome';
import { toInputDateString, toOracleDate, toDisplayDate, monthKeyToInputDateRange } from '../utils/dateFormat';
import '../styles/saleGraph.css';

export default function Slide33SaleGraph({ apiBase, formData, onPrev, onReset, onOpenSaleList }) {
  const [loading, setLoading] = useState(true);
  const [itemLoading, setItemLoading] = useState(false);
  const [error, setError] = useState('');
  const [graphBundle, setGraphBundle] = useState(null);
  const [selectedItemCode, setSelectedItemCode] = useState('');
  const [itemSeries, setItemSeries] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';
  const sDate = toOracleDate(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT));
  const eDate = toOracleDate(toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT));

  const baseParams = useMemo(
    () => ({
      comp_code: compCode,
      comp_uid: compUid,
      s_date: sDate,
      e_date: eDate,
      comp_year: compYear,
    }),
    [compCode, compUid, sDate, eDate, compYear]
  );

  useEffect(() => {
    if (!compCode || !compUid || !sDate || !eDate) {
      setError('Company and financial year are required.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setSelectedItemCode('');
      setItemSeries(null);
      try {
        const { data } = await axios.get(`${apiBase}/api/sale-graph-monthly`, {
          params: { ...baseParams, include_items: '1' },
          withCredentials: true,
          timeout: 120000,
        });
        if (!cancelled) setGraphBundle(data);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || err.message || 'Failed to load sale chart.');
          setGraphBundle(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, baseParams, compCode, compUid, sDate, eDate]);

  const loadItemSeries = useCallback(
    async (itemCode, itemsList) => {
      if (!itemCode) {
        setItemSeries(null);
        return;
      }
      setItemLoading(true);
      try {
        const { data } = await axios.get(`${apiBase}/api/sale-graph-monthly`, {
          params: { ...baseParams, item_code: itemCode },
          withCredentials: true,
          timeout: 120000,
        });
        const fromList = itemsList?.find((it) => it.itemCode === itemCode);
        setItemSeries({
          ...data,
          itemCode,
          itemName: data.itemName || fromList?.itemName || itemCode,
        });
      } catch (err) {
        setError(err.response?.data?.error || err.message || 'Failed to load item chart.');
        setItemSeries(null);
      } finally {
        setItemLoading(false);
      }
    },
    [apiBase, baseParams]
  );

  const handleItemChange = useCallback(
    (code) => {
      setSelectedItemCode(code);
      setError('');
      if (!code) {
        setItemSeries(null);
        return;
      }
      loadItemSeries(code, graphBundle?.items);
    },
    [loadItemSeries, graphBundle?.items]
  );

  const activeChartData = selectedItemCode ? itemSeries : graphBundle;
  const itemsList = graphBundle?.items || [];

  const fyStartInput = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEndInput = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const handleMonthClick = useCallback(
    (month) => {
      if (!onOpenSaleList) return;
      const range = monthKeyToInputDateRange(month?.monthKey, fyStartInput, fyEndInput);
      if (!range) return;
      const fromList = itemsList.find((it) => it.itemCode === selectedItemCode);
      onOpenSaleList({
        startDate: range.start,
        endDate: range.end,
        itemCode: selectedItemCode || '',
        itemName: activeChartData?.itemName || fromList?.itemName || '',
        monthLabel: month?.label || '',
      });
    },
    [onOpenSaleList, fyStartInput, fyEndInput, selectedItemCode, itemsList, activeChartData?.itemName]
  );

  const periodLabel = `${toDisplayDate(fyStartInput)} – ${toDisplayDate(fyEndInput)}`;

  return (
    <div className="slide slide-33-sale-chart fas-tb-host">
      <div className="fas-flow fas-tb-flow">
        <FasReportHeader
          title="Sale Chart"
          onBack={onPrev}
          rightSlot={
            <SessionToolbarChrome helpReportId="reports-menu" helpLabel="Sale chart help" helpCompanyName={compName} />
          }
        />
        <div className="fas-flow-body fas-tb-body sale-chart-body">
          <div className="sale-chart-meta">
            <div>
              <strong>{compName}</strong>
              <span className="sale-chart-meta__sub">
                FY {compYear} · {periodLabel}
              </span>
            </div>
            {graphBundle?.hasPrevious ? (
              <span className="sale-chart-meta__badge">Includes previous year: {graphBundle.previousYearLabel}</span>
            ) : (
              <span className="sale-chart-meta__badge sale-chart-meta__badge--muted">No previous year in compdet</span>
            )}
          </div>

          {loading ? <p className="sale-chart-status">Loading sale chart…</p> : null}
          {error ? (
            <p className="sale-chart-status sale-chart-status--error" role="alert">
              {error}
            </p>
          ) : null}
          {!loading && !error && activeChartData ? (
            <SaleGraphCharts
              data={activeChartData}
              items={itemsList}
              selectedItemCode={selectedItemCode}
              onItemChange={handleItemChange}
              itemLoading={itemLoading}
              onMonthClick={onOpenSaleList ? handleMonthClick : undefined}
            />
          ) : null}

          <div className="sale-chart-actions">
            <button type="button" className="btn btn-secondary" onClick={onPrev}>
              ← Back to menu
            </button>
            {onReset ? (
              <button type="button" className="btn btn-secondary" onClick={onReset}>
                Home menu
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
