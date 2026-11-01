-- CreateTable
CREATE TABLE "pending_registration" (
    "token_hash" BYTEA NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT,
    "password_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_registration_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE INDEX "pending_registration_email_idx" ON "pending_registration"("email");

-- CreateIndex
CREATE INDEX "pending_registration_expires_at_idx" ON "pending_registration"("expires_at");

-- Hand-written: CHECK constraints (not supported by Prisma schema)
ALTER TABLE "pending_registration" ADD CONSTRAINT "pending_registration_token_hash_sha256"
    CHECK (octet_length(token_hash) = 32);
ALTER TABLE "pending_registration" ADD CONSTRAINT "pending_registration_email_normalized"
    CHECK (email = lower(btrim(email)) AND email LIKE '%_@_%');
ALTER TABLE "pending_registration" ADD CONSTRAINT "pending_registration_password_hash_phc"
    CHECK (password_hash LIKE '$%');

-- No grant to identity_reader: the table holds password hashes
