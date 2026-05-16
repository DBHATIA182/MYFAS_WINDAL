const fs = require('fs');

function fixPartyFind(file, placeholder, label) {
  let s = fs.readFileSync(file, 'utf8');
  const idx = s.indexOf('<div className="dc-party-find">');
  if (idx < 0) {
    console.log('skip', file, 'no dc-party-find');
    return;
  }
  const endMarker = '\n            )}\n          </div>\n        </div>';
  const end = s.indexOf(endMarker, idx);
  if (end < 0) {
    console.log('skip', file, 'no end');
    return;
  }
  const replacement = `<div className="account-search-group dc-party-find">
                <input
                  type="search"
                  className="form-input sale-bill-search-input"
                  placeholder="${placeholder}"
                  autoComplete="off"
                  value={partySearch}
                  disabled={fieldsDisabled}
                  onChange={(e) => {
                    setPartySearch(e.target.value);
                    setPartyHi(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      if (filteredParties.length === 0) return;
                      setPartyHi((h) => Math.min(filteredParties.length - 1, h + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setPartyHi((h) => Math.max(0, h - 1));
                    } else if (e.key === 'Enter' && filteredParties.length > 0) {
                      e.preventDefault();
                      e.stopPropagation();
                      const row = filteredParties[safePartyHi];
                      if (row) applyPartyPick(String(row.CODE ?? row.code ?? '').trim());
                    }
                  }}
                />
                {partySearch.trim() ? (
                  <div className="account-search-results party-search-results dc-party-list" role="listbox" aria-label="${label}">
                    <div className="account-search-header party-search-header" aria-hidden="true">
                      <span>Code</span>
                      <span>Name</span>
                      <span>City</span>
                    </div>
                    {filteredParties.length === 0 ? (
                      <motionless className="account-search-empty">No matches — try different letters.</div>
                    ) : (
                      filteredParties.map((row, index) => {
                        const pc = String(row.CODE ?? row.code ?? '');
                        const rowHi = safePartyHi === index;
                        return (
                          <button
                            key={pc}
                            type="button"
                            role="option"
                            aria-selected={String(code) === pc}
                            disabled={fieldsDisabled}
                            className={\`account-search-row party-search-row\${rowHi ? ' is-highlight' : ''}\${String(code) === pc ? ' is-active' : ''}\`}
                            onMouseEnter={() => setPartyHi(index)}
                            onClick={() => applyPartyPick(pc)}
                          >
                            <span className="account-search-code">{highlightMatch(pc, partySearch)}</span>
                            <span className="account-search-name">{highlightMatch(row.NAME ?? row.name, partySearch)}</span>
                            <span className="account-search-city">{highlightMatch(row.CITY ?? row.city, partySearch) || '—'}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : (
                  <p className="sale-bill-section__hint dc-party-search-hint">Type code, name, or city to search.</p>
                )}
              </div>`;
  s = s.slice(0, idx) + replacement + s.slice(end);
  s = s.replace(/<motionless className="account-search-empty">/g, '<div className="account-search-empty">');
  fs.writeFileSync(file, s);
  console.log('fixed', file);
}

// Slide23 - add helpers if missing
let s23 = fs.readFileSync('e:/WINDAL/APPTEST/SRC/slides/Slide23SalesOrder.jsx', 'utf8');
if (!s23.includes('const applyPartyPick')) {
  s23 = s23.replace(
    /}, \[partySearch, lookups\.customers\]\);\n\n  const totals/,
    `}, [partySearch, lookups.customers]);

  const safePartyHi = Math.min(Math.max(0, partyHi), Math.max(0, filteredParties.length - 1));

  const applyPartyPick = useCallback((pc) => {
    setCode(String(pc ?? '').trim());
    setPartyFinderOpen(false);
    setPartySearch('');
    setPartyHi(0);
  }, []);

  const totals`
  );
  // fix filteredParties to not return 150 when empty
  s23 = s23.replace(
    /if \(!q\) return list\.slice\(0, 150\);/,
    'if (!q) return [];'
  );
  s23 = s23.replace(
    /return list\.filter\(\(p\) => \{[\s\S]*?\}\);\n  }, \[partySearch/,
    (m) => m.replace(/\}\);\n  },/, '}).slice(0, 50);\n  },')
  );
  fs.writeFileSync('e:/WINDAL/APPTEST/SRC/slides/Slide23SalesOrder.jsx', s23);
}

fixPartyFind(
  'e:/WINDAL/APPTEST/SRC/slides/Slide23SalesOrder.jsx',
  'Search customer — code, name, or city',
  'Customer matches'
);

// Slide22
let s22 = fs.readFileSync('e:/WINDAL/APPTEST/SRC/slides/Slide22DispatchChallan.jsx', 'utf8');
if (!s22.includes('const applyPartyPick')) {
  s22 = s22.replace(
    /}, \[partySearch, lookups\.parties\]\);\n\n  const totals/,
    `}, [partySearch, lookups.parties]);

  const safePartyHi = Math.min(Math.max(0, partyHi), Math.max(0, filteredParties.length - 1));

  const applyPartyPick = useCallback((pc) => {
    setCode(String(pc ?? '').trim());
    setPartyFinderOpen(false);
    setPartySearch('');
    setPartyHi(0);
  }, []);

  const totals`
  );
  s22 = s22.replace(/if \(!q\) return list\.slice\(0, 150\);/, 'if (!q) return [];');
  s22 = s22.replace(
    /return list\.filter\(\(p\) => \{[\s\S]*?city\.includes\(q\);\n    \}\);\n  }, \[partySearch, lookups\.parties\]\)/,
    `return list
      .filter((p) => {
      const pc = String(p.CODE ?? p.code ?? '').toLowerCase();
      const name = String(p.NAME ?? p.name ?? '').toLowerCase();
      const city = String(p.CITY ?? p.city ?? '').toLowerCase();
      return pc.includes(q) || name.includes(q) || city.includes(q);
    })
      .slice(0, 50);
  }, [partySearch, lookups.parties])`
  );
  fs.writeFileSync('e:/WINDAL/APPTEST/SRC/slides/Slide22DispatchChallan.jsx', s22);
}

fixPartyFind(
  'e:/WINDAL/APPTEST/SRC/slides/Slide22DispatchChallan.jsx',
  'Search party — code, name, or city (schedule 11.20)',
  'Party matches'
);
