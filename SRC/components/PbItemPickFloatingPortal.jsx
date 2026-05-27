import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function readAnchorBox(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 && rect.height < 1) return null;
  const pad = 8;
  const left = Math.max(pad, Math.min(rect.left, window.innerWidth - pad - 300));
  const width = Math.min(Math.max(rect.width, 300), window.innerWidth - left - pad);
  const spaceBelow = window.innerHeight - rect.bottom - pad;
  const spaceAbove = rect.top - pad;
  const maxHeight = Math.min(280, Math.max(spaceBelow, spaceAbove, 120) - 4);
  const top =
    spaceBelow >= 120 || spaceBelow >= spaceAbove
      ? rect.bottom + 2
      : Math.max(pad, rect.top - maxHeight - 2);
  return { left, top, width, maxHeight };
}

function resolveAnchorEl(lineIdx, anchorEl) {
  if (anchorEl && document.contains(anchorEl)) return anchorEl;
  const root = document.querySelector('.slide-25-purchase-bill');
  return root?.querySelector(`input.pb-item-code-input[data-pb-line-item="${lineIdx}"]`) ?? null;
}

/**
 * Desktop item code help — fixed panel anchored to the active line input (not clipped by grid scroll).
 */
export default function PbItemPickFloatingPortal({
  open,
  lineIdx,
  anchorEl,
  query,
  matches,
  highlightIdx,
  emptyMessage,
  hintMessage,
  onHover,
  onPick,
  highlightMatch,
  normalizeItemCode,
}) {
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    if (!open || lineIdx == null) {
      setBox(null);
      return undefined;
    }
    const update = () => {
      const el = resolveAnchorEl(lineIdx, anchorEl);
      const next = readAnchorBox(el);
      setBox(next);
    };
    update();
    const raf = window.requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [open, lineIdx, anchorEl, query, matches.length]);

  if (!open || lineIdx == null || !box) return null;

  const q = String(query ?? '').trim();

  const panel = (
    <div
      className="pb-item-pick-floating account-search-results pb-item-search-list"
      role="listbox"
      aria-label="Item matches"
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        width: box.width,
        maxHeight: box.maxHeight,
        zIndex: 12002,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {q ? (
        <>
          <div className="account-search-header party-search-header" aria-hidden="true">
            <span>Code</span>
            <span>Name</span>
          </div>
          {matches.length === 0 ? (
            <div className="account-search-empty">{emptyMessage}</div>
          ) : (
            matches.map((it, index) => {
              const pc = normalizeItemCode(it.ITEM_CODE ?? it.item_code);
              const rowHi = highlightIdx === index;
              return (
                <button
                  key={pc}
                  type="button"
                  role="option"
                  aria-selected={rowHi}
                  className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onPick(pc)}
                >
                  <span className="account-search-code">{highlightMatch(pc, query)}</span>
                  <span className="account-search-name">
                    {highlightMatch(it.ITEM_NAME ?? it.item_name, query)}
                  </span>
                </button>
              );
            })
          )}
        </>
      ) : (
        <p className="sale-bill-section__hint pb-item-pick-floating__hint">{hintMessage}</p>
      )}
    </div>
  );

  return createPortal(panel, document.body);
}
