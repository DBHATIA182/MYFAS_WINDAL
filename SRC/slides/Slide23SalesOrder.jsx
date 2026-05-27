import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import SalesOrderListScreen from './SalesOrderListScreen';
import SalesOrderPrintScreen from './SalesOrderPrintScreen';
import { DcActionBar } from '../components/DispatchChallanActionBar';
import SaleEntryTopBar from '../components/SaleEntryTopBar';
import SaleEntryScreenHeader from '../components/SaleEntryScreenHeader';
import MasterPartyCreateModal, { PartyAddButton } from '../components/MasterPartyCreateModal';
import LineMarkaCombo from '../components/LineMarkaCombo';
import {
  resolveSaleEntryFinYear,
  clampYmdToFinYear,
  defaultDocDateInFinYear,
} from '../utils/saleEntryFinYear';
import { upsertMasterParty } from '../utils/upsertMasterParty';

const reqOpts = { withCredentials: true, timeout: 120000 };

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
    const root = document.querySelector('.slide-23-sales-order');
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
  if (!t || t.closest('.slide-23-sales-order-ignore-enter')) return;
  if (t.tagName === 'TEXTAREA') return;
  e.preventDefault();
  const root = t.closest('.slide-23-sales-order');
  if (root) focusNextInForm(root, t);
}

function emptyLine() {
  return {
    trn_no: 1,
    item_code: '',
    item_name: '',
    marka: '',
    qnty: 0,
    status: 'B',
    weight: 0,
    rate: 0,
    amount: 0,
    weight_manual: false,
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
    <div className="sale-bill-pick-overlay slide-23-sales-order-ignore-enter" role="presentation" onClick={onClose}>
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

export default function Slide23SalesOrder({ apiBase, formData, userName, onPrev, onReset }) {
  const soNoRef = useRef('');
  const slotGenRef = useRef(0);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYearLogin = String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim();

  const [perm, setPerm] = useState(null);
  const [masterPartyPerm, setMasterPartyPerm] = useState(null);
  const [masterPartyOpen, setMasterPartyOpen] = useState(false);
  const [ctx, setCtx] = useState(null);
  const [lookups, setLookups] = useState({ customers: [], markas: [], items: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const [mode, setMode] = useState('new');
  const [soNo, setSoNo] = useState('');
  const [soDateYmd, setSoDateYmd] = useState(() => toInputDateString(new Date()));
  const [code, setCode] = useState('');
    const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [partyFinderOpen, setPartyFinderOpen] = useState(true);
  const [postedNew, setPostedNew] = useState(false);

  const [poNo, setPoNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [remarks2, setRemarks2] = useState('');
  const [lines, setLines] = useState([emptyLine()]);

  const [listScreenOpen, setListScreenOpen] = useState(false);
  const [printScreenOpen, setPrintScreenOpen] = useState(false);
  const [lineNumEdit, setLineNumEdit] = useState(null);
    const dcLinesTopScrollRef = useRef(null);
  const dcLinesTopInnerRef = useRef(null);
  const dcLinesGridScrollRef = useRef(null);

  const soDateOracle = useMemo(() => toOracleDate(soDateYmd), [soDateYmd]);
  const gAmtCal = ctx?.G_AMT_CAL ?? 'K';
  const { compYear, fyMinYmd, fyMaxYmd } = useMemo(
    () => resolveSaleEntryFinYear(formData, ctx),
    [formData, ctx]
  );

  useEffect(() => {
    if (!ctx) return;
    setSoDateYmd((prev) => clampYmdToFinYear(prev, fyMinYmd, fyMaxYmd) || defaultDocDateInFinYear(fyMinYmd, fyMaxYmd));
  }, [ctx, fyMinYmd, fyMaxYmd]);

  useEffect(() => {
    soNoRef.current = String(soNo ?? '').trim();
  }, [soNo]);
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
    return lookups.customers.find((p) => String(p.CODE ?? p.code) === String(code)) ?? null;
  }, [code, lookups.customers]);

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    const list = lookups.customers || [];
    if (!q) return [];
    return list
      .filter((p) => {
        const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
        const name = String(p.NAME ?? p.name ?? '').toLowerCase();
        const city = String(p.CITY ?? p.city ?? '').toLowerCase();
        return pc.includes(q) || name.includes(q) || city.includes(q);
      })
      .slice(0, 50);
  }, [partySearch, lookups.customers]);

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
      };
      setLookups((prev) => ({
        ...prev,
        customers: upsertMasterParty(prev.customers, entry),
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
  const showSoNav = !!can.canOpen;

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
      setPoNo(String(h0.PO_NO ?? h0.po_no ?? '').trim());
      setRemarks(String(h0.REMARKS ?? h0.remarks ?? '').trim());
      setRemarks2(String(h0.REMARKS2 ?? h0.remarks2 ?? '').trim());
      setPartyFinderOpen(false);
      setLines(
        rows.map((r, i) => {
          const ic = String(r.ITEM_CODE ?? r.item_code ?? '').trim();
          const it = itemByCode(ic);
          return {
            trn_no: Number(r.TRN_NO ?? r.trn_no ?? i + 1) || i + 1,
            item_code: ic,
            item_name: it ? String(it.ITEM_NAME ?? it.item_name ?? '').trim() : ic,
            marka: String(r.MARKA ?? r.marka ?? '').trim(),
            qnty: Number(r.QNTY ?? r.qnty ?? 0) || 0,
            status: String(r.STATUS ?? r.status ?? 'B').trim().slice(0, 1) || 'B',
            weight: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
            rate: roundRate2(Number(r.RATE ?? r.rate ?? 0) || 0),
            amount: Number(r.AMOUNT ?? r.amount ?? 0) || 0,
            weight_manual: true,
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
        axios.get(`${apiBase}/api/sales-order-user-permissions`, { params, ...reqOpts }),
        axios.get(`${apiBase}/api/sales-order-form-context`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            ...(compYearLogin ? { comp_year: compYearLogin } : {}),
          },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/sales-order-lookups`, {
          params: { comp_code: compCode, comp_uid: compUid },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, { params, ...reqOpts }),
      ]);
      setPerm(pRes.data);
      setMasterPartyPerm(mpRes.data);
      setCtx(cRes.data);
      setLookups({
        customers: lRes.data?.customers || [],
        markas: lRes.data?.markas || [],
        items: lRes.data?.items || [],
      });
      if (!pRes.data?.canOpen) setErr('Access denied (F12 position 1).');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, compYearLogin, userName]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const fetchNextSoNo = useCallback(async () => {
    const { data } = await axios.get(`${apiBase}/api/sales-order-next-so-no`, {
      params: { comp_code: compCode, comp_uid: compUid },
      ...reqOpts,
    });
    setSoNo(String(data?.next_so_no ?? ''));
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    if (loading || mode !== 'new' || postedNew) return;
    void fetchNextSoNo().catch(() => {});
  }, [loading, mode, postedNew, fetchNextSoNo]);

  const loadBySlot = useCallback(
    async (targetSoNo) => {
      const gen = ++slotGenRef.current;
      try {
        const { data } = await axios.get(`${apiBase}/api/sales-order-raw`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            so_no: targetSoNo,
          },
          ...reqOpts,
        });
        if (gen !== slotGenRef.current) return;
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          setSoNo(String(targetSoNo));
          setMode('new');
          setPostedNew(false);
          setLines([emptyLine()]);
          showNotice('No sales order at this number — ready for new entry.');
          return;
        }
        const rd = rows[0].SO_DATE ?? rows[0].so_date;
        setSoDateYmd(toInputDateString(rd) || soDateYmd);
        setSoNo(String(targetSoNo));
        applyRowsFromApi(rows);
        if (can.canEdit) setMode('edit');
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
      }
    },
    [apiBase, compCode, compUid, applyRowsFromApi, can.canEdit, soDateYmd, showNotice]
  );

  const stepSoNo = (delta) => {
    const cur = Number(String(soNoRef.current).replace(/\D/g, '')) || 0;
    const next = Math.max(1, cur + delta);
    const ct = '';
    void loadBySlot(next);
  };

  const clearForNew = useCallback(() => {
    setCode('');
    setPartySearch('');
    setPartyFinderOpen(true);
    setPoNo('');
    setRemarks('');
    setRemarks2('');
    setLines([emptyLine()]);
    setPostedNew(false);
    void fetchNextSoNo();
  }, [fetchNextSoNo]);

  const handleSave = async (saveMode) => {
    setMsg('');
    setErr('');
    if (!userName) {
      showNotice('User name missing — sign in again.');
      return;
    }
    if (!code) {
      showNotice('Select party (master list).');
      return;
    }
    if (fyMinYmd && fyMaxYmd && soDateYmd && (soDateYmd < fyMinYmd || soDateYmd > fyMaxYmd)) {
      showNotice(`SO date must be between ${toDisplayDate(fyMinYmd)} and ${toDisplayDate(fyMaxYmd)}.`);
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
        so_date: soDateOracle,
        so_no: String(soNo ?? '').trim() || undefined,
        header: { code: Number(code), po_no: poNo, remarks, remarks2 },
        lines: validLines.map((L, i) => ({
          trn_no: i + 1,
          item_code: L.item_code,
          marka: L.marka,
          qnty: Number(L.qnty) || 0,
          status: String(L.status ?? 'B').trim().slice(0, 1) || 'B',
          weight: clampWeight(Number(L.weight) || 0),
          rate: roundRate2(Number(L.rate) || 0),
          amount: Number(L.amount) || 0,
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/sales-order-save`, payload, reqOpts);
      if (saveMode === 'delete') {
        setMsg('Sales order deleted.');
        setPostedNew(false);
        setMode('new');
        clearForNew();
      } else {
        setSoNo(String(data?.so_no ?? soNo));
        setPostedNew(saveMode === 'add');
        setMode('edit');
        setMsg(saveMode === 'add' ? 'Sales order saved.' : 'Sales order updated.');
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Save failed');
    }
  };

  const openOrderFromList = async (row) => {
    const sn = row.SO_NO ?? row.so_no;
    setListScreenOpen(false);
    setMode('edit');
    await loadBySlot(sn);
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

  const soNavButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={() => stepSoNo(-1)}>
        ← Prev
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => stepSoNo(1)}>
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
      <SalesOrderListScreen
        apiBase={apiBase}
        formData={formData}
        lookups={lookups}
        onClose={() => setListScreenOpen(false)}
        onOpenOrder={(row) => void openOrderFromList(row)}
      />
    );
  }

  if (printScreenOpen) {
    return (
      <SalesOrderPrintScreen
        apiBase={apiBase}
        formData={formData}
        defaultSoNo={soNo}
        defaultSoDateYmd={soDateYmd}
        onClose={() => setPrintScreenOpen(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className="slide slide-23-sales-order slide-23-sales-order--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Sales order</h2>
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
      <div className="slide slide-23-sales-order">
        <h2 className="sale-bill-page__title">Sales order</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F12).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div
      className="slide slide-22-dispatch-challan slide-23-sales-order sale-bill-page sale-entry-desktop"
      onKeyDown={handleEnterAsTab}
      role="presentation"
    >
      <SaleEntryScreenHeader
        title="Sales order"
        topBar={
          <SaleEntryTopBar
            formData={formData}
            ctx={ctx}
            userName={userName}
            can={can}
            helpReportId="sales-order-entry"
          />
        }
        nav={showSoNav ? soNavButtons : null}
      >
        {screenActionButtons}
      </SaleEntryScreenHeader>

      {err ? (
        <p className="deploy-update-msg deploy-update-msg--err sale-entry-desktop__err">{err}</p>
      ) : null}

      <div className="sale-entry-desktop__body">
      <section className="sale-bill-section sale-bill-section--card dc-header-card sale-entry-desktop__form">
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
          <label className="dc-header-field dc-header-field--chno">
            <span className="dc-header-k">SO no</span>
            <input
              className="form-input dc-header-control"
              value={soNo}
              disabled={fieldsDisabled}
              onChange={(e) => setSoNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
          <label className="dc-header-field dc-header-field--chdate">
            <span className="dc-header-k">SO date</span>
            <input
              type="date"
              className="form-input dc-header-control"
              value={soDateYmd}
              disabled={fieldsDisabled}
              min={fyMinYmd || undefined}
              max={fyMaxYmd || undefined}
              onChange={(e) => setSoDateYmd(e.target.value)}
            />
          </label>

        </div>

        <div className="dc-header-row dc-header-row--party">
          <span className="dc-header-k">Customer</span>
          <div className="dc-header-row__body dc-party-entry">
            <PartyAddButton
              onClick={tryOpenNewParty}
              disabled={fieldsDisabled}
              title="Add new customer (Master)"
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
                  placeholder="Search customer — code, name, or city"
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
                  <div className="account-search-results party-search-results dc-party-list" role="listbox" aria-label="Customer matches">
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

      </section>

      <section className="sale-bill-section sale-bill-section--card dc-lines-section sale-entry-desktop__lines">
        <h3 className="sale-bill-section__title">Lines</h3>
        <div className="sale-list-scroll-sync sale-list-scroll-sync--top dc-lines-scroll-top" ref={dcLinesTopScrollRef} aria-hidden="true">
          <div className="sale-list-scroll-sync-inner" ref={dcLinesTopInnerRef} />
        </div>
        <div className="sale-bill-lines-wrap dc-lines-wrap table-responsive--sale-list" ref={dcLinesGridScrollRef}>
          <table className="report-table sale-bill-lines-table dc-lines-table">
            <colgroup>
              <col className="dc-col-seq" />
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
                <th>Trn</th>
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
                  <td>
                    <input
                      className="dc-line-trn"
                      value={L.trn_no}
                      disabled={!canEditLines}
                      onChange={(e) => {
                        const t = Math.max(1, Math.floor(Number(e.target.value) || idx + 1));
                        setLines((p) => {
                          const n = [...p];
                          n[idx] = { ...n[idx], trn_no: t };
                          return n;
                        });
                      }}
                    />
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

      </div>

      <section className="sale-bill-section sale-bill-section--card sale-entry-desktop__footer sale-entry-desktop__footer-fields">
        <h3 className="sale-bill-section__title">Footer</h3>
        <div className="sale-bill-totals-grid">
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">PO no</span>
            <input
              className="form-input dc-footer-field-input"
              value={poNo}
              disabled={fieldsDisabled}
              onChange={(e) => setPoNo(e.target.value)}
              maxLength={50}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Remarks</span>
            <input
              className="form-input dc-footer-field-input"
              value={remarks}
              disabled={fieldsDisabled}
              onChange={(e) => setRemarks(e.target.value)}
              maxLength={50}
            />
          </label>
          <label className="sale-bill-field sale-bill-field--block">
            <span className="sale-bill-field__label">Remarks 2</span>
            <input
              className="form-input dc-footer-field-input"
              value={remarks2}
              disabled={fieldsDisabled}
              onChange={(e) => setRemarks2(e.target.value)}
              maxLength={50}
            />
          </label>
        </div>
      </section>

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
        defaultSchedule={8.1}
        lockSchedule={false}
        onCreated={handleMasterPartyCreated}
      />
    </div>
  );
}
