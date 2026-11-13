import {
  dailyTargets,
  type GoalSettings,
  UnreachableGoal,
} from './daily-targets';

const goal = (overrides: Partial<GoalSettings> = {}): GoalSettings => ({
  maintenanceKcal: 2600,
  adjustment: { unit: 'kcal', value: 0 },
  proteinG: 150,
  fatG: 60,
  fiberG: 30,
  ...overrides,
});

describe('dailyTargets', () => {
  it('uses maintenance calories as the budget without an adjustment', () => {
    expect(dailyTargets(goal())).toEqual({
      kcal: 2600,
      proteinG: 150,
      fatG: 60,
      // (2600 - 150 * 4 - 60 * 9) / 4
      carbsG: 365,
      fiberG: 30,
    });
  });

  it('adjusts by kcal', () => {
    expect(
      dailyTargets(goal({ adjustment: { unit: 'kcal', value: -500 } })).kcal,
    ).toBe(2100);
    expect(
      dailyTargets(goal({ adjustment: { unit: 'kcal', value: 300 } })).kcal,
    ).toBe(2900);
  });

  it('adjusts by percent, rounded to whole kcal', () => {
    expect(
      dailyTargets(goal({ adjustment: { unit: 'percent', value: -20 } })).kcal,
    ).toBe(2080);
    expect(
      dailyTargets(
        goal({
          maintenanceKcal: 2345,
          adjustment: { unit: 'percent', value: -15 },
        }),
      ).kcal,
    ).toBe(1993); // 1993.25
  });

  it('rounds carbs to whole grams', () => {
    // (2100 - 160 * 4 - 65 * 9) / 4 = 218.75
    expect(
      dailyTargets(
        goal({
          adjustment: { unit: 'kcal', value: -500 },
          proteinG: 160,
          fatG: 65,
        }),
      ).carbsG,
    ).toBe(219);
  });

  it('leaves no carbs when protein and fat use the whole budget', () => {
    // 200 * 4 + 200 * 9 = 2600
    expect(dailyTargets(goal({ proteinG: 200, fatG: 200 })).carbsG).toBe(0);
  });

  it('rejects protein and fat that need more than the budget', () => {
    expect(() => dailyTargets(goal({ proteinG: 200, fatG: 201 }))).toThrow(
      new UnreachableGoal(
        'Protein and fat alone are 2609 kcal, more than the budget of 2600 kcal',
      ),
    );
  });

  it('rejects an adjustment that leaves no budget', () => {
    expect(() =>
      dailyTargets(goal({ adjustment: { unit: 'kcal', value: -2600 } })),
    ).toThrow(UnreachableGoal);
  });
});
