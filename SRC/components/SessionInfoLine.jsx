import React from 'react';
import { buildAppSessionLine } from '../utils/appSessionLine';
import { useAppSession } from './AppSessionContext';
import AppSessionLine from './AppSessionLine';
import SessionToolbarChrome from './SessionToolbarChrome';

/** Inline text only (report toolbars). */
export function SessionLineText({ formData, userName, companyName, ctx }) {
  const session = useAppSession();
  return buildAppSessionLine({
    formData: formData ?? session.formData,
    userName: userName ?? session.userName,
    companyName,
    ctx,
  });
}

/** Standard company-info row on report / menu slides. */
export default function SessionInfoLine({
  formData,
  userName,
  companyName,
  ctx,
  children,
  className = '',
  as = 'p',
  actions,
  helpReportId,
  helpViewKey,
  helpLabel,
  helpCompanyName,
  helpShowFullGuidePdf,
  helpIncludeSalesEntry,
  helpIncludeStockLot,
}) {
  const session = useAppSession();
  const hasHelp = Boolean(helpReportId);
  const chrome =
    actions ??
    (hasHelp || session.headerActions ? (
      <SessionToolbarChrome
        helpReportId={helpReportId}
        helpViewKey={helpViewKey}
        helpLabel={helpLabel}
        helpCompanyName={helpCompanyName ?? formData?.comp_name ?? formData?.COMP_NAME ?? ''}
        helpShowFullGuidePdf={helpShowFullGuidePdf}
        helpIncludeSalesEntry={helpIncludeSalesEntry}
        helpIncludeStockLot={helpIncludeStockLot}
      />
    ) : null);

  const line = (
    <AppSessionLine
      as={as}
      formData={formData}
      userName={userName}
      companyName={companyName}
      ctx={ctx}
      className={['company-info', className].filter(Boolean).join(' ')}
    >
      {children}
    </AppSessionLine>
  );

  if (!chrome) return line;

  return (
    <div className="session-info-line session-info-line--with-actions">
      <div className="session-info-line__main">{line}</div>
      <div className="session-info-line__actions">{chrome}</div>
    </div>
  );
}
