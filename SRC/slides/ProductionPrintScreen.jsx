import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { buildProductionPrintDocumentHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { openPrintPreviewWindow, printHtmlDocument } from '../utils/openPrintPreviewWindow';
import { toInputDateString, toOracleDate, toDisplayDate } from '../utils/dateFormat';
import { DcActionBar } from '../components/DispatchChallanActionBar';

const reqOpts = { withCredentials: true, timeout: 120000 };

function isTransientDbError(msg) {
  return /ORA-03113|ORA-03114|NJS-500|connection was closed|end-of-file on communication channel/i.test(
    String(msg || '')
  );
}

function friendlyDbError(msg) {
  const m = String(msg || '');
  if (isTransientDbError(m)) {
    return 'Database connection was interrupted. Click Load again. If it persists, restart the API server.';
  }
  return m || 'Load failed';
}

/** Desktop / tablet full-page production print (mobile uses ProductionPrintModal overlay). */
export default function ProductionPrintScreen({
  apiBase,
  formData,
  defaultSDateYmd,
  defaultSNo,
  onClose,
}) {
  const previewFrameRef = useRef(null);
  const compCode = formData.comp_code ?? formData.COMP_CODE;
  const compUid = formData.comp_uid ?? formData.COMP_UID;
  const compName = formData.comp_name ?? formData.COMP_NAME ?? '';

  const [sDateYmd, setSDateYmd] = useState(() => defaultSDateYmd || toInputDateString(new Date()));
  const [sNo, setSNo] = useState(() => String(defaultSNo ?? ''));
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState(false);

  const loadDoc = useCallback(async () => {
    setErr('');
    if (!sDateYmd || !String(sNo).trim()) {
      setErr('Date and Sr.No. are required.');
      return;
    }
    setLoading(true);
    try {
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await axios.get(`${apiBase}/api/production-entry`, {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              s_date: toOracleDate(sDateYmd),
              s_no: String(sNo).trim(),
            },
            ...reqOpts,
          });
          data = res.data;
          break;
        } catch (e) {
          const msg = e?.response?.data?.error || e.message || '';
          if (attempt === 0 && isTransientDbError(msg)) {
            await new Promise((r) => setTimeout(r, 400));
            continue;
          }
          throw e;
        }
      }
      if (!data?.header) {
        setDoc(null);
        setRan(false);
        setErr('No production voucher for this date and Sr.No.');
        return;
      }
      const h = data.header;
      setDoc({
        header: {
          s_date: toDisplayDate(sDateYmd),
          s_no: h.s_no ?? h.S_NO ?? sNo,
          item: h.item ?? h.ITEM,
          item_name: h.item_name ?? h.mill_item_name ?? '',
          milling: h.milling ?? h.MILLING,
          m_qnty: h.m_qnty ?? h.M_QNTY,
          m_status: h.m_status ?? h.M_STATUS,
          plant_code: h.plant_code ?? h.PLANT_CODE,
        },
        lines: (data.lines || []).map((L) => ({
          item_code: L.item_code ?? L.ITEM_CODE,
          item_name: L.item_name ?? L.LINE_ITEM_NAME ?? '',
          prod_per: L.prod_per ?? L.PROD_PER,
          qnty: L.qnty ?? L.QNTY,
          status: L.status ?? L.STATUS,
          weight: L.weight ?? L.WEIGHT,
          short: L.short ?? L.SHORT,
        })),
      });
      setRan(true);
    } catch (e) {
      setDoc(null);
      setRan(false);
      setErr(friendlyDbError(e?.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, sDateYmd, sNo]);

  useEffect(() => {
    if (defaultSDateYmd && defaultSNo) {
      const t = window.setTimeout(() => void loadDoc(), 80);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, []);

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      sDate: doc?.header?.s_date,
      sNo: doc?.header?.s_no,
    }),
    [compName, doc]
  );

  const previewIframeHtml = useMemo(() => {
    if (!doc) return '';
    return buildProductionPrintDocumentHtml(doc, pdfMeta);
  }, [doc, pdfMeta]);

  const previewReady = !!previewIframeHtml;

  const handleBrowserPrint = useCallback(() => {
    if (!previewReady) return;
    printHtmlDocument(previewIframeHtml, { existingFrame: previewFrameRef.current });
  }, [previewIframeHtml, previewReady]);

  const printActions = (
    <>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        ← Back
      </button>
      <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void loadDoc()}>
        {loading ? 'Loading…' : 'Load'}
      </button>
      <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handleBrowserPrint}>
        Print
      </button>
      <button
        type="button"
        className="btn btn-export"
        disabled={!doc}
        onClick={() => generatePDF('production-print', doc, pdfMeta).catch((e) => alert(e?.message || String(e)))}
      >
        PDF
      </button>
    </>
  );

  return (
    <div className="slide slide-32-production-print dc-print-screen sale-bill-page">
      <header className="dc-print-screen__head">
        <h2 className="sale-bill-page__title">Production — print</h2>
      </header>

      <DcActionBar position="top" label="Print actions">
        {printActions}
      </DcActionBar>

      <section className="sale-bill-section sale-bill-section--card dc-print-filters">
        <div className="dc-print-filters-grid">
          <label>
            Date
            <input type="date" className="form-input" value={sDateYmd} onChange={(e) => setSDateYmd(e.target.value)} />
          </label>
          <label>
            Sr.No.
            <input
              className="form-input"
              value={sNo}
              onChange={(e) => setSNo(e.target.value.replace(/\D/g, '').slice(0, 8))}
            />
          </label>
        </div>
        <div className="dc-print-filters-actions">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void loadDoc()}>
            {loading ? 'Loading…' : 'Load voucher'}
          </button>
        </div>
      </section>

      {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
      {!ran && !loading && !err ? <p className="dc-print-run-hint">Enter date and Sr.No., then Load voucher.</p> : null}

      {ran && previewReady ? (
        <section className="sale-bill-section sale-bill-section--card dc-print-results prod-print-results">
          <p className="sale-bill-totals-summary">
            {doc.header.s_date} / Sr.{doc.header.s_no} — {doc.lines.length} line(s)
          </p>
          <iframe
            ref={previewFrameRef}
            title="Production print preview"
            className="dc-print-preview-frame prod-print-preview-frame"
            srcDoc={previewIframeHtml}
          />
        </section>
      ) : null}

      <DcActionBar position="bottom" label="Print actions">
        {printActions}
      </DcActionBar>
    </div>
  );
}
