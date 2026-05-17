import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import DispatchChallanListScreen from './DispatchChallanListScreen';
import DispatchChallanPrintScreen from './DispatchChallanPrintScreen';
import { DcActionBar } from '../components/DispatchChallanActionBar';
import ReportHelpButton from '../components/ReportHelpButton';
import SaleEntryFinYearStrip from '../components/SaleEntryFinYearStrip';
import MasterPartyCreateModal, { PartyAddButton } from '../components/MasterPartyCreateModal';
import LineMarkaCombo from '../components/LineMarkaCombo';
import {
  resolveSaleEntryFinYear,
  clampYmdToFinYear,
  defaultDocDateInFinYear,
} from '../utils/saleEntryFinYear';
import { upsertMasterParty } from '../utils/upsertMasterParty';

const DISPATCH_PARTY_SCHEDULE = 11.2;

const reqOpts = { withCredentials: true, timeout: 120000 };
const DEFAULT_CH_TYPE = 'I';

function normChType(raw) {
  const c = String(raw ?? DEFAULT_CH_TYPE)
    .trim()
    .toUpperCase()
    .slice(0, 1);
  return c || DEFAULT_CH_TYPE;
}

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

const MAX_WEIGHT = 9999999999.999;

function clampWeight(n) {
  const x = Number(n) || 0;
  const c = Math.max(0, Math.min(MAX_WEIGHT, x));
  return Math.round(c * 1000) / 1000;
}

function roundRate2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

function fmtWeight3(v) {
  const n = clampWeight(Number(v));
  if (n === 0) return '';
  return n.toFixed(3);
}

function fmtRate2Disp(v) {
  const n = roundRate2(Number(v));
  if (n === 0) return '';
  return n.toFixed(2);
}

function singleCharFromInput(raw) {
  const u = String(raw ?? '').toUpperCase();
  if (!u) return '';
  return u.length > 1 ? u.slice(-1) : u.slice(0, 1);
}

function selectAllOnFocus(e) {
  const el = e?.target;
  if (!el || typeof el.select !== 'function') return;
  requestAnimationFrame(() => {
    try {
      el.select();
    } catch (_) {}
  });
}

function parseLineInt6Input(raw) {
  const s = String(raw ?? '').replace(/\D/g, '').slice(0, 6);
  if (!s) return '';
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Math.min(999999, Math.floor(n)));
}

function displayLineInt6(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '';
  return String(Math.min(999999, Math.floor(x)));
}

function formatPickDate(d) {
  if (!d) return '—';
  return toDisplayDate(toInputDateString(d));
}

/** B→q×100, K→×50, H→×30; if G_AMT_CAL='Q' then ÷100. */
function computeDispatchWeight(qnty, status, gAmtCal) {
  const q = Number(qnty) || 0;
  if (q <= 0) return 0;
  const st = String(status ?? 'B').trim().toUpperCase().slice(0, 1) || 'B';
  let w = q * 100;
  if (st === 'K') w = q * 50;
  else if (st === 'H') w = q * 30;
  if (String(gAmtCal ?? '').trim().toUpperCase() === 'Q') w /= 100;
  return clampWeight(w);
}

function computeDispatchAmount(weight, rate, gAmtCal) {
  const w = Number(weight) || 0;
  const r = Number(rate) || 0;
  if (String(gAmtCal ?? '').trim().toUpperCase() === 'K') {
    return Math.round((w * r) / 100 * 100) / 100;
  }
  return Math.round(w * r * 100) / 100;
}

function focusNextInForm(rootEl, currentEl) {
  if (!rootEl || !currentEl) return;
  const list = Array.from(
    rootEl.querySelectorAll('input:not([type="hidden"]):not([type="button"]), select, textarea')
  ).filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1');
  const i = list.indexOf(currentEl);
  if (i >= 0 && i < list.length - 1) list[i + 1].focus();
}

function focusLineQnty(lineIdx) {
  window.requestAnimationFrame(() => {
    const root = document.querySelector('.slide-22-dispatch-challan');
    const el = root?.querySelector(`input[data-dc-line-qty="${lineIdx}"]`);
    if (!el || el.disabled) return;
    try {
      el.focus();
      if (typeof el.select === 'function') el.select();
    } catch (_) {}
  });
}

function handleEnterAsTab(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  if (!t || t.closest('.slide-22-dispatch-challan-ignore-enter')) return;
  if (t.tagName === 'TEXTAREA') return;
  e.preventDefault();
  const root = t.closest('.slide-22-dispatch-challan');
  if (root) focusNextInForm(root, t);
}

function emptyLine() {
  return {
    trn_no: 1,
    so_no: '',
    item_code: '',
    item_name: '',
    marka: '',
    qnty: 0,
    status: 'B',
    weight: 0,
    rate: 0,
    amount: 0,
    weight_manual: false,
    _so_ref_qty: 0,
    _so_ref_wgt: 0,
  };
}

function DispatchPickModal({ open, title, hint, emptyMessage, loading, rows, columns, hi, onHi, onClose, onPick }) {
  const cardRef = useRef(null);
  const rowRefs = useRef([]);
  const safeHi = Math.min(Math.max(0, hi), Math.max(0, rows.length - 1));

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      try {
        cardRef.current?.focus();
      } catch (_) {}
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, loading, rows.length]);

  useEffect(() => {
    if (!open || loading || rows.length === 0) return;
    rowRefs.current[safeHi]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, loading, rows.length, safeHi]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (loading || rows.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        onHi(Math.min(safeHi + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        onHi(Math.max(safeHi - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[safeHi];
        if (row) onPick(row);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, loading, rows, safeHi, onHi, onPick, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="sale-bill-pick-overlay slide-22-dispatch-challan-ignore-enter" role="presentation" onClick={onClose}>
      <div
        ref={cardRef}
        className="sale-bill-pick-card"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sale-bill-pick-card__head">
          <h3>{title}</h3>
          {hint ? <p className="sale-bill-pick-card__hint">{hint}</p> : null}
          <button type="button" className="btn btn-secondary sale-bill-pick-card__close" onClick={onClose}>
            Close
          </button>
        </header>
        {loading ? (
          <p className="sale-bill-pick-card__loading">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="sale-bill-pick-card__empty">{emptyMessage || 'No rows.'}</p>
        ) : (
          <div className="sale-bill-pick-table-wrap">
            <table className="report-table sale-bill-pick-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    className={i === safeHi ? 'sale-bill-pick-row--hi' : 'sale-bill-pick-row-clickable'}
                    onMouseEnter={() => onHi(i)}
                    onClick={() => onPick(row)}
                  >
                    {columns.map((c) => (
                      <td key={c.key}>{c.render(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sale-bill-pick-card__foot">↑ ↓ · Enter · Esc</p>
      </div>
    </div>,
    document.body
  );
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

export default function Slide22DispatchChallan({ apiBase, formData, userName, onPrev, onReset }) {
  const rNoRef = useRef('');
  const chTypeRef = useRef(DEFAULT_CH_TYPE);
  const slotGenRef = useRef(0);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYearLogin = String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim();

  const [perm, setPerm] = useState(null);
  const [masterPartyPerm, setMasterPartyPerm] = useState(null);
  const [masterPartyOpen, setMasterPartyOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [lookups, setLookups] = useState({ parties: [], plants: [], markas: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [mode, setMode] = useState('new');
  const [chType, setChType] = useState(DEFAULT_CH_TYPE);
  const [rNo, setRNo] = useState('');
  const [rDateYmd, setRDateYmd] = useState(() => toInputDateString(new Date()));
  const [code, setCode] = useState('');
  const [plantCode, setPlantCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [partyFinderOpen, setPartyFinderOpen] = useState(true);
  const [postedNew, setPostedNew] = useState(false);

  const [remarks, setRemarks] = useState('');
  const [truckNo, setTruckNo] = useState('');
  const [tpt, setTpt] = useState('');
  const [grNo, setGrNo] = useState('');
  const [lines, setLines] = useState([emptyLine()]);

  const [listScreenOpen, setListScreenOpen] = useState(false);
  const [printScreenOpen, setPrintScreenOpen] = useState(false);
  const [lineNumEdit, setLineNumEdit] = useState(null);
  const [soPick, setSoPick] = useState({ open: false, lineIdx: -1, rows: [], loading: false, hi: 0 });

  const dcLinesTopScrollRef = useRef(null);
  const dcLinesTopInnerRef = useRef(null);
  const dcLinesGridScrollRef = useRef(null);

  const rDateOracle = useMemo(() => toOracleDate(rDateYmd), [rDateYmd]);
  const gAmtCal = ctx?.G_AMT_CAL ?? 'K';
  const { compYear, fyMinYmd, fyMaxYmd } = useMemo(
    () => resolveSaleEntryFinYear(formData, ctx),
    [formData, ctx]
  );

  useEffect(() => {
    if (!ctx) return;
    setRDateYmd((prev) => clampYmdToFinYear(prev, fyMinYmd, fyMaxYmd) || defaultDocDateInFinYear(fyMinYmd, fyMaxYmd));
  }, [ctx, fyMinYmd, fyMaxYmd]);

  useEffect(() => {
    rNoRef.current = String(rNo ?? '').trim();
  }, [rNo]);
  useEffect(() => {
    chTypeRef.current = normChType(chType);
  }, [chType]);

  useEffect(() => {
    const top = dcLinesTopScrollRef.current;
    const topInner = dcLinesTopInnerRef.current;
    const grid = dcLinesGridScrollRef.current;
    if (!top || !topInner || !grid) return;
    let syncingFromTop = false;
    let syncingFromGrid = false;
    const syncWidths = () => {
      topInner.style.width = `${grid.scrollWidth}px`;
      top.style.display = grid.scrollWidth > grid.clientWidth + 1 ? 'block' : 'none';
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
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncWidths) : null;
    ro?.observe(grid);
    return () => {
      top.removeEventListener('scroll', onTopScroll);
      grid.removeEventListener('scroll', onGridScroll);
      window.removeEventListener('resize', syncWidths);
      ro?.disconnect();
    };
  }, [lines.length]);

  const partyInfo = useMemo(() => {
    if (!code) return null;
    return lookups.parties.find((p) => String(p.CODE ?? p.code) === String(code)) ?? null;
  }, [code, lookups.parties]);

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    const list = lookups.parties || [];
    if (!q) return [];
    return list
      .filter((p) => {
      const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return pc.includes(q) || name.includes(q) || city.includes(q);
    })
      .slice(0, 50);
  }, [partySearch, lookups.parties]);

  const safePartyHi = Math.min(Math.max(0, partyHi), Math.max(0, filteredParties.length - 1));

  const applyPartyPick = useCallback((pc) => {
    setCode(String(pc ?? '').trim());
    setPartyFinderOpen(false);
    setPartySearch('');
    setPartyHi(0);
  }, []);

  const tryOpenNewParty = useCallback(() => {
    const p = masterPartyPerm;
    if (!p?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!p?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    setMasterPartyOpen(true);
  }, [masterPartyPerm]);

  const handleMasterPartyCreated = useCallback(
    (row) => {
      setMasterPartyOpen(false);
      const entry = {
        CODE: row.CODE ?? row.code,
        NAME: row.NAME ?? row.name,
        CITY: row.CITY ?? row.city,
        GST_NO: row.GST_NO ?? row.gst_no,
      };
      setLookups((prev) => ({
        ...prev,
        parties: upsertMasterParty(prev.parties, entry),
      }));
      applyPartyPick(String(entry.CODE ?? '').trim());
    },
    [applyPartyPick]
  );

  const totals = useMemo(() => {
    let q = 0;
    let w = 0;
    let a = 0;
    for (const L of lines) {
      q += Number(L.qnty) || 0;
      w += Number(L.weight) || 0;
      a += Number(L.amount) || 0;
    }
    return { qnty: q, weight: w, amount: a };
  }, [lines]);

  const can = perm || {};
  const accessOnlyBrowse = !!can.canOpen && !can.canAdd && !can.canEdit && !can.canDelete;
  const canEditLines = useMemo(
    () =>
      !accessOnlyBrowse &&
      ((mode === 'new' && !!can.canAdd) || (mode === 'edit' && !!can.canEdit) || (mode === 'delete' && !!can.canDelete)),
    [accessOnlyBrowse, mode, can]
  );
  const fieldsDisabled = !can.canOpen || accessOnlyBrowse || mode === 'delete';
  const showChNav = !!can.canOpen;

  const showNotice = useCallback((text) => {
    setErr('');
    setMsg(text);
  }, []);

  const itemByCode = useCallback(
    (ic) => (lookups.items || []).find((it) => String(it.ITEM_CODE ?? it.item_code) === String(ic)),
    [lookups.items]
  );

  const recalcLine = useCallback(
    (idx, patch) => {
      setLines((prev) => {
        const next = [...prev];
        const L = { ...next[idx], ...patch };
        if (patch?.qnty != null && String(L.so_no ?? '').trim()) {
          const refQ = Number(L._so_ref_qty) || 0;
          const refW = Number(L._so_ref_wgt) || 0;
          const newQ = Number(patch.qnty) || 0;
          if (refQ > 0 && refW > 0) {
            L.weight = clampWeight((refW / refQ) * newQ);
            L.weight_manual = false;
          } else if (!patch.weight_manual) {
            L.weight_manual = false;
          }
        }
        if (patch?.status != null || patch?.qnty != null) {
          if (!L.weight_manual) {
            L.weight = computeDispatchWeight(L.qnty, L.status, gAmtCal);
          }
        }
        if (patch?.weight != null) L.weight_manual = true;
        L.rate = roundRate2(L.rate);
        L.amount = computeDispatchAmount(L.weight, L.rate, gAmtCal);
        next[idx] = L;
        return next;
      });
    },
    [gAmtCal]
  );

  const applyItemToLine = (idx, itemCode) => {
    const it = itemByCode(itemCode);
    setLines((prev) => {
      const next = [...prev];
      const L = { ...next[idx] };
      L.item_code = String(itemCode ?? '').trim();
      L.item_name = it ? String(it.ITEM_NAME ?? it.item_name ?? '').trim() : '';
      next[idx] = L;
      return next;
    });
  };

  const applyRowsFromApi = useCallback(
    (rows) => {
      if (!rows?.length) return;
      const h0 = rows[0];
      setCode(String(h0.CODE ?? h0.code ?? '').trim());
      setPlantCode(String(h0.PLANT_CODE ?? h0.plant_code ?? '').trim());
      setRemarks(String(h0.REMARKS ?? h0.remarks ?? '').trim());
      setTruckNo(String(h0.TRUCK_NO ?? h0.truck_no ?? '').trim());
      setTpt(String(h0.TPT ?? h0.tpt ?? '').trim());
      setGrNo(String(h0.GR_NO ?? h0.gr_no ?? '').trim());
      setPartyFinderOpen(false);
      setLines(
        rows.map((r, i) => {
          const ic = String(r.ITEM_CODE ?? r.item_code ?? '').trim();
          const it = itemByCode(ic);
          return {
            trn_no: Number(r.TRN_NO ?? r.trn_no ?? i + 1) || i + 1,
            so_no: displayLineInt6(r.SO_NO ?? r.so_no),
            item_code: ic,
            item_name: it ? String(it.ITEM_NAME ?? it.item_name ?? '').trim() : ic,
            marka: String(r.MARKA ?? r.marka ?? '').trim(),
            qnty: Number(r.QNTY ?? r.qnty ?? 0) || 0,
            status: String(r.STATUS ?? r.status ?? 'B').trim().slice(0, 1) || 'B',
            weight: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
            rate: roundRate2(Number(r.RATE ?? r.rate ?? 0) || 0),
            amount: Number(r.AMOUNT ?? r.amount ?? 0) || 0,
            weight_manual: true,
            _so_ref_qty: 0,
            _so_ref_wgt: 0,
          };
        })
      );
    },
    [itemByCode]
  );

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { comp_uid: compUid, user_name: userName };
      const [pRes, cRes, lRes, mpRes] = await Promise.all([
        axios.get(`${apiBase}/api/dispatch-challan-user-permissions`, { params, ...reqOpts }),
        axios.get(`${apiBase}/api/dispatch-challan-form-context`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            ...(compYearLogin ? { comp_year: compYearLogin } : {}),
          },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/dispatch-challan-lookups`, {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, { params, ...reqOpts }),
      ]);
      setPerm(pRes.data);
      setMasterPartyPerm(mpRes.data);
      setCtx(cRes.data);
      setLookups({
        parties: lRes.data?.parties || [],
        plants: lRes.data?.plants || [],
        markas: lRes.data?.markas || [],
        items: lRes.data?.items || [],
      });
      if (!pRes.data?.canOpen) setErr('Access denied (F11 position 1).');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, compYearLogin, userName]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const fetchNextRNo = useCallback(async () => {
    const ct = normChType(chType);
    const { data } = await axios.get(`${apiBase}/api/dispatch-challan-next-r-no`, {
      params: { comp_code: compCode, comp_uid: compUid, ch_type: ct },
      ...reqOpts,
    });
    setRNo(String(data?.next_r_no ?? ''));
  }, [apiBase, compCode, compUid, chType]);

  useEffect(() => {
    if (loading || mode !== 'new' || postedNew) return;
    void fetchNextRNo().catch(() => {});
  }, [loading, mode, postedNew, chType, fetchNextRNo]);

  const loadBySlot = useCallback(
    async (targetRNo, targetChType) => {
      const gen = ++slotGenRef.current;
      try {
        const { data } = await axios.get(`${apiBase}/api/dispatch-challan-raw`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            ch_type: targetChType,
            r_no: targetRNo,
          },
          ...reqOpts,
        });
        if (gen !== slotGenRef.current) return;
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          setRNo(String(targetRNo));
          setChType(targetChType);
          setMode('new');
          setPostedNew(false);
          setLines([emptyLine()]);
          showNotice('No challan at this number — ready for new entry.');
          return;
        }
        const rd = rows[0].R_DATE ?? rows[0].r_date;
        setRDateYmd(toInputDateString(rd) || rDateYmd);
        setRNo(String(targetRNo));
        setChType(targetChType);
        applyRowsFromApi(rows);
        if (can.canEdit) setMode('edit');
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
      }
    },
    [apiBase, compCode, compUid, applyRowsFromApi, can.canEdit, rDateYmd, showNotice]
  );

  const stepChNo = (delta) => {
    const cur = Number(String(rNoRef.current).replace(/\D/g, '')) || 0;
    const next = Math.max(1, cur + delta);
    const ct = chTypeRef.current;
    void loadBySlot(next, ct);
  };

  const openSoPick = async (lineIdx) => {
    if (!canEditLines) return;
    if (!code) {
      showNotice('Select party (schedule 11.20) before pending SO (F1).');
      return;
    }
    setSoPick({ open: true, lineIdx, rows: [], loading: true, hi: 0 });
    try {
      const { data } = await axios.get(`${apiBase}/api/dispatch-challan-pending-orders`, {
        params: { comp_code: compCode, comp_uid: compUid, code },
        ...reqOpts,
      });
      setSoPick((p) => ({ ...p, rows: data?.rows || [], loading: false }));
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Pending SO failed');
      setSoPick((p) => ({ ...p, open: false, loading: false }));
    }
  };

  const applySoPick = (lineIdx, row) => {
    const ic = String(row.ITEM_CODE ?? '').trim();
    const bqty = Number(row.BQTY ?? 0) || 0;
    applyItemToLine(lineIdx, ic);
    window.setTimeout(() => {
      recalcLine(lineIdx, {
        so_no: displayLineInt6(row.SO_NO),
        qnty: bqty,
        status: String(row.STATUS ?? 'B').trim().slice(0, 1) || 'B',
        rate: roundRate2(Number(row.RATE ?? 0) || 0),
        weight_manual: false,
        _so_ref_qty: bqty,
        _so_ref_wgt: 0,
      });
      focusLineQnty(lineIdx);
    }, 0);
    setSoPick((p) => ({ ...p, open: false }));
  };

  const soPickColumns = useMemo(
    () => [
      { key: 'so', label: 'SO no', render: (r) => displayLineInt6(r.SO_NO) },
      { key: 'dt', label: 'Date', render: (r) => formatPickDate(r.SO_DATE) },
      { key: 'it', label: 'Item', render: (r) => String(r.ITEM_CODE ?? '').trim() },
      { key: 'st', label: 'BKH', render: (r) => String(r.STATUS ?? '').trim() },
      { key: 'rt', label: 'Rate', render: (r) => Number(r.RATE ?? 0).toFixed(2) },
      { key: 'bq', label: 'Bal qty', render: (r) => Number(r.BQTY ?? 0) },
      { key: 'soq', label: 'SO qty', render: (r) => Number(r.SOQTY ?? 0) },
      { key: 'slq', label: 'Disp qty', render: (r) => Number(r.SLQTY ?? 0) },
    ],
    []
  );

  const clearForNew = useCallback(() => {
    setChType(DEFAULT_CH_TYPE);
    setCode('');
    setPlantCode('');
    setPartySearch('');
    setPartyFinderOpen(true);
    setRemarks('');
    setTruckNo('');
    setTpt('');
    setGrNo('');
    setLines([emptyLine()]);
    setPostedNew(false);
    void fetchNextRNo();
  }, [fetchNextRNo]);

  const handleSave = async (saveMode) => {
    setMsg('');
    setErr('');
    if (!userName) {
      showNotice('User name missing — sign in again.');
      return;
    }
    if (!code) {
      showNotice('Select party (schedule 11.20).');
      return;
    }
    if (fyMinYmd && fyMaxYmd && rDateYmd && (rDateYmd < fyMinYmd || rDateYmd > fyMaxYmd)) {
      showNotice(`Challan date must be between ${toDisplayDate(fyMinYmd)} and ${toDisplayDate(fyMaxYmd)}.`);
      return;
    }
    const validLines = lines.filter((L) => String(L.item_code ?? '').trim());
    if (saveMode !== 'delete' && validLines.length === 0) {
      showNotice('Add at least one line with item.');
      return;
    }
    try {
      const payload = {
        comp_code: compCode,
        comp_uid: compUid,
        comp_year: compYear || compYearLogin || undefined,
        user_name: userName,
        mode: saveMode,
        ch_type: normChType(chType),
        r_date: rDateOracle,
        r_no: String(rNo ?? '').trim() || undefined,
        header: { code: Number(code), plant_code: plantCode, remarks, truck_no: truckNo, tpt, gr_no: grNo },
        lines: validLines.map((L, i) => ({
          trn_no: i + 1,
          so_no: (() => {
            const s = parseLineInt6Input(L.so_no);
            return s ? Number(s) : null;
          })(),
          item_code: L.item_code,
          marka: L.marka,
          qnty: Number(L.qnty) || 0,
          status: String(L.status ?? 'B').trim().slice(0, 1) || 'B',
          weight: clampWeight(Number(L.weight) || 0),
          rate: roundRate2(Number(L.rate) || 0),
          amount: Number(L.amount) || 0,
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/dispatch-challan-save`, payload, reqOpts);
      if (saveMode === 'delete') {
        setMsg('Challan deleted.');
        setPostedNew(false);
        setMode('new');
        clearForNew();
      } else {
        setRNo(String(data?.r_no ?? rNo));
        setPostedNew(saveMode === 'add');
        setMode('edit');
        setMsg(saveMode === 'add' ? 'Challan saved.' : 'Challan updated.');
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    }
  };

  const openChallanFromList = async (row) => {
    const ct = normChType(row.CH_TYPE ?? row.ch_type);
    const rn = row.R_NO ?? row.r_no;
    setListScreenOpen(false);
    setChType(ct);
    setMode('edit');
    await loadBySlot(rn, ct);
  };

  const lineNumDisplay = (idx, field, value, formatter) => {
    if (lineNumEdit && lineNumEdit.idx === idx && lineNumEdit.field === field) {
      return lineNumEdit.text;
    }
    return formatter(value);
  };

  const startLineNumEdit = (idx, field, value, formatter) => {
    const shown = formatter(value);
    setLineNumEdit({ idx, field, text: shown === '' ? '' : shown });
  };

  const commitLineNumEdit = (idx, field) => {
    if (!lineNumEdit || lineNumEdit.idx !== idx || lineNumEdit.field !== field) return;
    const raw = lineNumEdit.text;
    setLineNumEdit(null);
    if (field === 'weight') {
      recalcLine(idx, { weight: clampWeight(parseNumInput(raw)), weight_manual: true });
    } else if (field === 'rate') {
      recalcLine(idx, { rate: roundRate2(parseNumInput(raw)) });
    }
  };

  const chNavButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => stepChNo(-1)}>
        ← Prev
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => stepChNo(1)}>
        Next →
      </button>
    </>
  );

  const screenActionButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onPrev}>
        ← Back
      </button>
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        Home
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setListScreenOpen(true)}>
        List
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setPrintScreenOpen(true)}>
        Print
      </button>
      {mode === 'new' && can.canAdd ? (
        <button type="button" className="btn btn-primary" onClick={() => void handleSave('add')}>
          Save
        </button>
      ) : null}
      {mode === 'edit' && can.canEdit ? (
        <button type="button" className="btn btn-primary" onClick={() => void handleSave('edit')}>
          Update
        </button>
      ) : null}
      {mode === 'delete' && can.canDelete ? (
        <button type="button" className="btn btn-danger" onClick={() => void handleSave('delete')}>
          Delete
        </button>
      ) : null}
    </>
  );

  if (listScreenOpen) {
    return (
      <DispatchChallanListScreen
        apiBase={apiBase}
        formData={formData}
        lookups={lookups}
        onClose={() => setListScreenOpen(false)}
        onOpenChallan={(row) => void openChallanFromList(row)}
      />
    );
  }

  if (printScreenOpen) {
    return (
      <DispatchChallanPrintScreen
        apiBase={apiBase}
        formData={formData}
        defaultChType={chType}
        defaultRNo={rNo}
        defaultRDateYmd={rDateYmd}
        onClose={() => setPrintScreenOpen(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className="slide slide-22-dispatch-challan slide-22-dispatch-challan--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Dispatch challan</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!can.canOpen) {
    return (
      <div className="slide slide-22-dispatch-challan">
        <h2 className="sale-bill-page__title">Dispatch challan</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F11).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-22-dispatch-challan sale-bill-page" onKeyDown={handleEnterAsTab} role="presentation">
      <header className="sale-bill-page__header">
        <SaleEntryFinYearStrip
          screenTitle="Dispatch challan"
          formData={formData}
          ctx={ctx}
          userName={userName}
          companyName={formData.comp_name ?? formData.COMP_NAME}
        />
        <div className="sale-bill-page__title-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h2 className="sale-bill-page__title">Dispatch challan</h2>
          <ReportHelpButton reportId="dispatch-challan-entry" />
        </div>
        <div className="sale-bill-page__user-power" role="status">
          <span className="sale-bill-page__user-power-user">
            <span className="sale-bill-page__user-power-k">USER</span>
            <strong className="sale-bill-page__user-power-name">{userName || '—'}</strong>
          </span>
          <span className="sale-bill-page__user-power-rights">
            <span className={can.canOpen ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              ACCESS{!can.canOpen ? <span className="sale-bill-power__x">X</span> : null}
            </span>
            <span className={can.canAdd ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              ADD{!can.canAdd ? <span className="sale-bill-power__x">X</span> : null}
            </span>
            <span className={can.canEdit ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              EDIT{!can.canEdit ? <span className="sale-bill-power__x">X</span> : null}
            </span>
            <span className={can.canDelete ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
              DELETE{!can.canDelete ? <span className="sale-bill-power__x">X</span> : null}
            </span>
          </span>
        </div>
        <div className="sale-bill-page__meta">
          <span className="sale-bill-page__meta-item">
            <span className="sale-bill-page__meta-k">Company</span> {formData.comp_name ?? '—'}
          </span>
          {ctx ? (
            <span className="sale-bill-page__meta-item">
              <span className="sale-bill-page__meta-k">Amt cal</span> {gAmtCal}
            </span>
          ) : null}
        </div>
      </header>

      <DcActionBar position="top" label="Screen actions">
        {showChNav ? (
          <span className="dc-action-bar__nav" role="group" aria-label="Challan navigation">
            {chNavButtons}
          </span>
        ) : null}
        {screenActionButtons}
      </DcActionBar>

      {err ? <p className="deploy-update-msg deploy-update-msg--err sale-bill-page__alert">{err}</p> : null}

      <section className="sale-bill-section sale-bill-section--card dc-header-card">
        <div className="dc-header-row dc-header-row--top">
          <label className="dc-header-field dc-header-field--mode">
            <span className="dc-header-k">Mode</span>
            <select
              className="form-input dc-header-control"
              value={mode}
              disabled={accessOnlyBrowse}
              onChange={(e) => {
                const m = e.target.value;
                setMode(m);
                if (m === 'new') clearForNew();
              }}
            >
              <option value="new">New</option>
              <option value="edit">Edit</option>
              <option value="delete">Delete</option>
            </select>
          </label>
          <label className="dc-header-field dc-header-field--chtype">
            <span className="dc-header-k">ChType</span>
            <span className="dc-chtype-inline">
              <span className="dc-chtype-colon" aria-hidden>
                :
              </span>
              <input
                maxLength={1}
                className="form-input dc-header-control dc-chtype-input"
                value={chType}
                disabled={fieldsDisabled || postedNew}
                onFocus={selectAllOnFocus}
                onChange={(e) => setChType(singleCharFromInput(e.target.value) || DEFAULT_CH_TYPE)}
              />
            </span>
          </label>
          <label className="dc-header-field dc-header-field--chno">
            <span className="dc-header-k">Ch.No.</span>
            <input
              className="form-input dc-header-control"
              value={rNo}
              disabled={fieldsDisabled}
              onChange={(e) => setRNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
          <label className="dc-header-field dc-header-field--chdate">
            <span className="dc-header-k">Ch.Date</span>
            <input
              type="date"
              className="form-input dc-header-control"
              value={rDateYmd}
              disabled={fieldsDisabled}
              min={fyMinYmd || undefined}
              max={fyMaxYmd || undefined}
              onChange={(e) => setRDateYmd(e.target.value)}
            />
          </label>

        </div>

        <div className="dc-header-row dc-header-row--party">
          <span className="dc-header-k">Party</span>
          <div className="dc-header-row__body dc-party-entry">
            <PartyAddButton
              onClick={tryOpenNewParty}
              disabled={fieldsDisabled}
              title="Add new party (schedule 11.2)"
            />
            <div className="dc-party-entry__main">
            {partyInfo && !partyFinderOpen ? (
              <div className="dc-party-selected">
                <span
                  className="account-selected-hint dc-party-selected__text"
                  title={`[${code}] ${partyInfo.NAME ?? partyInfo.name} — ${partyInfo.CITY ?? partyInfo.city}`}
                >
                  <span className="dc-party-selected__code">[{code}]</span>{' '}
                  <span className="dc-party-selected__name">{partyInfo.NAME ?? partyInfo.name}</span>
                  <span className="dc-party-selected__city"> — {partyInfo.CITY ?? partyInfo.city}</span>
                </span>
                {!fieldsDisabled ? (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPartyFinderOpen(true)}>
                    Change
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="account-search-group dc-party-find">
                <input
                  type="search"
                  className="form-input sale-bill-search-input"
                  placeholder="Search party — code, name, or city (schedule 11.20)"
                  autoComplete="off"
                  value={partySearch}
                  disabled={fieldsDisabled}
                  onChange={(e) => {
                    setPartySearch(e.target.value);
                    setPartyHi(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (filteredParties.length === 0) return;
                      setPartyHi((h) => Math.min(filteredParties.length - 1, h + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setPartyHi((h) => Math.max(0, h - 1));
                    } else if (e.key === 'Enter' && filteredParties.length > 0) {
                      e.preventDefault();
                      e.stopPropagation();
                      const row = filteredParties[safePartyHi];
                      if (row) applyPartyPick(String(row.CODE ?? row.code ?? '').trim());
                    }
                  }}
                />
                {partySearch.trim() ? (
                  <div className="account-search-results party-search-results dc-party-list" role="listbox" aria-label="Party matches">
                    <div className="account-search-header party-search-header" aria-hidden="true">
                      <span>Code</span>
                      <span>Name</span>
                      <span>City</span>
                    </div>
                    {filteredParties.length === 0 ? (
                      <div className="account-search-empty">No matches — try different letters.</div>
                    ) : (
                      filteredParties.map((row, index) => {
                        const pc = String(row.CODE ?? row.code ?? '');
                        const rowHi = safePartyHi === index;
                        return (
                          <button
                            key={pc}
                            type="button"
                            role="option"
                            aria-selected={String(code) === pc}
                            disabled={fieldsDisabled}
                            className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}${String(code) === pc ? ' is-active' : ''}`}
                            onMouseEnter={() => setPartyHi(index)}
                            onClick={() => applyPartyPick(pc)}
                          >
                            <span className="account-search-code">{highlightMatch(pc, partySearch)}</span>
                            <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, partySearch)}</span>
                            <span className="account-search-city">{highlightMatch(row.CITY ?? row.city, partySearch) || '—'}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <p className="sale-bill-section__hint dc-party-search-hint">Type code, name, or city to search.</p>
                )}
              </div>
            )}
            </div>
          </div>
        </div>

        <div className="dc-header-row dc-header-row--plant">
          <span className="dc-header-k">Plant</span>
          <select
            className="form-input dc-plant-select"
            value={plantCode}
            disabled={fieldsDisabled}
            onChange={(e) => setPlantCode(e.target.value)}
          >
            <option value="">—</option>
            {(lookups.plants || []).map((p) => (
              <option key={p.PLANT_CODE ?? p.plant_code} value={String(p.PLANT_CODE ?? p.plant_code ?? '')}>
                {p.PLANT_NAME ?? p.plant_name ?? p.PLANT_CODE}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="sale-bill-section sale-bill-section--card dc-lines-section">
        <h3 className="sale-bill-section__title">Lines</h3>
        <div className="sale-list-scroll-sync sale-list-scroll-sync--top dc-lines-scroll-top" ref={dcLinesTopScrollRef} aria-hidden="true">
          <div className="sale-list-scroll-sync-inner" ref={dcLinesTopInnerRef} />
        </div>
        <div className="sale-bill-lines-wrap dc-lines-wrap table-responsive--sale-list" ref={dcLinesGridScrollRef}>
          <table className="report-table sale-bill-lines-table dc-lines-table">
            <colgroup>
              <col className="dc-col-seq" />
              <col className="dc-col-so" />
              <col className="dc-col-item" />
              <col className="dc-col-name" />
              <col className="dc-col-marka" />
              <col className="dc-col-qty" />
              <col className="dc-col-st" />
              <col className="dc-col-wgt" />
              <col className="dc-col-rate" />
              <col className="dc-col-amt" />
            </colgroup>
            <thead>
              <tr>
                <th>#</th>
                <th>SO no</th>
                <th>Item</th>
                <th>Name</th>
                <th className="dc-th-marka">Marka</th>
                <th>Qty</th>
                <th>St</th>
                <th>Weight</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((L, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <div className="dc-line-so-cell slide-22-dispatch-challan-ignore-enter">
                      <button
                        type="button"
                        className="dc-line-pick-mobile slide-22-dispatch-challan-ignore-enter"
                        disabled={!canEditLines}
                        onClick={() => void openSoPick(idx)}
                      >
                        Pick
                      </button>
                      <button
                        type="button"
                        className="dc-line-pick-icon"
                        disabled={!canEditLines}
                        title="Pick pending SO (F1)"
                        aria-label="Pick pending SO"
                        onClick={() => void openSoPick(idx)}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <input
                        className="sale-bill-line-ch-so dc-line-so-input"
                        value={L.so_no}
                        disabled={!canEditLines}
                        onChange={(e) =>
                          setLines((p) => {
                            const n = [...p];
                            n[idx] = { ...n[idx], so_no: parseLineInt6Input(e.target.value) };
                            return n;
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'F1') {
                            e.preventDefault();
                            void openSoPick(idx);
                          }
                        }}
                      />
                    </div>
                  </td>
                  <td className="dc-td-item">
                    <select
                      className="form-input dc-line-item-select"
                      value={L.item_code}
                      disabled={!canEditLines}
                      onChange={(e) => {
                        applyItemToLine(idx, e.target.value);
                      }}
                    >
                      <option value="">— item —</option>
                      {(lookups.items || []).map((it) => {
                        const ic = String(it.ITEM_CODE ?? it.item_code ?? '').trim();
                        const nm = String(it.ITEM_NAME ?? it.item_name ?? '').trim();
                        return (
                          <option key={ic} value={ic} title={nm ? `${ic} — ${nm}` : ic}>
                            {nm ? `${ic} — ${nm}` : ic}
                          </option>
                        );
                      })}
                    </select>
                  </td>
                  <td className="sale-bill-line-readonly dc-line-name">{L.item_name}</td>
                  <td className="dc-td-marka">
                    <LineMarkaCombo
                      className="dc-line-marka"
                      value={L.marka}
                      options={lookups.markas || []}
                      disabled={!canEditLines}
                      onChange={(marka) => recalcLine(idx, { marka })}
                    />
                  </td>
                  <td>
                    <input
                      className="dc-num dc-num--qty"
                      data-dc-line-qty={idx}
                      inputMode="decimal"
                      value={dispNum(L.qnty)}
                      disabled={!canEditLines}
                      onChange={(e) => recalcLine(idx, { qnty: parseNumInput(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      maxLength={1}
                      className="sale-bill-line-ch-type dc-line-status"
                      value={L.status}
                      disabled={!canEditLines}
                      onFocus={selectAllOnFocus}
                      onChange={(e) => {
                        const st = singleCharFromInput(e.target.value);
                        if (st && !'BKH'.includes(st)) return;
                        recalcLine(idx, { status: st || 'B' });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="dc-num dc-num--wgt"
                      inputMode="decimal"
                      value={lineNumDisplay(idx, 'weight', L.weight, fmtWeight3)}
                      disabled={!canEditLines}
                      onFocus={() => startLineNumEdit(idx, 'weight', L.weight, fmtWeight3)}
                      onChange={(e) => setLineNumEdit({ idx, field: 'weight', text: e.target.value })}
                      onBlur={() => commitLineNumEdit(idx, 'weight')}
                    />
                  </td>
                  <td>
                    <input
                      className="sale-bill-rate-input dc-num dc-num--rate"
                      inputMode="decimal"
                      value={lineNumDisplay(idx, 'rate', L.rate, fmtRate2Disp)}
                      disabled={!canEditLines}
                      onFocus={() => startLineNumEdit(idx, 'rate', L.rate, fmtRate2Disp)}
                      onChange={(e) => setLineNumEdit({ idx, field: 'rate', text: e.target.value })}
                      onBlur={() => commitLineNumEdit(idx, 'rate')}
                    />
                  </td>
                  <td>
                    <input
                      readOnly
                      tabIndex={0}
                      className="sale-bill-input-readonly dc-num dc-num--amt"
                      value={fmtAmt(L.amount)}
                      aria-label={`Line ${idx + 1} amount`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEditLines ? (
          <button
            type="button"
            className="btn btn-secondary sale-bill-add-line"
            onClick={() => setLines((p) => [...p, { ...emptyLine(), trn_no: p.length + 1 }])}
          >
            + Add line
          </button>
        ) : null}
        <p className="sale-bill-totals-summary">
          Totals — Qty: {totals.qnty} · Weight: {totals.weight.toFixed(3)} · Amount: {totals.amount.toFixed(2)}
        </p>
      </section>

      <section className="sale-bill-section sale-bill-section--card">
        <h3 className="sale-bill-section__title">Footer</h3>
        <div className="sale-bill-totals-grid">
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Remarks</span>
            <input
              className="form-input dc-footer-field-input"
              value={remarks}
              disabled={fieldsDisabled}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Truck no</span>
            <input
              className="form-input dc-footer-field-input"
              value={truckNo}
              disabled={fieldsDisabled}
              onChange={(e) => setTruckNo(e.target.value)}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Transport</span>
            <input
              className="form-input dc-footer-field-input"
              value={tpt}
              disabled={fieldsDisabled}
              onChange={(e) => setTpt(e.target.value)}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">GR no</span>
            <input
              className="form-input dc-footer-field-input"
              value={grNo}
              disabled={fieldsDisabled}
              onChange={(e) => setGrNo(e.target.value)}
            />
          </label>
        </div>
      </section>

      <DcActionBar position="bottom" label="Screen actions">
        {showChNav ? (
          <span className="dc-action-bar__nav" role="group" aria-label="Challan navigation">
            {chNavButtons}
          </span>
        ) : null}
        {screenActionButtons}
      </DcActionBar>

      <DispatchPickModal
        open={soPick.open}
        title="Pending sales orders"
        hint={code ? `Party ${code}` : ''}
        emptyMessage="No pending SO for this party."
        loading={soPick.loading}
        rows={soPick.rows}
        columns={soPickColumns}
        hi={soPick.hi}
        onHi={(n) => setSoPick((p) => ({ ...p, hi: n }))}
        onClose={() => setSoPick((p) => ({ ...p, open: false }))}
        onPick={(row) => applySoPick(soPick.lineIdx, row)}
      />

      {msg ? (
        createPortal(
          <div
            className="sale-bill-save-toast-overlay"
            role="presentation"
            onClick={() => setMsg('')}
          >
            <div
              className="sale-bill-save-toast-card"
              role="alertdialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="sale-bill-save-toast-text">{msg}</p>
              <button type="button" className="btn btn-primary sale-bill-save-toast-ok" onClick={() => setMsg('')}>
                OK
              </button>
            </div>
          </div>,
          document.body
        )
      ) : null}
      <MasterPartyCreateModal
        open={masterPartyOpen}
        onClose={() => setMasterPartyOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={Number(compYear) || Number(compYearLogin) || 0}
        userName={userName}
        defaultSchedule={DISPATCH_PARTY_SCHEDULE}
        lockSchedule
        onCreated={handleMasterPartyCreated}
      />
    </div>
  );
}
