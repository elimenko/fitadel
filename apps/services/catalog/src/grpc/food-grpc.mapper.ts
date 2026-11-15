import { type Food as GrpcFood, NutrientBasis } from '@fitadel/catalog-grpc';
import type { Food } from '../food/food.dto';

const BASIS: Record<Food['basis'], NutrientBasis> = {
  g: NutrientBasis.NUTRIENT_BASIS_G,
  ml: NutrientBasis.NUTRIENT_BASIS_ML,
};

/**
 * The API's Food as the gRPC contract's. An unknown value (null) is left unset, never
 * sent as 0: in proto3 an unset number reads as 0 unless the field is `optional`.
 */
export function toGrpcFood(food: Food): GrpcFood {
  const { kcal, protein, fat, carbs, fiber } = food.per100;
  return {
    id: food.id,
    name: food.name,
    brand: food.brand ?? undefined,
    basis: BASIS[food.basis],
    per100: {
      kcal,
      proteinG: protein ?? undefined,
      fatG: fat ?? undefined,
      carbsG: carbs ?? undefined,
      fiberG: fiber ?? undefined,
    },
  };
}
