import type { Viewer } from '../auth/viewer';
import type { Food as FoodRow, FoodServing } from '../generated/prisma/client';
import { pickName } from './display-name';
import type { Food } from './food.dto';

/** A database row (Decimal values, JSON columns) as the API's Food */
export function toFood(
  row: FoodRow & { servings: FoodServing[] },
  languages: string[],
  viewer: Viewer | null,
): Food {
  const names = row.names as Record<string, string>;
  return {
    id: row.id,
    source: row.source,
    sourceRef: row.sourceRef,
    barcode: row.barcode,
    name: pickName(names, languages),
    names,
    brand: row.brand,
    basis: row.basis,
    per100: {
      kcal: row.kcal.toNumber(),
      protein: row.protein?.toNumber() ?? null,
      fat: row.fat?.toNumber() ?? null,
      carbs: row.carbs?.toNumber() ?? null,
      sugars: row.sugars?.toNumber() ?? null,
      fiber: row.fiber?.toNumber() ?? null,
      saturatedFat: row.saturatedFat?.toNumber() ?? null,
      salt: row.salt?.toNumber() ?? null,
    },
    otherNutrients: (row.extraNutrients ?? {}) as Food['otherNutrients'],
    servings: row.servings.map((serving) => ({
      label: serving.label,
      amount: serving.amount.toNumber(),
    })),
    countries: row.countries,
    visibility: row.visibility,
    mine: viewer !== null && row.ownerId === viewer.id,
    basedOnId: row.basedOnId,
    retired: row.retiredAt !== null,
  };
}
