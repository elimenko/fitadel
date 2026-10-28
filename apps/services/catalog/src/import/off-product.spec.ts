import { cleanOffProduct, type OffProduct } from './off-product';

const nutrient = (value: number, unit = 'g', source = 'packaging') => ({
  value,
  unit,
  source,
});

/** A valid Polish product in the shape of the Open Food Facts dump */
function product(overrides: Partial<OffProduct> = {}): OffProduct {
  return {
    code: '5900512300108',
    lang: 'pl',
    product_name: 'Twaróg półtłusty',
    product_name_pl: 'Twaróg półtłusty',
    brands: 'Piątnica, Okręgowa Spółdzielnia Mleczarska',
    serving_size: '1 porcja (50 g)',
    serving_quantity: '50',
    last_modified_t: 1770902371,
    unique_scans_n: 42,
    countries_tags: ['en:poland', 'en:ireland', 'en:poland'],
    nutrition: {
      aggregated_set: {
        per: '100g',
        nutrients: {
          'energy-kcal': nutrient(133, 'kcal'),
          'energy-kj': nutrient(556, 'kJ'),
          proteins: nutrient(18),
          fat: nutrient(4),
          carbohydrates: nutrient(3.5),
          sugars: nutrient(3.5),
          salt: nutrient(0.1),
          calcium: nutrient(0.09),
        },
      },
    },
    ...overrides,
  };
}

function withNutrients(
  nutrients: Record<string, unknown>,
): Partial<OffProduct> {
  return {
    nutrition: {
      aggregated_set: {
        per: '100g',
        nutrients: {
          ...product().nutrition?.aggregated_set?.nutrients,
          ...nutrients,
        } as never,
      },
    },
  };
}

function cleaned(overrides: Partial<OffProduct> = {}) {
  const result = cleanOffProduct(product(overrides));
  if (!result.ok) throw new Error(`rejected: ${result.reason}`);
  return result;
}

function rejection(overrides: Partial<OffProduct>) {
  const result = cleanOffProduct(product(overrides));
  return result.ok ? 'imported' : result.reason;
}

describe('cleanOffProduct', () => {
  it('maps a valid product', () => {
    const { food, warnings } = cleaned();
    expect(food).toMatchObject({
      sourceRef: '5900512300108',
      barcode: '05900512300108',
      names: { pl: 'Twaróg półtłusty' },
      brand: 'Piątnica',
      basis: 'g',
      kcal: 133,
      protein: 18,
      fat: 4,
      carbs: 3.5,
      fiber: null,
      extraNutrients: { calcium: { value: 0.09, unit: 'g' } },
      popularity: 42,
      countries: ['poland', 'ireland'],
      sourceUpdatedAt: new Date(1770902371 * 1000),
      serving: { label: '1 porcja (50 g)', amount: 50 },
    });
    expect(warnings).toEqual([]);
  });

  describe('barcode', () => {
    it('rejects an invalid check digit', () => {
      expect(rejection({ code: '5900512300109' })).toBe('bad_barcode');
    });
  });

  describe('names', () => {
    it('removes control characters, which Postgres text cannot store', () => {
      const { food } = cleaned({ product_name_pl: 'Mleko\u0000 3,2%\u0007' });
      expect(food.names.pl).toBe('Mleko 3,2%');
    });

    it('decodes HTML entities and collapses whitespace', () => {
      const { food } = cleaned({
        product_name_pl: ' Serek &quot;Mój&quot;\n ulubiony ',
      });
      expect(food.names.pl).toBe('Serek "Mój" ulubiony');
    });

    it('drops a Russian name without Cyrillic letters', () => {
      const { food, warnings } = cleaned({ product_name_ru: 'Abdukodir' });
      expect(food.names.ru).toBeUndefined();
      expect(warnings).toContain('name_dropped');
    });

    it('keeps a Russian name in Cyrillic', () => {
      expect(cleaned({ product_name_ru: 'Творог' }).food.names.ru).toBe(
        'Творог',
      );
    });

    it('uses the main name under its own language', () => {
      const { food } = cleaned({
        lang: 'de',
        product_name: 'Quark',
        product_name_pl: undefined,
      });
      expect(food.names).toEqual({ de: 'Quark' });
    });

    it('rejects a product without a usable name', () => {
      expect(rejection({ product_name: '  ', product_name_pl: '123' })).toBe(
        'no_name',
      );
    });
  });

  describe('energy', () => {
    it('converts kJ when kcal is missing', () => {
      const { food } = cleaned(
        withNutrients({
          'energy-kcal': undefined,
          'energy-kj': nutrient(556, 'kJ'),
        }),
      );
      expect(food.kcal).toBe(132.89);
    });

    it('rejects products without nutrition data', () => {
      expect(rejection({ nutrition: null })).toBe('no_nutrition');
      expect(
        rejection(
          withNutrients({ 'energy-kcal': undefined, 'energy-kj': undefined }),
        ),
      ).toBe('no_energy');
    });

    it('rejects estimated energy', () => {
      expect(
        rejection(
          withNutrients({ 'energy-kcal': nutrient(133, 'kcal', 'estimate') }),
        ),
      ).toBe('estimated_energy');
    });

    it('rejects energy outside 0–1000 kcal', () => {
      expect(
        rejection(withNutrients({ 'energy-kcal': nutrient(1500, 'kcal') })),
      ).toBe('energy_out_of_range');
    });
  });

  describe('nutrients', () => {
    it('drops an estimated nutrient but keeps the product', () => {
      const { food, warnings } = cleaned(
        withNutrients({ fiber: nutrient(4.3, 'g', 'estimate') }),
      );
      expect(food.fiber).toBeNull();
      expect(warnings).toContain('estimated_nutrient_dropped');
    });

    it('drops a nutrient outside 0–100 g', () => {
      const { food, warnings } = cleaned(
        withNutrients({ salt: nutrient(140) }),
      );
      expect(food.salt).toBeNull();
      expect(warnings).toContain('nutrient_dropped');
    });

    it('rejects macros heavier than 100 g per 100 g', () => {
      expect(
        rejection(
          withNutrients({
            proteins: nutrient(50),
            fat: nutrient(40),
            carbohydrates: nutrient(30),
          }),
        ),
      ).toBe('macros_exceed_100g');
    });

    it('warns when kcal disagrees with the macros', () => {
      const { warnings } = cleaned(
        withNutrients({ 'energy-kcal': nutrient(400, 'kcal') }),
      );
      expect(warnings).toContain('kcal_macros_mismatch');
    });

    it('uses per 100 ml for drinks', () => {
      const { food } = cleaned({
        nutrition: {
          aggregated_set: {
            per: '100ml',
            nutrients: { 'energy-kcal': nutrient(42, 'kcal') },
          },
        },
      });
      expect(food.basis).toBe('ml');
    });
  });

  describe('serving', () => {
    it('drops a serving that rounds to 0 (found by the full import)', () => {
      expect(cleaned({ serving_quantity: '0.004' }).food.serving).toBeNull();
    });

    it('drops a serving without a size label', () => {
      expect(cleaned({ serving_size: '' }).food.serving).toBeNull();
    });
  });
});
