/** The observed confirmation uses <br>, which textContent drops without a space. */
export function hasExactRecipientDeleteQuestion(renderedParagraphs: string[], name: string): boolean {
  const expected = `¿Quieres eliminar a ${name} de tus destinatarios?`;
  return renderedParagraphs.filter(text => text.replace(/\s+/gu, ' ').trim() === expected).length === 1;
}
