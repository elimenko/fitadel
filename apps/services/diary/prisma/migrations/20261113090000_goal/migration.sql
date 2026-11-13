-- CreateEnum
CREATE TYPE "adjustment_unit" AS ENUM ('percent', 'kcal');

-- CreateTable
CREATE TABLE "goal" (
    "user_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "maintenance_kcal" INTEGER NOT NULL,
    "adjustment_unit" "adjustment_unit" NOT NULL,
    "adjustment_value" INTEGER NOT NULL,
    "protein_g" INTEGER NOT NULL,
    "fat_g" INTEGER NOT NULL,
    "fiber_g" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "goal_pkey" PRIMARY KEY ("user_id","effective_from")
);

-- Hand-written: CHECK constraints (not supported by Prisma schema). Only what can never
-- be valid; the API's tighter ranges and the budget rule can change without a migration.
ALTER TABLE "goal" ADD CONSTRAINT "goal_maintenance_positive" CHECK (maintenance_kcal > 0);
ALTER TABLE "goal" ADD CONSTRAINT "goal_grams_non_negative" CHECK (
  protein_g >= 0 AND fat_g >= 0 AND fiber_g >= 0
);
