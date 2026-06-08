const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"])',
  'select',
  'textarea',
].join(', ');

function reportFormFocusList(rootEl) {
  if (!rootEl) return [];
  const fields = Array.from(rootEl.querySelectorAll(FIELD_SELECTOR)).filter(
    (el) => !el.disabled && el.getAttribute('tabindex') !== '-1'
  );
  const formId = rootEl.id;
  const submits = formId
    ? Array.from(
        document.querySelectorAll(`button[type="submit"][form="${formId}"]:not(:disabled)`)
      )
    : Array.from(rootEl.querySelectorAll('button[type="submit"]:not(:disabled)'));
  return [...fields, ...submits.filter((el) => el.getAttribute('tabindex') !== '-1')];
}

/** Move focus to the next enabled field in a report form (Enter-as-Tab). */
export function focusNextReportField(rootEl, currentEl) {
  if (!rootEl || !currentEl) return false;
  const list = reportFormFocusList(rootEl);
  const i = list.indexOf(currentEl);
  if (i < 0 || i >= list.length - 1) return false;
  const next = list[i + 1];
  next.focus();
  if (next.tagName === 'INPUT' && typeof next.select === 'function') {
    try {
      next.select();
    } catch (_) {}
  }
  return true;
}

export function advanceReportFormOnEnter(e, rootEl) {
  if (e.key !== 'Enter') return false;
  const t = e.target;
  if (!t || t.tagName === 'TEXTAREA') return false;
  if (t.closest('.account-search-results')) return false;
  if (t.type === 'submit') return false;
  e.preventDefault();
  e.stopPropagation();
  return focusNextReportField(rootEl, t);
}

/** Scroll focused field into view after mobile keyboard opens. */
export function scrollReportFieldIntoView(el) {
  if (!el) return;
  setTimeout(() => {
    try {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (_) {
      try {
        el.scrollIntoView();
      } catch (_) {}
    }
  }, 300);
}

/** Touch-safe pick from account-search dropdown (works on iOS). */
export function pickSearchResult(e, handler) {
  e.preventDefault();
  e.stopPropagation();
  handler();
}

/** Date inputs often swallow Enter — attach directly on each date field. */
export function handleReportDateEnter(e, rootEl) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.stopPropagation();
  focusNextReportField(rootEl, e.target);
}
