import { hasValidCheckDigit, toGtin14 } from './barcode';

describe('toGtin14', () => {
  it('pads EAN-13, UPC-A and EAN-8 to GTIN-14', () => {
    expect(toGtin14('5900512300108')).toBe('05900512300108');
    expect(toGtin14('036000291452')).toBe('00036000291452');
    expect(toGtin14('96385074')).toBe('00000096385074');
  });

  it('gives the same result for the same code in different lengths', () => {
    expect(toGtin14('036000291452')).toBe(toGtin14('0036000291452'));
  });

  it('rejects a wrong check digit', () => {
    expect(toGtin14('5900512300109')).toBeNull();
  });

  it('rejects non-digits and unsupported lengths', () => {
    expect(toGtin14('59005123001x8')).toBeNull();
    expect(toGtin14('12345')).toBeNull();
    expect(toGtin14('12345678901234567890')).toBeNull();
  });
});

describe('hasValidCheckDigit', () => {
  it('validates GS1 check digits', () => {
    expect(hasValidCheckDigit('05900512300108')).toBe(true);
    expect(hasValidCheckDigit('05900512300100')).toBe(false);
  });
});
