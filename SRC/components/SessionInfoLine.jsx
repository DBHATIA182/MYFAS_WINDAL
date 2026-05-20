import React from 'react';
import { buildAppSessionLine } from '../utils/appSessionLine';
import { useAppSession } from './AppSessionContext';
import AppSessionLine from './AppSessionLine';

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
export default function SessionInfoLine({ formData, userName, companyName, ctx, children, className = '', as = 'p' }) {
  return (
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
}
