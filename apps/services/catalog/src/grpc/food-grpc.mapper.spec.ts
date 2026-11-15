import { NutrientBasis } from '@fitadel/catalog-grpc';
import type { Food } from '../food/food.dto';
import { toGrpcFood } from './food-grpc.mapper';

const food = (overrides: Partial<Food> = {}): Food => ({
  id: '0192f8a4-6a3e-7c00-8f00-000000000001',
  source: 'user',
  sourceRef: null,
  barcode: null,
  name: 'Kefir',
  names: { pl: 'Kefir' },
  brand: 'Piątnica',
  basis: 'ml',
  per100: {
    kcal: 51,
    protein: 3.4,
    fat: 2,
    carbs: 4.7,
    sugars: 4.7,
    fiber: 0,
    saturatedFat: 1.3,
    salt: 0.1,
  },
  otherNutrients: {},
  servings: [],
  countries: [],
  visibility: 'public',
  mine: false,
  basedOnId: null,
  retired: false,
  ...overrides,
});

describe('toGrpcFood', () => {
  it('maps the name, brand, basis and the values per 100', () => {
    expect(toGrpcFood(food())).toEqual({
      id: '0192f8a4-6a3e-7c00-8f00-000000000001',
      name: 'Kefir',
      brand: 'Piątnica',
      basis: NutrientBasis.NUTRIENT_BASIS_ML,
      per100: { kcal: 51, proteinG: 3.4, fatG: 2, carbsG: 4.7, fiberG: 0 },
    });
  });

  it('leaves unknown values unset, and keeps a known 0', () => {
    const mapped = toGrpcFood(
      food({
        brand: null,
        basis: 'g',
        per100: { ...food().per100, protein: null, carbs: null, fiber: 0 },
      }),
    );
    expect(mapped.basis).toBe(NutrientBasis.NUTRIENT_BASIS_G);
    expect(mapped).not.toHaveProperty('brand', null);
    expect(mapped.brand).toBeUndefined();
    expect(mapped.per100?.proteinG).toBeUndefined();
    expect(mapped.per100?.carbsG).toBeUndefined();
    expect(mapped.per100?.fiberG).toBe(0);
  });
});
