/**
 * Barcodes are stored in one canonical form, GTIN-14: digits only, left-padded with
 * zeros. EAN-8, UPC-A (12), EAN-13 and GTIN-14 versions of the same code then match.
 * Lookups must normalize scanned codes the same way.
 */
export function toGtin14(code: string): string | null {
  const digits = code.trim();
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) {
    return null;
  }
  const gtin = digits.padStart(14, '0');
  return hasValidCheckDigit(gtin) ? gtin : null;
}

/**
 * GS1 check digit: from the right, excluding the check digit itself, weigh the digits
 * 3, 1, 3, 1, ...; the check digit makes the total a multiple of 10.
 */
export function hasValidCheckDigit(gtin: string): boolean {
  const payload = gtin.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[payload.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(gtin.at(-1));
}
