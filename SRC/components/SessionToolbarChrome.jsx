import React from 'react';
import { useAppSession } from './AppSessionContext';
import ReportHelpButton from './ReportHelpButton';

/** Help + Settings + Voice on one compact toolbar row (session line / entry top bar). */
export default function SessionToolbarChrome({
  helpReportId,
  helpViewKey = null,
  helpLabel = 'Help',
  helpCompanyName = '',
  helpShowFullGuidePdf = false,
  helpIncludeSalesEntry = true,
  helpIncludeStockLot = false,
  extraActions = null,
}) {
  const session = useAppSession();

  return (
    <>
      {helpReportId ? (
        <ReportHelpButton
          reportId={helpReportId}
          viewKey={helpViewKey}
          label={helpLabel}
          companyName={helpCompanyName}
          showFullGuidePdf={helpShowFullGuidePdf}
          includeSalesEntry={helpIncludeSalesEntry}
          includeStockLot={helpIncludeStockLot}
          iconOnly
        />
      ) : null}
      {extraActions}
      {session.headerActions}
    </>
  );
}
