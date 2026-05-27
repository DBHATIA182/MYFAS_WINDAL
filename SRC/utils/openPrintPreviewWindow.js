/**
 * Open HTML in a new tab for viewing (no print dialog).
 */
export function openPrintPreviewWindow(htmlDocument, { title = 'Print preview' } = {}) {
  if (!htmlDocument) return null;

  let doc = htmlDocument;
  if (title) {
    const safeTitle = String(title).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/<title>[^<]*<\/title>/i.test(doc)) {
      doc = doc.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);
    } else if (/<head[^>]*>/i.test(doc)) {
      doc = doc.replace(/<head[^>]*>/i, (m) => `${m}<title>${safeTitle}</title>`);
    }
  }

  const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    URL.revokeObjectURL(url);
    alert('Allow pop-ups to open the preview in a new tab.');
    return null;
  }
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, 300_000);
  w.focus();
  return w;
}

/**
 * Print an HTML document without blanking the app shell.
 * Uses a hidden iframe so parent @media print { body * { visibility:hidden } } is not applied.
 */
export function printHtmlDocument(htmlDocument, { existingFrame = null } = {}) {
  if (!htmlDocument) {
    alert('Nothing to print yet.');
    return false;
  }

  const frame = existingFrame || document.createElement('iframe');
  const owned = !existingFrame;
  if (owned) {
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'Print frame';
    frame.className = 'dc-print-silent-frame';
    document.body.appendChild(frame);
  }

  const runPrint = () => {
    try {
      const win = frame.contentWindow;
      if (!win) throw new Error('Print frame not ready');
      win.focus();
      win.print();
    } catch (err) {
      alert(String(err?.message || err || 'Print failed'));
    } finally {
      if (owned) {
        setTimeout(() => {
          try {
            frame.remove();
          } catch {
            /* ignore */
          }
        }, 2000);
      }
    }
  };

  if (existingFrame && frame.srcdoc === htmlDocument) {
    const doc = frame.contentDocument;
    if (doc?.readyState === 'complete') {
      runPrint();
      return true;
    }
    frame.onload = runPrint;
    return true;
  }

  frame.onload = runPrint;
  frame.srcdoc = htmlDocument;
  return true;
}
