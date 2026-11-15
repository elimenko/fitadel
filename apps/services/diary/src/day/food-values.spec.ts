import { valuesFor } from './food-values';

describe('valuesFor', () => {
  const kefir = { kcal: 51, proteinG: 3.4, fatG: 2, carbsG: 4.7, fiberG: 0 };

  it('scales the values per 100 to the amount', () => {
    expect(valuesFor(kefir, 250)).toEqual({
      kcal: 127.5,
      proteinG: 8.5,
      fatG: 5,
      carbsG: 11.8, // 11.75, half up
      fiberG: 0,
    });
  });

  it('keeps unknown values unknown', () => {
    expect(
      valuesFor({ ...kefir, proteinG: null, fiberG: null }, 250),
    ).toMatchObject({ proteinG: null, fiberG: null, fatG: 5 });
  });

  it('rounds halves up, without floating-point surprises', () => {
    // 2.05 * 100 / 100 in floating point is 2.0499999999999998
    expect(valuesFor({ ...kefir, fatG: 2.05 }, 100).fatG).toBe(2.1);
    expect(valuesFor({ ...kefir, kcal: 0.35 }, 50.5).kcal).toBe(0.2); // 0.17675
    expect(valuesFor(kefir, 0.1).kcal).toBe(0.1); // 0.051
  });
});
