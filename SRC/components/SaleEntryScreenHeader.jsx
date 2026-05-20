import React from 'react';
import ReportHelpButton from './ReportHelpButton';

/**
 * Compact header for sale bill / dispatch / sales order — session bar + title + actions in minimal height.
 */
export default function SaleEntryScreenHeader({ title, reportId, topBar, nav, children, extra }) {
  return (
    <header className="sale-entry-screen-header">
      {topBar}
      <div className="sale-entry-screen-header__bar">
        <div className="sale-entry-screen-header__title-wrap">
          <h2 className="sale-entry-screen-header__title">{title}</h2>
          {reportId ? <ReportHelpButton reportId={reportId} /> : null}
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
