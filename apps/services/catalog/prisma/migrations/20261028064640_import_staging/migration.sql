-- AlterTable
ALTER TABLE "food" ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "popularity" INTEGER NOT NULL DEFAULT 0;

-- Hand-written: CHECK constraint
ALTER TABLE "food" ADD CONSTRAINT "food_popularity_not_negative" CHECK (popularity >= 0);

-- CreateTable
-- Hand-written: UNLOGGED, because staging data is disposable. Skipping the write-ahead
-- log makes bulk loads faster; after a crash Postgres empties the table.
CREATE UNLOGGED TABLE "food_import" (
    "source_ref" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "brand" TEXT,
    "basis" "nutrient_basis" NOT NULL,
    "kcal" DECIMAL(6,2) NOT NULL,
    "protein" DECIMAL(5,2),
    "fat" DECIMAL(5,2),
    "carbs" DECIMAL(5,2),
    "sugars" DECIMAL(5,2),
    "fiber" DECIMAL(5,2),
    "saturated_fat" DECIMAL(5,2),
    "salt" DECIMAL(5,2),
    "extra_nutrients" JSONB,
    "popularity" INTEGER NOT NULL,
    "countries" TEXT[],
    "source_updated_at" TIMESTAMPTZ,
    "serving_label" TEXT,
    "serving_amount" DECIMAL(7,2),

    CONSTRAINT "food_import_pkey" PRIMARY KEY ("source_ref")
);

-- Hand-written: search every name, not only pl/en/ru. Many products sold in Poland only
-- have a French or German name. jsonb_each_text returns keys in a fixed order, so the
-- function stays deterministic (IMMUTABLE).
CREATE OR REPLACE FUNCTION food_search_text(names jsonb, brand text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN f_norm(
    coalesce((SELECT string_agg(value, ' ') FROM jsonb_each_text(names)), '') ||
    ' ' || coalesce(brand, '')
  );

-- The indexes store results of the old function. Postgres doesn't track that, so they
-- must be rebuilt, or searches would silently use stale values.
REINDEX INDEX "food_search_trgm_idx";
REINDEX INDEX "food_search_fts_idx";
