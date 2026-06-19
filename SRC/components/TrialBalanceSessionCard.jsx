import React from 'react';
import { toDisplayDate, toInputDateString } from '../utils/dateFormat';
import { useAppSession } from './AppSessionContext';
import SessionToolbarChrome from './SessionToolbarChrome';

/** Company / FY context card with help, settings, and voice actions. */
export default function TrialBalanceSessionCard({
  formData,
  helpReportId = 'trial-balance',
  helpViewKey = null,
  asOfLabel = null,
  compact = false,
}) {
  const session = useAppSession();
  const compName = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim();
  const compCode = String(formData?.comp_code ?? formData?.COMP_CODE ?? '').trim();
  const compYear = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim();
  const user = String(session.userName ?? '').trim();
  const sLabel = toDisplayDate(toInputDateString(formData?.comp_s_dt ?? formData?.COMP_S_DT));
  const eLabel = toDisplayDate(toInputDateString(formData?.comp_e_dt ?? formData?.COMP_E_DT));

  const fyLine = [compYear ? `FY ${compYear}` : '', sLabel && eLabel ? `${sLabel} – ${eLabel}` : '']
    .filter(Boolean)
    .join(' | ');
  const ctxLine = [compCode, user].filter(Boolean).join(' | ');
  const compactMeta = [fyLine, ctxLine].filter(Boolean).join(' · ');

  return (
    <>
      <div className={`fas-tb-session-card${compact ? ' fas-tb-session-card--compact' : ''}`}>
        <div className="fas-tb-session-card__text">
          <div className="fas-tb-session-card__company">{compName || '—'}</div>
          {compact ? (
            compactMeta ? <div className="fas-tb-session-card__meta">{compactMeta}</div> : null
          ) : (
            <>
              {fyLine ? <div className="fas-tb-session-card__meta">{fyLine}</div> : null}
              {ctxLine ? <div className="fas-tb-session-card__meta">{ctxLine}</div> : null}
            </>
          )}
        </div>
        <div className="fas-tb-session-card__actions">
          <SessionToolbarChrome
            helpReportId={helpReportId}
            helpViewKey={helpViewKey}
            helpCompanyName={compName}
          />
        </div>
      </div>
      {asOfLabel ? (
        <div className="fas-tb-asof-pill">
          <span className="fas-tb-asof-pill__icon" aria-hidden="true">
            🏢
          </span>
          As of {asOfLabel}
        </div>
      ) : null}
    </>
  );
}
