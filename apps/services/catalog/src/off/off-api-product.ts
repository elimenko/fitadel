import type { OffProduct } from '../import/off-product';

/**
 * A product as the Open Food Facts API returns it (v2 and v3). Unlike the JSONL export,
 * the API still uses the legacy flat `nutriments` format:
 * { "energy-kcal_100g": 374, "proteins_100g": 76, "energy-kj_modifier": "~", ... }
 */
export interface OffApiProduct extends Omit<OffProduct, 'nutrition'> {
  nutrition_data?: unknown;
  nutrition_data_per?: unknown;
  nutriments?: Record<string, unknown>;
}

/** The fields to request, so responses stay small */
export const OFF_API_FIELDS = [
  'code',
  'lang',
  'product_name',
  'product_name_pl',
  'product_name_en',
  'product_name_ru',
  'brands',
  'countries_tags',
  'serving_size',
  'serving_quantity',
  'last_modified_t',
  'unique_scans_n',
  'nutrition_data',
  'nutrition_data_per',
  'nutriments',
];

const ENERGY_UNITS: Record<string, string> = {
  'energy-kcal': 'kcal',
  'energy-kj': 'kJ',
  energy: 'kJ',
};
// Units that aren't masses; other nutrients' _100g values are normalized to grams
const NON_MASS_UNITS = new Set(['%', '% vol', 'IU', '% DV']);

/**
 * Converts an API product to the export's shape, so one set of cleaning rules
 * (cleanOffProduct) covers both sources. A "~" modifier marks an approximate value,
 * which maps to the export's source "estimate".
 */
export function fromApiProduct(product: OffApiProduct): OffProduct {
  const { nutriments = {}, nutrition_data_per, ...rest } = product;
  const nutrients: Record<
    string,
    { value: number; unit: string; source: string }
  > = {};

  for (const [key, value] of Object.entries(nutriments)) {
    const name = key.endsWith('_100g') ? key.slice(0, -'_100g'.length) : null;
    if (!name || typeof value !== 'number') continue;
    const enteredUnit = nutriments[`${name}_unit`];
    nutrients[name] = {
      value,
      unit:
        ENERGY_UNITS[name] ??
        (typeof enteredUnit === 'string' && NON_MASS_UNITS.has(enteredUnit)
          ? enteredUnit
          : 'g'),
      source: nutriments[`${name}_modifier`] === '~' ? 'estimate' : 'packaging',
    };
  }

  return {
    ...rest,
    nutrition:
      Object.keys(nutrients).length === 0
        ? null
        : {
            aggregated_set: {
              per: nutrition_data_per === '100ml' ? '100ml' : '100g',
              nutrients,
            },
          },
  };
}
