import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { buildReportHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { downloadExcelRows } from '../utils/excelExport';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function groupPurchaseOrderPrintRows(rows) {
  const map = new Map();
  for (const r of rows) {
    const rn = r.SO_NO ?? r.so_no;
    const key = String(rn);
    if (!map.has(key)) {
      const rd = r.SO_DATE ?? r.so_date;
      map.set(key, {
        so_no: rn,
        so_date_display: toDisplayDate(toInputDateString(rd)),
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
          po_no: r.PO_NO ?? r.po_no,
          remarks: r.REMARKS ?? r.remarks,
          remarks2: r.REMARKS2 ?? r.remarks2,
        },
        lines: [],
      });
    }
    map.get(key).lines.push(r);
  }
  return Array.from(map.values()).sort((a, b) => (Number(a.so_no) || 0) - (Number(b.so_no) || 0));
}

/** Same iframe document wrapper as sale bill print — styles come from buildReportHtml body. */
function buildPurchaseOrderIframeDoc(bodyHtml) {
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

export default function PurchaseOrderPrintScreen({
  apiBase,
  formData,
  defaultPoNo = '',
  defaultPoDateYmd = '',
  onClose,
}) {
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const fyStart = toInputDateString(formData.comp_s_dt ?? formData.COMP_S_DT);
  const fyEnd = toInputDateString(formData.comp_e_dt ?? formData.COMP_E_DT);

  const [sDate, setSDate] = useState(() => (defaultPoDateYmd || defaultPoNo ? defaultPoDateYmd : fyStart));
  const [eDate, setEDate] = useState(() => defaultPoDateYmd || fyEnd);
  const [sNo, setSNo] = useState(() => String(defaultPoNo ?? '').trim());
  const [eNo, setENo] = useState(() => String(defaultPoNo ?? '').trim());
  const [compdet, setCompdet] = useState(null);
  const [rawRows, setRawRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);
  const [mobilePdfPreview, setMobilePdfPreview] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= 768 : false
  );
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  useEffect(() => {
    const onResize = () => setMobilePdfPreview(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const orders = useMemo(() => groupPurchaseOrderPrintRows(rawRows), [rawRows]);

  const pdfData = useMemo(
    () => ({
      compdet: compdet || {},
      orders,
    }),
    [compdet, orders]
  );

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      apiBase,
      startDate: toDisplayDate(sDate),
      endDate: toDisplayDate(eDate),
      sNo,
      eNo,
    }),
    [compName, apiBase, sDate, eDate, sNo, eNo]
  );

  const shareText = [
    compName,
    'Purchase order',
    `${toDisplayDate(sDate)} to ${toDisplayDate(eDate)}`,
    `SO ${sNo || '0'}–${eNo || '0'}`,
  ].join('\n');

  const previewBodyHtml = useMemo(() => {
    if (!ran || !orders.length) return '';
    return buildReportHtml('purchase-order-print', pdfData, pdfMeta);
  }, [ran, orders.length, pdfData, pdfMeta]);

  const previewIframeHtml = useMemo(() => {
    if (!previewBodyHtml) return '';
    return buildPurchaseOrderIframeDoc(previewBodyHtml);
  }, [previewBodyHtml]);

  const excelRows = useMemo(
    () =>
      rawRows.map((r) => ({
        SoNo: r.SO_NO ?? r.so_no,
        SoDate: toDisplayDate(toInputDateString(r.SO_DATE ?? r.so_date)),
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
        PoNo: r.PO_NO ?? r.po_no,
        Remarks2: r.REMARKS2 ?? r.remarks2,
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
    const sTrim = String(sNo ?? '').trim();
    const eTrim = String(eNo ?? '').trim();
    setLoading(true);
    try {
      const params = {
        comp_code: compCode,
        comp_uid: compUid,
        s_date: toOracleDate(sDate),
        e_date: toOracleDate(eDate),
      };
      if (sTrim !== '') params.s_no = Math.max(0, Math.floor(Number(sTrim)));
      if (eTrim !== '') params.e_no = Math.max(0, Math.floor(Number(eTrim)));
      const { data } = await axios.get(`${apiBase}/api/purchase-order-print`, {
        params,
        ...reqOpts,
      });
      setRawRows(Array.isArray(data) ? data : []);
      setRan(true);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Print load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, sDate, eDate, sNo, eNo]);

  useEffect(() => {
    if (mobilePdfPreview && ran && orders.length > 0) {
      setPreviewModalOpen(true);
    }
    if (!ran) {
      setPreviewModalOpen(false);
    }
  }, [mobilePdfPreview, ran, orders.length]);

  const backToRange = () => {
    setRan(false);
    setRawRows([]);
    setErr('');
    setPreviewModalOpen(false);
  };

  const closePreviewModal = () => setPreviewModalOpen(false);

  const handlePdf = useCallback(() => {
    generatePDF('purchase-order-print', pdfData, pdfMeta).catch((e) => alert(e?.message || String(e)));
  }, [pdfData, pdfMeta]);

  const handleWhatsApp = useCallback(() => {
    sharePdfWithWhatsApp('purchase-order-print', pdfData, pdfMeta, shareText).catch((e) =>
      alert(e?.message || String(e))
    );
  }, [pdfData, pdfMeta, shareText]);

  const openPrintWindow = useCallback(() => {
    if (!previewIframeHtml) {
      alert('Show orders first.');
      return null;
    }
    const w = window.open('', '_blank');
    if (!w) {
      alert('Allow pop-ups to print.');
      return null;
    }
    w.document.write(previewIframeHtml);
    w.document.close();
    return w;
  }, [previewIframeHtml]);

  const handleBrowserPrint = () => {
    const w = openPrintWindow();
    if (!w) return;
    w.onload = () => w.print();
  };

  const hasOrders = orders.length > 0;
  const previewReady = !!previewIframeHtml;

  const printActionButtons = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        ← Back
      </button>
      <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleBrowserPrint}>
        Print
      </button>
      <button type="button" className="btn btn-export" disabled={!hasOrders} onClick={handlePdf}>
        Pdf
      </button>
      <button
        type="button"
        className="btn btn-excel"
        disabled={!rawRows.length}
        onClick={() => downloadExcelRows(excelRows, 'PurchaseOrderPrint', `${compName}_DispatchOrder_Print`)}
      >
        Excel
      </button>
      <button type="button" className="btn btn-whatsapp" disabled={!hasOrders} onClick={handleWhatsApp}>
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
          aria-labelledby="po-print-modal-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sale-bill-modal-head no-print">
            <h3 id="po-print-modal-title">
              Purchase order · {orders.length} · {rawRows.length} line(s)
            </h3>
            <div className="sale-bill-print-actions">
              <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleBrowserPrint}>
                Print
              </button>
              <button type="button" className="btn btn-export" disabled={!hasOrders} onClick={handlePdf}>
                Pdf
              </button>
              <button
                type="button"
                className="btn btn-excel"
                disabled={!rawRows.length}
                onClick={() => downloadExcelRows(excelRows, 'PurchaseOrderPrint', `${compName}_DispatchOrder_Print`)}
              >
                Excel
              </button>
              <button type="button" className="btn btn-whatsapp" disabled={!hasOrders} onClick={handleWhatsApp}>
                WhatsApp
              </button>
              <button type="button" className="sale-bill-modal-close" onClick={closePreviewModal} aria-label="Close">
                ×
              </button>
            </div>
          </div>
          <div className="sale-bill-modal-body sale-bill-print-body">
            <iframe
              title="Purchase order mobile preview"
              className="sale-bill-mobile-pdf-preview"
              srcDoc={previewIframeHtml}
            />
          </div>
        </div>
      </div>
    ) : null;

  return (
    <div className="slide slide-24-purchase-order-print dc-print-screen">
      <header className="dc-print-screen__head">
        <h2 className="sale-bill-page__title">Purchase order print</h2>
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
            <span className="sale-bill-field__label">Starting SO no.</span>
            <input
              type="number"
              min={0}
              className="form-input"
              value={sNo}
              onChange={(e) => setSNo(e.target.value)}
            />
          </label>
          <label className="sale-bill-field">
            <span className="sale-bill-field__label">Ending SO no.</span>
            <input
              type="number"
              min={0}
              className="form-input"
              value={eNo}
              onChange={(e) => setENo(e.target.value)}
            />
          </label>
        </div>
        <div className="dc-print-filters-actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runReport()}>
            {loading ? 'Loading…' : 'Show orders'}
          </button>
          {ran ? (
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={backToRange}>
              Change range
            </button>
          ) : null}
          {ran && mobilePdfPreview && !previewModalOpen ? (
            <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={() => setPreviewModalOpen(true)}>
              View orders
            </button>
          ) : null}
        </div>
      </section>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}

      {!ran && !loading ? (
        <p className="sale-bill-section__hint dc-print-run-hint">
          Enter date and order number range, then click Show orders.
        </p>
      ) : null}

      {ran && !mobilePdfPreview ? (
        <section className="sale-bill-section sale-bill-section--card dc-print-results">
          <div className="dc-print-results__toolbar">
            <p className="sale-bill-totals-summary">
              {orders.length} order(s) · {rawRows.length} line(s)
            </p>
          </div>
          {orders.length ? (
            <iframe
              title="Purchase order print preview"
              className="dc-print-preview-frame"
              srcDoc={previewIframeHtml}
            />
          ) : (
            <p className="sale-bill-section__hint">No orders in the selected range.</p>
          )}
        </section>
      ) : null}

      {ran && mobilePdfPreview && !previewModalOpen ? (
        <p className="sale-bill-section__hint dc-print-mobile-hint">
          {orders.length} order(s) loaded. Tap <strong>View orders</strong> to open preview with Print, Pdf, and
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
              View orders
            </button>
          ) : null}
        </DcActionBar>
      ) : null}

      {previewModal}
    </div>
  );
}
