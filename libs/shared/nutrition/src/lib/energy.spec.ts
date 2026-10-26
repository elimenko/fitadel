import { kcalFromMacros } from './energy';

describe('kcalFromMacros', () => {
  it('applies the Atwater factors to each macronutrient', () => {
    expect(kcalFromMacros({ protein: 10, carbs: 20, fat: 5 })).toBe(165);
  });

  it('counts alcohol when present', () => {
    expect(kcalFromMacros({ protein: 0, carbs: 0, fat: 0, alcohol: 10 })).toBe(
      70,
    );
  });

  it('returns 0 for a food without macronutrients', () => {
    expect(kcalFromMacros({ protein: 0, carbs: 0, fat: 0 })).toBe(0);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %p grams',
    (amount) => {
      expect(() =>
        kcalFromMacros({ protein: amount, carbs: 0, fat: 0 }),
      ).toThrow(RangeError);
    },
  );
});
