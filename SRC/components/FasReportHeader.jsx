import React from 'react';

/** Navy report top bar: Back | title (center) | right slot (Run, as-of date, etc.). */
export default function FasReportHeader({
  title,
  onBack,
  backLabel = '← Back',
  rightSlot = null,
  className = '',
}) {
  return (
    <header className={`fas-report-header${className ? ` ${className}` : ''}`}>
      <button type="button" className="fas-report-header__back" onClick={onBack}>
        {backLabel}
      </button>
      <div className="fas-report-header__center">
        <h1 className="fas-report-header__title">{title}</h1>
      </div>
      <div className="fas-report-header__actions">{rightSlot}</div>
    </header>
  );
}
