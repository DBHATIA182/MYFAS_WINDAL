import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SessionToolbarChrome from './SessionToolbarChrome';
import { useAppSession } from './AppSessionContext';
import { exitApp } from '../utils/exitApp';
import { toDisplayDate, toInputDateString } from '../utils/dateFormat';
import {
  REPORT_MENU,
  HOME_MODULE_ID,
  QUICK_ACCESS,
  FLAT_REPORT_ORDER,
  categoryForReport,
  findReportItem,
} from '../data/reportMenuConfig';

function ReportTile({ item, color, icon, onOpen }) {
  const label = item.shortTitle || item.title;
  return (
    <button type="button" className="windal-dash__tile" onClick={() => onOpen(item.id)} title={item.description}>
      <span className="windal-dash__tile-icon" style={{ background: `${color}18`, color }} aria-hidden="true">
        {icon || '▣'}
      </span>
      <span className="windal-dash__tile-label">{label}</span>
    </button>
  );
}

export default function WindalDashboardMenu({ formData, onPrev, onNext, onExit }) {
  const session = useAppSession();
  const [activeModuleId, setActiveModuleId] = useState(HOME_MODULE_ID);
  const [reportType, setReportType] = useState('trial-balance');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const contextCompany = String(formData?.comp_name ?? formData?.COMP_NAME ?? '').trim() || '—';
  const compYear = String(formData?.comp_year ?? formData?.COMP_YEAR ?? '').trim();
  const sLabel = toDisplayDate(toInputDateString(formData?.comp_s_dt ?? formData?.COMP_S_DT));
  const eLabel = toDisplayDate(toInputDateString(formData?.comp_e_dt ?? formData?.COMP_E_DT));
  const user = String(session.userName || '').trim() || 'User';
  const fyLabel = compYear ? `Financial Year ${compYear}` : sLabel && eLabel ? `${sLabel} – ${eLabel}` : '';

  const activeModule = useMemo(() => {
    if (activeModuleId === HOME_MODULE_ID) return null;
    return REPORT_MENU.find((m) => m.id === activeModuleId) || REPORT_MENU[0];
  }, [activeModuleId]);

  const openReport = useCallback(
    (id) => {
      setReportType(id);
      setSidebarOpen(false);
      onNext({ reportType: id });
    },
    [onNext]
  );

  const selectModule = (moduleId) => {
    setActiveModuleId(moduleId);
    setSidebarOpen(false);
    if (moduleId !== HOME_MODULE_ID) {
      const mod = REPORT_MENU.find((m) => m.id === moduleId);
      if (mod?.items?.[0]) setReportType(mod.items[0].id);
    }
  };

  const moveReportSelection = useCallback(
    (delta) => {
      const idx = FLAT_REPORT_ORDER.indexOf(reportType);
      const current = idx >= 0 ? idx : 0;
      const nextIdx = (current + delta + FLAT_REPORT_ORDER.length) % FLAT_REPORT_ORDER.length;
      const nextId = FLAT_REPORT_ORDER[nextIdx];
      setReportType(nextId);
      setActiveModuleId(categoryForReport(nextId));
    },
    [reportType]
  );

  useEffect(() => {
    const onDocKeyDown = (e) => {
      if (e.defaultPrevented) return;
      if (document.body.classList.contains('report-help-open')) return;
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveReportSelection(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveReportSelection(-1);
      } else if (e.key === 'Enter' && activeModuleId !== HOME_MODULE_ID) {
        e.preventDefault();
        onNext({ reportType });
      }
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [moveReportSelection, onNext, reportType, activeModuleId, sidebarOpen]);

  const quickTiles = useMemo(
    () =>
      QUICK_ACCESS.map((q, i) => {
        const item = findReportItem(q.reportId);
        if (!item) return null;
        return (
          <ReportTile
            key={`${q.reportId}-${i}`}
            item={{ ...item, shortTitle: q.label || item.shortTitle }}
            color={q.color || item.category?.tileColor || '#2a4fa8'}
            icon={q.icon}
            onOpen={openReport}
          />
        );
      }),
    [openReport]
  );

  const moduleTiles = useMemo(() => {
    if (!activeModule) return null;
    return activeModule.items.map((item) => (
      <ReportTile
        key={item.id}
        item={item}
        color={activeModule.tileColor}
        icon={activeModule.sidebarIcon}
        onOpen={openReport}
      />
    ));
  }, [activeModule, openReport]);

  const moduleStrip = (
    <nav className="windal-dash__module-strip" aria-label="Choose module">
      <button
        type="button"
        className={`windal-dash__module-chip${activeModuleId === HOME_MODULE_ID ? ' is-active' : ''}`}
        onClick={() => selectModule(HOME_MODULE_ID)}
      >
        <span aria-hidden="true">🏠</span> Home
      </button>
      {REPORT_MENU.map((mod) => (
        <button
          key={mod.id}
          type="button"
          className={`windal-dash__module-chip${activeModuleId === mod.id ? ' is-active' : ''}`}
          onClick={() => selectModule(mod.id)}
        >
          <span aria-hidden="true">{mod.sidebarIcon}</span> {mod.sidebarLabel}
        </button>
      ))}
    </nav>
  );

  return (
    <div className={`windal-dash${sidebarOpen ? ' windal-dash--sidebar-open' : ''}`}>
      {sidebarOpen ? (
        <button
          type="button"
          className="windal-dash__backdrop"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      <aside className="windal-dash__sidebar" aria-label="Main modules">
        <div className="windal-dash__brand">
          <span className="windal-dash__brand-logo" aria-hidden="true">
            W
          </span>
          <span className="windal-dash__brand-name">{contextCompany}</span>
        </div>

        <nav className="windal-dash__nav">
          <button
            type="button"
            className={`windal-dash__nav-item${activeModuleId === HOME_MODULE_ID ? ' is-active' : ''}`}
            onClick={() => selectModule(HOME_MODULE_ID)}
          >
            <span className="windal-dash__nav-icon" aria-hidden="true">
              🏠
            </span>
            <span className="windal-dash__nav-label">Home</span>
          </button>
          {REPORT_MENU.map((mod) => (
            <button
              key={mod.id}
              type="button"
              className={`windal-dash__nav-item${activeModuleId === mod.id ? ' is-active' : ''}`}
              onClick={() => selectModule(mod.id)}
            >
              <span className="windal-dash__nav-icon" aria-hidden="true">
                {mod.sidebarIcon}
              </span>
              <span className="windal-dash__nav-label">{mod.sidebarLabel}</span>
              <span className="windal-dash__nav-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </nav>

        <div className="windal-dash__sidebar-foot">
          <button
            type="button"
            className="windal-dash__nav-item windal-dash__nav-item--exit"
            onClick={() => (onExit ? onExit() : exitApp())}
          >
            <span className="windal-dash__nav-icon" aria-hidden="true">
              ⎋
            </span>
            <span className="windal-dash__nav-label">Exit</span>
          </button>
          <div className="windal-dash__user-pill">
            <span className="windal-dash__user-avatar" aria-hidden="true">
              {user.slice(0, 1)}
            </span>
            <span className="windal-dash__user-text">
              <strong>{user}</strong>
            </span>
          </div>
        </div>
      </aside>

      <div className="windal-dash__main">
        <header className="windal-dash__topbar">
          <button
            type="button"
            className="windal-dash__menu-btn"
            aria-label="Open full menu"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((o) => !o)}
          >
            <span className="windal-dash__menu-btn-icon" aria-hidden="true">
              ☰
            </span>
            <span className="windal-dash__menu-btn-label">Menu</span>
          </button>
          <div className="windal-dash__topbar-title">
            <span className="windal-dash__topbar-company">{contextCompany}</span>
            {fyLabel ? <span className="windal-dash__topbar-fy">{fyLabel}</span> : null}
          </div>
          <div className="windal-dash__topbar-actions">
            <SessionToolbarChrome
              helpReportId="reports-menu"
              helpShowFullGuidePdf
              helpLabel="Menu help"
              helpCompanyName={contextCompany}
            />
            <button type="button" className="windal-dash__topbar-exit" onClick={onPrev} title="Change company / year">
              ← Back
            </button>
          </div>
        </header>

        <div className="windal-dash__fy-banner">
          <span>{contextCompany}</span>
          <span>{fyLabel || 'Financial Year'}</span>
        </div>

        <div className="windal-dash__content">
          <div className="windal-dash__welcome">
            <h1 className="windal-dash__welcome-title">
              Welcome, {user}
            </h1>
            <p className="windal-dash__welcome-sub">
              Use quick access below, or pick a module for more reports.
            </p>
          </div>

          {moduleStrip}

          <section className="windal-dash__quick-block" aria-labelledby="windal-quick-access-heading">
            <h2 id="windal-quick-access-heading" className="windal-dash__section-title">
              Quick Access
            </h2>
            <div className="windal-dash__grid windal-dash__grid--quick" role="list">
              {quickTiles}
            </div>
          </section>

          {activeModuleId !== HOME_MODULE_ID && activeModule ? (
            <section className="windal-dash__module-block" aria-labelledby="windal-module-reports-heading">
              <h2 id="windal-module-reports-heading" className="windal-dash__section-title">
                {activeModule.sidebarLabel} — Reports
              </h2>
              <div className="windal-dash__grid windal-dash__grid--module" role="list">
                {moduleTiles}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
