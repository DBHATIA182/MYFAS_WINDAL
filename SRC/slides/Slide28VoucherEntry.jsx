import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyCreateModal, { PartyAddButton } from '../components/MasterPartyCreateModal';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SaleEntryScreenHeader from '../components/SaleEntryScreenHeader';
import SaleEntryTopBar from '../components/SaleEntryTopBar';
import ReportHelpButton from '../components/ReportHelpButton';
import VoucherPendingBillsModal from '../components/VoucherPendingBillsModal';
import VoucherEntryListScreen from '../components/VoucherEntryListScreen';
import VoucherReportPreviewModal from '../components/VoucherReportPreviewModal';
import {
  clampYmdToFinYear,
  defaultDocDateInFinYear,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { calcCdAmtFromPercent } from '../utils/voucherCdCal';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import '../voucherEntry.css';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

function fmtTotal(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
}

function parseAmt(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatTransferVrNo(v) {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? String(Math.floor(n)) : '';
}

function partyLabel(r) {
  const code = r.CODE ?? r.code ?? '';
  const name = r.NAME ?? r.name ?? '';
  const city = r.CITY ?? r.city ?? '';
  return city ? `[${code}] ${name} — ${city}` : `[${code}] ${name}`;
}

function acctLabel(r) {
  const code = r.CODE ?? r.code ?? '';
  const name = r.NAME ?? r.name ?? '';
  return name ? `[${code}] ${name}` : String(code);
}

function defaultDcCodeForType(vrType, cashAccounts, bankAccounts) {
  if (vrType === 'CV') {
    const list = cashAccounts || [];
    return list.length ? String(list[0].CODE ?? list[0].code ?? '') : '';
  }
  if (vrType === 'BV') {
    const list = bankAccounts || [];
    return list.length ? String(list[0].CODE ?? list[0].code ?? '') : '';
  }
  return '';
}

function voucherLineFocusFields(vrType, isMobile = false) {
  const fields = ['code'];
  if (!isMobile) fields.push('vdate');
  if (vrType === 'BV') fields.push('chq');
  fields.push('detail');
  if (!isMobile) fields.push('billdt');
  fields.push('billno', 'btype', 'dr', 'cr', 'int', 'cd');
  return fields;
}

function buildVoucherFocusOrder(root, vrType) {
  const isMobile =
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches;
  const order = ['vr-date'];
  if (vrType === 'CV') order.push('doc-type');
  order.push('vr-no');
  if (vrType !== 'JV') order.push('dc-code');
  const rowCount = root.querySelectorAll('.voucher-entry-lines tbody tr').length;
  const lineFields = voucherLineFocusFields(vrType, isMobile);
  for (let i = 0; i < rowCount; i += 1) {
    for (const field of lineFields) {
      order.push(`line-${i}-${field}`);
    }
  }
  return order;
}

function resolveVoucherFocusKey(el) {
  if (!el) return null;
  const direct = el.getAttribute?.('data-voucher-focus');
  if (direct) return direct;
  const host = el.closest?.('[data-voucher-focus]');
  if (host?.getAttribute('data-voucher-focus')) return host.getAttribute('data-voucher-focus');
  return null;
}

function focusVoucherField(root, key) {
  if (!root || !key) return;
  const runFocus = () => {
    if (key === 'dc-code') {
      root.querySelector('[data-voucher-focus="dc-code"] .master-party-pick__trigger')?.focus();
      return;
    }
    const lineCode = key.match(/^line-(\d+)-code$/);
    if (lineCode) {
      const idx = lineCode[1];
      const trigger =
        root.querySelector(`[data-mp-field="voucher-line-code-${idx}"].master-party-pick__trigger`) ||
        root.querySelector(`[data-voucher-focus="line-${idx}-code"] .master-party-pick__trigger`);
      trigger?.focus();
      return;
    }
    const el = root.querySelector(`[data-voucher-focus="${key}"]`);
    if (!el) return;
    el.focus();
    if (typeof el.select === 'function' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      try {
        el.select();
      } catch (_) {}
    }
  };
  if (/^line-\d+-code$/.test(key)) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(runFocus));
    return;
  }
  runFocus();
}

function focusNextVoucherField(root, currentEl, vrType) {
  const key = resolveVoucherFocusKey(currentEl);
  if (!key) return false;
  const order = buildVoucherFocusOrder(root, vrType);
  const i = order.indexOf(key);
  if (i < 0 || i >= order.length - 1) return false;
  focusVoucherField(root, order[i + 1]);
  return true;
}

function handleEnterAsTab(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!t || t.closest('.slide-28-voucher-entry-ignore-enter')) return;
  if (t.closest('.master-party-pick__panel')) return;
  if (t.closest('.master-party-pick--open')) {
    e.preventDefault();
    return;
  }
  if (t.tagName === 'TEXTAREA') return;
  e.preventDefault();
  const root = t.closest('.slide-28-voucher-entry');
  if (!root) return;
  const vrType = root.getAttribute('data-vr-type') || 'CV';
  focusNextVoucherField(root, t, vrType);
}

function syncLinesVDate(lines, vrDate) {
  return lines.map((l) => ({ ...l, v_date: vrDate }));
}

function emptyLine(vrDate, dcCode, prevCode, trnNo = 1) {
  return {
    trn_no: trnNo,
    code: '',
    name: '',
    schedule: '',
    v_date: vrDate,
    chq_no: '',
    detail: '',
    bill_date: '',
    bill_no: '',
    b_type: '',
    dr_amt: '',
    cr_amt: '',
    int_amt: '',
    cd_amt: '',
    cd_per: '',
    dc_code: prevCode || dcCode || '',
  };
}

function mapLoadedLine(r, vrDate) {
  return {
    trn_no: r.TRN_NO ?? r.trn_no ?? 1,
    code: String(r.CODE ?? r.code ?? ''),
    name: String(r.NAME ?? r.name ?? ''),
    schedule: String(r.SCHEDULE ?? r.schedule ?? ''),
    v_date: toInputDateString(r.V_DATE ?? r.v_date ?? vrDate) || vrDate,
    chq_no: String(r.CHQ_NO ?? r.chq_no ?? ''),
    detail: String(r.DETAIL ?? r.detail ?? ''),
    bill_date: toInputDateString(r.BILL_DATE ?? r.bill_date) || '',
    bill_no: r.BILL_NO ?? r.bill_no ?? '',
    b_type: String(r.B_TYPE ?? r.b_type ?? '').trim(),
    dr_amt: fmtAmt(r.DR_AMT ?? r.dr_amt),
    cr_amt: fmtAmt(r.CR_AMT ?? r.cr_amt),
    int_amt: fmtAmt(r.INT_AMT ?? r.int_amt),
    cd_amt: fmtAmt(r.CD_AMT ?? r.cd_amt),
    cd_per: fmtAmt(r.CD_PER ?? r.cd_per),
    dc_code: String(r.DC_CODE ?? r.dc_code ?? ''),
  };
}

export default function Slide28VoucherEntry({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const finYear = useMemo(() => resolveSaleEntryFinYear(formData), [formData]);

  const [can, setCan] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [lookups, setLookups] = useState({ parties: [], cashAccounts: [], bankAccounts: [] });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('new');

  const [vrType, setVrType] = useState('CV');
  const [vrDate, setVrDate] = useState('');
  const [docType, setDocType] = useState('N');
  const [vrNo, setVrNo] = useState('');
  const [dcCode, setDcCode] = useState('');
  const [cdVrType, setCdVrType] = useState('');
  const [cdVrDate, setCdVrDate] = useState('');
  const [cdVrNo, setCdVrNo] = useState('');
  const [intVrType, setIntVrType] = useState('');
  const [intVrDate, setIntVrDate] = useState('');
  const [intVrNo, setIntVrNo] = useState('');

  const [lines, setLines] = useState([]);
  const [activeLine, setActiveLine] = useState(0);
  const [partyAddOpen, setPartyAddOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [listScreenOpen, setListScreenOpen] = useState(false);
  const [voucherPreviewOpen, setVoucherPreviewOpen] = useState(false);
  const [compdet, setCompdet] = useState(null);
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );

  const originalRef = useRef(null);
  const slideRootRef = useRef(null);
  const vrDateRef = useRef(null);
  const initialFocusDoneRef = useRef(false);

  const focusVrDate = useCallback(() => {
    window.setTimeout(() => {
      const el = vrDateRef.current;
      if (!el) return;
      el.focus();
      if (typeof el.select === 'function') {
        try {
          el.select();
        } catch (_) {}
      }
    }, 80);
  }, []);

  const dcAccounts = useMemo(() => {
    if (vrType === 'CV') return lookups.cashAccounts || [];
    if (vrType === 'BV') return lookups.bankAccounts || [];
    return [];
  }, [vrType, lookups]);

  const dcName = useMemo(() => {
    const hit = dcAccounts.find((a) => String(a.CODE ?? a.code) === String(dcCode));
    return hit ? String(hit.NAME ?? hit.name ?? '').trim() : '';
  }, [dcAccounts, dcCode]);

  const lineTotals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    let int = 0;
    let cd = 0;
    for (const l of lines) {
      dr += parseAmt(l.dr_amt);
      cr += parseAmt(l.cr_amt);
      int += parseAmt(l.int_amt);
      cd += parseAmt(l.cd_amt);
    }
    return { dr, cr, int, cd };
  }, [lines]);

  const amtColStart = vrType === 'BV' ? 11 : 10;
  const isReadOnly = mode === 'view';
  const hasLoadedVoucher = mode === 'view' || mode === 'edit';

  const renderVoucherLinesColgroup = () => (
    <colgroup>
      <col className="voucher-col-sno" />
      <col className="voucher-col-code" />
      <col className="voucher-col-name" />
      <col className="voucher-col-sched" />
      <col className="voucher-col-vdate" />
      {vrType === 'BV' ? <col className="voucher-col-chq" /> : null}
      <col className="voucher-col-detail" />
      <col className="voucher-col-billdt" />
      <col className="voucher-col-billno" />
      <col className="voucher-col-btype" />
      <col className="voucher-col-bills-help" />
      <col className="voucher-col-amt" />
      <col className="voucher-col-amt" />
      <col className="voucher-col-amt" />
      <col className="voucher-col-amt" />
      <col className="voucher-col-actions" />
    </colgroup>
  );

  const renderVoucherLinesHead = () => (
    <thead>
      <tr>
        <th className="voucher-col-th-num">#</th>
        <th>Code</th>
        <th>Account name</th>
        <th className="voucher-col-th-num">Sched</th>
        <th>Value date</th>
        {vrType === 'BV' ? <th>Chq</th> : null}
        <th>Particulars</th>
        <th>Bill date</th>
        <th className="voucher-col-th-num">Bill no</th>
        <th className="voucher-col-th-num">B type</th>
        <th className="voucher-col-bills-help-th" title="Pending bills">
          ?
        </th>
        <th className="voucher-col-th-num">Dr amt</th>
        <th className="voucher-col-th-num">Cr amt</th>
        <th className="voucher-col-th-num">Int amt</th>
        <th className="voucher-col-th-num">Cd amt</th>
        <th aria-label="Row actions" />
      </tr>
    </thead>
  );

  const renderVoucherLinesTotals = () => (
    <table className="voucher-entry-lines voucher-entry-lines--totals">
      {renderVoucherLinesColgroup()}
      <tfoot>
        <tr className="voucher-entry-totals-row">
          <td colSpan={amtColStart} className="voucher-entry-add-row">
            <span className="voucher-entry-total-label">Total:</span>
            {!isReadOnly ? (
              <button type="button" className="voucher-entry-add-line-link" onClick={addLine}>
                + Add line
              </button>
            ) : null}
          </td>
          <td className="num">{fmtAmt(lineTotals.dr) || '0.00'}</td>
          <td className="num">{fmtAmt(lineTotals.cr) || '0.00'}</td>
          <td className="num">{fmtAmt(lineTotals.int) || '0.00'}</td>
          <td className="num">{fmtAmt(lineTotals.cd) || '0.00'}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );

  const voucherPrintData = useMemo(
    () => ({
      header: {
        vr_type: vrType,
        vr_date: toDisplayDate(vrDate),
        vr_no: vrNo,
        type: vrType === 'CV' ? docType : 'N',
        dc_code: dcCode,
        dc_name: dcName,
        cd_vr_type: cdVrType,
        cd_vr_date: cdVrDate ? toDisplayDate(cdVrDate) : '',
        cd_vr_no: formatTransferVrNo(cdVrNo),
        int_vr_type: intVrType,
        int_vr_date: intVrDate ? toDisplayDate(intVrDate) : '',
        int_vr_no: formatTransferVrNo(intVrNo),
      },
      lines: lines
        .filter((l) => l.code)
        .map((l) => ({
          code: l.code,
          name: l.name,
          schedule: l.schedule,
          v_date: l.v_date ? toDisplayDate(l.v_date) : toDisplayDate(vrDate),
          chq_no: l.chq_no,
          detail: l.detail,
          bill_date: l.bill_date ? toDisplayDate(l.bill_date) : '',
          bill_no: l.bill_no,
          b_type: l.b_type,
          dr_amt: parseAmt(l.dr_amt),
          cr_amt: parseAmt(l.cr_amt),
          int_amt: parseAmt(l.int_amt),
          cd_amt: parseAmt(l.cd_amt),
        })),
    }),
    [
      vrType,
      vrDate,
      vrNo,
      docType,
      dcCode,
      dcName,
      cdVrType,
      cdVrDate,
      cdVrNo,
      intVrType,
      intVrDate,
      intVrNo,
      lines,
    ]
  );

  const voucherPrintMeta = useMemo(() => {
    const pick = (...vals) => {
      for (const v of vals) {
        const s = String(v ?? '').trim();
        if (s) return s;
      }
      return '';
    };
    const firstLine = lines.find((l) => l.code);
    const partyRow = firstLine
      ? lookups.parties.find((p) => String(p.CODE ?? p.code) === String(firstLine.code))
      : null;
    return {
      companyName: pick(compName, compdet?.COMP_NAME, compdet?.comp_name, compdet?.G_COMPNAME),
      compAdd1: pick(compdet?.COMP_ADD1, compdet?.comp_add1, compdet?.G_COMPADD1),
      compAdd2: pick(compdet?.COMP_ADD2, compdet?.comp_add2, compdet?.G_COMPADD2),
      compPan: pick(compdet?.COMP_PAN, compdet?.comp_pan, compdet?.G_COMPPAN),
      compFssai: pick(compdet?.FSSAI_NO, compdet?.fssai_no),
      compTel1: pick(compdet?.COMP_TEL1, compdet?.comp_tel1, compdet?.G_COMPTEL1),
      compTel2: pick(compdet?.COMP_TEL2, compdet?.comp_tel2, compdet?.G_COMPTEL2),
      compTel3: pick(compdet?.COMP_TEL3, compdet?.comp_tel3, compdet?.G_COMPTEL3),
      partyName: pick(firstLine?.name, partyRow?.NAME, partyRow?.name),
      partyCode: pick(firstLine?.code, partyRow?.CODE, partyRow?.code),
      partyPan: pick(partyRow?.PAN, partyRow?.pan),
      userName: pick(userName, compUid),
      printedDate: toDisplayDate(new Date()),
      voucherKey: `${vrType}_${vrNo}_${toDisplayDate(vrDate)}`,
    };
  }, [compName, compdet, userName, compUid, vrType, vrNo, vrDate, lines, lookups.parties]);

  const canPrintVoucher = voucherPrintData.lines.length > 0 && !!vrNo && !!vrDate;

  const voucherPrintShareText = useMemo(
    () =>
      [
        compName,
        `${vrType} voucher ${vrNo}`,
        toDisplayDate(vrDate),
        dcName ? `Account: ${dcName}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    [compName, vrType, vrNo, vrDate, dcName]
  );

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [pRes, cRes, lRes, hRes] = await Promise.all([
        axios.get(`${apiBase}/api/voucher-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/voucher-form-context`, {
          params: { comp_code: compCode, comp_uid: compUid, comp_year: compYear },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/voucher-entry-lookups`, {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/compdet-print-header`, {
          params: { comp_code: compCode, comp_uid: compUid, comp_year: compYear },
          ...reqOpts,
        }),
      ]);
      setCan(pRes.data);
      setCtx(cRes.data);
      setCompdet(hRes.data || null);
      const lu = lRes.data || { parties: [], cashAccounts: [], bankAccounts: [] };
      setLookups(lu);
      const defDate = defaultDocDateInFinYear(finYear.fyMinYmd, finYear.fyMaxYmd);
      const defDc = defaultDcCodeForType('CV', lu.cashAccounts, lu.bankAccounts);
      setVrDate(defDate);
      setDcCode(defDc);
      setLines([emptyLine(defDate, defDc, null, 1)]);
      if (!pRes.data?.canOpen) setErr('Access Denied');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, compYear, userName, finYear]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => setIsMobileLayout(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (loading || !can?.canOpen || listScreenOpen) return;
    if (!initialFocusDoneRef.current) {
      initialFocusDoneRef.current = true;
      focusVrDate();
    }
  }, [loading, can?.canOpen, listScreenOpen, focusVrDate]);

  const refreshNextNo = useCallback(async () => {
    if (mode !== 'new' || !vrType || !vrDate) return;
    try {
      const tp = vrType === 'CV' ? docType : 'N';
      const { data } = await axios.get(`${apiBase}/api/voucher-next-no`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: vrType,
          vr_date: toOracleDate(vrDate),
          type: tp,
        },
        ...reqOpts,
      });
      setVrNo(String(data?.next_no ?? ''));
    } catch (_) {}
  }, [apiBase, compCode, compUid, vrType, vrDate, docType, mode]);

  useEffect(() => {
    if (mode !== 'new' || dcCode) return;
    const defDc = defaultDcCodeForType(vrType, lookups.cashAccounts, lookups.bankAccounts);
    if (defDc) setDcCode(defDc);
  }, [vrType, lookups.cashAccounts, lookups.bankAccounts, mode, dcCode]);

  const applyVrDateToLines = useCallback((ymd) => {
    if (!ymd) return;
    setLines((prev) => syncLinesVDate(prev, ymd));
  }, []);

  const setVrDateAndSync = useCallback(
    (ymd) => {
      const v = clampYmdToFinYear(ymd, finYear.fyMinYmd, finYear.fyMaxYmd);
      setVrDate(v);
      applyVrDateToLines(v);
    },
    [finYear.fyMinYmd, finYear.fyMaxYmd, applyVrDateToLines]
  );

  useEffect(() => {
    void refreshNextNo();
  }, [refreshNextNo]);

  const changeVrType = (t) => {
    setVrType(t);
    if (t !== 'CV') setDocType('N');
    const defDc = defaultDcCodeForType(t, lookups.cashAccounts, lookups.bankAccounts);
    setDcCode(defDc);
  };

  const resetNew = () => {
    setMode('new');
    originalRef.current = null;
    const defDate = defaultDocDateInFinYear(finYear.fyMinYmd, finYear.fyMaxYmd);
    const defDc = defaultDcCodeForType(vrType, lookups.cashAccounts, lookups.bankAccounts);
    setVrDate(defDate);
    setDocType('N');
    setDcCode(defDc);
    setCdVrType('');
    setCdVrDate('');
    setCdVrNo('');
    setIntVrType('');
    setIntVrDate('');
    setIntVrNo('');
    setLines([emptyLine(defDate, defDc, null, 1)]);
    void refreshNextNo();
    focusVrDate();
  };

  const loadVoucherByKey = async (key) => {
    const vt = String(key?.vr_type ?? vrType ?? '').trim();
    const ymd = toInputDateString(key?.vr_date ?? vrDate);
    const noRaw = key?.vr_no ?? vrNo;
    const no = noRaw != null && String(noRaw).trim() !== '' ? String(noRaw).trim() : '';
    const tpRaw = String(key?.type ?? (vt === 'CV' ? docType : 'N')).trim().toUpperCase();
    const tp = tpRaw === 'R' ? 'R' : 'N';
    if (!vt || !ymd || !no) {
      alert('Enter voucher type, date, and number to load.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      const { data } = await axios.get(`${apiBase}/api/voucher-load`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          vr_type: vt,
          vr_date: toOracleDate(ymd),
          vr_no: no,
          type: tp,
        },
        ...reqOpts,
      });
      const h = data.header || {};
      const loadedYmd = toInputDateString(h.vr_date ?? ymd);
      setVrType(vt);
      setVrDate(loadedYmd);
      setDocType(String(h.type ?? tp).toUpperCase() === 'R' ? 'R' : 'N');
      setVrNo(String(h.vr_no ?? no));
      setDcCode(String(h.dc_code ?? ''));
      setCdVrType(String(h.cd_vr_type ?? ''));
      setCdVrDate(toInputDateString(h.cd_vr_date) || '');
      setCdVrNo(String(h.cd_vr_no ?? ''));
      setIntVrType(String(h.int_vr_type ?? ''));
      setIntVrDate(toInputDateString(h.int_vr_date) || '');
      setIntVrNo(String(h.int_vr_no ?? ''));
      const mapped = (data.lines || []).map((r) => mapLoadedLine(r, loadedYmd));
      setLines(mapped.length ? mapped : [emptyLine(loadedYmd, h.dc_code, null, 1)]);
      originalRef.current = {
        vr_type: vt,
        vr_date: toOracleDate(loadedYmd),
        vr_no: Number(h.vr_no ?? no),
        type: String(h.type ?? tp).toUpperCase() === 'R' ? 'R' : 'N',
      };
      setMode('view');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Load failed';
      setErr(msg);
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  const loadVoucher = async () => {
    await loadVoucherByKey({
      vr_type: vrType,
      vr_date: vrDate,
      vr_no: vrNo,
      type: vrType === 'CV' ? docType : 'N',
    });
  };

  const openVoucherFromList = async (row) => {
    setListScreenOpen(false);
    await loadVoucherByKey(row);
  };

  const startEditing = () => {
    if (!can?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    if (mode !== 'view' || !hasLoadedVoucher) {
      alert('Load a voucher first, then press Edit to change it.');
      return;
    }
    setMode('edit');
  };

  const handleDelete = () => {
    if (!can?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    if (!hasLoadedVoucher) {
      alert('Load a voucher first.');
      return;
    }
    const label = `${vrType} ${toDisplayDate(vrDate)} #${vrNo}`;
    if (
      !window.confirm(
        `Delete voucher ${label}?\n\nThis removes rows from VOUCHER, LEDGER, and BILLS (including linked Cd/Int JVs).`
      )
    ) {
      return;
    }
    void handleSave('delete');
  };

  const handleVouPrint = () => {
    if (!canPrintVoucher) {
      alert('Enter voucher lines before printing.');
      return;
    }
    setVoucherPreviewOpen(true);
  };

  const handleVouPdf = () => {
    if (!canPrintVoucher) {
      alert('Enter voucher lines before exporting PDF.');
      return;
    }
    generatePDF('voucher-print', voucherPrintData, voucherPrintMeta).catch((e) => alert(e?.message || String(e)));
  };

  const handleVouWhatsApp = () => {
    if (!canPrintVoucher) {
      alert('Enter voucher lines before sharing.');
      return;
    }
    sharePdfWithWhatsApp('voucher-print', voucherPrintData, voucherPrintMeta, voucherPrintShareText).catch((e) =>
      alert(e?.message || String(e))
    );
  };

  const updateLine = (idx, patch) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const pickParty = (idx, code) => {
    const hit = lookups.parties.find((p) => String(p.CODE ?? p.code) === String(code));
    updateLine(idx, {
      code,
      name: hit ? String(hit.NAME ?? hit.name ?? '') : '',
      schedule: hit ? String(hit.SCHEDULE ?? hit.schedule ?? '') : '',
    });
  };

  const addLine = () => {
    const prev = lines[lines.length - 1];
    const nextTrn = (Number(prev?.trn_no) || lines.length) + 1;
    setLines((prevLines) => [
      ...prevLines,
      emptyLine(vrDate, dcCode, prev?.code || null, nextTrn),
    ]);
    setActiveLine(lines.length);
  };

  const removeLine = (idx) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx).map((l, i) => ({ ...l, trn_no: i + 1 })));
    setActiveLine(Math.max(0, idx - 1));
  };

  const applyPendingBills = (picked) => {
    const idx = activeLine;
    const line = lines[idx];
    if (!line || !picked.length) return;
    const sch = Number(line.schedule) || 0;
    const isCust = sch >= 8 && sch < 9;

    const billLine = (b) => {
      const adj = Number(b.ADJ_AMT ?? b.adj_amt ?? 0) || 0;
      const curBal = Math.max(0, Number(b.CUR_BAL ?? b.cur_bal ?? 0) || 0);
      const billInt = Math.max(0, Number(b.INT_AMT ?? b.int_amt ?? 0) || 0);
      const cdPer = parseAmt(b.CD_PER ?? b.cd_per);
      const cdAmt =
        cdPer !== 0
          ? calcCdAmtFromPercent(b.DR_AMT ?? b.dr_amt, cdPer)
          : parseAmt(b.CD_AMT ?? b.cd_amt);
      const intAmt = Math.min(Math.max(0, adj - curBal), billInt);
      const billDate = toInputDateString(b.BILL_DATE ?? b.bill_date) || line.bill_date;
      const billNo = String(b.BILL_NO ?? b.bill_no ?? '');
      return {
        code: line.code,
        name: line.name,
        schedule: line.schedule,
        v_date: line.v_date || vrDate,
        chq_no: line.chq_no,
        dc_code: line.dc_code || dcCode,
        dr_amt: isCust ? '' : fmtAmt(adj),
        cr_amt: isCust ? fmtAmt(adj) : '',
        int_amt: fmtAmt(intAmt),
        bill_date: billDate,
        bill_no: billNo,
        b_type: String(b.B_TYPE ?? b.b_type ?? ' ').trim(),
        detail: `Bill ${toDisplayDate(billDate)} #${billNo}`.slice(0, 254),
        cd_amt: fmtAmt(cdAmt),
        cd_per: cdPer !== 0 ? fmtAmt(cdPer) : '',
      };
    };

    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...billLine(picked[0]) };
      if (picked.length > 1) {
        const extras = picked.slice(1).map((b, i) => ({
          ...emptyLine(vrDate, dcCode, line.code, idx + i + 2),
          ...billLine(b),
        }));
        next.splice(idx + 1, 0, ...extras);
      }
      return next.map((l, i) => ({ ...l, trn_no: i + 1 }));
    });
    setActiveLine(idx + picked.length - 1);
  };

  const handleSave = async (saveMode) => {
    if (!can?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (saveMode === 'add' && !can?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    if (saveMode === 'edit' && !can?.canEdit) {
      alert('You Can Not Edit');
      return;
    }
    if (saveMode === 'delete' && !can?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const ymd = clampYmdToFinYear(vrDate, finYear.fyMinYmd, finYear.fyMaxYmd);
    if (!ymd) {
      alert('Voucher date must be within the financial year.');
      return;
    }
    if (saveMode === 'delete' && !originalRef.current) {
      alert('Load a voucher first.');
      return;
    }
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      mode: saveMode,
      header: {
        vr_type: vrType,
        vr_date: toOracleDate(ymd),
        vr_no: vrNo ? Number(vrNo) : undefined,
        type: vrType === 'CV' ? docType : 'N',
        dc_code: dcCode ? Number(dcCode) : null,
        cd_vr_type: cdVrType || null,
        cd_vr_date: cdVrDate ? toOracleDate(cdVrDate) : null,
        cd_vr_no: cdVrNo ? Number(cdVrNo) : null,
        int_vr_type: intVrType || null,
        int_vr_date: intVrDate ? toOracleDate(intVrDate) : null,
        int_vr_no: intVrNo ? Number(intVrNo) : null,
      },
      lines: lines
        .filter((l) => l.code)
        .map((l, i) => ({
          trn_no: i + 1,
          code: Number(l.code),
          dc_code: vrType === 'JV' ? Number(l.dc_code || dcCode || l.code) : Number(dcCode),
          v_date: toOracleDate(l.v_date || ymd),
          chq_no: l.chq_no,
          detail: l.detail,
          bill_date: l.bill_date ? toOracleDate(l.bill_date) : null,
          bill_no: l.bill_no !== '' ? Number(l.bill_no) : null,
          b_type: l.b_type || ' ',
          dr_amt: parseAmt(l.dr_amt),
          cr_amt: parseAmt(l.cr_amt),
          int_amt: parseAmt(l.int_amt),
          cd_amt: parseAmt(l.cd_amt),
          cd_per: parseAmt(l.cd_per),
        })),
      original: originalRef.current,
    };
    if (saveMode !== 'delete' && !payload.lines.length) {
      alert('Add at least one line with party code.');
      return;
    }
    if (saveMode !== 'delete' && vrType === 'JV') {
      const sumDr = payload.lines.reduce((s, l) => s + (Number(l.dr_amt) || 0), 0);
      const sumCr = payload.lines.reduce((s, l) => s + (Number(l.cr_amt) || 0), 0);
      if (Math.abs(sumDr - sumCr) > 0.005) {
        alert(
          `Journal voucher is not balanced.\nTotal Dr: ${sumDr.toFixed(2)}\nTotal Cr: ${sumCr.toFixed(2)}`
        );
        return;
      }
    }
    setErr('');
    try {
      const { data } = await axios.post(`${apiBase}/api/voucher-save`, payload, reqOpts);
      if (saveMode === 'delete') {
        alert('Voucher deleted.');
        resetNew();
        return;
      }
      setVrNo(String(data.vr_no ?? vrNo));
      setCdVrType(String(data.cd_vr_type ?? ''));
      setCdVrDate(toInputDateString(data.cd_vr_date) || '');
      setCdVrNo(String(data.cd_vr_no ?? ''));
      setIntVrType(String(data.int_vr_type ?? ''));
      setIntVrDate(toInputDateString(data.int_vr_date) || '');
      setIntVrNo(String(data.int_vr_no ?? ''));
      originalRef.current = {
        vr_type: data.vr_type,
        vr_date: data.vr_date,
        vr_no: data.vr_no,
        type: data.type,
      };
      setMode('edit');
      alert(saveMode === 'add' ? 'Voucher saved.' : 'Voucher updated.');
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Save failed';
      setErr(msg);
      alert(msg);
    }
  };

  const activeParty = lines[activeLine];

  const renderVrTypeSegment = () => (
    <div className="voucher-entry-panel__field">
      <span className="voucher-entry-panel__label">Type</span>
      <div className="voucher-entry-segment" role="group" aria-label="Voucher type">
        {['CV', 'BV', 'JV'].map((t) => (
          <button
            key={t}
            type="button"
            className={`voucher-entry-segment__btn${vrType === t ? ' is-active' : ''}`}
            disabled={isReadOnly}
            onClick={() => changeVrType(t)}
          >
            {t === 'CV' ? 'Cash' : t === 'BV' ? 'Bank' : 'Journal'}
          </button>
        ))}
      </div>
    </div>
  );

  const renderVrDateField = () => (
    <label className="voucher-entry-panel__field">
      <span className="voucher-entry-panel__label">Voucher date</span>
      <input
        ref={vrDateRef}
        className="form-input"
        type="date"
        data-voucher-focus="vr-date"
        value={vrDate}
        readOnly={isReadOnly}
        onChange={(e) => setVrDateAndSync(e.target.value)}
      />
    </label>
  );

  const renderDocTypeField = () =>
    vrType === 'CV' ? (
      <label className="voucher-entry-panel__field">
        <span className="voucher-entry-panel__label">Type</span>
        <select
          className="form-input"
          data-voucher-focus="doc-type"
          value={docType}
          disabled={isReadOnly}
          onChange={(e) => setDocType(e.target.value)}
        >
          <option value="N">Normal</option>
          <option value="R">Receipt</option>
        </select>
      </label>
    ) : null;

  const renderVrNoField = () => (
    <label className="voucher-entry-panel__field">
      <span className="voucher-entry-panel__label">Vr. number</span>
      <input
        className="form-input voucher-entry-panel__input-narrow"
        data-voucher-focus="vr-no"
        value={vrNo}
        readOnly={isReadOnly}
        onChange={(e) => setVrNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
      />
    </label>
  );

  const renderCompactTotals = () => (
    <div className="voucher-entry-compact-totals" aria-label="Session totals">
      <div className="voucher-entry-compact-total voucher-entry-compact-total--dr">
        <span className="voucher-entry-compact-total__label">Total Dr</span>
        <span className="voucher-entry-compact-total__value">{fmtTotal(lineTotals.dr)}</span>
      </div>
      <div className="voucher-entry-compact-total voucher-entry-compact-total--cr">
        <span className="voucher-entry-compact-total__label">Total Cr</span>
        <span className="voucher-entry-compact-total__value">{fmtTotal(lineTotals.cr)}</span>
      </div>
    </div>
  );

  const renderSummaryPanel = () => (
    <section className="voucher-entry-panel voucher-entry-panel--summary">
      <h3 className="voucher-entry-panel__title">Session summary</h3>
      <div className="voucher-entry-summary-totals">
        <div className="voucher-entry-summary-box voucher-entry-summary-box--dr">
          <span className="voucher-entry-summary-box__label">Total Dr</span>
          <span className="voucher-entry-summary-box__value">{fmtTotal(lineTotals.dr)}</span>
        </div>
        <div className="voucher-entry-summary-box voucher-entry-summary-box--cr">
          <span className="voucher-entry-summary-box__label">Total Cr</span>
          <span className="voucher-entry-summary-box__value">{fmtTotal(lineTotals.cr)}</span>
        </div>
      </div>
      <div className="voucher-entry-panel__help">
        <ReportHelpButton reportId="voucher-entry" label="View help guide" />
      </div>
    </section>
  );

  const renderDcAccountField = () =>
    vrType !== 'JV' ? (
      <div className="voucher-entry-panel__field voucher-entry-dc-field">
        <span className="voucher-entry-panel__label">Cash / bank account</span>
        <div className="voucher-entry-dc-line">
          <div className="voucher-entry-dc-code" data-voucher-focus="dc-code">
            <MasterPartyPickList
              options={dcAccounts}
              value={dcCode}
              disabled={isReadOnly}
              title={vrType === 'CV' ? 'Cash account' : 'Bank account'}
              placeholder="Code"
              filterPlaceholder="Search…"
              dataMpField="voucher-dc-code"
              panelVariant="voucherParty"
              showSearchIcon
              searchBtnTabIndex={-1}
              getValue={(a) => String(a.CODE ?? a.code ?? '')}
              getLabel={acctLabel}
              getTriggerLabel={(a) => String(a.CODE ?? a.code ?? '')}
              getOptionLabel={(a) => String(a.CODE ?? a.code ?? '')}
              getOptionHint={(a) => String(a.NAME ?? a.name ?? '')}
              getOptionCity={(a) => String(a.CITY ?? a.city ?? '').trim()}
              onChange={setDcCode}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (e.target.closest('.master-party-pick__panel')) return;
                e.preventDefault();
                if (isMobileLayout) return;
                focusVoucherField(slideRootRef.current, 'line-0-code');
              }}
              onAfterSelect={() => {
                if (isMobileLayout) return;
                focusVoucherField(slideRootRef.current, 'line-0-code');
              }}
            />
          </div>
          <span className={`voucher-entry-dc-badge${dcName ? '' : ' is-empty'}`} title={dcName || undefined}>
            {dcName || 'Account name'}
          </span>
        </div>
      </div>
    ) : null;

  if (loading && !can) {
    return (
      <div className="slide slide-28-voucher-entry slide-28-voucher-entry--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Voucher entry</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!can?.canOpen) {
    return (
      <div className="slide slide-28-voucher-entry">
        <h2 className="sale-bill-page__title">Voucher entry</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F3).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  if (listScreenOpen) {
    return (
      <VoucherEntryListScreen
        apiBase={apiBase}
        formData={formData}
        defaultVrType={vrType}
        onClose={() => setListScreenOpen(false)}
        onOpenVoucher={(row) => void openVoucherFromList(row)}
      />
    );
  }

  return (
    <div
      ref={slideRootRef}
      className="slide slide-28-voucher-entry sale-bill-page sale-entry-desktop"
      data-vr-type={vrType}
      onKeyDown={handleEnterAsTab}
      role="presentation"
    >
      {isMobileLayout ? (
        <SaleEntryScreenHeader
          title="Voucher entry"
          reportId="voucher-entry"
          topBar={<SaleEntryTopBar formData={formData} ctx={ctx} userName={userName} can={can} />}
          nav={null}
        />
      ) : (
        <SaleEntryTopBar formData={formData} ctx={ctx} userName={userName} can={can} />
      )}

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className={`voucher-entry-card${isReadOnly ? ' is-readonly' : ''}`}>
      <div className="voucher-entry-panels">
        {isMobileLayout ? (
          <>
            <section className="voucher-entry-panel voucher-entry-panel--mobile-main">
              <h3 className="voucher-entry-panel__title">Voucher entry</h3>
              {renderVrTypeSegment()}
              {renderVrDateField()}
              {renderDocTypeField()}
              {renderVrNoField()}
              {renderDcAccountField()}
            </section>
            {renderSummaryPanel()}
          </>
        ) : (
          <div className="voucher-entry-panels voucher-entry-panels--desktop-compact">
            <div className="voucher-entry-compact-left">
              {renderVrTypeSegment()}
              {renderDcAccountField()}
            </div>
            <div className="voucher-entry-compact-top-row">
              {renderVrDateField()}
              {renderDocTypeField()}
              {renderVrNoField()}
              {renderCompactTotals()}
            </div>
          </div>
        )}
      </div>

      <div className="voucher-entry-body">
        <div className="voucher-entry-grid">
          <div className="voucher-entry-lines-wrap">
            <table className="voucher-entry-lines">
              {renderVoucherLinesColgroup()}
              {renderVoucherLinesHead()}
              <tbody>
            {lines.map((line, idx) => (
              <tr
                key={idx}
                className={activeLine === idx ? 'is-active' : ''}
                onClick={() => setActiveLine(idx)}
              >
                <td className="voucher-col-td-num">{idx + 1}</td>
                <td className="voucher-entry-code-cell" data-voucher-focus={`line-${idx}-code`}>
                  <MasterPartyPickList
                    options={lookups.parties}
                    value={line.code}
                    disabled={isReadOnly}
                    title="Party"
                    placeholder="Search account…"
                    filterPlaceholder="Search party…"
                    dataMpField={`voucher-line-code-${idx}`}
                    panelVariant="voucherParty"
                    showSearchIcon
                    searchBtnTabIndex={-1}
                    getValue={(p) => String(p.CODE ?? p.code ?? '')}
                    getLabel={partyLabel}
                    getTriggerLabel={(p) => String(p.CODE ?? p.code ?? '')}
                    getOptionLabel={(p) => String(p.CODE ?? p.code ?? '')}
                    getOptionHint={(p) => String(p.NAME ?? p.name ?? '').trim()}
                    getOptionCity={(p) => String(p.CITY ?? p.city ?? '').trim()}
                    onChange={(c) => pickParty(idx, c)}
                    onAfterSelect={() => {
                      if (isMobileLayout) return;
                      focusVoucherField(slideRootRef.current, `line-${idx}-vdate`);
                    }}
                  />
                  {!isReadOnly ? (
                    <PartyAddButton onClick={() => setPartyAddOpen(true)} title="Add party" />
                  ) : null}
                </td>
                <td className="voucher-entry-name-cell" title={line.name || undefined}>{line.name}</td>
                <td className="voucher-col-td-num">{line.schedule}</td>
                <td>
                  <input
                    className="form-input voucher-entry-vdate"
                    type="date"
                    data-voucher-focus={`line-${idx}-vdate`}
                    readOnly={isReadOnly}
                    value={line.v_date || vrDate}
                    onChange={(e) => updateLine(idx, { v_date: e.target.value })}
                  />
                </td>
                {vrType === 'BV' ? (
                  <td>
                    <input
                      className="form-input voucher-entry-mini"
                      data-voucher-focus={`line-${idx}-chq`}
                      maxLength={8}
                      readOnly={isReadOnly}
                      value={line.chq_no}
                      onChange={(e) => updateLine(idx, { chq_no: e.target.value })}
                    />
                  </td>
                ) : null}
                <td>
                  <input
                    className="form-input voucher-entry-detail"
                    data-voucher-focus={`line-${idx}-detail`}
                    readOnly={isReadOnly}
                    value={line.detail}
                    onChange={(e) => updateLine(idx, { detail: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-mini"
                    type="date"
                    data-voucher-focus={`line-${idx}-billdt`}
                    readOnly={isReadOnly}
                    value={line.bill_date}
                    onChange={(e) => updateLine(idx, { bill_date: e.target.value })}
                  />
                </td>
                <td className="voucher-col-td-num">
                  <input
                    className="form-input voucher-entry-mini voucher-entry-mini--num"
                    data-voucher-focus={`line-${idx}-billno`}
                    readOnly={isReadOnly}
                    value={line.bill_no}
                    onChange={(e) => updateLine(idx, { bill_no: e.target.value.replace(/\D/g, '') })}
                  />
                </td>
                <td className="voucher-col-td-num">
                  <input
                    className="form-input voucher-entry-btype voucher-entry-btype--num"
                    data-voucher-focus={`line-${idx}-btype`}
                    maxLength={1}
                    readOnly={isReadOnly}
                    value={line.b_type}
                    onChange={(e) => updateLine(idx, { b_type: e.target.value.toUpperCase().slice(0, 1) })}
                  />
                </td>
                <td className="voucher-entry-bills-help">
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs voucher-entry-bills-btn"
                    title="Pending bills (F1)"
                    disabled={isReadOnly}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveLine(idx);
                      setPendingOpen(true);
                    }}
                  >
                    ?
                  </button>
                </td>
                <td className="voucher-col-td-num">
                  <input
                    className="form-input voucher-entry-amt"
                    data-voucher-focus={`line-${idx}-dr`}
                    readOnly={isReadOnly}
                    value={line.dr_amt}
                    onChange={(e) => updateLine(idx, { dr_amt: e.target.value })}
                  />
                </td>
                <td className="voucher-col-td-num">
                  <input
                    className="form-input voucher-entry-amt"
                    data-voucher-focus={`line-${idx}-cr`}
                    readOnly={isReadOnly}
                    value={line.cr_amt}
                    onChange={(e) => updateLine(idx, { cr_amt: e.target.value })}
                  />
                </td>
                <td className="voucher-col-td-num">
                  <input
                    className="form-input voucher-entry-amt"
                    data-voucher-focus={`line-${idx}-int`}
                    readOnly={isReadOnly}
                    value={line.int_amt}
                    onChange={(e) => updateLine(idx, { int_amt: e.target.value })}
                  />
                </td>
                <td className="voucher-col-td-num">
                  <input
                    className="form-input voucher-entry-amt"
                    data-voucher-focus={`line-${idx}-cd`}
                    readOnly={isReadOnly}
                    value={line.cd_amt}
                    onChange={(e) => updateLine(idx, { cd_amt: e.target.value })}
                  />
                </td>
                <td className="voucher-entry-row-actions">
                  {!isReadOnly ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLine(idx);
                    }}
                  >
                    ×
                  </button>
                  ) : null}
                </td>
              </tr>
            ))}
              </tbody>
            </table>
          </div>
          <div className="voucher-entry-lines-tfoot-wrap">{renderVoucherLinesTotals()}</div>
        </div>
      </div>

      <div className="voucher-entry-footer-bar">
        {!isMobileLayout && (ctx?.G_CD_TRF === 'Y' || ctx?.G_INT_TRF === 'Y') ? (
          <div className="voucher-entry-footer-transfer voucher-entry-footer-transfer-desktop">
            {ctx?.G_CD_TRF === 'Y' ? (
              <div className="voucher-entry-footer-transfer-group">
                <span className="voucher-entry-footer-transfer-group__label">Cd JV</span>
                <input
                  className="form-input voucher-entry-footer-transfer-group__type"
                  readOnly
                  tabIndex={-1}
                  value={cdVrType || ''}
                  placeholder="Type"
                  aria-label="Cd JV type"
                />
                <input
                  className="form-input voucher-entry-footer-transfer-group__date"
                  readOnly
                  tabIndex={-1}
                  value={cdVrDate ? toDisplayDate(cdVrDate) : ''}
                  placeholder="Date"
                  aria-label="Cd JV date"
                />
                <input
                  className="form-input voucher-entry-footer-transfer-group__no"
                  readOnly
                  tabIndex={-1}
                  value={formatTransferVrNo(cdVrNo)}
                  placeholder="Vr. no"
                  aria-label="Cd JV number"
                />
              </div>
            ) : null}
            {ctx?.G_INT_TRF === 'Y' ? (
              <div className="voucher-entry-footer-transfer-group">
                <span className="voucher-entry-footer-transfer-group__label">Int JV</span>
                <input
                  className="form-input voucher-entry-footer-transfer-group__type"
                  readOnly
                  tabIndex={-1}
                  value={intVrType || ''}
                  placeholder="Type"
                  aria-label="Int JV type"
                />
                <input
                  className="form-input voucher-entry-footer-transfer-group__date"
                  readOnly
                  tabIndex={-1}
                  value={intVrDate ? toDisplayDate(intVrDate) : ''}
                  placeholder="Date"
                  aria-label="Int JV date"
                />
                <input
                  className="form-input voucher-entry-footer-transfer-group__no"
                  readOnly
                  tabIndex={-1}
                  value={formatTransferVrNo(intVrNo)}
                  placeholder="Vr. no"
                  aria-label="Int JV number"
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="voucher-entry-footer-actions">
          <div className="voucher-entry-footer-group">
            <button type="button" className="voucher-entry-action-btn voucher-entry-action-btn--nav" onClick={onPrev}>
              ← Back
            </button>
            <button type="button" className="voucher-entry-action-btn voucher-entry-action-btn--nav" onClick={onReset}>
              Home
            </button>
            <button
              type="button"
              className="voucher-entry-action-btn voucher-entry-action-btn--nav"
              onClick={() => setListScreenOpen(true)}
            >
              List
            </button>
            <button
              type="button"
              className="voucher-entry-action-btn voucher-entry-action-btn--nav"
              onClick={() => void loadVoucher()}
            >
              Load
            </button>
            {!isMobileLayout ? (
              <span className="voucher-entry-footer-help">
                <ReportHelpButton reportId="voucher-entry" />
              </span>
            ) : null}
          </div>
          <div className="voucher-entry-footer-group voucher-entry-footer-group--vouprn">
            <span className="voucher-entry-footer-vouprn-label">VouPrn</span>
            <button
              type="button"
              className="voucher-entry-action-btn voucher-entry-action-btn--nav"
              disabled={!canPrintVoucher}
              onClick={handleVouPrint}
            >
              Print
            </button>
            {!isMobileLayout ? (
              <button
                type="button"
                className="voucher-entry-action-btn voucher-entry-action-btn--nav"
                disabled={!canPrintVoucher}
                onClick={handleVouPdf}
              >
                Pdf
              </button>
            ) : null}
            <button
              type="button"
              className="voucher-entry-action-btn voucher-entry-action-btn--nav voucher-entry-action-btn--whatsapp"
              disabled={!canPrintVoucher}
              onClick={handleVouWhatsApp}
            >
              WhatsApp
            </button>
          </div>
          <div className="voucher-entry-footer-group voucher-entry-footer-group--crud">
            {can?.canAdd ? (
              <button type="button" className="voucher-entry-action-btn voucher-entry-action-btn--add" onClick={resetNew}>
                + Add
              </button>
            ) : null}
            {can?.canEdit ? (
              <button
                type="button"
                className="voucher-entry-action-btn voucher-entry-action-btn--edit"
                onClick={startEditing}
                disabled={mode !== 'view'}
              >
                Edit
              </button>
            ) : null}
            {hasLoadedVoucher && can?.canDelete ? (
              <button
                type="button"
                className="voucher-entry-action-btn voucher-entry-action-btn--delete"
                onClick={handleDelete}
              >
                Delete
              </button>
            ) : null}
            {mode === 'new' && can?.canAdd ? (
              <button
                type="button"
                className="voucher-entry-action-btn voucher-entry-action-btn--save"
                onClick={() => void handleSave('add')}
              >
                Save
              </button>
            ) : null}
            {mode === 'edit' && can?.canEdit ? (
              <button
                type="button"
                className="voucher-entry-action-btn voucher-entry-action-btn--save"
                onClick={() => void handleSave('edit')}
              >
                Save
              </button>
            ) : null}
          </div>
        </div>
      </div>
      </div>

      <MasterPartyCreateModal
        open={partyAddOpen}
        onClose={() => setPartyAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        onCreated={(data) => {
          setPartyAddOpen(false);
          axios
            .get(`${apiBase}/api/voucher-entry-lookups`, {
              params: { comp_code: compCode, comp_uid: compUid },
              ...reqOpts,
            })
            .then(({ data: lu }) => {
              setLookups(lu);
              if (data?.code != null) pickParty(activeLine, String(data.code));
            });
        }}
      />

      <VoucherPendingBillsModal
        open={pendingOpen}
        onClose={() => setPendingOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        partyCode={activeParty?.code}
        partyName={activeParty?.name}
        schedule={activeParty?.schedule}
        vDate={toOracleDate(activeParty?.v_date || vrDate)}
        pndBills={ctx?.G_PND_BILLS ?? 0}
        vouIntShow={ctx?.G_VOU_INT_SHOW ?? 'Y'}
        gCdCal={ctx?.G_CD_CAL ?? 'N'}
        onApply={applyPendingBills}
      />

      <VoucherReportPreviewModal
        open={voucherPreviewOpen}
        onClose={() => setVoucherPreviewOpen(false)}
        reportType="voucher-print"
        data={voucherPrintData}
        metadata={voucherPrintMeta}
        shareText={voucherPrintShareText}
        title={`${vrType === 'CV' && docType === 'R' ? 'Cash receipt' : 'Voucher'} ${vrType} · ${vrNo || '—'}`}
      />
    </div>
  );
}
