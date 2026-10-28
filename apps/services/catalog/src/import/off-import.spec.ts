import type { CleanFood } from './off-product';
import { pgArray, toCsvRow } from './off-import';

const food: CleanFood = {
  sourceRef: '5900512300108',
  barcode: '05900512300108',
  names: { pl: 'Serek "Mój"' },
  brand: null,
  basis: 'g',
  kcal: 133,
  protein: 18,
  fat: null,
  carbs: null,
  sugars: null,
  fiber: null,
  saturatedFat: null,
  salt: null,
  extraNutrients: null,
  popularity: 0,
  countries: ['poland', 'ireland'],
  sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
  serving: null,
};

describe('pgArray', () => {
  it('quotes items and escapes quotes and backslashes', () => {
    expect(pgArray([])).toBe('{}');
    // Input a"b and c\d; output {"a\"b","c\\d"}
    expect(pgArray(['a"b', 'c\\d'])).toBe('{"a\\"b","c\\\\d"}');
  });
});

describe('toCsvRow', () => {
  it('quotes text, escapes quotes, and writes NULL as an unquoted empty field', () => {
    expect(toCsvRow(food)).toBe(
      '"5900512300108","05900512300108","{""pl"":""Serek \\""Mój\\""""}",,"g",133,18,,,,,,,,0,"{""poland"",""ireland""}","2026-01-01T00:00:00.000Z",,\n',
    );
  });
});
