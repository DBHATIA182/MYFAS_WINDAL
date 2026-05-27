import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';
import SessionInfoLine from '../components/SessionInfoLine';

function n(row, upper, lower) {
  const v = row?.[upper] ?? row?.[lower];
  if (v == null || v === '') return 0;
  const x = parseFloat(v);
  return Number.isNaN(x) ? 0 : x;
}

function fmtQty(val) {
  const x = parseFloat(val);
  if (Number.isNaN(x)) return '0';
  return x.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function fmtWt(val) {
  const x = parseFloat(val) || 0;
  return x.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Slide10({ apiBase, formData, onPrev, onReset }) {
  const [endDate, setEndDate] = useState('');
  const [godCode, setGodCode] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [supCode, setSupCode] = useState('');
  const [bNo, setBNo] = useState('');
  const [lot, setLot] = useState('');
  const [costCode, setCostCode] = useState('');
  const [co, setCo] = useState('O');

  const [godowns, setGodowns] = useState([]);
  const [items, setItems] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [costs, setCosts] = useState([]);
  const [lookupError, setLookupError] = useState('');

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRows, setDetailRows] = useState([]);
  const [detailLot, setDetailLot] = useState(null);

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const e = toInputDateString(eRaw);
    if (e) setEndDate(e);
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  useEffect(() => {
    if (!compCode || !compUid) return;
    setLookupError('');
    (async () => {
      try {
        const [g, i, s, c] = await Promise.all([
          axios.get(`${apiBase}/api/stocklot-godowns`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/stocklot-items`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/stocklot-suppliers`, { params: { comp_code: compCode, comp_uid: compUid } }),
          axios.get(`${apiBase}/api/stocklot-costs`, { params: { comp_code: compCode, comp_uid: compUid } }),
        ]);
        setGodowns(Array.isArray(g.data) ? g.data : []);
        setItems(Array.isArray(i.data) ? i.data : []);
        setSuppliers(Array.isArray(s.data) ? s.data : []);
        setCosts(Array.isArray(c.data) ? c.data : []);
      } catch (err) {
        setLookupError(
          err.response?.status === 404
            ? `No /api/stocklot-* routes on ${formatApiOrigin(apiBase)}. Restart API with latest server.cjs.`
            : err.response?.data?.error || err.message || 'Failed to load search help'
        );
      }
    })();
  }, [apiBase, compCode, compUid]);

  const godLabel = useMemo(() => {
    const hit = godowns.find((r) => String(r.GOD_CODE ?? r.god_code) === String(godCode));
    return hit ? `${hit.GOD_CODE ?? hit.god_code} - ${hit.GOD_NAME ?? hit.god_name}` : godCode || 'All godowns';
  }, [godowns, godCode]);

  const itemLabel = useMemo(() => {
    const hit = items.find((r) => String(r.ITEM_CODE ?? r.item_code) === String(itemCode));
    return hit ? `${hit.ITEM_CODE ?? hit.item_code} - ${hit.ITEM_NAME ?? hit.item_name}` : itemCode || 'All items';
  }, [items, itemCode]);

  const supLabel = useMemo(() => {
    const hit = suppliers.find((r) => String(r.CODE ?? r.code) === String(supCode));
    return hit ? `${hit.CODE ?? hit.code} - ${hit.NAME ?? hit.name}` : supCode || 'All suppliers';
  }, [suppliers, supCode]);

  const costLabel = useMemo(() => {
    const hit = costs.find((r) => String(r.COST_CODE ?? r.cost_code) === String(costCode));
    return hit ? `${hit.COST_CODE ?? hit.cost_code} - ${hit.COST_NAME ?? hit.cost_name}` : costCode || 'All cost codes';
  }, [costs, costCode]);

  const totals = useMemo(() => {
    let qnty = 0;
    let bags = 0;
    let katta = 0;
    let hkatta = 0;
    let wt = 0;
    let gwt = 0;
    for (const r of rows) {
      qnty += n(r, 'QNTY', 'qnty');
      bags += n(r, 'BAGS', 'bags');
      katta += n(r, 'KATTA', 'katta');
      hkatta += n(r, 'HKATTA', 'hkatta');
      wt += n(r, 'WEIGHT', 'weight');
      gwt += n(r, 'G_WEIGHT', 'g_weight');
    }
    return { qnty, bags, katta, hkatta, wt, gwt };
  }, [rows]);

  const pdfData = useMemo(() => ({ rows, totals }), [rows, totals]);
  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      endDate: toDisplayDate(endDate),
      godLabel,
      itemLabel,
      supplierLabel: supLabel,
      costLabel,
      bNo: bNo || 'All',
      lot: lot || 'All',
      coLabel: co === 'O' ? 'Outstanding' : 'Complete',
    }),
    [compName, endDate, godLabel, itemLabel, supLabel, costLabel, bNo, lot, co]
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const od = toOracleDate(endDate);
    if (!od) {
      alert('Please choose ending date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/stock-lot`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          e_date: od,
          god_code: godCode,
          item_code: itemCode,
          sup_code: supCode,
          b_no: bNo,
          lot,
          cost_code: costCode,
          c_o: co,
        },
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data) ? data : []);
      setShowReport(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to run stock lot report');
    } finally {
      setLoading(false);
    }
  };

  const downloadPdf = () =>
    generatePDF('stock-lot', pdfData, pdfMeta).catch((err) => alert(String(err?.message || err)));
  const shareWa = () =>
    sharePdfWithWhatsApp(
      'stock-lot',
      pdfData,
      pdfMeta,
      ['Stock lot', compName, `As on ${pdfMeta.endDate}`, `${pdfMeta.coLabel}`].join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const openDetail = useCallback(
    async (summaryRow) => {
      const selectedItem = String(summaryRow.ITEM_CODE ?? summaryRow.item_code ?? '').trim();
      const selectedLot = String(summaryRow.LOT ?? summaryRow.lot ?? '').trim();
      if (!selectedItem || !selectedLot) {
        alert('Cannot open lot detail: missing item code or lot.');
        return;
      }
      const oracle = toOracleDate(endDate);
      if (!oracle) return;

      const selectedBNo = String(summaryRow.B_NO ?? summaryRow.b_no ?? '').trim();
      const selectedSup = String(summaryRow.SUP_CODE ?? summaryRow.sup_code ?? '').trim();
      const selectedGod = String(summaryRow.GOD_CODE ?? summaryRow.god_code ?? '').trim();
      const selectedCost = String(summaryRow.COST_CODE ?? summaryRow.cost_code ?? '').trim();

      setDetailLot({
        itemCode: selectedItem,
        itemName: String(summaryRow.ITEM_NAME ?? summaryRow.item_name ?? '').trim(),
        lot: selectedLot,
        bNo: selectedBNo,
        supCode: selectedSup,
        godCode: selectedGod,
        costCode: selectedCost,
      });
      setDetailOpen(true);
      setDetailLoading(true);
      setDetailError('');
      setDetailRows([]);
      try {
        const { data } = await axios.get(`${apiBase}/api/stock-lot-detail`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            e_date: oracle,
            item_code: selectedItem,
            lot: selectedLot,
            b_no: selectedBNo,
            sup_code: selectedSup,
            god_code: selectedGod,
            cost_code: selectedCost,
          },
          withCredentials: true,
          timeout: 120000,
        });
        setDetailRows(Array.isArray(data) ? data : []);
      } catch (err) {
        setDetailError(err.response?.data?.error || err.message || 'Failed to load lot detail');
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase, compCode, compUid, endDate]
  );

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailRows([]);
    setDetailError('');
    setDetailLot(null);
  };

  const runningDetail = useMemo(() => {
    let runQ = 0;
    let runW = 0;
    let runG = 0;
    return detailRows.map((r) => {
      runQ += n(r, 'R_QNTY', 'r_qnty') - n(r, 'S_QNTY', 's_qnty');
      runW += n(r, 'R_WEIGHT', 'r_weight') - n(r, 'S_WEIGHT', 's_weight');
      runG += n(r, 'R_G_WEIGHT', 'r_g_weight') - n(r, 'SG_WEIGHT', 'sg_weight');
      return { row: r, runQ, runW, runG };
    });
  }, [detailRows]);

  if (showReport) {
    return (
      <div className="slide slide-report slide-10">
        <SessionInfoLine formData={formData} helpReportId="stock-lot" />
        <div className="report-toolbar">
          <h2>Stock lot</h2>
          <div className="toolbar-actions">
            
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={downloadPdf}>
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(rows, 'StockLot', `${compName}_StockLot`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareWa}>
              💬 WhatsApp
            </button>
          </div>
        </div>
        <div className="report-info">
          <p>
            <strong>As on</strong> {toDisplayDate(endDate)} · <strong>C/O</strong> {pdfMeta.coLabel}
          </p>
          <p>
            <strong>Godown</strong> {godLabel} · <strong>Item</strong> {itemLabel} · <strong>Supplier</strong> {supLabel}
            <br />
            <strong>Bikri no</strong> {bNo || 'All'} · <strong>Lot</strong> {lot || 'All'} · <strong>Cost</strong> {costLabel}
            <br />
            Click a row to open date-wise transaction entries for that selected lot.
          </p>
        </div>
        <div className="report-display table-responsive">
          <table className="report-table stock-lot-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Item name</th>
                <th>Lot</th>
                <th>Bikri</th>
                <th>Supplier</th>
                <th>Supplier name</th>
                <th>Sch</th>
                <th>God</th>
                <th>God name</th>
                <th>Vr date</th>
                <th>Cost</th>
                <th>Remarks</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Bags</th>
                <th className="text-right">Katta</th>
                <th className="text-right">H katta</th>
                <th className="text-right">Weight</th>
                <th className="text-right">G weight</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.ITEM_CODE ?? r.item_code}-${r.LOT ?? r.lot}-${i}`}
                  className="stock-sum-row-clickable"
                  onClick={() => openDetail(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDetail(r);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                >
                  <td className="bill-code">{r.ITEM_CODE ?? r.item_code ?? '—'}</td>
                  <td className="ledger-detail">{r.ITEM_NAME ?? r.item_name ?? '—'}</td>
                  <td>{r.LOT ?? r.lot ?? '—'}</td>
                  <td>{r.B_NO ?? r.b_no ?? '—'}</td>
                  <td>{r.SUP_CODE ?? r.sup_code ?? '—'}</td>
                  <td className="ledger-detail">{r.SUP_NAME ?? r.sup_name ?? '—'}</td>
                  <td>{r.SCHEDULE ?? r.schedule ?? '—'}</td>
                  <td>{r.GOD_CODE ?? r.god_code ?? '—'}</td>
                  <td>{r.GOD_NAME ?? r.god_name ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date)}</td>
                  <td>{r.COST_CODE ?? r.cost_code ?? '—'}</td>
                  <td className="ledger-detail">{r.REMARKS ?? r.remarks ?? '—'}</td>
                  <td className="text-right">{fmtQty(n(r, 'QNTY', 'qnty'))}</td>
                  <td className="text-right">{fmtQty(n(r, 'BAGS', 'bags'))}</td>
                  <td className="text-right">{fmtQty(n(r, 'KATTA', 'katta'))}</td>
                  <td className="text-right">{fmtQty(n(r, 'HKATTA', 'hkatta'))}</td>
                  <td className="text-right">{fmtWt(n(r, 'WEIGHT', 'weight'))}</td>
                  <td className="text-right">{fmtWt(n(r, 'G_WEIGHT', 'g_weight'))}</td>
                </tr>
              ))}
              <tr className="stock-sum-grand">
                <td colSpan={12}>
                  <strong>Grand total</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtQty(totals.qnty)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtQty(totals.bags)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtQty(totals.katta)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtQty(totals.hkatta)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtWt(totals.wt)}</strong>
                </td>
                <td className="text-right">
                  <strong>{fmtWt(totals.gwt)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          {rows.length === 0 ? <p className="stock-sum-empty">No rows returned.</p> : null}
        </div>
        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={() => setShowReport(false)}>
            ← Back
          </button>
        </div>

        {detailOpen ? (
          <div className="sale-bill-modal-backdrop stock-sum-detail-backdrop" role="presentation" onClick={closeDetail}>
            <div
              className="sale-bill-modal stock-sum-detail-modal"
              role="dialog"
              aria-labelledby="stock-lot-detail-title"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="sale-bill-modal-head no-print">
                <h3 id="stock-lot-detail-title">
                  Lot detail — {detailLot?.itemCode || '—'} / {detailLot?.lot || '—'}
                  {detailLot?.itemName ? ` — ${detailLot.itemName}` : ''}
                </h3>
                <div className="sale-bill-print-actions">
                  <button type="button" className="sale-bill-modal-close" onClick={closeDetail} aria-label="Close">
                    ×
                  </button>
                </div>
              </div>
              <div className="sale-bill-modal-body stock-sum-detail-body">
                {detailLoading ? <p>Loading…</p> : null}
                {detailError ? (
                  <p className="form-api-error" role="alert">
                    {detailError}
                  </p>
                ) : null}
                {!detailLoading && !detailError ? (
                  <div className="table-responsive">
                    <table className="report-table stock-sum-detail-table">
                      <thead>
                        <tr>
                          <th>Vr date</th>
                          <th>Vr no</th>
                          <th>Vr type</th>
                          <th>Type</th>
                          <th>Lot</th>
                          <th>St</th>
                          <th>B no</th>
                          <th>God</th>
                          <th>Sup</th>
                          <th>Cost</th>
                          <th>Remarks</th>
                          <th className="text-right">R qty</th>
                          <th className="text-right">S qty</th>
                          <th className="text-right">R wt</th>
                          <th className="text-right">S wt</th>
                          <th className="text-right">Run qty</th>
                          <th className="text-right">Run wt</th>
                          <th className="text-right">Run g wt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runningDetail.map(({ row: r, runQ, runW, runG }, idx) => (
                          <tr key={`${idx}-${r.VR_NO ?? r.vr_no}-${r.LOT ?? r.lot}`}>
                            <td style={{ whiteSpace: 'nowrap' }}>{formatLedgerDateDisplay(r.VR_DATE ?? r.vr_date)}</td>
                            <td>{r.VR_NO ?? r.vr_no ?? '—'}</td>
                            <td>{r.VR_TYPE ?? r.vr_type ?? '—'}</td>
                            <td>{r.TYPE ?? r.type ?? '—'}</td>
                            <td>{r.LOT ?? r.lot ?? '—'}</td>
                            <td>{r.STATUS ?? r.status ?? '—'}</td>
                            <td>{r.B_NO ?? r.b_no ?? '—'}</td>
                            <td>{r.GOD_CODE ?? r.god_code ?? '—'}</td>
                            <td>{r.SUP_CODE ?? r.sup_code ?? '—'}</td>
                            <td>{r.COST_CODE ?? r.cost_code ?? '—'}</td>
                            <td className="ledger-detail">{r.REMARKS ?? r.remarks ?? '—'}</td>
                            <td className="text-right">{fmtQty(n(r, 'R_QNTY', 'r_qnty'))}</td>
                            <td className="text-right">{fmtQty(n(r, 'S_QNTY', 's_qnty'))}</td>
                            <td className="text-right">{fmtWt(n(r, 'R_WEIGHT', 'r_weight'))}</td>
                            <td className="text-right">{fmtWt(n(r, 'S_WEIGHT', 's_weight'))}</td>
                            <td className="text-right stock-sum-run">{fmtQty(runQ)}</td>
                            <td className="text-right stock-sum-run">{fmtWt(runW)}</td>
                            <td className="text-right stock-sum-run">{fmtWt(runG)}</td>
                          </tr>
                        ))}
                        {runningDetail.length > 0 ? (
                          <tr className="stock-sum-grand">
                            <td colSpan={15}>
                              <strong>Closing balance</strong>
                            </td>
                            <td className="text-right">
                              <strong>{fmtQty(runningDetail[runningDetail.length - 1].runQ)}</strong>
                            </td>
                            <td className="text-right">
                              <strong>{fmtWt(runningDetail[runningDetail.length - 1].runW)}</strong>
                            </td>
                            <td className="text-right">
                              <strong>{fmtWt(runningDetail[runningDetail.length - 1].runG)}</strong>
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    {detailRows.length === 0 ? <p className="stock-sum-empty">No detail rows returned for selected lot.</p> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="slide slide-10">
      <h2>Stock lot</h2>
      <SessionInfoLine formData={formData} helpReportId="stock-lot">
        <br />
        <span className="compdet-date-hint">
          Lot-wise stock position from <strong>LOTSTOCK</strong> with optional filters and Complete/Outstanding mode.
        </span>
      </SessionInfoLine>
      {lookupError ? (
        <div className="form-api-error" role="alert">
          {lookupError}
        </div>
      ) : null}
      {error ? (
        <div className="form-api-error" role="alert">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="report-form">
        <div className="button-group button-group--form-top">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
        <div className="form-group">
          <label htmlFor="slt-end">Ending date</label>
          <input
            id="slt-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="slt-god">Godown code</label>
          <input id="slt-god" list="slt-god-list" className="form-input" value={godCode} onChange={(e) => setGodCode(e.target.value)} />
          <datalist id="slt-god-list">
            {godowns.map((g) => (
              <option key={String(g.GOD_CODE ?? g.god_code)} value={String(g.GOD_CODE ?? g.god_code)}>
                {String(g.GOD_NAME ?? g.god_name ?? '')}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="slt-item">Item code</label>
          <input id="slt-item" list="slt-item-list" className="form-input" value={itemCode} onChange={(e) => setItemCode(e.target.value)} />
          <datalist id="slt-item-list">
            {items.map((it) => (
              <option key={String(it.ITEM_CODE ?? it.item_code)} value={String(it.ITEM_CODE ?? it.item_code)}>
                {String(it.ITEM_NAME ?? it.item_name ?? '')}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="slt-sup">Supplier</label>
          <input id="slt-sup" list="slt-sup-list" className="form-input" value={supCode} onChange={(e) => setSupCode(e.target.value)} />
          <datalist id="slt-sup-list">
            {suppliers.map((s) => (
              <option key={String(s.CODE ?? s.code)} value={String(s.CODE ?? s.code)}>
                {`${String(s.NAME ?? s.name ?? '')} ${String(s.CITY ?? s.city ?? '')}`.trim()}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="slt-bno">Bikri no.</label>
          <input id="slt-bno" type="text" className="form-input" value={bNo} onChange={(e) => setBNo(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="slt-lot">Lot</label>
          <input id="slt-lot" type="text" className="form-input" value={lot} onChange={(e) => setLot(e.target.value)} />
        </div>
        <div className="form-group">
          <label htmlFor="slt-cost">Cost code</label>
          <input id="slt-cost" list="slt-cost-list" className="form-input" value={costCode} onChange={(e) => setCostCode(e.target.value)} />
          <datalist id="slt-cost-list">
            {costs.map((c) => (
              <option key={String(c.COST_CODE ?? c.cost_code)} value={String(c.COST_CODE ?? c.cost_code)}>
                {String(c.COST_NAME ?? c.cost_name ?? '')}
              </option>
            ))}
          </datalist>
        </div>
        <div className="form-group">
          <label htmlFor="slt-co">Complete/Outstanding</label>
          <select id="slt-co" className="form-input" value={co} onChange={(e) => setCo(e.target.value)}>
            <option value="C">Complete</option>
            <option value="O">Outstanding</option>
          </select>
        </div>

        <div className="button-group">
          <button type="button" className="btn btn-secondary" onClick={onPrev}>
            ← Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </button>
        </div>
      </form>
    </div>
  );
}
