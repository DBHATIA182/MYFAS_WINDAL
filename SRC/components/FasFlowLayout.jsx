import React from 'react';

function StepBar({ step }) {
  return (
    <div className="fas-flow-step-bar" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={`fas-flow-step-dot${i < step ? ' is-done' : ''}${i === step ? ' is-active' : ''}`}
        />
      ))}
    </div>
  );
}

/**
 * Mobile-first “FAS Accounting” chrome: brand or context header + 4-step bar.
 * @param {'brand'|'context'} mode
 * @param {number} step Current step 1–4
 */
export default function FasFlowLayout({
  mode = 'brand',
  step = 1,
  logoLetter = 'F',
  productName = 'FAS',
  productSub = 'ACCOUNTING SUITE',
  contextCompany = '',
  contextSubline = '',
  headerActions = null,
  children,
}) {
  return (
    <div className="fas-flow">
      {mode === 'context' ? (
        <>
          <div className="fas-context-bar">
            <div className="fas-context-info">
              <div className="fas-context-company">{contextCompany || '—'}</div>
              {contextSubline ? <div className="fas-context-fy">{contextSubline}</div> : null}
            </div>
            {headerActions ? <div className="fas-flow-header-actions">{headerActions}</div> : null}
          </div>
          <div className="fas-flow-step-wrap">
            <StepBar step={step} />
          </div>
        </>
      ) : (
        <header className="fas-flow-brand">
          <div className="fas-flow-brand-top">
            <div className="fas-flow-logo">
              <div className="fas-flow-logo-icon">{logoLetter}</div>
              <div>
                <div className="fas-flow-logo-text">{productName}</div>
                <div className="fas-flow-logo-sub">{productSub}</div>
              </div>
            </div>
            {headerActions ? <div className="fas-flow-header-actions">{headerActions}</div> : null}
          </div>
          <StepBar step={step} />
        </header>
      )}

      <div className="fas-flow-body">{children}</div>
    </div>
  );
}
