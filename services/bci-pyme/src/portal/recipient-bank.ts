/** Observed bank catalog and saved-detail labels differ for this one bank. */
export function recipientBankMatches(detail: string, catalog: string): boolean {
  return detail === catalog
    || (catalog === 'Banco Santander / santiago' && detail === 'Banco Santander-santiago');
}
