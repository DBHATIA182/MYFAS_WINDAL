import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ReportTable from '../components/ReportTable';
import LedgerReportHeader from '../components/LedgerReportHeader';
import SaleBillPrintModal from '../components/SaleBillPrintModal';
import { toDisplayDate, toInputDateString, toOracleDate } from '../utils/dateFormat';
import { downloadExcelWorkbook, downloadExcelRows } from '../utils/excelExport';
import { generatePDF, sharePdfWithWhatsApp, buildLedgerStatementPdfMetadata } from '../utils/pdfgenerator';
import { formatLedgerVoucherApiError } from '../utils/apiLabel';
import { sortTrialBalanceRows } from '../utils/trialBalanceSort';
import ReportHelpButton from '../components/ReportHelpButton';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtWeight(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtAmount(v) {
  return num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function avgRate(amount, weight, qty) {
  const w = num(weight);
  const q = num(qty);
  const a = num(amount);
  if (w !== 0) return a / w;
  if (q !== 0) return a / q;
  return 0;
}

function asNumericCodeText(v) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  const n = Number(t);
  if (!Number.isFinite(n)) return '';
  return String(Math.trunc(n));
}

export default function Slide17TradingAc({ apiBase, formData = {}, onPrev, onReset }) {
  const ledgerNumericColumns = new Set(['VR_NO', 'R_QNTY', 'R_WEIGHT', 'DR_AMOUNT', 'S_QNTY', 'S_WEIGHT', 'CR_AMOUNT', 'BAL_QNTY', 'BAL_WEIGHT', 'CL_BALANCE']);
  const blankIfZero = (v) => (num(v) === 0 ? '' : null);
  const fmtLedgerNumeric = (col, value) => {
    if (col === 'VR_NO') return num(value) === 0 ? '' : Math.trunc(num(value)).toString();
    const z = blankIfZero(value);
    if (z === '') return '';
    if (col.includes('WEIGHT') || col.includes('QNTY') || col === 'BAL_QNTY') return fmtWeight(value);
    return fmtAmount(value);
  };
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const [edt, setEdt] = useState('');
  const [tdgType, setTdgType] = useState('C');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [manualRows, setManualRows] = useState([]);
  const [debugInfo, setDebugInfo] = useState(null);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerTotals, setLedgerTotals] = useState(null);
  const [ledgerTitle, setLedgerTitle] = useState('');
  const [ledgerView, setLedgerView] = useState('entry');
  const [ledgerEntryFilter, setLedgerEntryFilter] = useState({ kind: 'all', value: '' });
  const [ledgerDetailRows, setLedgerDetailRows] = useState([]);
  const [ledgerDetailTitle, setLedgerDetailTitle] = useState('');
  const [ledgerDetailLoading, setLedgerDetailLoading] = useState(false);
  const [ledgerDetailError, setLedgerDetailError] = useState('');
  const [selectedLedgerRowKey, setSelectedLedgerRowKey] = useState('');
  const [selectedDetailRowKey, setSelectedDetailRowKey] = useState('');
  const [screen, setScreen] = useState('form');
  const [compLedgerHeader, setCompLedgerHeader] = useState(null);
  const [glLedgerRows, setGlLedgerRows] = useState([]);
  const [glLedgerStart, setGlLedgerStart] = useState('');
  const [glLedgerEnd, setGlLedgerEnd] = useState('');
  const [glLedgerCode, setGlLedgerCode] = useState('');
  const [glLedgerTitle, setGlLedgerTitle] = useState('');
  const [glVoucherRows, setGlVoucherRows] = useState(null);
  const [glVoucherTitle, setGlVoucherTitle] = useState('');
  const [catTrialRows, setCatTrialRows] = useState([]);
  const [catTrialTitle, setCatTrialTitle] = useState('');
  const [billPrintOpen, setBillPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  useEffect(() => {
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (e) setEdt(e);
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || compUid == null || String(compUid).trim() === '') {
      setCompLedgerHeader(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(`${apiBase}/api/compdet-ledger-header`, {
          params: { comp_code: compCode, comp_uid: compUid },
          withCredentials: true,
        });
        if (!cancelled) setCompLedgerHeader(data && typeof data === 'object' ? data : null);
      } catch {
        if (!cancelled) setCompLedgerHeader(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid]);

  const hasTradingValue = (r) =>
    num(r?.OAMT) !== 0 ||
    num(r?.PAMT) !== 0 ||
    num(r?.SAMT) !== 0 ||
    num(r?.CAMT) !== 0 ||
    num(r?.GPROFIT) !== 0 ||
    num(r?.GLOSS) !== 0 ||
    num(r?.OWGT) !== 0 ||
    num(r?.PWGT) !== 0 ||
    num(r?.SWGT) !== 0 ||
    num(r?.CWGT) !== 0 ||
    num(r?.SHORT) !== 0;

  const hasExpenseValue = (r) => num(r?.DR_AMT) !== 0 || num(r?.CR_AMT) !== 0;

  const stockRows = useMemo(
    () => (rows || []).filter((r) => String(r?.CODE ?? '').trim() !== '000000' && hasTradingValue(r)),
    [rows]
  );
  const expenseRows = useMemo(
    () => (rows || []).filter((r) => String(r?.CODE ?? '').trim() === '000000' && hasExpenseValue(r)),
    [rows]
  );
  const itemwiseCatRows = useMemo(() => {
    if (String(tdgType || 'C').trim().toUpperCase() !== 'I') return stockRows;
    const grp = new Map();
    (stockRows || []).forEach((r) => {
      const cat = String(r?.CAT_CODE ?? '').trim() || 'UNCAT';
      const cur = grp.get(cat) || {
        CODE: cat,
        NAME: cat,
        CAT_CODE: cat,
        OQTY: 0,
        OWGT: 0,
        OAMT: 0,
        PQTY: 0,
        PWGT: 0,
        PAMT: 0,
        SQTY: 0,
        SWGT: 0,
        SAMT: 0,
        SHORT: 0,
        CQTY: 0,
        CWGT: 0,
        CAMT: 0,
        GPROFIT: 0,
        GLOSS: 0,
        P_CODE: '',
        S_CODE: '',
        A_CODE: '',
      };
      cur.OQTY += num(r?.OQTY);
      cur.OWGT += num(r?.OWGT);
      cur.OAMT += num(r?.OAMT);
      cur.PQTY += num(r?.PQTY);
      cur.PWGT += num(r?.PWGT);
      cur.PAMT += num(r?.PAMT);
      cur.SQTY += num(r?.SQTY);
      cur.SWGT += num(r?.SWGT);
      cur.SAMT += num(r?.SAMT);
      cur.SHORT += num(r?.SHORT);
      cur.CQTY += num(r?.CQTY);
      cur.CWGT += num(r?.CWGT);
      cur.CAMT += num(r?.CAMT);
      cur.GPROFIT += num(r?.GPROFIT);
      cur.GLOSS += num(r?.GLOSS);
      grp.set(cat, cur);
    });
    return Array.from(grp.values()).sort((a, b) => String(a.CAT_CODE || '').localeCompare(String(b.CAT_CODE || '')));
  }, [stockRows, tdgType]);
  const summary = useMemo(() => {
    const opening = stockRows.reduce((sum, r) => sum + num(r?.OAMT), 0);
    const purchase = stockRows.reduce((sum, r) => sum + num(r?.PAMT), 0);
    const sales = stockRows.reduce((sum, r) => sum + num(r?.SAMT), 0);
    const closing = stockRows.reduce((sum, r) => sum + num(r?.CAMT), 0);
    const directExp = expenseRows.reduce((sum, r) => sum + num(r?.DR_AMT), 0);
    const directInc = expenseRows.reduce((sum, r) => sum + num(r?.CR_AMT), 0);
    const leftTotal = opening + purchase + directExp;
    const rightTotal = sales + closing + directInc;
    const grossProfitLoss = rightTotal - leftTotal;
    const purchaseRate = purchase !== 0 ? purchase / Math.max(stockRows.reduce((sum, r) => sum + num(r?.PWGT || r?.PQTY), 0), 1) : 0;
    const salesRate = sales !== 0 ? sales / Math.max(stockRows.reduce((sum, r) => sum + num(r?.SWGT || r?.SQTY), 0), 1) : 0;
    return {
      opening,
      purchase,
      sales,
      closing,
      directExp,
      directInc,
      leftTotal,
      rightTotal,
      grossProfitLoss,
      purchaseRate,
      salesRate,
    };
  }, [stockRows, expenseRows]);
  const formatSlashDate = (value) => {
    if (!value) return '';
    const raw = String(value).trim();
    const weird = raw.match(/^(\d{1,2})T.*\/(\d{1,2})\/(\d{4})$/);
    if (weird) return `${String(weird[1]).padStart(2, '0')}/${String(weird[2]).padStart(2, '0')}/${weird[3]}`;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) return `${String(dmy[1]).padStart(2, '0')}/${String(dmy[2]).padStart(2, '0')}/${String(dmy[3])}`;
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getFullYear())}`;
    }
    return raw;
  };
  const dateSortKey = (value) => {
    const d = formatSlashDate(value).split('/');
    if (d.length !== 3) return '';
    return `${d[2]}-${d[1].padStart(2, '0')}-${d[0].padStart(2, '0')}`;
  };
  const monthLabelFromDate = (value) => {
    const d = formatSlashDate(value).split('/');
    if (d.length !== 3) return '';
    const monthNames = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    const m = Math.max(1, Math.min(12, Number(d[1]) || 1));
    return `${monthNames[m - 1]} ${d[2]}`;
  };
  const groupedLedgerRows = useMemo(() => {
    if (screen !== 'ledger') return [];
    const scopedLedgerRows =
      ledgerView === 'entry' && ledgerEntryFilter.kind !== 'all'
        ? (ledgerRows || []).filter((r) => {
            if (ledgerEntryFilter.kind === 'date') {
              return formatSlashDate(r.VR_DATE) === ledgerEntryFilter.value;
            }
            if (ledgerEntryFilter.kind === 'month') {
              return monthLabelFromDate(r.VR_DATE) === ledgerEntryFilter.value;
            }
            return true;
          })
        : (ledgerRows || []);
    if (ledgerView === 'entry') {
      const map = new Map();
      scopedLedgerRows.forEach((r) => {
        const vrType = String(r.VR_TYPE || '').trim().toUpperCase();
        const typeVal = String(r.TYPE || '').trim();
        const key =
          vrType === 'PU' || vrType === 'DN'
            ? `${vrType}|${dateSortKey(r.VR_DATE)}|${Math.trunc(num(r.VR_NO))}`
            : `${vrType}|${dateSortKey(r.VR_DATE)}|${Math.trunc(num(r.VR_NO))}|${typeVal}`;
        const cur = map.get(key) || {
          ...r,
          VR_DATE: formatSlashDate(r.VR_DATE),
          VR_NO: Math.trunc(num(r.VR_NO)),
          R_QNTY: 0, R_WEIGHT: 0, DR_AMOUNT: 0, S_QNTY: 0, S_WEIGHT: 0, CR_AMOUNT: 0,
        };
        cur.R_QNTY += num(r.R_QNTY);
        cur.R_WEIGHT += num(r.R_WEIGHT);
        cur.DR_AMOUNT += num(r.DR_AMOUNT);
        cur.S_QNTY += num(r.S_QNTY);
        cur.S_WEIGHT += num(r.S_WEIGHT);
        cur.CR_AMOUNT += num(r.CR_AMOUNT);
        if (vrType === 'PU' || vrType === 'DN') cur.TYPE = '';
        map.set(key, cur);
      });
      let balQty = 0;
      let balWeight = 0;
      let clBal = 0;
      return Array.from(map.values())
        .sort((a, b) => {
          const da = dateSortKey(a.VR_DATE);
          const db = dateSortKey(b.VR_DATE);
          if (da !== db) return da.localeCompare(db);
          if (num(a.VR_NO) !== num(b.VR_NO)) return num(a.VR_NO) - num(b.VR_NO);
          return String(a.VR_TYPE || '').localeCompare(String(b.VR_TYPE || ''));
        })
        .map((r) => {
          balQty += num(r.R_QNTY) - num(r.S_QNTY);
          balWeight += num(r.R_WEIGHT) - num(r.S_WEIGHT);
          clBal += num(r.DR_AMOUNT) - num(r.CR_AMOUNT);
          return { ...r, BAL_QNTY: balQty, BAL_WEIGHT: balWeight, CL_BALANCE: clBal, _rowType: 'data' };
        });
    }
    if (ledgerView === 'date') {
      const map = new Map();
      (ledgerRows || []).forEach((r) => {
        const d = formatSlashDate(r.VR_DATE);
        const cur = map.get(d) || { R_QNTY: 0, R_WEIGHT: 0, DR_AMOUNT: 0, S_QNTY: 0, S_WEIGHT: 0, CR_AMOUNT: 0 };
        cur.R_QNTY += num(r.R_QNTY);
        cur.R_WEIGHT += num(r.R_WEIGHT);
        cur.DR_AMOUNT += num(r.DR_AMOUNT);
        cur.S_QNTY += num(r.S_QNTY);
        cur.S_WEIGHT += num(r.S_WEIGHT);
        cur.CR_AMOUNT += num(r.CR_AMOUNT);
        map.set(d, cur);
      });
      let runBQ = 0;
      let runBW = 0;
      let runCL = 0;
      return Array.from(map.entries())
        .sort((a, b) => dateSortKey(a[0]).localeCompare(dateSortKey(b[0])))
        .map(([d, t]) => {
          runBQ += num(t.R_QNTY) - num(t.S_QNTY);
          runBW += num(t.R_WEIGHT) - num(t.S_WEIGHT);
          runCL += num(t.DR_AMOUNT) - num(t.CR_AMOUNT);
          return { _rowType: 'total', _label: `${d}`, _sourceDate: d, BAL_QNTY: runBQ, BAL_WEIGHT: runBW, CL_BALANCE: runCL, ...t };
        });
    }
    const mMap = new Map();
    (ledgerRows || []).forEach((r) => {
      const mLabel = monthLabelFromDate(r.VR_DATE);
      const mKey = `${dateSortKey(r.VR_DATE).slice(0, 7)}|${mLabel}`;
      const cur = mMap.get(mKey) || { R_QNTY: 0, R_WEIGHT: 0, DR_AMOUNT: 0, S_QNTY: 0, S_WEIGHT: 0, CR_AMOUNT: 0 };
      cur.R_QNTY += num(r.R_QNTY);
      cur.R_WEIGHT += num(r.R_WEIGHT);
      cur.DR_AMOUNT += num(r.DR_AMOUNT);
      cur.S_QNTY += num(r.S_QNTY);
      cur.S_WEIGHT += num(r.S_WEIGHT);
      cur.CR_AMOUNT += num(r.CR_AMOUNT);
      mMap.set(mKey, cur);
    });
    let runBQ = 0;
    let runBW = 0;
    let runCL = 0;
    return Array.from(mMap.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([mKey, t]) => {
        const m = String(mKey).split('|').slice(1).join('|');
        runBQ += num(t.R_QNTY) - num(t.S_QNTY);
        runBW += num(t.R_WEIGHT) - num(t.S_WEIGHT);
        runCL += num(t.DR_AMOUNT) - num(t.CR_AMOUNT);
        return { _rowType: 'total', _label: `${m}`, _sourceMonth: m, BAL_QNTY: runBQ, BAL_WEIGHT: runBW, CL_BALANCE: runCL, ...t };
      });
  }, [ledgerRows, ledgerView, screen, ledgerEntryFilter]);

  const effectiveLedgerTotals = useMemo(() => {
    if (!groupedLedgerRows.length) return null;
    const seed = { R_QNTY: 0, R_WEIGHT: 0, DR_AMOUNT: 0, S_QNTY: 0, S_WEIGHT: 0, CR_AMOUNT: 0, BAL_QNTY: 0, BAL_WEIGHT: 0, CL_BALANCE: 0 };
    if (ledgerView === 'entry') {
      return groupedLedgerRows.reduce(
        (a, r) => ({
          R_QNTY: a.R_QNTY + num(r?.R_QNTY),
          R_WEIGHT: a.R_WEIGHT + num(r?.R_WEIGHT),
          DR_AMOUNT: a.DR_AMOUNT + num(r?.DR_AMOUNT),
          S_QNTY: a.S_QNTY + num(r?.S_QNTY),
          S_WEIGHT: a.S_WEIGHT + num(r?.S_WEIGHT),
          CR_AMOUNT: a.CR_AMOUNT + num(r?.CR_AMOUNT),
          BAL_QNTY: num(r?.BAL_QNTY),
          BAL_WEIGHT: num(r?.BAL_WEIGHT),
          CL_BALANCE: num(r?.CL_BALANCE),
        }),
        seed
      );
    }
    return groupedLedgerRows.reduce(
      (a, r) => ({
        R_QNTY: a.R_QNTY + num(r?.R_QNTY),
        R_WEIGHT: a.R_WEIGHT + num(r?.R_WEIGHT),
        DR_AMOUNT: a.DR_AMOUNT + num(r?.DR_AMOUNT),
        S_QNTY: a.S_QNTY + num(r?.S_QNTY),
        S_WEIGHT: a.S_WEIGHT + num(r?.S_WEIGHT),
        CR_AMOUNT: a.CR_AMOUNT + num(r?.CR_AMOUNT),
        BAL_QNTY: a.BAL_QNTY + num(r?.BAL_QNTY),
        BAL_WEIGHT: a.BAL_WEIGHT + num(r?.BAL_WEIGHT),
        CL_BALANCE: a.CL_BALANCE + num(r?.CL_BALANCE),
      }),
      seed
    );
  }, [groupedLedgerRows, ledgerView]);

  const fetchTrading = async (manualConfirmed = false) => {
    const edtOracle = toOracleDate(edt);
    if (!edtOracle) {
      alert('Please select Ending Date.');
      return false;
    }
    const scheduleNorm = '12.10';
    const tdgMode = String(tdgType || 'C').trim().toUpperCase() === 'I' ? 'I' : 'C';
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/trading-ac`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          schedule: scheduleNorm,
          code: '',
          edt: edtOracle,
          mcb: 'C',
          mwyn: 'N',
          cat_code_yn: 'N',
          m_short_pick: 'N',
          mfyn: 'A',
          tdg_type: tdgMode,
          manual_confirmed: manualConfirmed ? 'Y' : 'N',
        },
        withCredentials: true,
        timeout: 180000,
      });
      if (data?.requiresManualEntry) {
        setManualRows(Array.isArray(data?.rows) ? data.rows : []);
        setDebugInfo(data?.debug || null);
        setScreen('manual');
        return true;
      }
      const nextRows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
      setRows(nextRows);
      setDebugInfo(data?.debug || null);
      setScreen('report');
      return true;
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run Trading A/C report');
      setRows([]);
      return false;
    } finally {
      setLoading(false);
    }
  };
  const runReport = async (e) => {
    e.preventDefault();
    await fetchTrading(false);
  };

  const saveManualAndRun = async () => {
    setLoading(true);
    setError('');
    try {
      await axios.post(
        `${apiBase}/api/trading-ac/manual-save`,
        {
          comp_code: compCode,
          comp_uid: compUid,
          tdg_type: String(tdgType || 'C').trim().toUpperCase(),
          rows:
            String(tdgType || 'C').trim().toUpperCase() === 'I'
              ? manualRows.map((r) => ({
                  cat_code: r.CAT_CODE,
                  item_code: r.ITEM_CODE,
                  rate: num(r.RATE),
                  amount: num(r.AMOUNT),
                  s_code: num(r.S_CODE),
                  p_code: num(r.P_CODE),
                  cat: r.CAT,
                  cl_wgt: num(r.CL_WGT),
                }))
              : manualRows.map((r) => ({
                  amount: num(r.AMOUNT),
                })),
        },
        { withCredentials: true, timeout: 120000 }
      );
      await fetchTrading(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save manual closing stock');
    } finally {
      setLoading(false);
    }
  };

  /** Stock rows use numeric P_CODE/S_CODE; direct-expense rows use real GL in A_CODE. */
  const tradingLedgerAccountCode = (row) => {
    const ac = asNumericCodeText(row?.A_CODE);
    if (ac && ac !== '0') return ac;
    const pCode = asNumericCodeText(row?.P_CODE);
    if (pCode && pCode !== '0') return pCode;
    const sCode = asNumericCodeText(row?.S_CODE);
    if (sCode && sCode !== '0') return sCode;
    const code = asNumericCodeText(row?.CODE);
    if (code && code !== '0') return code;
    return '';
  };

  const isDirectExpenseRow = (row) =>
    String(row?.CODE ?? '').trim() === '000000' && String(row?.A_CODE ?? '').trim() !== '';

  const backFromGlLedger = () => {
    setGlVoucherRows(null);
    setGlVoucherTitle('');
    setBillPrintOpen(false);
    setBillPrintParams(null);
    setGlLedgerRows([]);
    setGlLedgerStart('');
    setGlLedgerEnd('');
    setGlLedgerCode('');
    setGlLedgerTitle('');
    setScreen('report');
  };

  const openSimpleLedgerByCode = async (ledgerCode, ledgerName = '') => {
    const code = asNumericCodeText(ledgerCode);
    if (!code || code === '000000') {
      alert('No account code for ledger on this row.');
      return;
    }
    const sYmd = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const eYmd = toInputDateString(edt);
    if (!sYmd || !eYmd) {
      alert('Financial year start (comp_s_dt) and Trading A/C ending date are required for ledger.');
      return;
    }
    const sOracle = toOracleDate(sYmd);
    const eOracle = toOracleDate(eYmd);
    if (!sOracle || !eOracle) {
      alert('Invalid date range for ledger.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/ledger`, {
        params: {
          comp_code: compCode,
          code,
          s_date: sOracle,
          e_date: eOracle,
          comp_uid: compUid,
          voucher_wise_total: 'N',
        },
        withCredentials: true,
        timeout: 180000,
      });
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        alert('No transactions found for this account in the selected period.');
        return;
      }
      setGlLedgerRows(rows);
      setGlLedgerStart(sYmd);
      setGlLedgerEnd(eYmd);
      setGlLedgerCode(code);
      setGlLedgerTitle(String(ledgerName || '').trim());
      setGlVoucherRows(null);
      setGlVoucherTitle('');
      setBillPrintOpen(false);
      setBillPrintParams(null);
      setScreen('gl-ledger');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };

  const openGlLedgerSaleBill = (row) => {
    const vrType = row.VR_TYPE ?? row.vr_type;
    const ledgerLineType = row.TYPE ?? row.type;
    const billNo = row.VR_NO ?? row.vr_no;
    const billDt = row.VR_DATE ?? row.vr_date;
    const ymd = toInputDateString(billDt);
    const oracleDt = toOracleDate(ymd);
    const saleType = vrType != null && String(vrType).trim() !== '' ? String(vrType).trim() : '';
    if (!saleType) {
      alert('Cannot open sale bill: missing voucher type.');
      return;
    }
    if (billNo == null || String(billNo).trim() === '' || !oracleDt) {
      alert('Cannot open sale bill: missing voucher no or date.');
      return;
    }
    const bTypeFromLedger = ledgerLineType != null && String(ledgerLineType).trim() !== '' ? String(ledgerLineType).trim() : ' ';
    const ptypeNum =
      typeof vrType === 'number' ? vrType : parseInt(String(vrType ?? '').trim(), 10);
    setBillPrintParams({
      type: saleType,
      ...(Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9 ? { oracleTypeNum: ptypeNum } : {}),
      billNo: String(billNo).trim(),
      bType: bTypeFromLedger,
      oracleDt,
      compYear: String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim(),
      label: `Sale bill — ${saleType} · ${String(billNo)} · ${toDisplayDate(ymd)}`,
    });
    setBillPrintOpen(true);
  };

  const runGlLedgerVoucher = async (row) => {
    const vrType = row.VR_TYPE ?? row.vr_type;
    const vrNo = row.VR_NO ?? row.vr_no;
    const vrDate = row.VR_DATE ?? row.vr_date;
    if (!vrType) {
      alert('Cannot open voucher: missing voucher type on this line.');
      return;
    }
    const n = Number(vrNo);
    if (!Number.isFinite(n) || n <= 0) return;
    const ymd = toInputDateString(vrDate);
    if (!ymd) {
      alert('Could not read voucher date on this line.');
      return;
    }
    setLoading(true);
    try {
      const response = await axios.get(`${apiBase}/api/ledger-voucher`, {
        params: {
          comp_code: compCode,
          vr_type: String(vrType),
          vr_date: toOracleDate(ymd),
          vr_no: n,
          comp_uid: compUid,
        },
        withCredentials: true,
        timeout: 30000,
      });
      const rows = Array.isArray(response.data) ? response.data : [];
      if (rows.length === 0) {
        alert('No voucher lines found for this voucher.');
        return;
      }
      setGlVoucherRows(rows);
      setGlVoucherTitle(`${String(vrType)} ${n} · ${toDisplayDate(ymd)}`);
    } catch (error) {
      alert('Error: ' + formatLedgerVoucherApiError(error, apiBase));
    } finally {
      setLoading(false);
    }
  };

  const glLedgerPdfMeta = () =>
    buildLedgerStatementPdfMetadata({
      formData,
      compLedgerHeader,
      account: glLedgerRows[0],
      ledgerFirstRow: glLedgerRows[0],
      year: compYear,
      endDate: `${toDisplayDate(glLedgerStart)} – ${toDisplayDate(glLedgerEnd)}`,
      accountNameOverride: glLedgerTitle,
      accountCodeOverride: glLedgerCode,
    });

  const openLedger = async (row) => {
    const ledgerCode = tradingLedgerAccountCode(row);
    if (!ledgerCode || ledgerCode === '000000') {
      alert('No account code for ledger on this row.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (isDirectExpenseRow(row)) {
        await openSimpleLedgerByCode(ledgerCode, String(row.NAME || '').trim());
        return;
      }

      const edtOracle = toOracleDate(edt);
      const { data } = await axios.get(`${apiBase}/api/trading-ac-ledger`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          code: ledgerCode,
          edt: edtOracle,
          mcb: 'C',
        },
        withCredentials: true,
        timeout: 180000,
      });
      setLedgerRows(Array.isArray(data?.rows) ? data.rows : []);
      setLedgerTotals(data?.totals || null);
      setLedgerTitle(String(row.NAME || row.CODE || ''));
      setLedgerView('entry');
      setLedgerEntryFilter({ kind: 'all', value: '' });
      setLedgerDetailRows([]);
      setLedgerDetailTitle('');
      setLedgerDetailError('');
      setSelectedLedgerRowKey('');
      setSelectedDetailRowKey('');
      setScreen('ledger');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };
  const openCategoryTrialBalance = async (catRow) => {
    const cat = String(catRow?.CAT_CODE ?? '').trim() || 'UNCAT';
    setLoading(true);
    setError('');
    try {
      const { data: catData } = await axios.get(`${apiBase}/api/trading-ac-category-codes`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          cat_code: cat,
        },
        withCredentials: true,
        timeout: 120000,
      });
      const linked = Array.from(
        new Set((Array.isArray(catData?.rows) ? catData.rows : []).map((r) => asNumericCodeText(r?.CODE)).filter(Boolean))
      );
      if (!linked.length) {
        alert(`No linked sale/purchase ledger codes found for category ${cat}.`);
        return;
      }
      const edtOracle = toOracleDate(edt);
      const { data } = await axios.get(`${apiBase}/api/trial-balance-by-codes`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          e_date: edtOracle,
          codes: linked.join(','),
        },
        withCredentials: true,
        timeout: 180000,
      });
      setCatTrialRows(sortTrialBalanceRows(Array.isArray(data) ? data : []));
      setCatTrialTitle(`Category ${cat} — linked ledger codes (${linked.length}) [Sale: >12<13, Purchase: >14<15]`);
      setScreen('cat-trial');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load category-linked Trial Balance');
    } finally {
      setLoading(false);
    }
  };
  const openAllLinkedTrialBalance = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: catData } = await axios.get(`${apiBase}/api/trading-ac-category-codes`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          cat_code: 'ALL',
        },
        withCredentials: true,
        timeout: 120000,
      });
      const linked = Array.from(
        new Set((Array.isArray(catData?.rows) ? catData.rows : []).map((r) => asNumericCodeText(r?.CODE)).filter(Boolean))
      );
      if (!linked.length) {
        alert('No linked sale/purchase ledger codes found.');
        return;
      }
      const edtOracle = toOracleDate(edt);
      const { data } = await axios.get(`${apiBase}/api/trial-balance-by-codes`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          e_date: edtOracle,
          codes: linked.join(','),
        },
        withCredentials: true,
        timeout: 180000,
      });
      setCatTrialRows(sortTrialBalanceRows(Array.isArray(data) ? data : []));
      setCatTrialTitle(`All linked ledger codes (${linked.length}) [Sale: >12<13, Purchase: >14<15]`);
      setScreen('cat-trial');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load linked Trial Balance');
    } finally {
      setLoading(false);
    }
  };

  const openLedgerVoucherDetail = async (row) => {
    const vrType = String(row?.VR_TYPE || '').trim().toUpperCase();
    if (!vrType || row?._rowType === 'total') return;
    setLedgerDetailLoading(true);
    setLedgerDetailError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/trading-ac-ledger-entry-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: vrType,
          vr_date: dateSortKey(row?.VR_DATE),
          vr_no: Math.trunc(num(row?.VR_NO)),
          type: String(row?.TYPE || '').trim(),
        },
        withCredentials: true,
        timeout: 180000,
      });
      const nextRows = Array.isArray(data?.rows) ? data.rows : [];
      setLedgerDetailRows(nextRows);
      setLedgerDetailTitle(`${vrType}  ${formatSlashDate(row?.VR_DATE)}  ${Math.trunc(num(row?.VR_NO))}${String(row?.TYPE || '').trim() ? `  ${String(row.TYPE).trim()}` : ''}`);
      setScreen('ledger-detail');
    } catch (err) {
      setLedgerDetailError(err.response?.data?.error || err.message || 'Failed to load voucher details');
    } finally {
      setLedgerDetailLoading(false);
    }
  };

  const getLedgerExportRows = () => {
    const cols = ['VR_TYPE', 'VR_DATE', 'VR_NO', 'TYPE', 'R_QNTY', 'R_WEIGHT', 'DR_AMOUNT', 'S_QNTY', 'S_WEIGHT', 'CR_AMOUNT', 'BAL_QNTY', 'BAL_WEIGHT', 'CL_BALANCE'];
    return groupedLedgerRows.map((row) => {
      if (row?._rowType === 'total') {
        return {
          VR_TYPE: '',
          VR_DATE: row._label || '',
          VR_NO: '',
          TYPE: '',
          R_QNTY: num(row.R_QNTY),
          R_WEIGHT: num(row.R_WEIGHT),
          DR_AMOUNT: num(row.DR_AMOUNT),
          S_QNTY: num(row.S_QNTY),
          S_WEIGHT: num(row.S_WEIGHT),
          CR_AMOUNT: num(row.CR_AMOUNT),
          BAL_QNTY: num(row.BAL_QNTY),
          BAL_WEIGHT: num(row.BAL_WEIGHT),
          CL_BALANCE: num(row.CL_BALANCE),
        };
      }
      const out = {};
      cols.forEach((c) => {
        if (c === 'VR_DATE') out[c] = formatSlashDate(row[c]);
        else if (c === 'VR_NO') out[c] = Math.trunc(num(row[c]));
        else out[c] = row[c];
      });
      return out;
    });
  };
  const getLedgerPdfRows = () => getLedgerExportRows().map((r) => ({ ...r, VR_DATE: formatSlashDate(r?.VR_DATE) }));

  const exportLedgerExcel = () => {
    const exportRows = getLedgerExportRows();
    if (!exportRows.length) return;
    const sheetName = ledgerView === 'entry' ? 'EntryWise' : ledgerView === 'date' ? 'DateWise' : 'MonthWise';
    downloadExcelWorkbook([{ name: sheetName, data: exportRows }], `${compName}_TradingLedger_${ledgerTitle || 'Account'}_${sheetName}`, {
      autoOpen: true,
    });
  };
  const exportLedgerPdf = () => {
    const exportRows = getLedgerPdfRows();
    if (!exportRows.length) return;
    generatePDF(
      'trading-ledger',
      exportRows,
      {
        companyName: compName,
        year: compYear,
        period: `As on ${toDisplayDate(edt)}`,
        reportTitle: `Trading Ledger (${ledgerView === 'entry' ? 'Entry Wise' : ledgerView === 'date' ? 'Date Wise' : 'Month Wise'}) - ${ledgerTitle}`,
      }
    ).catch((e) => alert(String(e?.message || e)));
  };
  const shareLedgerWhatsapp = () => {
    const exportRows = getLedgerPdfRows();
    if (!exportRows.length) return;
    sharePdfWithWhatsApp(
      'trading-ledger',
      exportRows,
      {
        companyName: compName,
        year: compYear,
        period: `As on ${toDisplayDate(edt)}`,
        reportTitle: `Trading Ledger (${ledgerView === 'entry' ? 'Entry Wise' : ledgerView === 'date' ? 'Date Wise' : 'Month Wise'}) - ${ledgerTitle}`,
      },
      [`Trading Ledger`, `${ledgerView.toUpperCase()} WISE`, ledgerTitle, compName, `As on ${toDisplayDate(edt)}`].join('\n')
    ).catch((e) => alert(String(e?.message || e)));
  };

  const getTradingExportPayload = () => ({
    stockRows,
    expenseRows,
    summary,
  });

  const exportTradingExcel = () => {
    const payload = getTradingExportPayload();
    if (!payload.stockRows.length && !payload.expenseRows.length) return;
    const tradingRows = [];
    payload.stockRows.forEach((r) => {
      const title = String(r.NAME || r.CODE || '').trim();
      const lTotal = num(r.OAMT) + num(r.PAMT) + num(r.GPROFIT);
      const rTotal = num(r.SAMT) + num(r.CAMT) + num(r.GLOSS);
      tradingRows.push({ LEFT_PARTICULARS: title, LEFT_WEIGHT: '', LEFT_AMOUNT: '', RIGHT_PARTICULARS: '', RIGHT_WEIGHT: '', RIGHT_AMOUNT: '' });
      // Hide weight-driven rows when the weight is 0 (prevents noisy empty lines in item-wise export).
      const openingLine = num(r.OWGT) !== 0 ? { LEFT_PARTICULARS: 'OPENING', LEFT_WEIGHT: fmtWeight(r.OWGT), LEFT_AMOUNT: fmtAmount(r.OAMT) } : { LEFT_PARTICULARS: '', LEFT_WEIGHT: '', LEFT_AMOUNT: '' };
      const salesLine = num(r.SWGT) !== 0 ? { RIGHT_PARTICULARS: 'SALES', RIGHT_WEIGHT: fmtWeight(r.SWGT), RIGHT_AMOUNT: fmtAmount(r.SAMT) } : { RIGHT_PARTICULARS: '', RIGHT_WEIGHT: '', RIGHT_AMOUNT: '' };
      if (openingLine.LEFT_PARTICULARS || salesLine.RIGHT_PARTICULARS) tradingRows.push({ ...openingLine, ...salesLine });

      const purchaseLine = num(r.PWGT) !== 0 ? { LEFT_PARTICULARS: 'PURCHASE', LEFT_WEIGHT: fmtWeight(r.PWGT), LEFT_AMOUNT: fmtAmount(r.PAMT) } : { LEFT_PARTICULARS: '', LEFT_WEIGHT: '', LEFT_AMOUNT: '' };
      const shortLine = num(r.SHORT) !== 0 ? { RIGHT_PARTICULARS: 'SHORT/ACCESS', RIGHT_WEIGHT: fmtWeight(r.SHORT), RIGHT_AMOUNT: fmtAmount(0) } : { RIGHT_PARTICULARS: '', RIGHT_WEIGHT: '', RIGHT_AMOUNT: '' };
      if (purchaseLine.LEFT_PARTICULARS || shortLine.RIGHT_PARTICULARS) tradingRows.push({ ...purchaseLine, ...shortLine });

      tradingRows.push({ LEFT_PARTICULARS: 'G.PROFIT', LEFT_WEIGHT: '', LEFT_AMOUNT: fmtAmount(r.GPROFIT), RIGHT_PARTICULARS: 'CLOSING', RIGHT_WEIGHT: fmtWeight(r.CWGT), RIGHT_AMOUNT: fmtAmount(r.CAMT) });
      if (num(r.GLOSS) !== 0) {
        tradingRows.push({ LEFT_PARTICULARS: '', LEFT_WEIGHT: '', LEFT_AMOUNT: '', RIGHT_PARTICULARS: 'G.LOSS', RIGHT_WEIGHT: '', RIGHT_AMOUNT: fmtAmount(r.GLOSS) });
      }
      tradingRows.push({ LEFT_PARTICULARS: 'TOTAL', LEFT_WEIGHT: '', LEFT_AMOUNT: fmtAmount(lTotal), RIGHT_PARTICULARS: 'TOTAL', RIGHT_WEIGHT: '', RIGHT_AMOUNT: fmtAmount(rTotal) });
    });
    payload.expenseRows.forEach((r) => {
      tradingRows.push({
        LEFT_PARTICULARS: String(r.NAME || '').trim(),
        LEFT_WEIGHT: '',
        LEFT_AMOUNT: num(r.DR_AMT) ? fmtAmount(r.DR_AMT) : '',
        RIGHT_PARTICULARS: '',
        RIGHT_WEIGHT: '',
        RIGHT_AMOUNT: num(r.CR_AMT) ? fmtAmount(r.CR_AMT) : '',
      });
    });
    const summaryRows = [
      { LEFT_PARTICULARS: 'OPENING', LEFT_AMOUNT: fmtAmount(summary.opening), RIGHT_PARTICULARS: 'SALES', RIGHT_AMOUNT: fmtAmount(summary.sales), RIGHT_RATE: fmtAmount(summary.salesRate) },
      { LEFT_PARTICULARS: 'PURCHASE', LEFT_AMOUNT: fmtAmount(summary.purchase), LEFT_RATE: fmtAmount(summary.purchaseRate), RIGHT_PARTICULARS: 'CL.STOCK', RIGHT_AMOUNT: fmtAmount(summary.closing) },
      { LEFT_PARTICULARS: 'DIRECT EXP.', LEFT_AMOUNT: fmtAmount(summary.directExp), RIGHT_PARTICULARS: 'DIRECT INCOME', RIGHT_AMOUNT: fmtAmount(summary.directInc) },
      { LEFT_PARTICULARS: 'G.TOTAL', LEFT_AMOUNT: fmtAmount(summary.leftTotal), RIGHT_PARTICULARS: 'G.TOTAL', RIGHT_AMOUNT: fmtAmount(summary.rightTotal) },
      { LEFT_PARTICULARS: 'TOTAL GROSS PROFIT/LOSS', LEFT_AMOUNT: fmtAmount(summary.grossProfitLoss), RIGHT_PARTICULARS: '', RIGHT_AMOUNT: '' },
    ];
    downloadExcelWorkbook(
      [
        { name: 'Trading', data: tradingRows },
        { name: 'Summary', data: summaryRows },
      ],
      `${compName}_TradingAc_${edt || compYear}`,
      { autoOpen: true }
    );
  };

  const exportTradingPdf = () => {
    const payload = getTradingExportPayload();
    if (!payload.stockRows.length && !payload.expenseRows.length) return;
    generatePDF('trading-account', payload, {
      companyName: compName,
      year: compYear,
      period: `As on ${toDisplayDate(edt)}`,
      reportTitle: `Trading A/C As At ${toDisplayDate(edt)}`,
    }).catch((e) => alert(String(e?.message || e)));
  };

  const shareTradingWhatsapp = () => {
    const payload = getTradingExportPayload();
    if (!payload.stockRows.length && !payload.expenseRows.length) return;
    sharePdfWithWhatsApp(
      'trading-account',
      payload,
      {
        companyName: compName,
        year: compYear,
        period: `As on ${toDisplayDate(edt)}`,
        reportTitle: `Trading A/C As At ${toDisplayDate(edt)}`,
      },
      [compName, 'Trading A/C', `As on ${toDisplayDate(edt)}`, `FY ${compYear}`].filter(Boolean).join('\n')
    ).catch((e) => alert(String(e?.message || e)));
  };

  if (screen === 'manual') {
    return (
      <div className="slide slide-report slide-17">
        <h2>Trading A/C - Enter Closing Stock</h2>
        <p className="company-info">
          {compName} | FY {compYear} | As on {toDisplayDate(edt)}
        </p>
        {error ? <div className="form-api-error">{error}</div> : null}
        {debugInfo ? (
          <div className="report-info">
            <p>
              <strong>Debug:</strong> comp_code={String(debugInfo.comp_code)} schedule={String(debugInfo.schedule_input)} parsed=
              {String(debugInfo.schedule_num)} master_count={String(debugInfo.master_count)} clstock_count={String(debugInfo.clstock_count)}
              {debugInfo.master_source ? ` master_source=${String(debugInfo.master_source)}` : ''}
            </p>
            {Array.isArray(debugInfo.sample_master_codes) && debugInfo.sample_master_codes.length ? (
              <p>{debugInfo.sample_master_codes.join(' | ')}</p>
            ) : null}
          </div>
        ) : null}
        <div className="report-display table-responsive">
          <table className="report-table">
            <thead>
              {String(tdgType || 'C').trim().toUpperCase() === 'I' ? (
                <tr>
                  <th>Cat</th>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th className="text-right">Cl.Wgt</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Amount</th>
                </tr>
              ) : (
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th className="text-right">Opening</th>
                  <th className="text-right">Closing Amount</th>
                  <th className="text-right">Shortage</th>
                </tr>
              )}
            </thead>
            <tbody>
              {manualRows.map((r, i) =>
                String(tdgType || 'C').trim().toUpperCase() === 'I' ? (
                  <tr key={`${r.ITEM_CODE}_${i}`}>
                    <td>{r.CAT_CODE}</td>
                    <td>{r.ITEM_CODE}</td>
                    <td>{r.ITEM_NAME}</td>
                    <td className="text-right">
                      <input
                        className="form-input"
                        value={r.CL_WGT ?? 0}
                        onChange={(e) =>
                          setManualRows((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, CL_WGT: e.target.value } : x))
                          )
                        }
                      />
                    </td>
                    <td className="text-right">
                      <input
                        className="form-input"
                        value={r.RATE ?? 0}
                        onChange={(e) =>
                          setManualRows((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, RATE: e.target.value } : x))
                          )
                        }
                      />
                    </td>
                    <td className="text-right">
                      <input
                        className="form-input"
                        value={r.AMOUNT ?? 0}
                        onChange={(e) =>
                          setManualRows((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, AMOUNT: e.target.value } : x))
                          )
                        }
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={`cons_${i}`}>
                    <td>CONSOLIDATE</td>
                    <td>Closing Stock Amount</td>
                    <td className="text-right">{fmtAmount(0)}</td>
                    <td className="text-right">
                      <input
                        className="form-input"
                        value={r.AMOUNT ?? 0}
                        onChange={(e) =>
                          setManualRows((prev) =>
                            prev.map((x, idx) => (idx === i ? { ...x, AMOUNT: e.target.value } : x))
                          )
                        }
                      />
                    </td>
                    <td className="text-right">{fmtAmount(0)}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setScreen('form')}>
            ← Back
          </button>
          <button type="button" className="btn btn-primary" onClick={saveManualAndRun} disabled={loading}>
            {loading ? 'Saving…' : 'Confirm and Run Trading'}
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'report') {
    return (
      <div className="slide slide-report slide-17">
        <div className="report-toolbar">
          <h2>Trading A/C</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="trading-ac" />
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('form')}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={exportTradingPdf} disabled={!rows.length}>
              Pdf
            </button>
            <button type="button" className="btn btn-excel" onClick={exportTradingExcel} disabled={!rows.length}>
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareTradingWhatsapp} disabled={!rows.length}>
              WhatsApp
            </button>
            {String(tdgType || 'C').trim().toUpperCase() === 'C' ? (
              <button type="button" className="btn btn-secondary" onClick={openAllLinkedTrialBalance} disabled={loading || !rows.length}>
                Linked Accounts
              </button>
            ) : null}
          </div>
        </div>
        <div className="report-info">
          <p>
            <strong>{compName}</strong> | FY {compYear}
          </p>
          <p>
            <strong>As on:</strong> {toDisplayDate(edt)}
          </p>
        </div>

        {error ? <div className="form-api-error">{error}</div> : null}
        {debugInfo ? (
          <div className="report-info">
            <p>
              <strong>Debug:</strong> stock_count={String(debugInfo.stock_count)} expense_count={String(debugInfo.expense_count)} schedule=
              {String(debugInfo.schedule_input)} parsed={String(debugInfo.schedule_num)}
            </p>
          </div>
        ) : null}
        {rows.length ? (
          <div className="report-display table-responsive trading-ac-report">
            {String(tdgType || 'C').trim().toUpperCase() === 'C' ? (
              <table className="report-table trading-ac-layout">
                <thead>
                  <tr>
                    <th>Particulars</th>
                    <th className="text-right">Amount</th>
                    <th>Particulars</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    className="sale-list-row-clickable"
                    onClick={openAllLinkedTrialBalance}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openAllLinkedTrialBalance();
                      }
                    }}
                  >
                    <td>OPENING</td>
                    <td className="text-right">{fmtAmount(summary.opening)}</td>
                    <td>SALE</td>
                    <td className="text-right">{fmtAmount(summary.sales)}</td>
                  </tr>
                  <tr
                    className="sale-list-row-clickable"
                    onClick={openAllLinkedTrialBalance}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openAllLinkedTrialBalance();
                      }
                    }}
                  >
                    <td>PURCHASE</td>
                    <td className="text-right">{fmtAmount(summary.purchase)}</td>
                    <td>CLOSING STOCK</td>
                    <td className="text-right">{fmtAmount(summary.closing)}</td>
                  </tr>
                  <tr
                    className="stock-sum-grand sale-list-row-clickable"
                    onClick={openAllLinkedTrialBalance}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openAllLinkedTrialBalance();
                      }
                    }}
                  >
                    <td colSpan={2}>
                      <strong>{summary.grossProfitLoss >= 0 ? 'Gross Profit' : 'Gross Loss'}</strong>
                    </td>
                    <td colSpan={2} className="text-right">
                      <strong>{fmtAmount(Math.abs(summary.grossProfitLoss))}</strong>
                    </td>
                  </tr>
                  {expenseRows.map((r, idx) => (
                    <tr
                      key={`exp_cons_${idx}_${r.A_CODE || r.NAME || idx}`}
                      className="sale-list-row-clickable"
                      onClick={openAllLinkedTrialBalance}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openAllLinkedTrialBalance();
                        }
                      }}
                    >
                      <td>{String(r.NAME || '').trim()}</td>
                      <td className="text-right">{fmtAmount(r.DR_AMT)}</td>
                      <td />
                      <td className="text-right">{fmtAmount(r.CR_AMT)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="report-table trading-ac-layout">
                <thead>
                  <tr>
                    <th>Particulars</th>
                    <th className="text-right">Weight</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Avg.Rate</th>
                    <th>Particulars</th>
                    <th className="text-right">Weight</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Avg.Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {itemwiseCatRows.map((r, idx) => {
                    const lTotal = num(r.OAMT) + num(r.PAMT) + num(r.GPROFIT);
                    const rTotal = num(r.SAMT) + num(r.CAMT) + num(r.GLOSS);
                    const showOpening = num(r.OWGT) !== 0;
                    const showPurchase = num(r.PWGT) !== 0;
                    const showSales = num(r.SWGT) !== 0;
                    const showShort = num(r.SHORT) !== 0;
                    return (
                      <React.Fragment key={`stock_${idx}_${r.CODE}`}>
                        <tr
                          className="trading-ac-title-row sale-list-row-clickable"
                          onClick={() => openCategoryTrialBalance(r)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openCategoryTrialBalance(r);
                            }
                          }}
                        >
                          <td colSpan={8}><strong>{String(r.NAME || '').trim() || String(r.CODE || '').trim()}</strong></td>
                        </tr>
                        {showOpening || showSales ? (
                          <tr>
                            {showOpening ? (
                              <>
                                <td>OPENING</td>
                                <td className="text-right">{fmtWeight(r.OWGT)}</td>
                                <td className="text-right">{fmtAmount(r.OAMT)}</td>
                                <td className="text-right">{fmtAmount(avgRate(r.OAMT, r.OWGT, r.OQTY))}</td>
                              </>
                            ) : (
                              <>
                                <td />
                                <td />
                                <td />
                                <td />
                              </>
                            )}
                            {showSales ? (
                              <>
                                <td>SALES</td>
                                <td className="text-right">{fmtWeight(r.SWGT)}</td>
                                <td className="text-right">{fmtAmount(r.SAMT)}</td>
                                <td className="text-right">{fmtAmount(avgRate(r.SAMT, r.SWGT, r.SQTY))}</td>
                              </>
                            ) : (
                              <>
                                <td />
                                <td />
                                <td />
                                <td />
                              </>
                            )}
                          </tr>
                        ) : null}
                        {showPurchase || showShort ? (
                          <tr>
                            {showPurchase ? (
                              <>
                                <td>PURCHASE</td>
                                <td className="text-right">{fmtWeight(r.PWGT)}</td>
                                <td className="text-right">{fmtAmount(r.PAMT)}</td>
                                <td className="text-right">{fmtAmount(avgRate(r.PAMT, r.PWGT, r.PQTY))}</td>
                              </>
                            ) : (
                              <>
                                <td />
                                <td />
                                <td />
                                <td />
                              </>
                            )}
                            {showShort ? (
                              <>
                                <td>SHORT/ACCESS</td>
                                <td className="text-right">{fmtWeight(r.SHORT)}</td>
                                <td className="text-right">{fmtAmount(0)}</td>
                                <td className="text-right">{fmtAmount(0)}</td>
                              </>
                            ) : (
                              <>
                                <td />
                                <td />
                                <td />
                                <td />
                              </>
                            )}
                          </tr>
                        ) : null}
                        <tr>
                          <td>G.PROFIT</td>
                          <td className="text-right">{fmtWeight(0)}</td>
                          <td className="text-right">{fmtAmount(r.GPROFIT)}</td>
                          <td className="text-right">{fmtAmount(0)}</td>
                          <td>CLOSING</td>
                          <td className="text-right">{fmtWeight(r.CWGT)}</td>
                          <td className="text-right">{fmtAmount(r.CAMT)}</td>
                          <td className="text-right">{fmtAmount(avgRate(r.CAMT, r.CWGT, r.CQTY))}</td>
                        </tr>
                        <tr>
                          <td />
                          <td />
                          <td />
                          <td />
                          <td>G.LOSS</td>
                          <td className="text-right">{fmtWeight(0)}</td>
                          <td className="text-right">{fmtAmount(r.GLOSS)}</td>
                          <td className="text-right">{fmtAmount(0)}</td>
                        </tr>
                        <tr className="stock-sum-grand">
                          <td><strong>TOTAL</strong></td>
                          <td className="text-right"><strong>{fmtWeight(0)}</strong></td>
                          <td className="text-right"><strong>{fmtAmount(lTotal)}</strong></td>
                          <td className="text-right"><strong>{fmtAmount(0)}</strong></td>
                          <td><strong>TOTAL</strong></td>
                          <td className="text-right"><strong>{fmtWeight(0)}</strong></td>
                          <td className="text-right"><strong>{fmtAmount(rTotal)}</strong></td>
                          <td className="text-right"><strong>{fmtAmount(0)}</strong></td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                  {expenseRows.map((r, idx) => (
                    <tr
                      key={`exp_item_${idx}_${r.A_CODE || r.NAME || idx}`}
                      className="sale-list-row-clickable"
                      onClick={() => openLedger(r)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openLedger(r);
                        }
                      }}
                    >
                      <td>{String(r.NAME || '').trim()}</td>
                      <td className="text-right">{fmtWeight(0)}</td>
                      <td className="text-right">{fmtAmount(r.DR_AMT)}</td>
                      <td className="text-right">{fmtAmount(0)}</td>
                      <td />
                      <td className="text-right">{fmtWeight(0)}</td>
                      <td className="text-right">{fmtAmount(r.CR_AMT)}</td>
                      <td className="text-right">{fmtAmount(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="trading-summary">
              <h3>Summary</h3>
              <table className="report-table trading-ac-layout">
                <thead>
                  <tr>
                    <th>Particulars</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Avg.Rate</th>
                    <th>Particulars</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Avg.Rate</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>OPENING</td>
                    <td className="text-right">{fmtAmount(summary.opening)}</td>
                    <td className="text-right">0.00</td>
                    <td>SALES</td>
                    <td className="text-right">{fmtAmount(summary.sales)}</td>
                    <td className="text-right">{fmtAmount(summary.salesRate)}</td>
                  </tr>
                  <tr>
                    <td>PURCHASE</td>
                    <td className="text-right">{fmtAmount(summary.purchase)}</td>
                    <td className="text-right">{fmtAmount(summary.purchaseRate)}</td>
                    <td>CL.STOCK</td>
                    <td className="text-right">{fmtAmount(summary.closing)}</td>
                    <td className="text-right">0.00</td>
                  </tr>
                  <tr>
                    <td>DIRECT EXP.</td>
                    <td className="text-right">{fmtAmount(summary.directExp)}</td>
                    <td className="text-right">0.00</td>
                    <td>DIREC IT INCOME</td>
                    <td className="text-right">{fmtAmount(summary.directInc)}</td>
                    <td className="text-right">0.00</td>
                  </tr>
                  <tr className="stock-sum-grand">
                    <td>G.TOTAL</td>
                    <td className="text-right">{fmtAmount(summary.leftTotal)}</td>
                    <td className="text-right" />
                    <td>G.TOTAL</td>
                    <td className="text-right">{fmtAmount(summary.rightTotal)}</td>
                    <td className="text-right" />
                  </tr>
                  <tr className="stock-sum-grand">
                    <td>TOTAL GROSS PROFIT/LOSS</td>
                    <td className="text-right">{fmtAmount(summary.grossProfitLoss)}</td>
                    <td className="text-right" />
                    <td />
                    <td className="text-right" />
                    <td className="text-right" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="stock-sum-empty">No trading rows found for selected filters.</p>
        )}
      </div>
    );
  }

  if (screen === 'ledger') {
    const cols = ['VR_TYPE', 'VR_DATE', 'VR_NO', 'TYPE', 'R_QNTY', 'R_WEIGHT', 'DR_AMOUNT', 'S_QNTY', 'S_WEIGHT', 'CR_AMOUNT', 'BAL_QNTY', 'BAL_WEIGHT', 'CL_BALANCE'];
    return (
      <div className="slide slide-report slide-17">
        <div className="report-toolbar">
          <h2>Trading Ledger</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="trading-ac" />
            
            <button type="button" className={`btn btn-secondary ${ledgerView === 'entry' ? 'is-active' : ''}`} onClick={() => setLedgerView('entry')}>
              Entry Wise
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${ledgerView === 'date' ? 'is-active' : ''}`}
              onClick={() => {
                setLedgerEntryFilter({ kind: 'all', value: '' });
                setLedgerView('date');
              }}
            >
              Date Wise
            </button>
            <button
              type="button"
              className={`btn btn-secondary ${ledgerView === 'month' ? 'is-active' : ''}`}
              onClick={() => {
                setLedgerEntryFilter({ kind: 'all', value: '' });
                setLedgerView('month');
              }}
            >
              Month Wise
            </button>
            <button type="button" className="btn btn-excel" onClick={exportLedgerExcel} disabled={!ledgerRows.length}>
              📊 Excel
            </button>
            <button type="button" className="btn btn-export" onClick={exportLedgerPdf} disabled={!ledgerRows.length}>
              Pdf
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareLedgerWhatsapp} disabled={!ledgerRows.length}>
              💬 WhatsApp
            </button>
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('report')}>
              ← Back
            </button>
          </div>
        </div>
        <div className="report-info">
          <p><strong>{ledgerTitle}</strong></p>
          <p>{compName} | FY {compYear} | As on {toDisplayDate(edt)}</p>
        </div>
        {error ? <div className="form-api-error">{error}</div> : null}
        <div className="report-display table-responsive">
          <table className="report-table report-table--voucher-list report-table--trading-ledger">
            <thead>
              <tr>{cols.map((c) => <th key={c} className={ledgerNumericColumns.has(c) ? 'text-right' : ''}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {groupedLedgerRows.map((row, idx) => {
                const rowKey = `${ledgerView}|${row?._rowType || 'data'}|${row?._sourceDate || ''}|${row?._sourceMonth || ''}|${row?.VR_TYPE || ''}|${row?.VR_DATE || ''}|${row?.VR_NO || ''}|${row?.TYPE || ''}`;
                const baseClass =
                  ledgerView !== 'entry'
                    ? 'trading-ledger-row trading-ledger-row--summary-click'
                    : row?._rowType === 'total'
                      ? 'stock-sum-grand'
                      : String(row?.VR_TYPE || '').trim().toUpperCase() === 'PU'
                        ? 'trading-ledger-row trading-ledger-row--pu'
                        : String(row?.VR_TYPE || '').trim().toUpperCase() === 'SL'
                          ? 'trading-ledger-row trading-ledger-row--sl'
                          : String(row?.VR_TYPE || '').trim().toUpperCase() === 'CN'
                            ? 'trading-ledger-row trading-ledger-row--cn'
                            : 'trading-ledger-row';
                const rowClass = `${baseClass}${selectedLedgerRowKey === rowKey ? ' trading-ledger-row--active' : ''}`;
                return (
                <tr
                  key={idx}
                  onClick={() => {
                    setSelectedLedgerRowKey(rowKey);
                    if (ledgerView === 'date' && row?._sourceDate) {
                      setLedgerEntryFilter({ kind: 'date', value: row._sourceDate });
                      setLedgerView('entry');
                    } else if (ledgerView === 'month' && row?._sourceMonth) {
                      setLedgerEntryFilter({ kind: 'month', value: row._sourceMonth });
                      setLedgerView('entry');
                    } else if (ledgerView === 'entry' && row?._rowType !== 'total') {
                      openLedgerVoucherDetail(row);
                    }
                  }}
                  className={rowClass}
                >
                  {row?._rowType === 'total' ? (
                    <>
                      <td colSpan={4}><strong>{row._label}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('R_QNTY', row.R_QNTY)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('R_WEIGHT', row.R_WEIGHT)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('DR_AMOUNT', row.DR_AMOUNT)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('S_QNTY', row.S_QNTY)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('S_WEIGHT', row.S_WEIGHT)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('CR_AMOUNT', row.CR_AMOUNT)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('BAL_QNTY', row.BAL_QNTY)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('BAL_WEIGHT', row.BAL_WEIGHT)}</strong></td>
                      <td className="text-right"><strong>{fmtLedgerNumeric('CL_BALANCE', row.CL_BALANCE)}</strong></td>
                    </>
                  ) : cols.map((c) => (
                    <td key={c} className={ledgerNumericColumns.has(c) ? 'text-right' : ''}>
                      {c === 'VR_DATE'
                        ? formatSlashDate(row[c])
                        : ledgerNumericColumns.has(c)
                          ? fmtLedgerNumeric(c, row[c])
                          : String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              );
              })}
              {effectiveLedgerTotals ? (
                <tr className="stock-sum-grand">
                  <td colSpan={4}><strong>Grand Total</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('R_QNTY', effectiveLedgerTotals.R_QNTY)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('R_WEIGHT', effectiveLedgerTotals.R_WEIGHT)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('DR_AMOUNT', effectiveLedgerTotals.DR_AMOUNT)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('S_QNTY', effectiveLedgerTotals.S_QNTY)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('S_WEIGHT', effectiveLedgerTotals.S_WEIGHT)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('CR_AMOUNT', effectiveLedgerTotals.CR_AMOUNT)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('BAL_QNTY', effectiveLedgerTotals.BAL_QNTY)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('BAL_WEIGHT', effectiveLedgerTotals.BAL_WEIGHT)}</strong></td>
                  <td className="text-right"><strong>{fmtLedgerNumeric('CL_BALANCE', effectiveLedgerTotals.CL_BALANCE)}</strong></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {effectiveLedgerTotals ? (
          <div className="report-info">
            <p>
              <strong>Grand Total:</strong>{' '}
              R_QNTY: {fmtWeight(effectiveLedgerTotals.R_QNTY)} | R_WEIGHT: {fmtWeight(effectiveLedgerTotals.R_WEIGHT)} | DR_AMOUNT:{' '}
              {fmtAmount(effectiveLedgerTotals.DR_AMOUNT)} | S_QNTY: {fmtWeight(effectiveLedgerTotals.S_QNTY)} | S_WEIGHT:{' '}
              {fmtWeight(effectiveLedgerTotals.S_WEIGHT)} | CR_AMOUNT: {fmtAmount(effectiveLedgerTotals.CR_AMOUNT)} | BAL_QNTY:{' '}
              {fmtWeight(effectiveLedgerTotals.BAL_QNTY)} | BAL_WEIGHT: {fmtWeight(effectiveLedgerTotals.BAL_WEIGHT)} | CL_BALANCE:{' '}
              {fmtAmount(effectiveLedgerTotals.CL_BALANCE)}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (screen === 'cat-trial') {
    return (
      <div className="slide slide-report slide-17">
        <div className="report-toolbar">
          <h2>Trial Balance (Category Linked)</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="trading-ac" />
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('report')}>
              ← Back to Trading A/C
            </button>
          </div>
        </div>
        <div className="report-info">
          <p><strong>{catTrialTitle}</strong></p>
          <p>{compName} | FY {compYear} | As on {toDisplayDate(edt)}</p>
        </div>
        {error ? <div className="form-api-error">{error}</div> : null}
        <div className="report-display">
          <ReportTable
            data={catTrialRows}
            type="trial-balance"
            onLedgerClick={(code, name) => openSimpleLedgerByCode(code, name)}
          />
        </div>
      </div>
    );
  }

  if (screen === 'ledger-detail') {
    const detailCols = ['TYPE', 'VR_DATE', 'VR_NO', 'TRN_NO', 'CODE', 'NAME', 'CITY', 'SUP_CODE', 'SUP_NAME', 'ITEM_CODE', 'ITEM_NAME', 'QNTY', 'WEIGHT', 'RATE', 'AMOUNT', 'TAXABLE'];
    return (
      <div className="slide slide-report slide-17">
        <div className="report-toolbar">
          <h2>Trading Voucher Detail</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="trading-ac" />
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setScreen('ledger')}>
              ← Back to Ledger
            </button>
          </div>
        </div>
        <div className="report-info">
          <p><strong>{ledgerTitle}</strong></p>
          <p>{ledgerDetailTitle}</p>
        </div>
        {ledgerDetailError ? <div className="form-api-error">{ledgerDetailError}</div> : null}
        {ledgerDetailLoading ? <p className="stock-sum-empty">Loading voucher details...</p> : null}
        {!ledgerDetailLoading ? (
          <div className="report-display table-responsive">
            <table className="report-table report-table--voucher-list report-table--trading-ledger">
              <thead>
                <tr>{detailCols.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {ledgerDetailRows.map((r, i) => (
                  <tr
                    key={`${i}_${r.TRN_NO || ''}`}
                    className={selectedDetailRowKey === `${i}_${r.TRN_NO || ''}` ? 'trading-ledger-row--active' : ''}
                    onClick={() => setSelectedDetailRowKey(`${i}_${r.TRN_NO || ''}`)}
                  >
                    {detailCols.map((c) => (
                      <td key={c} className={typeof r?.[c] === 'number' ? 'text-right' : ''}>
                        {c === 'VR_DATE'
                          ? formatSlashDate(r?.[c])
                          : c === 'VR_NO' || c === 'TRN_NO'
                            ? Math.trunc(num(r?.[c])).toString()
                          : typeof r?.[c] === 'number'
                            ? (c === 'QNTY' || c === 'WEIGHT' ? fmtWeight(r[c]) : fmtAmount(r[c]))
                            : String(r?.[c] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!ledgerDetailRows.length ? <p className="stock-sum-empty">No detail rows found for selected voucher.</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (screen === 'gl-ledger') {
    const glSaleBillModal = (
      <SaleBillPrintModal
        open={billPrintOpen}
        onClose={() => {
          setBillPrintOpen(false);
          setBillPrintParams(null);
        }}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={billPrintParams}
        companyName={compName}
      />
    );

    if (glVoucherRows != null) {
      return (
        <div className="slide slide-report slide-17">
          <div className="report-toolbar">
            <h2>Voucher entries</h2>
            <div className="toolbar-actions">
            <ReportHelpButton reportId="trading-ac" />
            
              <button type="button" className="btn btn-toolbar-back" onClick={() => setGlVoucherRows(null)}>
                ← Back to ledger
              </button>
              <button
                type="button"
                className="btn btn-excel"
                onClick={() => {
                  try {
                    const tag = String(glVoucherTitle || 'voucher').replace(/\s+/g, '_');
                    downloadExcelRows(glVoucherRows, 'Voucher', `${compName}_${tag}`);
                  } catch (e) {
                    alert(String(e?.message || e));
                  }
                }}
              >
                📊 Excel
              </button>
            </div>
          </div>

          <LedgerReportHeader
            compHeader={compLedgerHeader}
            companyNameFallback={compName}
            account={glLedgerRows[0]}
            accountCodeFallback={glLedgerCode}
            accountNameFallback={glLedgerTitle}
            periodLine={`Financial year ${compYear} · ${toDisplayDate(glLedgerStart)} – ${toDisplayDate(glLedgerEnd)} (Trading A/C as on ${toDisplayDate(glLedgerEnd)})`}
          />
          <p className="ledger-report-voucher-ref">
            Voucher: <strong>{glVoucherTitle}</strong>
          </p>

          <div className="report-display">
            <ReportTable data={glVoucherRows} type="ledger-voucher" />
          </div>

          <div className="button-group">
            <button type="button" onClick={() => setGlVoucherRows(null)} className="btn btn-secondary">
              ← Back to ledger
            </button>
            <button type="button" onClick={backFromGlLedger} className="btn btn-secondary">
              ← Back to Trading A/C
            </button>
          </div>
          {glSaleBillModal}
        </div>
      );
    }

    return (
      <div className="slide slide-report slide-17">
        <div className="report-toolbar">
          <h2>Ledger Report</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="trading-ac" />
            
            <button type="button" className="btn btn-toolbar-back" onClick={backFromGlLedger}>
              ← Back to Trading A/C
            </button>
            <button
              type="button"
              className="btn btn-export"
              onClick={() => generatePDF('ledger', glLedgerRows, glLedgerPdfMeta()).catch((e) => alert(e?.message || String(e)))}
              disabled={!glLedgerRows.length}
            >
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(glLedgerRows, 'Ledger', `${compName}_Ledger_${glLedgerCode || 'account'}`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
              disabled={!glLedgerRows.length}
            >
              📊 Excel
            </button>
            <button
              type="button"
              className="btn btn-whatsapp"
              onClick={() =>
                sharePdfWithWhatsApp(
                  'ledger',
                  glLedgerRows,
                  glLedgerPdfMeta(),
                  [`Ledger Report — ${compName}`, `${compYear} | ${glLedgerTitle} (${glLedgerCode})`, `${toDisplayDate(glLedgerStart)} → ${toDisplayDate(glLedgerEnd)}`].join('\n')
                ).catch((e) => alert(String(e?.message || e)))
              }
              disabled={!glLedgerRows.length}
            >
              💬 WhatsApp
            </button>
          </div>
        </div>

        <LedgerReportHeader
          compHeader={compLedgerHeader}
          companyNameFallback={compName}
          account={glLedgerRows[0]}
          accountCodeFallback={glLedgerCode}
          accountNameFallback={glLedgerTitle}
          periodLine={`Financial year ${compYear} · ${toDisplayDate(glLedgerStart)} – ${toDisplayDate(glLedgerEnd)} (same as Trading A/C period to as-on date)`}
          hint="Tap a row for voucher detail; sale bill print opens where mapping is available."
        />

        <div className="report-display">
          <ReportTable
            data={glLedgerRows}
            type="ledger"
            onVoucherClick={runGlLedgerVoucher}
            onLedgerSaleBillClick={openGlLedgerSaleBill}
          />
        </div>

        <div className="button-group">
          <button type="button" onClick={backFromGlLedger} className="btn btn-secondary">
            ← Back to Trading A/C
          </button>
        </div>
        {glSaleBillModal}
      </div>
    );
  }

  return (
    <div className="slide slide-report slide-17">
      <h2>Trading A/C</h2>
      <p className="company-info">
        {compName} | FY {compYear}
      </p>
      {error ? <div className="form-api-error">{error}</div> : null}

      <form onSubmit={runReport} className="report-form report-form--trading">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group trading-form-row">
          <label>Ending Date</label>
          <span className="trading-form-colon">:</span>
          <input type="date" className="form-input" value={edt} onChange={(e) => setEdt(e.target.value)} required />
        </div>
        <div className="form-group trading-form-row">
          <label>Trading Consolidate / Item Wise</label>
          <span className="trading-form-colon">:</span>
          <select className="form-input" value={tdgType} onChange={(e) => setTdgType(String(e.target.value || 'C').toUpperCase())}>
            <option value="C">Consolidate</option>
            <option value="I">Item Wise</option>
          </select>
        </div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </form>

    </div>
  );
}
