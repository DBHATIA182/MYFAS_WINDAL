import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function readVisibleViewport() {
  const vv = window.visualViewport;
  if (!vv) {
    return { top: 0, left: 0, height: window.innerHeight, width: window.innerWidth };
  }
  return {
    top: vv.offsetTop,
    left: vv.offsetLeft,
    height: vv.height,
    width: vv.width,
  };
}

const IOS_KEYBOARD_ACCESSORY = 52;

/** Panel above the software keyboard (list-only or with filter). */
export function computePbPickPanelStyle({ showFilter = false, anchor = 'bottom', sheet = false } = {}) {
  const vv = readVisibleViewport();
  const pad = sheet ? 0 : 10;
  const heightFrac = showFilter ? 0.52 : anchor === 'top' ? 0.5 : sheet ? 0.62 : 0.48;
  const maxH = Math.max(sheet ? 240 : 160, Math.min(sheet ? 560 : 400, Math.floor(vv.height * heightFrac)));
  const base = {
    position: 'fixed',
    left: vv.left + pad,
    width: Math.max(200, vv.width - pad * 2),
    height: maxH,
    maxHeight: maxH,
    zIndex: 12002,
  };
  if (anchor === 'top') {
    return { ...base, top: vv.top + (sheet ? 6 : pad), bottom: 'auto' };
  }
  const layoutBottom = window.innerHeight;
  const visualBottom = vv.top + vv.height;
  const keyboardGap = Math.max(sheet ? 0 : pad, layoutBottom - visualBottom);
  return {
    ...base,
    top: 'auto',
    bottom: keyboardGap + (sheet ? IOS_KEYBOARD_ACCESSORY : pad),
    borderRadius: sheet ? '14px 14px 0 0' : '12px',
  };
}

/**
 * Mobile party/broker picker — list above keyboard; filter optional (off = type in page field).
 */
export default function PbPartyBrokerPickPortal({
  open,
  title,
  searchValue,
  onSearchChange,
  onClose,
  onSelect,
  rows,
  emptyMessage,
  disabled,
  searchPlaceholder = 'Filter by code or name…',
  showFilter = false,
  anchor = 'bottom',
  sheet = false,
  subtitle,
  autoFocusFilter = false,
  onFilterKeyDown,
}) {
  const filterRef = useRef(null);
  const rafRef = useRef(0);
  const [panelStyle, setPanelStyle] = useState(() =>
    open ? computePbPickPanelStyle({ showFilter, anchor, sheet }) : null
  );

  const scheduleLayout = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setPanelStyle(computePbPickPanelStyle({ showFilter, anchor, sheet }));
    });
  }, [showFilter, anchor, sheet]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return undefined;
    }
    setPanelStyle(computePbPickPanelStyle({ showFilter, anchor, sheet }));
    const vv = window.visualViewport;
    vv?.addEventListener('resize', scheduleLayout);
    vv?.addEventListener('scroll', scheduleLayout);
    window.addEventListener('resize', scheduleLayout);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      vv?.removeEventListener('resize', scheduleLayout);
      vv?.removeEventListener('scroll', scheduleLayout);
      window.removeEventListener('resize', scheduleLayout);
    };
  }, [open, showFilter, anchor, sheet, scheduleLayout]);

  useEffect(() => {
    if (!open || !showFilter || !autoFocusFilter) return undefined;
    const t = window.setTimeout(() => {
      try {
        filterRef.current?.focus({ preventScroll: true });
      } catch (_) {}
    }, 80);
    return () => window.clearTimeout(t);
  }, [open, showFilter, autoFocusFilter]);

  if (!open) return null;

  const layout = panelStyle ?? computePbPickPanelStyle({ showFilter, anchor, sheet });

  return createPortal(
    <div
      className={`pb-pick-portal pb-pick-portal--viewport${sheet ? ' pb-pick-portal--sheet' : ''}`}
      role="presentation"
    >
      <button type="button" className="pb-pick-portal__backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div
        className={`pb-pick-portal__panel pb-pick-portal__panel--anchored${showFilter ? '' : ' pb-pick-portal__panel--list-only'}${sheet ? ' pb-pick-portal__panel--sheet' : ''}`}
        style={layout}
        role="listbox"
        aria-label={title}
      >
        <div className="pb-pick-portal__head">
          <div className="pb-pick-portal__head-text">
            <strong>{title}</strong>
            {subtitle && !showFilter ? <p className="pb-pick-portal__hint">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
        {showFilter ? (
          <div className="pb-pick-portal__filter">
            <input
              ref={filterRef}
              type="search"
              className="form-input"
              placeholder={searchPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              value={searchValue}
              disabled={disabled}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={onFilterKeyDown}
            />
          </div>
        ) : null}
        <div className="pb-pick-portal__list">
          {rows.length === 0 ? (
            <div className="account-search-empty">{emptyMessage}</div>
          ) : (
            rows.map((row) => (
              <button
                key={row.key}
                type="button"
                role="option"
                className={`account-search-row party-search-row${row.active ? ' is-active' : ''}${row.highlight ? ' is-highlight' : ''}`}
                disabled={disabled}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(row.code)}
              >
                <span className="account-search-code">{row.code}</span>
                <span className="account-search-name">{row.name}</span>
                {row.city ? <span className="account-search-city">{row.city}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
