import { type EntryValues, summarizeDay, sumValues } from './day-summary';

const entry = (values: Partial<EntryValues> = {}): EntryValues => ({
  kcal: 100,
  proteinG: 10,
  fatG: 5,
  carbsG: 20,
  fiberG: 2,
  ...values,
});

const targets = {
  kcal: 2000,
  proteinG: 150,
  fatG: 60,
  carbsG: 208,
  fiberG: 30,
};

describe('sumValues', () => {
  it('adds up entries, to one decimal without float noise', () => {
    expect(
      sumValues([
        entry({ kcal: 0.1 }),
        entry({ kcal: 0.2 }),
        entry({ kcal: 99.9 }),
      ]),
    ).toEqual({ kcal: 100.2, proteinG: 30, fatG: 15, carbsG: 60, fiberG: 6 });
  });

  it('is all zeros for no entries', () => {
    expect(sumValues([])).toEqual({
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbsG: 0,
      fiberG: 0,
    });
  });
});

describe('summarizeDay', () => {
  it('shows what is left of the targets', () => {
    expect(summarizeDay([entry(), entry()], targets)).toEqual({
      totals: { kcal: 200, proteinG: 20, fatG: 10, carbsG: 40, fiberG: 4 },
      remaining: {
        kcal: 1800,
        proteinG: 130,
        fatG: 50,
        carbsG: 168,
        fiberG: 26,
      },
      incomplete: [],
    });
  });

  it('goes negative when over the targets', () => {
    expect(
      summarizeDay([entry({ kcal: 2150.5 })], targets).remaining?.kcal,
    ).toBe(-150.5);
  });

  it('has nothing remaining without a goal', () => {
    expect(summarizeDay([entry()], null).remaining).toBeNull();
  });

  it('flags macros that some entry does not know', () => {
    // A quick "300 kcal" entry with no macros, next to a fully known one
    const quick = entry({
      kcal: 300,
      proteinG: null,
      fatG: null,
      carbsG: null,
      fiberG: null,
    });
    const summary = summarizeDay(
      [entry(), quick, entry({ fiberG: null })],
      targets,
    );
    expect(summary.totals).toEqual({
      kcal: 500,
      proteinG: 20,
      fatG: 10,
      carbsG: 40,
      fiberG: 2,
    });
    expect(summary.incomplete).toEqual([
      'proteinG',
      'fatG',
      'carbsG',
      'fiberG',
    ]);
    expect(
      summarizeDay([entry(), entry({ fiberG: null })], null).incomplete,
    ).toEqual(['fiberG']);
  });
});
