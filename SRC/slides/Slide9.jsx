import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import PurchaseBillPrintModal from '../components/PurchaseBillPrintModal';
import SaleBillPrintModal from '../components/SaleBillPrintModal';

/** Maps Oracle SALE.TYPE (1–9) to print/API letter bucket (same as Slide13). */
const SALE_LIST_NUMTYPE_TO_PRINT = {
  1: 'SL',
  2: 'CH',
  3: 'SL',
  4: 'SL',
  5: 'SL',
  6: 'SE',
  7: 'SL',
  8: 'CN',
  9: 'RC',
};

function purchaseModalLabel(typeRaw) {
  const t = String(typeRaw ?? '').trim().toUpperCase();
  if (t === 'DN') return 'DEBIT NOTE';
  return 'PURCHASE BILL';
}

function stockTypeToJobworkMtype(stockType) {
  const u = String(stockType ?? '').trim().toUpperCase();
  if (u === 'JR') return 'R';
  if (u === 'JI') return 'I';
  if (u === 'RR') return 'Y';
  if (u === 'RI') return 'X';
  return '';
}

function printTypeForOracleNum(num) {
  if (!Number.isFinite(num)) return 'SL';
  return SALE_LIST_NUMTYPE_TO_PRINT[num] || 'SL';
}

/** Map ledger display “—” / hyphen to single space for SALE/PUR/JOBWORK binds. */
function normalizeLedgerBTypeForBill(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '-' || s === '—' || s === '–' || s === '.') return ' ';
  return s;
}

/** Purchase / sale print modals must stack above full-screen stock ledger panels. */
const STOCK_SUM_BILL_MODAL_Z = 1250;

function num(row, upper, lower) {
  const v = row?.[upper] ?? row?.[lower];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function fmtWt(val) {
  const x = parseFloat(val) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(val) {
  const x = parseFloat(val);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

export default function Slide9({ apiBase, formData, onPrev, onReset }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [plantCode, setPlantCode] = useState('');
  const [catCode, setCatCode] = useState('');
  const [rf, setRf] = useState('');
  const [items, setItems] = useState([]);
  const [plants, setPlants] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReport, setShowReport] = useState(false);
  /** summary → item-wise stock sum; ledger → vouchers for one item; ledgerDetail → prod/jobwork drill-down */
  const [stockPanel, setStockPanel] = useState('summary');
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState('');
  const [ledgerMeta, setLedgerMeta] = useState(null);

  const [ledgerEntryLoading, setLedgerEntryLoading] = useState(false);
  const [ledgerEntryError, setLedgerEntryError] = useState('');
  const [ledgerEntryRows, setLedgerEntryRows] = useState([]);
  const [ledgerEntryTitle, setLedgerEntryTitle] = useState('');
  const [ledgerEntryKind, setLedgerEntryKind] = useState('');

  const [purchaseBillOpen, setPurchaseBillOpen] = useState(false);
  const [purchaseBillParams, setPurchaseBillParams] = useState(null);
  const [saleBillOpen, setSaleBillOpen] = useState(false);
  const [saleBillParams, setSaleBillParams] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const s = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
    const e = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);
    if (s) setStartDate(s);
    if (e) setEndDate(e);
  }, [formData.comp_s_dt, formData.COMP_S_DT, formData.comp_e_dt, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    let cancel = false;
    (async () => {
      try {
        const [itemRes, plantRes] = await Promise.all([
          axios.get(`${apiBase}/api/stock-sum-items`, {
            params: { comp_code: compCode, comp_uid: compUid },
            withCredentials: true,
            timeout: 120000,
          }),
          axios.get(`${apiBase}/api/stock-sum-plants`, {
            params: { comp_code: compCode, comp_uid: compUid },
            withCredentials: true,
            timeout: 120000,
          }),
        ]);
        if (cancel) return;
        setItems(Array.isArray(itemRes.data) ? itemRes.data : []);
        setPlants(Array.isArray(plantRes.data) ? plantRes.data : []);
      } catch {
        if (cancel) return;
      }
    })();
    return () => {
      cancel = true;
    };
  }, [apiBase, compCode, compUid]);

  const itemLabel = useMemo(() => {
    const hit = items.find((x) => String(x.ITEM_CODE ?? x.item_code ?? '') === String(itemCode));
    if (!hit) return itemCode || 'All';
    return `${hit.ITEM_NAME ?? hit.item_name ?? ''} (${hit.ITEM_CODE ?? hit.item_code ?? ''})`;
  }, [itemCode, items]);

  const pdfMetaSummary = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(startDate),
      endDate: toDisplayDate(endDate),
      itemLabel,
      plantLabel: plantCode || 'All',
      catLabel: catCode || 'All',
      rfLabel: rf || 'All',
    }),
    [compName, startDate, endDate, itemLabel, plantCode, catCode, rf]
  );

  const summaryPdfData = useMemo(() => ({ rows }), [rows]);
  const summaryTotals = useMemo(() => {
    let purWt = 0;
    let prodWt = 0;
    let jbWt = 0;
    let jiWt = 0;
    let millingWt = 0;
    let saleWt = 0;
    let cnoteWt = 0;
    let clWt = 0;
    let opBal = 0;
    for (const r of rows) {
      opBal += num(r, 'OP_BALANCE', 'op_balance');
      purWt += num(r, 'PUR_WT', 'pur_wt');
      prodWt += num(r, 'PROD_WT', 'prod_wt');
      jbWt += num(r, 'JB_WT', 'jb_wt');
      jiWt += num(r, 'JI_WT', 'ji_wt');
      millingWt += num(r, 'MILLING_WT', 'milling_wt');
      saleWt += num(r, 'SALE_WT', 'sale_wt');
      cnoteWt += num(r, 'CNOTE_WT', 'cnote_wt');
      clWt += num(r, 'CL_WT', 'cl_wt');
    }
    return { opBal, purWt, prodWt, jbWt, jiWt, millingWt, saleWt, cnoteWt, clWt };
  }, [rows]);

  const ledgerTotals = useMemo(() => {
    let purWt = 0;
    let prodWt = 0;
    let jbWt = 0;
    let jiWt = 0;
    let millingWt = 0;
    let saleWt = 0;
    let cnoteWt = 0;
    let clBal = 0;
    for (const r of ledgerRows) {
      purWt += num(r, 'PUR_WT', 'pur_wt');
      prodWt += num(r, 'PROD_WT', 'prod_wt');
      jbWt += num(r, 'JB_WT', 'jb_wt');
      jiWt += num(r, 'JI_WT', 'ji_wt');
      millingWt += num(r, 'MILLING_WT', 'milling_wt');
      saleWt += num(r, 'SALE_WT', 'sale_wt');
      cnoteWt += num(r, 'CNOTE_WT', 'cnote_wt');
      clBal = num(r, 'CL_BAL', 'cl_bal');
    }
    return { purWt, prodWt, jbWt, jiWt, millingWt, saleWt, cnoteWt, clBal };
  }, [ledgerRows]);

  const itemWiseDisplayRows = useMemo(() => {
    const out = [];
    let curItem = '';
    let acc = null;
    const flush = () => {
      if (!acc) return;
      out.push({ kind: 'item-total', itemCode: curItem, ...acc });
      acc = null;
    };
    for (const r of rows) {
      const code = String(r.ITEM_CODE ?? r.item_code ?? '').trim();
      if (code !== curItem) {
        flush();
        curItem = code;
        acc = {
          purWt: 0,
          opBal: 0,
          prodWt: 0,
          jbWt: 0,
          jiWt: 0,
          millingWt: 0,
          saleWt: 0,
          cnoteWt: 0,
          clWt: 0,
        };
      }
      out.push({ kind: 'row', row: r });
      acc.opBal += num(r, 'OP_BALANCE', 'op_balance');
      acc.purWt += num(r, 'PUR_WT', 'pur_wt');
      acc.prodWt += num(r, 'PROD_WT', 'prod_wt');
      acc.jbWt += num(r, 'JB_WT', 'jb_wt');
      acc.jiWt += num(r, 'JI_WT', 'ji_wt');
      acc.millingWt += num(r, 'MILLING_WT', 'milling_wt');
      acc.saleWt += num(r, 'SALE_WT', 'sale_wt');
      acc.cnoteWt += num(r, 'CNOTE_WT', 'cnote_wt');
      acc.clWt += num(r, 'CL_WT', 'cl_wt');
    }
    flush();
    return out;
  }, [rows]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!compCode || !compUid) {
      alert('Missing company or schema.');
      return;
    }
    const sOracle = toOracleDate(startDate);
    const eOracle = toOracleDate(endDate);
    if (!sOracle || !eOracle) {
      alert('Please choose starting and ending dates.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/stock-sum`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: sOracle,
          e_date: eOracle,
          item_code: itemCode.trim(),
          plant_code: plantCode.trim(),
          cat_code: catCode.trim(),
          r_f: rf.trim(),
        },
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data) ? data : []);
      setStockPanel('summary');
      setShowReport(true);
    } catch (err) {
      console.error(err);
      const st = err.response?.status;
      setError(
        st === 404
          ? `No /api/stock-sum on ${formatApiOrigin(apiBase)}. Restart the API server with the latest server.cjs.`
          : err.response?.data?.error || err.message || 'Request failed'
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadSummaryPdf = () =>
    generatePDF('stock-sum', summaryPdfData, pdfMetaSummary).catch((err) => alert(String(err?.message || err)));

  const shareSummaryWa = () =>
    sharePdfWithWhatsApp(
      'stock-sum',
      summaryPdfData,
      pdfMetaSummary,
      ['Stock sum', compName, `${pdfMetaSummary.startDate} - ${pdfMetaSummary.endDate}`, itemLabel].join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const openStockLedger = async (r) => {
    const sOracle = toOracleDate(startDate);
    const eOracle = toOracleDate(endDate);
    if (!sOracle || !eOracle) return;
    const iCode = String(r.ITEM_CODE ?? r.item_code ?? '').trim();
    const pCode = String(r.PLANT_CODE ?? r.plant_code ?? '').trim();
    setLedgerMeta({
      itemCode: iCode,
      itemName: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
      plantCode: pCode,
    });
    setStockPanel('ledger');
    setLedgerLoading(true);
    setLedgerError('');
    setLedgerRows([]);
    try {
      const { data } = await axios.get(`${apiBase}/api/stock-sum-ledger`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: sOracle,
          e_date: eOracle,
          item_code: iCode,
          plant_code: pCode,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setLedgerRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setLedgerError(err.response?.data?.error || err.message || 'Failed to load stock ledger');
    } finally {
      setLedgerLoading(false);
    }
  };

  const ledgerPdfMeta = useMemo(
    () => ({
      companyName: compName,
      startDate: toDisplayDate(startDate),
      endDate: toDisplayDate(endDate),
      itemCode: ledgerMeta?.itemCode || '',
      itemName: ledgerMeta?.itemName || '',
      plantCode: ledgerMeta?.plantCode || '',
    }),
    [compName, startDate, endDate, ledgerMeta]
  );

  const ledgerPdfData = useMemo(() => ({ rows: ledgerRows }), [ledgerRows]);

  const downloadLedgerPdf = () =>
    generatePDF('stock-sum-ledger', ledgerPdfData, ledgerPdfMeta).catch((err) => alert(String(err?.message || err)));

  const shareLedgerWa = () =>
    sharePdfWithWhatsApp(
      'stock-sum-ledger',
      ledgerPdfData,
      ledgerPdfMeta,
      ['Stock ledger', ledgerMeta?.itemCode, ledgerMeta?.itemName, compName].filter(Boolean).join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const goBackFromLedgerDetail = () => {
    setStockPanel('ledger');
    setLedgerEntryRows([]);
    setLedgerEntryTitle('');
    setLedgerEntryKind('');
    setLedgerEntryError('');
    setLedgerEntryLoading(false);
  };

  const ledgerEntryPdfMeta = useMemo(
    () => ({
      companyName: compName,
      title: ledgerEntryTitle,
      entryKind: ledgerEntryKind,
      itemCode: ledgerMeta?.itemCode || '',
      plantCode: ledgerMeta?.plantCode || '',
    }),
    [compName, ledgerEntryTitle, ledgerEntryKind, ledgerMeta]
  );

  const ledgerEntryPdfData = useMemo(
    () => ({ rows: ledgerEntryRows, entryKind: ledgerEntryKind }),
    [ledgerEntryRows, ledgerEntryKind]
  );

  const downloadLedgerEntryPdf = () =>
    generatePDF('stock-sum-ledger-entry', ledgerEntryPdfData, ledgerEntryPdfMeta).catch((err) =>
      alert(String(err?.message || err))
    );

  const shareLedgerEntryWa = () =>
    sharePdfWithWhatsApp(
      'stock-sum-ledger-entry',
      ledgerEntryPdfData,
      ledgerEntryPdfMeta,
      [ledgerEntryTitle, ledgerMeta?.itemCode, compName].filter(Boolean).join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const onLedgerRowActivate = async (lr) => {
    if (!lr || !compCode || !compUid) return;
    const typ = String(lr.TYPE ?? lr.type ?? '').trim().toUpperCase();
    const ymd = toInputDateString(lr.VR_DATE ?? lr.vr_date);
    const oracleDt = toOracleDate(ymd);
    const vrNo = String(lr.VR_NO ?? lr.vr_no ?? '').trim();
    const bTypeStr = normalizeLedgerBTypeForBill(lr.B_TYPE ?? lr.b_type);

    if (typ === 'PR' || typ === 'PI') {
      if (!oracleDt || !vrNo) {
        alert('Missing voucher date or number for production detail.');
        return;
      }
      setLedgerEntryTitle(`Production (${typ}) — ${vrNo} / ${toDisplayDate(ymd)}`);
      setLedgerEntryKind('prod');
      setStockPanel('ledgerDetail');
      setLedgerEntryLoading(true);
      setLedgerEntryError('');
      setLedgerEntryRows([]);
      try {
        const { data } = await axios.get(`${apiBase}/api/stock-sum-ledger-prod`, {
          params: { comp_code: compCode, comp_uid: compUid, vr_date: oracleDt, vr_no: vrNo },
          withCredentials: true,
          timeout: 120000,
        });
        setLedgerEntryRows(Array.isArray(data) ? data : []);
      } catch (err) {
        setLedgerEntryError(err.response?.data?.error || err.message || 'Failed to load production lines');
      } finally {
        setLedgerEntryLoading(false);
      }
      return;
    }

    if (typ === 'JR' || typ === 'JI' || typ === 'RR' || typ === 'RI') {
      const mtype = stockTypeToJobworkMtype(typ);
      if (!oracleDt || !vrNo || !mtype) {
        alert('Missing voucher date, number, or jobwork type mapping.');
        return;
      }
      setLedgerEntryTitle(`Jobwork (${typ} → ${mtype}) — ${vrNo} / ${toDisplayDate(ymd)} · B type ${bTypeStr.trim() || '—'}`);
      setLedgerEntryKind('jobwork');
      setStockPanel('ledgerDetail');
      setLedgerEntryLoading(true);
      setLedgerEntryError('');
      setLedgerEntryRows([]);
      try {
        const { data } = await axios.get(`${apiBase}/api/stock-sum-ledger-jobwork`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            mtype,
            r_date: oracleDt,
            r_no: vrNo,
            b_type: bTypeStr,
          },
          withCredentials: true,
          timeout: 120000,
        });
        setLedgerEntryRows(Array.isArray(data) ? data : []);
      } catch (err) {
        setLedgerEntryError(err.response?.data?.error || err.message || 'Failed to load jobwork lines');
      } finally {
        setLedgerEntryLoading(false);
      }
      return;
    }

    if (typ === 'PU' || typ === 'DN') {
      if (!oracleDt || !vrNo) {
        alert('Cannot open purchase bill: missing date or voucher number.');
        return;
      }
      const head = purchaseModalLabel(typ);
      setPurchaseBillParams({
        type: typ,
        rNo: vrNo,
        oracleDt,
        label: `${head} — ${typ} / ${vrNo} / ${toDisplayDate(ymd)}`,
      });
      setPurchaseBillOpen(true);
      return;
    }

    if (typ === 'S' || typ === 'CN' || typ === 'Y' || typ === 'W') {
      if (!oracleDt || !vrNo) {
        alert('Cannot open sale bill: missing date or bill number.');
        return;
      }
      const rawTyp = String(lr.TYPE ?? lr.type ?? '').trim();
      const ptypeNum = parseInt(rawTyp, 10);
      const printType =
        Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9
          ? printTypeForOracleNum(ptypeNum)
          : rawTyp.toUpperCase() === 'S'
            ? 'S'
            : rawTyp.toUpperCase();
      setSaleBillParams({
        type: printType,
        ...(Number.isFinite(ptypeNum) && ptypeNum >= 1 && ptypeNum <= 9 ? { oracleTypeNum: ptypeNum } : {}),
        billNo: vrNo,
        bType: bTypeStr,
        oracleDt,
        compYear: String(compYear ?? '').trim(),
        label: `Sale bill — ${rawTyp} / ${vrNo} / ${toDisplayDate(ymd)}`,
        relaxBillDate: true,
      });
      setSaleBillOpen(true);
    }
  };

  if (showReport) {
    return (
      <div className="slide slide-report slide-9">
        <PurchaseBillPrintModal
          open={purchaseBillOpen}
          onClose={() => {
            setPurchaseBillOpen(false);
            setPurchaseBillParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={purchaseBillParams}
          companyName={compName}
          backdropZIndex={STOCK_SUM_BILL_MODAL_Z}
        />
        <SaleBillPrintModal
          open={saleBillOpen}
          onClose={() => {
            setSaleBillOpen(false);
            setSaleBillParams(null);
          }}
          apiBase={apiBase}
          compCode={compCode}
          compUid={compUid}
          billParams={saleBillParams}
          companyName={compName}
          backdropZIndex={STOCK_SUM_BILL_MODAL_Z}
        />

        {stockPanel === 'summary' ? (
          <>
        <div className="report-toolbar">
          <h2>Stock sum</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={downloadSummaryPdf}>
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(rows, 'StockSum', `${compName}_StockSum`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareSummaryWa}>
              💬 WhatsApp
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>Date</strong> {toDisplayDate(startDate)} – {toDisplayDate(endDate)} · <strong>Item</strong> {itemLabel}
          </p>
          <p>
            {compName} | FY {compYear} · <strong>Plant</strong> {plantCode || 'All'} · <strong>Cat</strong> {catCode || 'All'} ·{' '}
            <strong>R/F</strong> {rf || 'All'}
          </p>
        </div>

        <div className="report-display table-responsive">
          <table className="report-table stock-sum-table">
            <thead>
              <tr>
                <th>MC</th>
                <th>Cat</th>
                <th>Item</th>
                <th>Name</th>
                <th>Plant</th>
                <th>R/F</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>
                  Op bal
                </th>
                <th className="text-right stock-sum-pur-force" style={{ textAlign: 'right', paddingRight: '6px' }}>
                  <span style={{ float: 'right' }}>Pur wt</span>
                </th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>Prod wt</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>JB wt</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>JI wt</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>Milling wt</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>Sale wt</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>CNote wt</th>
                <th className="text-right" style={{ textAlign: 'right', paddingRight: '6px' }}>CL wt</th>
              </tr>
            </thead>
            <tbody>
              {itemWiseDisplayRows.map((x, i) =>
                x.kind === 'row' ? (
                  <tr
                    key={`r-${i}`}
                    className="stock-sum-row-clickable"
                    onClick={() => openStockLedger(x.row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openStockLedger(x.row);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td>{x.row.MAIN_CAT ?? x.row.main_cat ?? '—'}</td>
                    <td>{x.row.CAT_CODE ?? x.row.cat_code ?? '—'}</td>
                    <td className="bill-code">{x.row.ITEM_CODE ?? x.row.item_code ?? '—'}</td>
                    <td className="ledger-detail">{x.row.ITEM_NAME ?? x.row.item_name ?? '—'}</td>
                    <td>{x.row.PLANT_CODE ?? x.row.plant_code ?? '—'}</td>
                    <td>{x.row.R_F ?? x.row.r_f ?? '—'}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'OP_BALANCE', 'op_balance'))}</td>
                    <td className="text-right" style={{ textAlign: 'right' }}>
                      <span className="stock-sum-num">{fmtWt(num(x.row, 'PUR_WT', 'pur_wt'))}</span>
                    </td>
                    <td className="text-right">{fmtWt(num(x.row, 'PROD_WT', 'prod_wt'))}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'JB_WT', 'jb_wt'))}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'JI_WT', 'ji_wt'))}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'MILLING_WT', 'milling_wt'))}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'SALE_WT', 'sale_wt'))}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'CNOTE_WT', 'cnote_wt'))}</td>
                    <td className="text-right">{fmtWt(num(x.row, 'CL_WT', 'cl_wt'))}</td>
                  </tr>
                ) : (
                  <tr key={`t-${i}`} className="stock-sum-item-total">
                    <td colSpan={6}>
                      <strong>Item total ({x.itemCode || '—'})</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.opBal)}</strong>
                    </td>
                    <td className="text-right" style={{ textAlign: 'right' }}>
                      <strong className="stock-sum-num">{fmtWt(x.purWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.prodWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.jbWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.jiWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.millingWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.saleWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.cnoteWt)}</strong>
                    </td>
                    <td className="text-right">
                      <strong>{fmtWt(x.clWt)}</strong>
                    </td>
                  </tr>
                )
              )}
              {rows.length > 0 ? (
                <tr className="stock-sum-grand">
                  <td colSpan={6}>
                    <strong>Grand total</strong>
                  </td>
                  <td className="text-right">
                      <strong>{fmtWt(summaryTotals.opBal)}</strong>
                    </td>
                    <td className="text-right" style={{ textAlign: 'right' }}>
                      <strong className="stock-sum-num">{fmtWt(summaryTotals.purWt)}</strong>
                    </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.prodWt)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.jbWt)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.jiWt)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.millingWt)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.saleWt)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.cnoteWt)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.clWt)}</strong>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {rows.length === 0 ? <p className="stock-sum-empty">No rows returned.</p> : null}
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Back
          </button>
        </div>
          </>
        ) : null}

        {stockPanel === 'ledger' ? (
          <>
            <div className="report-toolbar">
              <h2 className="stock-panel-title">
                Stock ledger — {ledgerMeta?.itemCode || ''} {ledgerMeta?.itemName ? `· ${ledgerMeta.itemName}` : ''}{' '}
                {ledgerMeta?.plantCode ? `· Plant ${ledgerMeta.plantCode}` : ''}
              </h2>
              <div className="toolbar-actions">
                <button type="button" className="btn btn-toolbar-back" onClick={() => setStockPanel('summary')}>
                  ← Stock sum
                </button>
                <button type="button" className="btn btn-export" onClick={downloadLedgerPdf}>
                  Pdf
                </button>
                <button
                  type="button"
                  className="btn btn-excel"
                  onClick={() => {
                    try {
                      downloadExcelRows(
                        ledgerRows,
                        'StockLedger',
                        `${compName}_StockLedger_${ledgerMeta?.itemCode || 'item'}_${ledgerMeta?.plantCode || 'all'}`
                      );
                    } catch (e) {
                      alert(String(e?.message || e));
                    }
                  }}
                >
                  📊 Excel
                </button>
                <button type="button" className="btn btn-whatsapp" onClick={shareLedgerWa}>
                  💬 WhatsApp
                </button>
              </div>
            </div>
            <div className="report-info">
              <p>
                <strong>Period</strong> {toDisplayDate(startDate)} – {toDisplayDate(endDate)}
              </p>
              <p>
                {compName} | FY {compYear} · Tap a row for voucher detail or purchase/sale bill.
              </p>
            </div>
            {ledgerLoading ? <p>Loading…</p> : null}
            {ledgerError ? (
              <p className="form-api-error" role="alert">
                {ledgerError}
              </p>
            ) : null}
            {!ledgerLoading && !ledgerError ? (
              <div className="report-display table-responsive">
                <table className="report-table stock-sum-detail-table">
                  <thead>
                    <tr>
                      <th>VR Date</th>
                      <th>VR No</th>
                      <th>Type</th>
                      <th>B Type</th>
                      <th className="text-right">Pur wt</th>
                      <th className="text-right">Prod wt</th>
                      <th className="text-right">JB wt</th>
                      <th className="text-right">JI wt</th>
                      <th className="text-right">Milling wt</th>
                      <th className="text-right">Sale wt</th>
                      <th className="text-right">CNote wt</th>
                      <th className="text-right">CL balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((lr, idx) => (
                      <tr
                        key={`${idx}-${lr.VR_NO ?? lr.vr_no ?? ''}`}
                        className="stock-sum-row-clickable stock-sum-ledger-row-click"
                        tabIndex={0}
                        role="button"
                        onClick={() => onLedgerRowActivate(lr)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onLedgerRowActivate(lr);
                          }
                        }}
                      >
                        <td>{formatLedgerDateDisplay(lr.VR_DATE ?? lr.vr_date)}</td>
                        <td>{lr.VR_NO ?? lr.vr_no ?? '—'}</td>
                        <td>{lr.TYPE ?? lr.type ?? '—'}</td>
                        <td>{lr.B_TYPE ?? lr.b_type ?? '—'}</td>
                        <td className="text-right">{fmtWt(num(lr, 'PUR_WT', 'pur_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'PROD_WT', 'prod_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'JB_WT', 'jb_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'JI_WT', 'ji_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'MILLING_WT', 'milling_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'SALE_WT', 'sale_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'CNOTE_WT', 'cnote_wt'))}</td>
                        <td className="text-right">{fmtWt(num(lr, 'CL_BAL', 'cl_bal'))}</td>
                      </tr>
                    ))}
                    {ledgerRows.length > 0 ? (
                      <tr className="stock-sum-grand">
                        <td colSpan={4}>
                          <strong>Grand total</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.purWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.prodWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.jbWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.jiWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.millingWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.saleWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.cnoteWt)}</strong>
                        </td>
                        <td className="text-right">
                          <strong>{fmtWt(ledgerTotals.clBal)}</strong>
                        </td>
                      </tr>
                    ) : null}
                    {ledgerRows.length === 0 ? (
                      <tr>
                        <td colSpan={12}>No stock ledger rows found.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={() => setStockPanel('summary')}>
                ← Stock sum
              </button>
            </div>
          </>
        ) : null}

        {stockPanel === 'ledgerDetail' ? (
          <>
            <div className="report-toolbar stock-ledger-detail-toolbar">
              <h2 className="stock-panel-title stock-ledger-detail-title">{ledgerEntryTitle}</h2>
              <div className="toolbar-actions">
                <button type="button" className="btn btn-toolbar-back" onClick={goBackFromLedgerDetail}>
                  ← Stock ledger
                </button>
                <button type="button" className="btn btn-export" onClick={downloadLedgerEntryPdf}>
                  Pdf
                </button>
                <button
                  type="button"
                  className="btn btn-excel"
                  onClick={() => {
                    try {
                      downloadExcelRows(
                        ledgerEntryRows,
                        ledgerEntryKind === 'jobwork' ? 'StockLedgerJobwork' : 'StockLedgerProd',
                        `${compName}_Ledger_${ledgerMeta?.itemCode || 'item'}_${ledgerEntryKind || 'detail'}`
                      );
                    } catch (e) {
                      alert(String(e?.message || e));
                    }
                  }}
                >
                  📊 Excel
                </button>
                <button type="button" className="btn btn-whatsapp" onClick={shareLedgerEntryWa}>
                  💬 WhatsApp
                </button>
              </div>
            </div>
            <div className="report-info">
              <p>
                {compName} | FY {compYear} · <strong>Item</strong> {ledgerMeta?.itemCode || '—'} · <strong>Plant</strong>{' '}
                {ledgerMeta?.plantCode || '—'}
              </p>
            </div>
            <div className="report-display table-responsive">
              {ledgerEntryLoading ? <p>Loading…</p> : null}
              {ledgerEntryError ? (
                <p className="form-api-error" role="alert">
                  {ledgerEntryError}
                </p>
              ) : null}
              {!ledgerEntryLoading && !ledgerEntryError && ledgerEntryKind === 'prod' ? (
                <table className="report-table stock-sum-detail-table">
                  <thead>
                    <tr>
                      <th>S date</th>
                      <th>S no</th>
                      <th>Trn</th>
                      <th>Plant</th>
                      <th>Item</th>
                      <th>Item name (in)</th>
                      <th className="text-right">M qnty</th>
                      <th>M status</th>
                      <th className="text-right">M wt</th>
                      <th>Out code</th>
                      <th>Out name</th>
                      <th className="text-right">Prod %</th>
                      <th className="text-right">Prod qnty</th>
                      <th className="text-right">Prod wt</th>
                      <th className="text-right">Short</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntryRows.map((r, i) => (
                      <tr key={`p-${i}`}>
                        <td>{formatLedgerDateDisplay(r.S_DATE ?? r.s_date)}</td>
                        <td>{r.S_NO ?? r.s_no ?? '—'}</td>
                        <td>{r.TRN_NO ?? r.trn_no ?? '—'}</td>
                        <td>{r.PLANT_CODE ?? r.plant_code ?? '—'}</td>
                        <td>{r.ITEM ?? r.item ?? '—'}</td>
                        <td className="ledger-detail">{r.ITEM_NAME_IN ?? r.item_name_in ?? '—'}</td>
                        <td className="text-right">{fmtQty(r.M_QNTY ?? r.m_qnty)}</td>
                        <td>{r.M_STATUS ?? r.m_status ?? '—'}</td>
                        <td className="text-right">{fmtWt(r.M_WEIGHT ?? r.m_weight)}</td>
                        <td>{r.ITEM_CODE ?? r.item_code ?? '—'}</td>
                        <td className="ledger-detail">{r.ITEM_NAME_CODE ?? r.item_name_code ?? '—'}</td>
                        <td className="text-right">{fmtQty(r.PROD_PER ?? r.prod_per)}</td>
                        <td className="text-right">{fmtQty(r.PROD_QNTY ?? r.prod_qnty)}</td>
                        <td className="text-right">{fmtWt(r.PROD_WEIGHT ?? r.prod_weight)}</td>
                        <td className="text-right">{fmtWt(r.SHORT ?? r.short)}</td>
                      </tr>
                    ))}
                    {ledgerEntryRows.length === 0 ? (
                      <tr>
                        <td colSpan={15}>No production lines for this voucher.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}
              {!ledgerEntryLoading && !ledgerEntryError && ledgerEntryKind === 'jobwork' ? (
                <table className="report-table stock-sum-detail-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>R date</th>
                      <th>R no</th>
                      <th>B type</th>
                      <th>Trn</th>
                      <th>Item</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Weight</th>
                      <th className="text-right">Rate</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerEntryRows.map((r, i) => (
                      <tr key={`j-${i}`}>
                        <td>{r.TYPE ?? r.type ?? '—'}</td>
                        <td>{formatLedgerDateDisplay(r.R_DATE ?? r.r_date)}</td>
                        <td>{r.R_NO ?? r.r_no ?? '—'}</td>
                        <td>{r.B_TYPE ?? r.b_type ?? '—'}</td>
                        <td>{r.TRN_NO ?? r.trn_no ?? '—'}</td>
                        <td>{r.ITEM_CODE ?? r.item_code ?? '—'}</td>
                        <td className="ledger-detail">{r.ITEM_NAME ?? r.item_name ?? '—'}</td>
                        <td>{r.STATUS ?? r.status ?? '—'}</td>
                        <td className="text-right">{fmtQty(r.QNTY ?? r.qnty)}</td>
                        <td className="text-right">{fmtWt(r.WEIGHT ?? r.weight)}</td>
                        <td className="text-right">{fmtWt(r.RATE ?? r.rate)}</td>
                        <td className="text-right">{fmtWt(r.AMOUNT ?? r.amount)}</td>
                      </tr>
                    ))}
                    {ledgerEntryRows.length === 0 ? (
                      <tr>
                        <td colSpan={12}>No jobwork lines for this voucher.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}
            </div>
            <div className="button-group">
              <button type="button" className="btn btn-secondary" onClick={goBackFromLedgerDetail}>
                ← Stock ledger
              </button>
            </div>
          </>
        ) : null}

      </div>
    );
  }

  return (
    <div className="slide slide-9">
      <h2>Stock sum</h2>
      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          Item-wise stock movement summary by date range with optional filters.
        </span>
      </p>

      {error ? (
        <div className="form-api-error" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group">
          <label htmlFor="ss-start">Starting date</label>
          <input
            id="ss-start"
            type="date"
            lang="en-GB"
            className="form-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="ss-end">Ending date</label>
          <input
            id="ss-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="ss-item">Item code</label>
          <select id="ss-item" className="form-select" value={itemCode} onChange={(e) => setItemCode(e.target.value)}>
            <option value="">All items</option>
            {items.map((x) => {
              const code = String(x.ITEM_CODE ?? x.item_code ?? '');
              const name = String(x.ITEM_NAME ?? x.item_name ?? '');
              return (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              );
            })}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="ss-plant">Plant code</label>
          <select id="ss-plant" className="form-select" value={plantCode} onChange={(e) => setPlantCode(e.target.value)}>
            <option value="">All plants</option>
            {plants.map((x, i) => {
              const v = String(x.PLANT_CODE ?? x.plant_code ?? '').trim();
              const n = String(x.PLANT_NAME ?? x.plant_name ?? '').trim();
              return (
                <option key={`${v}-${i}`} value={v}>
                  {n ? `${n} (${v})` : v}
                </option>
              );
            })}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="ss-cat">Cat code</label>
          <input
            id="ss-cat"
            type="text"
            className="form-input"
            placeholder="Leave blank for all categories"
            value={catCode}
            onChange={(e) => setCatCode(e.target.value.toUpperCase())}
            autoComplete="off"
          />
        </div>
        <div className="form-group">
          <label htmlFor="ss-rf">R/F</label>
          <select id="ss-rf" className="form-select" value={rf} onChange={(e) => setRf(e.target.value)}>
            <option value="">All</option>
            <option value="R">R</option>
            <option value="F">F</option>
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
