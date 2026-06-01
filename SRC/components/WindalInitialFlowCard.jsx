import React from 'react';
import { WINDAL_BRAND } from '../utils/windalBrand';

/**
 * Centered card for login / company / year (MFFAS-style).
 * @param {'login'|'step'} variant — login shows (FAS) + WINDAL header; step shows title bar only
 */
export default function WindalInitialFlowCard({
  variant = 'login',
  stepTitle = '',
  stepIcon = null,
  headerRight = null,
  settingsSlot = null,
  footer = null,
  children,
}) {
  const loginTools = variant === 'login' && settingsSlot ? settingsSlot : null;
  const stepTools = variant === 'step' && settingsSlot ? settingsSlot : null;

  return (
    <div className="windal-initial-page">
      <div className="windal-initial-card">
        {variant === 'login' ? (
          <div className="windal-initial-card__brand">
            {loginTools ? <div className="windal-initial-card__brand-tools">{loginTools}</div> : null}
            <div className="windal-initial-card__fas">{WINDAL_BRAND.fasPrefix}</div>
            <div className="windal-initial-card__brand-row">
              <div className="windal-initial-logo" aria-hidden="true">
                {WINDAL_BRAND.logoLetter}
              </div>
              <div className="windal-initial-card__titles">
                <div className="windal-initial-product">{WINDAL_BRAND.productName}</div>
                <div className="windal-initial-tagline">{WINDAL_BRAND.tagline}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="windal-initial-card__step-head">
            <div className="windal-initial-card__step-title-wrap">
              {stepIcon ? <span className="windal-initial-card__step-icon" aria-hidden="true">{stepIcon}</span> : null}
              <span className="windal-initial-card__step-title">{stepTitle}</span>
            </div>
            {(stepTools || headerRight) ? (
              <div className="windal-initial-card__step-aside">
                {stepTools ? <div className="windal-initial-card__step-tools">{stepTools}</div> : null}
                {headerRight ? <div className="windal-initial-card__step-user">{headerRight}</div> : null}
              </div>
            ) : null}
          </div>
        )}

        {variant === 'login' && stepTitle ? (
          <div className="windal-initial-band">
            <span>{stepTitle}</span>
          </div>
        ) : null}

        <div className="windal-initial-body">{children}</div>

        {footer ? <div className="windal-initial-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
