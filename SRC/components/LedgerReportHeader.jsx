import React from 'react';
import { rowFieldAny } from '../utils/rowFieldCI';

function nonEmpty(s) {
  if (s == null) return '';
  const t = String(s).trim();
  return t;
}

/**
 * On-screen ledger header: company (compdet) block, then account (MASTER) block.
 */
export default function LedgerReportHeader({
  compHeader,
  companyNameFallback = '',
  account,
  accountCodeFallback = '',
  accountNameFallback = '',
  periodLine,
  hint,
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
  const aAdd1 = rowFieldAny(acc, ['ADD1', 'add1']);
  const aAdd2 = rowFieldAny(acc, ['ADD2', 'add2']);
  const aCity = rowFieldAny(acc, ['CITY', 'city']);
  const aGst = rowFieldAny(acc, ['GST_NO', 'gst_no']);
  const aPan = rowFieldAny(acc, ['PAN', 'pan']);
  const aTel = rowFieldAny(acc, ['TEL_NO_O', 'tel_no_o', 'TEL_NOO', 'tel_noo']);

  return (
    <div className="ledger-report-header">
      <div className="ledger-report-header-company">
        {compName ? (
          <div className="ledger-report-header-company-name">
            <strong>{compName}</strong>
          </div>
        ) : null}
        {cAdd1 ? <div className="ledger-report-header-line">{cAdd1}</div> : null}
        {cAdd2 ? <div className="ledger-report-header-line">{cAdd2}</div> : null}
        {cGst ? (
          <div className="ledger-report-header-line">
            <strong>GST:</strong> {cGst}
          </div>
        ) : null}
      </div>

      <div className="ledger-report-header-account">
        {accName || accCode ? (
          <div className="ledger-report-header-account-title">
            <strong>{accName || '—'}</strong>
            {accCode ? (
              <>
                {' '}
                <span className="ledger-report-header-code">({accCode})</span>
              </>
            ) : null}
          </div>
        ) : null}
        {aAdd1 ? <div className="ledger-report-header-line">{aAdd1}</div> : null}
        {aAdd2 ? <div className="ledger-report-header-line">{aAdd2}</div> : null}
        {(aCity || aGst || aPan || aTel) ? (
          <div className="ledger-report-header-line ledger-report-header-account-meta">
            {[
              aCity ? `City: ${aCity}` : '',
              aGst ? `GST: ${aGst}` : '',
              aPan ? `PAN: ${aPan}` : '',
              aTel ? `Tel: ${aTel}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        ) : null}
      </div>

      {periodLine ? <p className="ledger-report-header-period">{periodLine}</p> : null}
      {hint ? <p className="compdet-date-hint">{hint}</p> : null}
    </div>
  );
}
