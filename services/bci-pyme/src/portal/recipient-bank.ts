/** Observed bank catalog and saved-detail labels differ only for these explicitly observed pairs. */
export function recipientBankMatches(detail: string, catalog: string): boolean {
  return detail === catalog
    || (catalog === 'Banco Santander / santiago' && detail === 'Banco Santander-santiago')
    || (catalog === 'Banco De Chile / edwards' && detail === 'Banco De Chile-edwards');
}
