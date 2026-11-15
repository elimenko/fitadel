-- CreateEnum
CREATE TYPE "nutrient_basis" AS ENUM ('g', 'ml');

-- AlterTable
ALTER TABLE "diary_entry" ADD COLUMN     "amount" DECIMAL(6,1),
ADD COLUMN     "basis" "nutrient_basis",
ADD COLUMN     "brand" TEXT,
ADD COLUMN     "carbs_per_100" DECIMAL(5,2),
ADD COLUMN     "fat_per_100" DECIMAL(5,2),
ADD COLUMN     "fiber_per_100" DECIMAL(5,2),
ADD COLUMN     "food_id" UUID,
ADD COLUMN     "kcal_per_100" DECIMAL(6,2),
ADD COLUMN     "protein_per_100" DECIMAL(5,2);

-- Hand-written: CHECK constraints (not supported by Prisma schema).
-- A food entry has its food, amount, basis and kcal per 100; a manual entry has none
-- of the food columns. `x IS NULL` is never NULL, so this can't pass by being unknown.
ALTER TABLE "diary_entry" ADD CONSTRAINT "diary_entry_food_all_or_nothing" CHECK (
  (food_id IS NULL) = (amount IS NULL)
  AND (food_id IS NULL) = (basis IS NULL)
  AND (food_id IS NULL) = (kcal_per_100 IS NULL)
  AND (
    food_id IS NOT NULL
    OR (
      brand IS NULL AND protein_per_100 IS NULL AND fat_per_100 IS NULL
      AND carbs_per_100 IS NULL AND fiber_per_100 IS NULL
    )
  )
);

-- Unknown (NULL) values pass, as in diary_entry_values_non_negative
ALTER TABLE "diary_entry" ADD CONSTRAINT "diary_entry_food_values_valid" CHECK (
  amount > 0 AND kcal_per_100 >= 0 AND protein_per_100 >= 0 AND fat_per_100 >= 0
  AND carbs_per_100 >= 0 AND fiber_per_100 >= 0
);
