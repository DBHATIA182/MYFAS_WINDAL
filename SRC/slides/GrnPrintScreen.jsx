import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { buildReportHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';
import { openPrintPreviewWindow, printHtmlDocument } from '../utils/openPrintPreviewWindow';

const reqOpts = { withCredentials: true, timeout: 120000 };

function normChType(raw) {
  const c = String(raw ?? 'I')
    .trim()
    .toUpperCase()
    .slice(0, 1);
  return c || 'I';
}

function groupGrnPrintRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const ct = normChType(r.CH_TYPE ?? r.ch_type);
    const rn = r.R_NO ?? r.r_no;
    const key = `${ct}|${rn}`;
    if (!map.has(key)) {
      const rd = r.R_DATE ?? r.r_date;
      map.set(key, {
        ch_type: ct,
        r_no: rn,
        r_date_display: toDisplayDate(toInputDateString(rd)),
        party: {
          name: r.NAME ?? r.name,
          add1: r.ADD1 ?? r.add1,
          add2: r.ADD2 ?? r.add2,
          city: r.CITY ?? r.city,
          gst: r.GST_NO ?? r.gst_no,
          pan: r.PAN ?? r.pan,
          tel: r.TEL_NO_O ?? r.tel_no_o,
        },
        footer: {
          remarks: r.REMARKS ?? r.remarks,
          truck_no: r.TRUCK_NO ?? r.truck_no,
          tpt: r.TPT ?? r.tpt,
          gr_no: r.GR_NO ?? r.gr_no,
        },
        lines: [],
      });
    }
    map.get(key).lines.push(r);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.ch_type !== b.ch_type) return a.ch_type.localeCompare(b.ch_type);
    return (Number(a.r_no) || 0) - (Number(b.r_no) || 0);
  });
}

/** Same iframe document wrapper as sale bill print — styles come from buildReportHtml body. */
function buildGrnIframeDoc(bodyHtml) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
    </style>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

export default function GrnPrintScreen({
  apiBase,
  formData,
  defaultChType = 'I',
  defaultRNo = '',
  defaultRDateYmd = '',
  onClose,
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sDate, setSDate] = useState(() => defaultRDateYmd || fyStart);
  const [eDate, setEDate] = useState(() => defaultRDateYmd || fyEnd);
  const [sNo, setSNo] = useState(() => String(defaultRNo ?? '').trim());
  const [eNo, setENo] = useState(() => String(defaultRNo ?? '').trim());
  const [chType, setChType] = useState(() => normChType(defaultChType));

  const [compdet, setCompdet] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);
  const [mobilePdfPreview, setMobilePdfPreview] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const previewFrameRef = useRef(null);

  useEffect(() => {
    const onResize = () => setMobilePdfPreview(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const challans = useMemo(() => groupGrnPrintRows(rawRows), [rawRows]);

  const pdfData = useMemo(
    () => ({
      compdet: compdet || {},
      challans,
    }),
    [compdet, challans]
  );

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      apiBase,
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
      chTypeLabel: chType,
      sNo,
      eNo,
    }),
    [compName, apiBase, sDate, eDate, chType, sNo, eNo]
  );

  const shareText = [
    compName,
    'Goods receipt note',
    `${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}`,
    `Type ${normChType(chType)} · Ch ${sNo || '0'}–${eNo || '0'}`,
  ].join('\n');

  const previewBodyHtml = useMemo(() => {
    if (!ran || !challans.length) return '';
    return buildReportHtml('grn-print', pdfData, pdfMeta);
  }, [ran, challans.length, pdfData, pdfMeta]);

  const previewIframeHtml = useMemo(() => {
    if (!previewBodyHtml) return '';
    return buildGrnIframeDoc(previewBodyHtml);
  }, [previewBodyHtml]);

  const excelRows = useMemo(
    () =>
      rawRows.map((r) => ({
        ChType: r.CH_TYPE ?? r.ch_type,
        ChNo: r.R_NO ?? r.r_no,
        ChDate: toDisplayDate(toInputDateString(r.R_DATE ?? r.r_date)),
        Party: r.NAME ?? r.name,
        Trn: r.TRN_NO ?? r.trn_no,
        Item: r.ITEM_CODE ?? r.item_code,
        ItemName: r.ITEM_NAME ?? r.item_name,
        Marka: r.MARKA ?? r.marka,
        HSN: r.HSN_CODE ?? r.hsn_code,
        Unit: r.STATUS ?? r.status,
        Qty: r.QNTY ?? r.qnty,
        Weight: r.WEIGHT ?? r.weight,
        Rate: r.RATE ?? r.rate,
        Amount: r.AMOUNT ?? r.amount,
        Remarks: r.REMARKS ?? r.remarks,
        TruckNo: r.TRUCK_NO ?? r.truck_no,
        Tpt: r.TPT ?? r.tpt,
        GRNo: r.GR_NO ?? r.gr_no,
      })),
    [rawRows]
  );

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${apiBase}/api/compdet-print-header`, {
        params: { comp_code: compCode, comp_uid: compUid },
        ...reqOpts,
      })
      .then((res) => {
        if (!cancelled) setCompdet(res.data || null);
      })
      .catch(() => {
        if (!cancelled) setCompdet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, compCode, compUid]);

  const runReport = useCallback(async () => {
    setErr('');
    if (!sDate || !eDate) {
      setErr('Starting date and ending date are required.');
      return;
    }
    const sn = Math.max(0, Math.floor(Number(sNo) || 0));
    const en = Math.max(sn, Math.floor(Number(eNo) || 0));
    setLoading(true);
    try {
      const { data } = await axios.get(`${apiBase}/api/grn-print`, {
        params: {
          comp_code: compCode,
          comp_uid: compUid,
          s_date: toOracleDate(sDate),
          e_date: toOracleDate(eDate),
          s_no: sn,
          e_no: en,
          ch_type: normChType(chType),
        },
        ...reqOpts,
      });
      setRawRows(Array.isArray(data) ? data : []);
      setRan(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Print load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, sDate, eDate, sNo, eNo, chType]);

  useEffect(() => {
    if (mobilePdfPreview && ran && challans.length > 0) {
      setPreviewModalOpen(true);
    }
    if (!ran) {
      setPreviewModalOpen(false);
    }
  }, [mobilePdfPreview, ran, challans.length]);

  const backToRange = () => {
    setRan(false);
    setRawRows([]);
    setErr('');
    setPreviewModalOpen(false);
  };

  const closePreviewModal = () => setPreviewModalOpen(false);

  const handlePdf = useCallback(() => {
    generatePDF('grn-print', pdfData, pdfMeta).catch((e) => alert(e?.message || String(e)));
  }, [pdfData, pdfMeta]);

  const handleWhatsApp = useCallback(() => {
    sharePdfWithWhatsApp('grn-print', pdfData, pdfMeta, shareText).catch((e) =>
      alert(e?.message || String(e))
    );
  }, [pdfData, pdfMeta, shareText]);

  const handleOpenPreview = useCallback(() => {
    if (!previewIframeHtml) {
      alert('Show goods receipt notes first.');
      return;
    }
    openPrintPreviewWindow(previewIframeHtml, { title: 'Goods receipt note' });
  }, [previewIframeHtml]);

  const handleBrowserPrint = useCallback(() => {
    printHtmlDocument(previewIframeHtml, { existingFrame: previewFrameRef.current });
  }, [previewIframeHtml]);

  const hasChallans = challans.length > 0;
  const previewReady = !!previewIframeHtml;

  const printActionButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        ← Back
      </button>
      <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleOpenPreview}>
        Preview
      </button>
      <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleBrowserPrint}>
        Print
      </button>
      <button type="button" className="btn btn-export" disabled={!hasChallans} onClick={handlePdf}>
        Pdf
      </button>
      <button
        type="button"
        className="btn btn-excel"
        disabled={!rawRows.length}
        onClick={() => downloadExcelRows(excelRows, 'GrnPrint', `${compName}_GRN_Print`)}
      >
        Excel
      </button>
      <button type="button" className="btn btn-whatsapp" disabled={!hasChallans} onClick={handleWhatsApp}>
        WhatsApp
      </button>
    </>
  );

  const previewModal =
    previewModalOpen && mobilePdfPreview && previewReady ? (
      <div
        className="sale-bill-modal-backdrop sale-bill-print-backdrop dc-print-modal-backdrop"
        role="presentation"
        onClick={closePreviewModal}
      >
        <div
          className="sale-bill-modal sale-bill-print-modal"
          role="dialog"
          aria-labelledby="dc-print-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sale-bill-modal-head no-print">
            <h3 id="dc-print-modal-title">
              Goods receipt note · {challans.length} · {rawRows.length} line(s)
            </h3>
            <div className="sale-bill-print-actions">
              <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleOpenPreview}>
                Preview
              </button>
              <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleBrowserPrint}>
                Print
              </button>
              <button type="button" className="btn btn-export" disabled={!hasChallans} onClick={handlePdf}>
                Pdf
              </button>
              <button
                type="button"
                className="btn btn-excel"
                disabled={!rawRows.length}
                onClick={() => downloadExcelRows(excelRows, 'GrnPrint', `${compName}_GRN_Print`)}
              >
                Excel
              </button>
              <button type="button" className="btn btn-whatsapp" disabled={!hasChallans} onClick={handleWhatsApp}>
                WhatsApp
              </button>
              <button type="button" className="sale-bill-modal-close" onClick={closePreviewModal} aria-label="Close">
                ×
              </button>
            </div>
          </div>
          <div className="sale-bill-modal-body sale-bill-print-body">
            <iframe
              ref={previewFrameRef}
              title="Goods receipt note mobile preview"
              className="sale-bill-mobile-pdf-preview"
              srcDoc={previewIframeHtml}
            />
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="slide slide-29-grn-print dc-print-screen">
      <header className="dc-print-screen__head">
        <h2 className="sale-bill-page__title">Goods receipt note print</h2>
      </header>

      {!mobilePdfPreview ? (
        <DcActionBar position="top" label="Print actions">
          {printActionButtons}
        </DcActionBar>
      ) : null}

      <section className="sale-bill-section sale-bill-section--card dc-print-filters">
        <h3 className="sale-bill-section__title">Print range</h3>
        <div className="dc-print-filters-grid">
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Starting date</span>
            <input type="date" className="form-input" value={sDate} onChange={(e) => setSDate(e.target.value)} />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ending date</span>
            <input type="date" className="form-input" value={eDate} onChange={(e) => setEDate(e.target.value)} />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Starting ch.no.</span>
            <input
              type="number"
              min={0}
              className="form-input"
              value={sNo}
              onChange={(e) => setSNo(e.target.value)}
            />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ending ch.no.</span>
            <input
              type="number"
              min={0}
              className="form-input"
              value={eNo}
              onChange={(e) => setENo(e.target.value)}
            />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ch.type</span>
            <input
              className="form-input dc-print-ch-type"
              maxLength={1}
              value={chType}
              onChange={(e) => setChType(normChType(e.target.value))}
            />
          </label>
        </div>
        <div className="dc-print-filters-actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runReport()}>
            {loading ? 'Loading…' : 'Show GRN'}
          </button>
          {ran ? (
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={backToRange}>
              Change range
            </button>
          ) : null}
          {ran && mobilePdfPreview && !previewModalOpen ? (
            <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={() => setPreviewModalOpen(true)}>
              View GRN
            </button>
          ) : null}
        </div>
      </section>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      {!ran && !loading ? (
        <p className="sale-bill-section__hint dc-print-run-hint">
          Enter date and GRN number range, then click Show GRN.
        </p>
      ) : null}

      {ran && !mobilePdfPreview ? (
        <section className="sale-bill-section sale-bill-section--card dc-print-results">
          <div className="dc-print-results__toolbar">
            <p className="sale-bill-totals-summary">
              {challans.length} GRN(s) · {rawRows.length} line(s)
            </p>
            {challans.length ? (
              <>
                <div className="dc-print-results__actions">
                  <button type="button" className="btn btn-primary" disabled={!previewReady} onClick={handleOpenPreview}>
                    Open preview in new tab
                  </button>
                  <p className="sale-bill-section__hint">
                    Or scroll the preview below. Use Print to open the print dialog.
                  </p>
                </div>
                <iframe
                  ref={previewFrameRef}
                  title="Goods receipt note print preview"
                  className="dc-print-preview-frame"
                  srcDoc={previewIframeHtml}
                />
              </>
            ) : (
              <p className="sale-bill-section__hint">No goods receipt notes in the selected range.</p>
            )}
          </div>
        </section>
      ) : null}

      {ran && mobilePdfPreview && !previewModalOpen ? (
        <p className="sale-bill-section__hint dc-print-mobile-hint">
          {challans.length} GRN(s) loaded. Tap <strong>View GRN</strong> to open preview with Print, Pdf, and
          WhatsApp.
        </p>
      ) : null}

      {!mobilePdfPreview ? (
        <DcActionBar position="bottom" label="Print actions">
          {printActionButtons}
        </DcActionBar>
      ) : !previewModalOpen ? (
        <DcActionBar position="bottom" label="Print actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            ← Back
          </button>
          {ran ? (
            <button type="button" className="btn btn-primary" disabled={!previewReady} onClick={() => setPreviewModalOpen(true)}>
              View GRN
            </button>
          ) : null}
        </DcActionBar>
      ) : null}

      {previewModal}
    </div>
  );
}
