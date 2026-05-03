import * as XLSX from 'xlsx';

function sanitizeFilenamePart(s) {
  return String(s || 'report')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 80);
}

/** Excel sheet name max 31 chars; forbidden : \ / ? * [ ] */
function sanitizeSheetName(s) {
  const t = String(s || 'Sheet').replace(/[:\\/?*[\]]/g, '_').trim() || 'Sheet';
  return t.slice(0, 31);
}

function stamp() {
  return new Date().toISOString().split('T')[0];
}

const AUTOFIT_MIN_WCH = 8;
const AUTOFIT_MAX_WCH = 85;
const AUTOFIT_PAD = 2;

/** Set `!cols` from content so Excel opens with sensible column widths (SheetJS has no true autofit). */
function autoFitWorksheetColumns(ws) {
  const ref = ws['!ref'];
  if (!ref) return;
  let range;
  try {
    range = XLSX.utils.decode_range(ref);
  } catch {
    return;
  }
  const cols = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    let maxLen = AUTOFIT_MIN_WCH;
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const raw = cell.w != null && String(cell.w).trim() !== '' ? String(cell.w) : cell.v;
      if (raw == null || raw === '') continue;
      const len = String(raw).length;
      if (len > maxLen) maxLen = len;
    }
    cols.push({
      wch: Math.min(AUTOFIT_MAX_WCH, Math.max(AUTOFIT_MIN_WCH, maxLen + AUTOFIT_PAD)),
    });
  }
  ws['!cols'] = cols;
}

/**
 * Download .xlsx from one or more object-row datasets.
 * @param {{ name: string, data: object[] }[]} sheets
 * @param {string} baseFilename without extension (e.g. company + report id)
 */
export function downloadExcelWorkbook(sheets, baseFilename, options = {}) {
  const wb = XLSX.utils.book_new();
  const list = Array.isArray(sheets) && sheets.length > 0 ? sheets : [{ name: 'Sheet1', data: [] }];
  const defaultStartRow = Math.max(1, Number(options?.startRow) || 1);
  const sheetStartRows = options?.sheetStartRows && typeof options.sheetStartRows === 'object' ? options.sheetStartRows : {};
  const includeHeaders = options?.includeHeaders !== false;
  const sheetTitles = options?.sheetTitles || {};
  const sheetHeaderRows = options?.sheetHeaderRows || {};
  const emptySheetHeaders = options?.emptySheetHeaders || {};
  const autoFitColumns = options?.autoFitColumns !== false;
  for (const { name, data } of list) {
    const per = sheetStartRows[name];
    const startRow = Number.isFinite(Number(per)) && Number(per) >= 1 ? Number(per) : defaultStartRow;
    const originCell = `A${startRow}`;
    const emptyPrefix = Array.from({ length: Math.max(0, startRow - 1) }, () => []);
    const rows = Array.isArray(data) ? data : [];
    let ws;
    if (rows.length === 0) {
      ws = XLSX.utils.aoa_to_sheet(emptyPrefix);
      const headers = Array.isArray(emptySheetHeaders?.[name]) ? emptySheetHeaders[name] : [];
      if (includeHeaders && headers.length > 0) {
        XLSX.utils.sheet_add_aoa(ws, [headers], { origin: originCell });
      }
    } else {
      ws = XLSX.utils.aoa_to_sheet(emptyPrefix);
      XLSX.utils.sheet_add_json(ws, rows, { origin: originCell, skipHeader: !includeHeaders });
    }
    const title = String(sheetTitles?.[name] ?? '').trim();
    if (title) {
      XLSX.utils.sheet_add_aoa(ws, [[title]], { origin: 'A1' });
    }
    const headerRows = Array.isArray(sheetHeaderRows?.[name]) ? sheetHeaderRows[name] : [];
    headerRows.forEach((h) => {
      if (!h || !h.origin || !Array.isArray(h.values)) return;
      XLSX.utils.sheet_add_aoa(ws, h.values, { origin: h.origin });
    });
    if (autoFitColumns) autoFitWorksheetColumns(ws);
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(name));
  }
  const fname = `${sanitizeFilenamePart(baseFilename)}_${stamp()}.xlsx`;
  const autoOpen = options?.autoOpen === true;
  if (autoOpen) {
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  XLSX.writeFile(wb, fname);
}

/** Single sheet from array of plain objects (API / report rows). */
export function downloadExcelRows(rows, sheetName, baseFilename) {
  downloadExcelWorkbook([{ name: sheetName, data: rows }], baseFilename);
}
