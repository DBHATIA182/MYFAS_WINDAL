import React, { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import ProductionListScreen from './ProductionListScreen';
import ProductionPostingScreen from './ProductionPostingScreen';
import ProductionPrintScreen from './ProductionPrintScreen';
const ProductionPrintModal = lazy(() => import('../components/ProductionPrintModal'));
import { DcActionBar } from '../components/DispatchChallanActionBar';
import PbItemPickFloatingPortal from '../components/PbItemPickFloatingPortal';
import PbPartyBrokerPickPortal from '../components/PbPartyBrokerPickPortal';
import SaleEntryTopBar from '../components/SaleEntryTopBar';
import SaleEntryScreenHeader from '../components/SaleEntryScreenHeader';
import { filterItemCodeNameRows, SEARCH_ITEM_TYPE_HINT, SEARCH_NO_MATCH } from '../utils/masterSearchFilter';
import {
  resolveSaleEntryFinYear,
  clampYmdToFinYear,
  defaultDocDateInFinYear,
} from '../utils/saleEntryFinYear';

const reqOpts = { withCredentials: true, timeout: 120000 };
const MAX_QNTY = 9999999999;
const MAX_WEIGHT = 9999999999.999;

function upperItemInput(v) {
  return String(v ?? '').toUpperCase();
}

function clampQnty(n) {
  const x = Math.floor(Number(n) || 0);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(MAX_QNTY, x);
}

function clampWeight(n) {
  const x = Number(n) || 0;
  if (!Number.isFinite(x) || x <= 0) return 0;
  const c = Math.max(0, Math.min(MAX_WEIGHT, x));
  return Math.round(c * 1000) / 1000;
}

function parseQntyInput(raw) {
  const s = String(raw ?? '').replace(/\D/g, '').slice(0, 10);
  if (!s) return 0;
  return clampQnty(Number(s));
}

function parseWeightInput(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === '-' || s === '.') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return clampWeight(n);
}

function fmtQnty(v) {
  const n = clampQnty(v);
  if (n === 0) return '';
  return String(n);
}

function fmtWeight(v) {
  const n = clampWeight(v);
  if (n === 0) return '';
  return n.toFixed(3);
}

function focusNextInForm(rootEl, currentEl) {
  if (!rootEl || !currentEl) return;
  const list = Array.from(
    rootEl.querySelectorAll('input:not([type="hidden"]):not([readonly]):not([type="button"]), select, textarea')
  ).filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1');
  const i = list.indexOf(currentEl);
  if (i >= 0 && i < list.length - 1) list[i + 1].focus();
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

function handleEnterAsTab(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!t || t.closest('.slide-32-production-ignore-enter')) return;
  if (t.closest('.entry-code-name-search') || t.closest('.prod-line-item-input')) return;
  if (t.tagName === 'TEXTAREA') return;
  e.preventDefault();
  if (typeof t.blur === 'function') t.blur();
  const root = t.closest('.slide-32-production');
  window.requestAnimationFrame(() => {
    if (root) focusNextInForm(root, t);
  });
}

function singleBkh(raw) {
  const u = String(raw ?? 'B').trim().toUpperCase();
  if (!u) return 'B';
  const c = u.length > 1 ? u.slice(-1) : u.slice(0, 1);
  return c === 'K' || c === 'H' ? c : 'B';
}

function emptyLine(trn = 1) {
  return {
    trn_no: trn,
    item_code: '',
    item_name: '',
    prod_per: 0,
    qnty: 0,
    status: 'B',
    weight: 0,
    short: 0,
  };
}

export default function Slide32ProductionEntry({ apiBase, formData, userName, onPrev, onReset }) {
  const sNoRef = useRef('');
  const slotGenRef = useRef(0);
  const dateInputRef = useRef(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYearLogin = String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim();
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [perm, setPerm] = useState(null);
  const [lookups, setLookups] = useState({ plants: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState('');
  const [hintMsg, setHintMsg] = useState('');
  const [err, setErr] = useState('');

  const [mode, setMode] = useState('new');
  const [sDateYmd, setSDateYmd] = useState(() => {
    const fyStart = toInputDateString(formData?.comp_s_dt ?? formData?.COMP_S_DT);
    return fyStart || toInputDateString(new Date());
  });
  const [sNo, setSNo] = useState('');
  const [millItem, setMillItem] = useState('');
  const [milling, setMilling] = useState(0);
  const [mQnty, setMQnty] = useState(0);
  const [mStatus, setMStatus] = useState('B');
  const [plantCode, setPlantCode] = useState('');
  const [lines, setLines] = useState([emptyLine(1)]);

  const [listOpen, setListOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [postingOpen, setPostingOpen] = useState(false);
  const [numEdit, setNumEdit] = useState(null);
  const [lineItemFind, setLineItemFind] = useState(null);
  const [lineItemSheetOpen, setLineItemSheetOpen] = useState(false);
  const [millItemFind, setMillItemFind] = useState(null);
  const [millItemSheetOpen, setMillItemSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );

  const sDateOracle = useMemo(() => toOracleDate(sDateYmd), [sDateYmd]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const { compYear, fyMinYmd, fyMaxYmd } = useMemo(() => resolveSaleEntryFinYear(formData, null), [formData]);

  useEffect(() => {
    setSDateYmd((prev) => clampYmdToFinYear(prev, fyMinYmd, fyMaxYmd) || defaultDocDateInFinYear(fyMinYmd, fyMaxYmd));
  }, [fyMinYmd, fyMaxYmd]);

  const itemByCode = useCallback(
    (ic) => lookups.items.find((x) => String(x.ITEM_CODE ?? x.item_code) === String(ic)),
    [lookups.items]
  );

  const millItemName = useMemo(() => {
    const it = itemByCode(millItem);
    return it ? String(it.ITEM_NAME ?? it.item_name ?? '').trim() : '';
  }, [millItem, itemByCode]);

  const lineItemMatches = useMemo(() => {
    if (lineItemFind == null) return [];
    return filterItemCodeNameRows(lookups.items, lineItemFind.query, 50);
  }, [lineItemFind, lookups.items]);

  const lineItemSafeHi = Math.min(lineItemFind?.hi ?? 0, Math.max(0, lineItemMatches.length - 1));

  const lineItemPickRows = useMemo(
    () =>
      lineItemMatches.map((it, index) => {
        const pc = String(it.ITEM_CODE ?? it.item_code ?? '').trim();
        return {
          key: pc,
          code: pc,
          name: it.ITEM_NAME ?? it.item_name,
          highlight: lineItemSafeHi === index,
        };
      }),
    [lineItemMatches, lineItemSafeHi]
  );

  const millItemMatches = useMemo(() => {
    if (millItemFind == null) return [];
    return filterItemCodeNameRows(lookups.items, millItemFind.query, 50);
  }, [millItemFind, lookups.items]);

  const millItemSafeHi = Math.min(millItemFind?.hi ?? 0, Math.max(0, millItemMatches.length - 1));

  const millItemPickRows = useMemo(
    () =>
      millItemMatches.map((it, index) => {
        const pc = upperItemInput(it.ITEM_CODE ?? it.item_code);
        return {
          key: pc,
          code: pc,
          name: it.ITEM_NAME ?? it.item_name,
          highlight: millItemSafeHi === index,
        };
      }),
    [millItemMatches, millItemSafeHi]
  );

  const can = perm || {};
  const accessOnlyBrowse = !!can.canOpen && !can.canAdd && !can.canEdit && !can.canDelete;
  const canEditFields = useMemo(
    () =>
      !accessOnlyBrowse &&
      ((mode === 'new' && !!can.canAdd) || (mode === 'edit' && !!can.canEdit) || (mode === 'delete' && !!can.canDelete)),
    [accessOnlyBrowse, mode, can]
  );
  const fieldsDisabled = !can.canOpen || accessOnlyBrowse || mode === 'delete';

  const totals = useMemo(() => {
    let pQ = 0;
    let pW = 0;
    let pS = 0;
    for (const L of lines) {
      pQ += Number(L.qnty) || 0;
      pW += Number(L.weight) || 0;
      pS += Number(L.short) || 0;
    }
    return { mQ: Number(mQnty) || 0, mW: Number(milling) || 0, pQ, pW, pS };
  }, [lines, mQnty, milling]);

  const showNotice = useCallback((text) => {
    setErr('');
    setSuccessMsg('');
    setHintMsg(text);
  }, []);

  const showSuccess = useCallback((text) => {
    setErr('');
    setHintMsg('');
    setSuccessMsg(text);
  }, []);

  const numKey = (scope, idx, field) => `${scope}:${idx ?? ''}:${field}`;

  const numDisplay = useCallback(
    (scope, idx, field, value, fmt) => {
      const k = numKey(scope, idx, field);
      if (numEdit?.key === k) return numEdit.text;
      return fmt(value);
    },
    [numEdit]
  );

  const startNumEdit = useCallback((scope, idx, field, value, fmt) => {
    const shown = fmt(value);
    setNumEdit({ key: numKey(scope, idx, field), scope, idx, field, text: shown === '' ? '' : shown });
  }, []);

  const commitNumEdit = useCallback(
    (scope, idx, field) => {
      if (!numEdit || numEdit.scope !== scope || numEdit.idx !== idx || numEdit.field !== field) return;
      const raw = numEdit.text;
      setNumEdit(null);
      if (scope === 'header') {
        if (field === 'milling') setMilling(parseWeightInput(raw));
        else if (field === 'm_qnty') setMQnty(parseQntyInput(raw));
        return;
      }
      if (scope !== 'line' || idx == null) return;
      setLines((prev) => {
        const n = [...prev];
        const row = { ...n[idx] };
        if (field === 'prod_per') row.prod_per = parseWeightInput(raw);
        else if (field === 'qnty') row.qnty = parseQntyInput(raw);
        else if (field === 'weight') row.weight = parseWeightInput(raw);
        else if (field === 'short') row.short = parseWeightInput(raw);
        n[idx] = row;
        return n;
      });
    },
    [numEdit]
  );

  const onNumKeyDown = useCallback(
    (e, scope, idx, field) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      commitNumEdit(scope, idx, field);
      const root = e.target.closest('.slide-32-production');
      window.requestAnimationFrame(() => {
        if (root) focusNextInForm(root, e.target);
      });
    },
    [commitNumEdit]
  );

  useEffect(() => {
    sNoRef.current = sNo;
  }, [sNo]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { comp_uid: compUid, user_name: userName };
      const [pRes, lRes] = await Promise.all([
        axios.get(`${apiBase}/api/production-user-permissions`, { params, ...reqOpts }),
        axios.get(`${apiBase}/api/production-lookups`, {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        }),
      ]);
      setPerm(pRes.data);
      setLookups({ plants: lRes.data?.plants || [], items: lRes.data?.items || [] });
      if (!pRes.data?.canOpen) setErr('Access Denied');
      else {
        try {
          const { data: anchor } = await axios.get(`${apiBase}/api/production-anchor`, {
            params: { comp_code: compCode, comp_uid: compUid },
            ...reqOpts,
          });
          const ad = anchor?.s_date ?? anchor?.S_DATE;
          if (ad) {
            const ymd = toInputDateString(ad);
            if (ymd) {
              setSDateYmd((prev) => {
                const { fyMinYmd: fmin, fyMaxYmd: fmax } = resolveSaleEntryFinYear(formData, null);
                return clampYmdToFinYear(ymd, fmin, fmax) || ymd;
              });
            }
          }
        } catch (_) {}
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const fetchNextSNo = useCallback(async () => {
    if (!sDateOracle) return;
    const { data } = await axios.get(`${apiBase}/api/production-next-s-no`, {
      params: { comp_code: compCode, comp_uid: compUid, s_date: sDateOracle },
      ...reqOpts,
    });
    const next = String(data?.s_no ?? '');
    sNoRef.current = next;
    setSNo(next);
  }, [apiBase, compCode, compUid, sDateOracle]);

  useEffect(() => {
    if (loading || mode !== 'new') return;
    void fetchNextSNo().catch(() => {});
  }, [loading, mode, sDateOracle, fetchNextSNo]);

  const applyLoaded = useCallback(
    (data) => {
      const h = data.header;
      if (!h) return;
      const sd = h.s_date ?? h.S_DATE;
      setSDateYmd(toInputDateString(sd) || sDateYmd);
      const sn = String(h.s_no ?? h.S_NO ?? '');
      sNoRef.current = sn;
      setSNo(sn);
      setMillItem(upperItemInput(h.item ?? h.ITEM).trim());
      setMilling(Number(h.milling ?? h.MILLING ?? 0) || 0);
      setMQnty(Number(h.m_qnty ?? h.M_QNTY ?? 0) || 0);
      setMStatus(singleBkh(h.m_status ?? h.M_STATUS));
      setPlantCode(String(h.plant_code ?? h.PLANT_CODE ?? '').trim());
      const rows = Array.isArray(data.lines) ? data.lines : [];
      const prodRows = rows.filter((r) => String(r.item_code ?? r.ITEM_CODE ?? '').trim());
      setLines(
        prodRows.length
          ? prodRows.map((r, i) => {
              const ic = String(r.item_code ?? r.ITEM_CODE ?? '').trim();
              const it = itemByCode(ic);
              return {
                trn_no: Number(r.trn_no ?? r.TRN_NO ?? i + 1) || i + 1,
                item_code: ic,
                item_name: String(r.item_name ?? r.LINE_ITEM_NAME ?? it?.ITEM_NAME ?? it?.item_name ?? '').trim(),
                prod_per: Number(r.prod_per ?? r.PROD_PER ?? 0) || 0,
                qnty: Number(r.qnty ?? r.QNTY ?? 0) || 0,
                status: singleBkh(r.status ?? r.STATUS),
                weight: Number(r.weight ?? r.WEIGHT ?? 0) || 0,
                short: Number(r.short ?? r.SHORT ?? 0) || 0,
              };
            })
          : [emptyLine(1)]
      );
    },
    [itemByCode, sDateYmd]
  );

  const loadVoucher = useCallback(
    async (dateOracle, no) => {
      const gen = ++slotGenRef.current;
      try {
        const { data } = await axios.get(`${apiBase}/api/production-entry`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            s_date: dateOracle,
            s_no: String(no).trim(),
          },
          ...reqOpts,
        });
        if (gen !== slotGenRef.current) return;
        if (!data?.header) {
          const noStr = String(no).trim();
          sNoRef.current = noStr;
          setSNo(noStr);
          setMode('new');
          setLines([emptyLine(1)]);
          showNotice('No voucher at this Sr.No. — ready for new entry.');
          return;
        }
        applyLoaded(data);
        const hh = data.header;
        if (hh) sNoRef.current = String(hh.s_no ?? hh.S_NO ?? no).trim();
        if (can.canEdit) setMode('edit');
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
      }
    },
    [apiBase, compCode, compUid, applyLoaded, can.canEdit, showNotice]
  );

  const stepSNo = useCallback(
    async (delta) => {
      const curStr = String(sNoRef.current ?? sNo ?? '').trim().replace(/\D/g, '');
      const dir = !curStr ? (delta < 0 ? 'last' : 'first') : delta < 0 ? 'prev' : 'next';
      try {
        const params = {
          comp_code: compCode,
          comp_uid: compUid,
          dir,
        };
        if (sDateOracle) params.s_date = sDateOracle;
        if (curStr) params.s_no = curStr;

        const { data } = await axios.get(`${apiBase}/api/production-nav`, { params, ...reqOpts });
        const navDateRaw = data?.s_date ?? data?.S_DATE;
        const navNo = data?.s_no ?? data?.S_NO;

        if (navDateRaw == null || navNo == null || String(navNo).trim() === '') {
          showNotice(delta < 0 ? 'No previous production voucher.' : 'No next production voucher.');
          return;
        }

        const ymd = toInputDateString(navDateRaw);
        const oracle = ymd ? toOracleDate(ymd) : '';
        if (!oracle) {
          showNotice('Could not read voucher date from navigation.');
          return;
        }
        if (ymd) setSDateYmd(ymd);
        await loadVoucher(oracle, navNo);
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Navigation failed');
      }
    },
    [apiBase, compCode, compUid, sDateOracle, sNo, loadVoucher, showNotice]
  );

  const applyItemToLine = (idx, ic) => {
    const code = upperItemInput(ic).trim();
    const it = itemByCode(code);
    setLines((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        item_code: code,
        item_name: it ? String(it.ITEM_NAME ?? it.item_name ?? '').trim() : code,
      };
      return next;
    });
  };

  const focusFirstLineItem = useCallback(() => {
    window.requestAnimationFrame(() => {
      const el = document.querySelector('[data-prod-line-item="0"]');
      if (el && typeof el.focus === 'function') {
        el.focus();
        el.select?.();
      }
    });
  }, []);

  const clearForNew = useCallback(() => {
    setMillItem('');
    setMilling(0);
    setMQnty(0);
    setMStatus('B');
    setPlantCode('');
    setLines([emptyLine(1)]);
    setLineItemFind(null);
    setLineItemSheetOpen(false);
    setMillItemFind(null);
    setMillItemSheetOpen(false);
    void fetchNextSNo();
  }, [fetchNextSNo]);

  const focusFieldAfter = useCallback((el) => {
    if (!el) return;
    const root = el.closest('.slide-32-production');
    window.requestAnimationFrame(() => {
      if (root) focusNextInForm(root, el);
    });
  }, []);

  const pickItemForLine = useCallback(
    (idx, itemCode) => {
      applyItemToLine(idx, itemCode);
      setLineItemFind(null);
      setLineItemSheetOpen(false);
      const el = document.querySelector(`[data-prod-line-item="${idx}"]`);
      if (el) focusFieldAfter(el);
    },
    [focusFieldAfter]
  );

  const commitLineItemFinderPick = useCallback(
    (idx, query, hi = 0) => {
      const q = String(query ?? '').trim();
      if (!q) {
        setLineItemFind(null);
        setLineItemSheetOpen(false);
        return true;
      }
      const matches = filterItemCodeNameRows(lookups.items, q, 30);
      if (matches.length > 0) {
        const pickHi = Math.min(Math.max(0, hi), matches.length - 1);
        const row = matches[pickHi];
        pickItemForLine(idx, row.ITEM_CODE ?? row.item_code);
        return true;
      }
      const ic = upperItemInput(q).trim();
      if (ic && itemByCode(ic)) {
        pickItemForLine(idx, ic);
        return true;
      }
      if (ic) {
        showNotice(`Invalid item code: ${ic}. Choose from search list.`);
        setLineItemFind(null);
        setLineItemSheetOpen(false);
        return false;
      }
      setLineItemFind(null);
      setLineItemSheetOpen(false);
      return true;
    },
    [lookups.items, itemByCode, pickItemForLine, showNotice]
  );

  const openLineItemPick = useCallback(
    (idx) => {
      if (fieldsDisabled || !canEditFields) return;
      setLineItemFind({
        idx,
        hi: 0,
        query: '',
      });
      setLineItemSheetOpen(true);
    },
    [fieldsDisabled, canEditFields]
  );

  const pickMillItem = useCallback((itemCode) => {
    setMillItem(upperItemInput(itemCode).trim());
    setMillItemFind(null);
    setMillItemSheetOpen(false);
  }, []);

  const commitMillItemFinderPick = useCallback(
    (query, hi = 0) => {
      const q = upperItemInput(query).trim();
      if (!q) {
        setMillItemFind(null);
        setMillItemSheetOpen(false);
        return true;
      }
      const matches = filterItemCodeNameRows(lookups.items, q, 30);
      if (matches.length > 0) {
        const pickHi = Math.min(Math.max(0, hi), matches.length - 1);
        const row = matches[pickHi];
        pickMillItem(row.ITEM_CODE ?? row.item_code);
        return true;
      }
      if (itemByCode(q)) {
        pickMillItem(q);
        return true;
      }
      showNotice(`Invalid item code: ${q}. Choose from search list.`);
      setMillItemFind(null);
      setMillItemSheetOpen(false);
      return false;
    },
    [lookups.items, itemByCode, pickMillItem, showNotice]
  );

  const openMillItemPick = useCallback(() => {
    if (fieldsDisabled || !canEditFields) return;
    setMillItemFind({ query: '', hi: 0 });
    setMillItemSheetOpen(true);
  }, [fieldsDisabled, canEditFields]);

  const startNewEntry = useCallback(() => {
    const todayYmd =
      clampYmdToFinYear(toInputDateString(new Date()), fyMinYmd, fyMaxYmd) ||
      defaultDocDateInFinYear(fyMinYmd, fyMaxYmd);
    setMode('new');
    setSuccessMsg('');
    setHintMsg('');
    setErr('');
    if (todayYmd) setSDateYmd(todayYmd);
    setMillItem('');
    setMilling(0);
    setMQnty(0);
    setMStatus('B');
    setPlantCode('');
    setLines([emptyLine(1)]);
    setLineItemFind(null);
    setLineItemSheetOpen(false);
    setMillItemFind(null);
    setMillItemSheetOpen(false);
    const oracle = todayYmd ? toOracleDate(todayYmd) : '';
    if (oracle) {
      axios
        .get(`${apiBase}/api/production-next-s-no`, {
          params: { comp_code: compCode, comp_uid: compUid, s_date: oracle },
          ...reqOpts,
        })
        .then(({ data }) => {
          const next = String(data?.s_no ?? '');
          sNoRef.current = next;
          setSNo(next);
        })
        .catch(() => {});
    }
    window.requestAnimationFrame(() => dateInputRef.current?.focus());
  }, [apiBase, compCode, compUid, fyMinYmd, fyMaxYmd]);

  const handleDelMode = useCallback(() => {
    if (!String(sNo ?? '').trim() || !sDateOracle) {
      showNotice('Open a saved voucher (date and Sr.No.) before delete.');
      return;
    }
    if (!window.confirm('Do you want to delete this production voucher?')) return;
    setMode('delete');
    setHintMsg('Delete mode — click Delete on toolbar to confirm removal.');
  }, [sNo, sDateOracle, showNotice]);

  const handleSave = async (saveMode) => {
    setSuccessMsg('');
    setHintMsg('');
    setErr('');
    if (!userName) {
      showNotice('User name missing — sign in again.');
      return;
    }
    const plant = String(plantCode ?? '').trim();
    if (saveMode !== 'delete' && !plant) {
      showNotice('Plant is required.');
      return;
    }
    if (fyMinYmd && fyMaxYmd && sDateYmd && (sDateYmd < fyMinYmd || sDateYmd > fyMaxYmd)) {
      showNotice(`Date must be between ${toDisplayDate(fyMinYmd)} and ${toDisplayDate(fyMaxYmd)}.`);
      return;
    }
    const validLines = lines.filter((L) => String(L.item_code ?? '').trim());
    const hasMilling = !!String(millItem ?? '').trim();
    const hasProduction = validLines.length > 0;
    if (saveMode !== 'delete' && !hasMilling && !hasProduction) {
      showNotice('Enter milling item and/or at least one production line with item.');
      return;
    }
    try {
      const payload = {
        comp_code: compCode,
        comp_uid: compUid,
        comp_year: compYear || compYearLogin || undefined,
        user_name: userName,
        mode: saveMode,
        header: {
          s_date: sDateOracle,
          s_no: String(sNo ?? '').trim() || undefined,
          item: upperItemInput(millItem).trim(),
          milling: clampWeight(milling),
          m_qnty: clampQnty(mQnty),
          m_status: mStatus,
          plant_code: plant,
        },
        lines: validLines.map((L, i) => ({
          trn_no: i + 1,
          item_code: L.item_code,
          prod_per: clampWeight(L.prod_per),
          qnty: clampQnty(L.qnty),
          status: singleBkh(L.status),
          weight: clampWeight(L.weight),
          short: clampWeight(L.short),
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/production-save`, payload, reqOpts);
      if (saveMode === 'delete') {
        showSuccess('Production entry deleted.');
        setMode('new');
        clearForNew();
      } else {
        setSNo(String(data?.s_no ?? sNo));
        setMode('edit');
        showSuccess(saveMode === 'add' ? 'Production entry posted.' : 'Production entry updated.');
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    }
  };

  const openFromList = async (row) => {
    setListOpen(false);
    const sd = row.s_date;
    const sn = row.s_no;
    if (sd) setSDateYmd(toInputDateString(sd) || sDateYmd);
    setMode('edit');
    await loadVoucher(sd || sDateOracle, sn);
  };

  const ctx = useMemo(
    () => ({
      COMP_NAME: compName,
      COMP_YEAR: compYear || compYearLogin,
    }),
    [compName, compYear, compYearLogin]
  );

  const toolbarBtn = (cls, props, label) => (
    <button type="button" className={`btn ${cls} prod-toolbar-btn`} {...props}>
      {label}
    </button>
  );

  const prodNavButtons = (
    <>
      {toolbarBtn('btn-secondary', { onClick: () => void stepSNo(-1), title: 'Previous voucher' }, '← Prev')}
      {toolbarBtn('btn-secondary', { onClick: () => void stepSNo(1), title: 'Next voucher' }, 'Next →')}
    </>
  );

  const screenActionButtons = (
    <>
      {toolbarBtn('btn-secondary', { onClick: onPrev, title: 'Back to menu' }, 'Back')}
      {toolbarBtn('btn-secondary', { onClick: onReset, title: 'Home' }, 'Home')}
      {can.canAdd
        ? toolbarBtn('btn-secondary', { onClick: () => startNewEntry(), title: 'New voucher (today’s date)' }, 'Add')
        : null}
      {can.canEdit ? toolbarBtn('btn-secondary', { onClick: () => setMode('edit'), title: 'Edit mode' }, 'Edit') : null}
      {can.canDelete
        ? toolbarBtn('btn-secondary', { onClick: () => handleDelMode(), title: 'Delete voucher' }, 'Del')
        : null}
      {toolbarBtn('btn-secondary', { onClick: () => setListOpen(true), title: 'Production list' }, 'List')}
      {toolbarBtn(
        'btn-secondary',
        {
          onClick: () => {
            if (!sDateYmd || !String(sNo ?? '').trim()) {
              showNotice('Enter date and Sr.No. (save the voucher first) before print.');
              return;
            }
            if (isMobile) setPrintModalOpen(true);
            else setPrintOpen(true);
          },
          title: 'Print voucher',
        },
        'Print'
      )}
      {toolbarBtn(
        'btn-secondary',
        {
          title: 'View STOCK posting (TYPE PR) for this voucher',
          onClick: () => setPostingOpen(true),
        },
        'Post'
      )}
      {mode === 'new' && can.canAdd
        ? toolbarBtn(
            'prod-toolbar-btn prod-toolbar-btn--save',
            { onClick: () => void handleSave('add'), title: 'Save voucher' },
            'Save'
          )
        : null}
      {mode === 'edit' && can.canEdit
        ? toolbarBtn(
            'prod-toolbar-btn prod-toolbar-btn--update',
            { onClick: () => void handleSave('edit'), title: 'Update voucher' },
            'Update'
          )
        : null}
      {mode === 'delete' && can.canDelete
        ? toolbarBtn(
            'prod-toolbar-btn prod-toolbar-btn--delete',
            { onClick: () => void handleSave('delete'), title: 'Delete voucher' },
            'Delete'
          )
        : null}
    </>
  );

  const screenActions = (
    <>
      {prodNavButtons}
      {screenActionButtons}
    </>
  );

  if (listOpen) {
    return (
      <ProductionListScreen
        apiBase={apiBase}
        formData={formData}
        onClose={() => setListOpen(false)}
        onOpenVoucher={(row) => void openFromList(row)}
      />
    );
  }

  if (postingOpen) {
    return (
      <ProductionPostingScreen
        apiBase={apiBase}
        formData={formData}
        defaultSDateYmd={sDateYmd}
        defaultSNo={sNo}
        onClose={() => setPostingOpen(false)}
      />
    );
  }

  if (printOpen && !isMobile) {
    return (
      <ProductionPrintScreen
        apiBase={apiBase}
        formData={formData}
        defaultSDateYmd={sDateYmd}
        defaultSNo={sNo}
        onClose={() => setPrintOpen(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className="slide slide-32-production slide-32-production--loading">
        <div className="sale-bill-loading-card">
          <h2>Production entry</h2>
          <p>Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!can.canOpen) {
    return (
      <div className="slide slide-32-production">
        <h2>Production entry</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access Denied'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div
      className={`slide slide-32-production slide-22-dispatch-challan sale-bill-page${isMobile ? ' pb-layout--mobile' : ' sale-entry-desktop'}${isMobile && (lineItemSheetOpen || millItemSheetOpen) ? ' pb-pick-open' : ''}`}
      onKeyDown={handleEnterAsTab}
      role="presentation"
    >
      <SaleEntryScreenHeader
        title="Production entry"
        topBar={
          <SaleEntryTopBar formData={formData} ctx={ctx} userName={userName} can={can} helpReportId="production-entry" />
        }
        nav={can.canOpen ? prodNavButtons : null}
      >
        {screenActionButtons}
      </SaleEntryScreenHeader>

      {err ? <p className="deploy-update-msg deploy-update-msg--err sale-entry-desktop__err">{err}</p> : null}
      {hintMsg ? <p className="deploy-update-msg sale-entry-desktop__err">{hintMsg}</p> : null}

      {isMobile ? (
        <DcActionBar position="top" label="Production actions">
          {screenActions}
        </DcActionBar>
      ) : null}

      <div className="sale-entry-desktop__body">
        <section className="sale-bill-section sale-bill-section--card dc-header-card">
          <div className="dc-header-row dc-header-row--top">
            <label className="dc-header-field dc-header-field--chdate">
              <span className="dc-header-k">Date</span>
              <input
                ref={dateInputRef}
                type="date"
                className="form-input dc-header-control"
                value={sDateYmd}
                disabled={fieldsDisabled}
                min={fyMinYmd || undefined}
                max={fyMaxYmd || undefined}
                onChange={(e) => {
                  const v = clampYmdToFinYear(e.target.value, fyMinYmd, fyMaxYmd);
                  setSDateYmd(v);
                }}
              />
            </label>
            <label className="dc-header-field dc-header-field--chno">
              <span className="dc-header-k">Sr.No.</span>
              <input
                className="form-input dc-header-control"
                value={sNo}
                disabled={fieldsDisabled}
                onChange={(e) => setSNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
                onBlur={() => {
                  if (sNo && sDateOracle) void loadVoucher(sDateOracle, sNo);
                }}
              />
            </label>
          </div>

          <div className="dc-header-row prod-header-row--mill-item">
            <label className="dc-header-field prod-field--mill-item">
              <span className="dc-header-k">Milling item</span>
              <div className="prod-mill-item-search-row prod-mill-item-search-wrap">
                {isMobile ? (
                  <>
                    <button
                      type="button"
                      className="form-input dc-header-control prod-mill-item-input pb-mobile-search-trigger"
                      disabled={fieldsDisabled || !canEditFields}
                      style={{ textTransform: 'uppercase' }}
                      aria-label="Milling item"
                      data-prod-mill-item
                      title={millItemName ? `${millItem} — ${millItemName}` : 'Search milling item'}
                      onClick={() => openMillItemPick()}
                    >
                      {millItem || 'Item…'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm prod-mill-item-f1 slide-32-production-ignore-enter"
                      disabled={fieldsDisabled || !canEditFields}
                      title="Open item search"
                      onClick={() => openMillItemPick()}
                    >
                      F1
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="search"
                      className="form-input dc-header-control prod-mill-item-input"
                      data-prod-mill-item
                      autoComplete="off"
                      disabled={fieldsDisabled || !canEditFields}
                      placeholder="Type code or name… (F1)"
                      style={{ textTransform: 'uppercase' }}
                      value={millItemFind != null ? millItemFind.query : millItem}
                      onChange={(e) => {
                        const q = upperItemInput(e.target.value);
                        setMillItemFind({ query: q, hi: 0 });
                        if (!q.trim()) setMillItem('');
                      }}
                      onFocus={(e) => {
                        setMillItemFind({ query: upperItemInput(millItem), hi: 0 });
                        e.target.select?.();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'F1') {
                          e.preventDefault();
                          e.stopPropagation();
                          setMillItemFind({ query: upperItemInput(millItem), hi: 0 });
                          return;
                        }
                        if (e.key === 'ArrowDown' && millItemMatches.length) {
                          e.preventDefault();
                          e.stopPropagation();
                          setMillItemFind((p) => ({
                            ...p,
                            hi: Math.min(millItemMatches.length - 1, (p?.hi ?? 0) + 1),
                          }));
                        } else if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          e.stopPropagation();
                          setMillItemFind((p) => ({ ...p, hi: Math.max(0, (p?.hi ?? 0) - 1) }));
                        } else if (e.key === 'Enter' && millItemMatches.length) {
                          e.preventDefault();
                          e.stopPropagation();
                          const row = millItemMatches[millItemSafeHi];
                          pickMillItem(row.ITEM_CODE ?? row.item_code);
                        } else if (e.key === 'Escape') {
                          setMillItemFind(null);
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setMillItemFind(null), 180);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm prod-mill-item-f1 slide-32-production-ignore-enter"
                      disabled={fieldsDisabled || !canEditFields}
                      title="Open item search (F1)"
                      onClick={() => setMillItemFind({ query: upperItemInput(millItem), hi: 0 })}
                    >
                      F1
                    </button>
                  </>
                )}
              </div>
              {millItem && millItemName && !millItemFind ? (
                <span className="prod-mill-item-name-hint" title={millItemName}>
                  {millItemName}
                </span>
              ) : null}
            </label>
          </div>

          <div className="dc-header-row prod-header-row--mill-metrics">
            <label className="dc-header-field prod-field--mill-wgt">
              <span className="dc-header-k">Milling weight</span>
              <input
                className="form-input dc-header-control prod-num--wgt"
                inputMode="decimal"
                disabled={fieldsDisabled || !canEditFields}
                value={numDisplay('header', null, 'milling', milling, fmtWeight)}
                onFocus={() => startNumEdit('header', null, 'milling', milling, fmtWeight)}
                onChange={(e) => setNumEdit({ key: numKey('header', null, 'milling'), scope: 'header', idx: null, field: 'milling', text: e.target.value })}
                onBlur={() => commitNumEdit('header', null, 'milling')}
                onKeyDown={(e) => onNumKeyDown(e, 'header', null, 'milling')}
              />
            </label>
            <label className="dc-header-field prod-field--mill-qty">
              <span className="dc-header-k">Milling qty</span>
              <input
                className="form-input dc-header-control prod-num--qty"
                inputMode="numeric"
                disabled={fieldsDisabled || !canEditFields}
                value={numDisplay('header', null, 'm_qnty', mQnty, fmtQnty)}
                onFocus={() => startNumEdit('header', null, 'm_qnty', mQnty, fmtQnty)}
                onChange={(e) => setNumEdit({ key: numKey('header', null, 'm_qnty'), scope: 'header', idx: null, field: 'm_qnty', text: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                onBlur={() => commitNumEdit('header', null, 'm_qnty')}
                onKeyDown={(e) => onNumKeyDown(e, 'header', null, 'm_qnty')}
              />
            </label>
            <label className="dc-header-field prod-field--mill-bkh">
              <span className="dc-header-k">B/K/H</span>
              <select
                className="form-input dc-header-control"
                value={mStatus}
                disabled={fieldsDisabled || !canEditFields}
                onChange={(e) => setMStatus(singleBkh(e.target.value))}
              >
                <option value="B">B</option>
                <option value="K">K</option>
                <option value="H">H</option>
              </select>
            </label>
            <label className="dc-header-field prod-field--plant">
              <span className="dc-header-k">Plant (required)</span>
              <select
                className="form-input dc-header-control dc-plant-select"
                value={plantCode}
                disabled={fieldsDisabled || !canEditFields}
                required
                onChange={(e) => {
                  const v = e.target.value;
                  setPlantCode(v);
                  if (v) focusFirstLineItem();
                }}
              >
                <option value="">— Select plant —</option>
                {(lookups.plants || []).map((p) => {
                  const code = String(p.PLANT_CODE ?? p.plant_code ?? '').trim();
                  const name = String(p.PLANT_NAME ?? p.plant_name ?? code).trim();
                  return (
                    <option key={code} value={code}>
                      {code} — {name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        </section>

        <section className="sale-bill-section dc-lines-section">
          <div className="dc-lines-wrap">
            <table className="dc-lines-table prod-lines-table">
              <thead>
                <tr>
                  <th className="dc-col-seq">Sno</th>
                  <th className="dc-col-item">Item</th>
                  <th className="dc-col-name">Item name</th>
                  <th className="dc-col-rate">Prod%</th>
                  <th className="dc-col-qty">Qty</th>
                  <th className="dc-col-st">B/K/H</th>
                  <th className="dc-col-wgt">Weight</th>
                  <th className="dc-col-amt">Short</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((L, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td className="prod-td-item">
                      <div className="prod-line-item-wrap">
                        {isMobile ? (
                          <button
                            type="button"
                            className="form-input prod-line-item-input pb-mobile-search-trigger"
                            disabled={fieldsDisabled || !canEditFields}
                            style={{ textTransform: 'uppercase' }}
                            aria-label={`Item line ${idx + 1}`}
                            data-prod-line-item={idx}
                            title={L.item_name ? `${L.item_code} — ${L.item_name}` : 'Search item'}
                            onClick={() => openLineItemPick(idx)}
                          >
                            {L.item_code || 'Item…'}
                          </button>
                        ) : (
                          <input
                            type="search"
                            className="form-input prod-line-item-input"
                            data-prod-line-item={idx}
                            autoComplete="off"
                            disabled={fieldsDisabled || !canEditFields}
                            placeholder="Item…"
                            style={{ textTransform: 'uppercase' }}
                            value={lineItemFind?.idx === idx ? lineItemFind.query : L.item_code}
                            onChange={(e) => {
                              const q = upperItemInput(e.target.value);
                              setLineItemFind({ idx, query: q, hi: 0 });
                              if (!q.trim()) applyItemToLine(idx, '');
                            }}
                            onFocus={(e) => {
                              setLineItemFind({ idx, query: upperItemInput(L.item_code), hi: 0 });
                              e.target.select?.();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowDown' && lineItemFind?.idx === idx && lineItemMatches.length) {
                                e.preventDefault();
                                e.stopPropagation();
                                setLineItemFind((p) => ({
                                  ...p,
                                  hi: Math.min(lineItemMatches.length - 1, (p?.hi ?? 0) + 1),
                                }));
                              } else if (e.key === 'ArrowUp' && lineItemFind?.idx === idx) {
                                e.preventDefault();
                                e.stopPropagation();
                                setLineItemFind((p) => ({ ...p, hi: Math.max(0, (p?.hi ?? 0) - 1) }));
                              } else if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                if (lineItemFind?.idx === idx && lineItemMatches.length) {
                                  const row = lineItemMatches[lineItemSafeHi];
                                  const ic = String(row.ITEM_CODE ?? row.item_code ?? '').trim();
                                  applyItemToLine(idx, ic);
                                  setLineItemFind(null);
                                  focusFieldAfter(e.target);
                                } else if (lineItemFind?.idx === idx) {
                                  const q = String(lineItemFind.query ?? '').trim();
                                  const hit = lookups.items.find(
                                    (x) =>
                                      String(x.ITEM_CODE ?? x.item_code ?? '').trim().toLowerCase() ===
                                      q.toLowerCase()
                                  );
                                  if (hit) {
                                    applyItemToLine(idx, String(hit.ITEM_CODE ?? hit.item_code ?? '').trim());
                                    setLineItemFind(null);
                                    focusFieldAfter(e.target);
                                  }
                                } else if (L.item_code) {
                                  setLineItemFind(null);
                                  focusFieldAfter(e.target);
                                }
                              } else if (e.key === 'Escape') {
                                setLineItemFind(null);
                              }
                            }}
                            onBlur={() => {
                              window.setTimeout(() => {
                                setLineItemFind((cur) => (cur?.idx === idx ? null : cur));
                              }, 180);
                            }}
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="dc-line-name">{L.item_name}</span>
                    </td>
                    <td>
                      <input
                        className="dc-num--rate prod-num--wgt"
                        inputMode="decimal"
                        disabled={fieldsDisabled || !canEditFields}
                        value={numDisplay('line', idx, 'prod_per', L.prod_per, fmtWeight)}
                        onFocus={() => startNumEdit('line', idx, 'prod_per', L.prod_per, fmtWeight)}
                        onChange={(e) =>
                          setNumEdit({ key: numKey('line', idx, 'prod_per'), scope: 'line', idx, field: 'prod_per', text: e.target.value })
                        }
                        onBlur={() => commitNumEdit('line', idx, 'prod_per')}
                        onKeyDown={(e) => onNumKeyDown(e, 'line', idx, 'prod_per')}
                      />
                    </td>
                    <td>
                      <input
                        className="dc-num--qty prod-num--qty"
                        inputMode="numeric"
                        disabled={fieldsDisabled || !canEditFields}
                        value={numDisplay('line', idx, 'qnty', L.qnty, fmtQnty)}
                        onFocus={() => startNumEdit('line', idx, 'qnty', L.qnty, fmtQnty)}
                        onChange={(e) =>
                          setNumEdit({
                            key: numKey('line', idx, 'qnty'),
                            scope: 'line',
                            idx,
                            field: 'qnty',
                            text: e.target.value.replace(/\D/g, '').slice(0, 10),
                          })
                        }
                        onBlur={() => commitNumEdit('line', idx, 'qnty')}
                        onKeyDown={(e) => onNumKeyDown(e, 'line', idx, 'qnty')}
                      />
                    </td>
                    <td>
                      <select
                        className="dc-line-status"
                        value={L.status}
                        disabled={fieldsDisabled || !canEditFields}
                        onChange={(e) => {
                          const st = singleBkh(e.target.value);
                          setLines((prev) => {
                            const n = [...prev];
                            n[idx] = { ...n[idx], status: st };
                            return n;
                          });
                        }}
                      >
                        <option value="B">B</option>
                        <option value="K">K</option>
                        <option value="H">H</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="dc-num--wgt prod-num--wgt"
                        inputMode="decimal"
                        disabled={fieldsDisabled || !canEditFields}
                        value={numDisplay('line', idx, 'weight', L.weight, fmtWeight)}
                        onFocus={() => startNumEdit('line', idx, 'weight', L.weight, fmtWeight)}
                        onChange={(e) =>
                          setNumEdit({ key: numKey('line', idx, 'weight'), scope: 'line', idx, field: 'weight', text: e.target.value })
                        }
                        onBlur={() => commitNumEdit('line', idx, 'weight')}
                        onKeyDown={(e) => onNumKeyDown(e, 'line', idx, 'weight')}
                      />
                    </td>
                    <td>
                      <input
                        className="dc-num--amt prod-num--wgt"
                        inputMode="decimal"
                        disabled={fieldsDisabled || !canEditFields}
                        value={numDisplay('line', idx, 'short', L.short, fmtWeight)}
                        onFocus={() => startNumEdit('line', idx, 'short', L.short, fmtWeight)}
                        onChange={(e) =>
                          setNumEdit({ key: numKey('line', idx, 'short'), scope: 'line', idx, field: 'short', text: e.target.value })
                        }
                        onBlur={() => commitNumEdit('line', idx, 'short')}
                        onKeyDown={(e) => onNumKeyDown(e, 'line', idx, 'short')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEditFields ? (
            <button
              type="button"
              className="btn btn-secondary sale-bill-add-line slide-32-production-ignore-enter"
              disabled={fieldsDisabled}
              onClick={() => setLines((prev) => [...prev, emptyLine(prev.length + 1)])}
            >
              + Add line
            </button>
          ) : null}
        </section>

        <section className="sale-bill-section sale-bill-section--card prod-totals-frame">
          <h3 className="sale-bill-section__title">Totals</h3>
          <div className="prod-totals-grid">
            <div className="prod-totals-cell">
              <span className="prod-totals-cell__label">Milling weight</span>
              <strong className="prod-totals-cell__val">{fmtWeight(totals.mW) || '0.000'}</strong>
            </div>
            <div className="prod-totals-cell">
              <span className="prod-totals-cell__label">Milling qty</span>
              <strong className="prod-totals-cell__val">{fmtQnty(totals.mQ) || '0'}</strong>
            </div>
            <div className="prod-totals-cell">
              <span className="prod-totals-cell__label">Production qty</span>
              <strong className="prod-totals-cell__val">{fmtQnty(totals.pQ) || '0'}</strong>
            </div>
            <div className="prod-totals-cell">
              <span className="prod-totals-cell__label">Production weight</span>
              <strong className="prod-totals-cell__val">{fmtWeight(totals.pW) || '0.000'}</strong>
            </div>
            <div className="prod-totals-cell">
              <span className="prod-totals-cell__label">Shortage</span>
              <strong className="prod-totals-cell__val">{fmtWeight(totals.pS) || '0.000'}</strong>
            </div>
          </div>
        </section>
      </div>

      {!isMobile ? (
        <PbItemPickFloatingPortal
          open={millItemFind != null && String(millItemFind?.query ?? '').trim() !== ''}
          lineIdx="mill"
          rootSelector=".slide-32-production"
          query={millItemFind?.query ?? ''}
          matches={millItemMatches}
          highlightIdx={millItemSafeHi}
          emptyMessage="No matching items."
          hintMessage={SEARCH_ITEM_TYPE_HINT}
          onHover={(i) => setMillItemFind((p) => (p ? { ...p, hi: i } : p))}
          onPick={(code) => pickMillItem(code)}
          highlightMatch={highlightMatch}
          normalizeItemCode={(c) => upperItemInput(c).trim()}
        />
      ) : null}
      {!isMobile ? (
        <PbItemPickFloatingPortal
          open={lineItemFind != null && String(lineItemFind.query ?? '').trim() !== ''}
          lineIdx={lineItemFind?.idx ?? null}
          rootSelector=".slide-32-production"
          lineDataAttr="data-prod-line-item"
          query={lineItemFind?.query ?? ''}
          matches={lineItemMatches}
          highlightIdx={lineItemSafeHi}
          emptyMessage="No matching items."
          hintMessage={SEARCH_ITEM_TYPE_HINT}
          onHover={(i) => setLineItemFind((p) => (p ? { ...p, hi: i } : p))}
          onPick={(code) => {
            if (lineItemFind?.idx == null) return;
            applyItemToLine(lineItemFind.idx, code);
            setLineItemFind(null);
          }}
          highlightMatch={highlightMatch}
          normalizeItemCode={(c) => String(c ?? '').trim()}
        />
      ) : null}

      {isMobile && millItemFind != null ? (
        <PbPartyBrokerPickPortal
          open={millItemSheetOpen}
          title="Milling item"
          sheet
          anchor="top"
          showFilter
          autoFocusFilter
          uppercase
          searchValue={String(millItemFind?.query ?? '')}
          searchPlaceholder="Type item code or name to search…"
          disabled={fieldsDisabled || !canEditFields}
          rows={millItemPickRows}
          emptyMessage={
            String(millItemFind?.query ?? '').trim() ? SEARCH_NO_MATCH : SEARCH_ITEM_TYPE_HINT
          }
          onSearchChange={(v) => {
            setMillItemFind((f) => (f == null ? f : { ...f, hi: 0, query: upperItemInput(v) }));
          }}
          onClose={() => {
            const f = millItemFind;
            setMillItemSheetOpen(false);
            if (f != null) commitMillItemFinderPick(f.query, f.hi ?? 0);
            else setMillItemFind(null);
          }}
          onSelect={(pc) => pickMillItem(pc)}
          onFilterKeyDown={(e) => {
            if (e.key === 'ArrowDown' && millItemMatches.length > 0) {
              e.preventDefault();
              setMillItemFind((f) =>
                f == null
                  ? f
                  : { ...f, hi: Math.min(millItemMatches.length - 1, (f.hi ?? 0) + 1) }
              );
            } else if (e.key === 'ArrowUp' && millItemMatches.length > 0) {
              e.preventDefault();
              setMillItemFind((f) => (f == null ? f : { ...f, hi: Math.max(0, (f.hi ?? 0) - 1) }));
            } else if (e.key === 'Enter' && millItemMatches.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              const row = millItemMatches[millItemSafeHi];
              if (row) pickMillItem(row.ITEM_CODE ?? row.item_code);
            } else if (e.key === 'Enter' && String(millItemFind?.query ?? '').trim()) {
              e.preventDefault();
              e.stopPropagation();
              commitMillItemFinderPick(millItemFind.query, millItemFind.hi ?? 0);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setMillItemSheetOpen(false);
              setMillItemFind(null);
            }
          }}
        />
      ) : null}

      {isMobile && lineItemFind != null ? (
        <PbPartyBrokerPickPortal
          open={lineItemSheetOpen}
          title={`Item — line ${lineItemFind.idx + 1}`}
          sheet
          anchor="top"
          showFilter
          autoFocusFilter
          uppercase
          searchValue={String(lineItemFind?.query ?? '')}
          searchPlaceholder="Type item code or name to search…"
          disabled={fieldsDisabled || !canEditFields}
          rows={lineItemPickRows}
          emptyMessage={
            String(lineItemFind?.query ?? '').trim() ? SEARCH_NO_MATCH : SEARCH_ITEM_TYPE_HINT
          }
          onSearchChange={(v) => {
            setLineItemFind((f) => (f == null ? f : { ...f, hi: 0, query: upperItemInput(v) }));
          }}
          onClose={() => {
            const f = lineItemFind;
            setLineItemSheetOpen(false);
            if (f != null) commitLineItemFinderPick(f.idx, f.query, f.hi ?? 0);
            else setLineItemFind(null);
          }}
          onSelect={(pc) => pickItemForLine(lineItemFind.idx, pc)}
          onFilterKeyDown={(e) => {
            if (e.key === 'ArrowDown' && lineItemMatches.length > 0) {
              e.preventDefault();
              setLineItemFind((f) =>
                f == null
                  ? f
                  : { ...f, hi: Math.min(lineItemMatches.length - 1, (f.hi ?? 0) + 1) }
              );
            } else if (e.key === 'ArrowUp' && lineItemMatches.length > 0) {
              e.preventDefault();
              setLineItemFind((f) => (f == null ? f : { ...f, hi: Math.max(0, (f.hi ?? 0) - 1) }));
            } else if (e.key === 'Enter' && lineItemMatches.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              const row = lineItemMatches[lineItemSafeHi];
              if (row) {
                pickItemForLine(
                  lineItemFind.idx,
                  String(row.ITEM_CODE ?? row.item_code ?? '').trim()
                );
              }
            } else if (e.key === 'Enter' && String(lineItemFind?.query ?? '').trim()) {
              e.preventDefault();
              e.stopPropagation();
              commitLineItemFinderPick(lineItemFind.idx, lineItemFind.query, lineItemFind.hi ?? 0);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setLineItemSheetOpen(false);
              setLineItemFind(null);
            }
          }}
        />
      ) : null}

      {printModalOpen ? (
        <Suspense fallback={null}>
          <ProductionPrintModal
            open={printModalOpen}
            onClose={() => {
              setPrintModalOpen(false);
              try {
                document.body.style.overflow = '';
              } catch (_) {}
            }}
            apiBase={apiBase}
            formData={formData}
            defaultSDateYmd={sDateYmd}
            defaultSNo={sNo}
          />
        </Suspense>
      ) : null}

      {successMsg
        ? createPortal(
            <div
              className="sale-bill-save-toast-overlay"
              role="presentation"
              onClick={() => setSuccessMsg('')}
            >
              <div
                className="sale-bill-save-toast-card"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="prod-save-toast-text"
                onClick={(e) => e.stopPropagation()}
              >
                <p id="prod-save-toast-text" className="sale-bill-save-toast-text">
                  {successMsg}
                </p>
                <button
                  type="button"
                  className="btn btn-primary sale-bill-save-toast-ok"
                  onClick={() => setSuccessMsg('')}
                >
                  OK
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
