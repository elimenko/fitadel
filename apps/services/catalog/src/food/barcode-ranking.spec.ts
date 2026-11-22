import { type BarcodeMatch, rankBarcodeMatches } from './barcode-ranking';

const food = (name: string, match: Partial<BarcodeMatch>) => ({
  name,
  source: 'off' as const,
  visibility: 'public' as const,
  ownerId: null,
  popularity: 0,
  logCount: null,
  ...match,
});

describe('rankBarcodeMatches', () => {
  const popularOff = food('popular OFF', { popularity: 100 });
  const quietOff = food('quiet OFF', { popularity: 1 });
  const community = food('community', { source: 'user', ownerId: 'u2' });
  const mine = food('my copy', {
    source: 'user',
    visibility: 'private',
    ownerId: 'u1',
  });

  const names = (foods: { name: string }[]) => foods.map((f) => f.name);

  it('ranks my copy, then the community food, then imports by popularity', () => {
    expect(
      names(rankBarcodeMatches([quietOff, popularOff, community, mine], 'u1')),
    ).toEqual(['my copy', 'community', 'popular OFF', 'quiet OFF']);
  });

  it('puts the food logged most in Fitadel first, before popularity', () => {
    const loggedOff = food('logged OFF', {
      popularity: 1,
      logCount: { count: 3 },
    });
    expect(
      names(rankBarcodeMatches([popularOff, loggedOff, quietOff], null)),
    ).toEqual(['logged OFF', 'popular OFF', 'quiet OFF']);
    // Never above the viewer's own copy
    expect(names(rankBarcodeMatches([loggedOff, mine], 'u1'))[0]).toBe(
      'my copy',
    );
  });

  it("treats someone else's private copy like any user food", () => {
    expect(names(rankBarcodeMatches([popularOff, mine], 'u2'))[0]).toBe(
      'my copy',
    );
    expect(names(rankBarcodeMatches([community, mine], null))).toEqual([
      'community',
      'my copy',
    ]);
  });

  it("doesn't change the input", () => {
    const input = [quietOff, popularOff];
    rankBarcodeMatches(input, null);
    expect(names(input)).toEqual(['quiet OFF', 'popular OFF']);
  });
});
