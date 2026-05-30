import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { buildProductionPrintDocumentHtml, generatePDF, sharePdfWithWhatsApp } from '../utils/pdfgenerator';
import { openHtmlPrintWindow, printHtmlDocument } from '../utils/openPrintPreviewWindow';
import { toOracleDate, toDisplayDate } from '../utils/dateFormat';

const reqOpts = { withCredentials: true, timeout: 120000 };

function isTransientDbError(msg) {
  return /ORA-03113|ORA-03114|NJS-500|connection was closed|end-of-file on communication channel/i.test(
    String(msg || '')
  );
}

export default function ProductionPrintModal({
  open,
  onClose,
  apiBase,
  formData,
  defaultSDateYmd,
  defaultSNo,
}) {
  const compCode = formData?.comp_code ?? formData?.COMP_CODE;
  const compUid = formData?.comp_uid ?? formData?.COMP_UID;
  const compName = formData?.comp_name ?? formData?.COMP_NAME ?? '';

  const previewFrameRef = useRef(null);
  const blobUrlRef = useRef('');
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [previewBlobUrl, setPreviewBlobUrl] = useState('');
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 768px)').matches : false
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const loadDoc = useCallback(async () => {
    if (!defaultSDateYmd || !String(defaultSNo ?? '').trim()) {
      setErr('Date and Sr.No. are required.');
      return;
    }
    setLoading(true);
    setErr('');
    try {
      let data;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await axios.get(`${apiBase}/api/production-entry`, {
            params: {
              comp_code: compCode,
              comp_uid: compUid,
              s_date: toOracleDate(defaultSDateYmd),
              s_no: String(defaultSNo).trim(),
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
        setErr('No production voucher for this date and Sr.No.');
        return;
      }
      const h = data.header;
      setDoc({
        header: {
          s_date: toDisplayDate(defaultSDateYmd),
          s_no: h.s_no ?? h.S_NO ?? defaultSNo,
          item: h.item ?? h.ITEM,
          item_name: h.item_name ?? h.mill_item_name ?? '',
          milling: h.milling ?? h.MILLING,
          m_qnty: h.m_qnty ?? h.M_QNTY,
          m_status: h.m_status ?? h.M_STATUS,
          plant_code: h.plant_code ?? h.PLANT_CODE,
        },
        lines: (data.lines || [])
          .map((L) => ({
            item_code: L.item_code ?? L.ITEM_CODE,
            item_name: L.item_name ?? L.LINE_ITEM_NAME ?? '',
            prod_per: L.prod_per ?? L.PROD_PER,
            qnty: L.qnty ?? L.QNTY,
            status: L.status ?? L.STATUS,
            weight: L.weight ?? L.WEIGHT,
            short: L.short ?? L.SHORT,
          }))
          .filter((L) => String(L.item_code ?? '').trim()),
      });
    } catch (e) {
      setDoc(null);
      setErr(e?.response?.data?.error || e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase, compCode, compUid, defaultSDateYmd, defaultSNo]);

  useEffect(() => {
    if (!open) {
      setDoc(null);
      setErr('');
      setPreviewBlobUrl('');
      return undefined;
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    void loadDoc();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loadDoc, onClose]);

  useEffect(
    () => () => {
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch (_) {}
        blobUrlRef.current = '';
      }
    },
    []
  );

  const pdfMeta = useMemo(
    () => ({
      companyName: compName,
      sDate: doc?.header?.s_date,
      sNo: doc?.header?.s_no,
    }),
    [compName, doc]
  );

  const previewDocumentHtml = useMemo(() => {
    if (!doc) return '';
    try {
      return buildProductionPrintDocumentHtml(doc, pdfMeta);
    } catch (e) {
      console.error('production print document:', e);
      return '';
    }
  }, [doc, pdfMeta]);

  useEffect(() => {
    if (blobUrlRef.current) {
      try {
        URL.revokeObjectURL(blobUrlRef.current);
      } catch (_) {}
      blobUrlRef.current = '';
    }
    if (!previewDocumentHtml) {
      setPreviewBlobUrl('');
      return undefined;
    }
    try {
      const blob = new Blob([previewDocumentHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPreviewBlobUrl(url);
    } catch (e) {
      console.error('production print blob url:', e);
      setPreviewBlobUrl('');
    }
    return () => {
      if (blobUrlRef.current) {
        try {
          URL.revokeObjectURL(blobUrlRef.current);
        } catch (_) {}
        blobUrlRef.current = '';
      }
    };
  }, [previewDocumentHtml]);

  const previewReady = !loading && !!previewDocumentHtml;

  const handlePrint = useCallback(() => {
    if (!previewDocumentHtml) {
      alert('Nothing to print yet.');
      return;
    }
    const title = `Production ${doc?.header?.s_no ?? ''}`;
    if (isMobile) {
      openHtmlPrintWindow(previewDocumentHtml, { title });
      return;
    }
    printHtmlDocument(previewDocumentHtml, {
      existingFrame: previewFrameRef.current,
    });
  }, [previewDocumentHtml, isMobile, doc?.header?.s_no]);

  const handlePdf = useCallback(() => {
    if (!doc) return;
    generatePDF('production-print', doc, pdfMeta).catch((e) => alert(e?.message || String(e)));
  }, [doc, pdfMeta]);

  const handleWhatsApp = useCallback(() => {
    if (!doc) return;
    sharePdfWithWhatsApp('production-print', doc, pdfMeta, `${compName}\nProduction ${doc?.header?.s_no}`).catch((e) =>
      alert(e?.message || String(e))
    );
  }, [doc, pdfMeta, compName]);

  if (!open) return null;

  const portalTarget = typeof document !== 'undefined' ? document.body : null;
  if (!portalTarget) return null;

  const toolbarButtons = (
    <>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void loadDoc()}>
        {loading ? '…' : 'Reload'}
      </button>
      <button type="button" className="btn btn-secondary" disabled={!previewReady} onClick={handlePrint}>
        Print
      </button>
      <button type="button" className="btn btn-export" disabled={!doc} onClick={handlePdf}>
        PDF
      </button>
      <button type="button" className="btn btn-whatsapp" disabled={!doc} onClick={handleWhatsApp}>
        WhatsApp
      </button>
    </>
  );

  const modal = (
    <div
      className="sale-bill-modal-backdrop sale-bill-print-backdrop dc-print-modal-backdrop prod-print-modal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={[
          'sale-bill-modal',
          'sale-bill-print-modal',
          'prod-print-modal',
          isMobile ? 'sale-bill-print-modal--mobile prod-print-modal--mobile' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-labelledby="prod-print-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sale-bill-modal-head no-print">
          <h3 id="prod-print-modal-title">
            Production print
            {doc?.header ? ` · ${doc.header.s_date} / Sr.${doc.header.s_no}` : ''}
          </h3>
          {!isMobile ? (
            <div className="sale-bill-print-actions">
              {toolbarButtons}
              <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
                ×
              </button>
            </div>
          ) : (
            <button type="button" className="sale-bill-modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          )}
        </div>
        <div className="sale-bill-modal-body sale-bill-print-body prod-print-modal-body">
          {loading ? <p className="sale-bill-section__hint">Loading voucher…</p> : null}
          {err ? <p className="deploy-update-msg deploy-update-msg--err">{err}</p> : null}
          {previewReady ? (
            <>
              {isMobile ? (
                <p className="prod-print-mobile-hint no-print">
                  Swipe sideways on the report if needed. Tap Print for the system print dialog.
                </p>
              ) : null}
              <div className={isMobile ? 'prod-print-mobile-preview-wrap' : 'prod-print-desktop-preview-wrap'}>
                <iframe
                  ref={previewFrameRef}
                  title="Production print preview"
                  className={
                    isMobile ? 'sale-bill-mobile-pdf-preview prod-print-mobile-preview' : 'prod-print-desktop-preview'
                  }
                  src={previewBlobUrl || undefined}
                />
              </div>
            </>
          ) : null}
          {!loading && !err && !previewReady ? (
            <p className="sale-bill-section__hint">No voucher to show.</p>
          ) : null}
        </div>
        {isMobile ? (
          <footer className="sale-bill-print-mobile-bar no-print" role="toolbar" aria-label="Print actions">
            <div className="sale-bill-print-actions sale-bill-print-actions--mobile-bar prod-print-mobile-actions">
              {toolbarButtons}
            </div>
          </footer>
        ) : null}
      </div>
    </div>
  );

  return createPortal(modal, portalTarget);
}
