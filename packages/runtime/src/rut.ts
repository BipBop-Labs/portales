/** Chilean RUTs. Inputs accept any common form (dots or not, dash or not, k or K, spaces);
 *  results always use the canonical form `12345678-9` so values compare with `===` across
 *  services. Each portal adapter formats what its own page expects at its boundary. */

const RUT = /^(\d{7,8})([0-9K])$/u;

function checkDigit(body: string): string {
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  return remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
}

/** Body and check digit of a valid RUT in any common form, or null. */
function parts(value: string): { body: string; dv: string } | null {
  const match = RUT.exec(value.replace(/[\s.-]/gu, '').toUpperCase());
  if (match === null) return null;
  const body = (match[1] as string).replace(/^0+/u, '');
  const dv = match[2] as string;
  return body.length >= 7 && checkDigit(body) === dv ? { body, dv } : null;
}

export function isValidRut(value: string): boolean {
  return parts(value) !== null;
}

/** `12345678-9`: no dots, dash, uppercase K. Null when the value is not a valid RUT. */
export function canonicalRut(value: string): string | null {
  const rut = parts(value);
  return rut === null ? null : `${rut.body}-${rut.dv}`;
}

/** Body and check digit without separators, for inputs that format as you type. */
export function rutDigits(value: string): string | null {
  const rut = parts(value);
  return rut === null ? null : `${rut.body}${rut.dv}`;
}

/** True when both values are the same valid RUT, whatever their formatting. */
export function sameRut(left: string, right: string): boolean {
  const a = canonicalRut(left);
  return a !== null && a === canonicalRut(right);
}
