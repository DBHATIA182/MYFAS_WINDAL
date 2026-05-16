import React from 'react';
import { resolveSaleEntryFinYear, finYearRangeLabel } from '../utils/saleEntryFinYear';

/**
 * Top strip: screen name, financial year dates, logged-in user (sales order / dispatch / sale bill).
 */
export default function SaleEntryFinYearStrip({ screenTitle, formData, ctx, userName, companyName }) {
  const { compYear, fyMinYmd, fyMaxYmd, gFinYear } = resolveSaleEntryFinYear(formData, ctx);
  const range = finYearRangeLabel(fyMinYmd, fyMaxYmd);
  const fyLabel = compYear || gFinYear || '—';

  return (
    <div className="sale-entry-fy-strip" role="status" aria-label="Financial year and user">
      <span className="sale-entry-fy-strip__screen">{screenTitle}</span>
      <span className="sale-entry-fy-strip__sep" aria-hidden="true">
        |
      </span>
      <span className="sale-entry-fy-strip__fy">
        <span className="sale-entry-fy-strip__k">FY</span> {fyLabel}
        <span className="sale-entry-fy-strip__dates">
          {' '}
          (<strong>{range}</strong>)
        </span>
      </span>
      {companyName ? (
        <>
          <span className="sale-entry-fy-strip__sep" aria-hidden="true">
            |
          </span>
          <span className="sale-entry-fy-strip__co">{companyName}</span>
        </>
      ) : null}
      <span className="sale-entry-fy-strip__sep" aria-hidden="true">
        |
      </span>
      <span className="sale-entry-fy-strip__user">
        <span className="sale-entry-fy-strip__k">User</span>{' '}
        <strong>{userName || '—'}</strong>
      </span>
    </div>
  );
}
