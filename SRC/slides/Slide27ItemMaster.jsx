import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import ItemMasterFormModal from '../components/ItemMasterFormModal';
import SessionInfoLine from '../components/SessionInfoLine';

const reqOpts = { withCredentials: true, timeout: 120000 };

function mapItemRow(r) {
  return {
    ITEM_CODE: r.ITEM_CODE ?? r.item_code,
    ITEM_NAME: r.ITEM_NAME ?? r.item_name,
    CAT: r.CAT ?? r.cat,
    CAT_CODE: r.CAT_CODE ?? r.cat_code,
    CAT_NAME: r.CAT_NAME ?? r.cat_name,
    R_F: r.R_F ?? r.r_f,
    HSN_CODE: r.HSN_CODE ?? r.hsn_code,
    TAX_PER: r.TAX_PER ?? r.tax_per,
    S_CODE: r.S_CODE ?? r.s_code,
    P_CODE: r.P_CODE ?? r.p_code,
    AMT_CAL: r.AMT_CAL ?? r.amt_cal,
  };
}

export default function Slide27ItemMaster({ apiBase, formData, userName, onPrev, onReset }) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compYear = Number(formData.comp_year ?? formData.COMP_YEAR ?? 0) || 0;

  const [perms, setPerms] = useState(null);
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
      const q = String(searchQ).trim();
      if (q) params.q = q;
      const { data } = await axios.get(`${apiBase}/api/item-master-list`, { params, ...reqOpts });
      setRows(Array.isArray(data) ? data.map(mapItemRow) : []);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Load failed');
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }, [apiBase, compCode, compUid, searchQ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const { data } = await axios.get(`${apiBase}/api/item-master-user-permissions`, {
          params: { comp_uid: compUid, user_name: userName || '' },
          ...reqOpts,
        });
        if (!cancelled) setPerms(data);
      } catch (e) {
        if (!cancelled) setErr(e?.response?.data?.error || e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, compUid, userName]);

  useEffect(() => {
    if (loading || !perms?.canOpen) return;
    void loadList();
  }, [loading, perms?.canOpen, loadList]);

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.ITEM_CODE) === String(selectedCode)) || null,
    [rows, selectedCode]
  );

  const handleDelete = async () => {
    if (!selectedRow) {
      alert('Select an item from the list first.');
      return;
    }
    if (!perms?.canDelete) {
      alert('You Can Not Delete');
      return;
    }
    const code = selectedRow.ITEM_CODE;
    const label = `[${code}] ${selectedRow.ITEM_NAME || ''}`;
    if (!window.confirm(`Delete item ${label} from ITEMMAST?\n\nBlocked if stock entries exist (except opening).`)) {
      return;
    }
    setDeleting(true);
    setErr('');
    try {
      await axios.delete(`${apiBase}/api/item-master`, {
        data: {
          comp_code: compCode,
          comp_uid: compUid,
          user_name: userName,
          item_code: code,
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

  if (loading) {
    return (
      <div className="slide slide-27-item-master slide-27-item-master--loading">
        <div className="sale-bill-loading-card">
          <h2 className="sale-bill-page__title">Item Master</h2>
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
      <div className="slide slide-27-item-master">
        <h2 className="sale-bill-page__title">Item Master</h2>
        <p className="deploy-update-msg deploy-update-msg--err">{err || 'Access denied (F5).'}</p>
        <button type="button" className="btn btn-secondary" onClick={onPrev}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="slide slide-27-item-master account-master-screen item-master-screen">
      <div className="account-master-screen__head">
        <div className="account-master-screen__title-row">
          <h2 className="sale-bill-page__title">Item Master</h2>
        </div>
        <SessionInfoLine formData={formData} userName={userName} helpReportId="item-master" />
        <div className="account-master-screen__toolbar">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Home
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void loadList()} disabled={listLoading}>
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
        <label className="sale-bill-field account-master-filter account-master-filter--search">
          <span className="sale-bill-field__label">Search</span>
          <input
            className="form-input"
            value={searchQ}
            placeholder="Item code, name, or HSN…"
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

      <div className="account-master-screen__list-wrap item-master-screen__list-wrap">
        <table className="account-master-table item-master-table">
          <thead>
            <tr>
              <th>Item code</th>
              <th>Item name</th>
              <th>Cat</th>
              <th>Cat code</th>
              <th>R/F</th>
              <th>HSN</th>
              <th>GST %</th>
              <th>S code</th>
              <th>P code</th>
              <th>AmtCal</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="account-master-table__empty">
                  {listLoading ? 'Loading…' : 'No items found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const code = String(r.ITEM_CODE);
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
                    <td>{r.ITEM_CODE}</td>
                    <td>{r.ITEM_NAME}</td>
                    <td>{r.CAT}</td>
                    <td title={r.CAT_NAME}>{r.CAT_CODE}</td>
                    <td>{r.R_F}</td>
                    <td>{r.HSN_CODE}</td>
                    <td>{r.TAX_PER}</td>
                    <td>{r.S_CODE}</td>
                    <td>{r.P_CODE}</td>
                    <td>{r.AMT_CAL}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="account-master-screen__hint item-master-screen__hint">
        <span className="item-master-screen__count">
          {rows.length} item{rows.length === 1 ? '' : 's'}
        </span>
        {selectedRow ? (
          <span className="item-master-screen__selection">
            Selected: <strong>[{selectedRow.ITEM_CODE}]</strong> {selectedRow.ITEM_NAME || ''}
          </span>
        ) : null}
        {perms?.canEdit ? <span className="item-master-screen__tip">Double-click a row to edit</span> : null}
      </p>

      <ItemMasterFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        apiBase={apiBase}
        compCode={compCode}
        compUid={compUid}
        compYear={compYear}
        userName={userName}
        onCreated={() => {
          setAddOpen(false);
          void loadList();
        }}
      />

      <ItemMasterFormModal
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
