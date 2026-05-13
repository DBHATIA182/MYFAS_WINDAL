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

/**
 * Sale print (PDF / preview): tax column headers use one CGST/SGST/IGST % label. Oracle rows are ordered by
 * bill keys; a first line with zero % (e.g. charges row) should not hide rates on later lines.
 */
export function saleBillTaxPercentForHeader(lines, firstRow, logicalName) {
  const readPer = (row) => {
    if (!row) return NaN;
    const raw = rowFieldCI(row, logicalName);
    if (raw === '' || raw == null) return NaN;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
  };
  const head = readPer(firstRow);
  if (Number.isFinite(head) && Math.abs(head) > 0.0001) return head;
  for (const row of lines || []) {
    const n = readPer(row);
    if (Number.isFinite(n) && Math.abs(n) > 0.0001) return n;
  }
  const fb = readPer(firstRow);
  return Number.isFinite(fb) ? fb : 0;
}

/** compdet / legacy fields sometimes store stray leading punctuation (e.g. “-UDY11111”, “-123455”). */
export function stripLeadingRegistrationJunk(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  return s.replace(/^[\s\-–—.:]+/u, '').trim();
}

/** IRN / ACK / E-way: treat null, blanks, and dash-like placeholders as absent (do not show headings). */
export function saleBillEinvoiceText(row, logicalNames) {
  const s0 = rowFieldAny(row, logicalNames);
  if (!s0) return '';
  const t = s0.replace(/\u2012|\u2013|\u2014/g, '-').trim();
  if (!t || t === '-' || t === '—') return '';
  const low = t.toLowerCase();
  if (low === 'null' || low === 'na' || low === 'n/a' || low === 'none') return '';
  if (/^[\s\-–—.:]+$/u.test(s0.trim())) return '';
  return s0.trim();
}
