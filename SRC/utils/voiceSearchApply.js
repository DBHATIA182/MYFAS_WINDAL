import {
  filterAccountRowsSmart,
  filterCodeNameCityRowsSmart,
  normalizeVoiceSearchQuery,
  resolveVoiceSearchQuery,
} from './masterSearchFilter';

export function applyVoicePartyBrokerSearch({
  transcript,
  rows,
  setQuery,
  setHighlight,
  clearSelection,
  inputRef,
}) {
  const q = resolveVoiceSearchQuery(transcript, rows, filterCodeNameCityRowsSmart, 50);
  if (!q) return;
  clearSelection?.();
  setQuery(q);
  setHighlight?.(0);
  window.setTimeout(() => inputRef?.current?.focus(), 0);
}

export function applyVoiceAccountSearch({
  transcript,
  rows,
  getCurBal,
  setQuery,
  setHighlight,
  clearSelection,
  inputRef,
}) {
  const smart = (list, query, max) => filterAccountRowsSmart(list, query, getCurBal, max);
  const q = resolveVoiceSearchQuery(transcript, rows, smart, 50);
  if (!q) return;
  clearSelection?.();
  setQuery(q);
  setHighlight?.(0);
  window.setTimeout(() => inputRef?.current?.focus(), 0);
}

export { normalizeVoiceSearchQuery };
