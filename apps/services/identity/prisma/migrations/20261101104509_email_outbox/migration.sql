-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text_body" TEXT NOT NULL,
    "html_body" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_next_attempt_at_idx" ON "email_outbox"("next_attempt_at");

-- No grant to identity_reader: until sent, the bodies hold verification and reset links
