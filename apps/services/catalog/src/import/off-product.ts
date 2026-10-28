import { kcalFromMacros } from '@fitadel/shared-nutrition';
import { toGtin14 } from '../food/barcode';

/** The fields we read from an Open Food Facts product (JSONL dump or API). */
export interface OffProduct {
  code?: unknown;
  lang?: unknown;
  product_name?: unknown;
  product_name_pl?: unknown;
  product_name_en?: unknown;
  product_name_ru?: unknown;
  brands?: unknown;
  serving_size?: unknown;
  serving_quantity?: unknown;
  last_modified_t?: unknown;
  unique_scans_n?: unknown;
  countries_tags?: unknown;
  nutrition?: {
    aggregated_set?: {
      per?: unknown;
      nutrients?: Record<string, OffNutrient | undefined>;
    };
  } | null;
}

interface OffNutrient {
  value?: unknown;
  unit?: unknown;
  /** packaging | manufacturer | estimate | ... */
  source?: unknown;
}

/** Why a product isn't imported */
export type RejectReason =
  | 'bad_barcode'
  | 'no_name'
  | 'no_nutrition'
  | 'no_energy'
  | 'estimated_energy'
  | 'energy_out_of_range'
  | 'macros_exceed_100g';

/** Imported, but worth counting in the quality report */
export type Warning =
  | 'nutrient_dropped'
  | 'estimated_nutrient_dropped'
  | 'name_dropped'
  | 'kcal_macros_mismatch';

export interface CleanFood {
  sourceRef: string;
  barcode: string;
  names: Record<string, string>;
  brand: string | null;
  basis: 'g' | 'ml';
  kcal: number;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  sugars: number | null;
  fiber: number | null;
  saturatedFat: number | null;
  salt: number | null;
  extraNutrients: Record<string, { value: number; unit: string }> | null;
  popularity: number;
  /** Where it's sold, e.g. ['poland', 'ireland']; ranks Polish products first */
  countries: string[];
  sourceUpdatedAt: Date | null;
  serving: { label: string; amount: number } | null;
}

export type CleanResult =
  | { ok: true; food: CleanFood; warnings: Warning[] }
  | { ok: false; reason: RejectReason };

/** Column in food -> nutrient name in Open Food Facts (all in grams) */
const GRAM_NUTRIENTS = {
  protein: 'proteins',
  fat: 'fat',
  carbs: 'carbohydrates',
  sugars: 'sugars',
  fiber: 'fiber',
  saturatedFat: 'saturated-fat',
  salt: 'salt',
} as const;
type GramColumn = keyof typeof GRAM_NUTRIENTS;

const ENERGY_NUTRIENTS = ['energy-kcal', 'energy-kj', 'energy'];
const KJ_PER_KCAL = 4.184;

export function cleanOffProduct(product: OffProduct): CleanResult {
  const warnings: Warning[] = [];

  const sourceRef = text(product.code);
  const barcode = sourceRef && toGtin14(sourceRef);
  if (!sourceRef || !barcode) return { ok: false, reason: 'bad_barcode' };

  const names = cleanNames(product, warnings);
  if (Object.keys(names).length === 0) return { ok: false, reason: 'no_name' };

  const set = product.nutrition?.aggregated_set;
  const basis = set?.per === '100g' ? 'g' : set?.per === '100ml' ? 'ml' : null;
  if (!basis) return { ok: false, reason: 'no_nutrition' };
  const nutrients = set?.nutrients ?? {};

  // Energy: kcal from the label, else kJ converted
  const energy = nutrients['energy-kcal'] ?? nutrients['energy-kj'];
  if (!energy || typeof energy.value !== 'number') {
    return { ok: false, reason: 'no_energy' };
  }
  if (energy.source === 'estimate') {
    return { ok: false, reason: 'estimated_energy' };
  }
  const kcal = round2(
    energy.unit === 'kJ' ? energy.value / KJ_PER_KCAL : energy.value,
  );
  if (!(kcal >= 0 && kcal <= 1000)) {
    return { ok: false, reason: 'energy_out_of_range' };
  }

  // Only values printed on the label, in grams; anything else becomes NULL
  const grams = {} as Record<GramColumn, number | null>;
  for (const [column, name] of Object.entries(GRAM_NUTRIENTS)) {
    grams[column as GramColumn] = labelGrams(nutrients[name], warnings);
  }

  const { protein, fat, carbs } = grams;
  // Per 100 g, the macros can't weigh more than 100 g (5 g leeway for rounding)
  if (basis === 'g' && (protein ?? 0) + (fat ?? 0) + (carbs ?? 0) > 105) {
    return { ok: false, reason: 'macros_exceed_100g' };
  }
  if (protein !== null && fat !== null && carbs !== null) {
    const expected = kcalFromMacros({ protein, fat, carbs });
    if (Math.abs(kcal - expected) > Math.max(30, kcal * 0.2)) {
      warnings.push('kcal_macros_mismatch');
    }
  }

  const modified = int(product.last_modified_t);
  return {
    ok: true,
    warnings,
    food: {
      sourceRef,
      barcode,
      names,
      brand: text(product.brands)?.split(',')[0]?.trim() || null,
      basis,
      kcal,
      ...grams,
      extraNutrients: extraNutrients(nutrients),
      popularity: Math.min(
        Math.max(int(product.unique_scans_n) ?? 0, 0),
        2 ** 31 - 1,
      ),
      countries: countries(product.countries_tags),
      sourceUpdatedAt: modified === null ? null : new Date(modified * 1000),
      serving: serving(product),
    },
  };
}

function cleanNames(
  product: OffProduct,
  warnings: Warning[],
): Record<string, string> {
  const candidates: [string, unknown][] = [
    ['pl', product.product_name_pl],
    ['en', product.product_name_en],
    ['ru', product.product_name_ru],
  ];
  // The main name, under the product's own language, if that slot is still free
  const lang = text(product.lang);
  if (lang && /^[a-z]{2}$/.test(lang)) {
    candidates.push([lang, product.product_name]);
  }

  const names: Record<string, string> = {};
  for (const [language, value] of candidates) {
    if (names[language]) continue;
    const name = text(value);
    if (!name) continue;
    // A "Russian" name must contain Cyrillic; any other name at least one letter
    const plausible =
      language === 'ru'
        ? /\p{Script=Cyrillic}/u.test(name)
        : /\p{L}/u.test(name);
    if (plausible) names[language] = name;
    else warnings.push('name_dropped');
  }
  return names;
}

function labelGrams(
  nutrient: OffNutrient | undefined,
  warnings: Warning[],
): number | null {
  if (!nutrient || typeof nutrient.value !== 'number') return null;
  if (nutrient.source === 'estimate') {
    warnings.push('estimated_nutrient_dropped');
    return null;
  }
  const grams = round2(nutrient.value);
  if (nutrient.unit !== 'g' || !(grams >= 0 && grams <= 100)) {
    warnings.push('nutrient_dropped');
    return null;
  }
  return grams;
}

function extraNutrients(
  nutrients: Record<string, OffNutrient | undefined>,
): CleanFood['extraNutrients'] {
  const known = new Set<string>([
    ...Object.values(GRAM_NUTRIENTS),
    ...ENERGY_NUTRIENTS,
  ]);
  const extra: NonNullable<CleanFood['extraNutrients']> = {};
  for (const [name, nutrient] of Object.entries(nutrients)) {
    if (known.has(name) || !nutrient || nutrient.source === 'estimate')
      continue;
    if (
      typeof nutrient.value !== 'number' ||
      typeof nutrient.unit !== 'string'
    ) {
      continue;
    }
    extra[name] = { value: nutrient.value, unit: nutrient.unit };
  }
  return Object.keys(extra).length > 0 ? extra : null;
}

/** Open Food Facts tags like 'en:poland' -> 'poland' */
function countries(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const names = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => tag.replace(/^en:/, '').trim())
    .filter((name) => /^[a-z][a-z-]*$/.test(name));
  return [...new Set(names)];
}

function serving(product: OffProduct): CleanFood['serving'] {
  const label = text(product.serving_size);
  // Check after rounding: 0.004 would pass "> 0" and then be stored as 0.00
  const amount = round2(Number(product.serving_quantity));
  if (!label || !(amount > 0 && amount <= 10_000)) return null;
  return { label, amount };
}

/**
 * A trimmed string with HTML entities decoded, control characters removed (Postgres
 * text can't hold NUL) and whitespace collapsed, or null
 */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = decodeEntities(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
      const code = /^#x/i.test(body)
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    },
  );
}

function int(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
