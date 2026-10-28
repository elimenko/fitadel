import type { OffApiProduct } from './off-api-product';

export const WHEY_BARCODE = '5060751998501';

/** Trimmed from the real API response for 5060751998501 (Open Food Facts, ODbL) */
export const wheyProtein: OffApiProduct = {
  code: WHEY_BARCODE,
  lang: 'en',
  product_name: '100% WHEY PROTEIN DOUBLE RICH CHOCOLATE',
  product_name_en: '100% WHEY PROTEIN DOUBLE RICH CHOCOLATE',
  brands: 'Optimum Nutrition',
  countries_tags: ['en:france'],
  serving_size: '1 serving (31 g)',
  serving_quantity: 31,
  last_modified_t: 1793110339,
  unique_scans_n: 11,
  nutrition_data: 'on',
  nutrition_data_per: '100g',
  nutriments: {
    'energy-kcal': 374,
    'energy-kcal_100g': 374,
    'energy-kcal_unit': 'kcal',
    'energy-kj_100g': 1570.7,
    'energy-kj_modifier': '~',
    'energy-kj_unit': 'kJ',
    proteins_100g: 76,
    proteins_unit: 'g',
    fat_100g: 4.6,
    'saturated-fat_100g': 2.6,
    carbohydrates_100g: 5.3,
    sugars_100g: 4.2,
    fiber_100g: 1.5,
    fiber_modifier: '~',
    salt_100g: 0.53,
    alcohol_100g: 0,
    alcohol_unit: '% vol',
  },
};
