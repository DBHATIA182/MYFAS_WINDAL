/**
 * Master / party / broker / item typeahead: no rows until the user types in the search box.
 */

export const SEARCH_TYPE_HINT = 'Type code, name, or city to search.';
export const SEARCH_ITEM_TYPE_HINT = 'Type item code or name to search.';
export const SEARCH_NO_MATCH = 'No matches — try different letters.';

/** Remove speech / typing punctuation so "AMIT TRADING." matches AMIT TRADING. */
export function sanitizeSearchQuery(text) {
  return String(text ?? '')
    .trim()
    .replace(/[.,!?;:'"`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Voice search: show recognised text in CAPS in the search box (no trailing .). */
export function normalizeVoiceSearchQuery(text) {
  return sanitizeSearchQuery(text).toUpperCase();
}

function normalizeSearchQueryLower(query) {
  return sanitizeSearchQuery(query).toLowerCase();
}

function searchQueryTokens(query) {
  const q = normalizeSearchQueryLower(query);
  if (!q) return [];
  return q.split(/\s+/).filter((t) => t.length >= 2);
}

function tokenizeNameParts(value) {
  return String(value ?? '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function levenshtein(a, b) {
  const x = String(a ?? '');
  const y = String(b ?? '');
  if (x === y) return 0;
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = i;
    for (let j = 1; j <= y.length; j += 1) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      const next = Math.min(row[j] + 1, prev + 1, row[j - 1] + cost);
      row[j - 1] = prev;
      prev = next;
    }
    row[y.length] = prev;
  }
  return row[y.length];
}

function wordsSimilar(spoken, candidate) {
  const a = String(spoken ?? '').toUpperCase();
  const b = String(candidate ?? '').toUpperCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 3 && b.includes(a)) return true;
  if (a.length >= 3 && b.length >= 3 && a.includes(b)) return true;
  const prefixLen = Math.min(4, a.length, b.length);
  if (prefixLen >= 3 && a.slice(0, prefixLen) === b.slice(0, prefixLen)) {
    return levenshtein(a, b) <= 3;
  }
  if (Math.min(a.length, b.length) < 3) return false;
  const maxDist = Math.max(1, Math.floor(Math.min(a.length, b.length) / 4));
  return levenshtein(a, b) <= maxDist;
}

function tokenMatchesNamePart(token, nameToken) {
  const t = String(token ?? '').toUpperCase();
  const n = String(nameToken ?? '').toUpperCase();
  if (!t || !n || t.length < 2) return false;
  if (t === n) return true;
  if (n.length >= 3 && n.includes(t)) return true;
  if (t.length >= 3 && n.length >= 3 && t.includes(n)) return true;
  return wordsSimilar(t, n);
}

function rowHaystack(row) {
  const code = String(row.CODE ?? row.code ?? '').toLowerCase();
  const name = String(row.NAME ?? row.name ?? '').toLowerCase();
  const city = String(row.CITY ?? row.city ?? '').toLowerCase();
  return `${code} ${name} ${city}`;
}

function rowMatchesAllTokens(row, tokens) {
  const hay = rowHaystack(row);
  return tokens.every((t) => hay.includes(String(t).toLowerCase()));
}

function scoreTokenAgainstName(token, name, nameTokens) {
  const t = String(token ?? '').toUpperCase();
  if (!t || t.length < 2) return 0;

  let best = 0;
  if (String(name).toUpperCase().includes(t)) best = Math.max(best, 88);

  for (const nameToken of nameTokens) {
    if (tokenMatchesNamePart(t, nameToken)) {
      if (t === nameToken) best = Math.max(best, 95);
      else if (String(nameToken).includes(t)) best = Math.max(best, 85);
      else best = Math.max(best, 68);
    }
  }

  if (best === 0 && nameTokens.length === 1 && wordsSimilar(t, name)) {
    best = 60;
  }

  return best;
}

function scoreCodeNameCityRow(queryTokens, row) {
  const code = String(row.CODE ?? row.code ?? '').toUpperCase();
  const name = String(row.NAME ?? row.name ?? '').toUpperCase();
  const city = String(row.CITY ?? row.city ?? '').toUpperCase();
  const nameTokens = tokenizeNameParts(name);
  const queryJoin = queryTokens.join(' ');

  if (!queryTokens.length) return 0;
  if (name.includes(queryJoin) || code.includes(queryJoin) || city.includes(queryJoin)) {
    return 100;
  }

  const substantive = queryTokens.filter((t) => String(t).length >= 2);
  if (!substantive.length) return 0;

  let score = 0;
  for (const token of substantive) {
    let best = scoreTokenAgainstName(token, name, nameTokens);
    if (code.includes(token)) best = Math.max(best, 72);
    if (city.includes(token)) best = Math.max(best, 40);
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

export function filterCodeNameCityRowsFuzzy(rows, query, max = 50) {
  const q = sanitizeSearchQuery(query);
  if (!q) return [];
  const tokens = tokenizeNameParts(q);
  if (!tokens.length) return [];

  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: scoreCodeNameCityRow(tokens, row) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.NAME ?? a.row.name ?? '').localeCompare(String(b.row.NAME ?? b.row.name ?? '')))
    .slice(0, max)
    .map((item) => item.row);
}

/** Exact match first; fuzzy name match when pronunciation/spelling differs (voice). */
export function filterCodeNameCityRowsSmart(rows, query, max = 50) {
  const exact = filterCodeNameCityRows(rows, query, max);
  if (exact.length) return exact;
  return filterCodeNameCityRowsFuzzy(rows, query, max);
}

function scoreAccountRow(queryTokens, row, getCurBal) {
  const base = scoreCodeNameCityRow(queryTokens, row);
  if (!base) return 0;
  const bal = getCurBal ? String(getCurBal(row) ?? '').toUpperCase() : '';
  for (const token of queryTokens) {
    if (bal.includes(token)) return base + 5;
  }
  return base;
}

export function filterAccountRowsFuzzy(rows, query, getCurBal, max = 50) {
  const q = sanitizeSearchQuery(query);
  if (!q) return [];
  const tokens = tokenizeNameParts(q);
  if (!tokens.length) return [];

  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: scoreAccountRow(tokens, row, getCurBal) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.NAME ?? '').localeCompare(String(b.row.NAME ?? '')))
    .slice(0, max)
    .map((item) => item.row);
}

export function filterAccountRowsSmart(rows, query, getCurBal, max = 50) {
  const exact = filterAccountRows(rows, query, getCurBal, max);
  if (exact.length) return exact;
  return filterAccountRowsFuzzy(rows, query, getCurBal, max);
}

/**
 * Pick uppercase query from speech alternatives — prefer one that matches master rows.
 */
export function resolveVoiceSearchQuery(alternatives, rows, smartFilter, max = 50) {
  const alts = Array.isArray(alternatives) ? alternatives : [alternatives];
  let fallback = '';
  let best = { q: '', count: -1 };

  for (const alt of alts) {
    const q = normalizeVoiceSearchQuery(alt);
    if (!q) continue;
    if (!fallback) fallback = q;
    const count = smartFilter(rows, q, max).length;
    if (count > best.count) best = { q, count };
  }

  if (best.count > 0) return best.q;
  return fallback;
}

export function filterCodeNameCityRows(rows, query, max = 50) {
  const q = normalizeSearchQueryLower(query);
  if (!q) return [];
  const tokens = searchQueryTokens(query);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      if (tokens.length > 1) return rowMatchesAllTokens(row, tokens);
      const code = String(row.CODE ?? row.code ?? '').toLowerCase();
      const name = String(row.NAME ?? row.name ?? '').toLowerCase();
      const city = String(row.CITY ?? row.city ?? '').toLowerCase();
      return code.includes(q) || name.includes(q) || city.includes(q);
    })
    .slice(0, max);
}

export function filterItemCodeNameRows(rows, query, max = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row.ITEM_CODE ?? row.item_code ?? '').trim();
    if (!code) continue;
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    const codeL = code.toLowerCase();
    const name = String(row.ITEM_NAME ?? row.item_name ?? '').toLowerCase();
    if (!codeL.includes(q) && !name.includes(q)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= max) break;
  }
  return out;
}

export const SEARCH_PLANT_TYPE_HINT = 'Type plant code or name to search.';

export function filterPlantCodeNameRows(rows, query, max = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const code = String(row.PLANT_CODE ?? row.plant_code ?? '').toLowerCase();
      const name = String(row.PLANT_NAME ?? row.plant_name ?? '').toLowerCase();
      return code.includes(q) || name.includes(q);
    })
    .slice(0, max);
}

export function filterAccountRows(rows, query, getCurBal, max = 50) {
  const q = normalizeSearchQueryLower(query);
  if (!q) return [];
  const tokens = searchQueryTokens(query);
  return (Array.isArray(rows) ? rows : [])
    .filter((a) => {
      if (tokens.length > 1) {
        const hay = rowHaystack(a);
        const bal = getCurBal ? ` ${String(getCurBal(a) ?? '').toLowerCase()}` : '';
        return tokens.every((t) => `${hay}${bal}`.includes(t));
      }
      const code = String(a.CODE ?? '').toLowerCase();
      const name = String(a.NAME ?? '').toLowerCase();
      const city = String(a.CITY ?? '').toLowerCase();
      const bal = getCurBal ? String(getCurBal(a) ?? '').toLowerCase() : '';
      return code.includes(q) || name.includes(q) || city.includes(q) || bal.includes(q);
    })
    .slice(0, max);
}
