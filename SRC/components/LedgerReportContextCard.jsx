import React from 'react';
import { rowFieldAny } from '../utils/rowFieldCI';

function nonEmpty(s) {
  if (s == null) return '';
  return String(s).trim();
}

/** Company + account context card for ledger (FAS flow). */
export default function LedgerReportContextCard({
  compHeader,
  companyNameFallback = '',
  account,
  accountNameFallback = '',
  accountCodeFallback = '',
  fyLine = '',
  hint = '',
}) {
  const ch = compHeader && typeof compHeader === 'object' ? compHeader : {};
  const acc = account && typeof account === 'object' ? account : {};

  const compName =
    nonEmpty(rowFieldAny(ch, ['COMP_NAME', 'comp_name'])) || nonEmpty(companyNameFallback);
  const cAdd1 = rowFieldAny(ch, ['COMP_ADD1', 'comp_add1']);
  const cAdd2 = rowFieldAny(ch, ['COMP_ADD2', 'comp_add2']);
  const cGst = rowFieldAny(ch, ['GST_NO', 'gst_no', 'comp_gst', 'GSTIN', 'gstin']);

  const accName =
    nonEmpty(rowFieldAny(acc, ['NAME', 'name'])) || nonEmpty(accountNameFallback);
  const accCode = nonEmpty(rowFieldAny(acc, ['CODE', 'code'])) || nonEmpty(accountCodeFallback);

  return (
    <div className="fas-ledger-context-card">
      <div className="fas-ledger-context-card__company">
        {compName ? <div className="fas-ledger-context-card__company-name">{compName}</div> : null}
        {cAdd1 ? <div className="fas-ledger-context-card__line">{cAdd1}</div> : null}
        {cAdd2 ? <div className="fas-ledger-context-card__line">{cAdd2}</div> : null}
        {cGst ? (
          <div className="fas-ledger-context-card__gst">
            <span className="fas-ledger-context-card__gst-icon" aria-hidden="true">
              🏷
            </span>
            GST: {cGst}
          </div>
        ) : null}
      </div>

      <div className="fas-ledger-context-card__divider" aria-hidden="true" />

      <div className="fas-ledger-context-card__account">
        {accName ? <div className="fas-ledger-context-card__account-name">{accName}</div> : null}
        {accCode ? (
          <div className="fas-ledger-context-card__code-pill">Code: {accCode}</div>
        ) : null}
        {fyLine ? (
          <div className="fas-ledger-context-card__fy">
            <span className="fas-ledger-context-card__fy-icon" aria-hidden="true">
              📅
            </span>
            {fyLine}
          </div>
        ) : null}
        {hint ? <p className="fas-ledger-context-card__hint">{hint}</p> : null}
      </div>
    </div>
  );
}
