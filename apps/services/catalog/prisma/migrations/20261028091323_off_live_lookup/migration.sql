-- AlterTable
ALTER TABLE "food" ADD COLUMN     "from_dump" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "off_lookup_miss" (
    "barcode" TEXT NOT NULL,
    "checked_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "off_lookup_miss_pkey" PRIMARY KEY ("barcode")
);
