/** For error messages: apiBase is '' when the UI uses the Vite /api proxy to port 5001. */
export function formatApiOrigin(apiBase) {
  const s = apiBase != null ? String(apiBase).trim() : '';
  if (s) return s;
  return 'Vite dev (proxies /api → http://localhost:5001)';
}

/** 404 on /api/ledger-voucher usually means the API process was started before that route existed. */
export function formatLedgerVoucherApiError(err, apiBase) {
  const body = err?.response?.data?.error;
  const base = body || err?.message || String(err);
  if (err?.response?.status === 404) {
    return `${base}\n\nRestart the API with the current server.cjs (e.g. stop and run “npm run server” on port 5001). Target: ${formatApiOrigin(apiBase)}. Or run “npm run dev:all” so API + Vite start together.`;
  }
  return base;
}
