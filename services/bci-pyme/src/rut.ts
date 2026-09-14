export function isValidRut(value: string): boolean {
  const normalized = value.replace(/[.-]/gu, '').toUpperCase();
  if (!/^\d{7,8}[0-9K]$/u.test(normalized)) return false;
  const body = normalized.slice(0, -1);
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const checkDigit = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return normalized.at(-1) === checkDigit;
}
