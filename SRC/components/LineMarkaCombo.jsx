import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MOBILE_MQ = '(max-width: 768px)';

function visibleViewport() {
  const vv = window.visualViewport;
  if (!vv) {
    return { top: 0, left: 0, height: window.innerHeight, width: window.innerWidth };
  }
  return { top: vv.offsetTop, left: vv.offsetLeft, height: vv.height, width: vv.width };
}

/**
 * Marka on line entry — mobile: native &lt;select&gt; (same as item); desktop: searchable dropdown.
 */
export default function LineMarkaCombo({
  value,
  options = [],
  disabled,
  onChange,
  className = '',
  placeholder = '',
  onKeyDown: onKeyDownProp,
}) {
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const selectingRef = useRef(false);
  const pickGuardRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [panelStyle, setPanelStyle] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const highlightRef = useRef(0);
  const optionRefs = useRef([]);
  const prevFilterRef = useRef('');

  const labels = useMemo(
    () =>
      options
        .map((m) => String(m.MARKA ?? m.marka ?? m).trim())
        .filter(Boolean),
    [options]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((l) => l.toLowerCase().includes(q));
  }, [labels, filter]);

  const close = useCallback(() => {
    setOpen(false);
    setFilter('');
    setHighlightIndex(0);
  }, []);

  const pick = useCallback(
    (label) => {
      if (pickGuardRef.current) return;
      pickGuardRef.current = true;
      selectingRef.current = true;
      onChange(label);
      close();
      window.setTimeout(() => {
        pickGuardRef.current = false;
        selectingRef.current = false;
      }, 500);
    },
    [onChange, close]
  );

  const positionPanel = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vv = visibleViewport();
    const width = Math.min(Math.max(r.width, 260), vv.width - 16);
    const left = Math.min(Math.max(vv.left + 8, r.left), vv.left + vv.width - width - 8);
    const gap = 4;
    const below = r.bottom + gap;
    const maxH = Math.min(280, vv.top + vv.height - below - 8);
    const spaceAbove = r.top - vv.top - gap;
    const openAbove = maxH < 100 && spaceAbove > maxH;
    const height = Math.max(100, openAbove ? Math.min(280, spaceAbove) : maxH);

    setPanelStyle({
      position: 'fixed',
      top: openAbove ? r.top - height - gap : below,
      left,
      width,
      height,
      maxHeight: height,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      zIndex: 11000,
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useLayoutEffect(() => {
    if (open && !isMobile) positionPanel();
  }, [open, isMobile, positionPanel, filtered.length]);

  useEffect(() => {
    highlightRef.current = highlightIndex;
  }, [highlightIndex]);

  useEffect(() => {
    if (!open || isMobile) return undefined;
    positionPanel();
    const onReflow = () => {
      if (selectingRef.current) return;
      positionPanel();
    };
    window.addEventListener('resize', onReflow);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onReflow);
    vv?.addEventListener('scroll', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      vv?.removeEventListener('resize', onReflow);
      vv?.removeEventListener('scroll', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, isMobile, positionPanel]);

  useEffect(() => {
    if (!open || isMobile) return undefined;
    const onOutside = (e) => {
      if (selectingRef.current || pickGuardRef.current) return;
      const t = e.target;
      if (panelRef.current?.contains(t)) return;
      if (inputRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open, isMobile, close]);

  useEffect(() => {
    if (!open || isMobile) return undefined;
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || isMobile) return;
    if (prevFilterRef.current !== filter) {
      prevFilterRef.current = filter;
      setHighlightIndex(0);
    }
  }, [filter, open, isMobile]);

  useEffect(() => {
    if (!open || isMobile || !filtered.length) return;
    optionRefs.current[highlightIndex]?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, open, isMobile, filtered.length]);

  const moveHighlight = (delta) => {
    if (!filtered.length) return;
    setHighlightIndex((i) => Math.max(0, Math.min(i + delta, filtered.length - 1)));
  };

  const handleListKeyDown = (e) => {
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
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const row = filtered[highlightRef.current];
      if (row) pick(row);
    }
  };

  const current = String(value ?? '');
  const valueInList = labels.includes(current);

  if (isMobile) {
    return (
      <select
        className={`form-input ${className}`.trim()}
        value={current}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDownProp}
        aria-label="Marka"
      >
        <option value="">{placeholder || '— marka —'}</option>
        {!valueInList && current ? <option value={current}>{current}</option> : null}
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
    );
  }

  const panel =
    open && panelStyle && filtered.length > 0
      ? createPortal(
          <>
            <button type="button" className="line-marka-combo__backdrop" aria-label="Close" tabIndex={-1} onClick={close} />
            <div
              ref={panelRef}
              className="line-marka-combo__panel line-marka-combo__panel--desktop"
              style={panelStyle}
              role="listbox"
              onKeyDownCapture={handleListKeyDown}
            >
              <div className="line-marka-combo__search-wrap">
                <input
                  ref={inputRef}
                  type="text"
                  className="form-input line-marka-combo__search"
                  value={filter}
                  placeholder="Type to filter…"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={handleListKeyDown}
                />
              </div>
              <div className="line-marka-combo__list">
                {filtered.map((label, idx) => (
                  <button
                    key={`${label}-${idx}`}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    className={`line-marka-combo__opt${idx === highlightIndex ? ' is-highlighted' : ''}${
                      label === current && idx !== highlightIndex ? ' is-saved' : ''
                    }`}
                    onMouseMove={() => setHighlightIndex(idx)}
                    onClick={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      pick(label);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        className={className}
        value={current}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-expanded={open}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) {
            setFilter(e.target.value);
            setOpen(true);
          }
        }}
        onFocus={() => {
          setFilter(current);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.keyCode === 40) {
            e.preventDefault();
            if (!open) setOpen(true);
            moveHighlight(1);
            return;
          }
          if (e.key === 'ArrowUp' || e.keyCode === 38) {
            e.preventDefault();
            if (!open) setOpen(true);
            moveHighlight(-1);
            return;
          }
          if (e.key === 'Enter' && open && filtered[highlightRef.current]) {
            e.preventDefault();
            pick(filtered[highlightRef.current]);
            return;
          }
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            close();
            return;
          }
          onKeyDownProp?.(e);
        }}
      />
      {panel}
    </>
  );
}
