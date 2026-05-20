import React from 'react';
import AppSessionLine from './AppSessionLine';

/** Report/menu screens — session line only (no user rights). */
export default function SaleEntryFinYearStrip(props) {
  return <AppSessionLine {...props} className="sale-entry-fy-strip" />;
}
