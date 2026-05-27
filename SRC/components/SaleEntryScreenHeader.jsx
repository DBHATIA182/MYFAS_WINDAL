import React from 'react';

/**
 * Compact header for sale bill / dispatch / sales order — session bar + title + actions in minimal height.
 * Help lives on the session top bar (SaleEntryTopBar), not here.
 */
export default function SaleEntryScreenHeader({ title, topBar, nav, children, extra }) {
  return (
    <header className="sale-entry-screen-header">
      {topBar}
      <div className="sale-entry-screen-header__bar">
        <div className="sale-entry-screen-header__title-wrap">
          <h2 className="sale-entry-screen-header__title">{title}</h2>
        </div>
        <div className="sale-entry-screen-header__actions" role="toolbar" aria-label={`${title} actions`}>
          {nav ? (
            <span className="sale-entry-screen-header__nav" role="group">
              {nav}
            </span>
          ) : null}
          <span className="sale-entry-screen-header__btns">{children}</span>
        </div>
      </div>
      {extra}
    </header>
  );
}
