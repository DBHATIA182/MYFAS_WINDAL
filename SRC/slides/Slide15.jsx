import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { downloadExcelWorkbook } from '../utils/excelExport';
import { generatePDF } from '../utils/pdfgenerator';
import ReportHelpButton from '../components/ReportHelpButton';
import SessionInfoLine, { SessionLineText } from '../components/SessionInfoLine';

function toYesNo(v, defVal = 'Y') {
  const t = String(v ?? '').trim().toUpperCase();
  if (t === 'Y' || t === 'N') return t;
  return defVal;
}

function num(v, defVal = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : defVal;
}

function toUpperOneChar(v) {
  return String(v ?? '').toUpperCase().slice(0, 1);
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

function pickAndRenameRows(rows, columns) {
  const list = Array.isArray(rows) ? rows : [];
  return list.map((r) => {
    const out = {};
    columns.forEach(({ key, header }) => {
      out[header] = r?.[key] ?? '';
    });
    return out;
  });
}

const GSTR1_EXCEL_COLUMNS = {
  b2b: [
    { key: 'GSTIN', header: 'GSTIN/UIN of Recipient' },
    { key: 'NAME', header: 'Receiver Name' },
    { key: 'INVOICE_NO', header: 'Invoice Number' },
    { key: 'INVOICE_DATE', header: 'Invoice date' },
    { key: 'INVOICE_VALUE', header: 'Invoice Value' },
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'REVERSE_CHARGE', header: 'Reverse Charge' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'INVOICE_TYPE', header: 'Invoice Type' },
    { key: 'E_COMMERCE_GSTIN', header: 'E-Commerce GSTIN' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'CESS_AMT', header: 'Cess Amount' },
  ],
  b2cl: [
    { key: 'INVOICE_NO', header: 'Invoice Number' },
    { key: 'INVOICE_DATE', header: 'Invoice date' },
    { key: 'INVOICE_VALUE', header: 'Invoice Value' },
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'CESS_AMT', header: 'Cess Amount' },
    { key: 'E_COMMERCE_GSTIN', header: 'E-Commerce GSTIN' },
  ],
  b2cs: [
    { key: 'TYPE', header: 'Type' },
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'CESS_AMT', header: 'Cess Amount' },
    { key: 'E_COMMERCE_GSTIN', header: 'E-Commerce GSTIN' },
  ],
  cdnr: [
    { key: 'NAME', header: 'Receiver Name' },
    { key: 'NOTE_NUMBER', header: 'Note/Refund Voucher Number' },
    { key: 'NOTE_DATE', header: 'Note/Refund Voucher date' },
    { key: 'DOCUMENT_TYPE', header: 'Note Type' },
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'REV_CHARGE', header: 'Reverse Charge' },
    { key: 'NOTE_SUPPLY_TYPE', header: 'Note Supply Type' },
    { key: 'VOUCHER_VALUE', header: 'Note Value' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'CESS', header: 'Cess Amount' },
  ],
  cdnur: [
    { key: 'UR_TYPE', header: 'UR Type' },
    { key: 'NOTE_NUMBER', header: 'Note/Refund Voucher Number' },
    { key: 'NOTE_DATE', header: 'Note/Refund Voucher date' },
    { key: 'DOCUMENT_TYPE', header: 'Note Type' },
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'VOUCHER_VALUE', header: 'Note Value' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'CESS', header: 'Cess Amount' },
    { key: 'PRE_GST', header: 'Pre GST' },
  ],
  exp: [
    { key: 'EXPORT_TYPE', header: 'Export Type' },
    { key: 'INVOICE_NO', header: 'Invoice Number' },
    { key: 'INVOICE_DATE', header: 'Invoice date' },
    { key: 'INVOICE_VALUE', header: 'Invoice Value' },
    { key: 'PORT', header: 'Port Code' },
    { key: 'SHIPPING_BILL_NO', header: 'Shipping Bill Number' },
    { key: 'SHIPPING_BILL_DATE', header: 'Shipping Bill Date' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
  ],
  expa: [
    { key: 'EXPORT_TYPE', header: 'Export Type' },
    { key: 'INVOICE_NO', header: 'Invoice Number' },
    { key: 'INVOICE_DATE', header: 'Invoice date' },
    { key: 'INVOICE_VALUE', header: 'Invoice Value' },
    { key: 'PORT', header: 'Port Code' },
    { key: 'SHIPPING_BILL_NO', header: 'Shipping Bill Number' },
    { key: 'SHIPPING_BILL_DATE', header: 'Shipping Bill Date' },
    { key: 'RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
  ],
  at: [
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'RATE', header: 'Rate' },
    { key: 'GROSS_ADVANCE_RECEIVED', header: 'Gross Advance Received' },
    { key: 'CESS_AMOUNT', header: 'Cess Amount' },
  ],
  atadj: [
    { key: 'PLACE_OF_SUPPLY', header: 'Place Of Supply' },
    { key: 'APPLICABLE_TAX', header: 'Applicable % of Tax Rate' },
    { key: 'RATE', header: 'Rate' },
    { key: 'GROSS_ADVANCE_ADJUSTED', header: 'Gross Advance Adjusted' },
    { key: 'CESS_AMOUNT', header: 'Cess Amount' },
  ],
  exemp: [
    { key: 'DESCRIPTION', header: 'Description' },
    { key: 'NIL_RATED', header: 'Nil Rated Supplies' },
    { key: 'EXMPTED', header: 'Exempted(other than nil rated/non GST supply)' },
    { key: 'NON_GST_SUP', header: 'Non-GST Supplies' },
  ],
  'hsn(b2b)': [
    { key: 'HSN_CODE', header: 'HSN' },
    { key: 'DESCRIPTION', header: 'Description' },
    { key: 'UQC', header: 'UQC' },
    { key: 'TOTAL_QUANTITY', header: 'Total Quantity' },
    { key: 'TOTAL_VALUE', header: 'Total Value' },
    { key: 'TAX_RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'IGST', header: 'Integrated Tax Amount' },
    { key: 'CGST', header: 'Central Tax Amount' },
    { key: 'SGST', header: 'State/UT Tax Amount' },
    { key: 'CESS_AMOUNT', header: 'Cess Amount' },
  ],
  'hsn(b2c)': [
    { key: 'HSN_CODE', header: 'HSN' },
    { key: 'DESCRIPTION', header: 'Description' },
    { key: 'UQC', header: 'UQC' },
    { key: 'TOTAL_QUANTITY', header: 'Total Quantity' },
    { key: 'TOTAL_VALUE', header: 'Total Value' },
    { key: 'TAX_RATE', header: 'Rate' },
    { key: 'TAXABLE_VALUE', header: 'Taxable Value' },
    { key: 'IGST', header: 'Integrated Tax Amount' },
    { key: 'CGST', header: 'Central Tax Amount' },
    { key: 'SGST', header: 'State/UT Tax Amount' },
    { key: 'CESS_AMOUNT', header: 'Cess Amount' },
  ],
  docs: [
    { key: 'NATURE_OF_DOCUMENT', header: 'Nature of Document' },
    { key: 'SR_NO_FROM', header: 'Sr. No. From' },
    { key: 'SR_NO_TO', header: 'Sr. No. To' },
    { key: 'TOTAL_NUMBER', header: 'Total Number' },
    { key: 'CANCELLED', header: 'Cancelled' },
  ],
};

const GSTR1_EXCEL_TITLES = {
  b2b: 'Summary For B2B(4)',
  b2cl: 'Summary For B2CL(5)',
  b2cs: 'Summary For B2CS(7)',
  cdnr: 'Summary For CDNR(9B)',
  cdnur: 'Summary For CDNUR(9B)',
  exp: 'Summary For EXP(6)',
  expa: 'Summary For EXPA',
  at: 'Summary For Advance Received (11B)',
  atadj: 'Summary For Advance Adjusted (11B)',
  exemp: 'Summary For Nil rated, exempted and non GST outward supplies (8)',
  'hsn(b2b)': 'HSN',
  'hsn(b2c)': 'HSN',
  docs: 'Summary of documents issued during the tax period (13)',
  gstr3b: 'GSTR 3 B',
};

const GSTR1_EXCEL_HEADER_ROWS = {
  b2b: [
    { origin: 'A2', values: [['No. of Recipients']] },
    { origin: 'D2', values: [['No. of Invoices']] },
    { origin: 'E2', values: [['Total Invoice Value']] },
    { origin: 'L2', values: [['Total Taxable Value']] },
    { origin: 'M2', values: [['Total Cess']] },
  ],
};

export default function Slide15({ apiBase, formData, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? 'Company';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  const [sDate, setSDate] = useState(toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT) || '');
  const [eDate, setEDate] = useState(toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT) || '');
  const [bTypeYn, setBTypeYn] = useState('Y');
  const [zeroBeforeBillNo, setZeroBeforeBillNo] = useState('Y');
  const [billNoLength, setBillNoLength] = useState(6);
  const [mqw, setMqw] = useState('W');
  const [btobYn, setBtobYn] = useState('Y');
  const [btoclYn, setBtoclYn] = useState('Y');
  const [btocsYn, setBtocsYn] = useState('Y');
  const [b2clLimitMode, setB2clLimitMode] = useState('1');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [activeSheet, setActiveSheet] = useState('b2b');
  const [detailRows, setDetailRows] = useState([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [saleDetailRows, setSaleDetailRows] = useState([]);
  const [saleDetailTotal, setSaleDetailTotal] = useState(null);
  const [saleDetailTitle, setSaleDetailTitle] = useState('');
  const [saleDetailLoading, setSaleDetailLoading] = useState(false);
  const [detailScreenOpen, setDetailScreenOpen] = useState(false);
  const [detailScreenMode, setDetailScreenMode] = useState('final');

  useEffect(() => {
    if (!sDate) return;
    const monthEnd = monthEndYmd(sDate);
    if (monthEnd && monthEnd !== eDate) setEDate(monthEnd);
  }, [sDate]);

  const clearDetailPanels = () => {
    setDetailRows([]);
    setDetailTitle('');
    setDetailLoading(false);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    setSaleDetailTitle('');
    setSaleDetailLoading(false);
    setDetailScreenOpen(false);
    setDetailScreenMode('final');
  };
  const topScrollRef = useRef(null);
  const topInnerRef = useRef(null);
  const gridScrollRef = useRef(null);
  const detailTopScrollRef = useRef(null);
  const detailTopInnerRef = useRef(null);
  const detailGridScrollRef = useRef(null);
  const saleDetailTopScrollRef = useRef(null);
  const saleDetailTopInnerRef = useRef(null);
  const saleDetailGridScrollRef = useRef(null);

  const sheetEntries = useMemo(() => Object.entries(report?.sheets || {}), [report]);
  const activeRows = report?.sheets?.[activeSheet] || [];
  const columns = activeRows.length > 0 ? Object.keys(activeRows[0]).filter((k) => !k.startsWith('_')) : [];
  const numericColumns = useMemo(
    () => columns.filter((c) => activeRows.some((r) => typeof r?.[c] === 'number')),
    [columns, activeRows]
  );
  const totalsByColumn = useMemo(() => {
    const out = {};
    numericColumns.forEach((c) => {
      out[c] = activeRows.reduce((sum, r) => sum + (typeof r?.[c] === 'number' ? r[c] : 0), 0);
    });
    return out;
  }, [activeRows, numericColumns]);
  const detailColumns = useMemo(() => (detailRows.length > 0 ? Object.keys(detailRows[0]) : []), [detailRows]);
  const detailNumericColumns = useMemo(
    () => detailColumns.filter((c) => detailRows.some((r) => typeof r?.[c] === 'number')),
    [detailColumns, detailRows]
  );
  const detailTotalsByColumn = useMemo(() => {
    const out = {};
    detailNumericColumns.forEach((c) => {
      out[c] = detailRows.reduce((sum, r) => sum + (typeof r?.[c] === 'number' ? r[c] : 0), 0);
    });
    return out;
  }, [detailRows, detailNumericColumns]);
  const saleDetailColumns = useMemo(() => (saleDetailRows.length > 0 ? Object.keys(saleDetailRows[0]) : []), [saleDetailRows]);
  const saleDetailNumericColumns = useMemo(
    () => saleDetailColumns.filter((c) => saleDetailRows.some((r) => typeof r?.[c] === 'number')),
    [saleDetailColumns, saleDetailRows]
  );
  const saleDetailTotalsByColumn = useMemo(() => {
    const out = {};
    saleDetailNumericColumns.forEach((c) => {
      out[c] = saleDetailRows.reduce((sum, r) => sum + (typeof r?.[c] === 'number' ? r[c] : 0), 0);
    });
    return out;
  }, [saleDetailRows, saleDetailNumericColumns]);

  useEffect(() => {
    if (!report) return;
    const top = topScrollRef.current;
    const topInner = topInnerRef.current;
    const grid = gridScrollRef.current;
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
  }, [report, activeSheet, activeRows.length, columns.length]);

  useEffect(() => {
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
  }, [detailRows.length, detailColumns.length, activeSheet]);

  useEffect(() => {
    const top = saleDetailTopScrollRef.current;
    const topInner = saleDetailTopInnerRef.current;
    const grid = saleDetailGridScrollRef.current;
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
  }, [saleDetailRows.length, saleDetailColumns.length, activeSheet]);

  const formatCell = (v) => {
    if (typeof v === 'number') return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v == null ? '' : String(v);
  };

  const runReport = async (e) => {
    e.preventDefault();
    if (!sDate || !eDate) {
      alert('Please provide starting and ending dates.');
      return;
    }
    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(sDate),
        e_date: toOracleDate(eDate),
        btype_yn: toYesNo(bTypeYn, 'Y'),
        zero_before_bill_no: toYesNo(zeroBeforeBillNo, 'Y'),
        bill_no_length: num(billNoLength, 6),
        mqw: String(mqw || 'W').trim().toUpperCase() === 'Q' ? 'Q' : 'W',
        btob_yn: toYesNo(btobYn, 'Y'),
        btocl_yn: toYesNo(btoclYn, 'Y'),
        btocs_yn: toYesNo(btocsYn, 'Y'),
        b2cl_limit_mode: String(b2clLimitMode || '1').trim() === '2' ? '2' : '1',
      };
      const { data } = await axios.get(`${apiBase}/api/gstr1`, {
        params,
        withCredentials: true,
        timeout: 180000,
      });
      setReport(data || { sheets: {} });
      clearDetailPanels();
      const firstKey = Object.keys(data?.sheets || {})[0];
      if (firstKey) setActiveSheet(firstKey);
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    if (!report?.sheets) return;
    const emptySheetHeaders = {};
    const dataSheets = Object.entries(report.sheets)
      .filter(([name]) => name !== 'gstr3b')
      .map(([name, data]) => {
      const cols = GSTR1_EXCEL_COLUMNS[name];
      if (cols) emptySheetHeaders[name] = cols.map((c) => c.header);
      if (!cols) return { name, data: (Array.isArray(data) ? data : []).map((r) => {
        const out = {};
        Object.keys(r || {}).forEach((k) => {
          if (!k.startsWith('_')) out[k] = r[k];
        });
        return out;
      }) };
      return { name, data: pickAndRenameRows(data, cols) };
    });
    const sheets = [{ name: 'Main', data: [] }, ...dataSheets];
    downloadExcelWorkbook(sheets, `${compName}_GSTR1`, {
      startRow: 4,
      sheetStartRows: { Main: 1 },
      includeHeaders: true,
      sheetTitles: GSTR1_EXCEL_TITLES,
      sheetHeaderRows: GSTR1_EXCEL_HEADER_ROWS,
      emptySheetHeaders,
    });
  };

  const exportPdf = async () => {
    if (!report?.sheets) return;
    await generatePDF('gstr1', report, {
      companyName: compName,
      year: compYear,
      period: `${toDisplayDate(sDate)} - ${toDisplayDate(eDate)}`,
      activeSheet,
    });
  };

  const exportDetailExcel = () => {
    if (!saleDetailRows?.length) return;
    downloadExcelWorkbook([{ name: 'detail', data: saleDetailRows }], `${compName}_GSTR1_DETAIL`);
  };

  const exportDetailPdf = async () => {
    if (!saleDetailRows?.length) return;
    await generatePDF('gstr1', { sheets: { detail: saleDetailRows } }, {
      companyName: compName,
      year: compYear,
      period: `${toDisplayDate(sDate)} - ${toDisplayDate(eDate)}`,
      activeSheet: 'detail',
    });
  };

  const openB2csDetail = async (row) => {
    if (activeSheet !== 'b2cs') return;
    setDetailScreenOpen(true);
    setDetailScreenMode('b2cs-picked');
    setSaleDetailLoading(true);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    setDetailRows([]);
    setDetailTitle('');
    const pos = String(row?.PLACE_OF_SUPPLY ?? '').trim();
    const rate = Number(row?.RATE ?? 0) || 0;
    setSaleDetailTitle(`B2CS detail — ${pos} @ ${rate.toFixed(2)}%`);
    try {
      const { data } = await axios.get(`${apiBase}/api/gstr1-b2cs-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sDate),
          e_date: toOracleDate(eDate),
          btocs_yn: toYesNo(btocsYn, 'Y'),
          b2cl_limit_mode: String(b2clLimitMode || '1').trim() === '2' ? '2' : '1',
          place_of_supply: pos,
          rate,
        },
        withCredentials: true,
        timeout: 120000,
      });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setSaleDetailRows(rows);
      setSaleDetailTotal(data?.total || null);
    } catch (err) {
      alert('Detail error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleDetailLoading(false);
    }
  };

  const openSaleDetail = async (row) => {
    setDetailScreenOpen(true);
    setDetailScreenMode('final');
    setSaleDetailLoading(true);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    const type = String(row?.TYPE ?? '').trim();
    const billNo = String(row?.BILL_NO ?? '').trim();
    const bType = String(row?.B_TYPE ?? '').trim();
    setSaleDetailTitle(`Sale detail — ${type}/${billNo}/${bType || ' '}`);
    try {
      const { data } = await axios.get(`${apiBase}/api/gstr1-sale-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          type,
          bill_no: billNo,
          b_type: bType || ' ',
        },
        withCredentials: true,
        timeout: 120000,
      });
      setSaleDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setSaleDetailTotal(data?.total || null);
    } catch (err) {
      alert('Sale detail error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleDetailLoading(false);
    }
  };

  const openSaleDetailFromSummary = async (row) => {
    const type = String(row?._TYPE ?? '').trim();
    const billNo = String(row?._BILL_NO ?? '').trim();
    const bType = String(row?._B_TYPE ?? '').trim();
    if (!type || !billNo) {
      alert('Missing bill identity for this row.');
      return;
    }
    setDetailScreenOpen(true);
    setDetailScreenMode('final');
    setSaleDetailLoading(true);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    setSaleDetailTitle(`Sale detail — ${type}/${billNo}/${bType || ' '}`);
    try {
      const { data } = await axios.get(`${apiBase}/api/gstr1-sale-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          type,
          bill_no: billNo,
          b_type: bType || ' ',
        },
        withCredentials: true,
        timeout: 120000,
      });
      setSaleDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setSaleDetailTotal(data?.total || null);
    } catch (err) {
      alert('Sale detail error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleDetailLoading(false);
    }
  };

  const openNoteDetailFromSummary = async (row) => {
    const source = String(row?._SOURCE ?? '').trim();
    const type = String(row?._TYPE ?? '').trim();
    const noteNo = String(row?._NOTE_NO ?? '').trim();
    const noteDate = String(row?._NOTE_DATE ?? '').trim();
    const bType = String(row?._B_TYPE ?? '').trim();
    if (!source || !type || !noteNo || !noteDate) {
      alert('Missing note identity for this row.');
      return;
    }
    setDetailScreenOpen(true);
    setDetailScreenMode('final');
    setSaleDetailLoading(true);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    setSaleDetailTitle(`Detail — ${source}/${type}/${noteNo}/${noteDate}`);
    try {
      const { data } = await axios.get(`${apiBase}/api/gstr1-note-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          source,
          type,
          note_no: noteNo,
          note_date: noteDate,
          b_type: bType || ' ',
        },
        withCredentials: true,
        timeout: 120000,
      });
      setSaleDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setSaleDetailTotal(data?.total || null);
    } catch (err) {
      alert('Note detail error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleDetailLoading(false);
    }
  };

  const openExempDetailFromSummary = async (row) => {
    const rowKey = String(row?._KEY ?? '').trim();
    if (!rowKey) {
      alert('Missing exemp row identity.');
      return;
    }
    setDetailScreenOpen(true);
    setDetailScreenMode('final');
    setSaleDetailLoading(true);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    setSaleDetailTitle(`Exemp detail — ${String(row?.DESCRIPTION ?? rowKey)}`);
    try {
      const { data } = await axios.get(`${apiBase}/api/gstr1-exemp-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sDate),
          e_date: toOracleDate(eDate),
          row_key: rowKey,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setSaleDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setSaleDetailTotal(data?.total || null);
    } catch (err) {
      alert('Exemp detail error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleDetailLoading(false);
    }
  };

  const openHsnDetailFromSummary = async (row, isRegistered) => {
    const hsnCode = String(row?.HSN_CODE ?? '').trim();
    const taxRate = Number(row?.TAX_RATE ?? row?.RATE ?? 0) || 0;
    if (!hsnCode) {
      alert('Missing HSN code.');
      return;
    }
    setDetailScreenOpen(true);
    setDetailScreenMode('final');
    setSaleDetailLoading(true);
    setSaleDetailRows([]);
    setSaleDetailTotal(null);
    setSaleDetailTitle(`HSN detail — ${hsnCode} @ ${taxRate.toFixed(2)}%`);
    try {
      const { data } = await axios.get(`${apiBase}/api/gstr1-hsn-detail`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sDate),
          e_date: toOracleDate(eDate),
          registered: isRegistered ? 'Y' : 'N',
          hsn_code: hsnCode,
          tax_rate: taxRate,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setSaleDetailRows(Array.isArray(data?.rows) ? data.rows : []);
      setSaleDetailTotal(data?.total || null);
    } catch (err) {
      alert('HSN detail error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaleDetailLoading(false);
    }
  };

  if (report) {
    if (detailScreenOpen) {
      return (
        <div className="slide slide-report">
          <div className="report-toolbar">
            <h2>{saleDetailTitle || 'Detail view'}</h2>
            <div className="toolbar-actions">
            <ReportHelpButton reportId="gstr1" />
            
              <button type="button" className="btn btn-toolbar-back" onClick={() => setDetailScreenOpen(false)}>
                ← Back
              </button>
              <button type="button" className="btn btn-export" onClick={() => exportDetailPdf().catch((e) => alert(String(e?.message || e)))}>
                Pdf
              </button>
              <button type="button" className="btn btn-excel" onClick={exportDetailExcel}>
                📊 Excel
              </button>
            </div>
          </div>
          <div className="report-info">
            <p>
              <SessionLineText formData={formData} /> | {toDisplayDate(sDate)} - {toDisplayDate(eDate)}
            </p>
          </div>
          <div className="report-display table-responsive table-responsive--gstr1" ref={saleDetailGridScrollRef}>
            <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={saleDetailTopScrollRef}>
              <div className="sale-list-scroll-sync-inner" ref={saleDetailTopInnerRef} />
            </div>
            {saleDetailLoading ? <p>Loading detail…</p> : null}
            {!saleDetailLoading && saleDetailRows.length === 0 ? <p className="stock-sum-empty">No detail rows found.</p> : null}
            {!saleDetailLoading && saleDetailRows.length > 0 ? (
              <table className="report-table report-table--gstr1">
                <thead>
                  <tr>
                    {saleDetailColumns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {saleDetailRows.map((r, i) => (
                    <tr
                      key={i}
                      className={detailScreenMode === 'b2cs-picked' ? 'sale-list-row-clickable' : ''}
                      onClick={detailScreenMode === 'b2cs-picked' ? () => openSaleDetail(r) : undefined}
                    >
                      {saleDetailColumns.map((c) => (
                        <td key={c} className={typeof r[c] === 'number' ? 'text-right' : ''}>
                          {formatCell(r[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="sale-list-grand-total">
                    {saleDetailColumns.map((c, idx) => {
                      if (idx === 0) return <td key={c}><strong>Grand total</strong></td>;
                      if (!saleDetailNumericColumns.includes(c)) return <td key={c}>—</td>;
                      return (
                        <td key={c} className="text-right">
                          <strong>{formatCell(saleDetailTotalsByColumn[c])}</strong>
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            ) : null}
          </div>
        </div>
      );
    }

    return (
      <div className="slide slide-report">
        <div className="report-toolbar">
          <h2>GSTR-1 Report</h2>
          <div className="toolbar-actions">
            <ReportHelpButton reportId="gstr1" />
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setReport(null)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={() => exportPdf().catch((e) => alert(String(e?.message || e)))}>
              Pdf
            </button>
            <button type="button" className="btn btn-excel" onClick={exportExcel}>
              📊 Excel
            </button>
          </div>
        </div>
        <div className="report-info">
          <p>
            <SessionLineText formData={formData} /> | {toDisplayDate(sDate)} - {toDisplayDate(eDate)}
          </p>
        </div>
        <div className="report-sort-switch" role="group" aria-label="GSTR1 sheets">
          {sheetEntries.map(([name, rows]) => (
            <button
              key={name}
              type="button"
              className={`btn btn-secondary btn-sort-switch${activeSheet === name ? ' is-active' : ''}`}
              onClick={() => {
                setActiveSheet(name);
                clearDetailPanels();
              }}
            >
              {name} ({Array.isArray(rows) ? rows.length : 0})
            </button>
          ))}
        </div>
        <div className="report-display table-responsive table-responsive--gstr1" ref={gridScrollRef}>
          <div className="sale-list-scroll-sync sale-list-scroll-sync--top" ref={topScrollRef}>
            <div className="sale-list-scroll-sync-inner" ref={topInnerRef} />
          </div>
          <table className="report-table report-table--gstr1">
            <thead>
              <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {activeRows.map((r, i) => (
                <tr
                  key={i}
                  className={['b2cs', 'b2b', 'b2cl', 'cdnr', 'cdnur', 'exp', 'exemp', 'hsn(b2b)', 'hsn(b2c)'].includes(activeSheet) ? 'sale-list-row-clickable' : ''}
                  onClick={
                    activeSheet === 'b2cs'
                      ? () => openB2csDetail(r)
                      : activeSheet === 'b2b' || activeSheet === 'b2cl'
                        ? () => openSaleDetailFromSummary(r)
                        : activeSheet === 'cdnr' || activeSheet === 'cdnur'
                          ? () => openNoteDetailFromSummary(r)
                          : activeSheet === 'exp'
                            ? () => openSaleDetailFromSummary(r)
                            : activeSheet === 'exemp'
                              ? () => openExempDetailFromSummary(r)
                              : activeSheet === 'hsn(b2b)'
                                ? () => openHsnDetailFromSummary(r, true)
                                : activeSheet === 'hsn(b2c)'
                                  ? () => openHsnDetailFromSummary(r, false)
                        : undefined
                  }
                >
                  {columns.map((c) => (
                    <td key={c} className={typeof r[c] === 'number' ? 'text-right' : ''}>
                      {formatCell(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {activeRows.length > 0 ? (
                <tr className="sale-list-grand-total">
                  {columns.map((c, idx) => {
                    if (idx === 0) return <td key={c}><strong>Grand total</strong></td>;
                    if (!numericColumns.includes(c)) return <td key={c}>—</td>;
                    return (
                      <td key={c} className="text-right">
                        <strong>{formatCell(totalsByColumn[c])}</strong>
                      </td>
                    );
                  })}
                </tr>
              ) : null}
            </tbody>
          </table>
          {activeRows.length === 0 ? <p className="stock-sum-empty">No rows in this sheet.</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="slide slide-11">
      <h2>GSTR-1 parameters</h2>
      <SessionInfoLine formData={formData} />
      <form onSubmit={runReport} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>← Back</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Loading…' : 'Run'}</button>
        </div>
        <div className="form-group"><label>Starting date</label><input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} required /></div>
        <div className="form-group"><label>Ending date</label><input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} required /></div>
        <div className="form-group"><label>B.Type in bill printing (Y/N)</label><input className="form-input" value={bTypeYn} maxLength={1} onChange={(e) => setBTypeYn(toUpperOneChar(e.target.value))} /></div>
        <div className="form-group"><label>Zero before bill printing (Y/N)</label><input className="form-input" value={zeroBeforeBillNo} maxLength={1} onChange={(e) => setZeroBeforeBillNo(toUpperOneChar(e.target.value))} /></div>
        <div className="form-group"><label>Bill no. Length</label><input type="number" className="form-input" value={billNoLength} onChange={(e) => setBillNoLength(e.target.value)} /></div>
        <div className="form-group"><label>Qty/weight (Q/W)</label><input className="form-input" value={mqw} maxLength={1} onChange={(e) => setMqw(toUpperOneChar(e.target.value))} /></div>
        <div className="form-group"><label>Include exempted in BTOB (Y/N)</label><input className="form-input" value={btobYn} maxLength={1} onChange={(e) => setBtobYn(toUpperOneChar(e.target.value))} /></div>
        <div className="form-group"><label>Include exempted in BTOCL (Y/N)</label><input className="form-input" value={btoclYn} maxLength={1} onChange={(e) => setBtoclYn(toUpperOneChar(e.target.value))} /></div>
        <div className="form-group"><label>Include exempted in BTOCS (Y/N)</label><input className="form-input" value={btocsYn} maxLength={1} onChange={(e) => setBtocsYn(toUpperOneChar(e.target.value))} /></div>
        <div className="form-group"><label>B2CL LIMIT 250000/100000 (1/2)</label><input className="form-input" value={b2clLimitMode} maxLength={1} onChange={(e) => setB2clLimitMode(toUpperOneChar(e.target.value))} /></div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>← Back</button>
          <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? 'Loading…' : 'Run'}</button>
        </div>
      </form>
    </div>
  );
}

