import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import MasterPartyCreateModal, { PartyAddButton } from '../components/MasterPartyCreateModal';
import MasterPartyPickList from '../components/MasterPartyPickList';
import SaleEntryScreenHeader from '../components/SaleEntryScreenHeader';
import SaleEntryTopBar from '../components/SaleEntryTopBar';
import SessionInfoLine from '../components/SessionInfoLine';
import VoucherPendingBillsModal from '../components/VoucherPendingBillsModal';
import VoucherEntryListScreen from '../components/VoucherEntryListScreen';
import {
  clampYmdToFinYear,
  defaultDocDateInFinYear,
  resolveSaleEntryFinYear,
} from '../utils/saleEntryFinYear';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import '../voucherEntry.css';

const reqOpts = { withCredentials: true, timeout: 120000 };

function fmtAmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

function parseAmt(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
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

function focusNextInForm(rootEl, currentEl) {
  if (!rootEl || !currentEl) return;
  const list = Array.from(
    rootEl.querySelectorAll(
      'input:not([type="hidden"]):not([type="button"]):not([type="radio"]):not([type="checkbox"]), select, textarea, button.master-party-pick__trigger:not([disabled])'
    )
  ).filter((el) => !el.disabled && el.getAttribute('tabindex') !== '-1');
  const i = list.indexOf(currentEl);
  if (i >= 0 && i < list.length - 1) {
    const next = list[i + 1];
    next.focus();
    if (typeof next.select === 'function' && next.tagName === 'INPUT') {
      try {
        next.select();
      } catch (_) {}
    }
  }
}

function focusFirstGridPartyCode(rootEl) {
  const root = rootEl || document.querySelector('.slide-28-voucher-entry');
  const trigger = root?.querySelector('[data-mp-field="voucher-line-code-0"] .master-party-pick__trigger');
  trigger?.focus();
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
  if (root) focusNextInForm(root, t);
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
    return hit ? hit.NAME ?? hit.name : '';
  }, [dcAccounts, dcCode]);

  const lineTotals = useMemo(() => {
    let dr = 0;
    let cr = 0;
    for (const l of lines) {
      dr += parseAmt(l.dr_amt);
      cr += parseAmt(l.cr_amt);
    }
    return { dr, cr };
  }, [lines]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [pRes, cRes, lRes] = await Promise.all([
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
      ]);
      setCan(pRes.data);
      setCtx(cRes.data);
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
      setMode('edit');
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
        cd_amt: line.cd_amt || '',
        cd_per: line.cd_per || '',
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
    if (saveMode === 'delete') {
      if (!window.confirm('Delete this voucher from VOUCHER, LEDGER, and BILLS?')) return;
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

  const screenActions = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onPrev}>
        ← Back
      </button>
      <button type="button" className="btn btn-secondary" onClick={onReset}>
        Home
      </button>
      <button type="button" className="btn btn-secondary" onClick={resetNew}>
        New
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setListScreenOpen(true)}>
        List
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => void loadVoucher()}>
        Load
      </button>
      {mode === 'new' && can?.canAdd ? (
        <button type="button" className="btn btn-primary" onClick={() => void handleSave('add')}>
          Save
        </button>
      ) : null}
      {mode === 'edit' && can?.canEdit ? (
        <button type="button" className="btn btn-primary" onClick={() => void handleSave('edit')}>
          Update
        </button>
      ) : null}
      {mode === 'edit' && can?.canDelete ? (
        <button type="button" className="btn btn-danger" onClick={() => void handleSave('delete')}>
          Delete
        </button>
      ) : null}
    </>
  );

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
      onKeyDown={handleEnterAsTab}
      role="presentation"
    >
      <SaleEntryScreenHeader
        title="Cash / Bank / Journal entry"
        reportId="voucher-entry"
        topBar={<SaleEntryTopBar formData={formData} ctx={ctx} userName={userName} can={can} />}
        nav={null}
      >
        {screenActions}
      </SaleEntryScreenHeader>

      <SessionInfoLine formData={formData} userName={userName} />
      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className="voucher-entry-header">
        <div className="voucher-entry-header__types">
          <span className="voucher-entry-label">Voucher type</span>
          {['CV', 'BV', 'JV'].map((t) => (
            <label key={t} className="voucher-entry-radio">
              <input
                type="radio"
                name="vrType"
                checked={vrType === t}
                onChange={() => changeVrType(t)}
              />
              {t === 'CV' ? 'Cash' : t === 'BV' ? 'Bank' : 'Journal'}
            </label>
          ))}
        </div>

        <div className="voucher-entry-header__grid">
          <label className="voucher-entry-field">
            <span>Voucher date</span>
            <input
              ref={vrDateRef}
              className="form-input"
              type="date"
              value={vrDate}
              onChange={(e) => setVrDateAndSync(e.target.value)}
            />
          </label>
          {vrType === 'CV' ? (
            <label className="voucher-entry-field">
              <span>Type (R/N)</span>
              <select className="form-input" value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="N">N — Normal</option>
                <option value="R">R — Receipt control</option>
              </select>
            </label>
          ) : null}
          <label className="voucher-entry-field">
            <span>Voucher no.</span>
            <input
              className="form-input"
              value={vrNo}
              onChange={(e) => setVrNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
          {vrType !== 'JV' ? (
            <label className="voucher-entry-field voucher-entry-field--wide">
              <span>{vrType === 'CV' ? 'Cash' : 'Bank'} code</span>
              <MasterPartyPickList
                options={dcAccounts}
                value={dcCode}
                title={vrType === 'CV' ? 'Cash account' : 'Bank account'}
                placeholder="Select account"
                filterPlaceholder="Search…"
                dataMpField="voucher-dc-code"
                openOnFocus
                getValue={(a) => String(a.CODE ?? a.code ?? '')}
                getLabel={acctLabel}
                onChange={setDcCode}
                onAfterSelect={() => focusFirstGridPartyCode(slideRootRef.current)}
              />
              {dcName ? <small className="voucher-entry-hint">{dcName}</small> : null}
            </label>
          ) : null}
        </div>

        {(cdVrNo || intVrNo) ? (
          <div className="voucher-entry-transfer-readonly">
            {cdVrNo ? (
              <span>
                Cd JV: {cdVrType} {toDisplayDate(cdVrDate)} #{cdVrNo}
              </span>
            ) : null}
            {intVrNo ? (
              <span>
                Int JV: {intVrType} {toDisplayDate(intVrDate)} #{intVrNo}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="voucher-entry-lines-wrap">
        <table className="voucher-entry-lines">
          <colgroup>
            <col className="voucher-col-sno" />
            <col className="voucher-col-code" />
            <col className="voucher-col-name" />
            <col className="voucher-col-sched" />
            <col className="voucher-col-vdate" />
            <col className="voucher-col-chq" />
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
          <thead>
            <tr>
              <th>Sno</th>
              <th>Code</th>
              <th>Name</th>
              <th>Sched</th>
              <th>Value dt</th>
              <th>Chq</th>
              <th>Particulars</th>
              <th>Bill dt</th>
              <th>Bill no</th>
              <th>Btype</th>
              <th className="voucher-col-bills-help-th" aria-label="Pending bills" />
              <th>Dr</th>
              <th>Cr</th>
              <th>Int</th>
              <th>Cd</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => (
              <tr
                key={idx}
                className={activeLine === idx ? 'is-active' : ''}
                onClick={() => setActiveLine(idx)}
              >
                <td>{idx + 1}</td>
                <td className="voucher-entry-code-cell">
                  <MasterPartyPickList
                    options={lookups.parties}
                    value={line.code}
                    title="Party"
                    placeholder="Code"
                    filterPlaceholder="Search party…"
                    dataMpField={`voucher-line-code-${idx}`}
                    openOnFocus={idx === 0}
                    getValue={(p) => String(p.CODE ?? p.code ?? '')}
                    getLabel={partyLabel}
                    onChange={(c) => pickParty(idx, c)}
                  />
                  <PartyAddButton onClick={() => setPartyAddOpen(true)} title="Add party" />
                </td>
                <td>{line.name}</td>
                <td>{line.schedule}</td>
                <td>
                  <input
                    className="form-input voucher-entry-vdate"
                    type="date"
                    value={line.v_date || vrDate}
                    onChange={(e) => updateLine(idx, { v_date: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-mini"
                    maxLength={8}
                    value={line.chq_no}
                    onChange={(e) => updateLine(idx, { chq_no: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-detail"
                    value={line.detail}
                    onChange={(e) => updateLine(idx, { detail: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-mini"
                    type="date"
                    value={line.bill_date}
                    onChange={(e) => updateLine(idx, { bill_date: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-mini"
                    value={line.bill_no}
                    onChange={(e) => updateLine(idx, { bill_no: e.target.value.replace(/\D/g, '') })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-btype"
                    maxLength={1}
                    value={line.b_type}
                    onChange={(e) => updateLine(idx, { b_type: e.target.value.toUpperCase().slice(0, 1) })}
                  />
                </td>
                <td className="voucher-entry-bills-help">
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs voucher-entry-bills-btn"
                    title="Pending bills (F1)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveLine(idx);
                      setPendingOpen(true);
                    }}
                  >
                    ?
                  </button>
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-amt"
                    value={line.dr_amt}
                    onChange={(e) => updateLine(idx, { dr_amt: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-amt"
                    value={line.cr_amt}
                    onChange={(e) => updateLine(idx, { cr_amt: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-amt"
                    value={line.int_amt}
                    onChange={(e) => updateLine(idx, { int_amt: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-input voucher-entry-amt"
                    value={line.cd_amt}
                    onChange={(e) => updateLine(idx, { cd_amt: e.target.value })}
                  />
                </td>
                <td className="voucher-entry-row-actions">
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
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={11} className="voucher-entry-add-row">
                <button type="button" className="btn btn-secondary btn-sm" onClick={addLine}>
                  + Add line
                </button>
              </td>
              <td className="num">{fmtAmt(lineTotals.dr)}</td>
              <td className="num">{fmtAmt(lineTotals.cr)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
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
        onApply={applyPendingBills}
      />
    </div>
  );
}
