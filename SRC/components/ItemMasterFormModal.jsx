import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import MasterPartyPickList from './MasterPartyPickList';
import MasterPartyCreateModal, { PartyAddButton } from './MasterPartyCreateModal';

const reqOpts = { withCredentials: true, timeout: 120000 };
const SALE_ACCT_SCHEDULE = 12.1;
const PURCHASE_ACCT_SCHEDULE = 14.1;

function capsField(v) {
  return String(v ?? '').toUpperCase();
}

function acctLabel(r) {
  const code = r.CODE ?? r.code ?? '';
  const name = r.NAME ?? r.name ?? '';
  return name ? `[${code}] ${name}` : String(code);
}

function catLabel(r) {
  const code = r.CAT_CODE ?? r.cat_code ?? '';
  const name = r.CAT_NAME ?? r.cat_name ?? '';
  return name ? `${name} (${code})` : String(code);
}

function FieldLabel({ children, required = false }) {
  return (
    <span className="item-master-label">
      {children}
      {required ? <span className="item-master-label__req"> *</span> : null}
    </span>
  );
}

function FormSection({ title, hint, children }) {
  return (
    <section className="item-master-section">
      <div className="item-master-section__head">
        <h4 className="item-master-section__title">{title}</h4>
        {hint ? <p className="item-master-section__hint">{hint}</p> : null}
      </div>
      <div className="item-master-section__body">{children}</div>
    </section>
  );
}

export default function ItemMasterFormModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  compYear,
  userName,
  editRow = null,
  onCreated,
  onUpdated,
}) {
  const isEdit = editRow != null;
  const formRef = useRef(null);

  const [perms, setPerms] = useState(null);
  const [partyPerms, setPartyPerms] = useState(null);
  const [cats, setCats] = useState([]);
  const [saleAccounts, setSaleAccounts] = useState([]);
  const [purchaseAccounts, setPurchaseAccounts] = useState([]);

  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [cat, setCat] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catName, setCatName] = useState('');
  const [rF, setRF] = useState('F');
  const [hsnCode, setHsnCode] = useState('');
  const [taxPer, setTaxPer] = useState('');
  const [sCode, setSCode] = useState('');
  const [pCode, setPCode] = useState('');
  const [amtCal, setAmtCal] = useState('W');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saleAddOpen, setSaleAddOpen] = useState(false);
  const [purchaseAddOpen, setPurchaseAddOpen] = useState(false);

  const loadLookups = useCallback(async () => {
    const { data } = await axios.get(`${apiBase}/api/item-master-lookups`, {
      params: { comp_code: compCode, comp_uid: compUid },
      ...reqOpts,
    });
    setCats(data?.cats || []);
    setSaleAccounts(data?.saleAccounts || []);
    setPurchaseAccounts(data?.purchaseAccounts || []);
    return data;
  }, [apiBase, compCode, compUid]);

  useEffect(() => {
    if (!open) return;

    if (isEdit) {
      setItemCode(String(editRow.ITEM_CODE ?? editRow.item_code ?? ''));
      setItemName(String(editRow.ITEM_NAME ?? editRow.item_name ?? ''));
      setCat(String(editRow.CAT ?? editRow.cat ?? ''));
      setCatCode(String(editRow.CAT_CODE ?? editRow.cat_code ?? ''));
      setCatName(String(editRow.CAT_NAME ?? editRow.cat_name ?? ''));
      setRF(String(editRow.R_F ?? editRow.r_f ?? 'F').toUpperCase() || 'F');
      setHsnCode(String(editRow.HSN_CODE ?? editRow.hsn_code ?? ''));
      setTaxPer(String(editRow.TAX_PER ?? editRow.tax_per ?? ''));
      setSCode(String(editRow.S_CODE ?? editRow.s_code ?? ''));
      setPCode(String(editRow.P_CODE ?? editRow.p_code ?? ''));
      setAmtCal(String(editRow.AMT_CAL ?? editRow.amt_cal ?? 'W').toUpperCase() || 'W');
    } else {
      setItemCode('');
      setItemName('');
      setCat('');
      setCatCode('');
      setCatName('');
      setRF('F');
      setHsnCode('');
      setTaxPer('');
      setSCode('');
      setPCode('');
      setAmtCal('W');
    }
    setErr('');
    setSaving(false);

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [pRes, partyRes] = await Promise.all([
          axios.get(`${apiBase}/api/item-master-user-permissions`, {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios.get(`${apiBase}/api/master-party-user-permissions`, {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
        ]);
        await loadLookups();
        if (cancelled) return;
        setPerms(pRes.data);
        setPartyPerms(partyRes.data);
        if (!pRes.data?.canOpen) {
          setErr('Access Denied');
          return;
        }
        if (isEdit) {
          if (!pRes.data?.canEdit) setErr('You Can Not Edit');
        } else if (!pRes.data?.canAdd) {
          setErr('You Can Not Add');
        }
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, apiBase, compUid, userName, isEdit, editRow, loadLookups]);

  const handleCatChange = (code) => {
    setCatCode(code);
    const hit = cats.find((c) => String(c.CAT_CODE ?? c.cat_code ?? '') === String(code));
    if (hit) {
      setCatName(String(hit.CAT_NAME ?? hit.cat_name ?? ''));
      const catChar = String(hit.CAT ?? hit.cat ?? hit.MAIN_CAT ?? hit.main_cat ?? '').trim();
      if (catChar) setCat(catChar.slice(0, 1).toUpperCase());
    } else {
      setCatName('');
    }
  };

  const refreshAccountsAfterParty = async (created, schedule) => {
    const data = await loadLookups();
    const code = created?.code ?? created?.CODE;
    if (code != null) {
      if (schedule === SALE_ACCT_SCHEDULE) setSCode(String(code));
      if (schedule === PURCHASE_ACCT_SCHEDULE) setPCode(String(code));
    }
    return data;
  };

  const blocked = !perms?.canOpen || (isEdit ? !perms?.canEdit : !perms?.canAdd);

  const handleSave = async (e) => {
    e.preventDefault();
    if (blocked) return;
    if (!String(itemCode).trim()) {
      setErr('Item code is required.');
      return;
    }
    if (!String(itemName).trim()) {
      setErr('Item name is required.');
      return;
    }
    const rf = String(rF).trim().toUpperCase();
    if (rf !== 'R' && rf !== 'F') {
      setErr('R/F must be R or F.');
      return;
    }
    const ac = String(amtCal).trim().toUpperCase();
    if (ac !== 'Q' && ac !== 'W') {
      setErr('AmtCal must be Q or W.');
      return;
    }
    setSaving(true);
    setErr('');
    const payload = {
      comp_code: compCode,
      comp_uid: compUid,
      comp_year: compYear,
      user_name: userName,
      item_code: capsField(itemCode).trim(),
      item_name: capsField(itemName).trim(),
      cat: capsField(cat).trim(),
      cat_code: capsField(catCode).trim(),
      r_f: rf,
      hsn_code: capsField(hsnCode).trim(),
      tax_per: Number(taxPer) || 0,
      s_code: Number(sCode) || 0,
      p_code: Number(pCode) || 0,
      amt_cal: ac,
    };
    try {
      if (isEdit) {
        const { data } = await axios.put(`${apiBase}/api/item-master`, payload, reqOpts);
        onUpdated?.(data);
      } else {
        const { data } = await axios.post(`${apiBase}/api/item-master`, payload, reqOpts);
        onCreated?.(data);
      }
      onClose?.();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      if (ex?.response?.status === 403 || ex?.response?.status === 409) alert(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="sale-bill-modal-backdrop master-party-modal-backdrop item-master-modal-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.();
        }}
      >
        <div className="sale-bill-modal master-party-modal item-master-modal" role="dialog" aria-labelledby="item-master-modal-title">
          <div className="sale-bill-modal-head item-master-modal__head">
            <div className="item-master-modal__head-text">
              <h3 id="item-master-modal-title">{isEdit ? 'Edit item' : 'New item'}</h3>
              <p className="item-master-modal__subtitle">Item Master · maintain ITEMMAST records</p>
            </div>
            <button type="button" className="sale-bill-modal-close item-master-modal__close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <form ref={formRef} className="item-master-modal__body" onSubmit={handleSave}>
            {loading ? <p className="master-party-modal__loading item-master-modal__loading">Loading…</p> : null}
            {err ? <p className="deploy-update-msg deploy-update-msg--err item-master-modal__err">{err}</p> : null}
            {!loading && !blocked ? (
              <div className="item-master-modal__scroll">
              <div className="item-master-form">
                <FormSection title="Item details">
                  <div className="item-master-form__grid item-master-form__grid--identity">
                    <label className="item-master-field item-master-field--code">
                      <FieldLabel required>Item code</FieldLabel>
                      <input
                        className={`form-input item-master-input${isEdit ? ' item-master-input--readonly' : ''}`}
                        value={itemCode}
                        maxLength={13}
                        readOnly={isEdit}
                        disabled={saving || isEdit}
                        placeholder="e.g. CH01"
                        onChange={(e) => setItemCode(capsField(e.target.value))}
                      />
                    </label>
                    <label className="item-master-field item-master-field--grow">
                      <FieldLabel required>Item name</FieldLabel>
                      <input
                        className="form-input item-master-input"
                        value={itemName}
                        maxLength={50}
                        disabled={saving}
                        placeholder="Description"
                        onChange={(e) => setItemName(capsField(e.target.value))}
                      />
                    </label>
                  </div>
                  <div className="item-master-form__grid item-master-form__grid--category">
                    <label className="item-master-field item-master-field--cat">
                      <FieldLabel>Cat</FieldLabel>
                      <input
                        className="form-input item-master-input item-master-input--cat"
                        value={cat}
                        maxLength={1}
                        disabled={saving}
                        placeholder="—"
                        onChange={(e) => setCat(capsField(e.target.value).slice(0, 1))}
                      />
                    </label>
                    <label className="item-master-field">
                      <FieldLabel>Category</FieldLabel>
                      <MasterPartyPickList
                        options={cats}
                        value={catCode}
                        disabled={saving}
                        title="Category"
                        placeholder="Select category"
                        filterPlaceholder="Search category…"
                        getValue={(c) => String(c.CAT_CODE ?? c.cat_code ?? '')}
                        getLabel={catLabel}
                        onChange={handleCatChange}
                      />
                    </label>
                    <label className="item-master-field">
                      <FieldLabel>Category name</FieldLabel>
                      <input
                        className="form-input item-master-input item-master-input--readonly"
                        value={catName}
                        readOnly
                        tabIndex={-1}
                        placeholder="—"
                      />
                    </label>
                  </div>
                </FormSection>

                <FormSection title="Tax & amount basis" hint="HSN/GST for returns · amount on Q or W">
                  <div className="item-master-form__grid item-master-form__grid--tax">
                    <label className="item-master-field item-master-field--rf">
                      <FieldLabel required>R / F</FieldLabel>
                      <select className="form-input item-master-input" value={rF} disabled={saving} onChange={(e) => setRF(e.target.value)}>
                        <option value="R">Raw (R)</option>
                        <option value="F">Finished (F)</option>
                      </select>
                    </label>
                    <label className="item-master-field">
                      <FieldLabel>HSN code</FieldLabel>
                      <input
                        className="form-input item-master-input"
                        value={hsnCode}
                        maxLength={8}
                        disabled={saving}
                        placeholder="8 digits"
                        onChange={(e) => setHsnCode(capsField(e.target.value))}
                      />
                    </label>
                    <label className="item-master-field item-master-field--pct">
                      <FieldLabel>GST %</FieldLabel>
                      <input
                        className="form-input item-master-input item-master-input--num"
                        type="number"
                        step="0.01"
                        min="0"
                        value={taxPer}
                        disabled={saving}
                        placeholder="0"
                        onChange={(e) => setTaxPer(e.target.value)}
                      />
                    </label>
                    <label className="item-master-field item-master-field--amtcal">
                      <FieldLabel required>Amt basis</FieldLabel>
                      <select className="form-input item-master-input" value={amtCal} disabled={saving} onChange={(e) => setAmtCal(e.target.value)}>
                        <option value="W">Weight (W)</option>
                        <option value="Q">Quantity (Q)</option>
                      </select>
                    </label>
                  </div>
                </FormSection>

                <FormSection title="Ledger accounts" hint="Sale 12.10 · Purchase 14.10 — use + to add A/c">
                  <label className="item-master-field item-master-field--full">
                    <FieldLabel required>Sale account</FieldLabel>
                    <div className="item-master-input-group">
                      <MasterPartyPickList
                        options={saleAccounts}
                        value={sCode}
                        disabled={saving}
                        title="Sale account"
                        placeholder="Select sale GL account"
                        filterPlaceholder="Search by name or code…"
                        getValue={(a) => String(a.CODE ?? a.code ?? '')}
                        getLabel={acctLabel}
                        onChange={setSCode}
                      />
                      <PartyAddButton
                        onClick={() => setSaleAddOpen(true)}
                        disabled={saving || !partyPerms?.canAdd}
                        title="Add sale account (schedule 12.10)"
                      />
                    </div>
                  </label>

                  <label className="item-master-field item-master-field--full">
                    <FieldLabel required>Purchase account</FieldLabel>
                    <div className="item-master-input-group">
                      <MasterPartyPickList
                        options={purchaseAccounts}
                        value={pCode}
                        disabled={saving}
                        title="Purchase account"
                        placeholder="Select purchase GL account"
                        filterPlaceholder="Search by name or code…"
                        getValue={(a) => String(a.CODE ?? a.code ?? '')}
                        getLabel={acctLabel}
                        onChange={setPCode}
                      />
                      <PartyAddButton
                        onClick={() => setPurchaseAddOpen(true)}
                        disabled={saving || !partyPerms?.canAdd}
                        title="Add purchase account (schedule 14.10)"
                      />
                    </div>
                  </label>
                </FormSection>
              </div>
              </div>
            ) : null}
            <div className="item-master-modal__foot">
              <button type="button" className="btn btn-secondary item-master-modal__btn-cancel" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary item-master-modal__btn-save" disabled={saving || blocked || loading}>
                {saving ? 'Saving…' : isEdit ? 'Update item' : 'Save item'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <MasterPartyCreateModal
        open={saleAddOpen}
        onClose={() => setSaleAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={SALE_ACCT_SCHEDULE}
        lockSchedule
        onCreated={(data) => {
          setSaleAddOpen(false);
          void refreshAccountsAfterParty(data, SALE_ACCT_SCHEDULE);
        }}
      />

      <MasterPartyCreateModal
        open={purchaseAddOpen}
        onClose={() => setPurchaseAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={PURCHASE_ACCT_SCHEDULE}
        lockSchedule
        onCreated={(data) => {
          setPurchaseAddOpen(false);
          void refreshAccountsAfterParty(data, PURCHASE_ACCT_SCHEDULE);
        }}
      />
    </>,
    document.body
  );
}
