import { toDisplayDate } from './dateFormat';
import { resolveSaleEntryFinYear } from './saleEntryFinYear';

const SEP = ' | ';

/**
 * Session fields as separate parts (pipe-joined for display).
 * comp_code | comp_name | FY year | start | end | comp_uid [| user]
 */
export function buildAppSessionParts({
  formData,
  ctx,
  userName,
  companyName,
  includeUser = false,
} = {}) {
  const fd = formData || {};
  const code = String(fd.comp_code ?? fd.COMP_CODE ?? '').trim();
  const name = String(companyName ?? fd.comp_name ?? fd.COMP_NAME ?? '').trim();
  const uid = String(fd.comp_uid ?? fd.COMP_UID ?? '').trim();
  const user = String(userName ?? fd.user_name ?? fd.USER_NAME ?? '').trim();
  const { compYear, fyMinYmd, fyMaxYmd } = resolveSaleEntryFinYear(fd, ctx);

  const parts = [];
  if (code) parts.push(code);
  if (name) parts.push(name);
  if (compYear) parts.push(`FY ${compYear}`);
  const startDisp = fyMinYmd ? toDisplayDate(fyMinYmd) : '';
  const endDisp = fyMaxYmd ? toDisplayDate(fyMaxYmd) : '';
  if (startDisp) parts.push(startDisp);
  if (endDisp) parts.push(endDisp);
  if (uid) parts.push(uid);
  if (includeUser && user) parts.push(user);

  return parts;
}

export function buildAppSessionLine(opts = {}) {
  return buildAppSessionParts({ ...opts, includeUser: true }).join(SEP) || '—';
}
