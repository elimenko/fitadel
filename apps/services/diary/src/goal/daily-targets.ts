/** What a user enters as their goal */
export interface GoalSettings {
  maintenanceKcal: number;
  /** A deficit is negative: -20 % or -500 kcal */
  adjustment: { unit: 'percent' | 'kcal'; value: number };
  proteinG: number;
  fatG: number;
  fiberG: number;
}

/** What a day is measured against */
export interface DailyTargets {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number;
}

/** Energy per gram (Atwater factors), as on food labels */
const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 } as const;

/** Settings that leave no room for the targets: no budget, or not enough for protein and fat */
export class UnreachableGoal extends Error {}

/**
 * The daily budget and macro targets. Protein, fat and fiber are set by the user; carbs
 * get whatever energy is left. Values are rounded to whole kcal and grams.
 */
export function dailyTargets(goal: GoalSettings): DailyTargets {
  const kcal = budgetKcal(goal);
  if (kcal <= 0) {
    throw new UnreachableGoal(`The adjustment leaves a budget of ${kcal} kcal`);
  }
  const proteinFatKcal =
    goal.proteinG * KCAL_PER_G.protein + goal.fatG * KCAL_PER_G.fat;
  if (proteinFatKcal > kcal) {
    throw new UnreachableGoal(
      `Protein and fat alone are ${proteinFatKcal} kcal, more than the budget of ${kcal} kcal`,
    );
  }
  return {
    kcal,
    proteinG: goal.proteinG,
    fatG: goal.fatG,
    carbsG: Math.round((kcal - proteinFatKcal) / KCAL_PER_G.carbs),
    fiberG: goal.fiberG,
  };
}

function budgetKcal({ maintenanceKcal, adjustment }: GoalSettings): number {
  return adjustment.unit === 'percent'
    ? // Multiply first: 2600 * 80 / 100 is exact, 2600 * 0.8 is 2080.0000000000002
      Math.round((maintenanceKcal * (100 + adjustment.value)) / 100)
    : maintenanceKcal + adjustment.value;
}
