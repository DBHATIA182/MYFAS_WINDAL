import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getReportHelp } from '../data/reportHelpContent';

export default function ReportHelpButton({
  reportId,
  viewKey = null,
  companyName = '',
  appName = 'Windal Accounting',
  showFullGuidePdf = false,
  includeSalesEntry = true,
  includeStockLot = false,
  label = 'Help',
}) {
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [portalReady, setPortalReady] = useState(false);

  const help = useMemo(() => getReportHelp(reportId, viewKey), [reportId, viewKey]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const openHelp = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('report-help-open');
    return () => document.body.classList.remove('report-help-open');
  }, [open]);

  const onDownloadGuide = async () => {
    setPdfBusy(true);
    try {
      const { downloadUserGuidePdf } = await import('../utils/reportHelpPdf');
      await downloadUserGuidePdf({ companyName, appName, includeSalesEntry, includeStockLot });
    } catch (err) {
      alert(String(err?.message || err));
    } finally {
      setPdfBusy(false);
    }
  };

  const modal =
    open && portalReady
      ? createPortal(
          <div
            className="report-help-overlay"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-help-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) setOpen(false);
            }}
          >
            <div className="report-help-dialog" onClick={(e) => e.stopPropagation()}>
              <header className="report-help-dialog__head">
                <h2 id="report-help-title">{help.title}</h2>
                <button type="button" className="report-help-dialog__close" onClick={() => setOpen(false)} aria-label="Close">
                  ×
                </button>
              </header>
              {help.summary ? <p className="report-help-dialog__summary">{help.summary}</p> : null}
              <div className="report-help-dialog__body">
                {(help.sections || []).map((sec) => (
                  <section key={sec.title} className="report-help-section">
                    <h3>{sec.title}</h3>
                    <ul>
                      {(sec.bullets || []).map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <footer className="report-help-dialog__foot">
                {showFullGuidePdf ? (
                  <button type="button" className="btn btn-secondary" disabled={pdfBusy} onClick={onDownloadGuide}>
                    {pdfBusy ? 'Preparing PDF…' : 'Download full user guide (PDF)'}
                  </button>
                ) : null}
                <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
                  Close
                </button>
              </footer>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="btn btn-report-help"
        onClick={openHelp}
        title={`Help: ${help.title}`}
        aria-label={`Help for ${help.title}`}
      >
        <span className="btn-report-help__icon" aria-hidden="true">
          ?
        </span>
        <span className="btn-report-help__label">{label}</span>
      </button>
      {modal}
    </>
  );
}
