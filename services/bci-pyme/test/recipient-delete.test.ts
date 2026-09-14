import { expect, it } from 'vitest';
import { hasExactRecipientDeleteQuestion } from '../src/portal/recipient-delete.js';

it('verifies the exact recipient in a rendered deletion question containing a line break', () => {
  const question = '¿Quieres eliminar a Synthetic Recipient de tus\ndestinatarios?';
  expect(hasExactRecipientDeleteQuestion([question, 'Synthetic secondary text'], 'Synthetic Recipient')).toBe(true);
  expect(hasExactRecipientDeleteQuestion([question], 'Different Synthetic Recipient')).toBe(false);
  expect(hasExactRecipientDeleteQuestion([question, question], 'Synthetic Recipient')).toBe(false);
  expect(hasExactRecipientDeleteQuestion(['Unrelated question'], 'Synthetic Recipient')).toBe(false);
});
