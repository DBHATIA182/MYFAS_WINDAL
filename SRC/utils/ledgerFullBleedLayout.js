/** Force ledger/trial report shells to use the full viewport (beats .slide 800px card layout). */

const LAYOUT_TARGETS = [
  ['html', { width: '100%', 'max-width': 'none', overflow: 'hidden' }],
  [
    'body',
    {
      width: '100%',
      'max-width': 'none',
      margin: '0',
      padding: '0',
      overflow: 'hidden',
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
    },
  ],
  ['#root', { width: '100%', 'max-width': 'none', 'min-height': '100dvh', height: '100dvh' }],
  [
    '.app',
    {
      width: '100vw',
      'max-width': 'none',
      'min-height': '100dvh',
      height: '100dvh',
      margin: '0',
      padding: '0',
      overflow: 'hidden',
    },
  ],
  [
    '.app-main',
    {
      width: '100vw',
      'max-width': 'none',
      'align-items': 'stretch',
      'justify-content': 'stretch',
      padding: '0',
      margin: '0',
      overflow: 'hidden',
      flex: '1 1 auto',
      'min-height': '0',
    },
  ],
];

function applyImportantStyles(el, props) {
  if (!el) return () => {};
  const prev = {};
  for (const [key, value] of Object.entries(props)) {
    prev[key] = el.style.getPropertyValue(key);
    el.style.setProperty(key, value, 'important');
  }
  return () => {
    for (const key of Object.keys(props)) {
      if (prev[key]) el.style.setProperty(key, prev[key]);
      else el.style.removeProperty(key);
    }
  };
}

export function mountLedgerFullBleedLayout() {
  document.documentElement.classList.add('fas-ledger-report-fullpage');
  document.body.classList.add('fas-ledger-report-fullpage');
  const cleanups = LAYOUT_TARGETS.map(([selector, props]) =>
    applyImportantStyles(document.querySelector(selector), props)
  );
  return () => {
    document.documentElement.classList.remove('fas-ledger-report-fullpage');
    document.body.classList.remove('fas-ledger-report-fullpage');
    cleanups.forEach((fn) => fn());
  };
}

export const LEDGER_SHELL_STYLE = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100vw',
  maxWidth: 'none',
  height: '100dvh',
  minHeight: 0,
  margin: 0,
  padding: 0,
  borderRadius: 0,
  boxShadow: 'none',
  background: 'transparent',
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

export const LEDGER_FLOW_STYLE = {
  width: '100%',
  maxWidth: 'none',
  flex: '1 1 auto',
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};
