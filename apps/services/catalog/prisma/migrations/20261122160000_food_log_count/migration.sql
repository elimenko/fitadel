-- CreateTable
CREATE TABLE "food_log_count" (
    "food_id" UUID NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "food_log_count_pkey" PRIMARY KEY ("food_id")
);

-- CreateTable
CREATE TABLE "processed_event" (
    "event_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "processed_event_processed_at_idx" ON "processed_event"("processed_at");

-- AddForeignKey
ALTER TABLE "food_log_count" ADD CONSTRAINT "food_log_count_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "food"("id") ON DELETE CASCADE ON UPDATE CASCADE;
