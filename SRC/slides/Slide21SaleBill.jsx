import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate, normalizeHtmlDateValue } from '../utils/dateFormat';
import SaleBillPrintModal from '../components/SaleBillPrintModal';

const reqOpts = { withCredentials: true, timeout: 120000 };

/** Maps SALE.TYPE (1–9) to print API letter bucket (same as Slide13). */
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

function parseCal(v) {
  const d = String(v ?? '1').replace(/\D/g, '').slice(0, 1);
  return d === '2' ? 2 : 1;
}

/** Show blank instead of 0 so numeric fields are easier to type into. */
function dispNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(n);
}

function parseNumInput(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === '-' || s === '.') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Max 9999999999.999 (WEIGHT); max 9999999999.99 (LABOUR, FREIGHT, INS, OTH_EXP). */
const SALE_MAX_WEIGHT = 9999999999.999;
const SALE_MAX_CHARGE = 9999999999.99;

function clampSaleWeight(n) {
  const x = Number(n) || 0;
  const c = Math.max(0, Math.min(SALE_MAX_WEIGHT, x));
  return Math.round(c * 1000) / 1000;
}

function clampSaleCharge(n) {
  const x = Number(n) || 0;
  const c = Math.max(0, Math.min(SALE_MAX_CHARGE, x));
  return Math.round(c * 100) / 100;
}

/** Oth / round-off may be negative (paise adjustment to whole rupees). */
function clampSaleOthSigned(n) {
  const x = Number(n) || 0;
  const c = Math.max(-SALE_MAX_CHARGE, Math.min(SALE_MAX_CHARGE, x));
  return Math.round(c * 100) / 100;
}

/** Shown when field is not being edited: trim trailing zeros; blank for zero. */
function committedWeightStr(v) {
  const n = clampSaleWeight(Number(v));
  if (n === 0) return '';
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
}

function committedChargeStr(v) {
  const n = clampSaleCharge(Number(v));
  if (n === 0) return '';
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
}

/**
 * Keeps a single decimal point and caps integer / fraction length while typing
 * (avoids toFixed on every keystroke, which breaks "12." and similar).
 */
function sanitizeNonNegDecimal(raw, maxIntDigits, maxFracDigits) {
  const s0 = String(raw ?? '').replace(/,/g, '');
  if (s0.trim() === '') return '';
  let s = s0.replace(/[^\d.]/g, '');
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = `${s.slice(0, firstDot + 1)}${s.slice(firstDot + 1).replace(/\./g, '')}`;
  }
  const dot = s.indexOf('.');
  let intPart = dot === -1 ? s : s.slice(0, dot);
  let fracPart = dot === -1 ? '' : s.slice(dot + 1);
  intPart = intPart.replace(/\D/g, '').slice(0, maxIntDigits);
  fracPart = fracPart.replace(/\D/g, '').slice(0, maxFracDigits);
  if (dot === -1) return intPart;
  const trailingDot = s0.trim().endsWith('.') && fracPart === '';
  if (trailingDot) return intPart === '' ? '.' : `${intPart}.`;
  if (intPart === '' && fracPart !== '') return `0.${fracPart}`;
  if (intPart === '' && fracPart === '') return '';
  return `${intPart}.${fracPart}`;
}

/** Like {@link sanitizeNonNegDecimal} but allows a single leading minus (oth/roff). */
function sanitizeSignedOthDecimal(raw, maxIntDigits, maxFracDigits) {
  const s0 = String(raw ?? '').replace(/,/g, '').trim();
  if (s0 === '') return '';
  const neg = s0.startsWith('-');
  const core = neg ? s0.slice(1) : s0;
  const sanitized = sanitizeNonNegDecimal(core, maxIntDigits, maxFracDigits);
  if (sanitized === '') return neg ? '-' : '';
  if (sanitized === '.') return neg ? '-.' : '.';
  return neg ? `-${sanitized}` : sanitized;
}

function committedOthStr(v) {
  const n = clampSaleOthSigned(Number(v));
  if (n === 0) return '';
  const abs = Math.abs(n);
  const s = abs.toFixed(2).replace(/\.?0+$/, '') || '0';
  return n < 0 ? `-${s}` : s;
}

/** Rate / bk rate: round to 2 decimals (#######.00). */
function roundRate2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function fmtCellAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

/** Line tax / amount cells: always show two decimals (including 0.00). */
function fmtAmtAlways(v) {
  const n = Number(v);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function clampTaxPer(n) {
  const x = Number(n) || 0;
  return Math.max(0, Math.min(100, Math.round(x * 100) / 100));
}

/**
 * Fox-style line weight from qty, status, UNIT_WGT (item), G_AMT_CAL (COMPDET amt_cal).
 * When UNIT_WGT≠0: G_AMT_CAL='K' → ROUND(QNTY×UNIT_WGT,3), else ROUND(QNTY×UNIT_WGT/100,3).
 * When UNIT_WGT=0: STATUS B/K/H use fixed factors; else if G_AMT_CAL='K' use ROUND(existingWeight×100,3) when weight>0, else ROUND(QNTY×100,3).
 */
function computeLineWeight(qnty, status, unitWgt, gAmtCal, existingWeight) {
  const q = Number(qnty) || 0;
  if (q <= 0) return null;
  const uw = Number(unitWgt) || 0;
  const gk = String(gAmtCal ?? '').trim().toUpperCase();
  const st = String(status ?? 'B').trim().toUpperCase().slice(0, 1) || 'B';

  if (uw !== 0) {
    const prod = q * uw;
    const w = gk === 'K' ? Math.round(prod * 1000) / 1000 : Math.round((prod / 100) * 1000) / 1000;
    return clampSaleWeight(w);
  }

  if (st === 'B') return clampSaleWeight(Math.round((q * 100) / 100 * 1000) / 1000);
  if (st === 'K') return clampSaleWeight(Math.round((q * 50) / 100 * 1000) / 1000);
  if (st === 'H') return clampSaleWeight(Math.round((q * 30) / 100 * 1000) / 1000);

  if (gk === 'K') {
    const ew = Number(existingWeight) || 0;
    if (ew > 0) return clampSaleWeight(Math.round(ew * 100 * 1000) / 1000);
    return clampSaleWeight(Math.round(q * 100 * 1000) / 1000);
  }

  return null;
}

function focusNextInForm(rootEl, currentEl) {
  if (!rootEl || !currentEl) return;
  const list = Array.from(rootEl.querySelectorAll('input:not([type="hidden"]):not([type="button"]), select, textarea')).filter(
    (el) => !el.disabled && !el.readOnly && el.getAttribute('tabindex') !== '-1'
  );
  const i = list.indexOf(currentEl);
  if (i >= 0 && i < list.length - 1) {
    list[i + 1].focus();
  }
}

function handleEnterAsTab(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!t || t.closest('.slide-21-sale-bill-ignore-enter')) return;
  if (t.tagName === 'TEXTAREA') return;
  if (t.tagName === 'BUTTON' && (t.type === 'submit' || t.getAttribute('type') === 'submit')) return;
  if (t.tagName === 'INPUT' && (t.type === 'submit' || t.type === 'button')) return;
  e.preventDefault();
  const root = t.closest('.slide-21-sale-bill');
  if (root) focusNextInForm(root, t);
}

function highlightMatch(text, q) {
  if (text == null) return null;
  const s = String(text);
  const query = String(q ?? '').trim();
  if (!query) return s;
  const lower = s.toLowerCase();
  const qi = lower.indexOf(query.toLowerCase());
  if (qi === -1) return s;
  return (
    <>
      {s.slice(0, qi)}
      <mark className="search-highlight">{s.slice(qi, qi + query.length)}</mark>
      {s.slice(qi + query.length)}
    </>
  );
}

function emptyLine(defaultPlant = '') {
  const pc = String(defaultPlant ?? '').trim();
  return {
    trn_no: 1,
    item_code: '',
    item_name: '',
    s_code: '',
    marka: '',
    plant_code: pc,
    qnty: 0,
    status: 'B',
    cal: '1',
    weight: 0,
    rate: 0,
    amount: 0,
    dis_per: 0,
    dis_amt: 0,
    taxable: 0,
    cgst_per: 0,
    sgst_per: 0,
    igst_per: 0,
    cgst_amt: 0,
    sgst_amt: 0,
    igst_amt: 0,
    bk_rate: 0,
    bk_bw: 'A',
    bk_amt: 0,
    unit_wgt: 0,
    /** When true, qty/status/item-driven weight is not overwritten (user typed weight). */
    weight_manual: false,
  };
}

/** maxLength=1 controlled fields: the browser appends if the existing char is not selected; slice(0,1) would keep the old letter. */
function singleCharFromInput(raw) {
  const u = String(raw ?? '').toUpperCase();
  if (!u) return '';
  return u.length > 1 ? u.slice(-1) : u.slice(0, 1);
}

/** Single-char fields: select all on focus so the next key replaces (avoids maxLength=1 append stuck on first letter). */
function selectAllOnFocus(e) {
  const el = e?.target;
  if (!el || typeof el.select !== 'function') return;
  requestAnimationFrame(() => {
    try {
      el.select();
    } catch (_) {}
  });
}

export default function Slide21SaleBill({ apiBase, formData, userName, onPrev, onReset }) {
  const lastPostedBillRef = useRef(null);
  /** Bumps when a new bill-slot fetch starts; stale responses must not overwrite UI (Prev vs late Next). */
  const billSlotFetchGenRef = useRef(0);
  const billNoRef = useRef('');
  const modeRef = useRef('new');
  /** When Prev/Next lands on an empty slot from Edit, we set mode to `new` without re-running Edit→New reset. */
  const skipClearOnEditToNewEffectRef = useRef(false);
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compS = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const compE = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [perm, setPerm] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [parties, setParties] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [lookups, setLookups] = useState({ markas: [], plants: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [invoiceKind, setInvoiceKind] = useState('retail');
  const typeNum = invoiceKind === 'tax' ? 3 : 1;
  const vrType = invoiceKind === 'tax' ? 'Y' : 'S';

  const [bType, setBType] = useState('N');
  const [billDateYmd, setBillDateYmd] = useState(() => toInputDateString(new Date()));
  const [mode, setMode] = useState('new');
  const [billNo, setBillNo] = useState('');
  const [saleInvNo, setSaleInvNo] = useState('');
  /** After first successful Save new bill, further saves use edit until Next bill clears the form. */
  const [postedNewBill, setPostedNewBill] = useState(false);

  useEffect(() => {
    billNoRef.current = String(billNo ?? '').trim();
  }, [billNo]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const [code, setCode] = useState('');
  const [delvCode, setDelvCode] = useState('');
  const [bCode, setBCode] = useState('');
  const [billedSearch, setBilledSearch] = useState('');
  const [shippedSearch, setShippedSearch] = useState('');
  const [brokerSearch, setBrokerSearch] = useState('');
  const [billedHi, setBilledHi] = useState(0);
  const [shippedHi, setShippedHi] = useState(0);
  const [brokerHi, setBrokerHi] = useState(0);
  /** When false, search + list are hidden after a value is chosen; user uses Change / Add to reopen. */
  const [billedFinderOpen, setBilledFinderOpen] = useState(true);
  const [shippedFinderOpen, setShippedFinderOpen] = useState(false);
  const [brokerFinderOpen, setBrokerFinderOpen] = useState(false);
  const [days, setDays] = useState(0);
  const [partyGst, setPartyGst] = useState('');
  const [compGst, setCompGst] = useState('');

  const [labour, setLabour] = useState(0);
  const [freight, setFreight] = useState(0);
  const [ins, setIns] = useState(0);
  const [othExp, setOthExp] = useState(0);
  const [addCode, setAddCode] = useState('');
  /** Raw text while editing decimal fields (null = show committed numeric string). */
  const [labourText, setLabourText] = useState(null);
  const [freightText, setFreightText] = useState(null);
  const [insText, setInsText] = useState(null);
  const [othExpText, setOthExpText] = useState(null);
  const [lineWeightEdit, setLineWeightEdit] = useState(null);
  const [tdsOnAmt, setTdsOnAmt] = useState(0);
  const [tdsPer, setTdsPer] = useState(0);
  const [tdsAmt, setTdsAmt] = useState(0);

  const [truckNo, setTruckNo] = useState('');
  const [tpt, setTpt] = useState('');
  const [grNo, setGrNo] = useState('');

  const [lines, setLines] = useState([emptyLine()]);
  const [billPick, setBillPick] = useState([]);
  const [pickListDateYmd, setPickListDateYmd] = useState('');
  const [pickListBillNo, setPickListBillNo] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [billPrintParams, setBillPrintParams] = useState(null);

  const billDateOracle = useMemo(() => toOracleDate(billDateYmd), [billDateYmd]);
  const compYear = String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim();

  const billedPartyInfo = useMemo(() => {
    if (!code) return null;
    return parties.find((p) => String(p.CODE ?? p.code) === String(code)) ?? null;
  }, [code, parties]);

  const shippedPartyInfo = useMemo(() => {
    if (!delvCode || String(delvCode) === String(code)) return null;
    return parties.find((p) => String(p.CODE ?? p.code) === String(delvCode)) ?? null;
  }, [delvCode, code, parties]);

  const shippedSameAsBilled = !delvCode || String(delvCode) === String(code);

  const filteredBilledParties = useMemo(() => {
    const q = billedSearch.trim().toLowerCase();
    if (!q) return parties.slice(0, 150);
    return parties.filter((p) => {
      const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return pc.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [parties, billedSearch]);

  const filteredShippedParties = useMemo(() => {
    const q = shippedSearch.trim().toLowerCase();
    if (!q) return parties.slice(0, 150);
    return parties.filter((p) => {
      const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return pc.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [parties, shippedSearch]);

  const filteredBrokersList = useMemo(() => {
    const q = brokerSearch.trim().toLowerCase();
    if (!q) return brokers.slice(0, 150);
    return brokers.filter((p) => {
      const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return pc.includes(q) || name.includes(q) || city.includes(q);
    });
  }, [brokers, brokerSearch]);

  useEffect(() => {
    setBilledHi(0);
  }, [billedSearch]);
  useEffect(() => {
    setShippedHi(0);
  }, [shippedSearch]);
  useEffect(() => {
    setBrokerHi(0);
  }, [brokerSearch]);

  useEffect(() => {
    if (!code) {
      setBilledFinderOpen(true);
      setShippedFinderOpen(false);
    }
  }, [code]);

  const safeBilledHi = Math.min(billedHi, Math.max(0, filteredBilledParties.length - 1));
  const safeShippedHi = Math.min(shippedHi, Math.max(0, filteredShippedParties.length - 1));
  const safeBrokerHi = Math.min(brokerHi, Math.max(0, filteredBrokersList.length - 1));

  const pickListRangeLabel = useMemo(() => {
    if (pickListDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(pickListDateYmd)) {
      return toDisplayDate(pickListDateYmd);
    }
    return `${toDisplayDate(compS)} – ${toDisplayDate(compE)}`;
  }, [pickListDateYmd, compS, compE]);

  const fyMinYmd = useMemo(() => {
    const raw = ctx?.COMP_S_DT ?? formData.comp_s_dt ?? formData.COMP_S_DT;
    const y = toInputDateString(raw);
    return y || compS || '';
  }, [ctx, formData, compS]);

  const fyMaxYmd = useMemo(() => {
    const raw = ctx?.COMP_E_DT ?? formData.comp_e_dt ?? formData.COMP_E_DT;
    const y = toInputDateString(raw);
    return y || compE || '';
  }, [ctx, formData, compE]);

  /** COMPDET GOD_CODE — default SALE.PLANT_CODE on new lines (same code in PLANT master). */
  const defaultPlantCode = useMemo(() => String(ctx?.G_PLANT_CODE ?? '').trim(), [ctx]);

  const permSummary = useMemo(() => {
    const p = perm;
    if (!p) return 'Sale bill: loading rights…';
    const any = !!(p.canOpen || p.canAdd || p.canEdit || p.canDelete);
    if (!any) return 'Sale bill: no access (F1).';
    const ok = [];
    if (p.canOpen) ok.push('Access');
    if (p.canAdd) ok.push('Add');
    if (p.canEdit) ok.push('Edit');
    if (p.canDelete) ok.push('Delete');
    if (ok.length === 0) return 'Sale bill: no access (F1).';
    return `Your rights: ${ok.join(', ')}.`;
  }, [perm]);

  const params = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName || '' }),
    [compCode, compUid, userName]
  );

  const loadBase = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [pRes, cRes, ptRes, brRes, luRes] = await Promise.all([
        axios.get(`${apiBase}/api/sale-bill-user-permissions`, { params, ...reqOpts }),
        axios.get(`${apiBase}/api/sale-bill-form-context`, { params: { comp_code: compCode, comp_uid: compUid }, ...reqOpts }),
        axios.get(`${apiBase}/api/sale-bill-master-by-schedule`, {
          params: { comp_code: compCode, comp_uid: compUid, schedule: 8.1 },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/sale-bill-master-by-schedule`, {
          params: { comp_code: compCode, comp_uid: compUid, schedule: 11.2 },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/sale-bill-lookups`, { params: { comp_code: compCode, comp_uid: compUid }, ...reqOpts }),
      ]);
      setPerm(pRes.data);
      setCtx(cRes.data);
      const roffC = String(cRes.data?.G_ROFF_CODE ?? cRes.data?.g_roff_code ?? '').trim();
      if (roffC) {
        setAddCode((prev) => (String(prev ?? '').trim() === '' ? roffC : prev));
      }
      setParties(ptRes.data || []);
      setBrokers(brRes.data || []);
      setLookups(luRes.data || { markas: [], plants: [], items: [] });
      const gGst = String(cRes.data?.G_GST_NO ?? '').trim();
      setCompGst(gGst);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, params]);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  const refreshNextBill = useCallback(async () => {
    if (!compCode || !compUid) return null;
    const gen = ++billSlotFetchGenRef.current;
    try {
      setErr('');
      const { data } = await axios.get(`${apiBase}/api/sale-bill-next-bill-no`, {
        params: { comp_code: compCode, comp_uid: compUid, type: typeNum, b_type: bType },
        ...reqOpts,
      });
      if (gen !== billSlotFetchGenRef.current) return null;
      const nb = data?.next_bill_no ?? 1;
      setBillNo(String(nb));
      const inv = await axios.get(`${apiBase}/api/sale-bill-inv-no-preview`, {
        params: { comp_code: compCode, comp_uid: compUid, type: typeNum, b_type: bType, bill_no: nb },
        ...reqOpts,
      });
      if (gen !== billSlotFetchGenRef.current) return null;
      setSaleInvNo(String(inv.data?.sale_inv_no ?? ''));
      return Number(nb) || 1;
    } catch (e) {
      if (gen === billSlotFetchGenRef.current) {
        setErr(e?.response?.data?.error || e.message || 'Next bill failed');
      }
      return null;
    }
  }, [apiBase, bType, compCode, compUid, typeNum]);

  useEffect(() => {
    if (mode === 'new') refreshNextBill();
  }, [mode, refreshNextBill]);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(''), 5500);
    const onKey = (e) => {
      if (e.key === 'Escape') setMsg('');
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [msg]);

  useEffect(() => {
    const d = defaultPlantCode;
    if (!d || mode !== 'new') return;
    setLines((prev) =>
      prev.map((L) => (String(L.plant_code || '').trim() === '' ? { ...L, plant_code: d } : L))
    );
  }, [defaultPlantCode, mode]);

  const loadBillPick = useCallback(
    async (override) => {
      if (!compCode || !compUid || !compS || !compE) return;
      const dateYmd = override && 'dateYmd' in override ? override.dateYmd : pickListDateYmd;
      const billNoRaw = override && 'billNo' in override ? override.billNo : pickListBillNo;
      try {
        const sDt = dateYmd ? toOracleDate(dateYmd) : toOracleDate(compS);
        const eDt = dateYmd ? toOracleDate(dateYmd) : toOracleDate(compE);
        const params = {
          comp_code: compCode,
          comp_uid: compUid,
          ptype: String(typeNum),
          s_date: sDt,
          e_date: eDt,
          b_type: bType,
        };
        const rawBn = String(billNoRaw || '').trim();
        if (rawBn !== '') {
          const stripped = rawBn.replace(/^[^0-9]+/, '');
          const num = Number(stripped !== '' ? stripped : rawBn);
          if (Number.isFinite(num)) params.sb_no = String(num);
        }
        const { data } = await axios.get(`${apiBase}/api/sale-bill-printing-list`, {
          params,
          ...reqOpts,
        });
        setBillPick(Array.isArray(data) ? data : []);
      } catch (e) {
        setBillPick([]);
      }
    },
    [apiBase, bType, compCode, compE, compS, compUid, pickListBillNo, pickListDateYmd, typeNum]
  );

  useEffect(() => {
    if (mode === 'edit' || mode === 'delete') loadBillPick();
  }, [loadBillPick, mode]);

  const applyBilledPartyPick = useCallback(
    (partyCode) => {
      const v = String(partyCode ?? '').trim();
      setCode(v);
      const row = parties.find((p) => String(p.CODE ?? p.code) === String(v));
      const due = Number(row?.DUE ?? row?.due ?? 0) || 0;
      const defD = Number(ctx?.G_DEF_DAYS ?? 0) || 0;
      setDays(due === 0 ? defD : due);
      setDelvCode(v);
      const gst = String(row?.GST_NO ?? row?.gst_no ?? '').trim();
      setPartyGst(gst);
      setTdsOnAmt(0);
      setBilledFinderOpen(false);
      setShippedFinderOpen(false);
    },
    [parties, ctx]
  );

  const applyItemToLine = (idx, itemCode) => {
    const it = lookups.items.find(
      (x) => String(x.ITEM_CODE ?? x.item_code ?? '').trim() === String(itemCode).trim()
    );
    setLines((prev) => {
      const next = [...prev];
      const row = { ...next[idx] };
      row.item_code = String(itemCode).trim();
      row.item_name = String(it?.ITEM_NAME ?? it?.item_name ?? '');
      row.s_code = it?.S_CODE != null ? String(it.S_CODE) : row.s_code;
      const tp = Number(it?.TAX_PER ?? it?.tax_per ?? 0) || 0;
      const pg = String(partyGst || '').slice(0, 2);
      const cg = String(compGst || '').slice(0, 2);
      if (tp !== 0 && pg && cg && pg === cg) {
        row.cgst_per = tp / 2;
        row.sgst_per = tp / 2;
        row.igst_per = 0;
      } else if (tp !== 0) {
        row.cgst_per = 0;
        row.sgst_per = 0;
        row.igst_per = tp;
      } else {
        row.cgst_per = 0;
        row.sgst_per = 0;
        row.igst_per = 0;
      }
      row.cgst_per = clampTaxPer(row.cgst_per);
      row.sgst_per = clampTaxPer(row.sgst_per);
      row.igst_per = clampTaxPer(row.igst_per);
      row.bk_rate = roundRate2(Number(it?.BK_RATE ?? it?.bk_rate ?? 0) || 0);
      row.unit_wgt = Number(it?.UNIT_WGT ?? it?.unit_wgt ?? 0) || 0;
      const autoW = computeLineWeight(row.qnty, row.status, row.unit_wgt, ctx?.G_AMT_CAL, row.weight);
      if (autoW != null) row.weight = autoW;
      const L = { ...row };
      const q = Number(L.qnty) || 0;
      const r = roundRate2(L.rate);
      const w = Number(L.weight) || 0;
      const cal = parseCal(L.cal);
      const amt = cal === 2 ? Math.round(q * r * 100) / 100 : Math.round(w * r * 100) / 100;
      L.amount = Number.isFinite(amt) ? amt : 0;
      const disPer = Number(L.dis_per) || 0;
      L.dis_amt = Math.round(L.amount * (disPer / 100) * 100) / 100;
      const taxBase = Math.max(0, L.amount - L.dis_amt);
      L.taxable = taxBase;
      L.cgst_amt = Math.round(taxBase * (Number(L.cgst_per) || 0) * 0.01 * 100) / 100;
      L.sgst_amt = Math.round(taxBase * (Number(L.sgst_per) || 0) * 0.01 * 100) / 100;
      L.igst_amt = Math.round(taxBase * (Number(L.igst_per) || 0) * 0.01 * 100) / 100;
      const bkw = String(L.bk_bw || 'A').toUpperCase();
      const br = roundRate2(L.bk_rate);
      if (bkw === 'B') L.bk_amt = Math.round(q * br * 100) / 100;
      else if (bkw === 'W') L.bk_amt = Math.round(w * br * 100) / 100;
      else L.bk_amt = Math.round(L.amount * (br / 100) * 100) / 100;
      L.weight_manual = false;
      next[idx] = L;
      return next;
    });
  };

  const recalcLine = (idx, patch) => {
    setLines((prev) => {
      const next = [...prev];
      const L = { ...next[idx], ...patch };
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'weight')) {
        L.weight = clampSaleWeight(patch.weight);
        L.weight_manual = true;
      }
      L.cgst_per = clampTaxPer(L.cgst_per);
      L.sgst_per = clampTaxPer(L.sgst_per);
      L.igst_per = clampTaxPer(L.igst_per);
      const skipAutoWeight = L.weight_manual === true;
      if (!skipAutoWeight) {
        const uw = Number(L.unit_wgt) || 0;
        const aw = computeLineWeight(L.qnty, L.status, uw, ctx?.G_AMT_CAL, L.weight);
        if (aw != null) L.weight = aw;
      }
      const q = Number(L.qnty) || 0;
      const r = roundRate2(L.rate);
      const w = Number(L.weight) || 0;
      const cal = parseCal(L.cal);
      const amt = cal === 2 ? Math.round(q * r * 100) / 100 : Math.round(w * r * 100) / 100;
      L.amount = Number.isFinite(amt) ? amt : 0;
      const disPer = Number(L.dis_per) || 0;
      L.dis_amt = Math.round(L.amount * (disPer / 100) * 100) / 100;
      const taxBase = Math.max(0, L.amount - L.dis_amt);
      L.taxable = taxBase;
      L.cgst_amt = Math.round(taxBase * (Number(L.cgst_per) || 0) * 0.01 * 100) / 100;
      L.sgst_amt = Math.round(taxBase * (Number(L.sgst_per) || 0) * 0.01 * 100) / 100;
      L.igst_amt = Math.round(taxBase * (Number(L.igst_per) || 0) * 0.01 * 100) / 100;
      const bkw = String(L.bk_bw || 'A').toUpperCase();
      const br = roundRate2(L.bk_rate);
      if (bkw === 'B') L.bk_amt = Math.round(q * br * 100) / 100;
      else if (bkw === 'W') L.bk_amt = Math.round(w * br * 100) / 100;
      else L.bk_amt = Math.round(L.amount * (br / 100) * 100) / 100;
      next[idx] = L;
      return next;
    });
  };

  const totals = useMemo(() => {
    let amount = 0;
    let dis = 0;
    let cg = 0;
    let sg = 0;
    let ig = 0;
    lines.forEach((L) => {
      amount += Number(L.amount) || 0;
      dis += Number(L.dis_amt) || 0;
      cg += Number(L.cgst_amt) || 0;
      sg += Number(L.sgst_amt) || 0;
      ig += Number(L.igst_amt) || 0;
    });
    const net =
      amount +
      cg +
      sg +
      ig +
      clampSaleCharge(Number(labour) || 0) +
      clampSaleCharge(Number(freight) || 0) +
      clampSaleCharge(Number(ins) || 0) +
      clampSaleCharge(Number(othExp) || 0) -
      dis;
    return { amount, dis, cg, sg, ig, net };
  }, [lines, labour, freight, ins, othExp]);

  /** Net of lines + labour/freight/ins − discount, **excluding** oth/roff (used to compute round-off). */
  const netBeforeOth = useMemo(() => {
    let amount = 0;
    let dis = 0;
    let cg = 0;
    let sg = 0;
    let ig = 0;
    lines.forEach((L) => {
      amount += Number(L.amount) || 0;
      dis += Number(L.dis_amt) || 0;
      cg += Number(L.cgst_amt) || 0;
      sg += Number(L.sgst_amt) || 0;
      ig += Number(L.igst_amt) || 0;
    });
    return (
      amount +
      cg +
      sg +
      ig +
      clampSaleCharge(Number(labour) || 0) +
      clampSaleCharge(Number(freight) || 0) +
      clampSaleCharge(Number(ins) || 0) -
      dis
    );
  }, [lines, labour, freight, ins]);

  useEffect(() => {
    const base = Number(tdsOnAmt) || 0;
    const p = Number(tdsPer) || 0;
    const raw = Math.round(base * (p / 100) * 100) / 100;
    const frac = Math.abs(raw - Math.floor(raw));
    const adj = frac > 0.5 ? Math.ceil(raw) : Math.floor(raw);
    setTdsAmt(Number.isFinite(adj) ? adj : 0);
  }, [tdsOnAmt, tdsPer]);

  const billAmtRounded = useMemo(() => {
    let b = totals.net;
    if (String(ctx?.G_ROUNDOFF ?? '').trim().toUpperCase() === 'Y') {
      b = Math.round(b);
    }
    return b;
  }, [ctx, totals.net]);

  const othAutoFromRoundoff = String(ctx?.G_ROUNDOFF ?? '').trim().toUpperCase() === 'Y';

  useEffect(() => {
    if (!othAutoFromRoundoff) return;
    const roff = clampSaleOthSigned(Math.round(netBeforeOth) - netBeforeOth);
    setOthExp(roff);
    setOthExpText(null);
  }, [othAutoFromRoundoff, netBeforeOth]);

  /** Clear line/header fields (not bill no) — shared by Next bill / Prev bill / Edit→New. */
  const resetEmptySaleBillForm = useCallback(() => {
    setPostedNewBill(false);
    setCode('');
    setDelvCode('');
    setBCode('');
    setBilledSearch('');
    setShippedSearch('');
    setBrokerSearch('');
    setBilledFinderOpen(true);
    setShippedFinderOpen(false);
    setBrokerFinderOpen(false);
    setPartyGst('');
    setDays(0);
    setLabour(0);
    setFreight(0);
    setIns(0);
    setOthExp(0);
    setAddCode('');
    const roffC = String(ctx?.G_ROFF_CODE ?? ctx?.g_roff_code ?? '').trim();
    if (roffC) setAddCode(roffC);
    setLabourText(null);
    setFreightText(null);
    setInsText(null);
    setOthExpText(null);
    setLineWeightEdit(null);
    setTdsOnAmt(0);
    setTdsPer(0);
    setTdsAmt(0);
    setTruckNo('');
    setTpt('');
    setGrNo('');
    setLines([emptyLine(String(ctx?.G_PLANT_CODE ?? '').trim())]);
    setErr('');
    setMsg('');
    setPickListDateYmd('');
    setPickListBillNo('');
    setBillDateYmd(toInputDateString(new Date()));
  }, [ctx?.G_PLANT_CODE, ctx?.G_ROFF_CODE, ctx?.g_roff_code]);

  const applySaleBillRowsFromApi = useCallback(
    (rows) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const first = rows[0];
      const c0 = String(first.CODE ?? first.code ?? '');
      setCode(c0);
      const pr = parties.find((p) => String(p.CODE ?? p.code) === c0);
      setPartyGst(String(pr?.GST_NO ?? pr?.gst_no ?? '').trim());
      const rawDelv = first.DELV_CODE ?? first.delv_code;
      if (rawDelv == null || String(rawDelv).trim() === '') {
        setDelvCode('');
      } else {
        const ds = String(rawDelv);
        setDelvCode(ds === c0 ? '' : ds);
      }
      setBCode(first.B_CODE != null ? String(first.B_CODE) : '');
      setBilledSearch('');
      setShippedSearch('');
      setBrokerSearch('');
      setBilledFinderOpen(false);
      setShippedFinderOpen(false);
      setBrokerFinderOpen(false);
      setLabourText(null);
      setFreightText(null);
      setInsText(null);
      setOthExpText(null);
      setLineWeightEdit(null);
      setDays(Number(first.DAYS ?? first.days ?? 0) || 0);
      setLabour(clampSaleCharge(Number(first.LABOUR ?? first.labour ?? 0) || 0));
      setFreight(clampSaleCharge(Number(first.FREIGHT ?? first.freight ?? 0) || 0));
      setIns(clampSaleCharge(Number(first.INS ?? first.ins ?? 0) || 0));
      setOthExp(clampSaleOthSigned(Number(first.OTH_EXP ?? first.oth_exp ?? 0) || 0));
      setAddCode(first.ADD_CODE != null ? String(first.ADD_CODE) : '');
      setTdsOnAmt(Number(first.TDS_ON_AMT ?? first.tds_on_amt ?? 0) || 0);
      setTdsPer(Number(first.TDS_PER ?? first.tds_per ?? 0) || 0);
      setTdsAmt(Number(first.TDS_AMT ?? first.tds_amt ?? 0) || 0);
      setTruckNo(String(first.TRUCK_NO ?? first.truck_no ?? ''));
      setTpt(String(first.TPT ?? first.tpt ?? ''));
      setGrNo(String(first.GR_NO ?? first.gr_no ?? ''));
      setSaleInvNo(String(first.SALE_INV_NO ?? first.sale_inv_no ?? ''));
      setLines(
        rows.map((r, i) => {
          const ic = String(r.ITEM_CODE ?? r.item_code ?? '').trim();
          const it = lookups.items.find((x) => String(x.ITEM_CODE ?? x.item_code ?? '').trim() === ic);
          const uw = Number(it?.UNIT_WGT ?? it?.unit_wgt ?? 0) || 0;
          return {
            trn_no: Number(r.TRN_NO ?? r.trn_no ?? i + 1) || i + 1,
            item_code: ic,
            item_name: '',
            s_code: r.S_CODE != null ? String(r.S_CODE) : '',
            marka: String(r.MARKA ?? r.marka ?? '').trim(),
            plant_code: String(r.PLANT_CODE ?? r.plant_code ?? '').trim(),
            qnty: Number(r.QNTY ?? r.qnty ?? 0) || 0,
            status: String(r.STATUS ?? r.status ?? 'B'),
            cal: String(r.CAL ?? r.cal ?? '1').replace(/\D/g, '').slice(0, 1) || '1',
            weight: clampSaleWeight(Number(r.WEIGHT ?? r.weight ?? 0) || 0),
            rate: roundRate2(Number(r.RATE ?? r.rate ?? 0) || 0),
            amount: Number(r.AMOUNT ?? r.amount ?? 0) || 0,
            dis_per: Number(r.DIS_PER ?? r.dis_per ?? 0) || 0,
            dis_amt: Number(r.DIS_AMT ?? r.dis_amt ?? 0) || 0,
            taxable: Number(r.TAXABLE ?? r.taxable ?? 0) || 0,
            cgst_per: Number(r.CGST_PER ?? r.cgst_per ?? 0) || 0,
            sgst_per: Number(r.SGST_PER ?? r.sgst_per ?? 0) || 0,
            igst_per: Number(r.IGST_PER ?? r.igst_per ?? 0) || 0,
            cgst_amt: Number(r.CGST_AMT ?? r.cgst_amt ?? 0) || 0,
            sgst_amt: Number(r.SGST_AMT ?? r.sgst_amt ?? 0) || 0,
            igst_amt: Number(r.IGST_AMT ?? r.igst_amt ?? 0) || 0,
            bk_rate: roundRate2(Number(r.BK_RATE ?? r.bk_rate ?? 0) || 0),
            bk_bw: String(r.BK_BW ?? r.bk_bw ?? 'A'),
            bk_amt: Number(r.BK_AMT ?? r.bk_amt ?? 0) || 0,
            unit_wgt: uw,
            weight_manual: false,
          };
        })
      );
    },
    [lookups.items, parties]
  );

  const tryLoadSaleBillByBillNoRelaxed = useCallback(
    async (bn) => {
      if (!compCode || !compUid || bn == null) return;
      const n = Number(bn);
      if (!Number.isFinite(n) || n < 1) return;
      try {
        setErr('');
        const { data } = await axios.get(`${apiBase}/api/sale-bill-raw`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            type: typeNum,
            bill_no: String(n),
            b_type: bType,
            relax_bill_date: '1',
          },
          ...reqOpts,
        });
        const rows = Array.isArray(data) ? data : [];
        const p = perm || {};
        if (rows.length === 0) {
          setPostedNewBill(false);
          if (modeRef.current === 'edit' || modeRef.current === 'delete') {
            skipClearOnEditToNewEffectRef.current = true;
          }
          setMode('new');
          return;
        }
        const bd = rows[0].BILL_DATE ?? rows[0].bill_date;
        const ymd = toInputDateString(bd);
        if (ymd) setBillDateYmd(ymd);
        setBillNo(String(rows[0].BILL_NO ?? rows[0].bill_no ?? n));
        applySaleBillRowsFromApi(rows);
        setPostedNewBill(false);
        if (p.canEdit) setMode('edit');
        else if (p.canDelete) setMode('delete');
        else if (p.canAdd) {
          setMode('new');
          setPostedNewBill(true);
        } else {
          setMode('new');
        }
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load bill failed');
      }
    },
    [apiBase, applySaleBillRowsFromApi, bType, compCode, compUid, perm, typeNum]
  );

  const refreshPrevBillSlot = useCallback(async () => {
    if (!compCode || !compUid) return null;
    const gen = ++billSlotFetchGenRef.current;
    try {
      setErr('');
      const { data } = await axios.get(`${apiBase}/api/sale-bill-next-bill-no`, {
        params: { comp_code: compCode, comp_uid: compUid, type: typeNum, b_type: bType },
        ...reqOpts,
      });
      if (gen !== billSlotFetchGenRef.current) return null;
      const nextN = Number(data?.next_bill_no) || 1;
      const cur = Number(String(billNoRef.current ?? '').trim());
      const hasCur = Number.isFinite(cur) && cur > 0;
      /** On empty slot (last+1) or before first paint, use last posted = nextN − 1; else step down from current. */
      const prevN = !hasCur || cur === nextN ? Math.max(1, nextN - 1) : Math.max(1, cur - 1);
      setBillNo(String(prevN));
      const inv = await axios.get(`${apiBase}/api/sale-bill-inv-no-preview`, {
        params: { comp_code: compCode, comp_uid: compUid, type: typeNum, b_type: bType, bill_no: prevN },
        ...reqOpts,
      });
      if (gen !== billSlotFetchGenRef.current) return null;
      setSaleInvNo(String(inv.data?.sale_inv_no ?? ''));
      return prevN;
    } catch (e) {
      if (gen === billSlotFetchGenRef.current) {
        setErr(e?.response?.data?.error || e.message || 'Prev bill failed');
      }
      return null;
    }
  }, [apiBase, bType, compCode, compUid, typeNum]);

  /** Clear fields and next bill no — used after save and when switching Edit/Delete → New. */
  const clearSaleBillFormForNewEntry = useCallback(async () => {
    resetEmptySaleBillForm();
    const nb = await refreshNextBill();
    if (nb != null) await tryLoadSaleBillByBillNoRelaxed(nb);
  }, [refreshNextBill, resetEmptySaleBillForm, tryLoadSaleBillByBillNoRelaxed]);

  /** Clear fields and move to previous bill number slot (for new entry). */
  const clearSaleBillFormForPrevEntry = useCallback(async () => {
    resetEmptySaleBillForm();
    const pn = await refreshPrevBillSlot();
    if (pn != null) await tryLoadSaleBillByBillNoRelaxed(pn);
  }, [refreshPrevBillSlot, resetEmptySaleBillForm, tryLoadSaleBillByBillNoRelaxed]);

  const prevModeRef = useRef(mode);
  useEffect(() => {
    const prev = prevModeRef.current;
    if (mode === 'new' && (prev === 'edit' || prev === 'delete')) {
      if (skipClearOnEditToNewEffectRef.current) {
        skipClearOnEditToNewEffectRef.current = false;
      } else {
        void clearSaleBillFormForNewEntry();
      }
    }
    prevModeRef.current = mode;
  }, [mode, clearSaleBillFormForNewEntry]);

  const openPrintBill = () => {
    const curOracle = billDateOracle;
    let bn = String(billNo || '').trim();
    let bt = String(bType || 'N').trim();
    let tn = typeNum;
    let od = curOracle;
    if ((!bn || !od) && lastPostedBillRef.current) {
      bn = String(lastPostedBillRef.current.billNo || '').trim();
      bt = String(lastPostedBillRef.current.bType || 'N').trim();
      tn = lastPostedBillRef.current.typeNum ?? 1;
      od = lastPostedBillRef.current.oracleDt || '';
    }
    if (!bn || !od) {
      setErr('Set bill date and bill number, save a bill, or use Print after a successful save.');
      return;
    }
    const printType = SALE_LIST_NUMTYPE_TO_PRINT[tn] || 'SL';
    setBillPrintParams({
      type: printType,
      oracleTypeNum: tn,
      billNo: bn,
      bType: bt,
      oracleDt: od,
      compYear,
      label: `Sale bill — ${tn} / ${bn} / ${od}`,
    });
    setPrintOpen(true);
  };

  const handleSave = async (saveMode) => {
    setMsg('');
    setErr('');
    if (!userName) {
      setErr('User name missing — sign in again.');
      return;
    }
    if (!code) {
      setErr('Select billed-to party.');
      return;
    }
    if (fyMinYmd && fyMaxYmd && billDateYmd && (billDateYmd < fyMinYmd || billDateYmd > fyMaxYmd)) {
      setErr(`Bill date must be between ${toDisplayDate(fyMinYmd)} and ${toDisplayDate(fyMaxYmd)} (financial year).`);
      return;
    }
    try {
      const header = {
        code: Number(code),
        delv_code: delvCode ? Number(delvCode) : Number(code),
        b_code: bCode !== '' && bCode != null ? Number(bCode) : undefined,
        days,
        labour: clampSaleCharge(Number(labour) || 0),
        freight: clampSaleCharge(Number(freight) || 0),
        ins: clampSaleCharge(Number(ins) || 0),
        oth_exp: clampSaleOthSigned(Number(othExp) || 0),
        add_code: addCode ? Number(addCode) : undefined,
        bill_amt: billAmtRounded,
        tds_on_amt: tdsOnAmt,
        tds_per: tdsPer,
        tds_amt: tdsAmt,
        truck_no: truckNo,
        tpt,
        gr_no: grNo,
      };
      const payload = {
        comp_code: compCode,
        comp_uid: compUid,
        user_name: userName,
        mode: saveMode,
        type: typeNum,
        vr_type: vrType,
        b_type: bType,
        bill_date: billDateOracle,
        bill_no: saveMode === 'add' ? undefined : billNo,
        header,
        lines: lines.map((L, i) => ({
          trn_no: i + 1,
          item_code: L.item_code,
          s_code: L.s_code !== '' && L.s_code != null && !Number.isNaN(Number(L.s_code)) ? Number(L.s_code) : undefined,
          marka: L.marka,
          plant_code: L.plant_code,
          qnty: Number(L.qnty) || 0,
          status: L.status,
          cal: parseCal(L.cal),
          weight: clampSaleWeight(Number(L.weight) || 0),
          rate: roundRate2(Number(L.rate) || 0),
          amount: Number(L.amount) || 0,
          dis_per: Number(L.dis_per) || 0,
          dis_amt: Number(L.dis_amt) || 0,
          taxable: Number(L.taxable) || 0,
          cgst_per: Number(L.cgst_per) || 0,
          sgst_per: Number(L.sgst_per) || 0,
          igst_per: Number(L.igst_per) || 0,
          cgst_amt: Number(L.cgst_amt) || 0,
          sgst_amt: Number(L.sgst_amt) || 0,
          igst_amt: Number(L.igst_amt) || 0,
          bk_rate: roundRate2(Number(L.bk_rate) || 0),
          bk_bw: L.bk_bw || 'A',
          bk_amt: Number(L.bk_amt) || 0,
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/sale-bill-save`, payload, reqOpts);
      const apiNote = data?.note != null && String(data.note).trim() !== '' ? String(data.note).trim() : '';
      const savedNo = String(data?.bill_no ?? billNo ?? '').trim();
      const savedOracle = billDateOracle;
      lastPostedBillRef.current = {
        billNo: savedNo,
        oracleDt: savedOracle,
        bType: String(bType || 'N').trim(),
        typeNum,
      };
      if (saveMode === 'add' || saveMode === 'edit') {
        setBillNo(savedNo);
        const inv = data?.sale_inv_no != null ? String(data.sale_inv_no).trim() : '';
        if (inv) setSaleInvNo(inv);
        if (saveMode === 'add') setPostedNewBill(true);
        if (apiNote) {
          setMsg(`${apiNote} Use Print bill, or Prev bill / Next bill when you are ready for a new voucher.`);
        } else if (saveMode === 'add') {
          setMsg('Bill saved. Use Print bill, or Prev bill / Next bill when you are ready for a new voucher.');
        } else {
          setMsg('Bill updated. Use Print bill, or Prev bill / Next bill when you are ready for a new voucher.');
        }
      } else {
        setPostedNewBill(false);
        setMsg(apiNote || 'Bill deleted.');
      }
      await loadBillPick();
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    }
  };

  const loadExistingBill = async (row) => {
    setErr('');
    setPostedNewBill(false);
    try {
      const bn = row.BILL_NO ?? row.bill_no;
      const bd = row.BILL_DATE ?? row.bill_date;
      const ymd = toInputDateString(bd);
      setBillDateYmd(ymd || billDateYmd);
      setBillNo(String(bn));
      const { data } = await axios.get(`${apiBase}/api/sale-bill-raw`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          type: typeNum,
          bill_no: bn,
          bill_date: toOracleDate(ymd),
          b_type: bType,
        },
        ...reqOpts,
      });
      const rows = Array.isArray(data) ? data : [];
      if (rows.length === 0) {
        setErr('No SALE lines for this bill.');
        return;
      }
      applySaleBillRowsFromApi(rows);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load bill failed');
    }
  };

  if (loading) {
    return (
      <div className="slide slide-21-sale-bill slide-21-sale-bill--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Sale bill</h2>
          <p className="sale-bill-loading-card__text">Loading permissions and lookups…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const can = perm || {};
  /** ACCESS only (F1 bit 0): browse and print, no add/edit/delete. */
  const accessOnlyBrowse = !!can.canOpen && !can.canAdd && !can.canEdit && !can.canDelete;
  /** Prev/Next bill slot navigation: new entry, edit/delete workflows, or ACCESS-only viewing. */
  const showBillSlotNav =
    (mode === 'new' && (!!can.canAdd || accessOnlyBrowse)) ||
    (mode === 'edit' && !!can.canEdit) ||
    (mode === 'delete' && !!can.canDelete);
  const canPickMode = !!(can.canOpen || can.canAdd || can.canEdit || can.canDelete);
  const canEditSaleBillFields =
    !accessOnlyBrowse &&
    ((mode === 'new' && !!can.canAdd) ||
      (mode === 'edit' && !!can.canEdit) ||
      (mode === 'delete' && !!can.canDelete));

  return (
    <div className="slide slide-21-sale-bill sale-bill-page" onKeyDown={handleEnterAsTab} role="presentation">
      <SaleBillPrintModal
        open={printOpen}
        onClose={() => {
          setPrintOpen(false);
          setBillPrintParams(null);
        }}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={billPrintParams}
        companyName={formData.comp_name ?? formData.COMP_NAME ?? ''}
      />
      <header className="sale-bill-page__header">
        <div className="sale-bill-page__title-row">
          <h2 className="sale-bill-page__title">Sale bill</h2>
          <span className="sale-bill-page__badge" title={permSummary}>
            {perm && (perm.canOpen || perm.canAdd || perm.canEdit || perm.canDelete)
              ? accessOnlyBrowse
                ? 'View only'
                : 'F1 access'
              : 'No access'}
          </span>
        </div>
        <div className="sale-bill-page__user-power" role="status" aria-label="User and sale bill F1 rights">
          <span className="sale-bill-page__user-power-user">
            <span className="sale-bill-page__user-power-k">USER</span>
            <span className="sale-bill-page__user-power-colon">:</span>
            <strong className="sale-bill-page__user-power-name">{userName || '—'}</strong>
          </span>
          <span className="sale-bill-page__user-power-vsep" aria-hidden>
            |
          </span>
          <span className="sale-bill-page__user-power-rights" aria-label="F1 rights; X means not permitted">
            <span className={can.canOpen ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              ACCESS
              {!can.canOpen ? <span className="sale-bill-power__x">X</span> : null}
            </span>
            <span className={can.canAdd ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              ADD
              {!can.canAdd ? <span className="sale-bill-power__x">X</span> : null}
            </span>
            <span className={can.canEdit ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              EDIT
              {!can.canEdit ? <span className="sale-bill-power__x">X</span> : null}
            </span>
            <span className={can.canDelete ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              DELETE
              {!can.canDelete ? <span className="sale-bill-power__x">X</span> : null}
            </span>
          </span>
        </div>
        <p className="sale-bill-page__perms" role="status">
          {permSummary}
        </p>
        <div className="sale-bill-page__meta">
          <span className="sale-bill-page__meta-item">
            <span className="sale-bill-page__meta-k">Company</span> {formData.comp_name ?? '—'}
          </span>
          <span className="sale-bill-page__meta-item">
            <span className="sale-bill-page__meta-k">FY</span> {formData.comp_year ?? '—'}
          </span>
          {!can.canOpen && !can.canAdd && !can.canEdit && !can.canDelete ? (
            <span className="sale-bill-page__meta-item sale-bill-page__meta-item--warn">Access denied (F1)</span>
          ) : null}
        </div>
        {ctx ? (
          <div className="sale-bill-page__context">
            <span>Fin year {ctx.G_FIN_YEAR}</span>
            <span className="sale-bill-page__dot" aria-hidden>
              ·
            </span>
            <span>
              Bill dates <strong>{toDisplayDate(fyMinYmd)}</strong> – <strong>{toDisplayDate(fyMaxYmd)}</strong>
            </span>
            <span className="sale-bill-page__dot" aria-hidden>
              ·
            </span>
            <span>AMT_CAL {ctx.G_AMT_CAL ?? '—'}</span>
            <span className="sale-bill-page__dot" aria-hidden>
              ·
            </span>
            <span>GST {String(ctx.G_GST_NO || '').slice(0, 14)}…</span>
          </div>
        ) : null}
      </header>

      {err ? <p className="deploy-update-msg deploy-update-msg--err sale-bill-page__alert">{err}</p> : null}

      <section className="sale-bill-section sale-bill-section--toolbar sale-bill-section--card">
        <div className="sale-bill-toolbar">
          <div className="sale-bill-toolbar-inner">
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={!canPickMode}>
              <option value="new" disabled={!can.canAdd}>
                New (add)
              </option>
              <option value="edit" disabled={!can.canEdit}>
                Edit
              </option>
              <option value="delete" disabled={!can.canDelete}>
                Delete
              </option>
            </select>
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Invoice</span>
            <select
              value={invoiceKind}
              onChange={(e) => setInvoiceKind(e.target.value)}
              disabled={!canEditSaleBillFields || mode !== 'new'}
            >
              <option value="retail">Retail (TYPE 1, VR S)</option>
              <option value="tax">Tax (TYPE 3, VR Y)</option>
            </select>
          </label>
          <label className="sale-bill-field sale-bill-field--narrow">
            <span className="sale-bill-field__label">B type</span>
            <input
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              className="sale-bill-input-btype"
              value={bType}
              onChange={(e) => {
                const c = singleCharFromInput(e.target.value);
                setBType((c || 'N').slice(0, 1));
              }}
              onFocus={selectAllOnFocus}
              disabled={!canEditSaleBillFields}
            />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Bill date</span>
            <input
              type="date"
              value={billDateYmd}
              min={fyMinYmd || undefined}
              max={fyMaxYmd || undefined}
              onChange={(e) => setBillDateYmd(normalizeHtmlDateValue(e.target.value))}
              disabled={!canEditSaleBillFields}
            />
          </label>
          <div className="sale-bill-toolbar__refs">
            <span className="sale-bill-ref-pill">
              Bill <strong>{billNo || '—'}</strong>
            </span>
            <span className="sale-bill-ref-pill">
              Sale inv <strong>{saleInvNo || '—'}</strong>
            </span>
          </div>
          </div>
        </div>
      </section>

      {(mode === 'edit' || mode === 'delete') && (
        <section className="sale-bill-section sale-bill-section--pick sale-bill-section--card">
          <h3 className="sale-bill-section__title">Find bill to edit or delete</h3>
          <p className="sale-bill-section__hint">Filter by a single date and/or bill number, then refresh. Pick a row from the list.</p>
          <div className="sale-bill-filter-row">
            <label className="sale-bill-field">
              <span className="sale-bill-field__label">Bills on date</span>
              <input
                type="date"
                value={pickListDateYmd}
                min={fyMinYmd || undefined}
                max={fyMaxYmd || undefined}
                onChange={(e) => setPickListDateYmd(normalizeHtmlDateValue(e.target.value))}
                title="Within financial year; leave empty for full period list"
              />
            </label>
            <label className="sale-bill-field">
              <span className="sale-bill-field__label">Or bill no</span>
              <input
                type="text"
                value={pickListBillNo}
                onChange={(e) => setPickListBillNo(e.target.value)}
                placeholder="e.g. 16616"
                title="Filter list to this bill no"
              />
            </label>
            <div className="sale-bill-filter-row__actions">
              <button type="button" className="btn btn-secondary" onClick={() => loadBillPick()}>
                Refresh list
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPickListDateYmd('');
                  setPickListBillNo('');
                  loadBillPick({ dateYmd: '', billNo: '' });
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Pick bill ({pickListRangeLabel})</span>
            <select
              className="sale-bill-select-wide"
              key={`${billPick.length}-${pickListDateYmd}-${pickListBillNo}`}
              defaultValue=""
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (!Number.isFinite(idx) || idx < 0) return;
                const row = billPick[idx];
                if (row) loadExistingBill(row);
              }}
            >
              <option value="">— choose —</option>
              {billPick.map((r, i) => (
                <option key={`${r.BILL_NO}-${r.BILL_DATE}-${r.CODE ?? r.code}-${i}`} value={i}>
                  {toDisplayDate(toInputDateString(r.BILL_DATE ?? r.bill_date))} · Bill {r.BILL_NO ?? r.bill_no} ·{' '}
                  {r.NAME ?? r.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      <section className="sale-bill-section sale-bill-section--card">
        <h3 className="sale-bill-section__title">Party & broker</h3>
        <div className="sale-bill-party-grid">
          <div className="sale-bill-party-col">
            <div className="sale-bill-field sale-bill-field--block">
              <span className="sale-bill-field__label" id="sb-billed-search-lbl">
                Billed to (schedule 8.1)
              </span>
              {code && billedPartyInfo ? (
                <p className="account-selected-hint sale-bill-search-current" id="sb-billed-current">
                  <strong>{billedPartyInfo.NAME ?? billedPartyInfo.name}</strong>{' '}
                  <span className="sale-bill-search-current-code">[{code}]</span>
                  <span className="sale-bill-search-current-hint">
                    {billedFinderOpen
                      ? ' — pick from the list below, or Cancel to keep this party.'
                      : ' — click Change to search for a different party.'}
                  </span>
                </p>
              ) : null}
              {code && billedPartyInfo && !billedFinderOpen ? (
                <div className="sale-bill-picker-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!canEditSaleBillFields}
                    onClick={() => {
                      setBilledFinderOpen(true);
                      setBilledSearch('');
                    }}
                  >
                    Change billed party
                  </button>
                </div>
              ) : null}
              {(!code || billedFinderOpen) ? (
              <div className="account-search-group">
                <input
                  id="sb-billed-search"
                  type="search"
                  className="form-input sale-bill-search-input"
                  autoComplete="off"
                  placeholder="Search name, city, or code…"
                  aria-labelledby="sb-billed-search-lbl"
                  aria-controls="sb-billed-list"
                  value={billedSearch}
                  disabled={!canEditSaleBillFields}
                  onChange={(e) => setBilledSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (filteredBilledParties.length === 0) return;
                      const max = Math.max(0, filteredBilledParties.length - 1);
                      setBilledHi((h) => Math.min(max, h + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setBilledHi((h) => Math.max(0, h - 1));
                    } else if (e.key === 'Enter') {
                      const r = filteredBilledParties[safeBilledHi];
                      if (r) {
                        e.preventDefault();
                        e.stopPropagation();
                        applyBilledPartyPick(String(r.CODE ?? r.code ?? '').trim());
                        setBilledSearch('');
                      }
                    }
                  }}
                />
                <div className="account-search-results party-search-results" id="sb-billed-list" role="listbox" aria-label="Billed-to matches">
                  <div className="account-search-header party-search-header" aria-hidden="true">
                    <span>Code</span>
                    <span>Name</span>
                    <span>City</span>
                  </div>
                  {filteredBilledParties.length === 0 ? (
                    <div className="account-search-empty">
                      {billedSearch.trim() ? 'No matches — try different letters.' : 'Type to narrow the list, or pick from the parties below.'}
                    </div>
                  ) : (
                    filteredBilledParties.map((row, index) => {
                      const pc = String(row.CODE ?? row.code ?? '');
                      const rowHi = safeBilledHi === index;
                      const rowSel = String(code) === pc;
                      return (
                        <button
                          key={pc}
                          type="button"
                          role="option"
                          aria-selected={rowSel}
                          disabled={!canEditSaleBillFields}
                          className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}${rowSel ? ' is-active' : ''}`}
                          onMouseEnter={() => setBilledHi(index)}
                          onClick={() => {
                            applyBilledPartyPick(pc);
                            setBilledSearch('');
                          }}
                        >
                          <span className="account-search-code">{highlightMatch(pc, billedSearch)}</span>
                          <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, billedSearch)}</span>
                          <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                {billedFinderOpen && code ? (
                  <div className="sale-bill-picker-actions sale-bill-picker-actions--after-list">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canEditSaleBillFields}
                      onClick={() => {
                        setBilledFinderOpen(false);
                        setBilledSearch('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
              ) : null}
            </div>
            {billedPartyInfo ? (
              <div className="sale-bill-party-card">
                <div className="sale-bill-party-card__name">{billedPartyInfo.NAME ?? billedPartyInfo.name}</div>
                <div className="sale-bill-party-card__row">
                  <span className="sale-bill-party-card__k">City</span>
                  <span>{String(billedPartyInfo.CITY ?? billedPartyInfo.city ?? '').trim() || '—'}</span>
                </div>
                <div className="sale-bill-party-card__row">
                  <span className="sale-bill-party-card__k">GST</span>
                  <span>{String(billedPartyInfo.GST_NO ?? billedPartyInfo.gst_no ?? '').trim() || '—'}</span>
                </div>
                <div className="sale-bill-party-card__row">
                  <span className="sale-bill-party-card__k">PAN</span>
                  <span>{String(billedPartyInfo.PAN ?? billedPartyInfo.pan ?? '').trim() || '—'}</span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="sale-bill-party-col">
            <div className="sale-bill-field sale-bill-field--block">
              <span className="sale-bill-field__label" id="sb-shipped-search-lbl">
                Shipped to (DELV_CODE)
              </span>
              {code ? (
                <div className="sale-bill-shipped-toolbar">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!canEditSaleBillFields || shippedSameAsBilled}
                    onClick={() => {
                      setDelvCode('');
                      setShippedSearch('');
                      setShippedFinderOpen(false);
                    }}
                  >
                    Same as billed-to
                  </button>
                  {shippedSameAsBilled && !shippedFinderOpen ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canEditSaleBillFields}
                      onClick={() => {
                        setShippedFinderOpen(true);
                        setShippedSearch('');
                      }}
                    >
                      Different consignee
                    </button>
                  ) : null}
                  {!shippedSameAsBilled && !shippedFinderOpen ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!canEditSaleBillFields}
                      onClick={() => {
                        setShippedFinderOpen(true);
                        setShippedSearch('');
                      }}
                    >
                      Change consignee
                    </button>
                  ) : null}
                  {shippedSameAsBilled && !shippedFinderOpen ? (
                    <span className="sale-bill-shipped-same-note">Deliver to same address as billed-to party.</span>
                  ) : null}
                </div>
              ) : null}
              {delvCode && !shippedSameAsBilled && shippedPartyInfo ? (
                <p className="account-selected-hint sale-bill-search-current" id="sb-shipped-current">
                  <strong>{shippedPartyInfo.NAME ?? shippedPartyInfo.name}</strong>{' '}
                  <span className="sale-bill-search-current-code">[{delvCode}]</span>
                  <span className="sale-bill-search-current-hint">
                    {shippedFinderOpen
                      ? ' — pick below or Cancel.'
                      : ' — click Change consignee to search again.'}
                  </span>
                </p>
              ) : null}
              {code && shippedFinderOpen ? (
              <div className="account-search-group">
                <input
                  id="sb-shipped-search"
                  type="search"
                  className="form-input sale-bill-search-input"
                  autoComplete="off"
                  placeholder="Search consignee name, city, or code…"
                  aria-labelledby="sb-shipped-search-lbl"
                  aria-controls="sb-shipped-list"
                  value={shippedSearch}
                  disabled={!canEditSaleBillFields || !code}
                  onChange={(e) => setShippedSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (filteredShippedParties.length === 0) return;
                      const max = Math.max(0, filteredShippedParties.length - 1);
                      setShippedHi((h) => Math.min(max, h + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setShippedHi((h) => Math.max(0, h - 1));
                    } else if (e.key === 'Enter') {
                      const r = filteredShippedParties[safeShippedHi];
                      if (r) {
                        e.preventDefault();
                        e.stopPropagation();
                        const pc = String(r.CODE ?? r.code ?? '').trim();
                        setDelvCode(pc === String(code) ? '' : pc);
                        setShippedSearch('');
                        setShippedFinderOpen(false);
                      }
                    }
                  }}
                />
                <div className="account-search-results party-search-results" id="sb-shipped-list" role="listbox" aria-label="Shipped-to matches">
                  <div className="account-search-header party-search-header" aria-hidden="true">
                    <span>Code</span>
                    <span>Name</span>
                    <span>City</span>
                  </div>
                  {filteredShippedParties.length === 0 ? (
                    <div className="account-search-empty">
                      {shippedSearch.trim() ? 'No matches — try different letters.' : 'Type to narrow the list, or pick from the parties below.'}
                    </div>
                  ) : (
                    filteredShippedParties.map((row, index) => {
                      const pc = String(row.CODE ?? row.code ?? '');
                      const rowHi = safeShippedHi === index;
                      const rowSel = shippedSameAsBilled ? false : String(delvCode) === pc;
                      return (
                        <button
                          key={`sh-${pc}`}
                          type="button"
                          role="option"
                          aria-selected={rowSel}
                          disabled={!canEditSaleBillFields}
                          className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}${rowSel ? ' is-active' : ''}`}
                          onMouseEnter={() => setShippedHi(index)}
                          onClick={() => {
                            setDelvCode(pc === String(code) ? '' : pc);
                            setShippedSearch('');
                            setShippedFinderOpen(false);
                          }}
                        >
                          <span className="account-search-code">{highlightMatch(pc, shippedSearch)}</span>
                          <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, shippedSearch)}</span>
                          <span className="account-search-city">{row.CITY ?? row.city ?? '—'}</span>
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="sale-bill-picker-actions sale-bill-picker-actions--after-list">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!canEditSaleBillFields}
                    onClick={() => {
                      setShippedFinderOpen(false);
                      setShippedSearch('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
              ) : null}
            </div>
            {shippedPartyInfo ? (
              <div className="sale-bill-party-card">
                <div className="sale-bill-party-card__name">{shippedPartyInfo.NAME ?? shippedPartyInfo.name}</div>
                <div className="sale-bill-party-card__row">
                  <span className="sale-bill-party-card__k">City</span>
                  <span>{String(shippedPartyInfo.CITY ?? shippedPartyInfo.city ?? '').trim() || '—'}</span>
                </div>
                <div className="sale-bill-party-card__row">
                  <span className="sale-bill-party-card__k">GST</span>
                  <span>{String(shippedPartyInfo.GST_NO ?? shippedPartyInfo.gst_no ?? '').trim() || '—'}</span>
                </div>
                <div className="sale-bill-party-card__row">
                  <span className="sale-bill-party-card__k">PAN</span>
                  <span>{String(shippedPartyInfo.PAN ?? shippedPartyInfo.pan ?? '').trim() || '—'}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="sale-bill-broker-row">
          <label className="sale-bill-field sale-bill-field--grow">
            <span className="sale-bill-field__label" id="sb-broker-search-lbl">
              Broker (schedule 11.2)
            </span>
            {bCode && !brokerFinderOpen ? (
              <div className="sale-bill-broker-summary">
                <p className="account-selected-hint sale-bill-search-current sale-bill-search-current--no-margin">
                  <strong>{brokers.find((b) => String(b.CODE ?? b.code) === String(bCode))?.NAME ?? '—'}</strong>{' '}
                  <span className="sale-bill-search-current-code">[{bCode}]</span>
                  <span className="sale-bill-search-current-hint"> — click Change broker to search again.</span>
                </p>
                <div className="sale-bill-picker-actions">
                  <button
                    type="button"
                    className="btn-text-clear"
                    disabled={!canEditSaleBillFields}
                    onClick={() => {
                      setBCode('');
                      setBrokerSearch('');
                      setBrokerFinderOpen(false);
                    }}
                  >
                    No broker
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={!canEditSaleBillFields}
                    onClick={() => {
                      setBrokerFinderOpen(true);
                      setBrokerSearch('');
                    }}
                  >
                    Change broker
                  </button>
                </div>
              </div>
            ) : null}
            {!bCode && !brokerFinderOpen ? (
              <div className="sale-bill-picker-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!canEditSaleBillFields}
                  onClick={() => {
                    setBrokerFinderOpen(true);
                    setBrokerSearch('');
                  }}
                >
                  Add broker (optional)
                </button>
              </div>
            ) : null}
            {brokerFinderOpen ? (
            <div className="account-search-group">
              <input
                id="sb-broker-search"
                type="search"
                className="form-input sale-bill-search-input"
                autoComplete="off"
                placeholder="Search broker name, city, or code…"
                aria-labelledby="sb-broker-search-lbl"
                aria-controls="sb-broker-list"
                value={brokerSearch}
                disabled={!canEditSaleBillFields}
                onChange={(e) => setBrokerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (filteredBrokersList.length === 0) return;
                    const max = Math.max(0, filteredBrokersList.length - 1);
                    setBrokerHi((h) => Math.min(max, h + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setBrokerHi((h) => Math.max(0, h - 1));
                  } else if (e.key === 'Enter') {
                    const r = filteredBrokersList[safeBrokerHi];
                    if (r) {
                      e.preventDefault();
                      e.stopPropagation();
                      setBCode(String(r.CODE ?? r.code ?? '').trim());
                      setBrokerSearch('');
                      setBrokerFinderOpen(false);
                    }
                  }
                }}
              />
              <div className="account-search-results broker-search-results" id="sb-broker-list" role="listbox" aria-label="Broker matches">
                <div className="account-search-header broker-search-header" aria-hidden="true">
                  <span>Code</span>
                  <span>Name</span>
                </div>
                {filteredBrokersList.length === 0 ? (
                  <div className="account-search-empty">
                    {brokerSearch.trim() ? 'No matches — try different letters.' : 'Type to narrow the list, or pick from the brokers below.'}
                  </div>
                ) : (
                  filteredBrokersList.map((row, index) => {
                    const pc = String(row.CODE ?? row.code ?? '');
                    const rowHi = safeBrokerHi === index;
                    const rowSel = String(bCode) === pc;
                    return (
                      <button
                        key={`br-${pc}`}
                        type="button"
                        role="option"
                        aria-selected={rowSel}
                        disabled={!canEditSaleBillFields}
                        className={`account-search-row broker-search-row${rowHi ? ' is-highlight' : ''}${rowSel ? ' is-active' : ''}`}
                        onMouseEnter={() => setBrokerHi(index)}
                        onClick={() => {
                          setBCode(pc);
                          setBrokerSearch('');
                          setBrokerFinderOpen(false);
                        }}
                      >
                        <span className="account-search-code">{highlightMatch(pc, brokerSearch)}</span>
                        <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, brokerSearch)}</span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="sale-bill-picker-actions sale-bill-picker-actions--after-list">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!canEditSaleBillFields}
                  onClick={() => {
                    setBrokerFinderOpen(false);
                    setBrokerSearch('');
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
            ) : null}
          </label>
          <label className="sale-bill-field sale-bill-field--narrow">
            <span className="sale-bill-field__label">Due days</span>
            <input
              type="text"
              inputMode="numeric"
              value={dispNum(days)}
              onChange={(e) => setDays(parseNumInput(e.target.value))}
              disabled={!canEditSaleBillFields}
            />
          </label>
        </div>
      </section>

      <section className="sale-bill-section sale-bill-section--card">
        <h3 className="sale-bill-section__title">Line items</h3>
        <div className="sale-bill-lines-wrap">
          <table className="report-table sale-bill-lines-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Marka</th>
              <th>Plant</th>
              <th>Qty</th>
              <th>St</th>
              <th title="Max 9999999999.999">Wt</th>
              <th title="Up to 9999999.99, two decimal places">Rate (0.00)</th>
              <th>Cal</th>
              <th>Amt</th>
              <th>Dis%</th>
              <th title="CGST_PER">CGST %</th>
              <th title="CGST_AMT">CGST amt</th>
              <th title="SGST_PER">SGST %</th>
              <th title="SGST_AMT">SGST amt</th>
              <th title="IGST_PER">IGST %</th>
              <th title="IGST_AMT">IGST amt</th>
              <th title="Up to 9999999.99, two decimal places">Bk rate (0.00)</th>
              <th>Bk BW</th>
              <th>Bk amt</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((L, idx) => (
              <tr key={idx}>
                <td>{idx + 1}</td>
                <td>
                  <select
                    value={L.item_code}
                    onChange={(e) => {
                      applyItemToLine(idx, e.target.value);
                    }}
                    disabled={!canEditSaleBillFields || (mode === 'edit' && !can.canEdit)}
                  >
                    <option value="">— item —</option>
                    {lookups.items.map((it) => (
                      <option key={String(it.ITEM_CODE ?? it.item_code)} value={String(it.ITEM_CODE ?? it.item_code).trim()}>
                        {it.ITEM_NAME ?? it.item_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={L.marka}
                    onChange={(e) => recalcLine(idx, { marka: e.target.value })}
                    disabled={!canEditSaleBillFields}
                  >
                    <option value="">—</option>
                    {(lookups.markas || []).map((m) => {
                      const mk = String(m.MARKA ?? m.marka ?? '').trim();
                      return mk ? (
                        <option key={mk} value={mk}>
                          {mk}
                        </option>
                      ) : null;
                    })}
                  </select>
                </td>
                <td>
                  <select
                    value={L.plant_code}
                    onChange={(e) => recalcLine(idx, { plant_code: e.target.value })}
                    disabled={!canEditSaleBillFields}
                  >
                    <option value="">—</option>
                    {(lookups.plants || []).map((p) => (
                      <option key={String(p.PLANT_CODE ?? p.plant_code)} value={String(p.PLANT_CODE ?? p.plant_code).trim()}>
                        {p.PLANT_NAME ?? p.plant_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: '4.5rem' }}
                    value={dispNum(L.qnty)}
                    onChange={(e) => recalcLine(idx, { qnty: parseNumInput(e.target.value) })}
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    style={{ width: '2rem' }}
                    value={L.status}
                    onChange={(e) => {
                      const c = singleCharFromInput(e.target.value);
                      recalcLine(idx, { status: (c || 'B').slice(0, 1) });
                    }}
                    onFocus={selectAllOnFocus}
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: '8.75rem' }}
                    value={lineWeightEdit && lineWeightEdit.idx === idx ? lineWeightEdit.text : committedWeightStr(L.weight)}
                    onFocus={() => {
                      if (!canEditSaleBillFields) return;
                      setLineWeightEdit({ idx, text: committedWeightStr(L.weight) });
                    }}
                    onChange={(e) => {
                      if (!canEditSaleBillFields) return;
                      const t = sanitizeNonNegDecimal(e.target.value, 10, 3);
                      setLineWeightEdit({ idx, text: t });
                      recalcLine(idx, { weight: clampSaleWeight(parseNumInput(t)) });
                    }}
                    onBlur={() => {
                      if (lineWeightEdit?.idx !== idx) return;
                      const w = clampSaleWeight(parseNumInput(lineWeightEdit.text));
                      recalcLine(idx, { weight: w });
                      setLineWeightEdit(null);
                    }}
                    title="Weight: max 9999999999.999 (three decimals)"
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="9999999.99"
                    className="sale-bill-rate-input"
                    placeholder="0.00"
                    value={Number(L.rate) === 0 ? '' : roundRate2(L.rate)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') {
                        recalcLine(idx, { rate: 0 });
                        return;
                      }
                      const v = parseFloat(raw);
                      if (!Number.isFinite(v)) return;
                      recalcLine(idx, { rate: v });
                    }}
                    onBlur={() => recalcLine(idx, { rate: roundRate2(L.rate) })}
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    style={{ width: '2.25rem' }}
                    value={L.cal}
                    onChange={(e) => {
                      const d = String(e.target.value ?? '').replace(/\D/g, '');
                      const digit = d.length > 1 ? d.slice(-1) : d.slice(0, 1);
                      recalcLine(idx, { cal: digit || '1' });
                    }}
                    onFocus={selectAllOnFocus}
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>{fmtCellAmt(L.amount)}</td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: '3.5rem' }}
                    value={dispNum(L.dis_per)}
                    onChange={(e) => recalcLine(idx, { dis_per: parseNumInput(e.target.value) })}
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: '3.25rem' }}
                    value={dispNum(L.cgst_per)}
                    onChange={(e) => recalcLine(idx, { cgst_per: parseNumInput(e.target.value) })}
                    disabled={!canEditSaleBillFields}
                    title="CGST_PER"
                  />
                </td>
                <td className="num">{fmtAmtAlways(L.cgst_amt)}</td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: '3.25rem' }}
                    value={dispNum(L.sgst_per)}
                    onChange={(e) => recalcLine(idx, { sgst_per: parseNumInput(e.target.value) })}
                    disabled={!canEditSaleBillFields}
                    title="SGST_PER"
                  />
                </td>
                <td className="num">{fmtAmtAlways(L.sgst_amt)}</td>
                <td>
                  <input
                    type="text"
                    inputMode="decimal"
                    style={{ width: '3.25rem' }}
                    value={dispNum(L.igst_per)}
                    onChange={(e) => recalcLine(idx, { igst_per: parseNumInput(e.target.value) })}
                    disabled={!canEditSaleBillFields}
                    title="IGST_PER"
                  />
                </td>
                <td className="num">{fmtAmtAlways(L.igst_amt)}</td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="9999999.99"
                    className="sale-bill-rate-input sale-bill-rate-input--narrow"
                    placeholder="0.00"
                    value={Number(L.bk_rate) === 0 ? '' : roundRate2(L.bk_rate)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || raw === '-') {
                        recalcLine(idx, { bk_rate: 0 });
                        return;
                      }
                      const v = parseFloat(raw);
                      if (!Number.isFinite(v)) return;
                      recalcLine(idx, { bk_rate: v });
                    }}
                    onBlur={() => recalcLine(idx, { bk_rate: roundRate2(L.bk_rate) })}
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    style={{ width: '2.25rem' }}
                    value={L.bk_bw}
                    onChange={(e) => {
                      const c = singleCharFromInput(e.target.value) || 'A';
                      const v = ['B', 'W', 'A'].includes(c) ? c : 'A';
                      recalcLine(idx, { bk_bw: v });
                    }}
                    onFocus={selectAllOnFocus}
                    title="B = qty, W = weight, A = amount %"
                    disabled={!canEditSaleBillFields}
                  />
                </td>
                <td>{fmtCellAmt(L.bk_amt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {can.canAdd || can.canEdit ? (
          <button
            type="button"
            className="btn btn-secondary sale-bill-add-line"
            onClick={() =>
              setLines((p) => {
                const pc = String(ctx?.G_PLANT_CODE ?? '').trim();
                return [...p, { ...emptyLine(pc), trn_no: p.length + 1 }];
              })
            }
          >
            + Line
          </button>
        ) : null}
      </section>

      <section className="sale-bill-section sale-bill-section--card">
        <h3 className="sale-bill-section__title">Totals & charges</h3>
        <p className="sale-bill-totals-summary">
          Amount <strong>{totals.amount.toFixed(2)}</strong> · Discount <strong>{totals.dis.toFixed(2)}</strong> · CGST{' '}
          <strong>{totals.cg.toFixed(2)}</strong> · SGST <strong>{totals.sg.toFixed(2)}</strong> · IGST <strong>{totals.ig.toFixed(2)}</strong>
        </p>
        <div className="sale-bill-totals-grid">
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Labour</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={labourText !== null ? labourText : committedChargeStr(labour)}
              onFocus={() => {
                if (!canEditSaleBillFields) return;
                setLabourText(committedChargeStr(labour));
              }}
              onChange={(e) => {
                if (!canEditSaleBillFields) return;
                const t = sanitizeNonNegDecimal(e.target.value, 10, 2);
                setLabourText(t);
                setLabour(clampSaleCharge(parseNumInput(t)));
              }}
              onBlur={() => {
                if (labourText === null) return;
                setLabour(clampSaleCharge(parseNumInput(labourText)));
                setLabourText(null);
              }}
              title="Labour: max 9999999999.99 (two decimals)"
              disabled={!canEditSaleBillFields}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Freight</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={freightText !== null ? freightText : committedChargeStr(freight)}
              onFocus={() => {
                if (!canEditSaleBillFields) return;
                setFreightText(committedChargeStr(freight));
              }}
              onChange={(e) => {
                if (!canEditSaleBillFields) return;
                const t = sanitizeNonNegDecimal(e.target.value, 10, 2);
                setFreightText(t);
                setFreight(clampSaleCharge(parseNumInput(t)));
              }}
              onBlur={() => {
                if (freightText === null) return;
                setFreight(clampSaleCharge(parseNumInput(freightText)));
                setFreightText(null);
              }}
              title="Freight: max 9999999999.99 (two decimals)"
              disabled={!canEditSaleBillFields}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Insurance</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={insText !== null ? insText : committedChargeStr(ins)}
              onFocus={() => {
                if (!canEditSaleBillFields) return;
                setInsText(committedChargeStr(ins));
              }}
              onChange={(e) => {
                if (!canEditSaleBillFields) return;
                const t = sanitizeNonNegDecimal(e.target.value, 10, 2);
                setInsText(t);
                setIns(clampSaleCharge(parseNumInput(t)));
              }}
              onBlur={() => {
                if (insText === null) return;
                setIns(clampSaleCharge(parseNumInput(insText)));
                setInsText(null);
              }}
              title="Insurance: max 9999999999.99 (two decimals)"
              disabled={!canEditSaleBillFields}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Oth / roff</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              readOnly={othAutoFromRoundoff}
              value={othExpText !== null ? othExpText : committedOthStr(othExp)}
              onFocus={() => {
                if (!canEditSaleBillFields || othAutoFromRoundoff) return;
                setOthExpText(committedOthStr(othExp));
              }}
              onChange={(e) => {
                if (!canEditSaleBillFields || othAutoFromRoundoff) return;
                const t = sanitizeSignedOthDecimal(e.target.value, 10, 2);
                setOthExpText(t);
                setOthExp(clampSaleOthSigned(parseNumInput(t)));
              }}
              onBlur={() => {
                if (othExpText === null || othAutoFromRoundoff) return;
                setOthExp(clampSaleOthSigned(parseNumInput(othExpText)));
                setOthExpText(null);
              }}
              title={
                othAutoFromRoundoff
                  ? 'Auto round-off (COMPDET G_ROUNDOFF = Y): whole rupees vs lines + labour + freight + ins − discount.'
                  : 'Other / round-off (may be negative); max ±9999999999.99'
              }
              disabled={!canEditSaleBillFields}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Add code</span>
            <input
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder={String(ctx?.G_ROFF_CODE ?? ctx?.g_roff_code ?? '').trim() || 'optional'}
              title="Default from COMPDET roff_code (G_ROFF_CODE); used with oth/roff posting."
              disabled={!canEditSaleBillFields}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Bill amt (computed)</span>
            <input readOnly className="sale-bill-input-readonly" value={billAmtRounded === 0 ? '' : billAmtRounded.toFixed(2)} />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">TDS on</span>
            <input
              type="text"
              inputMode="decimal"
              value={dispNum(tdsOnAmt)}
              onChange={(e) => setTdsOnAmt(parseNumInput(e.target.value))}
              disabled={!canEditSaleBillFields}
              onFocus={(e) => {
                if ((Number(tdsOnAmt) || 0) === 0 && Number(billAmtRounded) !== 0) {
                  setTdsOnAmt(billAmtRounded);
                }
                const el = e.target;
                window.setTimeout(() => {
                  try {
                    el.select();
                  } catch (_) {}
                }, 0);
              }}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">TDS %</span>
            <input type="text" inputMode="decimal" value={dispNum(tdsPer)} onChange={(e) => setTdsPer(parseNumInput(e.target.value))} disabled={!canEditSaleBillFields} />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">TDS amt</span>
            <input readOnly className="sale-bill-input-readonly" value={tdsAmt === 0 ? '' : tdsAmt.toFixed(2)} />
          </label>
        </div>
        <p className="sale-bill-net-payable">
          Net payable <span>{(billAmtRounded - tdsAmt).toFixed(2)}</span>
        </p>
        <div className="sale-bill-transport-row">
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Truck</span>
            <input value={truckNo} onChange={(e) => setTruckNo(e.target.value)} disabled={!canEditSaleBillFields} />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">TPT</span>
            <input value={tpt} onChange={(e) => setTpt(e.target.value)} disabled={!canEditSaleBillFields} />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">GR</span>
            <input value={grNo} onChange={(e) => setGrNo(e.target.value)} disabled={!canEditSaleBillFields} />
          </label>
        </div>
      </section>

      <footer className="sale-bill-footer slide-21-sale-bill-ignore-enter">
        <div className="sale-bill-footer-inner">
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Home
        </button>
        <button type="button" className="btn btn-secondary" onClick={openPrintBill}>
          Print bill
        </button>
        {showBillSlotNav ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void clearSaleBillFormForPrevEntry();
            }}
          >
            Prev bill
          </button>
        ) : null}
        {showBillSlotNav ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void clearSaleBillFormForNewEntry();
            }}
          >
            Next bill
          </button>
        ) : null}
        {mode === 'new' && can.canAdd ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={postedNewBill && !can.canEdit}
            title={
              postedNewBill && !can.canEdit
                ? 'Use Next bill or Prev bill for a new voucher, or enable Edit (F1) to change this bill.'
                : undefined
            }
            onClick={() => handleSave(postedNewBill ? 'edit' : 'add')}
          >
            {postedNewBill ? 'Update bill' : 'Save new bill'}
          </button>
        ) : null}
        {mode === 'edit' && can.canEdit ? (
          <button type="button" className="btn btn-primary" onClick={() => handleSave('edit')}>
            Update bill
          </button>
        ) : null}
        {mode === 'delete' && can.canDelete ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (window.confirm('Delete SALE, LEDGER, STOCK, and BILLS rows for this bill key?')) handleSave('delete');
            }}
          >
            Delete bill
          </button>
        ) : null}
        </div>
      </footer>
      {createPortal(
        msg ? (
          <div
            className="sale-bill-save-toast-overlay"
            role="alert"
            aria-live="assertive"
            onClick={() => setMsg('')}
          >
            <div
              className="sale-bill-save-toast-card"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="sale-bill-save-toast-title"
            >
              <p id="sale-bill-save-toast-title" className="sale-bill-save-toast-text">
                {msg}
              </p>
              <button type="button" className="btn btn-primary sale-bill-save-toast-ok" onClick={() => setMsg('')}>
                OK
              </button>
            </div>
          </div>
        ) : null,
        document.body
      )}
    </div>
  );
}
