/**
 * Read row[field] with case-insensitive column name (Oracle / drivers vary).
 */
export function rowFieldCI(row, logicalName) {
  if (!row || logicalName == null || logicalName === '') return '';
  const t = String(logicalName).toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === t) {
      const val = row[k];
      if (val == null) return '';
      return typeof val === 'string' ? val.trim() : String(val);
    }
  }
  return '';
}

/** First non-empty match among logical column names (legacy / alternate spellings). */
export function rowFieldAny(row, logicalNames) {
  if (!row || !logicalNames?.length) return '';
  for (const name of logicalNames) {
    const v = rowFieldCI(row, name);
    if (v) return v;
  }
  return '';
}
