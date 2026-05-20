import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import MasterPartyPickList from './MasterPartyPickList';

const reqOpts = { withCredentials: true, timeout: 120000 };

function scheduleNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function schedLabel(row) {
  const no = row.NO ?? row.no ?? '';
  const nm = row.NAME ?? row.name ?? '';
  return nm ? `${nm} (${no})` : String(no);
}

/** Fox parity: name, address lines, city, gst, pan — uppercase. */
function capsField(v) {
  return String(v ?? '').toUpperCase();
}

const LC_OPTIONS = [
  { value: 'L', label: 'Local (L)' },
  { value: 'C', label: 'Central (C)' },
  { value: 'I', label: 'Import (I)' },
];

function isValidLc(v) {
  const x = String(v ?? '').trim().toUpperCase();
  return x === 'L' || x === 'C' || x === 'I';
}

export default function MasterPartyCreateModal({
  open,
  onClose,
  apiBase,
  compCode,
  compUid,
  compYear,
  userName,
  defaultSchedule,
  lockSchedule = false,
  onCreated,
}) {
  const formRef = useRef(null);
  const [perms, setPerms] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [states, setStates] = useState([]);
  const [schedule, setSchedule] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [add1, setAdd1] = useState('');
  const [add2, setAdd2] = useState('');
  const [add3, setAdd3] = useState('');
  const [city, setCity] = useState('');
  const [gstNo, setGstNo] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [stateName, setStateName] = useState('');
  const [pan, setPan] = useState('');
  const [telNo, setTelNo] = useState('');
  const [lC, setLC] = useState('L');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const focusField = useCallback((fieldId) => {
    const el = formRef.current?.querySelector(`[data-mp-field="${fieldId}"]`);
    if (!el || typeof el.focus !== 'function') return;
    el.focus();
    if (typeof el.select === 'function' && el.tagName === 'INPUT' && !el.readOnly) {
      try {
        el.select();
      } catch (_) {}
    }
  }, []);

  const onEnterNext = useCallback(
    (e, nextId, { submit = false } = {}) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      e.stopPropagation();
      if (submit) {
        formRef.current?.requestSubmit();
        return;
      }
      if (nextId) focusField(nextId);
    },
    [focusField]
  );

  const loadNextCode = useCallback(
    async (schedVal) => {
      const sch = scheduleNum(schedVal);
      if (!sch || !compCode || compUid == null) return;
      try {
        const { data } = await axios.get(`${apiBase}/api/master-party-next-code`, {
          params: { comp_code: compCode, comp_uid: compUid, schedule: sch },
          ...reqOpts,
        });
        setCode(String(data?.next_code ?? data?.NEXT_CODE ?? ''));
      } catch (_) {
        /* keep previous code */
      }
    },
    [apiBase, compCode, compUid]
  );

  useEffect(() => {
    if (!open) return;
    const defSch = scheduleNum(defaultSchedule);
    setSchedule(defSch ? String(defSch) : '');
    setName('');
    setAdd1('');
    setAdd2('');
    setAdd3('');
    setCity('');
    setGstNo('');
    setStateCode('');
    setStateName('');
    setPan('');
    setTelNo('');
    setLC('L');
    setErr('');
    setSaving(false);

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const baseParams = { comp_uid: compUid, user_name: userName || '' };
        const pRes = await axios.get(`${apiBase}/api/master-party-user-permissions`, {
          params: baseParams,
          ...reqOpts,
        });
        const [sRes, stRes] = await Promise.all([
          axios
            .get(`${apiBase}/api/master-party-schedules`, {
              params: { comp_code: compCode, comp_uid: compUid },
              ...reqOpts,
            })
            .catch(() => ({ data: [] })),
          axios
            .get(`${apiBase}/api/master-party-states`, {
              params: { comp_code: compCode, comp_uid: compUid },
              ...reqOpts,
            })
            .catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setPerms(pRes.data);
        let schedList = sRes.data || [];
        if (!schedList.length && defSch) {
          schedList = [{ NO: defSch, no: defSch, NAME: String(defSch), name: String(defSch) }];
        }
        setSchedules(schedList);
        setStates(stRes.data || []);
        if (!pRes.data?.canOpen) {
          setErr('Access Denied');
          return;
        }
        if (!pRes.data?.canAdd) {
          setErr('You Can Not Add');
          return;
        }
        const schUse = defSch || scheduleNum(sRes.data?.[0]?.NO ?? sRes.data?.[0]?.no);
        if (schUse) {
          setSchedule(String(schUse));
          await loadNextCode(schUse);
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
  }, [open, apiBase, compCode, compUid, userName, defaultSchedule, loadNextCode]);

  useEffect(() => {
    if (!open || loading || !perms?.canOpen || !perms?.canAdd) return;
    const t = requestAnimationFrame(() => focusField(lockSchedule ? 'name' : 'schedule'));
    return () => cancelAnimationFrame(t);
  }, [open, loading, perms, lockSchedule, focusField]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!perms?.canOpen) {
      alert('Access Denied');
      return;
    }
    if (!perms?.canAdd) {
      alert('You Can Not Add');
      return;
    }
    const sch = scheduleNum(schedule);
    if (!sch) {
      setErr('Select schedule.');
      return;
    }
    if (!String(name).trim()) {
      setErr('Name is required.');
      focusField('name');
      return;
    }
    if (!isValidLc(lC)) {
      setErr('Local / Central / Import (L_C) is required. Select L, C, or I.');
      focusField('lc');
      return;
    }
    setSaving(true);
    setErr('');
    try {
      const { data } = await axios.post(
        `${apiBase}/api/master-party`,
        {
          comp_code: compCode,
          comp_uid: compUid,
          comp_year: compYear,
          user_name: userName,
          schedule: sch,
          code: Number(code) || undefined,
          name: capsField(name).trim(),
          add1: capsField(add1),
          add2: capsField(add2),
          add3: capsField(add3),
          city: capsField(city),
          gst_no: capsField(gstNo),
          state_code: capsField(stateCode),
          state: capsField(stateName),
          pan: capsField(pan),
          tel_no_o: telNo,
          l_c: String(lC).trim().toUpperCase(),
        },
        reqOpts
      );
      onCreated?.(data);
      onClose?.();
    } catch (ex) {
      const msg = ex?.response?.data?.error || ex.message || 'Save failed';
      setErr(msg);
      if (ex?.response?.status === 403) alert(msg);
    } finally {
      setSaving(false);
    }
  };

  const blocked = !perms?.canOpen || !perms?.canAdd;
  const showStateSelect = states.length > 0;
  const scheduleLabelText = useMemo(() => {
    const hit = schedules.find((s) => String(s.NO ?? s.no) === String(schedule));
    return hit ? schedLabel(hit) : String(schedule || '');
  }, [schedules, schedule]);

  if (!open) return null;

  return createPortal(
    <div
      className="sale-bill-modal-backdrop master-party-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="sale-bill-modal master-party-modal" role="dialog" aria-labelledby="master-party-modal-title">
        <div className="sale-bill-modal-head">
          <h3 id="master-party-modal-title">New party (Master)</h3>
          <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <form ref={formRef} className="sale-bill-modal-body master-party-modal__body" onSubmit={handleSave}>
          {loading ? <p className="master-party-modal__loading">Loading…</p> : null}
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
          {!loading && !blocked ? (
            <div className="master-party-modal__fields">

              <label className="sale-bill-field master-party-field">
                <span className="sale-bill-field__label">Schedule</span>
                {lockSchedule ? (
                  <input className="form-input" readOnly value={scheduleLabelText} />
                ) : (
                  <MasterPartyPickList
                    options={schedules}
                    value={schedule}
                    disabled={saving}
                    title="Schedule"
                    dataMpField="schedule"
                    placeholder="Select schedule"
                    filterPlaceholder="Search schedule…"
                    getValue={(s) => String(s.NO ?? s.no ?? '')}
                    getLabel={(s) => schedLabel(s)}
                    onChange={(val) => {
                      setSchedule(val);
                      void loadNextCode(val);
                    }}
                    onKeyDown={(e) => onEnterNext(e, 'name')}
                  />
                )}
              </label>
              <div className="master-party-row master-party-row--2">
                <label className="master-party-cell master-party-cell--code">
                  <span className="sale-bill-field__label">Code</span>
                  <input
                    className="form-input master-party-input--code"
                    data-mp-field="code"
                    value={code}
                    readOnly
                    tabIndex={-1}
                    title={code}
                  />
                </label>
                <label className="master-party-cell master-party-cell--grow">
                  <span className="sale-bill-field__label">Name *</span>
                  <input
                    className="form-input"
                    data-mp-field="name"
                    value={name}
                    maxLength={50}
                    disabled={saving}
                    onChange={(e) => setName(capsField(e.target.value))}
                    onKeyDown={(e) => onEnterNext(e, 'add1')}
                  />
                </label>
              </div>
              <div className="master-party-address-block">
                <span className="sale-bill-field__label">Address</span>
                <input
                  className="form-input"
                  data-mp-field="add1"
                  value={add1}
                  maxLength={40}
                  disabled={saving}
                  onChange={(e) => setAdd1(capsField(e.target.value))}
                  onKeyDown={(e) => onEnterNext(e, 'add2')}
                />
                <input
                  className="form-input master-party-address-line"
                  data-mp-field="add2"
                  value={add2}
                  maxLength={40}
                  disabled={saving}
                  onChange={(e) => setAdd2(capsField(e.target.value))}
                  onKeyDown={(e) => onEnterNext(e, 'add3')}
                />
                <input
                  className="form-input master-party-address-line"
                  data-mp-field="add3"
                  value={add3}
                  maxLength={40}
                  disabled={saving}
                  onChange={(e) => setAdd3(capsField(e.target.value))}
                  onKeyDown={(e) => onEnterNext(e, 'city')}
                />
              </div>
              <label className="sale-bill-field master-party-field">
                <span className="sale-bill-field__label">City</span>
                <input
                  className="form-input"
                  data-mp-field="city"
                  value={city}
                  maxLength={20}
                  disabled={saving}
                  onChange={(e) => setCity(capsField(e.target.value))}
                  onKeyDown={(e) => onEnterNext(e, 'lc')}
                />
              </label>
              <label className="sale-bill-field master-party-field master-party-field--lc">
                <span className="sale-bill-field__label">Local / Central / Import (L_C) *</span>
                <select
                  className="form-input master-party-lc-select"
                  data-mp-field="lc"
                  value={lC}
                  required
                  disabled={saving}
                  onChange={(e) => setLC(e.target.value)}
                  onKeyDown={(e) => onEnterNext(e, 'gst')}
                >
                  {LC_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="master-party-row master-party-row--4">
                <label className="master-party-cell master-party-cell--gst">
                  <span className="sale-bill-field__label">GST No.</span>
                  <input
                    className="form-input master-party-input--gst"
                    data-mp-field="gst"
                    value={gstNo}
                    maxLength={15}
                    disabled={saving}
                    onChange={(e) => setGstNo(capsField(e.target.value))}
                    onKeyDown={(e) => onEnterNext(e, 'pan')}
                  />
                </label>
                <label className="master-party-cell master-party-cell--pan">
                  <span className="sale-bill-field__label">PAN</span>
                  <input
                    className="form-input master-party-input--pan"
                    data-mp-field="pan"
                    value={pan}
                    maxLength={10}
                    disabled={saving}
                    onChange={(e) => setPan(capsField(e.target.value))}
                    onKeyDown={(e) => onEnterNext(e, 'state_name')}
                  />
                </label>
                <label className="master-party-cell master-party-cell--stnm">
                  <span className="sale-bill-field__label">State</span>
                  {showStateSelect ? (
                    <MasterPartyPickList
                      options={states}
                      value={stateCode}
                      disabled={saving}
                      title="State"
                      dataMpField="state_name"
                      panelVariant="stateName"
                      placeholder="Select state"
                      filterPlaceholder="Search state…"
                      getValue={(st) => String(st.STATE_CODE ?? st.state_code ?? '').trim()}
                      getTriggerLabel={(st) => String(st.STATE ?? st.state ?? '').trim()}
                      getOptionLabel={(st) => String(st.STATE ?? st.state ?? '').trim()}
                      getFilterText={(st) => {
                        const sc = String(st.STATE_CODE ?? st.state_code ?? '').trim();
                        const nm = String(st.STATE ?? st.state ?? '').trim();
                        return `${nm} ${sc}`;
                      }}
                      getLabel={(st) => String(st.STATE ?? st.state ?? '').trim()}
                      onChange={(sc) => {
                        setStateCode(sc);
                        const hit = states.find(
                          (st) => String(st.STATE_CODE ?? st.state_code ?? '').trim() === sc
                        );
                        if (hit) setStateName(capsField(hit.STATE ?? hit.state));
                      }}
                      onKeyDown={(e) => onEnterNext(e, 'tel')}
                    />
                  ) : (
                    <input
                      className="form-input"
                      data-mp-field="state_name"
                      value={stateName}
                      maxLength={30}
                      disabled={saving}
                      onChange={(e) => setStateName(capsField(e.target.value))}
                      onKeyDown={(e) => onEnterNext(e, 'state_code')}
                    />
                  )}
                </label>
                <label className="master-party-cell master-party-cell--stcd">
                  <span className="sale-bill-field__label">St.code</span>
                  <input
                    className="form-input master-party-input--stcd"
                    data-mp-field="state_code"
                    value={stateCode}
                    maxLength={2}
                    readOnly={showStateSelect}
                    tabIndex={showStateSelect ? -1 : undefined}
                    disabled={saving}
                    onChange={(e) => setStateCode(capsField(e.target.value))}
                    onKeyDown={(e) => onEnterNext(e, 'tel')}
                    placeholder={showStateSelect ? '' : '08'}
                    aria-readonly={showStateSelect}
                  />
                </label>
              </div>
              <label className="sale-bill-field master-party-field">
                <span className="sale-bill-field__label">Tel No.</span>
                <input
                  className="form-input"
                  data-mp-field="tel"
                  value={telNo}
                  maxLength={30}
                  disabled={saving}
                  onChange={(e) => setTelNo(e.target.value)}
                  onKeyDown={(e) => onEnterNext(e, null, { submit: true })}
                />
              </label>

            </div>
          ) : null}
          <div className="master-party-modal__actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || blocked || loading}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

/** + button beside party field labels */
export function PartyAddButton({ onClick, disabled, title = 'Add new party' }) {
  return (
    <button
      type="button"
      className="btn btn-master-party-add"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      +
    </button>
  );
}
