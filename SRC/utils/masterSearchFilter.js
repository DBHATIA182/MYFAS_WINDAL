/**
 * Master / party / broker / item typeahead: no rows until the user types in the search box.
 */

export const SEARCH_TYPE_HINT = 'Type code, name, or city to search.';
export const SEARCH_ITEM_TYPE_HINT = 'Type item code or name to search.';
export const SEARCH_NO_MATCH = 'No matches — try different letters.';

export function filterCodeNameCityRows(rows, query, max = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
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
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const code = String(row.ITEM_CODE ?? row.item_code ?? '').toLowerCase();
      const name = String(row.ITEM_NAME ?? row.item_name ?? '').toLowerCase();
      return code.includes(q) || name.includes(q);
    })
    .slice(0, max);
}

export function filterAccountRows(rows, query, getCurBal, max = 50) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [];
  return (Array.isArray(rows) ? rows : [])
    .filter((a) => {
      const code = String(a.CODE ?? '').toLowerCase();
      const name = String(a.NAME ?? '').toLowerCase();
      const city = String(a.CITY ?? '').toLowerCase();
      const bal = getCurBal ? String(getCurBal(a) ?? '').toLowerCase() : '';
      return code.includes(q) || name.includes(q) || city.includes(q) || bal.includes(q);
    })
    .slice(0, max);
}
