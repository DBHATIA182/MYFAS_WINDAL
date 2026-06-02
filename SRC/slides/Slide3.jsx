import React from 'react';
import WindalDashboardMenu from '../components/WindalDashboardMenu';
import { exitApp } from '../utils/exitApp';

export { REPORT_MENU, FLAT_REPORT_ORDER, categoryForReport } from '../data/reportMenuConfig';

export default function Slide3({ onPrev, onNext, formData, onExit }) {
  return (
    <div
      className="slide slide-3 slide-windal-dashboard"
      style={{ width: '100%', maxWidth: '100%', minWidth: 0, flex: '1 1 auto', alignSelf: 'stretch' }}
    >
      <WindalDashboardMenu
        formData={formData}
        onPrev={onPrev}
        onNext={onNext}
        onExit={onExit ?? exitApp}
      />
    </div>
  );
}
