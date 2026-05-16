import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { downloadExcelWorkbook } from '../utils/excelExport';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import ReportHelpButton from '../components/ReportHelpButton';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v) {
  if (typeof v === 'number') {
    return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  return v == null ? '' : String(v);
}

function monthEndYmd(ymd) {
  const s = String(ymd || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  const y = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mm) || mm < 1 || mm > 12) return '';
  const d = new Date(y, mm, 0);
  const day = String(d.getDate()).padStart(2, '0');
  return `${m[1]}-${m[2]}-${day}`;
}

function isDateColumn(name) {
  const k = String(name || '').toUpperCase();
  return k.includes('DATE');
}

function isNoWrapColumn(name) {
  const k = String(name || '').toUpperCase();
  return k === 'MONTH' || k.includes('DATE');
}

function fmtCell(col, val) {
  if (typeof val === 'number') return fmt(val);
  if (isDateColumn(col)) return toDisplayDate(String(val || ''));
  return val == null ? '' : String(val);
}

const TAB_LABELS = {
  monthlyHsnWise: 'Monthly Hsn Wise',
  hsnWiseMonthly: 'Hsn Wise Monthly',
  dateWise: 'Date Wise',
};

const DATE_WISE_TOTAL_COLS = ['QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'];
const DATE_WISE_GRID_MAX_ROWS = 3000;
const DATE_WISE_PDF_MAX_ROWS = 1500;
const FILTER_OPTIONS_MAX = 200;
const ALLOWED_FILTER_COLUMNS = ['HSN_CODE', 'TYPE', 'BILL_DATE', 'CODE', 'ITEM_CODE', 'CGST_PER', 'SGST_PER', 'IGST_PER'];

function toHsnKey(value) {
  const text = String(value ?? '').trim();
  return text || '(BLANK HSN)';
}

function getOrderedColumns(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const cols = Object.keys(rows[0]).filter((k) => !k.startsWith('_'));
  if (!cols.includes('HSN_CODE')) return cols;
  return ['HSN_CODE', ...cols.filter((c) => c !== 'HSN_CODE')];
}

function orderColumnsByTab(cols, activeTab) {
  const list = Array.isArray(cols) ? cols : [];
  if (activeTab === 'monthlyHsnWise') {
    const first = ['MONTH', 'HSN_CODE'];
    const present = first.filter((c) => list.includes(c));
    return [...present, ...list.filter((c) => !present.includes(c))];
  }
  if (activeTab === 'hsnWiseMonthly') {
    const first = ['HSN_CODE', 'MONTH'];
    const present = first.filter((c) => list.includes(c));
    return [...present, ...list.filter((c) => !present.includes(c))];
  }
  return list;
}

function buildDateWiseGroupedRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) {
    return { rows: [], totalCols: [], grandTotals: {} };
  }

  const totalCols = DATE_WISE_TOTAL_COLS.filter((c) => sourceRows.some((r) => c in (r || {})));
  const groups = new Map();

  sourceRows.forEach((row) => {
    const key = toHsnKey(row?.HSN_CODE);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const outputRows = [];
  const grandTotals = {};
  totalCols.forEach((c) => {
    grandTotals[c] = 0;
  });

  for (const [hsnCode, groupRows] of groups.entries()) {
    outputRows.push({
      _rowType: 'hsnHeader',
      HSN_CODE: hsnCode,
    });

    groupRows.forEach((row) => {
      outputRows.push({ ...row, _rowType: 'transaction' });
      totalCols.forEach((c) => {
        grandTotals[c] += num(row?.[c]);
      });
    });

    const hsnTotals = {};
    totalCols.forEach((c) => {
      hsnTotals[c] = groupRows.reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    outputRows.push({
      _rowType: 'hsnTotal',
      HSN_CODE: `${hsnCode} TOTAL`,
      ...hsnTotals,
    });
  }

  outputRows.push({
    _rowType: 'grandTotal',
    HSN_CODE: 'GRAND TOTAL',
    ...grandTotals,
  });

  return { rows: outputRows, totalCols, grandTotals };
}

function stripPrivateFields(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const next = {};
    Object.keys(row || {}).forEach((k) => {
      if (!k.startsWith('_')) next[k] = row[k];
    });
    return next;
  });
}

function rowMatchesFilters(row, columns, filters) {
  return columns.every((col) => {
    const want = String(filters?.[col] ?? '').trim().toLowerCase();
    if (!want) return true;
    const got = String(row?.[col] ?? '').trim().toLowerCase();
    return got.includes(want);
  });
}

function omitHsnUnit(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const next = { ...row };
    delete next.HSN_UNIT;
    delete next.hsn_unit;
    return next;
  });
}

function buildMonthlyHsnRowsWithMonthTotals(rows, totalCols) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) return [];
  const out = [];
  let currentMonth = '';
  let monthTotals = {};
  totalCols.forEach((c) => {
    monthTotals[c] = 0;
  });

  const flushMonthTotal = () => {
    if (!currentMonth) return;
    out.push({
      _rowType: 'monthTotal',
      MONTH: `${currentMonth} TOTAL`,
      ...monthTotals,
    });
    totalCols.forEach((c) => {
      monthTotals[c] = 0;
    });
  };

  sourceRows.forEach((row) => {
    const m = String(row?.MONTH ?? '').trim() || 'N/A';
    if (currentMonth && currentMonth !== m) flushMonthTotal();
    currentMonth = m;
    out.push({ ...row, _rowType: 'transaction' });
    totalCols.forEach((c) => {
      monthTotals[c] += num(row?.[c]);
    });
  });

  flushMonthTotal();
  return out;
}

function buildHsnWiseMonthlyRowsWithHsnTotals(rows, totalCols) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) return [];
  const out = [];
  let currentHsn = '';
  let hsnTotals = {};
  totalCols.forEach((c) => {
    hsnTotals[c] = 0;
  });

  const flushHsnTotal = () => {
    if (!currentHsn) return;
    out.push({
      _rowType: 'hsnTabTotal',
      HSN_CODE: `${currentHsn} TOTAL`,
      ...hsnTotals,
    });
    totalCols.forEach((c) => {
      hsnTotals[c] = 0;
    });
  };

  sourceRows.forEach((row) => {
    const h = String(row?.HSN_CODE ?? '').trim() || '(BLANK HSN)';
    if (currentHsn && currentHsn !== h) flushHsnTotal();
    currentHsn = h;
    out.push({ ...row, _rowType: 'transaction' });
    totalCols.forEach((c) => {
      hsnTotals[c] += num(row?.[c]);
    });
  });

  flushHsnTotal();
  return out;
}

export default function Slide16({ apiBase, formData, onPrev, onReset, reportMode = 'sales' }) {
  const isPurchase = String(reportMode || '').toLowerCase() === 'purchase';
  const apiPrefix = isPurchase ? 'hsn-purchase' : 'hsn-sales';
  const titleBase = isPurchase ? 'HSN Purchase' : 'HSN Sales';
  const runButtonText = 'Run';
  const datalistId = `${apiPrefix}-parties`;
  const pdfReportType = isPurchase ? 'hsn-purchase' : 'hsn-sales';
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const [sDate, setSDate] = useState('');
  const [eDate, setEDate] = useState('');
  const [mRUC, setMRUC] = useState('C');
  const [schedule, setSchedule] = useState('');
  const [code, setCode] = useState('');
  const [partyList, setPartyList] = useState([]);
  const [report, setReport] = useState(null);
  const [activeTab, setActiveTab] = useState('dateWise');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [error, setError] = useState('');
  const [detailRows, setDetailRows] = useState([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [screen, setScreen] = useState('main');
  const [mainFilters, setMainFilters] = useState({});
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [dateWiseLoading, setDateWiseLoading] = useState(false);
  const [dateWiseLoaded, setDateWiseLoaded] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const mainTopScrollRef = useRef(null);
  const mainTopInnerRef = useRef(null);
  const mainGridScrollRef = useRef(null);
  const detailTopScrollRef = useRef(null);
  const detailTopInnerRef = useRef(null);
  const detailGridScrollRef = useRef(null);

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setSDate(s);
    if (e) setEDate(e);
  }, [formData.comp_s_dt, formData.comp_e_dt, formData.COMP_S_DT, formData.COMP_E_DT]);

  useEffect(() => {
    if (!sDate) return;
    const monthEnd = monthEndYmd(sDate);
    if (monthEnd && monthEnd !== eDate) setEDate(monthEnd);
  }, [sDate]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    setLookupError('');
    axios
      .get(`${apiBase}/api/${apiPrefix}-parties`, {
        params: { comp_code: compCode, comp_uid: compUid },
        withCredentials: true,
      })
      .then((r) => setPartyList(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setLookupError(e.response?.data?.error || e.message || 'Failed to load parties'));
  }, [apiBase, apiPrefix, compCode, compUid]);

  const rawTabRows = report?.sheets?.[activeTab] || [];
  const tabRows = useMemo(() => omitHsnUnit(rawTabRows), [rawTabRows]);
  const columns = useMemo(() => orderColumnsByTab(getOrderedColumns(tabRows), activeTab), [tabRows, activeTab]);
  const filterColumns = useMemo(() => ALLOWED_FILTER_COLUMNS.filter((c) => columns.includes(c)), [columns]);
  const filteredTabRows = useMemo(
    () => (tabRows || []).filter((row) => rowMatchesFilters(row, filterColumns, mainFilters)),
    [tabRows, filterColumns, mainFilters]
  );
  const isDateWiseGridBypassed = activeTab === 'dateWise' && filteredTabRows.length > DATE_WISE_GRID_MAX_ROWS;
  const dateWiseGrouped = useMemo(
    () => (isDateWiseGridBypassed ? { rows: [], totalCols: [], grandTotals: {} } : buildDateWiseGroupedRows(filteredTabRows)),
    [filteredTabRows, isDateWiseGridBypassed]
  );
  const dateWiseExportRows = useMemo(
    () => stripPrivateFields(isDateWiseGridBypassed ? filteredTabRows : dateWiseGrouped.rows),
    [filteredTabRows, dateWiseGrouped.rows, isDateWiseGridBypassed]
  );
  const totalCols = useMemo(
    () =>
      activeTab === 'dateWise'
        ? dateWiseGrouped.totalCols
        : ['QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'].filter((c) => columns.includes(c)),
    [activeTab, columns, dateWiseGrouped.totalCols]
  );
  const totals = useMemo(() => {
    if (activeTab === 'dateWise') return dateWiseGrouped.grandTotals;
    const out = {};
    totalCols.forEach((c) => {
      out[c] = filteredTabRows.reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    return out;
  }, [activeTab, dateWiseGrouped.grandTotals, totalCols, filteredTabRows]);
  const monthlyHsnDisplayRows = useMemo(() => {
    if (activeTab !== 'monthlyHsnWise') return [];
    return buildMonthlyHsnRowsWithMonthTotals(filteredTabRows, totalCols);
  }, [activeTab, filteredTabRows, totalCols]);
  const hsnWiseMonthlyDisplayRows = useMemo(() => {
    if (activeTab !== 'hsnWiseMonthly') return [];
    return buildHsnWiseMonthlyRowsWithHsnTotals(filteredTabRows, totalCols);
  }, [activeTab, filteredTabRows, totalCols]);
  const displayRows =
    activeTab === 'dateWise'
      ? dateWiseGrouped.rows
      : activeTab === 'monthlyHsnWise'
        ? monthlyHsnDisplayRows
        : activeTab === 'hsnWiseMonthly'
          ? hsnWiseMonthlyDisplayRows
          : filteredTabRows;

  const filterOptions = useMemo(() => {
    const out = {};
    filterColumns.forEach((col) => {
      const uniq = new Set();
      (tabRows || []).forEach((row) => {
        if (uniq.size >= FILTER_OPTIONS_MAX) return;
        const val = String(row?.[col] ?? '').trim();
        if (val) uniq.add(val);
      });
      out[col] = Array.from(uniq).sort((a, b) => a.localeCompare(b));
    });
    return out;
  }, [filterColumns, tabRows]);
  const activeFilterCount = useMemo(
    () => Object.values(mainFilters || {}).filter((v) => String(v || '').trim() !== '').length,
    [mainFilters]
  );

  const detailColumns = detailRows.length > 0 ? Object.keys(detailRows[0]).filter((k) => !k.startsWith('_')) : [];
  const detailTotalCols = ['QNTY', 'WEIGHT', 'TAXABLE', 'CGST_AMT', 'SGST_AMT', 'IGST_AMT'].filter((c) =>
    detailColumns.includes(c)
  );
  const detailTotals = useMemo(() => {
    const out = {};
    detailTotalCols.forEach((c) => {
      out[c] = detailRows.reduce((sum, row) => sum + num(row?.[c]), 0);
    });
    return out;
  }, [detailRows, detailTotalCols]);

  const periodLabel = `${toDisplayDate(sDate)} - ${toDisplayDate(eDate)}`;
  const pdfMetaBase = {
    companyName: compName,
    year: compYear,
    period: periodLabel,
  };

  useEffect(() => {
    if (screen !== 'main') return;
    const top = mainTopScrollRef.current;
    const topInner = mainTopInnerRef.current;
    const grid = mainGridScrollRef.current;
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
  }, [screen, activeTab, tabRows.length, columns.length]);

  useEffect(() => {
    if (screen !== 'detail') return;
    const top = detailTopScrollRef.current;
    const topInner = detailTopInnerRef.current;
    const grid = detailGridScrollRef.current;
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
    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
    };
  }, [screen, detailRows.length, detailColumns.length]);

  const runReport = async (e) => {
    e.preventDefault();
    const s = toOracleDate(sDate);
    const ed = toOracleDate(eDate);
    if (!s || !ed) {
      alert('Please select starting and ending date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/${apiPrefix}`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          m_r_u_c: mRUC,
          schedule: schedule === '' ? 0 : Number(schedule),
          code,
        },
        withCredentials: true,
        timeout: 180000,
      });
      const incoming = data || { sheets: {} };
      const nextSheets = incoming?.sheets && typeof incoming.sheets === 'object'
        ? Object.fromEntries(Object.entries(incoming.sheets).map(([k, v]) => [k, omitHsnUnit(v)]))
        : {};
      setReport({ ...incoming, sheets: nextSheets });
      setActiveTab('monthlyHsnWise');
      setDetailRows([]);
      setDetailTitle('');
      setScreen('main');
      setMainFilters({});
      setMobileFiltersOpen(false);
      setDateWiseLoaded(!data?.dateWiseDeferred);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run report');
    } finally {
      setLoading(false);
    }
  };

  const loadDateWiseIfNeeded = async () => {
    if (dateWiseLoaded || dateWiseLoading || !report?.sheets) return;
    const s = toOracleDate(sDate);
    const ed = toOracleDate(eDate);
    if (!s || !ed) return;
    setDateWiseLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/${apiPrefix}-datewise`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          m_r_u_c: mRUC,
          schedule: schedule === '' ? 0 : Number(schedule),
          code,
        },
        withCredentials: true,
        timeout: 180000,
      });
      const rows = omitHsnUnit(Array.isArray(data?.rows) ? data.rows : []);
      setReport((prev) => ({
        ...(prev || {}),
        sheets: {
          ...(prev?.sheets || {}),
          dateWise: rows,
        },
      }));
      setDateWiseLoaded(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load date-wise rows');
    } finally {
      setDateWiseLoading(false);
    }
  };

  const openSummaryDetail = async (row) => {
    if (!report?.sheets) return;
    if (activeTab === 'dateWise') {
      const keyType = String(row?.TYPE || '').trim();
      const keyDate = String(row?.BILL_DATE || '').trim();
      const keyNo = String(row?.BILL_NO || '').trim();
      const keyBType = String(row?.B_TYPE || '').trim();
      const sameVoucher = (report.sheets?.dateWise || []).filter((r) => {
        return (
          String(r?.TYPE || '').trim() === keyType &&
          String(r?.BILL_DATE || '').trim() === keyDate &&
          String(r?.BILL_NO || '').trim() === keyNo &&
          String(r?.B_TYPE || '').trim() === keyBType
        );
      });
      setDetailTitle(`Detail — ${keyType} / ${keyNo}${keyBType ? ` / ${keyBType}` : ''} / ${toDisplayDate(keyDate)}`);
      setDetailRows(sameVoucher);
      setScreen('detail');
      return;
    }
    try {
      setDetailLoading(true);
      setDetailTitle(`${TAB_LABELS[activeTab]} detail — ${row?.HSN_CODE || ''} ${row?.MONTH || ''}`.trim());
      const s = toOracleDate(sDate);
      const ed = toOracleDate(eDate);
      const { data } = await axios.get(`${apiBase}/api/${apiPrefix}-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: s,
          e_date: ed,
          m_r_u_c: mRUC,
          schedule: schedule === '' ? 0 : Number(schedule),
          code,
          tab: activeTab,
          month: row?._MONTH_KEY || row?.MONTH_KEY || '',
          hsn_code: row?.HSN_CODE || '',
          tax_rate: row?.TAX_RATE ?? 0,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setDetailRows(omitHsnUnit(Array.isArray(data?.rows) ? data.rows : []));
      setScreen('detail');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load detail');
      setDetailRows([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const exportMainExcel = () => {
    if (!report?.sheets) return;
    const sheets = Object.entries(report.sheets).map(([name, data]) => {
      if (name === 'dateWise') return { name: TAB_LABELS[name] || name, data: dateWiseExportRows };
      return { name: TAB_LABELS[name] || name, data };
    });
    downloadExcelWorkbook(sheets, `${compName}_${isPurchase ? 'HsnPurchase' : 'HsnSales'}`, { autoOpen: true });
  };

  const exportMainPdf = () => {
    const allRows = activeTab === 'dateWise' ? dateWiseExportRows : tabRows || [];
    const rows =
      activeTab === 'dateWise' && allRows.length > DATE_WISE_PDF_MAX_ROWS ? allRows.slice(0, DATE_WISE_PDF_MAX_ROWS) : allRows;
    if (activeTab === 'dateWise' && allRows.length > DATE_WISE_PDF_MAX_ROWS) {
      alert(
        `Date-wise has ${allRows.length.toLocaleString('en-IN')} rows. PDF is limited to first ${DATE_WISE_PDF_MAX_ROWS.toLocaleString(
          'en-IN'
        )} rows so it can render correctly. Use Excel for full data.`
      );
    }
    setPdfBusy(true);
    generatePDF(
      pdfReportType,
      { rows },
      {
        ...pdfMetaBase,
        reportTitle: titleBase,
        activeView: TAB_LABELS[activeTab] || activeTab,
        autoOpen: true,
      }
    )
      .catch((e) => alert(String(e?.message || e)))
      .finally(() => setPdfBusy(false));
  };

  const shareMainWa = () => {
    const rows = activeTab === 'dateWise' ? dateWiseExportRows : tabRows || [];
    sharePdfWithWhatsApp(
      pdfReportType,
      { rows },
      {
        ...pdfMetaBase,
        reportTitle: titleBase,
        activeView: TAB_LABELS[activeTab] || activeTab,
      },
      [titleBase, compName, periodLabel, `View: ${TAB_LABELS[activeTab] || activeTab}`].join('\n')
    ).catch((e) => alert(String(e?.message || e)));
  };

  const exportDetailExcel = () => {
    if (!detailRows.length) return;
    downloadExcelWorkbook([{ name: 'Detail', data: detailRows }], `${compName}_${isPurchase ? 'HsnPurchase' : 'HsnSales'}_Detail`, {
      autoOpen: true,
    });
  };

  const exportDetailPdf = () => {
    if (!detailRows.length) return;
    generatePDF(
      pdfReportType,
      { rows: detailRows },
      {
        ...pdfMetaBase,
        reportTitle: `${titleBase} Detail`,
        activeView: detailTitle || 'Detail',
        autoOpen: true,
      }
    ).catch((e) => alert(String(e?.message || e)));
  };

  const shareDetailWa = () => {
    if (!detailRows.length) return;
    sharePdfWithWhatsApp(
      pdfReportType,
      { rows: detailRows },
      {
        ...pdfMetaBase,
        reportTitle: `${titleBase} Detail`,
        activeView: detailTitle || 'Detail',
      },
      [`${titleBase} Detail`, compName, periodLabel, detailTitle || 'Detail'].join('\n')
    ).catch((e) => alert(String(e?.message || e)));
  };

  if (report?.sheets) {
    if (screen === 'detail') {
      return (
        <div className="slide slide-report slide-16">
          <div className="report-toolbar">
            <h2>{titleBase} Detail</h2>
            <div className="toolbar-actions">
            <ReportHelpButton reportId={reportMode === 'purchase' ? 'hsn-purchase' : 'hsn-sales'} />
            
              <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('main')}>
                ← Back
              </button>
              <button type="button" className="btn btn-excel" onClick={exportDetailExcel} disabled={!detailRows.length}>
                📊 Excel
              </button>
              <button type="button" className="btn btn-export" onClick={exportDetailPdf} disabled={!detailRows.length}>
                Pdf
              </button>
              <button type="button" className="btn btn-whatsapp" onClick={shareDetailWa} disabled={!detailRows.length}>
                💬 WhatsApp
              </button>
            </div>
          </div>
          <div className="report-info">
            <p>
              <strong>Dates</strong> {periodLabel}
            </p>
            <p>{detailTitle || 'Detail'}</p>
          </div>
          <div className="report-display table-responsive table-responsive--hsn-sales table-responsive--sale-list">
            <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={detailTopScrollRef}>
              <div className="sale-list-scroll-sync-inner" ref={detailTopInnerRef} />
            </div>
            <div ref={detailGridScrollRef}>
            <table className="report-table">
              <thead>
                <tr>{detailColumns.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {detailRows.map((row, i) => (
                  <tr key={i}>
                    {detailColumns.map((c) => (
                      <td
                        key={c}
                        className={typeof row[c] === 'number' ? 'text-right' : ''}
                        style={isNoWrapColumn(c) ? { whiteSpace: 'nowrap' } : undefined}
                      >
                        {fmtCell(c, row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="stock-sum-grand">
                  {detailColumns.map((c, i) => {
                    if (i === 0) return <td key={c}><strong>Grand total</strong></td>;
                    if (!detailTotalCols.includes(c)) return <td key={c}>—</td>;
                    return (
                      <td key={c} className="text-right">
                        <strong>{fmt(detailTotals[c])}</strong>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            </div>
            <hr className="sale-bill-print-footer-rule" />
            <div className="report-info">
              <p>
                <strong>Grand Total:</strong> {detailTotalCols.map((c) => `${c}: ${fmt(detailTotals[c] || 0)}`).join(' | ')}
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="slide slide-report slide-16">
        <div className="report-toolbar">
          <h2>{titleBase}</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId={reportMode === 'purchase' ? 'hsn-purchase' : 'hsn-sales'} />
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setReport(null)}>
              ← Back
            </button>
            <button type="button" className="btn btn-excel" onClick={exportMainExcel}>
              📊 Excel
            </button>
            <button type="button" className="btn btn-export" onClick={exportMainPdf} disabled={pdfBusy}>
              {pdfBusy ? 'Preparing PDF…' : 'Pdf'}
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareMainWa}>
              💬 WhatsApp
            </button>
          </div>
        </div>
        <div className="report-sort-switch report-sort-switch--hsn-sales" role="group" aria-label={`${titleBase} tabs`}>
          {Object.keys(TAB_LABELS).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`btn btn-secondary btn-sort-switch btn-sort-switch--hsn${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab(tab);
                setDetailRows([]);
                setDetailTitle('');
                setMainFilters({});
                setMobileFiltersOpen(false);
                if (tab === 'dateWise') loadDateWiseIfNeeded();
              }}
            >
              {TAB_LABELS[tab]} ({tab === 'dateWise' && !dateWiseLoaded ? 'Load' : (report.sheets?.[tab] || []).length})
            </button>
          ))}
        </div>

        <div className="report-info">
          <p>
            <strong>Dates</strong> {periodLabel} · <strong>M_R_U_C</strong> {mRUC} ·{' '}
            <strong>Schedule</strong> {schedule || 'All'} · <strong>Party</strong> {code || 'All'}
          </p>
          <p>
            {compName} | FY {compYear}
          </p>
          <p>
            <button type="button" className="btn btn-secondary" onClick={() => setMainFilters({})}>
              Clear Filters
            </button>
          </p>
        </div>

        <div className="hsn-mobile-filter-wrap">
          <button
            type="button"
            className="btn btn-secondary hsn-mobile-filter-toggle"
            onClick={() => setMobileFiltersOpen((v) => !v)}
          >
            {mobileFiltersOpen ? 'Hide Filters' : 'Show Filters'} {activeFilterCount ? `(${activeFilterCount})` : ''}
          </button>
          {mobileFiltersOpen ? (
            <div className="hsn-mobile-filter-panel">
              {filterColumns.map((c) => (
                <label key={`mobile_filter_${c}`} className="hsn-mobile-filter-item">
                  <span>{c}</span>
                  <input
                    className="form-input hsn-filter-input"
                    list={`hsn-filter-${activeTab}-${c}`}
                    value={mainFilters[c] || ''}
                    onChange={(e) =>
                      setMainFilters((prev) => ({
                        ...prev,
                        [c]: e.target.value,
                      }))
                    }
                    placeholder={`Filter ${c}`}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <div className="report-display table-responsive table-responsive--hsn-sales table-responsive--sale-list">
          {isDateWiseGridBypassed ? (
            <>
              <div className="report-info">
                <p>
                  Date-wise has {filteredTabRows.length.toLocaleString('en-IN')} rows. Grid rendering is skipped above{' '}
                  {DATE_WISE_GRID_MAX_ROWS.toLocaleString('en-IN')} rows to keep the page responsive.
                </p>
                <p>
                  Use PDF / Excel from the toolbar. Apply filters (M_R_U_C, Schedule, Party, date range) to reduce rows and reopen tab for grid view.
                </p>
              </div>
              <hr className="sale-bill-print-footer-rule" />
              <div className="report-info">
                <p>
                  <strong>Grand Total:</strong> {totalCols.map((c) => `${c}: ${fmt(totals[c] || 0)}`).join(' | ')}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={mainTopScrollRef}>
                <div className="sale-list-scroll-sync-inner" ref={mainTopInnerRef} />
              </div>
              <div ref={mainGridScrollRef}>
              <table className="report-table">
                <thead>
                  <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
                  <tr className="hsn-main-filter-row">
                    {columns.map((c) => (
                      <th key={`${c}_filter`}>
                        {filterColumns.includes(c) ? (
                          <>
                            <input
                              className="form-input hsn-filter-input"
                              style={{ minWidth: 120 }}
                              list={`hsn-filter-${activeTab}-${c}`}
                              value={mainFilters[c] || ''}
                              onChange={(e) =>
                                setMainFilters((prev) => ({
                                  ...prev,
                                  [c]: e.target.value,
                                }))
                              }
                              placeholder={`Filter ${c}`}
                            />
                            <datalist id={`hsn-filter-${activeTab}-${c}`}>
                              {(filterOptions[c] || []).map((opt) => (
                                <option key={opt} value={opt} />
                              ))}
                            </datalist>
                          </>
                        ) : null}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => (
                    <tr
                      key={i}
                      className={
                        row?._rowType === 'hsnHeader' ||
                        row?._rowType === 'hsnTotal' ||
                        row?._rowType === 'grandTotal' ||
                        row?._rowType === 'monthTotal' ||
                        row?._rowType === 'hsnTabTotal'
                          ? 'stock-sum-grand'
                          : 'sale-list-row-clickable'
                      }
                      onClick={row?._rowType === 'transaction' || !row?._rowType ? () => openSummaryDetail(row) : undefined}
                      onKeyDown={
                        row?._rowType === 'transaction' || !row?._rowType
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                openSummaryDetail(row);
                              }
                            }
                          : undefined
                      }
                      role={row?._rowType === 'transaction' || !row?._rowType ? 'button' : undefined}
                      tabIndex={row?._rowType === 'transaction' || !row?._rowType ? 0 : undefined}
                    >
                      {columns.map((c) => (
                        <td
                          key={c}
                          className={typeof row[c] === 'number' ? 'text-right' : row?._rowType === 'hsnHeader' && c === 'HSN_CODE' ? 'text-left' : ''}
                          style={isNoWrapColumn(c) ? { whiteSpace: 'nowrap' } : undefined}
                        >
                          {row?._rowType === 'hsnHeader' && c === 'HSN_CODE' ? (
                            <strong>HSN: {fmtCell(c, row[c])}</strong>
                          ) : row?._rowType === 'monthTotal' && c === 'MONTH' ? (
                            <strong>{fmtCell(c, row[c])}</strong>
                          ) : row?._rowType === 'hsnTabTotal' && c === 'HSN_CODE' ? (
                            <strong>{fmtCell(c, row[c])}</strong>
                          ) : (
                            fmtCell(c, row[c])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {activeTab !== 'dateWise' && filteredTabRows.length > 0 ? (
                    <tr className="stock-sum-grand">
                      {columns.map((c, i) => {
                        if (i === 0) return <td key={c}><strong>Grand total</strong></td>;
                        if (!totalCols.includes(c)) return <td key={c}>—</td>;
                        return (
                          <td key={c} className="text-right">
                            <strong>{fmt(totals[c])}</strong>
                          </td>
                        );
                      })}
                    </tr>
                  ) : null}
                </tbody>
              </table>
              </div>
              <hr className="sale-bill-print-footer-rule" />
              <div className="report-info">
                <p>
                  <strong>Grand Total:</strong> {totalCols.map((c) => `${c}: ${fmt(totals[c] || 0)}`).join(' | ')}
                </p>
              </div>
              {displayRows.length === 0 ? <p className="stock-sum-empty">No rows in this tab.</p> : null}
            </>
          )}
        </div>

        {!isDateWiseGridBypassed ? (
          <div className="report-info">
            <p>
              Click any row to open detail screen.
            </p>
          </div>
        ) : null}

        {detailLoading ? <p className="stock-sum-empty">Loading detail...</p> : null}
        {activeTab === 'dateWise' && dateWiseLoading ? <p className="stock-sum-empty">Loading full date-wise rows...</p> : null}
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setReport(null)}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-16">
      <h2>{titleBase}</h2>
      <p className="company-info">
        {compName} | FY {compYear}
      </p>
      {lookupError ? <div className="form-api-error">{lookupError}</div> : null}
      {error ? <div className="form-api-error">{error}</div> : null}

      <form onSubmit={runReport} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group">
          <label>Starting Date</label>
          <input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Ending Date</label>
          <input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>(R)egd / (U)nregd / (C)omplete</label>
          <input
            className="form-input"
            maxLength={1}
            value={mRUC}
            onChange={(e) => setMRUC(String(e.target.value || 'C').toUpperCase().slice(0, 1))}
          />
        </div>
        <div className="form-group">
          <label>Specific Schedule</label>
          <input
            type="number"
            className="form-input"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 for all"
          />
        </div>
        <div className="form-group">
          <label>Specific Party</label>
          <input className="form-input" list={datalistId} value={code} onChange={(e) => setCode(e.target.value)} />
          <datalist id={datalistId}>
            {partyList.map((p) => (
              <option key={String(p.CODE ?? p.code)} value={String(p.CODE ?? p.code)}>
                {`${String(p.NAME ?? p.name ?? '')} ${String(p.CITY ?? p.city ?? '')}`.trim()}
              </option>
            ))}
          </datalist>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : runButtonText}
          </button>
        </div>
      </form>
    </div>
  );
}
