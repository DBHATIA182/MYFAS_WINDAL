import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SEARCH_ITEM_TYPE_HINT, SEARCH_NO_MATCH, SEARCH_PLANT_TYPE_HINT } from '../utils/masterSearchFilter';

function highlightMatch(text, q) {
  if (text == null) return null;
  const s = String(text);
  const query = String(q ?? '').trim();
  if (!query) return s;
  const lower = s.toLowerCase();
  const qi = lower.indexOf(query.toLowerCase());
  if (qi === -1) return s;
  return (
    <>
      {s.slice(0, qi)}
      <mark className="search-highlight">{s.slice(qi, qi + query.length)}</mark>
      {s.slice(qi + query.length)}
    </>
  );
}

/**
 * Type-to-search code + name picker (items or plants).
 */
export default function EntryCodeNameSearch({
  kind = 'item',
  label,
  value,
  displayName = '',
  rows = [],
  disabled = false,
  onPick,
  onClear,
  onAfterPick,
  className = '',
  inputClassName = 'form-input',
  ignoreEnterClass = 'slide-32-production-ignore-enter',
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [editing, setEditing] = useState(false);

  const code = String(value ?? '').trim();
  const selected = !!code;
  const hint = kind === 'plant' ? SEARCH_PLANT_TYPE_HINT : SEARCH_ITEM_TYPE_HINT;
  const showDropdown = editing && query.trim().length > 0;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        if (kind === 'plant') {
          const pc = String(row.PLANT_CODE ?? row.plant_code ?? '').toLowerCase();
          const pn = String(row.PLANT_NAME ?? row.plant_name ?? '').toLowerCase();
          return pc.includes(q) || pn.includes(q);
        }
        const ic = String(row.ITEM_CODE ?? row.item_code ?? '').toLowerCase();
        const nm = String(row.ITEM_NAME ?? row.item_name ?? '').toLowerCase();
        return ic.includes(q) || nm.includes(q);
      })
      .slice(0, 50);
  }, [rows, query, kind]);

  useEffect(() => {
    setHi(0);
  }, [query]);

  useEffect(() => {
    if (selected && !editing) {
      setQuery('');
    }
  }, [selected, editing, code]);

  useEffect(() => {
    if (!editing) return undefined;
    const onDocDown = (e) => {
      if (e.target.closest?.('.entry-code-name-search')) return;
      setEditing(false);
      setQuery('');
    };
    document.addEventListener('mousedown', onDocDown, true);
    return () => document.removeEventListener('mousedown', onDocDown, true);
  }, [editing]);

  const safeHi = Math.min(hi, Math.max(0, matches.length - 1));

  const finishEdit = () => {
    setEditing(false);
    setQuery('');
  };

  const pickRow = (row) => {
    const c =
      kind === 'plant'
        ? String(row.PLANT_CODE ?? row.plant_code ?? '').trim()
        : String(row.ITEM_CODE ?? row.item_code ?? '').trim();
    if (!c) return;
    onPick?.(c, row);
    finishEdit();
    inputRef.current?.blur?.();
    onAfterPick?.(c, row);
  };

  const tryPickExactCode = (raw) => {
    const q = String(raw ?? '').trim();
    if (!q) return false;
    const qLower = q.toLowerCase();
    const hit = (Array.isArray(rows) ? rows : []).find((row) => {
      const c =
        kind === 'plant'
          ? String(row.PLANT_CODE ?? row.plant_code ?? '').trim()
          : String(row.ITEM_CODE ?? row.item_code ?? '').trim();
      return c.toLowerCase() === qLower;
    });
    if (hit) {
      pickRow(hit);
      return true;
    }
    return false;
  };

  const codeKey = (row) =>
    kind === 'plant'
      ? String(row.PLANT_CODE ?? row.plant_code ?? '')
      : String(row.ITEM_CODE ?? row.item_code ?? '');

  const nameKey = (row) =>
    kind === 'plant' ? row.PLANT_NAME ?? row.plant_name : row.ITEM_NAME ?? row.item_name;

  const showSelected = selected && !editing;

  return (
    <div className={`entry-code-name-search ${className}`.trim()}>
      {label ? <span className="dc-header-k">{label}</span> : null}
      {showSelected ? (
        <div className="entry-code-name-search__selected">
          <span className="entry-code-name-search__selected-text" title={`${code} — ${displayName}`}>
            <code>{code}</code> — {displayName || code}
          </span>
          {!disabled ? (
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${ignoreEnterClass}`}
              onClick={() => {
                onClear?.();
                setQuery('');
                setEditing(true);
                window.requestAnimationFrame(() => inputRef.current?.focus());
              }}
            >
              Change
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="search"
            className={inputClassName}
            autoComplete="off"
            disabled={disabled}
            placeholder={kind === 'plant' ? 'Plant code or name…' : 'Item code or name…'}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setEditing(true);
            }}
            onFocus={() => setEditing(true)}
            onBlur={() => {
              window.setTimeout(() => finishEdit(), 180);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                if (matches.length) setHi((h) => Math.min(matches.length - 1, h + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                setHi((h) => Math.max(0, h - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (matches.length) {
                  pickRow(matches[safeHi]);
                } else if (tryPickExactCode(query)) {
                  /* picked */
                } else {
                  finishEdit();
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishEdit();
                inputRef.current?.blur?.();
              }
            }}
          />
          {showDropdown ? (
            <div className="account-search-results entry-code-name-search__results" role="listbox">
              <div className="account-search-header party-search-header" aria-hidden="true">
                <span>Code</span>
                <span>Name</span>
              </div>
              {matches.length === 0 ? (
                <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
              ) : (
                matches.map((row, index) => (
                  <button
                    key={codeKey(row)}
                    type="button"
                    className={`account-search-row party-search-row${safeHi === index ? ' is-highlight' : ''}`}
                    onMouseEnter={() => setHi(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickRow(row);
                    }}
                  >
                    <span className="account-search-code">{highlightMatch(codeKey(row), query)}</span>
                    <span className="account-search-name">{highlightMatch(nameKey(row), query)}</span>
                  </button>
                ))
              )}
            </div>
          ) : editing && !query.trim() ? (
            <p className="sale-bill-section__hint entry-code-name-search__hint">{hint}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
