import React from 'react';
import { buildAppSessionLine } from '../utils/appSessionLine';
import { useAppSession } from './AppSessionContext';

/**
 * One-line: comp_code - comp_name FY year start end comp_uid user
 */
export default function AppSessionLine({
  formData: formDataProp,
  userName: userNameProp,
  companyName,
  ctx,
  className = '',
  as: Tag = 'div',
  children,
}) {
  const session = useAppSession();
  const line = buildAppSessionLine({
    formData: formDataProp ?? session.formData,
    userName: userNameProp ?? session.userName,
    companyName,
    ctx,
  });

  const cls = ['app-session-line', className].filter(Boolean).join(' ');

  if (Tag === 'text') {
    return (
      <>
        {line}
        {children}
      </>
    );
  }

  return (
    <Tag className={cls} role="status" aria-label="Company session">
      <span className="app-session-line__text">{line}</span>
      {children}
    </Tag>
  );
}
