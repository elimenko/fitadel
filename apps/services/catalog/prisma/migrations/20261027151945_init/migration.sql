-- Hand-written (not expressible in schema.prisma): extensions and the search normalizer
-- pg_trgm and unaccent are trusted extensions, so the database owner can install them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Lowercase and strip diacritics: 'Żółty' -> 'zolty', 'Ёлка' -> 'елка'.
-- unaccent() is only STABLE; pinning its dictionary lets us declare IMMUTABLE, which
-- expression indexes require. Changing the unaccent rules requires a reindex.
CREATE FUNCTION f_norm(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN lower(public.unaccent('public.unaccent'::regdictionary, $1));

-- The text that food search matches against. Search queries must use this exact
-- expression, food_search_text(names, brand), so the planner can use the indexes.
CREATE FUNCTION food_search_text(names jsonb, brand text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN f_norm(
    coalesce(names->>'pl', '') || ' ' || coalesce(names->>'en', '') || ' ' ||
    coalesce(names->>'ru', '') || ' ' || coalesce(brand, '')
  );

-- CreateEnum
CREATE TYPE "food_source" AS ENUM ('off', 'usda', 'user');

-- CreateEnum
CREATE TYPE "visibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "nutrient_basis" AS ENUM ('g', 'ml');

-- CreateTable
CREATE TABLE "food" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "source" "food_source" NOT NULL,
    "source_ref" TEXT,
    "owner_id" UUID,
    "visibility" "visibility" NOT NULL DEFAULT 'public',
    "based_on_id" UUID,
    "barcode" TEXT,
    "names" JSONB NOT NULL,
    "brand" TEXT,
    "basis" "nutrient_basis" NOT NULL DEFAULT 'g',
    "kcal" DECIMAL(6,2) NOT NULL,
    "protein" DECIMAL(5,2),
    "fat" DECIMAL(5,2),
    "carbs" DECIMAL(5,2),
    "sugars" DECIMAL(5,2),
    "fiber" DECIMAL(5,2),
    "saturated_fat" DECIMAL(5,2),
    "salt" DECIMAL(5,2),
    "extra_nutrients" JSONB,
    "source_updated_at" TIMESTAMPTZ,
    "retired_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "food_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_serving" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "food_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(7,2) NOT NULL,

    CONSTRAINT "food_serving_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "food_barcode_idx" ON "food"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "food_source_source_ref_key" ON "food"("source", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "food_public_user_barcode_key" ON "food"("barcode") WHERE (source = 'user' AND visibility = 'public');

-- CreateIndex
CREATE UNIQUE INDEX "food_private_owner_barcode_key" ON "food"("owner_id", "barcode") WHERE (visibility = 'private');

-- CreateIndex
CREATE INDEX "food_serving_food_id_idx" ON "food_serving"("food_id");

-- AddForeignKey
ALTER TABLE "food" ADD CONSTRAINT "food_based_on_id_fkey" FOREIGN KEY ("based_on_id") REFERENCES "food"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_serving" ADD CONSTRAINT "food_serving_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "food"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: search expression indexes (see ADR-0006). Prisma ignores expression indexes.
CREATE INDEX "food_search_trgm_idx" ON "food" USING GIN (food_search_text(names, brand) gin_trgm_ops);
CREATE INDEX "food_search_fts_idx" ON "food" USING GIN (to_tsvector('simple', food_search_text(names, brand)));

-- Hand-written: CHECK constraints (not supported by Prisma schema)
-- Per 100 g or 100 ml. NULL (unknown) passes, because a comparison with NULL isn't false.
ALTER TABLE "food" ADD CONSTRAINT "food_kcal_range" CHECK (kcal BETWEEN 0 AND 1000);
ALTER TABLE "food" ADD CONSTRAINT "food_grams_range" CHECK (
    protein BETWEEN 0 AND 100 AND fat BETWEEN 0 AND 100 AND carbs BETWEEN 0 AND 100 AND
    sugars BETWEEN 0 AND 100 AND fiber BETWEEN 0 AND 100 AND
    saturated_fat BETWEEN 0 AND 100 AND salt BETWEEN 0 AND 100
);
ALTER TABLE "food" ADD CONSTRAINT "food_names_object" CHECK (
    jsonb_typeof(names) = 'object' AND names <> '{}'::jsonb
);
-- Imported foods are public, have no owner and always carry their source id
ALTER TABLE "food" ADD CONSTRAINT "food_imported_shape" CHECK (
    source = 'user' OR (
        owner_id IS NULL AND visibility = 'public' AND
        source_ref IS NOT NULL AND based_on_id IS NULL
    )
);
ALTER TABLE "food" ADD CONSTRAINT "food_private_has_owner" CHECK (
    visibility = 'public' OR owner_id IS NOT NULL
);
ALTER TABLE "food_serving" ADD CONSTRAINT "food_serving_amount_positive" CHECK (amount > 0);
ALTER TABLE "food_serving" ADD CONSTRAINT "food_serving_label_not_empty" CHECK (label <> '');
