import { cleanOffProduct } from '../import/off-product';
import { fromApiProduct } from './off-api-product';
import { wheyProtein } from './off-api-product.fixture';

describe('fromApiProduct', () => {
  it('converts legacy nutriments to the export format', () => {
    const product = fromApiProduct(wheyProtein);
    expect(product.nutrition?.aggregated_set).toMatchObject({
      per: '100g',
      nutrients: {
        'energy-kcal': { value: 374, unit: 'kcal', source: 'packaging' },
        // Computed by Open Food Facts from kcal: approximate
        'energy-kj': { value: 1570.7, unit: 'kJ', source: 'estimate' },
        proteins: { value: 76, unit: 'g', source: 'packaging' },
        alcohol: { value: 0, unit: '% vol', source: 'packaging' },
      },
    });
  });

  it('feeds the same cleaning rules as the export', () => {
    const result = cleanOffProduct(fromApiProduct(wheyProtein));
    if (!result.ok) throw new Error(`rejected: ${result.reason}`);
    expect(result.food).toMatchObject({
      barcode: '05060751998501',
      names: { en: '100% WHEY PROTEIN DOUBLE RICH CHOCOLATE' },
      brand: 'Optimum Nutrition',
      kcal: 374,
      protein: 76,
      // "~" marks an estimate, which the rules drop
      fiber: null,
      serving: { label: '1 serving (31 g)', amount: 31 },
    });
  });

  it('has no nutrition when the API has no per-100 values', () => {
    expect(
      fromApiProduct({ code: '1', nutriments: { 'energy-kcal': 5 } }).nutrition,
    ).toBeNull();
  });
});
