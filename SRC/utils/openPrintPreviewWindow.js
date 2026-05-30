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

function frameHasExternalSrc(frame) {
  if (!frame) return false;
  const src = String(frame.getAttribute('src') || frame.src || '').trim();
  return src.length > 0 && src !== 'about:blank';
}

/**
 * Mobile-safe print: new window with full HTML (blob preview iframes often print blank on iOS).
 */
export function openHtmlPrintWindow(htmlDocument, { title = 'Print' } = {}) {
  if (!htmlDocument) {
    alert('Nothing to print yet.');
    return false;
  }

  let doc = htmlDocument;
  if (title) {
    const safeTitle = String(title).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/<title>[^<]*<\/title>/i.test(doc)) {
      doc = doc.replace(/<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);
    } else if (/<head[^>]*>/i.test(doc)) {
      doc = doc.replace(/<head[^>]*>/i, (m) => `${m}<title>${safeTitle}</title>`);
    }
  }

  const w = window.open('', '_blank');
  if (!w) {
    const tab = openPrintPreviewWindow(doc, { title });
    if (tab) {
      alert('Use the browser menu (⋮) → Print, or allow pop-ups and try again.');
    }
    return false;
  }

  w.document.open();
  w.document.write(doc);
  w.document.close();

  const runPrint = () => {
    try {
      w.focus();
      w.print();
    } catch (err) {
      alert(String(err?.message || err || 'Print failed'));
    }
  };

  setTimeout(runPrint, 450);
  return true;
}

/**
 * Print an HTML document without blanking the app shell.
 * Uses a hidden iframe so parent @media print { body * { visibility:hidden } } is not applied.
 */
export function printHtmlDocument(htmlDocument, { existingFrame = null, preferNewWindow = false } = {}) {
  if (!htmlDocument) {
    alert('Nothing to print yet.');
    return false;
  }

  if (preferNewWindow || (existingFrame && frameHasExternalSrc(existingFrame))) {
    return openHtmlPrintWindow(htmlDocument);
  }

  const canReuse =
    existingFrame &&
    !frameHasExternalSrc(existingFrame) &&
    String(existingFrame.srcdoc || '') === String(htmlDocument);

  const frame = canReuse ? existingFrame : document.createElement('iframe');
  const owned = frame !== existingFrame;
  if (owned) {
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'Print frame';
    frame.className = 'dc-print-silent-frame';
    frame.style.cssText =
      'position:fixed;left:-10000px;top:0;width:794px;height:1100px;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);
  }

  const runPrint = () => {
    try {
      const win = frame.contentWindow;
      if (!win) throw new Error('Print frame not ready');
      win.focus();
      win.print();
    } catch (err) {
      if (owned) {
        try {
          frame.remove();
        } catch (_) {}
      }
      return openHtmlPrintWindow(htmlDocument);
    } finally {
      if (owned) {
        setTimeout(() => {
          try {
            frame.remove();
          } catch {
            /* ignore */
          }
        }, 3000);
      }
    }
  };

  if (canReuse) {
    const idoc = frame.contentDocument;
    if (idoc?.readyState === 'complete') {
      runPrint();
      return true;
    }
    frame.onload = runPrint;
    return true;
  }

  frame.onload = runPrint;
  frame.removeAttribute('src');
  frame.srcdoc = htmlDocument;
  return true;
}
