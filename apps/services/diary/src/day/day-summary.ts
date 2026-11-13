import type { DailyTargets } from '../goal/daily-targets';

export const MACROS = ['proteinG', 'fatG', 'carbsG', 'fiberG'] as const;

export type Macro = (typeof MACROS)[number];

/** An entry's values; a null macro is unknown, not 0 */
export type EntryValues = { kcal: number } & Record<Macro, number | null>;

/** Sums, or what is left of the targets. Same shape as DailyTargets. */
export type Totals = DailyTargets;

export interface DaySummary {
  totals: Totals;
  /** Targets minus totals: negative when over. Null without a goal for the day. */
  remaining: Totals | null;
  /** Macros that some entry doesn't know: their totals are a lower bound */
  incomplete: Macro[];
}

/** Adds up entries, counting unknown macros as nothing */
export function sumValues(entries: EntryValues[]): Totals {
  const sum = (pick: (entry: EntryValues) => number | null) =>
    round(entries.reduce((total, entry) => total + (pick(entry) ?? 0), 0));
  return {
    kcal: sum((entry) => entry.kcal),
    proteinG: sum((entry) => entry.proteinG),
    fatG: sum((entry) => entry.fatG),
    carbsG: sum((entry) => entry.carbsG),
    fiberG: sum((entry) => entry.fiberG),
  };
}

/** A day's totals against the targets of the goal in effect, if any */
export function summarizeDay(
  entries: EntryValues[],
  targets: DailyTargets | null,
): DaySummary {
  const totals = sumValues(entries);
  return {
    totals,
    remaining: targets && {
      kcal: round(targets.kcal - totals.kcal),
      proteinG: round(targets.proteinG - totals.proteinG),
      fatG: round(targets.fatG - totals.fatG),
      carbsG: round(targets.carbsG - totals.carbsG),
      fiberG: round(targets.fiberG - totals.fiberG),
    },
    incomplete: MACROS.filter((macro) =>
      entries.some((entry) => entry[macro] === null),
    ),
  };
}

/** To one decimal, as stored: also hides float noise (0.1 + 0.2) */
const round = (value: number) => Math.round(value * 10) / 10;
