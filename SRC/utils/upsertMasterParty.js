/** Insert or replace a MASTER row in an in-memory party/broker list (sorted by name). */
export function upsertMasterParty(list, row) {
  const pc = String(row.CODE ?? row.code ?? '').trim();
  if (!pc) return list || [];
  const entry = {
    CODE: pc,
    code: pc,
    NAME: row.NAME ?? row.name ?? '',
    name: row.NAME ?? row.name ?? '',
    CITY: row.CITY ?? row.city ?? '',
    city: row.CITY ?? row.city ?? '',
    GST_NO: row.GST_NO ?? row.gst_no ?? '',
    gst_no: row.GST_NO ?? row.gst_no ?? '',
    PAN: row.PAN ?? row.pan ?? '',
    pan: row.PAN ?? row.pan ?? '',
    SELF_BROK: row.SELF_BROK ?? row.self_brok ?? 'N',
    self_brok: row.SELF_BROK ?? row.self_brok ?? 'N',
    L_C: row.L_C ?? row.l_c ?? 'L',
    l_c: row.L_C ?? row.l_c ?? 'L',
  };
  const next = (list || []).filter((p) => String(p.CODE ?? p.code) !== pc);
  next.push(entry);
  next.sort((a, b) =>
    String(a.NAME ?? a.name ?? '').localeCompare(String(b.NAME ?? b.name ?? ''))
  );
  return next;
}
