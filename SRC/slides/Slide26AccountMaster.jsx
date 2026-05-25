import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import MasterPartyCreateModal from '../components/MasterPartyCreateModal';
import MasterPartyPickList from '../components/MasterPartyPickList';
import ReportHelpButton from '../components/ReportHelpButton';
import SessionInfoLine from '../components/SessionInfoLine';

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

function mapAccountRow(r) {
  return {
    CODE: r.CODE ?? r.code,
    NAME: r.NAME ?? r.name,
    SCHEDULE: r.SCHEDULE ?? r.schedule,
    ADD1: r.ADD1 ?? r.add1,
    ADD2: r.ADD2 ?? r.add2,
    ADD3: r.ADD3 ?? r.add3,
    CITY: r.CITY ?? r.city,
    GST_NO: r.GST_NO ?? r.gst_no,
    STATE_CODE: r.STATE_CODE ?? r.state_code,
    STATE: r.STATE ?? r.state,
    PAN: r.PAN ?? r.pan,
    TEL_NO_O: r.TEL_NO_O ?? r.tel_no_o,
    L_C: r.L_C ?? r.l_c,
  };
}

export default function Slide26AccountMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [err, setErr] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadList = useCallback(async () => {
    if (!compCode || compUid == null) return;
    setListLoading(true);
    setErr('');
    try {
      const params = { comp_code: compCode, comp_uid: compUid };
      const sch = scheduleNum(scheduleFilter);
      if (sch) params.schedule = sch;
      const q = String(searchQ).trim();
      if (q) params.q = q;
      const { data } = await axios.get(`${apiBase}/api/master-accounts`, { params, ...reqOpts });
      setRows(Array.isArray(data) ? data.map(mapAccountRow) : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [apiBase, compCode, compUid, scheduleFilter, searchQ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const [pRes, sRes] = await Promise.all([
          axios.get(`${apiBase}/api/master-party-user-permissions`, {
            params: { comp_uid: compUid, user_name: userName || '' },
            ...reqOpts,
          }),
          axios
            .get(`${apiBase}/api/master-party-schedules`, {
              params: { comp_code: compCode, comp_uid: compUid },
              ...reqOpts,
            })
            .catch(() => ({ data: [] })),
        ]);
        if (cancelled) return;
        setPerms(pRes.data);
        setSchedules(sRes.data || []);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid, userName]);

  useEffect(() => {
    if (loading || !perms?.canOpen) return;
    void loadList();
  }, [loading, perms?.canOpen, loadList]);

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const scheduleLabelMap = useMemo(() => {
    const m = new Map();
    for (const s of schedules) {
      const no = String(s.NO ?? s.no ?? '');
      if (no) m.set(no, schedLabel(s));
    }
    return m;
  }, [schedules]);

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select an account from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.CODE;
    const label = `[${code}] ${selectedRow.NAME || ''}`;
    if (!window.confirm(`Delete account ${label} from MASTER?\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(`${apiBase}/api/master-party`, {
        data: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          code,
        },
        ...reqOpts,
      });
      setSelectedCode('');
      await loadList();
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Delete failed';
      setErr(msg);
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleRefresh = () => void loadList();

  const defaultScheduleForAdd = scheduleNum(scheduleFilter) || undefined;

  if (loading) {
    return (
      <div className="slide slide-26-account-master slide-26-account-master--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">A/c Master</h2>
          <p className="sale-bill-loading-card__text">Loading…</p>
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  if (!perms?.canOpen) {
    return (
      <div className="slide slide-26-account-master">
        <h2 className="sale-bill-page__title">A/c Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F4).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-26-account-master account-master-screen">
      <div className="account-master-screen__head">
        <div className="account-master-screen__title-row">
          <h2 className="sale-bill-page__title">A/c Master</h2>
          <ReportHelpButton reportId="account-master" />
        </div>
        <SessionInfoLine formData={formData} userName={userName} />
        <div className="account-master-screen__toolbar">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Home
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleRefresh} disabled={listLoading}>
            {listLoading ? 'Loading…' : 'Refresh'}
          </button>
          {perms?.canAdd ? (
            <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
              Add
            </button>
          ) : null}
          {perms?.canEdit ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!selectedRow}
              onClick={() => setEditRow(selectedRow)}
            >
              Edit
            </button>
          ) : null}
          {perms?.canDelete ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={!selectedRow || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          ) : null}
        </div>
      </div>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      <div className="account-master-screen__filters">
        <label className="sale-bill-field account-master-filter">
          <span className="sale-bill-field__label">Schedule</span>
          <MasterPartyPickList
            options={[{ NO: '', no: '', NAME: 'All schedules', name: 'All schedules' }, ...schedules]}
            value={scheduleFilter}
            disabled={listLoading}
            title="Schedule filter"
            placeholder="All schedules"
            filterPlaceholder="Search schedule…"
            getValue={(s) => String(s.NO ?? s.no ?? '')}
            getLabel={(s) => {
              const no = s.NO ?? s.no ?? '';
              if (no === '' || no == null) return 'All schedules';
              return schedLabel(s);
            }}
            onChange={(val) => setScheduleFilter(val)}
          />
        </label>
        <label className="sale-bill-field account-master-filter account-master-filter--search">
          <span className="sale-bill-field__label">Search</span>
          <input
            className="form-input"
            value={searchQ}
            placeholder="Code, name, or city…"
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void loadList();
              }
            }}
          />
        </label>
        <button type="button" className="btn btn-secondary account-master-filter-btn" onClick={() => void loadList()}>
          Find
        </button>
      </div>

      <div className="account-master-screen__list-wrap">
        <table className="account-master-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Sched</th>
              <th>City</th>
              <th>GST No.</th>
              <th>PAN</th>
              <th>L/C</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No accounts found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const code = String(r.CODE);
                const schKey = String(scheduleNum(r.SCHEDULE));
                const schLbl = scheduleLabelMap.get(schKey) || schKey;
                const isSel = selectedCode === code;
                return (
                  <tr
                    key={code}
                    className={isSel ? 'account-master-table__row is-selected' : 'account-master-table__row'}
                    onClick={() => setSelectedCode(code)}
                    onDoubleClick={() => {
                      if (perms?.canEdit) setEditRow(r);
                    }}
                  >
                    <td>{r.CODE}</td>
                    <td>{r.NAME}</td>
                    <td title={schLbl}>{schKey}</td>
                    <td>{r.CITY}</td>
                    <td>{r.GST_NO}</td>
                    <td>{r.PAN}</td>
                    <td>{r.L_C}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="account-master-screen__hint">
        {rows.length} account{rows.length === 1 ? '' : 's'}
        {selectedRow ? ` · selected [${selectedRow.CODE}] ${selectedRow.NAME || ''}` : ''}
        {perms?.canEdit ? ' · double-click row to edit' : ''}
      </p>

      <MasterPartyCreateModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        defaultSchedule={defaultScheduleForAdd}
        lockSchedule={Boolean(defaultScheduleForAdd)}
        onCreated={() => {
          setAddOpen(false);
          void loadList();
        }}
      />

      <MasterPartyCreateModal
        open={editRow != null}
        onClose={() => setEditRow(null)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        editRow={editRow}
        onUpdated={() => {
          setEditRow(null);
          void loadList();
        }}
      />
    </div>
  );
}
