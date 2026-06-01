/** Windal initial-flow branding (login, company, year). */
export const WINDAL_BRAND = {
  fasPrefix: '(FAS)',
  productName: 'WINDAL',
  tagline: 'Financial Accounting System',
  logoLetter: 'W',
  documentTitle: '(FAS) WINDAL - Financial Accounting System',
  footerNote: 'Oracle • WINDAL',
};

export function getWindalDocumentTitle(configTitle) {
  const custom = String(configTitle || '').trim();
  if (custom && !/mahavira|mffas/i.test(custom)) {
    return custom;
  }
  return WINDAL_BRAND.documentTitle;
}
