import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate, formatLedgerDateDisplay } from '../utils/dateFormat';
import { formatApiOrigin } from '../utils/apiLabel';

function num(row, upper, lower) {
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

function buildRunningRows(raw) {
  let runQ = 0;
  let runW = 0;
  let runG = 0;
  return (raw || []).map((r) => {
    const rq = num(r, 'R_QNTY', 'r_qnty');
    const sq = num(r, 'S_QNTY', 's_qnty');
    const rw = num(r, 'R_WEIGHT', 'r_weight');
    const sw = num(r, 'S_WEIGHT', 's_weight');
    const rg = num(r, 'R_G_WEIGHT', 'r_g_weight');
    const sg = num(r, 'SG_WEIGHT', 'sg_weight');
    runQ += rq - sq;
    runW += rw - sw;
    runG += rg - sg;
    return { row: r, runQ, runW, runG };
  });
}

export default function Slide9({ apiBase, formData, onPrev, onReset }) {
  const [endDate, setEndDate] = useState('');
  const [godCode, setGodCode] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showReport, setShowReport] = useState(false);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState(null);
  const [detailRows, setDetailRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';
  const compYear = formData.comp_year ?? formData.COMP_YEAR ?? '';

  useEffect(() => {
    const eRaw = formData.comp_e_dt ?? formData.COMP_E_DT;
    const e = toInputDateString(eRaw);
    if (e) setEndDate(e);
  }, [formData.comp_e_dt, formData.COMP_E_DT]);

  const godLabel = useMemo(() => (godCode.trim() ? godCode.trim() : 'All godowns'), [godCode]);

  const pdfMetaSummary = useMemo(
    () => ({
      companyName: compName,
      endDate: toDisplayDate(endDate),
      godLabel,
    }),
    [compName, endDate, godLabel]
  );

  const summaryPdfData = useMemo(() => ({ rows }), [rows]);

  const runningDetail = useMemo(() => buildRunningRows(detailRows), [detailRows]);
  const summaryTotals = useMemo(() => {
    let rQnty = 0;
    let sQnty = 0;
    let rWeight = 0;
    let sWeight = 0;
    let bags = 0;
    let katta = 0;
    let hkatta = 0;
    let netWeight = 0;
    let gWeight = 0;
    for (const r of rows) {
      rQnty += num(r, 'R_QNTY', 'r_qnty');
      sQnty += num(r, 'S_QNTY', 's_qnty');
      rWeight += num(r, 'R_WEIGHT', 'r_weight');
      sWeight += num(r, 'S_WEIGHT', 's_weight');
      bags += num(r, 'BAGS', 'bags');
      katta += num(r, 'KATTA', 'katta');
      hkatta += num(r, 'HKATTA', 'hkatta');
      netWeight += num(r, 'WEIGHT', 'weight');
      gWeight += num(r, 'G_WEIGHT', 'g_weight');
    }
    return { rQnty, sQnty, rWeight, sWeight, bags, katta, hkatta, netWeight, gWeight };
  }, [rows]);

  const pdfMetaDetail = useMemo(
    () => ({
      companyName: compName,
      endDate: toDisplayDate(endDate),
      godLabel,
      itemCode: detailItem?.code ?? '',
      itemName: detailItem?.name ?? '',
    }),
    [compName, endDate, godLabel, detailItem]
  );

  const detailPdfData = useMemo(() => ({ rows: detailRows }), [detailRows]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!compCode || !compUid) {
      alert('Missing company or schema.');
      return;
    }
    const oracle = toOracleDate(endDate);
    if (!oracle) {
      alert('Please choose ending date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${apiBase}/api/stock-sum`, {
        params: { comp_code: compCode, comp_uid: compUid, e_date: oracle, god_code: godCode.trim() },
        withCredentials: true,
        timeout: 120000,
      });
      setRows(Array.isArray(data) ? data : []);
      setShowReport(true);
    } catch (err) {
      console.error(err);
      const st = err.response?.status;
      setError(
        st === 404
          ? `No /api/stock-sum on ${formatApiOrigin(apiBase)}. Restart the API server with the latest server.cjs.`
          : err.response?.data?.error || err.message || 'Request failed'
      );
    } finally {
      setLoading(false);
    }
  };

  const openDetail = useCallback(
    async (summaryRow) => {
      const code = String(summaryRow.ITEM_CODE ?? summaryRow.item_code ?? '').trim();
      const name = String(summaryRow.ITEM_NAME ?? summaryRow.item_name ?? '').trim();
      if (!code) return;
      const oracle = toOracleDate(endDate);
      if (!oracle) return;
      setDetailItem({ code, name });
      setDetailOpen(true);
      setDetailLoading(true);
      setDetailError('');
      setDetailRows([]);
      try {
        const { data } = await axios.get(`${apiBase}/api/stock-sum-detail`, {
          params: {
            comp_code: compCode,
            comp_uid: compUid,
            item_code: code,
            e_date: oracle,
            god_code: godCode.trim(),
          },
          withCredentials: true,
          timeout: 120000,
        });
        setDetailRows(Array.isArray(data) ? data : []);
      } catch (err) {
        setDetailError(err.response?.data?.error || err.message || 'Failed to load detail');
      } finally {
        setDetailLoading(false);
      }
    },
    [apiBase, compCode, compUid, endDate, godCode]
  );

  const closeDetail = () => {
    setDetailOpen(false);
    setDetailItem(null);
    setDetailRows([]);
    setDetailError('');
  };

  const downloadSummaryPdf = () =>
    generatePDF('stock-sum', summaryPdfData, pdfMetaSummary).catch((err) => alert(String(err?.message || err)));

  const shareSummaryWa = () =>
    sharePdfWithWhatsApp(
      'stock-sum',
      summaryPdfData,
      pdfMetaSummary,
      ['Stock sum', compName, `As on ${pdfMetaSummary.endDate}`, godLabel].join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  const downloadDetailPdf = () =>
    generatePDF('stock-sum-detail', detailPdfData, pdfMetaDetail).catch((err) => alert(String(err?.message || err)));

  const shareDetailWa = () =>
    sharePdfWithWhatsApp(
      'stock-sum-detail',
      detailPdfData,
      pdfMetaDetail,
      ['Stock detail', detailItem?.code, detailItem?.name, compName].filter(Boolean).join('\n')
    ).catch((err) => alert(String(err?.message || err)));

  if (showReport) {
    return (
      <div className="slide slide-report slide-9">
        <div className="report-toolbar">
          <h2>Stock sum</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-toolbar-back" onClick={() => setShowReport(false)}>
              ← Back
            </button>
            <button type="button" className="btn btn-export" onClick={downloadSummaryPdf}>
              Pdf
            </button>
            <button
              type="button"
              className="btn btn-excel"
              onClick={() => {
                try {
                  downloadExcelRows(rows, 'StockSum', `${compName}_StockSum`);
                } catch (e) {
                  alert(String(e?.message || e));
                }
              }}
            >
              📊 Excel
            </button>
            <button type="button" className="btn btn-whatsapp" onClick={shareSummaryWa}>
              💬 WhatsApp
            </button>
          </div>
        </div>

        <div className="report-info">
          <p>
            <strong>As on</strong> {toDisplayDate(endDate)} · <strong>Godown</strong> {godLabel}
          </p>
          <p>
            {compName} | FY {compYear} — click an item row for lot-wise movement and running balance (qty, wt, g wt).
          </p>
        </div>

        <div className="report-display table-responsive">
          <table className="report-table stock-sum-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Name</th>
                <th>Schedule</th>
                <th>Cat</th>
                <th className="text-right">R qty</th>
                <th className="text-right">S qty</th>
                <th className="text-right">R wt</th>
                <th className="text-right">S wt</th>
                <th className="text-right">Bags</th>
                <th className="text-right">Katta</th>
                <th className="text-right">H katta</th>
                <th className="text-right">Net wt</th>
                <th className="text-right">G wt</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.ITEM_CODE ?? r.item_code}-${i}`}
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
                  <td>{r.SCHEDULE ?? r.schedule ?? '—'}</td>
                  <td>{r.CAT_CODE ?? r.cat_code ?? '—'}</td>
                  <td className="text-right">{fmtQty(num(r, 'R_QNTY', 'r_qnty'))}</td>
                  <td className="text-right">{fmtQty(num(r, 'S_QNTY', 's_qnty'))}</td>
                  <td className="text-right">{fmtWt(num(r, 'R_WEIGHT', 'r_weight'))}</td>
                  <td className="text-right">{fmtWt(num(r, 'S_WEIGHT', 's_weight'))}</td>
                  <td className="text-right">{fmtQty(num(r, 'BAGS', 'bags'))}</td>
                  <td className="text-right">{fmtQty(num(r, 'KATTA', 'katta'))}</td>
                  <td className="text-right">{fmtQty(num(r, 'HKATTA', 'hkatta'))}</td>
                  <td className="text-right">{fmtWt(num(r, 'WEIGHT', 'weight'))}</td>
                  <td className="text-right">{fmtWt(num(r, 'G_WEIGHT', 'g_weight'))}</td>
                </tr>
              ))}
              {rows.length > 0 ? (
                <tr className="stock-sum-grand">
                  <td colSpan={4}>
                    <strong>Grand total</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtQty(summaryTotals.rQnty)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtQty(summaryTotals.sQnty)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.rWeight)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.sWeight)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtQty(summaryTotals.bags)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtQty(summaryTotals.katta)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtQty(summaryTotals.hkatta)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.netWeight)}</strong>
                  </td>
                  <td className="text-right">
                    <strong>{fmtWt(summaryTotals.gWeight)}</strong>
                  </td>
                </tr>
              ) : null}
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
          <div
            className="sale-bill-modal-backdrop sale-bill-print-backdrop stock-sum-detail-backdrop"
            role="presentation"
            onClick={closeDetail}
          >
            <div
              className="sale-bill-modal sale-bill-print-modal stock-sum-detail-modal"
              role="dialog"
              aria-labelledby="stock-sum-detail-title"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="sale-bill-modal-head no-print stock-sum-detail-modal-head">
                <h3 id="stock-sum-detail-title">
                  Stock detail — {detailItem?.code}
                  {detailItem?.name ? ` — ${detailItem.name}` : ''}
                </h3>
                <button type="button" className="sale-bill-modal-close" onClick={closeDetail} aria-label="Close">
                  ×
                </button>
                <div className="sale-bill-print-actions">
                  <button type="button" className="btn btn-export" onClick={downloadDetailPdf}>
                    Pdf
                  </button>
                  <button
                    type="button"
                    className="btn btn-excel"
                    onClick={() => {
                      try {
                        const ic = detailItem?.code || 'item';
                        downloadExcelRows(detailRows, 'StockDetail', `${compName}_StockDetail_${ic}`);
                      } catch (e) {
                        alert(String(e?.message || e));
                      }
                    }}
                  >
                    📊 Excel
                  </button>
                  <button type="button" className="btn btn-whatsapp" onClick={shareDetailWa}>
                    💬 WhatsApp
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
                          <th className="text-right">R qty</th>
                          <th className="text-right">S qty</th>
                          <th className="text-right">R wt</th>
                          <th className="text-right">S wt</th>
                          <th className="text-right">R g wt</th>
                          <th className="text-right">S g wt</th>
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
                            <td className="text-right">{fmtQty(num(r, 'R_QNTY', 'r_qnty'))}</td>
                            <td className="text-right">{fmtQty(num(r, 'S_QNTY', 's_qnty'))}</td>
                            <td className="text-right">{fmtWt(num(r, 'R_WEIGHT', 'r_weight'))}</td>
                            <td className="text-right">{fmtWt(num(r, 'S_WEIGHT', 's_weight'))}</td>
                            <td className="text-right">{fmtWt(num(r, 'R_G_WEIGHT', 'r_g_weight'))}</td>
                            <td className="text-right">{fmtWt(num(r, 'SG_WEIGHT', 'sg_weight'))}</td>
                            <td className="text-right stock-sum-run">{fmtQty(runQ)}</td>
                            <td className="text-right stock-sum-run">{fmtWt(runW)}</td>
                            <td className="text-right stock-sum-run">{fmtWt(runG)}</td>
                          </tr>
                        ))}
                        {runningDetail.length > 0 ? (
                          <tr className="stock-sum-grand">
                            <td colSpan={14}>
                              <strong>Grand total (closing balance)</strong>
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
    <div className="slide slide-9">
      <h2>Stock sum</h2>
      <p className="company-info">
        {compName} | FY {compYear}
        <br />
        <span className="compdet-date-hint">
          Item-wise totals from <strong>LOTSTOCK</strong> up to the ending date. Optional godown filter. Click a row in
          the result for lot-wise lines with <strong>running balance</strong> (R − S) for qty, weight, and gross weight.
        </span>
      </p>

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
          <label htmlFor="ss-end">Ending date</label>
          <input
            id="ss-end"
            type="date"
            lang="en-GB"
            className="form-input"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="ss-god">Godown code (optional)</label>
          <input
            id="ss-god"
            type="text"
            className="form-input"
            placeholder="Leave blank for all godowns"
            value={godCode}
            onChange={(e) => setGodCode(e.target.value)}
            autoComplete="off"
          />
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
