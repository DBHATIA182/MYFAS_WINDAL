import React, { useEffect, useRef, useState } from 'react';

/** Header export menu — PDF, WhatsApp, Excel, Print (dropdown under ⋮). */
export default function LedgerExportMenu({
  onPdf,
  onWhatsApp,
  onExcel,
  onPrint,
  showPdf = true,
  showWhatsApp = true,
  printDisabled = false,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const run = (fn) => {
    setOpen(false);
    fn?.();
  };

  return (
    <div className="fas-ledger-export-menu" ref={wrapRef}>
      <button
        type="button"
        className="fas-ledger-export-menu__btn"
        aria-label="Export options"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        ⋮
      </button>
      {open ? (
        <div className="fas-ledger-export-menu__panel" role="menu">
          {showPdf && onPdf ? (
            <button type="button" role="menuitem" className="fas-ledger-export-menu__item" onClick={() => run(onPdf)}>
              PDF
            </button>
          ) : null}
          {showWhatsApp && onWhatsApp ? (
            <button
              type="button"
              role="menuitem"
              className="fas-ledger-export-menu__item"
              onClick={() => run(onWhatsApp)}
            >
              WhatsApp
            </button>
          ) : null}
          {onExcel ? (
            <button type="button" role="menuitem" className="fas-ledger-export-menu__item" onClick={() => run(onExcel)}>
              Excel
            </button>
          ) : null}
          {onPrint ? (
            <button
              type="button"
              role="menuitem"
              className="fas-ledger-export-menu__item"
              disabled={printDisabled}
              onClick={() => run(onPrint)}
            >
              Print
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
