import React, { useCallback, useMemo, useRef, useState } from 'react';
import { filterCodeNameCityRows, SEARCH_NO_MATCH, SEARCH_TYPE_HINT } from '../utils/masterSearchFilter';
import PbPartyBrokerPickPortal from './PbPartyBrokerPickPortal';

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
 * Searchable account code picker (code + name) for purchase bill expense fields.
 * Mobile: type in the portal sheet (field at bottom of screen — inline input would sit under the sheet).
 */
export default function PbAccountCodePicker({
  value,
  onChange,
  accounts,
  disabled,
  className = '',
  title = 'Account',
  isMobile = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hi, setHi] = useState(0);
  const pickingRef = useRef(false);

  const selected = useMemo(() => {
    const v = String(value ?? '').trim();
    if (!v) return null;
    return (accounts || []).find((a) => String(a.CODE ?? a.code ?? '').trim() === v) ?? null;
  }, [accounts, value]);

  const filtered = useMemo(() => filterCodeNameCityRows(accounts, search, 40), [accounts, search]);

  const safeHi = Math.min(hi, Math.max(0, filtered.length - 1));

  const closePortal = useCallback(() => {
    setOpen(false);
    setSearch('');
    setHi(0);
  }, []);

  const pick = useCallback(
    (row) => {
      const c = String(row.CODE ?? row.code ?? '').trim();
      pickingRef.current = true;
      onChange(c);
      setOpen(false);
      setSearch('');
      setHi(0);
      window.setTimeout(() => {
        pickingRef.current = false;
      }, 300);
    },
    [onChange]
  );

  const commitSearchPick = useCallback(() => {
    if (filtered.length > 0) {
      pick(filtered[safeHi]);
      return true;
    }
    const q = String(search ?? '').trim();
    if (q && (accounts || []).some((a) => String(a.CODE ?? a.code ?? '').trim() === q)) {
      pickingRef.current = true;
      onChange(q);
      setOpen(false);
      setSearch('');
      setHi(0);
      window.setTimeout(() => {
        pickingRef.current = false;
      }, 300);
      return true;
    }
    return false;
  }, [accounts, filtered, safeHi, search, onChange, pick]);

  const startChange = () => {
    onChange('');
    setSearch('');
    setHi(0);
    setOpen(true);
  };

  const openMobileSearch = useCallback(() => {
    if (disabled) return;
    setSearch('');
    setHi(0);
    setOpen(true);
  }, [disabled]);

  const portalRows = useMemo(
    () =>
      filtered.map((row, index) => {
        const pc = String(row.CODE ?? row.code ?? '');
        const name = String(row.NAME ?? row.name ?? '').trim();
        const city = String(row.CITY ?? row.city ?? '').trim();
        return {
          key: pc,
          code: pc,
          name: name || '—',
          city: city || null,
          highlight: safeHi === index,
        };
      }),
    [filtered, safeHi]
  );

  const portalOpen = isMobile && open;

  if (selected && !open) {
    const name = String(selected.NAME ?? selected.name ?? '').trim();
    return (
      <div className={`pb-acct-code-selected${className ? ` ${className}` : ''}`}>
        <div className="pb-acct-code-selected__body" title={name ? `[${value}] ${name}` : String(value)}>
          <span className="pb-acct-code-selected__code">[{value}]</span>
          {name ? <span className="pb-acct-code-selected__name">{name}</span> : null}
        </div>
        {!disabled ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={startChange}>
            Chg
          </button>
        ) : null}
      </div>
    );
  }

  if (isMobile) {
    return (
      <>
        <div className={`pb-acct-code-picker pb-acct-code-picker--mobile${className ? ` ${className}` : ''}`}>
          <button
            type="button"
            className="form-input pb-acct-code-picker__trigger"
            disabled={disabled}
            onClick={openMobileSearch}
          >
            {search.trim() ? search : 'Search code or name…'}
          </button>
        </div>
        <PbPartyBrokerPickPortal
          open={portalOpen}
          title={title}
          showFilter
          autoFocusFilter
          anchor="bottom"
          sheet
          searchValue={search}
          searchPlaceholder="Type code or name…"
          disabled={disabled}
          rows={portalRows}
          emptyMessage={search.trim() ? SEARCH_NO_MATCH : SEARCH_TYPE_HINT}
          onSearchChange={(v) => {
            setSearch(v);
            setHi(0);
          }}
          onClose={closePortal}
          onSelect={(code) => {
            const row = filtered.find((r) => String(r.CODE ?? r.code ?? '').trim() === String(code).trim());
            if (row) pick(row);
          }}
          onFilterKeyDown={(e) => {
            if (e.key === 'ArrowDown' && filtered.length > 0) {
              e.preventDefault();
              setHi((h) => Math.min(filtered.length - 1, h + 1));
            } else if (e.key === 'ArrowUp' && filtered.length > 0) {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (!commitSearchPick()) {
                /* keep sheet open until valid pick */
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              closePortal();
            }
          }}
        />
      </>
    );
  }

  return (
    <div className={`pb-acct-code-picker${className ? ` ${className}` : ''}`}>
      <input
        type="search"
        className="form-input pb-frame-input pb-frame-input--code pb-acct-code-picker__input"
        placeholder="Search code or name…"
        enterKeyHint="search"
        value={search}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => {
          setOpen(true);
          setSearch(String(value ?? '').trim());
          setHi(0);
        }}
        onChange={(e) => {
          setSearch(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filtered.length === 0) return;
            setHi((h) => Math.min(filtered.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            commitSearchPick();
          } else if (e.key === 'Escape') {
            setOpen(false);
            setSearch('');
          }
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (pickingRef.current) return;
            setOpen(false);
          }, 220);
        }}
      />
      {open ? (
        search.trim() ? (
          <div
            className="account-search-results pb-acct-code-list pb-acct-code-list--wide"
            role="listbox"
            aria-label="Account matches"
          >
            <div
              className="account-search-header party-search-header pb-acct-code-list__header"
              aria-hidden="true"
            >
              <span>Code</span>
              <span>Name</span>
            </div>
            {filtered.length === 0 ? (
              <div className="account-search-empty">{SEARCH_NO_MATCH}</div>
            ) : (
              filtered.map((row, index) => {
                const pc = String(row.CODE ?? row.code ?? '');
                const rowHi = safeHi === index;
                return (
                  <button
                    key={pc}
                    type="button"
                    role="option"
                    aria-selected={rowHi}
                    className={`account-search-row party-search-row pb-acct-code-list__row${rowHi ? ' is-highlight' : ''}${String(value) === pc ? ' is-active' : ''}`}
                    onMouseEnter={() => setHi(index)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(row)}
                  >
                    <span className="account-search-code">{highlightMatch(pc, search)}</span>
                    <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, search)}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <p className="sale-bill-section__hint pb-acct-code-hint">{SEARCH_TYPE_HINT}</p>
        )
      ) : null}
    </div>
  );
}
