import React from 'react';
import { buildAppSessionParts } from '../utils/appSessionLine';

function Pipe() {
  return <span className="sale-entry-top-bar__pipe"> | </span>;
}

/** F1 / F12 rights chips shown inline after user on entry screens. */
export function SaleEntryPermissionPills({ can, className = '' }) {
  if (!can) return null;
  const items = [
    { key: 'open', label: 'ACCESS', ok: !!can.canOpen },
    { key: 'add', label: 'ADD', ok: !!can.canAdd },
    { key: 'edit', label: 'EDIT', ok: !!can.canEdit },
    { key: 'del', label: 'DELETE', ok: !!can.canDelete },
  ];
  return (
    <span className={['sale-bill-page__user-power-rights', className].filter(Boolean).join(' ')}>
      {items.map((it, idx) => (
        <React.Fragment key={it.key}>
          {idx > 0 ? <Pipe /> : null}
          <span className={it.ok ? 'sale-bill-power sale-bill-power--on' : 'sale-bill-power sale-bill-power--off'}>
            {it.label}
            {!it.ok ? <span className="sale-bill-power__x">X</span> : null}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * One top bar for sale bill / dispatch / sales order:
 * comp_code | comp_name | FY … | dates | comp_uid | USER | ACCESS | ADD | …
 */
export default function SaleEntryTopBar({ formData, ctx, userName, companyName, can }) {
  const parts = buildAppSessionParts({ formData, ctx, userName, companyName, includeUser: false });
  const user = String(userName ?? '').trim();

  return (
    <div className="sale-entry-top-bar sale-entry-fy-strip" role="status" aria-label="Company session and user rights">
      <span className="sale-entry-top-bar__line">
        {parts.map((p, i) => (
          <React.Fragment key={`${p}-${i}`}>
            {i > 0 ? <Pipe /> : null}
            <span>{p}</span>
          </React.Fragment>
        ))}
        {user ? (
          <>
            <Pipe />
            <strong className="sale-entry-top-bar__user">{user}</strong>
          </>
        ) : null}
        {can ? (
          <>
            <Pipe />
            <SaleEntryPermissionPills can={can} />
          </>
        ) : null}
      </span>
    </div>
  );
}
