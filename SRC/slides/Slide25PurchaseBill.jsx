import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import PurchaseBillPrintModal from '../components/PurchaseBillPrintModal';
import PurchaseBillListScreen from './PurchaseBillListScreen';
import SaleEntryTopBar from '../components/SaleEntryTopBar';
import SaleEntryScreenHeader from '../components/SaleEntryScreenHeader';
import MasterPartyCreateModal, { PartyAddButton } from '../components/MasterPartyCreateModal';
import PbAccountCodePicker from '../components/PbAccountCodePicker';
import PbPartyBrokerPickPortal from '../components/PbPartyBrokerPickPortal';
import { resolveSaleEntryFinYear, clampYmdToFinYear, defaultDocDateInFinYear } from '../utils/saleEntryFinYear';
import { upsertMasterParty } from '../utils/upsertMasterParty';
import {
  filterItemCodeNameRows,
  SEARCH_ITEM_TYPE_HINT,
  SEARCH_NO_MATCH,
  SEARCH_TYPE_HINT,
} from '../utils/masterSearchFilter';

const reqOpts = { withCredentials: true, timeout: 120000 };
const PU_TYPE = 'PU';
const PB_STATUS_VALID = new Set(['B', 'K', 'H']);

function normalizeItemCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

function normalizePlantCode(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

function normalizePbStatus(raw) {
  const st = String(raw ?? 'B').trim().toUpperCase().slice(0, 1) || 'B';
  return PB_STATUS_VALID.has(st) ? st : 'B';
}

function parseNumInput(raw) {
  const s = String(raw ?? '').trim();
  if (s === '' || s === '-' || s === '.') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Supplier bill no — digits only, max 16. */
function parseBillNo16(raw) {
  return String(raw ?? '').replace(/\D/g, '').slice(0, 16);
}

/** Summary display only — decimals appear only when value has them. */
function fmtAmt2(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '0.00';
  return n.toFixed(2);
}

function fmtRs(v) {
  return `₹ ${fmtAmt2(v)}`;
}

function fmtWeight3(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '0.000';
  return n.toFixed(3);
}

/** Typing helper — fraction digits only after user types '.'. */
function sanitizeDecimalTyping(raw, maxFrac = 3) {
  const s0 = String(raw ?? '').replace(/,/g, '');
  if (s0.trim() === '') return '';
  let s = s0.replace(/[^\d.]/g, '');
  const dot = s.indexOf('.');
  if (dot !== -1) {
    s = `${s.slice(0, dot + 1)}${s.slice(dot + 1).replace(/\./g, '')}`;
  }
  const parts = s.split('.');
  const intPart = (parts[0] || '').replace(/\D/g, '');
  const fracPart = (parts[1] || '').replace(/\D/g, '').slice(0, maxFrac);
  if (dot === -1) return intPart;
  if (s.endsWith('.') && !fracPart) return intPart === '' ? '.' : `${intPart}.`;
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function dispNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(n);
}

function numToInputDisplay(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '';
  return String(x);
}

function fmtRateDisp(v) {
  const n = roundRate2(Number(v));
  if (n === 0) return '';
  return String(n);
}

function fmtWeightDisp(v) {
  const n = roundWeight3(Number(v));
  if (n === 0) return '';
  return String(n);
}

/** Display in grid — always 3 decimal places when non-zero. */
function fmtWeightShow3(v) {
  const n = roundWeight3(Number(v));
  if (n === 0) return '';
  return n.toFixed(3);
}

/** Display in grid — always 2 decimal places when non-zero. */
function fmtRateShow2(v) {
  const n = roundRate2(Number(v));
  if (n === 0) return '';
  return n.toFixed(2);
}

function fmtAmtShow2(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return (Math.round(n * 100) / 100).toFixed(2);
}

function fmtTaxPerShow2(v) {
  const n = clampTaxPer(Number(v));
  if (n === 0) return '';
  return n.toFixed(2);
}

/** While typing tax % — do not force .00 until blur. */
function fmtTaxPerDisp(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(n);
}

function selectAllOnFocus(e) {
  const el = e?.target;
  if (!el) return;
  requestAnimationFrame(() => {
    try {
      if (typeof el.select === 'function') el.select();
    } catch (_) {
      try {
        const len = String(el.value ?? '').length;
        el.setSelectionRange(0, len);
      } catch (__) {}
    }
  });
}

function parseCal(v) {
  const n = Number(String(v ?? '1').replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const MAX_CHARGE = 9999999999.99;

function roundWeight3(n) {
  const x = Number(n) || 0;
  return Math.round(x * 1000) / 1000;
}

function clampCharge(n) {
  const x = Number(n) || 0;
  return Math.round(Math.max(0, Math.min(MAX_CHARGE, x)) * 100) / 100;
}

function expenseAccountCodeNum(code) {
  return Number(String(code ?? '').replace(/\D/g, '')) || 0;
}

function masterAccountExists(code, accounts) {
  const c = String(code ?? '').trim();
  if (!c) return false;
  return (accounts || []).some((a) => String(a.CODE ?? a.code ?? '').trim() === c);
}

function validatePbExpenseCodes({
  mfeeAmt,
  mfeeCode,
  labour,
  labCode,
  freight,
  fgtCode,
  addExp,
  addCode,
  lessExp,
  lessCode,
  ntdsAmt,
  ntdsCode,
  expenseAccounts,
}) {
  const checks = [
    { amt: clampCharge(mfeeAmt), code: mfeeCode, name: 'Market fee' },
    { amt: clampCharge(labour), code: labCode, name: 'Labour' },
    { amt: clampCharge(freight), code: fgtCode, name: 'Freight' },
    { amt: clampCharge(addExp), code: addCode, name: 'Add. expense' },
    { amt: clampCharge(lessExp), code: lessCode, name: 'Less expense' },
  ];
  for (const c of checks) {
    if (c.amt !== 0 && expenseAccountCodeNum(c.code) === 0) {
      return `${c.name}: amount is entered but account code is missing.`;
    }
    if (c.amt !== 0 && expenseAccounts?.length && !masterAccountExists(c.code, expenseAccounts)) {
      return `${c.name}: account code ${c.code} is not valid. Search and select from the list.`;
    }
  }
  if (clampCharge(ntdsAmt) !== 0 && expenseAccountCodeNum(ntdsCode) === 0) {
    return 'TDS amount is entered but TDS account code (NTDS) is not set in company setup.';
  }
  return null;
}

function pbDaneWgtEffective(idx, L, lineNumEdit) {
  if (lineNumEdit?.idx === idx && lineNumEdit?.field === 'dane_wgt') {
    return roundWeight3(parseNumInput(sanitizeDecimalTyping(lineNumEdit.text, 3)));
  }
  return roundWeight3(Number(L.dane_wgt) || 0);
}

function pbNetWeightCellValue(idx, L, lineNumEdit) {
  if (lineNumEdit?.idx === idx && lineNumEdit?.field === 'weight') return lineNumEdit.text;
  if (L.weight_manual) return fmtWeightShow3(L.weight);
  const g = Number(L.g_weight) || 0;
  const d = pbDaneWgtEffective(idx, L, lineNumEdit);
  const net = roundWeight3(Math.max(0, g - d));
  if (g > 0 || d > 0 || net > 0) return fmtWeightShow3(net);
  return Number(L.weight) > 0 ? fmtWeightShow3(L.weight) : '';
}

function pbNetWeightForEdit(idx, L, lineNumEdit) {
  if (L.weight_manual) return Number(L.weight) || 0;
  const g = Number(L.g_weight) || 0;
  const d = pbDaneWgtEffective(idx, L, lineNumEdit);
  if (g > 0 || d > 0) return roundWeight3(Math.max(0, g - d));
  return Number(L.weight) || 0;
}

function displayLineSoNo(n) {
  const v = Math.floor(Number(n) || 0);
  return v > 0 ? String(v) : '';
}

function formatPickDate(d) {
  if (!d) return '—';
  const ymd = toInputDateString(d);
  return ymd ? toDisplayDate(ymd) : String(d);
}

function applyItemFieldsToLine(L, ic, it, partyGst, compGst) {
  const line = { ...L, item_code: ic };
  const tp = Number(it?.TAX_PER ?? it?.tax_per ?? 0) || 0;
  const pg = partyGst.slice(0, 2);
  const cg = compGst.slice(0, 2);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (it && tp && pg && cg && pg === cg) {
    cgst = tp / 2;
    sgst = tp / 2;
  } else if (it && tp) {
    igst = tp;
  }
  if (it) {
    line.item_name = String(it.ITEM_NAME ?? it.item_name ?? '').trim();
    line.p_code = it.P_CODE != null ? String(it.P_CODE) : '';
    line.cgst_per = cgst;
    line.sgst_per = sgst;
    line.igst_per = igst;
    line.weight_manual = false;
    line.g_weight_manual = false;
    line.dane_manual = false;
    line.amount_manual = false;
  } else {
    line.item_name = '';
    line.p_code = '';
  }
  return line;
}

function mergeAndRecalcPurchaseLine(L, patch, { gAmtCal, purDane, purStkGN, rDateYmd }) {
  const line = { ...L, ...patch };
  if (patch?.weight_manual != null) line.weight_manual = !!patch.weight_manual;
  if (patch?.g_weight_manual != null) line.g_weight_manual = !!patch.g_weight_manual;
  if (patch?.dane_manual != null) line.dane_manual = !!patch.dane_manual;
  if (patch?.stk_weight_manual != null) line.stk_weight_manual = !!patch.stk_weight_manual;
  if (patch?.amount_manual != null) line.amount_manual = !!patch.amount_manual;

  if ((patch?.qnty != null || patch?.status != null) && patch?.g_weight == null && patch?.g_weight_manual == null) {
    line.g_weight_manual = false;
  }

  const qnty = Number(line.qnty) || 0;
  if (patch?.g_weight != null) {
    line.g_weight = roundWeight3(Number(patch.g_weight) || 0);
  } else if (!line.g_weight_manual) {
    line.g_weight = computeGWeight(qnty, line.status, gAmtCal);
  }

  if (!line.dane_manual) {
    line.dane_wgt = computeDaneWgt(qnty, line.g_weight, purDane);
  }

  if (!line.weight_manual) {
    const g = Number(line.g_weight) || 0;
    const d = Number(line.dane_wgt) || 0;
    line.weight = roundWeight3(Math.max(0, g - d));
  }

  if (!line.stk_weight_manual) {
    line.stk_weight =
      String(purStkGN).trim().toUpperCase() === 'G' ? Number(line.g_weight) || 0 : Number(line.weight) || 0;
  }
  if (!String(line.stk_date ?? '').trim()) line.stk_date = rDateYmd;
  line.rate = roundRate2(Number(line.rate) || 0);
  if (!line.amount_manual) {
    line.amount = computePurchaseAmount(qnty, line.weight, line.rate, line.cal, gAmtCal);
  } else {
    line.amount = roundRate2(Number(line.amount) || 0);
  }
  const disPer = Number(line.dis_per) || 0;
  line.dis_amt = Math.round(line.amount * (disPer / 100) * 100) / 100;
  const taxBase = Math.max(0, line.amount - line.dis_amt);
  line.taxable = taxBase;
  line.cgst_per = clampTaxPer(line.cgst_per);
  line.sgst_per = clampTaxPer(line.sgst_per);
  line.igst_per = clampTaxPer(line.igst_per);
  line.cgst_amt = Math.round(taxBase * line.cgst_per * 0.01 * 100) / 100;
  if (patch && 'cgst_per' in patch) {
    line.sgst_per = line.cgst_per;
    line.sgst_amt = line.cgst_amt;
  } else {
    line.sgst_amt = Math.round(taxBase * line.sgst_per * 0.01 * 100) / 100;
  }
  line.igst_amt = Math.round(taxBase * line.igst_per * 0.01 * 100) / 100;
  return line;
}

function PbSoPickModal({
  open,
  title,
  hint,
  emptyMessage,
  loading,
  rows,
  columns,
  hi,
  onHi,
  onClose,
  onPick,
  isMobile = false,
}) {
  const cardRef = useRef(null);
  const rowRefs = useRef([]);
  const rafRef = useRef(0);
  const [cardStyle, setCardStyle] = useState(null);
  const safeHi = Math.min(Math.max(0, hi), Math.max(0, rows.length - 1));

  const updateCardLayout = useCallback(() => {
    if (!isMobile) {
      setCardStyle(null);
      return;
    }
    const vv = window.visualViewport;
    const top = vv?.offsetTop ?? 0;
    const left = vv?.offsetLeft ?? 0;
    const height = vv?.height ?? window.innerHeight;
    const width = vv?.width ?? window.innerWidth;
    const pad = 8;
    const maxH = Math.max(200, Math.min(520, Math.floor(height * 0.72)));
    const layoutBottom = window.innerHeight;
    const visualBottom = top + height;
    setCardStyle({
      position: 'fixed',
      left: left + pad,
      width: Math.max(200, width - pad * 2),
      bottom: Math.max(pad, layoutBottom - visualBottom + pad),
      top: 'auto',
      maxHeight: maxH,
      height: maxH,
      margin: 0,
      maxWidth: 'none',
      borderRadius: '12px 12px 0 0',
    });
  }, [isMobile]);

  useLayoutEffect(() => {
    if (!open || !isMobile) {
      setCardStyle(null);
      return undefined;
    }
    updateCardLayout();
    const vv = window.visualViewport;
    const onReflow = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        updateCardLayout();
      });
    };
    vv?.addEventListener('resize', onReflow);
    vv?.addEventListener('scroll', onReflow);
    window.addEventListener('resize', onReflow);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      vv?.removeEventListener('resize', onReflow);
      vv?.removeEventListener('scroll', onReflow);
      window.removeEventListener('resize', onReflow);
    };
  }, [open, isMobile, updateCardLayout]);

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
    <div
      className={`sale-bill-pick-overlay slide-25-purchase-bill-ignore-enter${isMobile ? ' sale-bill-pick-overlay--mobile' : ''}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        className={`sale-bill-pick-card${isMobile ? ' sale-bill-pick-card--mobile' : ''}`}
        style={isMobile && cardStyle ? cardStyle : undefined}
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

function roundRate2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function clampTaxPer(n) {
  const x = Number(n) || 0;
  return Math.max(0, Math.min(100, Math.round(x * 100) / 100));
}

function ceilNtds(raw) {
  const n = Number(raw) || 0;
  const a = Math.floor(n);
  const b = n - a;
  return b !== 0 ? a + 1 : a;
}

/** B→q×100, K→×50, H→×30; if G_AMT_CAL='Q' then ÷100 */
function computeGWeight(qnty, status, gAmtCal) {
  const q = Number(qnty) || 0;
  if (q <= 0) return 0;
  const st = String(status ?? 'B').trim().toUpperCase().slice(0, 1) || 'B';
  let w = q * 100;
  if (st === 'K') w = q * 50;
  else if (st === 'H') w = q * 30;
  if (String(gAmtCal ?? '').trim().toUpperCase() === 'Q') w /= 100;
  return roundWeight3(w);
}

function computeDaneWgt(qnty, gWeight, purDane) {
  if (String(purDane ?? 'N').trim().toUpperCase() !== 'Y') return 0;
  const q = Number(qnty) || 0;
  const gw = Number(gWeight) || 0;
  if (q <= 0 || gw <= 0) return 0;
  const per = gw / q > 55 ? 0.1 : 0.05;
  return roundWeight3(q * per);
}

function computePurchaseAmount(qnty, weight, rate, cal, gAmtCal) {
  const r = roundRate2(rate);
  if (parseCal(cal) === 2) {
    if (String(gAmtCal ?? '').trim().toUpperCase() === 'K') {
      return Math.round((weight * r) / 100 * 100) / 100;
    }
    return Math.round(weight * r * 100) / 100;
  }
  return Math.round((Number(qnty) || 0) * r * 100) / 100;
}

function isPbWeightField(field) {
  return field === 'weight' || field === 'dane_wgt' || field === 'g_weight';
}

function isPbFocusable(el) {
  if (!el || el.disabled) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  if (el.readOnly) return false;
  const tag = el.tagName;
  if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return false;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'hidden' || type === 'button' || type === 'submit') return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (!el.offsetParent && style.position !== 'fixed') return false;
  return true;
}

function focusPbInput(el) {
  if (!el || el.disabled) return;
  try {
    el.focus();
    if (typeof el.select === 'function' && el.tagName === 'INPUT') el.select();
  } catch (_) {}
}

function focusNextInForm(rootEl, currentEl) {
  if (!rootEl || !currentEl) return false;
  const list = Array.from(
    rootEl.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), select, textarea')
  ).filter(isPbFocusable);
  const i = list.indexOf(currentEl);
  if (i < 0) return false;
  for (let j = i + 1; j < list.length; j += 1) {
    focusPbInput(list[j]);
    return true;
  }
  return false;
}

function focusNextPbGridCell(table, row, rowIdx, rows, currentEl) {
  const inputs = Array.from(row.querySelectorAll('input:not([disabled]), select:not([disabled])')).filter((el) => {
    if (el.readOnly || el.tabIndex === -1) return false;
    const td = el.closest('td, th');
    if (!td || td.offsetParent === null) return false;
    return true;
  });
  const colIdx = inputs.indexOf(currentEl);
  if (colIdx === -1) return false;
  let next = null;
  if (colIdx < inputs.length - 1) next = inputs[colIdx + 1];
  else if (rowIdx < rows.length - 1) {
    const below = Array.from(rows[rowIdx + 1].querySelectorAll('input:not([disabled]), select:not([disabled])')).filter(
      (el) => {
        if (el.readOnly || el.tabIndex === -1) return false;
        const td = el.closest('td, th');
        return td && td.offsetParent !== null;
      }
    );
    if (below.length) next = below[0];
  }
  if (!next) return false;
  focusPbInput(next);
  return true;
}

function focusPbLineField(lineIdx, dataAttr) {
  window.requestAnimationFrame(() => {
    const root = document.querySelector('.slide-25-purchase-bill');
    const el = root?.querySelector(`input[data-${dataAttr}="${lineIdx}"]`);
    if (!el || el.disabled) return;
    try {
      el.focus();
      if (typeof el.select === 'function') el.select();
    } catch (_) {}
  });
}

function focusPbLineQty(lineIdx) {
  focusPbLineField(lineIdx, 'pb-line-qty');
}

function focusPbLineSoNo(lineIdx) {
  focusPbLineField(lineIdx, 'pb-line-sono');
}

function focusAfterPartyPick() {
  window.requestAnimationFrame(() => {
    const root = document.querySelector('.slide-25-purchase-bill');
    const search = root?.querySelector('input[data-pb-broker-search]');
    if (search && !search.disabled) {
      try {
        search.focus();
        if (typeof search.select === 'function') search.select();
      } catch (_) {}
      return;
    }
    const chg = root?.querySelector('button[data-pb-broker-chg]');
    if (chg && !chg.disabled) {
      try {
        chg.focus();
      } catch (_) {}
      return;
    }
    focusPbLineSoNo(0);
  });
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

function emptyLine(defaultPlant = '', defaultStkDate = '') {
  return {
    trn_no: 1,
    so_no: '',
    item_code: '',
    item_name: '',
    p_code: '',
    qnty: 0,
    status: 'B',
    g_weight: 0,
    dane_wgt: 0,
    weight: 0,
    rate: 0,
    cal: '1',
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
    stk_weight: 0,
    stk_date: String(defaultStkDate ?? '').trim(),
    weight_manual: false,
    g_weight_manual: false,
    dane_manual: false,
    stk_weight_manual: false,
    amount_manual: false,
    plant_code: String(defaultPlant ?? '').trim(),
  };
}

export default function Slide25PurchaseBill({ apiBase, formData, userName, onPrev, onReset }) {
  const rNoRef = useRef('');
  const slotGenRef = useRef(0);
  const rDateInputRef = useRef(null);
  const didFocusRDateRef = useRef(false);
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYearLogin = String(formData.comp_year ?? formData.COMP_YEAR ?? '').trim();

  const [perm, setPerm] = useState(null);
  const [masterPartyPerm, setMasterPartyPerm] = useState(null);
  const [masterPartyOpen, setMasterPartyOpen] = useState(false);
  const [masterPartySchedule, setMasterPartySchedule] = useState(11.1);
  const [ctx, setCtx] = useState(null);
  const [lookups, setLookups] = useState({ parties: [], brokers: [], items: [], plants: [], expenseCodes: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('new');
  const [rNo, setRNo] = useState('');
  const [rDateYmd, setRDateYmd] = useState(() => toInputDateString(new Date()));
  const [billDateYmd, setBillDateYmd] = useState(() => toInputDateString(new Date()));
  const [supplierBillNo, setSupplierBillNo] = useState('');
  const [code, setCode] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [partyHi, setPartyHi] = useState(0);
  const [partyFinderOpen, setPartyFinderOpen] = useState(true);
  const [partyBrowseOpen, setPartyBrowseOpen] = useState(false);
  const [partySheetOpen, setPartySheetOpen] = useState(false);
  const [bkCode, setBkCode] = useState('');
  const [brokerSearch, setBrokerSearch] = useState('');
  const [brokerBrowseOpen, setBrokerBrowseOpen] = useState(false);
  const [brokerSheetOpen, setBrokerSheetOpen] = useState(false);
  const [plantCode, setPlantCode] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [postedNew, setPostedNew] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printParams, setPrintParams] = useState(null);
  const [listScreenOpen, setListScreenOpen] = useState(false);
  const [itemFinder, setItemFinder] = useState(null);
  const [itemSheetOpen, setItemSheetOpen] = useState(false);
  const [soPick, setSoPick] = useState({
    open: false,
    lineIdx: -1,
    rows: [],
    loading: false,
    hi: 0,
    poBroker: '',
    diag: null,
  });
  const [lineNumEdit, setLineNumEdit] = useState(null);
  const [expNumEdit, setExpNumEdit] = useState(null);
  const [isCompactMobile, setIsCompactMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });
  const [showLineDetails, setShowLineDetails] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !window.matchMedia('(max-width: 768px)').matches;
  });
  const [showFooterBreakdown, setShowFooterBreakdown] = useState(false);
  const dcLinesTopScrollRef = useRef(null);
  const dcLinesTopInnerRef = useRef(null);
  const dcLinesGridScrollRef = useRef(null);

  const [mfeePer, setMfeePer] = useState(0);
  const [mfeeAmt, setMfeeAmt] = useState(0);
  const [mfeeCode, setMfeeCode] = useState('');
  const [labour, setLabour] = useState(0);
  const [labCode, setLabCode] = useState('');
  const [freight, setFreight] = useState(0);
  const [fgtCode, setFgtCode] = useState('');
  const [addExp, setAddExp] = useState(0);
  const [addCode, setAddCode] = useState('');
  const [lessExp, setLessExp] = useState(0);
  const [lessCode, setLessCode] = useState('');
  const [ntdsOnAmt, setNtdsOnAmt] = useState(0);
  const [ntdsPer, setNtdsPer] = useState(0);
  const [ntdsAmt, setNtdsAmt] = useState(0);
  const [truck, setTruck] = useState('');
  const [grNo, setGrNo] = useState('');
  const [tpt, setTpt] = useState('');

  const rDateOracle = useMemo(() => toOracleDate(rDateYmd), [rDateYmd]);
  const gAmtCal = ctx?.G_AMT_CAL ?? 'K';
  const purDane = ctx?.G_PUR_DANE ?? 'N';
  const purStkGN = ctx?.G_PUR_STK_G_N ?? 'N';
  const { compYear, fyMinYmd, fyMaxYmd } = useMemo(() => resolveSaleEntryFinYear(formData, ctx), [formData, ctx]);
  const partyGst = useMemo(() => {
    const p = lookups.parties.find((x) => String(x.CODE ?? x.code) === String(code));
    return String(p?.GST_NO ?? p?.gst_no ?? '').trim();
  }, [code, lookups.parties]);
  const compGst = String(formData.gst_no ?? formData.GST_NO ?? '').trim();

  const defaultPlantCode = useMemo(() => String(ctx?.G_PLANT_CODE ?? '').trim(), [ctx]);
  const effectivePlantCode = useMemo(
    () => String(plantCode || defaultPlantCode || '').trim(),
    [plantCode, defaultPlantCode]
  );

  const plantOptions = useMemo(() => {
    const list = lookups.plants || [];
    const dc = defaultPlantCode;
    if (!dc) return list;
    const has = list.some((pl) => String(pl.PLANT_CODE ?? pl.plant_code ?? '').trim() === dc);
    if (has) return list;
    return [{ PLANT_CODE: dc, plant_code: dc, PLANT_NAME: '(from company)', plant_name: '(from company)' }, ...list];
  }, [lookups.plants, defaultPlantCode]);

  useEffect(() => {
    if (!ctx) return;
    const docYmd = defaultDocDateInFinYear(fyMinYmd, fyMaxYmd);
    setRDateYmd((prev) => clampYmdToFinYear(prev, fyMinYmd, fyMaxYmd) || docYmd);
    setBillDateYmd((prev) => clampYmdToFinYear(prev, fyMinYmd, fyMaxYmd) || docYmd);
    const pc = defaultPlantCode;
    if (pc) {
      setPlantCode((prev) => (String(prev ?? '').trim() ? prev : pc));
      setLines((prev) =>
        prev.map((L) => ({
          ...L,
          plant_code: String(L.plant_code ?? '').trim() || pc,
        }))
      );
    }
    const lc = String(ctx.G_LABCD ?? '').trim();
    const fc = String(ctx.G_FGTCD ?? '').trim();
    const oc = String(ctx.G_OTH_CODE ?? '').trim();
    if (lc && !labCode) setLabCode(lc);
    if (fc && !fgtCode) setFgtCode(fc);
    if (oc && !addCode) setAddCode(oc);
    if (oc && !lessCode) setLessCode(oc);
  }, [ctx, fyMinYmd, fyMaxYmd, defaultPlantCode, labCode, fgtCode, addCode, lessCode]);

  useEffect(() => {
    rNoRef.current = String(rNo ?? '').trim();
  }, [rNo]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => window.clearTimeout(t);
  }, [showLineDetails]);

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

  const filteredParties = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    const list = lookups.parties || [];
    if (!q) {
      if (!partyBrowseOpen) return [];
      return list.slice(0, 80);
    }
    return list
      .filter((p) => {
        const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
        const name = String(p.NAME ?? p.name ?? '').toLowerCase();
        const city = String(p.CITY ?? p.city ?? '').toLowerCase();
        return pc.includes(q) || name.includes(q) || city.includes(q);
      })
      .slice(0, 80);
  }, [partySearch, partyBrowseOpen, lookups.parties]);

  const partyPickVisible =
    !isCompactMobile &&
    (partyBrowseOpen || !!partySearch.trim()) &&
    (!code || partyFinderOpen);

  const safePartyHi = Math.min(Math.max(0, partyHi), Math.max(0, filteredParties.length - 1));

  const filteredBrokers = useMemo(() => {
    const q = brokerSearch.trim().toLowerCase();
    const list = lookups.brokers || [];
    if (!q) {
      if (!brokerBrowseOpen) return [];
      return list.slice(0, 80);
    }
    return list
      .filter((p) => {
        const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
        const name = String(p.NAME ?? p.name ?? '').toLowerCase();
        return pc.includes(q) || name.includes(q);
      })
      .slice(0, 80);
  }, [brokerSearch, brokerBrowseOpen, lookups.brokers]);

  const brokerPickVisible =
    !isCompactMobile &&
    (brokerBrowseOpen || !!brokerSearch.trim()) &&
    (!bkCode || brokerBrowseOpen);

  const partyPickRows = useMemo(
    () =>
      filteredParties.map((row, index) => {
        const pc = String(row.CODE ?? row.code ?? '');
        return {
          key: pc,
          code: pc,
          name: row.NAME ?? row.name,
          city: (row.CITY ?? row.city) || '—',
          highlight: safePartyHi === index,
        };
      }),
    [filteredParties, safePartyHi]
  );

  const brokerPickRows = useMemo(
    () =>
      filteredBrokers.map((p) => {
        const pc = String(p.CODE ?? p.code ?? '');
        return {
          key: pc,
          code: pc,
          name: p.NAME ?? p.name,
          city: (p.CITY ?? p.city) || '—',
        };
      }),
    [filteredBrokers]
  );

  const partyInfo = useMemo(() => {
    if (!code) return null;
    return lookups.parties.find((p) => String(p.CODE ?? p.code) === String(code)) ?? null;
  }, [code, lookups.parties]);

  const brokerInfo = useMemo(() => {
    if (!bkCode) return null;
    return lookups.brokers.find((p) => String(p.CODE ?? p.code) === String(bkCode)) ?? null;
  }, [bkCode, lookups.brokers]);

  const expenseCodeOptions = useMemo(() => lookups.expenseCodes || [], [lookups.expenseCodes]);

  const lineTotals = useMemo(() => {
    let qnty = 0;
    let weight = 0;
    let amount = 0;
    let dis = 0;
    let cg = 0;
    let sg = 0;
    let ig = 0;
    for (const L of lines) {
      qnty += Number(L.qnty) || 0;
      weight += Number(L.weight) || 0;
      amount += Number(L.amount) || 0;
      dis += Number(L.dis_amt) || 0;
      cg += Number(L.cgst_amt) || 0;
      sg += Number(L.sgst_amt) || 0;
      ig += Number(L.igst_amt) || 0;
    }
    return { qnty, weight, amount, dis, cg, sg, ig };
  }, [lines]);

  useEffect(() => {
    const sumAmt = lineTotals.amount;
    setMfeeAmt(Math.round(sumAmt * (Number(mfeePer) || 0) * 0.01 * 100) / 100);
  }, [lineTotals.amount, mfeePer]);

  useEffect(() => {
    const raw = Math.round((Number(ntdsOnAmt) || 0) * (Number(ntdsPer) || 0) * 0.01 * 100) / 100;
    setNtdsAmt(ceilNtds(raw));
  }, [ntdsOnAmt, ntdsPer]);

  const billAmt = useMemo(() => {
    const t = lineTotals;
    return (
      t.amount +
      t.cg +
      t.sg +
      t.ig +
      clampCharge(mfeeAmt) +
      clampCharge(labour) +
      clampCharge(freight) +
      clampCharge(addExp) -
      t.dis -
      clampCharge(lessExp)
    );
  }, [lineTotals, mfeeAmt, labour, freight, addExp, lessExp]);

  const netPayable = useMemo(() => billAmt - (Number(ntdsAmt) || 0), [billAmt, ntdsAmt]);

  const can = perm || {};
  const accessOnlyBrowse = !!can.canOpen && !can.canAdd && !can.canEdit && !can.canDelete;
  const fieldsDisabled = !can.canOpen || accessOnlyBrowse || mode === 'delete';
  const canEditLines = useMemo(
    () =>
      !fieldsDisabled && ((mode === 'new' && !!can.canAdd) || (mode === 'edit' && !!can.canEdit)),
    [fieldsDisabled, mode, can.canAdd, can.canEdit]
  );

  const showCenterMessage = useCallback((text, isError = false) => {
    if (isError) {
      setMsg('');
      setErr(text);
    } else {
      setErr('');
      setMsg(text);
    }
  }, []);

  const showNotice = useCallback((text) => showCenterMessage(text, false), [showCenterMessage]);
  const showError = useCallback((text) => showCenterMessage(text, true), [showCenterMessage]);

  const itemByCode = useCallback(
    (ic) => {
      const key = normalizeItemCode(ic);
      if (!key) return null;
      return (
        (lookups.items || []).find((it) => normalizeItemCode(it.ITEM_CODE ?? it.item_code) === key) ?? null
      );
    },
    [lookups.items]
  );

  const plantCodeValid = useCallback(
    (pc) => {
      const key = normalizePlantCode(pc);
      if (!key) return false;
      return plantOptions.some((pl) => normalizePlantCode(pl.PLANT_CODE ?? pl.plant_code) === key);
    },
    [plantOptions]
  );

  const itemFinderMatches = useMemo(() => {
    if (itemFinder == null) return [];
    const q = String(itemFinder.query ?? '').trim();
    if (!q) return [];
    return filterItemCodeNameRows(lookups.items, q, 50);
  }, [itemFinder, lookups.items]);

  const itemFinderSafeHi = Math.min(itemFinder?.hi ?? 0, Math.max(0, itemFinderMatches.length - 1));

  const itemPickRows = useMemo(
    () =>
      itemFinderMatches.map((it, index) => {
        const pc = normalizeItemCode(it.ITEM_CODE ?? it.item_code);
        return {
          key: pc,
          code: pc,
          name: it.ITEM_NAME ?? it.item_name,
          highlight: itemFinderSafeHi === index,
        };
      }),
    [itemFinderMatches, itemFinderSafeHi]
  );

  const pbLineNumDisplay = useCallback(
    (idx, field, value, formatter) => {
      if (lineNumEdit && lineNumEdit.idx === idx && lineNumEdit.field === field) {
        return lineNumEdit.text;
      }
      return formatter(value);
    },
    [lineNumEdit]
  );

  const startPbLineNumEdit = useCallback((idx, field, value, formatter) => {
    const shown = formatter(value);
    setLineNumEdit({ idx, field, text: shown === '' ? '' : shown });
  }, []);

  const expNumDisplay = useCallback(
    (key, value) => {
      if (expNumEdit && expNumEdit.key === key) return expNumEdit.text;
      return numToInputDisplay(value);
    },
    [expNumEdit]
  );

  const startExpNumEdit = useCallback((key, value) => {
    setExpNumEdit({ key, text: numToInputDisplay(value) });
  }, []);

  const commitExpNumEdit = useCallback(
    (key, setter) => {
      if (!expNumEdit || expNumEdit.key !== key) return;
      const raw = sanitizeDecimalTyping(expNumEdit.text, 2);
      setExpNumEdit(null);
      setter(parseNumInput(raw));
    },
    [expNumEdit]
  );

  const recalcLine = useCallback(
    (idx, patch) => {
      setLines((prev) => {
        const next = [...prev];
        next[idx] = mergeAndRecalcPurchaseLine(next[idx], patch, { gAmtCal, purDane, purStkGN, rDateYmd });
        return next;
      });
    },
    [gAmtCal, purDane, purStkGN, rDateYmd]
  );

  const commitPbLineNumEdit = useCallback(
    (idx, field) => {
      if (!lineNumEdit || lineNumEdit.idx !== idx || lineNumEdit.field !== field) return;
      const raw = sanitizeDecimalTyping(lineNumEdit.text, isPbWeightField(field) ? 3 : 2);
      setLineNumEdit(null);
      if (field === 'qnty') {
        recalcLine(idx, { qnty: parseNumInput(raw) });
      } else if (field === 'rate') {
        recalcLine(idx, { rate: roundRate2(parseNumInput(raw)) });
      } else if (field === 'g_weight') {
        recalcLine(idx, {
          g_weight: roundWeight3(parseNumInput(raw)),
          g_weight_manual: true,
          weight_manual: false,
        });
      } else if (field === 'weight') {
        recalcLine(idx, { weight: roundWeight3(parseNumInput(raw)), weight_manual: true });
      } else if (field === 'dane_wgt') {
        recalcLine(idx, { dane_wgt: roundWeight3(parseNumInput(raw)), dane_manual: true, weight_manual: false });
      } else if (field === 'amount') {
        recalcLine(idx, { amount: roundRate2(parseNumInput(raw)), amount_manual: true });
      } else if (field === 'dis_per') {
        recalcLine(idx, { dis_per: clampTaxPer(parseNumInput(raw)) });
      } else if (field === 'cgst_per') {
        const v = clampTaxPer(parseNumInput(raw));
        recalcLine(idx, { cgst_per: v, sgst_per: v });
      } else if (field === 'sgst_per') {
        recalcLine(idx, { sgst_per: clampTaxPer(parseNumInput(raw)) });
      } else if (field === 'igst_per') {
        recalcLine(idx, { igst_per: clampTaxPer(parseNumInput(raw)) });
      } else if (field === 'stk_weight') {
        recalcLine(idx, { stk_weight: roundWeight3(parseNumInput(raw)), stk_weight_manual: true });
      }
    },
    [lineNumEdit, recalcLine]
  );

  const visibleInputsInRow = (row) =>
    Array.from(row.querySelectorAll('input:not([disabled]), select:not([disabled])')).filter((el) => {
      if (el.readOnly || el.tabIndex === -1) return false;
      const td = el.closest('td, th');
      if (!td || td.offsetParent === null) return false;
      return true;
    });

  const focusLineInput = (el) => {
    focusPbInput(el);
  };

  const commitActiveLineNumEdit = useCallback(
    (t) => {
      if (!lineNumEdit || t?.tagName !== 'INPUT' || t.classList.contains('pb-exp-input')) return;
      const { idx, field } = lineNumEdit;
      const raw = sanitizeDecimalTyping(lineNumEdit.text, isPbWeightField(field) ? 3 : 2);
      setLineNumEdit(null);
      if (field === 'qnty') recalcLine(idx, { qnty: parseNumInput(raw) });
      else if (field === 'rate') recalcLine(idx, { rate: roundRate2(parseNumInput(raw)) });
      else if (field === 'g_weight') {
        recalcLine(idx, {
          g_weight: roundWeight3(parseNumInput(raw)),
          g_weight_manual: true,
          weight_manual: false,
        });
      } else if (field === 'weight') recalcLine(idx, { weight: roundWeight3(parseNumInput(raw)), weight_manual: true });
      else if (field === 'dane_wgt') {
        recalcLine(idx, { dane_wgt: roundWeight3(parseNumInput(raw)), dane_manual: true, weight_manual: false });
      } else if (field === 'amount') recalcLine(idx, { amount: roundRate2(parseNumInput(raw)), amount_manual: true });
      else if (field === 'dis_per') recalcLine(idx, { dis_per: clampTaxPer(parseNumInput(raw)) });
      else if (field === 'cgst_per') {
        const v = clampTaxPer(parseNumInput(raw));
        recalcLine(idx, { cgst_per: v, sgst_per: v });
      } else if (field === 'sgst_per') recalcLine(idx, { sgst_per: clampTaxPer(parseNumInput(raw)) });
      else if (field === 'igst_per') recalcLine(idx, { igst_per: clampTaxPer(parseNumInput(raw)) });
      else if (field === 'stk_weight') recalcLine(idx, { stk_weight: roundWeight3(parseNumInput(raw)), stk_weight_manual: true });
    },
    [lineNumEdit, recalcLine]
  );

  const handlePbLineGridKeyDown = useCallback(
    (e) => {
      const key = e.key;
      const t = e.target;
      const inGridBody = t?.closest('.pb-lines-table tbody');
      if (!inGridBody) return;
      if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return;

      if (key === 'Enter' && !isCompactMobile) {
        commitActiveLineNumEdit(t);
        e.preventDefault();
        e.stopPropagation();
        const row = t.closest('tr');
        const table = t.closest('.pb-lines-table');
        if (!row || !table) return;
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const rowIdx = rows.indexOf(row);
        if (!focusNextPbGridCell(table, row, rowIdx, rows, t)) {
          const root = t.closest('.slide-25-purchase-bill');
          if (root) focusNextInForm(root, t);
        }
        return;
      }

      if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown') return;

      if (lineNumEdit && t.tagName === 'INPUT') {
        commitActiveLineNumEdit(t);
      }

      const row = t.closest('tr');
      const table = t.closest('.pb-lines-table');
      if (!row || !table) return;
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const rowIdx = rows.indexOf(row);
      const inputs = visibleInputsInRow(row);
      const colIdx = inputs.indexOf(t);
      if (colIdx === -1) return;

      let next = null;
      if (key === 'ArrowRight' && colIdx < inputs.length - 1) next = inputs[colIdx + 1];
      else if (key === 'ArrowLeft' && colIdx > 0) next = inputs[colIdx - 1];
      else if (key === 'ArrowDown' && rowIdx < rows.length - 1) {
        const below = visibleInputsInRow(rows[rowIdx + 1]);
        if (below[colIdx]) next = below[colIdx];
      } else if (key === 'ArrowUp' && rowIdx > 0) {
        const above = visibleInputsInRow(rows[rowIdx - 1]);
        if (above[colIdx]) next = above[colIdx];
      }
      if (!next) return;
      e.preventDefault();
      e.stopPropagation();
      focusLineInput(next);
    },
    [lineNumEdit, recalcLine, isCompactMobile, commitActiveLineNumEdit]
  );

  const applyItemToLine = useCallback(
    (idx, itemCodeRaw) => {
      const codeKey = normalizeItemCode(itemCodeRaw);
      const it = codeKey ? itemByCode(codeKey) : null;
      const tp = Number(it?.TAX_PER ?? it?.tax_per ?? 0) || 0;
      const pg = partyGst.slice(0, 2);
      const cg = compGst.slice(0, 2);
      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      if (it && tp && pg && cg && pg === cg) {
        cgst = tp / 2;
        sgst = tp / 2;
      } else if (it && tp) {
        igst = tp;
      }
      setLines((prev) => {
        const next = [...prev];
        const L = { ...next[idx] };
        L.item_code = codeKey;
        if (it) {
          L.item_name = String(it.ITEM_NAME ?? it.item_name ?? '').trim();
          L.p_code = it.P_CODE != null ? String(it.P_CODE) : '';
          L.cgst_per = cgst;
          L.sgst_per = sgst;
          L.igst_per = igst;
          L.weight_manual = false;
          L.g_weight_manual = false;
          L.dane_manual = false;
          L.amount_manual = false;
        } else {
          L.item_name = '';
          L.p_code = '';
        }
        next[idx] = L;
        return next;
      });
      if (it) recalcLine(idx, {});
    },
    [itemByCode, partyGst, compGst, recalcLine]
  );

  const pickItemForLine = useCallback(
    (idx, itemCode) => {
      applyItemToLine(idx, itemCode);
      setItemFinder(null);
      setItemSheetOpen(false);
      focusPbLineQty(idx);
    },
    [applyItemToLine]
  );

  const commitItemFinderPick = useCallback(
    (idx, query, hi = 0) => {
      const q = String(query ?? '').trim();
      if (!q) {
        setItemFinder(null);
        return true;
      }
      const matches = filterItemCodeNameRows(lookups.items, q, 30);
      if (matches.length > 0) {
        const pickHi = Math.min(Math.max(0, hi), matches.length - 1);
        const row = matches[pickHi];
        pickItemForLine(idx, row.ITEM_CODE ?? row.item_code);
        return true;
      }
      const ic = normalizeItemCode(q);
      if (ic && itemByCode(ic)) {
        pickItemForLine(idx, ic);
        return true;
      }
      if (ic) {
        showNotice(`Invalid item code: ${ic}. Choose from search list.`);
        setItemFinder(null);
        return false;
      }
      setItemFinder(null);
      return true;
    },
    [lookups.items, itemByCode, pickItemForLine, showNotice]
  );

  const openItemPick = useCallback(
    (idx) => {
      if (!canEditLines) return;
      setItemFinder({
        idx,
        hi: 0,
        query: '',
      });
      setItemSheetOpen(true);
    },
    [canEditLines]
  );

  const openSoPick = useCallback(
    async (lineIdx) => {
      if (!canEditLines) return;
      const poBroker = String(ctx?.G_PO_CODE_BROKER ?? 'C').trim().toUpperCase();
      if (poBroker === 'B' && !String(bkCode ?? '').trim()) {
        showNotice('Select broker before pending purchase order (F1).');
        return;
      }
      if (!String(code ?? '').trim()) {
        showNotice('Select party (supplier) before pending purchase order (F1).');
        return;
      }
      if (poBroker === 'B' && !String(bkCode ?? '').trim()) {
        showNotice('Select broker before pending purchase order (F1).');
        return;
      }
      setSoPick({ open: true, lineIdx, rows: [], loading: true, hi: 0, poBroker });
      try {
        const { data } = await axios.get(`${apiBase}/api/purchase-bill-pending-orders`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            code: String(code ?? '').trim() || undefined,
            b_code: String(bkCode ?? '').trim() || undefined,
          },
          ...reqOpts,
        });
        const rows = Array.isArray(data) ? data : Array.isArray(data?.rows) ? data.rows : [];
        const diag = data?.diag ?? null;
        setSoPick((p) => ({
          ...p,
          rows,
          loading: false,
          diag,
          poBroker: String(data?.po_code_broker ?? poBroker).trim().toUpperCase(),
        }));
      } catch (e) {
        showError(e?.response?.data?.error || e.message || 'Pending purchase order failed');
        setSoPick((p) => ({ ...p, open: false, loading: false }));
      }
    },
    [apiBase, bkCode, canEditLines, code, compCode, compUid, ctx?.G_PO_CODE_BROKER, showNotice, showError]
  );

  const applySoPick = useCallback(
    (lineIdx, row) => {
      const ic = normalizeItemCode(row.ITEM_CODE ?? row.item_code);
      const it = ic ? itemByCode(ic) : null;
      const bqty = Number(row.BQTY ?? 0) || 0;
      const bwgt = roundWeight3(Number(row.BWGT ?? 0) || 0);
      const poPatch = {
        so_no: displayLineSoNo(row.SO_NO ?? row.so_no),
        qnty: bqty,
        status: normalizePbStatus(row.STATUS ?? row.status),
        rate: roundRate2(Number(row.RATE ?? row.rate ?? 0)),
        g_weight: bwgt,
        dane_wgt: 0,
        dane_manual: true,
        weight_manual: false,
      };
      setSoPick((p) => ({ ...p, open: false }));
      setLines((prev) => {
        const next = [...prev];
        let L = applyItemFieldsToLine(next[lineIdx], ic, it, partyGst, compGst);
        L = mergeAndRecalcPurchaseLine(L, poPatch, { gAmtCal, purDane, purStkGN, rDateYmd });
        next[lineIdx] = L;
        return next;
      });
      window.setTimeout(() => focusPbLineQty(lineIdx), 30);
    },
    [itemByCode, partyGst, compGst, gAmtCal, purDane, purStkGN, rDateYmd]
  );

  const soPickColumns = useMemo(
    () => [
      { key: 'so', label: 'SO no', render: (r) => displayLineSoNo(r.SO_NO ?? r.so_no) },
      { key: 'dt', label: 'Date', render: (r) => formatPickDate(r.SO_DATE ?? r.so_date) },
      { key: 'it', label: 'Item', render: (r) => normalizeItemCode(r.ITEM_CODE ?? r.item_code) },
      { key: 'st', label: 'St', render: (r) => normalizePbStatus(r.STATUS ?? r.status) },
      { key: 'rt', label: 'Rate', render: (r) => fmtRateShow2(Number(r.RATE ?? r.rate ?? 0)) },
      { key: 'bq', label: 'Bal qty', render: (r) => fmtWeightShow3(Number(r.BQTY ?? 0)) },
      { key: 'bw', label: 'Bal wt', render: (r) => fmtWeightShow3(Number(r.BWGT ?? 0)) },
      { key: 'rm', label: 'Remarks', render: (r) => String(r.REMARKS ?? r.remarks ?? '').trim() || '—' },
    ],
    []
  );

  const applyRowsFromApi = useCallback(
    (rows) => {
      if (!rows?.length) return;
      const h0 = rows[0];
      setCode(String(h0.CODE ?? h0.code ?? '').trim());
      setBkCode(String(h0.BK_CODE ?? h0.bk_code ?? '').trim());
      setPlantCode(String(h0.PLANT_CODE ?? h0.plant_code ?? '').trim());
      const bd = h0.BILL_DATE ?? h0.bill_date;
      setBillDateYmd(toInputDateString(bd) || toInputDateString(h0.R_DATE ?? h0.r_date) || '');
      setSupplierBillNo(String(h0.BILL_NO ?? h0.bill_no ?? '').trim());
      setMfeePer(Number(h0.MFEE_PER ?? h0.mfee_per ?? 0) || 0);
      setMfeeAmt(Number(h0.MFEE_AMT ?? h0.mfee_amt ?? 0) || 0);
      setMfeeCode(String(h0.MFEE_CODE ?? h0.mfee_code ?? '').trim());
      setLabour(Number(h0.LABOUR ?? h0.labour ?? 0) || 0);
      setLabCode(String(h0.LAB_CODE ?? h0.lab_code ?? '').trim());
      setFreight(Number(h0.FREIGHT ?? h0.freight ?? 0) || 0);
      setFgtCode(String(h0.FGT_CODE ?? h0.fgt_code ?? '').trim());
      setAddExp(Number(h0.ADDEXP ?? h0.addexp ?? 0) || 0);
      setAddCode(String(h0.ADD_CODE ?? h0.add_code ?? '').trim());
      setLessExp(Number(h0.LESSEXP ?? h0.lessexp ?? 0) || 0);
      setLessCode(String(h0.LESS_CODE ?? h0.less_code ?? '').trim());
      setNtdsOnAmt(Number(h0.NTDS_ON_AMT ?? h0.ntds_on_amt ?? 0) || 0);
      setNtdsPer(Number(h0.NTDS_PER ?? h0.ntds_per ?? 0) || 0);
      setNtdsAmt(Number(h0.NTDS_AMT ?? h0.ntds_amt ?? 0) || 0);
      setTruck(String(h0.TRUCK ?? h0.truck ?? '').trim());
      setGrNo(String(h0.GR_NO ?? h0.gr_no ?? '').trim());
      setTpt(String(h0.TPT ?? h0.tpt ?? '').trim());
      setPartyFinderOpen(false);
      setLines(
        rows.map((r, i) => ({
          trn_no: Number(r.TRN_NO ?? r.trn_no ?? i + 1) || i + 1,
          so_no: String(r.SO_NO ?? r.so_no ?? '').trim(),
          item_code: normalizeItemCode(r.ITEM_CODE ?? r.item_code ?? ''),
          item_name: String(r.ITEM_NAME ?? r.item_name ?? '').trim(),
          p_code: String(r.P_CODE ?? r.p_code ?? '').trim(),
          qnty: Number(r.QNTY ?? r.qnty ?? 0) || 0,
          status: normalizePbStatus(r.STATUS ?? r.status ?? 'B'),
          g_weight: Number(r.G_WEIGHT ?? r.g_weight ?? 0) || 0,
          dane_wgt: Number(r.DANE_WGT ?? r.dane_wgt ?? 0) || 0,
          weight: Number(r.WEIGHT ?? r.weight ?? 0) || 0,
          rate: roundRate2(Number(r.RATE ?? r.rate ?? 0) || 0),
          cal: String(r.CAL ?? r.cal ?? '1').replace(/\D/g, '').slice(0, 1) || '1',
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
          stk_weight: Number(r.STK_WEIGHT ?? r.stk_weight ?? 0) || 0,
          stk_date:
            toInputDateString(r.STK_DATE ?? r.stk_date ?? h0.STK_DATE ?? h0.stk_date ?? r.R_DATE ?? h0.R_DATE) || '',
          stk_weight_manual: true,
          g_weight_manual: true,
          weight_manual: true,
          dane_manual: true,
          plant_code: normalizePlantCode(r.PLANT_CODE ?? h0.PLANT_CODE ?? ''),
        }))
      );
    },
    []
  );

  const permParams = useMemo(
    () => ({ comp_code: compCode, comp_uid: compUid, user_name: userName || '' }),
    [compCode, compUid, userName]
  );

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [pRes, cRes, lRes, mpRes] = await Promise.all([
        axios.get(`${apiBase}/api/purchase-bill-user-permissions`, { params: permParams, ...reqOpts }),
        axios.get(`${apiBase}/api/purchase-bill-form-context`, {
          params: { comp_code: compCode, comp_uid: compUid, ...(compYearLogin ? { comp_year: compYearLogin } : {}) },
          ...reqOpts,
        }),
        axios.get(`${apiBase}/api/purchase-bill-lookups`, { params: { comp_code: compCode, comp_uid: compUid }, ...reqOpts }),
        axios.get(`${apiBase}/api/master-party-user-permissions`, { params: permParams, ...reqOpts }),
      ]);
      setPerm(pRes.data);
      setMasterPartyPerm(mpRes.data);
      setCtx(cRes.data);
      const defaultPc = String(cRes.data?.G_PLANT_CODE ?? '').trim();
      setLookups({
        parties: lRes.data?.parties || [],
        brokers: lRes.data?.brokers || [],
        items: lRes.data?.items || [],
        plants: lRes.data?.plants || [],
        expenseCodes: lRes.data?.expenseCodes || [],
      });
      if (defaultPc) {
        setPlantCode(defaultPc);
        setLines([emptyLine(defaultPc, rDateYmd)]);
      }
      if (!pRes.data?.canOpen) setErr('Access Denied');
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, compYearLogin, permParams]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  const fetchNextRNo = useCallback(async () => {
    if (!compCode || compUid == null) return;
    const { data } = await axios.get(`${apiBase}/api/purchase-bill-next-r-no`, {
      params: { comp_code: compCode, comp_uid: compUid, type: PU_TYPE, scope: 'company' },
      ...reqOpts,
    });
    const next = data?.next_r_no;
    if (next != null && next !== '') setRNo(String(next));
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    if (loading || mode !== 'new' || postedNew) return;
    void fetchNextRNo().catch((e) => {
      console.warn('purchase-bill-next-r-no:', e?.response?.data?.error || e?.message);
    });
  }, [loading, mode, postedNew, fetchNextRNo]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = () => {
      const narrow = mq.matches;
      setIsCompactMobile(narrow);
      if (narrow) setShowLineDetails(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (loading || listScreenOpen || !perm?.canOpen || didFocusRDateRef.current) return;
    didFocusRDateRef.current = true;
    const t = window.setTimeout(() => {
      const el = rDateInputRef.current;
      if (!el || el.disabled) return;
      try {
        el.focus();
      } catch (_) {}
    }, 80);
    return () => window.clearTimeout(t);
  }, [loading, listScreenOpen, perm?.canOpen]);

  const loadBySlot = useCallback(
    async (targetRNo, dateYmd) => {
      const gen = ++slotGenRef.current;
      const slotOracle = toOracleDate(dateYmd || rDateYmd);
      if (!slotOracle) {
        showNotice('Set R date first.');
        return;
      }
      try {
        const { data } = await axios.get(`${apiBase}/api/purchase-bill-raw`, {
          params: { comp_code: compCode, comp_uid: compUid, type: PU_TYPE, r_date: slotOracle, r_no: targetRNo },
          ...reqOpts,
        });
        if (gen !== slotGenRef.current) return;
        const rows = Array.isArray(data) ? data : [];
        if (rows.length === 0) {
          setRNo(String(targetRNo));
          setMode('new');
          setPostedNew(false);
          setLines([emptyLine(defaultPlantCode || String(plantCode ?? '').trim(), dateYmd || rDateYmd)]);
          showNotice('No purchase bill at this slot — ready for new entry.');
          return;
        }
        const rd = rows[0].R_DATE ?? rows[0].r_date;
        const loadedYmd = toInputDateString(rd) || dateYmd || rDateYmd;
        setRDateYmd(loadedYmd);
        setRNo(String(targetRNo));
        applyRowsFromApi(rows);
        if (can.canEdit) setMode('edit');
        else if (can.canDelete) setMode('delete');
      } catch (e) {
        setErr(e?.response?.data?.error || e.message || 'Load failed');
      }
    },
    [apiBase, compCode, compUid, applyRowsFromApi, can.canEdit, can.canDelete, rDateYmd, showNotice, defaultPlantCode, plantCode]
  );

  const openBillFromList = useCallback(
    async (row) => {
      const rn = String(row?.r_no ?? row?.R_NO ?? '').trim();
      const ymd = toInputDateString(row?.r_date ?? row?.R_DATE);
      if (!rn || !ymd) {
        showNotice('Cannot open bill: missing R no or R date.');
        return;
      }
      setListScreenOpen(false);
      setRDateYmd(ymd);
      setMode('edit');
      await loadBySlot(rn, ymd);
    },
    [loadBySlot, showNotice]
  );

  const stepRNo = (delta) => {
    const cur = Number(String(rNoRef.current).replace(/\D/g, '')) || 0;
    void loadBySlot(Math.max(1, cur + delta));
  };

  const clearForNew = useCallback(() => {
    setCode('');
    setPartySearch('');
    setPartyFinderOpen(true);
    setBkCode('');
    setBrokerSearch('');
    setSupplierBillNo('');
    const docYmd = defaultDocDateInFinYear(fyMinYmd, fyMaxYmd) || rDateYmd;
    setBillDateYmd(docYmd);
    const pc = defaultPlantCode || String(plantCode ?? '').trim();
    setPlantCode(pc);
    setLines([emptyLine(pc, docYmd)]);
    setPostedNew(false);
    void fetchNextRNo();
  }, [fetchNextRNo, defaultPlantCode, plantCode, rDateYmd, fyMinYmd, fyMaxYmd]);

  const fillNtdsOnAmtFromLines = useCallback(() => {
    const sum = lineTotals.amount;
    setNtdsOnAmt(sum);
    setExpNumEdit({ key: 'ntdsOnAmt', text: numToInputDisplay(sum) });
  }, [lineTotals.amount]);

  const handleEnterAsTab = useCallback(
    (e) => {
      if (e.key !== 'Enter') return;
      const t = e.target;
      if (!t) return;
      if (t.closest('.slide-25-purchase-bill-ignore-enter') && t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return;
      if (t.closest('.pb-lines-table tbody')) return;
      if (t.tagName === 'TEXTAREA') return;
      if (t.tagName === 'BUTTON' && (t.type === 'submit' || t.getAttribute('type') === 'submit')) return;
      if (t.tagName === 'INPUT' && (t.type === 'submit' || t.type === 'button')) return;
      commitActiveLineNumEdit(t);
      if (expNumEdit && t.classList.contains('pb-exp-input')) {
        const { key, text } = expNumEdit;
        const raw = sanitizeDecimalTyping(text, 2);
        setExpNumEdit(null);
        const n = parseNumInput(raw);
        const setters = {
          mfeePer: setMfeePer,
          labour: setLabour,
          freight: setFreight,
          addExp: setAddExp,
          lessExp: setLessExp,
          ntdsOnAmt: setNtdsOnAmt,
          ntdsPer: setNtdsPer,
        };
        if (setters[key]) setters[key](n);
      }
      e.preventDefault();
      const root = t.closest('.slide-25-purchase-bill');
      if (root) focusNextInForm(root, t);
    },
    [lineNumEdit, expNumEdit, recalcLine, commitActiveLineNumEdit]
  );

  const handleSave = async (saveMode) => {
    setMsg('');
    setErr('');
    if (!userName) {
      showNotice('User name missing — sign in again.');
      return;
    }
    if (!code) {
      showNotice('Select party.');
      return;
    }
    if (saveMode !== 'delete' && !effectivePlantCode) {
      showNotice('Plant code is required (set plant_code in company setup).');
      return;
    }
    if (saveMode !== 'delete' && effectivePlantCode && !plantCodeValid(effectivePlantCode)) {
      showNotice(`Invalid plant code: ${normalizePlantCode(effectivePlantCode)}.`);
      return;
    }
    if (fyMinYmd && fyMaxYmd && rDateYmd && (rDateYmd < fyMinYmd || rDateYmd > fyMaxYmd)) {
      showNotice(`R date must be between ${toDisplayDate(fyMinYmd)} and ${toDisplayDate(fyMaxYmd)}.`);
      return;
    }
    const validLines = lines.filter((L) => String(L.item_code ?? '').trim());
    if (saveMode !== 'delete' && validLines.length === 0) {
      showNotice('Add at least one line with item.');
      return;
    }
    if (saveMode !== 'delete') {
      const expenseErr = validatePbExpenseCodes({
        mfeeAmt,
        mfeeCode,
        labour,
        labCode,
        freight,
        fgtCode,
        addExp,
        addCode,
        lessExp,
        lessCode,
        ntdsAmt,
        ntdsCode: ctx?.G_NTDS_CODE ?? ctx?.g_ntds_code ?? '',
        expenseAccounts: expenseCodeOptions,
      });
      if (expenseErr) {
        showNotice(expenseErr);
        return;
      }
      for (let i = 0; i < validLines.length; i++) {
        const L = validLines[i];
        const ic = normalizeItemCode(L.item_code);
        if (!itemByCode(ic)) {
          showNotice(`Line ${i + 1}: invalid item code "${ic}". Select a valid item from the list.`);
          return;
        }
        const typedSt = String(L.status ?? '').trim().toUpperCase().slice(0, 1) || 'B';
        if (!PB_STATUS_VALID.has(typedSt)) {
          showNotice(`Line ${i + 1}: status must be B, K, or H.`);
          return;
        }
      }
    }
    try {
      const payload = {
        comp_code: compCode,
        comp_uid: compUid,
        comp_year: compYear || compYearLogin || undefined,
        user_name: userName,
        mode: saveMode,
        type: PU_TYPE,
        r_date: rDateOracle,
        r_no: String(rNo ?? '').trim() || undefined,
        header: {
          code: Number(code),
          bk_code: bkCode ? Number(bkCode) : undefined,
          plant_code: normalizePlantCode(effectivePlantCode),
          bill_date: toOracleDate(billDateYmd) || rDateOracle,
          bill_no: supplierBillNo,
          mfee_per: Number(mfeePer) || 0,
          mfee_amt: clampCharge(mfeeAmt),
          mfee_code: mfeeCode ? Number(mfeeCode) : undefined,
          labour: clampCharge(labour),
          lab_code: labCode ? Number(labCode) : undefined,
          freight: clampCharge(freight),
          fgt_code: fgtCode ? Number(fgtCode) : undefined,
          addexp: clampCharge(addExp),
          add_code: addCode ? Number(addCode) : undefined,
          lessexp: clampCharge(lessExp),
          less_code: lessCode ? Number(lessCode) : undefined,
          ntds_on_amt: Number(ntdsOnAmt) || 0,
          ntds_per: Number(ntdsPer) || 0,
          ntds_amt: Number(ntdsAmt) || 0,
          bill_amt: billAmt,
          truck,
          gr_no: grNo,
          tpt,
        },
        lines: validLines.map((L, i) => ({
          trn_no: i + 1,
          so_no: L.so_no ? Number(String(L.so_no).replace(/\D/g, '')) : undefined,
          item_code: normalizeItemCode(L.item_code),
          p_code: L.p_code ? Number(L.p_code) : undefined,
          qnty: Number(L.qnty) || 0,
          status: normalizePbStatus(L.status),
          g_weight: Number(L.g_weight) || 0,
          dane_wgt: Number(L.dane_wgt) || 0,
          weight: L.weight_manual
            ? roundWeight3(Number(L.weight) || 0)
            : roundWeight3(
                Math.max(0, (Number(L.g_weight) || 0) - (Number(L.dane_wgt) || 0))
              ),
          rate: roundRate2(Number(L.rate) || 0),
          cal: parseCal(L.cal),
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
          stk_weight: Number(L.stk_weight) || 0,
          stk_date: toOracleDate(toInputDateString(L.stk_date)) || rDateOracle,
          plant_code: normalizePlantCode(L.plant_code || effectivePlantCode),
        })),
      };
      const { data } = await axios.post(`${apiBase}/api/purchase-bill-save`, payload, reqOpts);
      if (saveMode === 'delete') {
        setMsg('Purchase bill deleted.');
        setMode('new');
        clearForNew();
      } else {
        setRNo(String(data?.r_no ?? rNo));
        setPostedNew(saveMode === 'add');
        setMode('edit');
        setMsg(saveMode === 'add' ? 'Purchase bill saved.' : 'Purchase bill updated.');
      }
    } catch (e) {
      showError(e?.response?.data?.error || e.message || 'Save failed');
    }
  };

  const openPrint = () => {
    const rn = String(rNo ?? '').trim();
    if (!rn || !rDateOracle) {
      showNotice('Set R date and R no, or save first.');
      return;
    }
    setPrintParams({
      type: PU_TYPE,
      oracleDt: rDateOracle,
      rNo: rn,
      label: `Purchase bill — PU / ${rn} / ${toDisplayDate(rDateYmd)}`,
    });
    setPrintOpen(true);
  };

  const applyBrokerPick = useCallback((pc) => {
    const codeStr = String(pc ?? '').trim();
    setBkCode(codeStr);
    setBrokerSearch('');
    setBrokerBrowseOpen(false);
    focusPbLineSoNo(0);
  }, []);

  const applyPartyPick = useCallback((pc) => {
    setCode(String(pc ?? '').trim());
    setPartyFinderOpen(false);
    setPartyBrowseOpen(false);
    setPartySearch('');
    setPartyHi(0);
    focusAfterPartyPick();
  }, []);

  const tryOpenMasterParty = useCallback(
    (schedule) => {
      if (!masterPartyPerm?.canOpen) {
        alert('Access Denied');
        return;
      }
      if (!masterPartyPerm?.canAdd) {
        alert('You Can Not Add');
        return;
      }
      setMasterPartySchedule(schedule);
      setMasterPartyOpen(true);
    },
    [masterPartyPerm]
  );

  const handleMasterPartyCreated = useCallback(
    (row) => {
      setMasterPartyOpen(false);
      const entry = { CODE: row.CODE ?? row.code, NAME: row.NAME ?? row.name, CITY: row.CITY ?? row.city };
      const pc = String(entry.CODE ?? '').trim();
      if (masterPartySchedule === 11.2) {
        setLookups((prev) => ({ ...prev, brokers: upsertMasterParty(prev.brokers, entry) }));
        setBkCode(pc);
        setBrokerSearch(`[${pc}] ${entry.NAME ?? entry.name}`);
        focusPbLineSoNo(0);
      } else {
        setLookups((prev) => ({ ...prev, parties: upsertMasterParty(prev.parties, entry) }));
        applyPartyPick(pc);
      }
    },
    [applyPartyPick, masterPartySchedule]
  );

  if (loading) {
    return (
      <div className="slide slide-25-purchase-bill slide-25-purchase-bill--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Purchase bill</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
        </div>
      </div>
    );
  }

  if (!perm?.canOpen) {
    return (
      <div className="slide slide-25-purchase-bill">
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access Denied'}</p>
        {perm?.f2 != null && String(perm.f2).trim() !== '' ? (
          <p className="sale-bill-section__hint">F2 rights: {String(perm.f2)}</p>
        ) : null}
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  const showPbNav = !!can.canOpen;
  const pbNavButtons = (
    <>
      <button type="button" className="btn btn-secondary btn-sm" disabled={fieldsDisabled} onClick={() => stepRNo(-1)}>
        ← Prev
      </button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={fieldsDisabled} onClick={() => stepRNo(1)}>
        Next →
      </button>
    </>
  );

  if (listScreenOpen) {
    return (
      <PurchaseBillListScreen
        apiBase={apiBase}
        formData={formData}
        lookups={lookups}
        onClose={() => setListScreenOpen(false)}
        onOpenBill={(row) => void openBillFromList(row)}
      />
    );
  }

  return (
    <div
      className={`slide slide-25-purchase-bill sale-bill-page${isCompactMobile ? ' pb-layout--mobile' : ' sale-entry-desktop'}${isCompactMobile && (partySheetOpen || brokerSheetOpen || itemSheetOpen) ? ' pb-pick-open' : ''}`}
      onKeyDown={(e) => {
        handlePbLineGridKeyDown(e);
        if (e.key === 'Enter' && !isCompactMobile) handleEnterAsTab(e);
      }}
      role="presentation"
    >
      {isCompactMobile ? (
        <SaleEntryScreenHeader
          title="Purchase bill"
          topBar={
            <SaleEntryTopBar
              formData={formData}
              ctx={ctx}
              userName={userName}
              can={can}
              helpReportId="purchase-bill-entry"
            />
          }
          nav={showPbNav ? pbNavButtons : null}
        >
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReset} title="Home">
            Home
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setListScreenOpen(true)}>
            List
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={openPrint}>
            Print
          </button>
        </SaleEntryScreenHeader>
      ) : (
        <SaleEntryTopBar
          formData={formData}
          ctx={ctx}
          userName={userName}
          can={can}
          helpReportId="purchase-bill-entry"
        />
      )}

      <div className={isCompactMobile ? 'pb-mobile-shell' : 'pb-entry-card'}>
      <div className={isCompactMobile ? 'pb-mobile-body' : 'sale-entry-desktop__body'}>
        <section className="sale-bill-section sale-bill-section--card dc-header-card sale-entry-desktop__form pb-header-compact">
          <div className="dc-header-row dc-header-row--top pb-header-compact__row1">
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
            {isCompactMobile ? (
              <div className="pb-header-dates-row">
                <label className="dc-header-field dc-header-field--rdate">
                  <span className="dc-header-k">R date</span>
                  <div className="pb-date-input-wrap">
                    <input
                      ref={rDateInputRef}
                      type="date"
                      className="form-input dc-header-control pb-r-date-input"
                      data-pb-r-date
                      value={rDateYmd}
                      disabled={fieldsDisabled}
                      min={fyMinYmd || undefined}
                      max={fyMaxYmd || undefined}
                      onChange={(e) => setRDateYmd(e.target.value)}
                    />
                  </div>
                </label>
                <label className="dc-header-field dc-header-field--billdt">
                  <span className="dc-header-k">Bill dt</span>
                  <div className="pb-date-input-wrap pb-bill-date-wrap">
                    <input
                      type="date"
                      className="form-input dc-header-control pb-bill-date-input"
                      value={billDateYmd}
                      disabled={fieldsDisabled}
                      min={fyMinYmd || undefined}
                      max={fyMaxYmd || undefined}
                      onChange={(e) => setBillDateYmd(e.target.value)}
                    />
                  </div>
                </label>
              </div>
            ) : (
              <label className="dc-header-field dc-header-field--rdate">
                <span className="dc-header-k">R date</span>
                <input
                  ref={rDateInputRef}
                  type="date"
                  className="form-input dc-header-control pb-r-date-input"
                  data-pb-r-date
                  value={rDateYmd}
                  disabled={fieldsDisabled}
                  min={fyMinYmd || undefined}
                  max={fyMaxYmd || undefined}
                  onChange={(e) => setRDateYmd(e.target.value)}
                />
              </label>
            )}
            <label className="dc-header-field dc-header-field--rno pb-rno-field">
              <span className="dc-header-k">R no</span>
              <div className="pb-rno-nav">
                <button
                  type="button"
                  className="pb-rno-nav__btn"
                  aria-label="Previous bill"
                  disabled={fieldsDisabled}
                  onClick={() => stepRNo(-1)}
                >
                  ‹
                </button>
                <input
                  className="form-input dc-header-control"
                  value={rNo}
                  disabled={fieldsDisabled || mode === 'edit'}
                  onChange={(e) => setRNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
                />
                <button
                  type="button"
                  className="pb-rno-nav__btn"
                  aria-label="Next bill"
                  disabled={fieldsDisabled}
                  onClick={() => stepRNo(1)}
                >
                  ›
                </button>
              </div>
            </label>
            {!isCompactMobile ? (
              <label className="dc-header-field dc-header-field--billdt">
                <span className="dc-header-k">Bill dt</span>
                <input
                  type="date"
                  className="form-input dc-header-control pb-bill-date-input"
                  value={billDateYmd}
                  disabled={fieldsDisabled}
                  min={fyMinYmd || undefined}
                  max={fyMaxYmd || undefined}
                  onChange={(e) => setBillDateYmd(e.target.value)}
                />
              </label>
            ) : null}
            <label className="dc-header-field dc-header-field--bno">
              <span className="dc-header-k">Bill no</span>
              <input
                className="form-input dc-header-control pb-bill-no-input"
                inputMode="numeric"
                maxLength={16}
                value={supplierBillNo}
                disabled={fieldsDisabled}
                placeholder="16 digits"
                onChange={(e) => setSupplierBillNo(parseBillNo16(e.target.value))}
              />
            </label>
            <label className="dc-header-field dc-header-field--plant">
              <span className="dc-header-k">
                Plant <span className="pb-required">*</span>
              </span>
              <select
                className="form-input dc-header-control pb-plant-select"
                value={effectivePlantCode}
                required
                disabled={fieldsDisabled}
                onChange={(e) => setPlantCode(normalizePlantCode(e.target.value))}
              >
                {!effectivePlantCode ? <option value="">Select plant</option> : null}
                {plantOptions.map((pl) => {
                  const pc = String(pl.PLANT_CODE ?? pl.plant_code ?? '');
                  return (
                    <option key={pc} value={pc}>
                      {pc} — {pl.PLANT_NAME ?? pl.plant_name}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>
        </section>

        <section className="sale-bill-section sale-bill-section--card pb-party-section">
          <h3 className="sale-bill-section__title">Party &amp; broker</h3>
          <div className="sale-bill-party-grid">
            <div className="sale-bill-party-col">
              <div className={`sale-bill-field sale-bill-field--block${code ? ' pb-field--complete' : ''}`}>
                <span className="sale-bill-field__label sale-bill-field__label-row" id="pb-party-search-lbl">
                  <span>Party (supplier)</span>
                  <span className="pb-party-toolbar">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm pb-party-help-btn"
                      disabled={fieldsDisabled}
                      title="Party list (F1)"
                      onClick={() => {
                        setPartyFinderOpen(true);
                        setPartyBrowseOpen(true);
                        setPartyHi(0);
                        setPartySearch('');
                        if (isCompactMobile) setPartySheetOpen(true);
                      }}
                    >
                      Help F1
                    </button>
                    <PartyAddButton
                      onClick={() => tryOpenMasterParty(11.1)}
                      disabled={fieldsDisabled}
                      title="Add supplier"
                    />
                  </span>
                </span>
                {code && partyInfo ? (
                  <p className="account-selected-hint sale-bill-search-current" id="pb-party-current">
                    <strong>{partyInfo.NAME ?? partyInfo.name}</strong>{' '}
                    <span className="sale-bill-search-current-code">[{code}]</span>
                    {partyInfo.CITY ?? partyInfo.city ? (
                      <span className="sale-bill-search-current-hint"> — {partyInfo.CITY ?? partyInfo.city}</span>
                    ) : null}
                  </p>
                ) : null}
                {code && partyInfo && !partyFinderOpen ? (
                  <div className="sale-bill-picker-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={fieldsDisabled}
                      onClick={() => {
                        setPartyFinderOpen(true);
                        setPartySearch('');
                      }}
                    >
                      Change party
                    </button>
                  </div>
                ) : null}
                {(!code || partyFinderOpen) ? (
                  <div className="account-search-group">
                    {isCompactMobile ? (
                      <button
                        id="pb-party-search"
                        type="button"
                        className="form-input sale-bill-search-input pb-mobile-search-trigger"
                        disabled={fieldsDisabled}
                        aria-labelledby="pb-party-search-lbl"
                        onClick={() => {
                          setPartyFinderOpen(true);
                          setPartyBrowseOpen(false);
                          setPartySheetOpen(true);
                          setPartyHi(0);
                        }}
                      >
                        {partySearch.trim() || 'Search name, city, or code…'}
                      </button>
                    ) : (
                      <input
                        id="pb-party-search"
                        type="search"
                        className="form-input sale-bill-search-input"
                        autoComplete="off"
                        placeholder="Search name, city, or code…"
                        aria-labelledby="pb-party-search-lbl"
                        value={partySearch}
                        disabled={fieldsDisabled}
                        onChange={(e) => {
                          setPartySearch(e.target.value);
                          setPartyFinderOpen(true);
                          setPartyHi(0);
                          if (!e.target.value.trim()) setCode('');
                        }}
                        onFocus={() => setPartyFinderOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'F1') {
                            e.preventDefault();
                            setPartyFinderOpen(true);
                            setPartyBrowseOpen(true);
                            setPartyHi(0);
                            return;
                          }
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            if (filteredParties.length === 0) return;
                            setPartyHi((h) => Math.min(filteredParties.length - 1, h + 1));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setPartyHi((h) => Math.max(0, h - 1));
                          } else if (e.key === 'Enter' && partySearch.trim() && filteredParties.length > 0) {
                            e.preventDefault();
                            e.stopPropagation();
                            const row = filteredParties[safePartyHi];
                            if (row) {
                              applyPartyPick(String(row.CODE ?? row.code ?? '').trim());
                              setPartySearch('');
                              setPartyFinderOpen(false);
                            }
                          }
                        }}
                      />
                    )}
                    {!isCompactMobile && partyPickVisible ? (
                      <div
                        className="account-search-results pb-party-search-list party-search-results"
                        role="listbox"
                        aria-label="Supplier matches"
                      >
                        {filteredParties.length === 0 ? (
                          <div className="account-search-empty">
                            {partySearch.trim()
                              ? 'No matches — try different letters.'
                              : 'No suppliers in list — check lookups.'}
                          </div>
                        ) : (
                          filteredParties.map((row, index) => {
                            const pc = String(row.CODE ?? row.code ?? '');
                            const rowHi = safePartyHi === index;
                            return (
                              <button
                                key={pc}
                                type="button"
                                role="option"
                                className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                                onMouseEnter={() => setPartyHi(index)}
                                onClick={() => {
                                  applyPartyPick(pc);
                                  setPartyFinderOpen(false);
                                }}
                              >
                                <span className="account-search-code">{pc}</span>
                                <span className="account-search-name">{row.NAME ?? row.name}</span>
                                <span className="account-search-city">{(row.CITY ?? row.city) || '—'}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : !isCompactMobile ? (
                      <p className="sale-bill-section__hint">Type to search or press Help F1 for the party list.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="sale-bill-party-col">
              <div className={`sale-bill-field sale-bill-field--block${bkCode ? ' pb-field--complete' : ''}`}>
                <span className="sale-bill-field__label sale-bill-field__label-row" id="pb-broker-search-lbl">
                  <span>Broker</span>
                  <span className="pb-party-toolbar">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm pb-party-help-btn"
                      disabled={fieldsDisabled}
                      title="Broker list (F1)"
                      onClick={() => {
                        setBrokerBrowseOpen(true);
                        setBrokerSearch('');
                        if (isCompactMobile) setBrokerSheetOpen(true);
                      }}
                    >
                      Help F1
                    </button>
                    <PartyAddButton
                      onClick={() => tryOpenMasterParty(11.2)}
                      disabled={fieldsDisabled}
                      title="Add broker"
                    />
                  </span>
                </span>
                {bkCode && brokerInfo && !brokerBrowseOpen ? (
                  <>
                    <p className="account-selected-hint sale-bill-search-current sale-bill-search-current--no-margin">
                      <strong>{brokerInfo.NAME ?? brokerInfo.name}</strong>{' '}
                      <span className="sale-bill-search-current-code">[{bkCode}]</span>
                    </p>
                    <div className="sale-bill-picker-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm pb-party-help-btn"
                        disabled={fieldsDisabled}
                        onClick={() => {
                          setBrokerBrowseOpen(true);
                          setBrokerSearch('');
                          if (isCompactMobile) setBrokerSheetOpen(true);
                        }}
                      >
                        Help F1
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        data-pb-broker-chg
                        disabled={fieldsDisabled}
                        onClick={() => {
                          setBkCode('');
                          setBrokerSearch('');
                          setBrokerBrowseOpen(false);
                          setBrokerSheetOpen(false);
                          focusAfterPartyPick();
                        }}
                      >
                        Change broker
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="account-search-group">
                    {isCompactMobile ? (
                      <button
                        id="pb-broker-search"
                        type="button"
                        className="form-input sale-bill-search-input pb-mobile-search-trigger"
                        data-pb-broker-search
                        disabled={fieldsDisabled}
                        aria-labelledby="pb-broker-search-lbl"
                        onClick={() => {
                          setBrokerBrowseOpen(false);
                          setBrokerSheetOpen(true);
                        }}
                      >
                        {brokerSearch.trim() || 'Search broker — code or name…'}
                      </button>
                    ) : (
                      <input
                        id="pb-broker-search"
                        type="search"
                        className="form-input sale-bill-search-input"
                        data-pb-broker-search
                        autoComplete="off"
                        placeholder="Search broker — code or name…"
                        aria-labelledby="pb-broker-search-lbl"
                        value={brokerSearch}
                        disabled={fieldsDisabled}
                        onChange={(e) => {
                          setBrokerSearch(e.target.value);
                          if (!e.target.value.trim()) setBkCode('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'F1') {
                            e.preventDefault();
                            setBrokerBrowseOpen(true);
                            return;
                          }
                          if (e.key === 'Enter' && brokerSearch.trim() && filteredBrokers.length > 0) {
                            e.preventDefault();
                            e.stopPropagation();
                            const row = filteredBrokers[0];
                            if (row) {
                              applyBrokerPick(String(row.CODE ?? row.code ?? '').trim());
                              setBrokerSearch('');
                              setBrokerBrowseOpen(false);
                            }
                          }
                        }}
                      />
                    )}
                    {!isCompactMobile && brokerPickVisible ? (
                      <div
                        className="account-search-results pb-party-search-list broker-search-results"
                        role="listbox"
                        aria-label="Broker matches"
                      >
                        {filteredBrokers.length === 0 ? (
                          <div className="account-search-empty">
                            {brokerSearch.trim()
                              ? 'No matches — try different letters.'
                              : 'No brokers in list — check lookups.'}
                          </div>
                        ) : (
                          filteredBrokers.map((p) => {
                            const pc = String(p.CODE ?? p.code ?? '');
                            return (
                              <button
                                key={pc}
                                type="button"
                                role="option"
                                className="account-search-row party-search-row broker-search-row"
                                onClick={() => applyBrokerPick(pc)}
                              >
                                <span className="account-search-code">{pc}</span>
                                <span className="account-search-name">{p.NAME ?? p.name}</span>
                                <span className="account-search-city">{(p.CITY ?? p.city) || '—'}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : !isCompactMobile ? (
                      <p className="sale-bill-section__hint">Type to search or press Help F1 for the broker list.</p>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
          {isCompactMobile ? (
            <PbPartyBrokerPickPortal
              open={partySheetOpen}
              title="Party (supplier)"
              sheet
              showFilter
              autoFocusFilter
              searchValue={partySearch}
              searchPlaceholder="Search name, city, or code…"
              disabled={fieldsDisabled}
              rows={partyPickRows}
              emptyMessage={
                partySearch.trim()
                  ? 'No matches — try different letters.'
                  : partyBrowseOpen
                    ? 'No suppliers in list — check lookups.'
                    : SEARCH_TYPE_HINT
              }
              onSearchChange={(v) => {
                setPartySearch(v);
                setPartyFinderOpen(true);
                setPartyBrowseOpen(false);
                setPartyHi(0);
                if (!v.trim()) setCode('');
              }}
              onClose={() => {
                setPartySheetOpen(false);
                setPartyBrowseOpen(false);
                setPartySearch('');
              }}
              onSelect={(pc) => {
                applyPartyPick(pc);
                setPartyFinderOpen(false);
                setPartySheetOpen(false);
                setPartyBrowseOpen(false);
                setPartySearch('');
              }}
              onFilterKeyDown={(e) => {
                if (e.key === 'F1') {
                  e.preventDefault();
                  setPartyBrowseOpen(true);
                  setPartyHi(0);
                  return;
                }
                if (e.key === 'ArrowDown' && filteredParties.length > 0) {
                  e.preventDefault();
                  setPartyHi((h) => Math.min(filteredParties.length - 1, h + 1));
                } else if (e.key === 'ArrowUp' && filteredParties.length > 0) {
                  e.preventDefault();
                  setPartyHi((h) => Math.max(0, h - 1));
                } else if (e.key === 'Enter' && filteredParties.length > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  const row = filteredParties[safePartyHi];
                  if (row) {
                    applyPartyPick(String(row.CODE ?? row.code ?? '').trim());
                    setPartySheetOpen(false);
                    setPartyBrowseOpen(false);
                    setPartySearch('');
                    setPartyFinderOpen(false);
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setPartySheetOpen(false);
                  setPartyBrowseOpen(false);
                  setPartySearch('');
                }
              }}
            />
          ) : null}
          {isCompactMobile ? (
            <PbPartyBrokerPickPortal
              open={brokerSheetOpen}
              title="Broker"
              sheet
              anchor="bottom"
              showFilter
              autoFocusFilter
              searchValue={brokerSearch}
              searchPlaceholder="Search broker — code or name…"
              disabled={fieldsDisabled}
              rows={brokerPickRows}
              emptyMessage={
                brokerSearch.trim()
                  ? 'No matches — try different letters.'
                  : brokerBrowseOpen
                    ? 'No brokers in list — check lookups.'
                    : SEARCH_TYPE_HINT
              }
              onSearchChange={(v) => {
                setBrokerSearch(v);
                setBrokerBrowseOpen(false);
                if (!v.trim()) setBkCode('');
              }}
              onClose={() => {
                setBrokerSheetOpen(false);
                setBrokerBrowseOpen(false);
                setBrokerSearch('');
              }}
              onSelect={(pc) => {
                applyBrokerPick(pc);
                setBrokerSheetOpen(false);
                setBrokerBrowseOpen(false);
                setBrokerSearch('');
              }}
              onFilterKeyDown={(e) => {
                if (e.key === 'F1') {
                  e.preventDefault();
                  setBrokerBrowseOpen(true);
                  return;
                }
                if (e.key === 'Enter' && filteredBrokers.length > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  const row = filteredBrokers[0];
                  if (row) applyBrokerPick(String(row.CODE ?? row.code ?? '').trim());
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setBrokerSheetOpen(false);
                  setBrokerBrowseOpen(false);
                  setBrokerSearch('');
                }
              }}
            />
          ) : null}
        </section>

        <section className="sale-bill-section sale-bill-section--card dc-lines-section sale-entry-desktop__lines pb-lines-section">
          <h3 className="pb-section-title">Line items</h3>
          <p className="sale-list-hint pb-lines-hint">
            {isCompactMobile
              ? 'Swipe left/right for all columns (Fox order). Pending PO on SO no (F1).'
              : '← → ↑ ↓ to move between cells. Item: click cell or F1 to open search window.'}
          </p>
          <div className="pb-lines-desktop">
          <div
            className="sale-list-scroll-sync sale-list-scroll-sync--top dc-lines-scroll-top"
            ref={dcLinesTopScrollRef}
            aria-hidden="true"
          >
            <div className="sale-list-scroll-sync-inner" ref={dcLinesTopInnerRef} />
          </div>
          <div
            className="sale-bill-lines-wrap dc-lines-wrap table-responsive--sale-list pb-lines-wrap"
            ref={dcLinesGridScrollRef}
            onKeyDown={handlePbLineGridKeyDown}
          >
            <table className="report-table sale-bill-lines-table dc-lines-table pb-lines-table pb-lines-table--fox">
              <colgroup>
                <col className="pb-col--sono" />
                <col className="pb-col--item" />
                <col className="pb-col--name" />
                <col className="pb-col--qty" />
                <col className="pb-col--st" />
                <col className="pb-col--gwgt" />
                <col className="pb-col--dane" />
                <col className="pb-col--wgt" />
                <col className="pb-col--rate" />
                <col className="pb-col--cal" />
                <col className="pb-col--amt" />
                <col className="pb-col--pct" />
                <col className="pb-col--taxamt" />
                <col className="pb-col--pct" />
                <col className="pb-col--taxamt" />
                <col className="pb-col--pct" />
                <col className="pb-col--taxamt" />
                <col className="pb-col--pct" />
                <col className="pb-col--taxamt" />
                <col className="pb-col--pct" />
                <col className="pb-col--taxamt" />
                <col className="pb-col--stkwt" />
                <col className="pb-col--stkdt" />
              </colgroup>
              <thead>
                <tr>
                  <th className="pb-col--sono">SO no</th>
                  <th className="pb-col--item">Item</th>
                  <th className="pb-col--name">Name</th>
                  <th className="num pb-col--qty">Qty</th>
                  <th className="pb-col--st">St</th>
                  <th className="num pb-col--gwgt">G wt</th>
                  <th className="num pb-col--dane">Dane</th>
                  <th className="num pb-col--wgt">Net wt</th>
                  <th className="pb-col--rate">Rate</th>
                  <th className="pb-col--cal">Cal</th>
                  <th className="num pb-col--amt">Amount</th>
                  <th className="pb-col-tax pb-col--pct">Dis%</th>
                  <th className="num pb-col-tax pb-col--taxamt">Dis</th>
                  <th className="pb-col-tax pb-col--pct">CGST%</th>
                  <th className="num pb-col-tax pb-col--taxamt">CGST</th>
                  <th className="pb-col-tax pb-col--pct">SGST%</th>
                  <th className="num pb-col-tax pb-col--taxamt">SGST</th>
                  <th className="pb-col-tax pb-col--pct">IGST%</th>
                  <th className="num pb-col-tax pb-col--taxamt">IGST</th>
                  <th className="num pb-col--stkwt">Stk wt</th>
                  <th className="pb-col--stkdt">Stk date</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((L, idx) => (
                  <tr key={idx} className="pb-line-row">
                    <td className="pb-col-sono">
                      <div className="dc-line-so-cell slide-25-purchase-bill-ignore-enter">
                        <button
                          type="button"
                          className="dc-line-pick-mobile slide-25-purchase-bill-ignore-enter"
                          disabled={!canEditLines}
                          onClick={() => void openSoPick(idx)}
                        >
                          Pick
                        </button>
                        <button
                          type="button"
                          className="dc-line-pick-icon slide-25-purchase-bill-ignore-enter"
                          disabled={!canEditLines}
                          title="Pending purchase order (F1)"
                          aria-label="Pending purchase order"
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
                          className="form-input dc-line-so"
                          data-pb-line-sono={idx}
                          value={L.so_no}
                          disabled={!canEditLines}
                          onChange={(e) => recalcLine(idx, { so_no: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                          onKeyDown={(e) => {
                            if (e.key === 'F1') {
                              e.preventDefault();
                              e.stopPropagation();
                              void openSoPick(idx);
                            }
                          }}
                        />
                      </div>
                    </td>
                    <td className="pb-col--item pb-item-code-cell">
                      <div className="pb-item-code-cell__row">
                        {isCompactMobile ? (
                        <button
                          type="button"
                          className="form-input pb-item-code-input pb-mobile-search-trigger"
                          disabled={!canEditLines}
                          style={{ textTransform: 'uppercase' }}
                          aria-label={`Item line ${idx + 1}`}
                          data-pb-line-item={idx}
                          onClick={() => openItemPick(idx)}
                        >
                          {L.item_code || 'Item…'}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="form-input pb-item-code-input pb-item-code-trigger"
                            disabled={!canEditLines}
                            style={{ textTransform: 'uppercase' }}
                            aria-label={`Item line ${idx + 1}`}
                            data-pb-line-item={idx}
                            title={L.item_name ? `${L.item_code} — ${L.item_name}` : 'Open item search (F1)'}
                            onClick={() => openItemPick(idx)}
                            onKeyDown={(e) => {
                              if (e.key === 'F1') {
                                e.preventDefault();
                                e.stopPropagation();
                                openItemPick(idx);
                                return;
                              }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                if (normalizeItemCode(L.item_code) && itemByCode(L.item_code)) {
                                  focusPbLineQty(idx);
                                } else {
                                  openItemPick(idx);
                                }
                              }
                            }}
                          >
                            {L.item_code || 'Item…'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs pb-item-help-btn slide-25-purchase-bill-ignore-enter"
                            disabled={!canEditLines}
                            title="Item search (F1)"
                            onClick={() => openItemPick(idx)}
                          >
                            F1
                          </button>
                        </>
                      )}
                      </div>
                    </td>
                    <td className="dc-td-readonly pb-td-name pb-col--name" title={L.item_name}>
                      {L.item_name || '—'}
                    </td>
                    <td className="pb-col-qty pb-col--qty">
                      <input
                        className="form-input dc-num pb-qty-input"
                        data-pb-line-qty={idx}
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'qnty', L.qnty, dispNum)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'qnty', L.qnty, dispNum);
                        }}
                        onChange={(e) => setLineNumEdit({ idx, field: 'qnty', text: e.target.value })}
                        onBlur={() => commitPbLineNumEdit(idx, 'qnty')}
                      />
                    </td>
                    <td className="pb-col--st">
                      <input
                        className="form-input dc-line-status pb-status-input"
                        maxLength={1}
                        value={L.status}
                        disabled={!canEditLines}
                        style={{ textTransform: 'uppercase' }}
                        onChange={(e) =>
                          recalcLine(idx, { status: String(e.target.value || '').toUpperCase().slice(0, 1) })
                        }
                        onBlur={(e) => {
                          const typed = String(e.target.value ?? '').trim().toUpperCase().slice(0, 1);
                          if (typed && !PB_STATUS_VALID.has(typed)) {
                            showNotice('Status must be B, K, or H.');
                          }
                          recalcLine(idx, { status: normalizePbStatus(e.target.value) });
                        }}
                      />
                    </td>
                    <td className="num pb-col--gwgt">
                      <input
                        className="form-input dc-num pb-wgt-input pb-gwgt-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'g_weight', L.g_weight, fmtWeightShow3)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'g_weight', L.g_weight, fmtWeightDisp);
                        }}
                        onChange={(e) => {
                          const text = sanitizeDecimalTyping(e.target.value, 3);
                          setLineNumEdit({ idx, field: 'g_weight', text });
                          recalcLine(idx, {
                            g_weight: roundWeight3(parseNumInput(text)),
                            g_weight_manual: true,
                            weight_manual: false,
                          });
                        }}
                        onBlur={(e) => {
                          const raw = sanitizeDecimalTyping(e.target.value, 3);
                          const gwVal = roundWeight3(parseNumInput(raw));
                          setLineNumEdit((cur) =>
                            cur?.idx === idx && cur?.field === 'g_weight' ? null : cur
                          );
                          recalcLine(idx, {
                            g_weight: gwVal,
                            g_weight_manual: true,
                            weight_manual: false,
                          });
                        }}
                      />
                    </td>
                    <td className="pb-col--dane">
                      <input
                        className="form-input dc-num pb-wgt-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'dane_wgt', L.dane_wgt, fmtWeightShow3)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'dane_wgt', L.dane_wgt, fmtWeightDisp);
                        }}
                        onChange={(e) => {
                          const text = sanitizeDecimalTyping(e.target.value, 3);
                          setLineNumEdit({ idx, field: 'dane_wgt', text });
                          recalcLine(idx, {
                            dane_wgt: roundWeight3(parseNumInput(text)),
                            dane_manual: true,
                            weight_manual: false,
                          });
                        }}
                        onBlur={(e) => {
                          const raw = sanitizeDecimalTyping(e.target.value, 3);
                          const daneVal = roundWeight3(parseNumInput(raw));
                          setLineNumEdit((cur) =>
                            cur?.idx === idx && cur?.field === 'dane_wgt' ? null : cur
                          );
                          recalcLine(idx, {
                            dane_wgt: daneVal,
                            dane_manual: true,
                            weight_manual: false,
                          });
                        }}
                      />
                    </td>
                    <td className="pb-col--wgt">
                      <input
                        className="form-input dc-num pb-wgt-input"
                        data-pb-line-wgt={idx}
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbNetWeightCellValue(idx, L, lineNumEdit)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'weight', pbNetWeightForEdit(idx, L, lineNumEdit), fmtWeightDisp);
                        }}
                        onChange={(e) => setLineNumEdit({ idx, field: 'weight', text: e.target.value })}
                        onBlur={() => commitPbLineNumEdit(idx, 'weight')}
                      />
                    </td>
                    <td className="pb-col--rate">
                      <input
                        className="form-input dc-num pb-rate-input"
                        data-pb-line-rate={idx}
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'rate', L.rate, fmtRateShow2)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'rate', L.rate, fmtRateDisp);
                        }}
                        onChange={(e) => setLineNumEdit({ idx, field: 'rate', text: e.target.value })}
                        onBlur={() => commitPbLineNumEdit(idx, 'rate')}
                      />
                    </td>
                    <td className="pb-col--cal">
                      <input
                        className="form-input dc-line-cal pb-cal-input"
                        inputMode="numeric"
                        value={L.cal}
                        disabled={!canEditLines}
                        onChange={(e) => recalcLine(idx, { cal: e.target.value })}
                      />
                    </td>
                    <td className="pb-col--amt">
                      <input
                        className="form-input dc-num pb-amt-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'amount', L.amount, fmtAmtShow2)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'amount', L.amount, fmtAmtShow2);
                        }}
                        onChange={(e) => setLineNumEdit({ idx, field: 'amount', text: e.target.value })}
                        onBlur={() => commitPbLineNumEdit(idx, 'amount')}
                      />
                    </td>
                    <td className="pb-col-tax">
                      <input
                        className="form-input dc-num pb-tax-pct-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'dis_per', L.dis_per, fmtTaxPerShow2)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'dis_per', L.dis_per, fmtTaxPerDisp);
                        }}
                        onChange={(e) =>
                          setLineNumEdit({ idx, field: 'dis_per', text: sanitizeDecimalTyping(e.target.value, 2) })
                        }
                        onBlur={() => commitPbLineNumEdit(idx, 'dis_per')}
                      />
                    </td>
                    <td className="dc-td-readonly num pb-col-taxamt pb-col-tax">{fmtAmt2(L.dis_amt)}</td>
                    <td className="pb-col-tax">
                      <input
                        className="form-input dc-num pb-tax-pct-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'cgst_per', L.cgst_per, fmtTaxPerShow2)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'cgst_per', L.cgst_per, fmtTaxPerDisp);
                        }}
                        onChange={(e) => {
                          const text = sanitizeDecimalTyping(e.target.value, 2);
                          setLineNumEdit({ idx, field: 'cgst_per', text });
                          const v = clampTaxPer(parseNumInput(text));
                          recalcLine(idx, { cgst_per: v, sgst_per: v });
                        }}
                        onBlur={() => commitPbLineNumEdit(idx, 'cgst_per')}
                      />
                    </td>
                    <td className="dc-td-readonly num pb-col-taxamt pb-col-tax">{fmtAmt2(L.cgst_amt)}</td>
                    <td className="pb-col-tax">
                      <input
                        className="form-input dc-num pb-tax-pct-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'sgst_per', L.sgst_per, fmtTaxPerShow2)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'sgst_per', L.sgst_per, fmtTaxPerDisp);
                        }}
                        onChange={(e) =>
                          setLineNumEdit({ idx, field: 'sgst_per', text: sanitizeDecimalTyping(e.target.value, 2) })
                        }
                        onBlur={() => commitPbLineNumEdit(idx, 'sgst_per')}
                      />
                    </td>
                    <td className="dc-td-readonly num pb-col-taxamt pb-col-tax">{fmtAmt2(L.sgst_amt)}</td>
                    <td className="pb-col-tax">
                      <input
                        className="form-input dc-num pb-tax-pct-input"
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'igst_per', L.igst_per, fmtTaxPerShow2)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'igst_per', L.igst_per, fmtTaxPerDisp);
                        }}
                        onChange={(e) =>
                          setLineNumEdit({ idx, field: 'igst_per', text: sanitizeDecimalTyping(e.target.value, 2) })
                        }
                        onBlur={() => commitPbLineNumEdit(idx, 'igst_per')}
                      />
                    </td>
                    <td className="dc-td-readonly num pb-col-taxamt pb-col-tax">{fmtAmt2(L.igst_amt)}</td>
                    <td className="pb-col--stkwt">
                      <input
                        className="form-input dc-num pb-stk-wgt-input"
                        data-pb-line-stkwt={idx}
                        inputMode="decimal"
                        autoComplete="off"
                        value={pbLineNumDisplay(idx, 'stk_weight', L.stk_weight, fmtWeightShow3)}
                        disabled={!canEditLines}
                        onFocus={(e) => {
                          selectAllOnFocus(e);
                          startPbLineNumEdit(idx, 'stk_weight', L.stk_weight, fmtWeightDisp);
                        }}
                        onChange={(e) => setLineNumEdit({ idx, field: 'stk_weight', text: e.target.value })}
                        onBlur={() => commitPbLineNumEdit(idx, 'stk_weight')}
                      />
                    </td>
                    <td className="pb-col--stkdt">
                      <input
                        type="date"
                        className="form-input pb-stk-date-input"
                        value={L.stk_date || rDateYmd}
                        disabled={!canEditLines}
                        min={fyMinYmd || undefined}
                        max={fyMaxYmd || undefined}
                        onChange={(e) => recalcLine(idx, { stk_date: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          {canEditLines ? (
            <button
              type="button"
              className={`btn btn-secondary${isCompactMobile ? ' pb-add-line-btn' : ''}`}
              onClick={() => setLines((p) => [...p, emptyLine(effectivePlantCode, rDateYmd)])}
            >
              {isCompactMobile ? '+ Add line item' : '+ Line'}
            </button>
          ) : null}
        </section>

        {itemFinder != null ? (
          <PbPartyBrokerPickPortal
            open={itemSheetOpen}
            title={`Item — line ${itemFinder.idx + 1}`}
            sheet={isCompactMobile}
            modal={!isCompactMobile}
            anchor="top"
            showFilter
            autoFocusFilter
            searchValue={String(itemFinder?.query ?? '')}
            searchPlaceholder="Type item code or name to search…"
            disabled={!canEditLines}
            rows={itemPickRows}
            emptyMessage={
              String(itemFinder?.query ?? '').trim() ? SEARCH_NO_MATCH : SEARCH_ITEM_TYPE_HINT
            }
            onSearchChange={(v) => {
              setItemFinder((f) => (f == null ? f : { ...f, hi: 0, query: v }));
            }}
            onClose={() => {
              const f = itemFinder;
              setItemSheetOpen(false);
              if (f != null) commitItemFinderPick(f.idx, f.query, f.hi ?? 0);
              else setItemFinder(null);
            }}
            onSelect={(pc) => pickItemForLine(itemFinder.idx, pc)}
            onFilterKeyDown={(e) => {
              if (e.key === 'ArrowDown' && itemFinderMatches.length > 0) {
                e.preventDefault();
                setItemFinder((f) =>
                  f == null
                    ? f
                    : { ...f, hi: Math.min(itemFinderMatches.length - 1, (f.hi ?? 0) + 1) }
                );
              } else if (e.key === 'ArrowUp' && itemFinderMatches.length > 0) {
                e.preventDefault();
                setItemFinder((f) => (f == null ? f : { ...f, hi: Math.max(0, (f.hi ?? 0) - 1) }));
              } else if (e.key === 'Enter' && itemFinderMatches.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                const row = itemFinderMatches[itemFinderSafeHi];
                if (row) {
                  pickItemForLine(
                    itemFinder.idx,
                    normalizeItemCode(row.ITEM_CODE ?? row.item_code)
                  );
                }
              } else if (e.key === 'Enter' && String(itemFinder?.query ?? '').trim()) {
                e.preventDefault();
                e.stopPropagation();
                commitItemFinderPick(itemFinder.idx, itemFinder.query, itemFinder.hi ?? 0);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setItemSheetOpen(false);
                setItemFinder(null);
              }
            }}
          />
        ) : null}

        <section className="pb-expenses-footer sale-bill-section sale-bill-section--card">
          <h3 className="pb-section-title">Expenses &amp; totals</h3>
          {!isCompactMobile ? (
            <p className="sale-bill-section__hint pb-exp-code-hint">
              Expense account codes: type code or name to search, then pick from the list.
            </p>
          ) : null}
          {isCompactMobile ? (
            <div className="pb-mobile-expenses" role="group" aria-label="Totals and expenses">
              <div className="pb-mobile-totals-grid">
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">Quantity</span>
                  <span className="pb-mobile-tile__v">{fmtAmt2(lineTotals.qnty)}</span>
                </div>
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">Weight</span>
                  <span className="pb-mobile-tile__v">{fmtWeight3(lineTotals.weight) || '0.000'}</span>
                </div>
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">Amount</span>
                  <span className="pb-mobile-tile__v">{fmtRs(lineTotals.amount)}</span>
                </div>
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">Discount</span>
                  <span className="pb-mobile-tile__v">{fmtRs(lineTotals.dis)}</span>
                </div>
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">CGST</span>
                  <span className="pb-mobile-tile__v">{fmtRs(lineTotals.cg)}</span>
                </div>
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">SGST</span>
                  <span className="pb-mobile-tile__v">{fmtRs(lineTotals.sg)}</span>
                </div>
                <div className="pb-mobile-tile">
                  <span className="pb-mobile-tile__k">IGST</span>
                  <span className="pb-mobile-tile__v">{fmtRs(lineTotals.ig)}</span>
                </div>
                <div className="pb-mobile-tile pb-mobile-tile--emph">
                  <span className="pb-mobile-tile__k">Net amount</span>
                  <span className="pb-mobile-tile__v">{fmtRs(billAmt)}</span>
                </div>
              </div>
              <details className="pb-mobile-panel">
                <summary>Additional charges</summary>
                <div className="pb-mobile-panel__body">
                  <label className="pb-mobile-field">
                    <span>Market fee %</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('mfeePer', mfeePer)}
                      disabled={fieldsDisabled}
                      onFocus={() => startExpNumEdit('mfeePer', mfeePer)}
                      onChange={(e) => setExpNumEdit({ key: 'mfeePer', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('mfeePer', setMfeePer)}
                    />
                  </label>
                  <label className="pb-mobile-field">
                    <span>Market fee amt</span>
                    <input className="form-input" value={fmtAmt2(mfeeAmt)} readOnly tabIndex={-1} />
                  </label>
                  <PbAccountCodePicker
                    title="Market fee code"
                    isMobile={isCompactMobile}
                    value={mfeeCode}
                    onChange={setMfeeCode}
                    accounts={expenseCodeOptions}
                    disabled={fieldsDisabled || clampCharge(mfeeAmt) === 0}
                    className="pb-mobile-acct-picker"
                  />
                  <label className="pb-mobile-field">
                    <span>Labour</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('labour', labour)}
                      disabled={fieldsDisabled}
                      onFocus={() => startExpNumEdit('labour', labour)}
                      onChange={(e) => setExpNumEdit({ key: 'labour', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('labour', setLabour)}
                    />
                  </label>
                  <PbAccountCodePicker
                    title="Labour code"
                    isMobile={isCompactMobile}
                    value={labCode}
                    onChange={setLabCode}
                    accounts={expenseCodeOptions}
                    disabled={fieldsDisabled || clampCharge(labour) === 0}
                    className="pb-mobile-acct-picker"
                  />
                  <label className="pb-mobile-field">
                    <span>Freight</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('freight', freight)}
                      disabled={fieldsDisabled}
                      onFocus={() => startExpNumEdit('freight', freight)}
                      onChange={(e) => setExpNumEdit({ key: 'freight', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('freight', setFreight)}
                    />
                  </label>
                  <PbAccountCodePicker
                    title="Freight code"
                    isMobile={isCompactMobile}
                    value={fgtCode}
                    onChange={setFgtCode}
                    accounts={expenseCodeOptions}
                    disabled={fieldsDisabled || clampCharge(freight) === 0}
                    className="pb-mobile-acct-picker"
                  />
                  <label className="pb-mobile-field">
                    <span>Add exp</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('addExp', addExp)}
                      disabled={fieldsDisabled}
                      onFocus={() => startExpNumEdit('addExp', addExp)}
                      onChange={(e) => setExpNumEdit({ key: 'addExp', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('addExp', setAddExp)}
                    />
                  </label>
                  <div className="pb-mobile-field">
                    <span>Add code</span>
                    <PbAccountCodePicker
                      title="Add code"
                      isMobile={isCompactMobile}
                      value={addCode}
                      onChange={setAddCode}
                      accounts={expenseCodeOptions}
                      disabled={fieldsDisabled || clampCharge(addExp) === 0}
                      className="pb-mobile-acct-picker"
                    />
                  </div>
                  <label className="pb-mobile-field">
                    <span>Less exp</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('lessExp', lessExp)}
                      disabled={fieldsDisabled}
                      onFocus={() => startExpNumEdit('lessExp', lessExp)}
                      onChange={(e) => setExpNumEdit({ key: 'lessExp', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('lessExp', setLessExp)}
                    />
                  </label>
                  <div className="pb-mobile-field">
                    <span>Less code</span>
                    <PbAccountCodePicker
                      title="Less code"
                      isMobile={isCompactMobile}
                      value={lessCode}
                      onChange={setLessCode}
                      accounts={expenseCodeOptions}
                      disabled={fieldsDisabled || clampCharge(lessExp) === 0}
                      className="pb-mobile-acct-picker"
                    />
                  </div>
                </div>
              </details>
              <details className="pb-mobile-panel">
                <summary>TDS &amp; transport</summary>
                <div className="pb-mobile-panel__body">
                  <label className="pb-mobile-field">
                    <span>TDS on amt</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('ntdsOnAmt', ntdsOnAmt)}
                      disabled={fieldsDisabled}
                      onFocus={() => fillNtdsOnAmtFromLines()}
                      onChange={(e) => setExpNumEdit({ key: 'ntdsOnAmt', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('ntdsOnAmt', setNtdsOnAmt)}
                    />
                  </label>
                  <label className="pb-mobile-field">
                    <span>TDS %</span>
                    <input
                      className="form-input"
                      inputMode="decimal"
                      value={expNumDisplay('ntdsPer', ntdsPer)}
                      disabled={fieldsDisabled}
                      onFocus={() => startExpNumEdit('ntdsPer', ntdsPer)}
                      onChange={(e) => setExpNumEdit({ key: 'ntdsPer', text: e.target.value })}
                      onBlur={() => commitExpNumEdit('ntdsPer', setNtdsPer)}
                    />
                  </label>
                  <label className="pb-mobile-field">
                    <span>TDS amt</span>
                    <input className="form-input" value={fmtAmt2(ntdsAmt)} readOnly tabIndex={-1} />
                  </label>
                  <label className="pb-mobile-field">
                    <span>Truck no</span>
                    <input className="form-input" value={truck} disabled={fieldsDisabled} onChange={(e) => setTruck(e.target.value)} />
                  </label>
                  <label className="pb-mobile-field">
                    <span>GR no</span>
                    <input className="form-input" value={grNo} disabled={fieldsDisabled} onChange={(e) => setGrNo(e.target.value)} />
                  </label>
                  <label className="pb-mobile-field">
                    <span>Transport</span>
                    <input className="form-input" value={tpt} disabled={fieldsDisabled} onChange={(e) => setTpt(e.target.value)} />
                  </label>
                </div>
              </details>
              <div className="pb-mobile-payable">
                <span className="pb-mobile-payable__k">Net payable</span>
                <span className="pb-mobile-payable__v">{fmtRs(netPayable)}</span>
              </div>
            </div>
          ) : null}
          <div
            className={isCompactMobile ? 'pb-summary-frame pb-expenses-desktop--hidden' : 'pb-summary-frame'}
            role="group"
            aria-label="Totals and expenses"
          >
            <div className="pb-frame-row pb-frame-row--2">
              <div className="pb-frame-cell">
                <span className="pb-frame-cell__k">Total Qty.</span>
                <span className="pb-frame-cell__ro">{fmtAmt2(lineTotals.qnty)}</span>
              </div>
              <div className="pb-frame-cell">
                <span className="pb-frame-cell__k">Weight</span>
                <span className="pb-frame-cell__ro">{fmtWeight3(lineTotals.weight) || '0.000'}</span>
              </div>
            </div>
            <div className="pb-frame-row">
              <span className="pb-frame-cell__k">Total Amount</span>
              <span className="pb-frame-cell__ro">{fmtAmt2(lineTotals.amount)}</span>
            </div>
            <div className="pb-frame-row">
              <span className="pb-frame-cell__k">Discount</span>
              <span className="pb-frame-cell__ro">{fmtAmt2(lineTotals.dis)}</span>
            </div>
            <div className="pb-frame-row">
              <span className="pb-frame-cell__k">Cgst</span>
              <span className="pb-frame-cell__ro">{fmtAmt2(lineTotals.cg)}</span>
            </div>
            <div className="pb-frame-row">
              <span className="pb-frame-cell__k">Sgst</span>
              <span className="pb-frame-cell__ro">{fmtAmt2(lineTotals.sg)}</span>
            </div>
            <div className="pb-frame-row">
              <span className="pb-frame-cell__k">Igst</span>
              <span className="pb-frame-cell__ro">{fmtAmt2(lineTotals.ig)}</span>
            </div>
            <div className="pb-frame-row pb-frame-row--4">
              <span className="pb-frame-cell__k">Market Fee</span>
              <input
                className="form-input pb-frame-input pb-frame-input--pct"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('mfeePer', mfeePer)}
                disabled={fieldsDisabled}
                onFocus={() => startExpNumEdit('mfeePer', mfeePer)}
                onChange={(e) => setExpNumEdit({ key: 'mfeePer', text: e.target.value })}
                onBlur={() => commitExpNumEdit('mfeePer', setMfeePer)}
              />
              <input className="form-input pb-frame-input pb-input-readonly" value={fmtAmt2(mfeeAmt)} readOnly tabIndex={-1} />
              <PbAccountCodePicker
                value={mfeeCode}
                onChange={setMfeeCode}
                accounts={expenseCodeOptions}
                disabled={fieldsDisabled || clampCharge(mfeeAmt) === 0}
              />
            </div>
            <div className="pb-frame-row pb-frame-row--3">
              <span className="pb-frame-cell__k">Labour</span>
              <input
                className="form-input pb-frame-input"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('labour', labour)}
                disabled={fieldsDisabled}
                onFocus={() => startExpNumEdit('labour', labour)}
                onChange={(e) => setExpNumEdit({ key: 'labour', text: e.target.value })}
                onBlur={() => commitExpNumEdit('labour', setLabour)}
              />
              <PbAccountCodePicker
                value={labCode}
                onChange={setLabCode}
                accounts={expenseCodeOptions}
                disabled={fieldsDisabled || clampCharge(labour) === 0}
              />
            </div>
            <div className="pb-frame-row pb-frame-row--3">
              <span className="pb-frame-cell__k">Freight</span>
              <input
                className="form-input pb-frame-input"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('freight', freight)}
                disabled={fieldsDisabled}
                onFocus={() => startExpNumEdit('freight', freight)}
                onChange={(e) => setExpNumEdit({ key: 'freight', text: e.target.value })}
                onBlur={() => commitExpNumEdit('freight', setFreight)}
              />
              <PbAccountCodePicker
                value={fgtCode}
                onChange={setFgtCode}
                accounts={expenseCodeOptions}
                disabled={fieldsDisabled || clampCharge(freight) === 0}
              />
            </div>
            <div className="pb-frame-row pb-frame-row--3">
              <span className="pb-frame-cell__k">AddExp</span>
              <input
                className="form-input pb-frame-input"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('addExp', addExp)}
                disabled={fieldsDisabled}
                onFocus={() => startExpNumEdit('addExp', addExp)}
                onChange={(e) => setExpNumEdit({ key: 'addExp', text: e.target.value })}
                onBlur={() => commitExpNumEdit('addExp', setAddExp)}
              />
              <PbAccountCodePicker
                value={addCode}
                onChange={setAddCode}
                accounts={expenseCodeOptions}
                disabled={fieldsDisabled || clampCharge(addExp) === 0}
              />
            </div>
            <div className="pb-frame-row pb-frame-row--3">
              <span className="pb-frame-cell__k">LessExp</span>
              <input
                className="form-input pb-frame-input"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('lessExp', lessExp)}
                disabled={fieldsDisabled}
                onFocus={() => startExpNumEdit('lessExp', lessExp)}
                onChange={(e) => setExpNumEdit({ key: 'lessExp', text: e.target.value })}
                onBlur={() => commitExpNumEdit('lessExp', setLessExp)}
              />
              <PbAccountCodePicker
                value={lessCode}
                onChange={setLessCode}
                accounts={expenseCodeOptions}
                disabled={fieldsDisabled || clampCharge(lessExp) === 0}
              />
            </div>
            <div className="pb-frame-row pb-frame-row--emph">
              <span className="pb-frame-cell__k">Net Amount</span>
              <span className="pb-frame-cell__ro pb-frame-cell__ro--bold">{fmtAmt2(billAmt)}</span>
            </div>
            <div className="pb-frame-row pb-frame-row--5">
              <span className="pb-frame-cell__k">Tds</span>
              <input
                className="form-input pb-frame-input"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('ntdsOnAmt', ntdsOnAmt)}
                disabled={fieldsDisabled}
                onFocus={() => fillNtdsOnAmtFromLines()}
                onChange={(e) => setExpNumEdit({ key: 'ntdsOnAmt', text: e.target.value })}
                onBlur={() => commitExpNumEdit('ntdsOnAmt', setNtdsOnAmt)}
              />
              <input
                className="form-input pb-frame-input pb-frame-input--pct"
                inputMode="decimal"
                autoComplete="off"
                value={expNumDisplay('ntdsPer', ntdsPer)}
                disabled={fieldsDisabled}
                onFocus={() => startExpNumEdit('ntdsPer', ntdsPer)}
                onChange={(e) => setExpNumEdit({ key: 'ntdsPer', text: e.target.value })}
                onBlur={() => commitExpNumEdit('ntdsPer', setNtdsPer)}
              />
              <input className="form-input pb-frame-input pb-input-readonly" value={fmtAmt2(ntdsAmt)} readOnly tabIndex={-1} />
              <input
                className="form-input pb-frame-input pb-frame-input--code pb-input-readonly"
                value={String(ctx?.G_NTDS_CODE ?? '')}
                readOnly
                tabIndex={-1}
              />
            </div>
            <div className="pb-frame-row pb-frame-row--pay">
              <span className="pb-frame-cell__k">Net payable</span>
              <span className="pb-frame-cell__ro pb-frame-cell__ro--pay">{fmtRs(netPayable)}</span>
            </div>
            <div className="pb-frame-row pb-frame-row--3 pb-frame-row--transport">
              <div className="pb-frame-cell">
                <span className="pb-frame-cell__k">Truck No.</span>
                <input className="form-input pb-frame-input" value={truck} disabled={fieldsDisabled} onChange={(e) => setTruck(e.target.value)} />
              </div>
              <div className="pb-frame-cell">
                <span className="pb-frame-cell__k">Gr.No</span>
                <input className="form-input pb-frame-input" value={grNo} disabled={fieldsDisabled} onChange={(e) => setGrNo(e.target.value)} />
              </div>
              <div className="pb-frame-cell">
                <span className="pb-frame-cell__k">Tpt</span>
                <input className="form-input pb-frame-input" value={tpt} disabled={fieldsDisabled} onChange={(e) => setTpt(e.target.value)} />
              </div>
            </div>
          </div>
        </section>

      </div>

      {isCompactMobile ? (
      <footer className="pb-sticky-footer" role="contentinfo">
        <div className="pb-sticky-footer__hero">
          <button
            type="button"
            className="pb-sticky-footer__breakdown-btn"
            onClick={() => setShowFooterBreakdown((v) => !v)}
            aria-expanded={showFooterBreakdown}
          >
            {showFooterBreakdown ? '▲' : '▼'} Details
          </button>
          <div className="pb-sticky-footer__hero-text">
            <span className="pb-sticky-footer__hero-k">Net payable</span>
            <span className="pb-sticky-footer__hero-v">{fmtRs(netPayable)}</span>
            <span className="pb-sticky-footer__hero-sub">Net amount {fmtRs(billAmt)}</span>
          </div>
          {showFooterBreakdown ? (
            <div className="pb-sticky-footer__breakdown" role="region" aria-label="Amount breakdown">
              <span>Lines {fmtRs(lineTotals.amount)}</span>
              <span>− Dis {fmtRs(lineTotals.dis)}</span>
              <span>+ Tax {fmtRs(lineTotals.cg + lineTotals.sg + lineTotals.ig)}</span>
              <span>− TDS {fmtRs(ntdsAmt)}</span>
            </div>
          ) : null}
        </div>
        <div className="pb-sticky-footer__actions">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            Back
          </button>
          {mode === 'delete' && can.canDelete ? (
            <button type="button" className="btn btn-danger" onClick={() => void handleSave('delete')}>
              Delete
            </button>
          ) : null}
          {mode === 'new' && can.canAdd ? (
            <button type="button" className="btn btn-primary" onClick={() => void handleSave('add')}>
              Save bill
            </button>
          ) : null}
          {mode === 'edit' && can.canEdit ? (
            <button type="button" className="btn btn-primary" onClick={() => void handleSave('edit')}>
              Update
            </button>
          ) : null}
        </div>
      </footer>
      ) : null}

      </div>

      {!isCompactMobile
        ? createPortal(
            <footer className="pb-desktop-footer-bar pb-desktop-footer-bar--portal" role="contentinfo">
              <div className="pb-desktop-footer-payable">
                <span className="pb-desktop-footer-payable__label">Net payable</span>
                <span className="pb-desktop-footer-payable__value">{fmtRs(netPayable)}</span>
                <span className="pb-desktop-footer-payable__sub">Net amount {fmtRs(billAmt)}</span>
              </div>
              <div className="pb-desktop-footer-actions">
                <div className="pb-desktop-footer-group">
                  <button type="button" className="pb-desktop-action-btn pb-desktop-action-btn--nav" onClick={onPrev}>
                    ← Back
                  </button>
                  <button type="button" className="pb-desktop-action-btn pb-desktop-action-btn--nav" onClick={onReset}>
                    Home
                  </button>
                  <button
                    type="button"
                    className="pb-desktop-action-btn pb-desktop-action-btn--nav"
                    onClick={() => setListScreenOpen(true)}
                  >
                    List
                  </button>
                  <button type="button" className="pb-desktop-action-btn pb-desktop-action-btn--nav" onClick={openPrint}>
                    Print
                  </button>
                </div>
                {showPbNav ? (
                  <div className="pb-desktop-footer-group pb-desktop-footer-group--rno">
                    <button
                      type="button"
                      className="pb-desktop-action-btn pb-desktop-action-btn--nav"
                      disabled={fieldsDisabled}
                      onClick={() => stepRNo(-1)}
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      className="pb-desktop-action-btn pb-desktop-action-btn--nav"
                      disabled={fieldsDisabled}
                      onClick={() => stepRNo(1)}
                    >
                      Next →
                    </button>
                  </div>
                ) : null}
                <div className="pb-desktop-footer-group pb-desktop-footer-group--crud">
                  {mode === 'delete' && can.canDelete ? (
                    <button type="button" className="pb-desktop-action-btn pb-desktop-action-btn--delete" onClick={() => void handleSave('delete')}>
                      Delete
                    </button>
                  ) : null}
                  {mode === 'new' && can.canAdd ? (
                    <button type="button" className="pb-desktop-action-btn pb-desktop-action-btn--save" onClick={() => void handleSave('add')}>
                      Save bill
                    </button>
                  ) : null}
                  {mode === 'edit' && can.canEdit ? (
                    <button type="button" className="pb-desktop-action-btn pb-desktop-action-btn--save" onClick={() => void handleSave('edit')}>
                      Update
                    </button>
                  ) : null}
                </div>
              </div>
            </footer>,
            document.body
          )
        : null}

      <MasterPartyCreateModal
        open={masterPartyOpen}
        onClose={() => setMasterPartyOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        userName={userName}
        defaultSchedule={masterPartySchedule}
        onCreated={handleMasterPartyCreated}
      />

      <PbSoPickModal
        open={soPick.open}
        isMobile={isCompactMobile}
        title="Pending purchase orders"
        hint={
          soPick.poBroker === 'B'
            ? `VFP: SORDER.CODE = broker [${bkCode || '—'}]; PURCHASE.BK_CODE = broker (PO_CODE_BROKER = B).`
            : `VFP: SORDER.CODE = party [${code || '—'}]; PURCHASE.CODE = party (PO_CODE_BROKER = C).`
        }
        emptyMessage={
          soPick.diag?.mcode != null
            ? `No pending PO — comp ${soPick.diag.comp_code ?? compCode}, mcode ${soPick.diag.mcode}, SORDER ${soPick.diag.x1_rows ?? 0} row(s), result ${soPick.diag.result_count ?? 0}. Restart API if this looks wrong.`
            : soPick.diag?.reason === 'missing_mcode'
              ? `Select ${soPick.poBroker === 'B' ? 'broker' : 'party'} before F1 (PO_CODE_BROKER = ${soPick.poBroker || 'C'}).`
              : 'No pending purchase orders — restart Node server, then check party/broker and PO_CODE_BROKER (VFP F1).'
        }
        loading={soPick.loading}
        rows={soPick.rows}
        columns={soPickColumns}
        hi={soPick.hi}
        onHi={(n) => setSoPick((p) => ({ ...p, hi: n }))}
        onClose={() => setSoPick((p) => ({ ...p, open: false }))}
        onPick={(row) => applySoPick(soPick.lineIdx, row)}
      />

      <PurchaseBillPrintModal
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        billParams={printParams}
        companyName={formData.comp_name ?? formData.COMP_NAME ?? ''}
      />

      {msg || err
        ? createPortal(
            <div
              className="sale-bill-save-toast-overlay slide-25-purchase-bill-ignore-enter"
              role="presentation"
              onClick={() => {
                setMsg('');
                setErr('');
              }}
            >
              <div
                className="sale-bill-save-toast-card"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="pb-save-toast-title"
                onClick={(e) => e.stopPropagation()}
              >
                <p
                  id="pb-save-toast-title"
                  className={`sale-bill-save-toast-text${err ? ' sale-bill-save-toast-text--err' : ''}`}
                >
                  {msg || err}
                </p>
                <button
                  type="button"
                  className="btn btn-primary sale-bill-save-toast-ok"
                  onClick={() => {
                    setMsg('');
                    setErr('');
                  }}
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
