/**
 * The languages a client asks for, best first, from an Accept-Language header,
 * e.g. "ru-RU,ru;q=0.9,en;q=0.8" -> ['ru', 'en']. Only primary subtags matter here:
 * names are stored as "pl", "en", "ru", not "ru-RU".
 */
export function preferredLanguages(header: string | undefined): string[] {
  if (!header) return [];
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params
        .map((param) => param.trim().match(/^q=([\d.]+)$/))
        .find(Boolean)?.[1];
      return {
        language: tag.trim().toLowerCase().split('-')[0],
        quality: q === undefined ? 1 : Number(q),
        index,
      };
    })
    .filter(
      ({ language, quality }) => /^[a-z]{2,3}$/.test(language) && quality > 0,
    )
    // Higher quality first; equal quality keeps the header's order
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return [...new Set(ranked.map(({ language }) => language))];
}

/** Fallbacks after the client's own languages: most foods are Polish or English */
const FALLBACKS = ['pl', 'en'];

/** The name to show: the client's languages first, then Polish, English, or any */
export function pickName(
  names: Record<string, string>,
  languages: string[],
): string {
  for (const language of [...languages, ...FALLBACKS]) {
    if (names[language]) return names[language];
  }
  // Import rules guarantee at least one name; take a deterministic one
  const [first] = Object.keys(names).sort();
  return names[first] ?? '';
}
