/** What ranking needs to know about a food that matches a scanned barcode */
export interface BarcodeMatch {
  source: 'off' | 'usda' | 'user';
  visibility: 'public' | 'private';
  ownerId: string | null;
  popularity: number;
  /** Logs in Fitadel, from the diary's events; null before the first one */
  logCount: { count: number } | null;
}

/**
 * Orders the foods that share a barcode, best first:
 * 1. the viewer's own private copy (their correction of a food),
 * 2. a community food (public, entered by a user),
 * 3. imported foods (Open Food Facts).
 * Within each, the food logged most often in Fitadel comes first, then the one scanned
 * most often at Open Food Facts.
 * The best one is shown; the rest are offered as alternatives.
 */
export function rankBarcodeMatches<T extends BarcodeMatch>(
  matches: T[],
  viewerId: string | null,
): T[] {
  const rank = (food: T) =>
    viewerId !== null &&
    food.visibility === 'private' &&
    food.ownerId === viewerId
      ? 0
      : food.source === 'user'
        ? 1
        : 2;
  const logged = (food: T) => food.logCount?.count ?? 0;
  return [...matches].sort(
    (a, b) =>
      rank(a) - rank(b) || logged(b) - logged(a) || b.popularity - a.popularity,
  );
}
