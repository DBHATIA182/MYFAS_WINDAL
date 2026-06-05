import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MOBILE_MQ = '(max-width: 640px)';
const PANEL_MIN_W = 260;
const PANEL_PREF_H = 300;
const VIEWPORT_PAD = 10;

function visibleViewport() {
  const vv = window.visualViewport;
  if (!vv) {
    return {
      top: 0,
      left: 0,
      height: window.innerHeight,
      width: window.innerWidth,
    };
  }
  return {
    top: vv.offsetTop,
    left: vv.offsetLeft,
    height: vv.height,
    width: vv.width,
  };
}

/** Searchable dropdown — portal + viewport clamp; touch-safe selection on mobile. */
export default function MasterPartyPickList({
  options,
  value,
  onChange,
  disabled,
  title = 'Select',
  placeholder = '— select —',
  filterPlaceholder = 'Type to filter…',
  dataMpField,
  onKeyDown,
  getValue = (o) => String(o.value ?? o.NO ?? o.no ?? ''),
  getLabel = (o) => String(o.label ?? o.NAME ?? o.name ?? o.value ?? ''),
  getTriggerLabel,
  getOptionLabel,
  getOptionHint,
  getOptionCity,
  getFilterText,
  getOptionTitle,
  panelVariant,
  openOnFocus = false,
  showSearchIcon = false,
  showAllWhenEmpty = false,
  searchBtnTabIndex,
  onAfterSelect,
}) {
  const triggerLabel = getTriggerLabel ?? getLabel;
  const optionLabel = getOptionLabel ?? getLabel;
  const filterFor = getFilterText
    ?? ((o) => {
      const hint = getOptionHint ? getOptionHint(o) : '';
      const city = getOptionCity ? getOptionCity(o) : '';
      return `${optionLabel(o)} ${hint} ${city}`.trim();
    });

  const triggerRef = useRef(null);
  const searchBtnRef = useRef(null);
  const panelRef = useRef(null);
  const filterRef = useRef(null);
  const suppressToggleRef = useRef(false);
  const selectingRef = useRef(false);
  const pickGuardRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [panelStyle, setPanelStyle] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const highlightRef = useRef(0);
  const optionRefs = useRef([]);
  const prevFilterRef = useRef('');

  const selected = useMemo(
    () => options.find((o) => getValue(o) === String(value)),
    [options, value, getValue]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return showAllWhenEmpty ? options : [];
    return options.filter((o) => filterFor(o).toLowerCase().includes(q));
  }, [options, filter, filterFor, showAllWhenEmpty]);

  const close = useCallback(() => {
    setOpen(false);
    setFilter('');
    setHighlightIndex(0);
  }, []);

  const selectOption = useCallback(
    (val) => {
      if (pickGuardRef.current) return;
      pickGuardRef.current = true;
      selectingRef.current = true;
      suppressToggleRef.current = true;
      onChange(val);
      close();
      if (onAfterSelect) {
        window.setTimeout(() => onAfterSelect(val), 0);
      }
      window.setTimeout(() => {
        pickGuardRef.current = false;
        selectingRef.current = false;
        suppressToggleRef.current = false;
      }, 600);
    },
    [onChange, close, onAfterSelect]
  );

  const updatePanelPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const vv = visibleViewport();
    const mobile = window.matchMedia(MOBILE_MQ).matches;
    const minW =
      panelVariant === 'voucherParty' ? 640
      : panelVariant === 'stateName' ? 320
      : PANEL_MIN_W;

    if (mobile) {
      const pad = VIEWPORT_PAD;
      const maxH = Math.max(260, Math.min(480, Math.floor(vv.height * 0.78)));
      const top = Math.max(vv.top + pad, vv.top + vv.height - maxH - pad);
      setPanelStyle({
        position: 'fixed',
        left: vv.left + pad,
        width: Math.max(200, vv.width - pad * 2),
        height: maxH,
        maxHeight: maxH,
        top,
        bottom: 'auto',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 12050,
      });
      return;
    }

    const anchorEl =
      showSearchIcon && searchBtnRef.current ? searchBtnRef.current : el;
    const r = anchorEl.getBoundingClientRect();
    const width = Math.min(
      panelVariant === 'voucherParty' ? Math.max(minW, 640) : Math.max(r.width, minW),
      vv.width - VIEWPORT_PAD * 2
    );
    const left = Math.min(
      Math.max(vv.left + VIEWPORT_PAD, r.right - width),
      vv.left + vv.width - width - VIEWPORT_PAD
    );

    const gap = 4;
    const triggerBottomInView = r.bottom - vv.top;
    const triggerTopInView = r.top - vv.top;
    const spaceBelow = vv.height - triggerBottomInView - gap - VIEWPORT_PAD;
    const spaceAbove = triggerTopInView - gap - VIEWPORT_PAD;
    const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(PANEL_PREF_H, openAbove ? spaceAbove : spaceBelow));

    let top = openAbove ? r.top - maxHeight - gap : r.bottom + gap;
    const minTop = vv.top + VIEWPORT_PAD;
    const maxTop = vv.top + vv.height - maxHeight - VIEWPORT_PAD;
    top = Math.max(minTop, Math.min(top, maxTop));

    setPanelStyle({
      position: 'fixed',
      top,
      left,
      width,
      minWidth: panelVariant === 'voucherParty' ? Math.min(minW, width) : undefined,
      height: maxHeight,
      maxHeight,
      bottom: 'auto',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 11000,
    });
  }, [panelVariant, showSearchIcon]);

  useLayoutEffect(() => {
    if (open) updatePanelPosition();
  }, [open, updatePanelPosition, filtered.length]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePanelPosition();
    const onReflow = () => {
      if (selectingRef.current) return;
      updatePanelPosition();
    };
    window.addEventListener('resize', onReflow);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onReflow);
    vv?.addEventListener('scroll', onReflow);
    if (!isMobile) {
      window.addEventListener('scroll', onReflow, true);
    }
    return () => {
      window.removeEventListener('resize', onReflow);
      vv?.removeEventListener('resize', onReflow);
      vv?.removeEventListener('scroll', onReflow);
      if (!isMobile) {
        window.removeEventListener('scroll', onReflow, true);
      }
    };
  }, [open, updatePanelPosition, isMobile]);

  useEffect(() => {
    if (!open) return undefined;
    const onOutside = (e) => {
      if (selectingRef.current || pickGuardRef.current) return;
      const t = e.target;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      if (searchBtnRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open, close]);

  useEffect(() => {
    if (!open) return undefined;
    const delay = isMobile ? 150 : 0;
    const id = window.setTimeout(
      () => filterRef.current?.focus({ preventScroll: true }),
      delay
    );
    return () => window.clearTimeout(id);
  }, [open, isMobile]);

  useEffect(() => {
    highlightRef.current = highlightIndex;
  }, [highlightIndex]);

  useEffect(() => {
    if (!open) {
      prevFilterRef.current = '';
      return;
    }
    if (prevFilterRef.current !== filter) {
      prevFilterRef.current = filter;
      setHighlightIndex(0);
      return;
    }
    if (!filter.trim() && filtered.length) {
      const idx = filtered.findIndex((o) => getValue(o) === String(value));
      if (idx >= 0) setHighlightIndex(idx);
    }
  }, [open, filter, filtered, value, getValue]);

  useEffect(() => {
    if (!open || !filtered.length) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open, filtered.length]);

  const moveHighlight = useCallback(
    (delta) => {
      if (!filtered.length) return;
      setHighlightIndex((i) => Math.max(0, Math.min(i + delta, filtered.length - 1)));
    },
    [filtered.length]
  );

  const handleListKeyDown = useCallback(
    (e) => {
      const isNav =
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === 'Escape' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.keyCode === 38 ||
        e.keyCode === 40;
      if (!isNav) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }

      if (!filtered.length) return;

      if (e.key === 'ArrowDown' || e.keyCode === 40) {
        e.preventDefault();
        e.stopPropagation();
        moveHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp' || e.keyCode === 38) {
        e.preventDefault();
        e.stopPropagation();
        moveHighlight(-1);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightIndex(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        setHighlightIndex(filtered.length - 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const row = filtered[highlightRef.current];
        if (row) selectOption(getValue(row));
      }
    },
    [filtered, getValue, selectOption, close, moveHighlight]
  );

  const openSearch = useCallback(() => {
    if (disabled) return;
    setFilter('');
    setHighlightIndex(0);
    setOpen(true);
  }, [disabled]);

  const handleTriggerFocus = () => {
    if (disabled || !openOnFocus || showSearchIcon || selectingRef.current) return;
    openSearch();
  };

  const handleTrigger = (e) => {
    if (disabled || suppressToggleRef.current) return;
    if (showSearchIcon) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    if (open) close();
    else setOpen(true);
  };

  const handleFilterFocus = () => {
    window.setTimeout(updatePanelPosition, 50);
    window.setTimeout(updatePanelPosition, 320);
  };

  const handleOptionActivate = (val, e) => {
    e.preventDefault();
    e.stopPropagation();
    selectOption(val);
  };

  const displayText = selected
    ? triggerLabel(selected)
    : value
      ? String(value)
      : placeholder;

  const panel = open && panelStyle
    ? createPortal(
        <>
          <button
            type="button"
            className="master-party-pick__backdrop"
            aria-label="Close"
            tabIndex={-1}
            onClick={close}
          />
          <div
            ref={panelRef}
            className={[
              'master-party-pick__panel',
              'master-party-pick__panel--dropdown',
              isMobile ? 'master-party-pick__panel--mobile' : '',
              panelVariant ? `master-party-pick__panel--${panelVariant}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={panelStyle}
            role="listbox"
            id={`master-party-pick-list-${dataMpField || 'pick'}`}
            onKeyDownCapture={handleListKeyDown}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {isMobile ? (
              <div className="master-party-pick__head">
                <span className="master-party-pick__head-title">{title}</span>
                <div className="master-party-pick__nav">
                  <button type="button" className="master-party-pick__nav-btn" aria-label="Previous" onClick={() => moveHighlight(-1)}>
                    ↑
                  </button>
                  <button type="button" className="master-party-pick__nav-btn" aria-label="Next" onClick={() => moveHighlight(1)}>
                    ↓
                  </button>
                </div>
                <button type="button" className="master-party-pick__done" onClick={close}>
                  Done
                </button>
              </div>
            ) : null}
            <div className="master-party-pick__search-wrap">
              <input
                ref={filterRef}
                type="text"
                role="combobox"
                aria-controls={`master-party-pick-list-${dataMpField || 'pick'}`}
                aria-expanded={open}
                aria-autocomplete="list"
                className="form-input master-party-pick__filter"
                value={filter}
                placeholder={filterPlaceholder}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                onChange={(e) => setFilter(e.target.value)}
                onFocus={handleFilterFocus}
                onBlur={() => {
                  if (isMobile) return;
                  window.setTimeout(() => {
                    if (
                      !panelRef.current?.contains(document.activeElement) &&
                      !triggerRef.current?.contains(document.activeElement) &&
                      !searchBtnRef.current?.contains(document.activeElement)
                    ) {
                      close();
                    }
                  }, 120);
                }}
                onKeyDown={handleListKeyDown}
              />
            </div>
            {panelVariant === 'voucherParty' && getOptionHint && getOptionCity ? (
              <div className="master-party-pick__cols-head" aria-hidden="true">
                <span className="master-party-pick__cols-head-code">Code</span>
                <span className="master-party-pick__cols-head-name">Name</span>
                <span className="master-party-pick__cols-head-city">City</span>
              </div>
            ) : panelVariant === 'voucherParty' && getOptionHint ? (
              <div className="master-party-pick__cols-head master-party-pick__cols-head--dual" aria-hidden="true">
                <span className="master-party-pick__cols-head-code">Code</span>
                <span className="master-party-pick__cols-head-name">Name</span>
              </div>
            ) : null}
            <div className="master-party-pick__list" onTouchMove={(e) => e.stopPropagation()}>
              {filtered.length === 0 ? (
                <div className="master-party-pick__empty">
                  {filter.trim() ? 'No matches' : showAllWhenEmpty ? 'No accounts' : 'Type to search'}
                </div>
              ) : (
                filtered.map((o, idx) => {
                  const v = getValue(o);
                  return (
                    <button
                      key={`${v}-${idx}`}
                      ref={(el) => {
                        optionRefs.current[idx] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={String(value) === v}
                      className={[
                        'master-party-pick__opt',
                        getOptionHint && getOptionCity ? 'master-party-pick__opt--triple' : '',
                        getOptionHint && !getOptionCity ? 'master-party-pick__opt--dual' : '',
                        idx === highlightIndex ? 'is-highlighted' : '',
                        String(value) === v && idx !== highlightIndex ? 'is-saved' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={getOptionTitle ? getOptionTitle(o) : undefined}
                      onMouseMove={() => setHighlightIndex(idx)}
                      onTouchEnd={(e) => {
                        if (!isMobile) return;
                        handleOptionActivate(v, e);
                      }}
                      onClick={(e) => handleOptionActivate(v, e)}
                    >
                      {getOptionHint && getOptionCity ? (
                        <>
                          <span className="master-party-pick__opt-code">{optionLabel(o)}</span>
                          <span className="master-party-pick__opt-name">{getOptionHint(o)}</span>
                          <span className="master-party-pick__opt-city">{getOptionCity(o) || '—'}</span>
                        </>
                      ) : getOptionHint ? (
                        <>
                          <span className="master-party-pick__opt-code">{optionLabel(o)}</span>
                          <span className="master-party-pick__opt-hint">{getOptionHint(o)}</span>
                        </>
                      ) : (
                        optionLabel(o)
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <div
      className={[
        'master-party-pick',
        open ? 'master-party-pick--open' : '',
        showSearchIcon ? 'master-party-pick--with-search-btn' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        ref={triggerRef}
        type="button"
        className="form-input master-party-pick__trigger"
        data-mp-field={dataMpField}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={handleTrigger}
        onFocus={handleTriggerFocus}
        onKeyDown={(e) => {
          if (showSearchIcon) {
            onKeyDown?.(e);
            return;
          }
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter')) {
            e.preventDefault();
            if (!disabled) setOpen(true);
            return;
          }
          onKeyDown?.(e);
        }}
      >
        <span className={`master-party-pick__value${!selected && !value ? ' is-placeholder' : ''}`}>
          {displayText}
        </span>
        {!showSearchIcon ? (
          <span className="master-party-pick__chevron" aria-hidden>
            ▾
          </span>
        ) : null}
      </button>
      {showSearchIcon ? (
        <button
          ref={searchBtnRef}
          type="button"
          className="master-party-pick__search-btn"
          disabled={disabled}
          title="Search"
          aria-label={`Search ${title}`}
          tabIndex={searchBtnTabIndex}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openSearch();
          }}
        >
          ?
        </button>
      ) : null}
      {panel}
    </div>
  );
}
