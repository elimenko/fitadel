-- CreateTable
CREATE TABLE "password_reset" (
    "token_hash" BYTEA NOT NULL,
    "account_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "password_reset_account_id_idx" ON "password_reset"("account_id");

-- CreateIndex
CREATE INDEX "password_reset_expires_at_idx" ON "password_reset"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: CHECK constraints (not supported by Prisma schema)
ALTER TABLE "password_reset" ADD CONSTRAINT "password_reset_token_hash_sha256"
    CHECK (octet_length(token_hash) = 32);

-- No grant to identity_reader: a token hash is only useful with the link, but nobody
-- reading data needs it
