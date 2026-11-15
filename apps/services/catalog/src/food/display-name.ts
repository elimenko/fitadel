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
