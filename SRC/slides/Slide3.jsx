import React from 'react';
import WindalDashboardMenu from '../components/WindalDashboardMenu';
import { exitApp } from '../utils/exitApp';

export { REPORT_MENU, FLAT_REPORT_ORDER, categoryForReport } from '../data/reportMenuConfig';

export default function Slide3({ onPrev, onNext, formData, onExit }) {
  return (
    <div className="slide slide-3 slide-windal-dashboard">
      <WindalDashboardMenu
        formData={formData}
        onPrev={onPrev}
        onNext={onNext}
        onExit={onExit ?? exitApp}
      />
    </div>
  );
}
