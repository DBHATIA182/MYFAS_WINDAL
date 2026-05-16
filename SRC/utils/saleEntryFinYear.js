import { toInputDateString, toDisplayDate } from './dateFormat';

/** Selected FY + date bounds: prefer API form-context (COMPDET), then login formData. */
export function resolveSaleEntryFinYear(formData, ctx) {
  const compYear = String(
    formData?.comp_year ?? formData?.COMP_YEAR ?? ctx?.G_COMP_YEAR ?? ''
  ).trim();
  const fyMinYmd =
    toInputDateString(ctx?.COMP_S_DT ?? formData?.comp_s_dt ?? formData?.COMP_S_DT) || '';
  const fyMaxYmd =
    toInputDateString(ctx?.COMP_E_DT ?? formData?.comp_e_dt ?? formData?.COMP_E_DT) || '';
  const gFinYear = String(ctx?.G_FIN_YEAR ?? '').trim();
  return { compYear, fyMinYmd, fyMaxYmd, gFinYear };
}

export function clampYmdToFinYear(ymd, fyMinYmd, fyMaxYmd) {
  const s = String(ymd ?? '').trim();
  if (!s) return s;
  if (fyMinYmd && s < fyMinYmd) return fyMinYmd;
  if (fyMaxYmd && s > fyMaxYmd) return fyMaxYmd;
  return s;
}

export function defaultDocDateInFinYear(fyMinYmd, fyMaxYmd) {
  return clampYmdToFinYear(toInputDateString(new Date()), fyMinYmd, fyMaxYmd);
}

export function finYearRangeLabel(fyMinYmd, fyMaxYmd) {
  if (!fyMinYmd && !fyMaxYmd) return '—';
  if (fyMinYmd && fyMaxYmd) return `${toDisplayDate(fyMinYmd)} – ${toDisplayDate(fyMaxYmd)}`;
  if (fyMinYmd) return `from ${toDisplayDate(fyMinYmd)}`;
  return `to ${toDisplayDate(fyMaxYmd)}`;
}
