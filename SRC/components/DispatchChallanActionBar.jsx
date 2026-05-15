import React from 'react';

/** Highlighted toolbar frame for dispatch challan screens (top or bottom). */
export function DcActionBar({ children, position = 'top', label = 'Actions' }) {
  const posClass = position === 'bottom' ? 'dc-action-bar--bottom' : 'dc-action-bar--top';
  return (
    <div className={`dc-action-bar ${posClass}`} role="toolbar" aria-label={label}>
      <div className="dc-action-bar__inner button-group sale-bill-actions">{children}</div>
    </div>
  );
}
