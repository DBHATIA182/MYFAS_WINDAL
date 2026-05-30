import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function readAnchorBox(el) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 && rect.height < 1) return null;

  const vv = window.visualViewport;
  const vvOffsetTop = vv?.offsetTop ?? 0;
  const vvOffsetLeft = vv?.offsetLeft ?? 0;
  const vvHeight = vv?.height ?? window.innerHeight;
  const vvWidth = vv?.width ?? window.innerWidth;

  const pad = 8;
  const elTop = rect.top - vvOffsetTop;
  const elBottom = rect.bottom - vvOffsetTop;
  const elLeft = rect.left - vvOffsetLeft;

  const width = Math.min(Math.max(rect.width, 280), vvWidth - pad * 2);
  const left = Math.max(pad + vvOffsetLeft, Math.min(elLeft + vvOffsetLeft, vvOffsetLeft + vvWidth - width - pad));

  const maxHeight = Math.min(240, Math.max(120, Math.floor(vvHeight * 0.42)));
  const spaceBelow = vvHeight - elBottom - pad;
  const spaceAbove = elTop - pad;

  let topInLayout;
  if (spaceBelow >= 88 || spaceBelow >= spaceAbove) {
    topInLayout = rect.bottom + 2;
  } else {
    topInLayout = Math.max(vvOffsetTop + pad, rect.top - maxHeight - 2);
  }

  if (topInLayout < vvOffsetTop + pad && rect.bottom > vvOffsetTop + 40) {
    topInLayout = Math.min(rect.bottom + 2, vvOffsetTop + vvHeight - maxHeight - pad);
  }

  return { left, top: topInLayout, width, maxHeight };
}

function resolveAnchorEl(lineIdx, anchorEl, rootSelector, lineDataAttr) {
  if (anchorEl && document.contains(anchorEl)) return anchorEl;
  const root = document.querySelector(rootSelector || '.slide-25-purchase-bill');
  if (lineIdx === 'mill') {
    return root?.querySelector('input[data-prod-mill-item]') ?? null;
  }
  const attr = lineDataAttr || 'data-pb-line-item';
  return root?.querySelector(`input[${attr}="${lineIdx}"]`) ?? null;
}

function ItemPickPanel({
  q,
  matches,
  highlightIdx,
  emptyMessage,
  hintMessage,
  onHover,
  onPick,
  highlightMatch,
  normalizeItemCode,
  className = '',
  style,
}) {
  return (
    <div
      className={`pb-item-pick-floating account-search-results pb-item-search-list ${className}`.trim()}
      role="listbox"
      aria-label="Item matches"
      style={style}
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
                  key={`${pc}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={rowHi}
                  className={`account-search-row party-search-row${rowHi ? ' is-highlight' : ''}`}
                  onMouseEnter={() => onHover(index)}
                  onTouchStart={() => onHover(index)}
                  onClick={() => onPick(pc)}
                >
                  <span className="account-search-code">{highlightMatch(pc, q)}</span>
                  <span className="account-search-name">
                    {highlightMatch(it.ITEM_NAME ?? it.item_name, q)}
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
}

/**
 * Item code help — fixed panel on desktop, inline panel below input on mobile.
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
  rootSelector,
  lineDataAttr,
  inline = false,
}) {
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    if (inline || !open || lineIdx == null) {
      setBox(null);
      return undefined;
    }
    const update = () => {
      const el = resolveAnchorEl(lineIdx, anchorEl, rootSelector, lineDataAttr);
      setBox(readAnchorBox(el));
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
  }, [inline, open, lineIdx, anchorEl, query, matches.length, rootSelector, lineDataAttr]);

  if (!open || lineIdx == null) return null;

  const q = String(query ?? '').trim();

  if (inline) {
    return (
      <ItemPickPanel
        q={q}
        matches={matches}
        highlightIdx={highlightIdx}
        emptyMessage={emptyMessage}
        hintMessage={hintMessage}
        onHover={onHover}
        onPick={onPick}
        highlightMatch={highlightMatch}
        normalizeItemCode={normalizeItemCode}
        className="pb-item-pick-inline"
      />
    );
  }

  if (!box) return null;

  const panel = (
    <ItemPickPanel
      q={q}
      matches={matches}
      highlightIdx={highlightIdx}
      emptyMessage={emptyMessage}
      hintMessage={hintMessage}
      onHover={onHover}
      onPick={onPick}
      highlightMatch={highlightMatch}
      normalizeItemCode={normalizeItemCode}
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        width: box.width,
        maxHeight: box.maxHeight,
        zIndex: 12002,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    />
  );

  return createPortal(panel, document.body);
}
