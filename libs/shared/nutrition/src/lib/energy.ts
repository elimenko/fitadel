/** Energy per gram of each macronutrient, in kcal (Atwater general factors). */
export const KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9,
  alcohol: 7,
} as const;

/** Macronutrient amounts in grams. `carbs` means available carbohydrate, excluding fiber. */
export interface Macros {
  protein: number;
  carbs: number;
  fat: number;
  alcohol?: number;
}

/** Estimates the energy content of a food from its macronutrients, in kcal. */
export function kcalFromMacros({
  protein,
  carbs,
  fat,
  alcohol = 0,
}: Macros): number {
  const grams = { protein, carbs, fat, alcohol };

  for (const [nutrient, amount] of Object.entries(grams)) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(
        `${nutrient} must be a non-negative number of grams, got ${amount}`,
      );
    }
  }

  return (
    protein * KCAL_PER_GRAM.protein +
    carbs * KCAL_PER_GRAM.carbs +
    fat * KCAL_PER_GRAM.fat +
    alcohol * KCAL_PER_GRAM.alcohol
  );
}
