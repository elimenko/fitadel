import type { EntryValues } from './day-summary';

/** A food's values per 100 g or per 100 ml; null = unknown */
export interface Per100 {
  kcal: number;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  fiberG: number | null;
}

/**
 * The values of `amount` (in the food's basis unit) of a food, rounded to one decimal
 * as they are stored. Unknown stays unknown: it is never turned into 0.
 *
 * Integer maths first: per-100 values have 2 decimals and amounts 1, so in hundredths
 * and tenths the product is an exact integer, and halves round up as expected
 * (2.05 × 100 g is 2.1, where floating point would give 2.0499… → 2.0).
 */
export function valuesFor(per100: Per100, amount: number): EntryValues {
  const tenthsOfAmount = Math.round(amount * 10);
  const scale = (value: number | null) => {
    if (value === null) return null;
    const product = Math.round(value * 100) * tenthsOfAmount; // in 1/100 000
    return Math.round(product / 10_000) / 10;
  };
  return {
    kcal: scale(per100.kcal) ?? 0,
    proteinG: scale(per100.proteinG),
    fatG: scale(per100.fatG),
    carbsG: scale(per100.carbsG),
    fiberG: scale(per100.fiberG),
  };
}
