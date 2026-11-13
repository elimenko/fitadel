-- CreateEnum
CREATE TYPE "meal" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

-- CreateTable
CREATE TABLE "diary_entry" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "meal" "meal" NOT NULL,
    "name" TEXT,
    "kcal" DECIMAL(7,1) NOT NULL,
    "protein_g" DECIMAL(6,1),
    "fat_g" DECIMAL(6,1),
    "carbs_g" DECIMAL(6,1),
    "fiber_g" DECIMAL(6,1),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "diary_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diary_entry_user_id_date_idx" ON "diary_entry"("user_id", "date");

-- Hand-written: CHECK constraints (not supported by Prisma schema). Only what can never
-- be valid; the API's ranges can change without a migration.
ALTER TABLE "diary_entry" ADD CONSTRAINT "diary_entry_values_non_negative" CHECK (
  kcal >= 0 AND protein_g >= 0 AND fat_g >= 0 AND carbs_g >= 0 AND fiber_g >= 0
);
