/**
 * Try to close the window (works for popups / some embedded shells).
 * If the browser blocks that, fall back so the app is no longer shown.
 */
export function performExitWindow() {
  window.close();

  window.setTimeout(() => {
    if (window.closed) return;

    try {
      window.open('', '_self');
      window.close();
    } catch (_) {
      /* ignore */
    }

    window.setTimeout(() => {
      if (window.closed) return;
      try {
        window.location.replace('about:blank');
      } catch (_) {
        /* ignore */
      }
    }, 80);
  }, 150);
}

export function exitApp() {
  if (!window.confirm('Exit the application?')) return;
  performExitWindow();
}
