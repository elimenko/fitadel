-- CreateTable
CREATE TABLE "federation_attempt" (
    "state_hash" BYTEA NOT NULL,
    "interaction_uid" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "federation_attempt_pkey" PRIMARY KEY ("state_hash")
);

-- CreateTable
CREATE TABLE "federation_result" (
    "interaction_uid" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "account_id" UUID,
    "issuer" TEXT,
    "subject" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "federation_result_pkey" PRIMARY KEY ("interaction_uid")
);

-- CreateIndex
CREATE INDEX "federation_attempt_expires_at_idx" ON "federation_attempt"("expires_at");

-- CreateIndex
CREATE INDEX "federation_result_account_id_idx" ON "federation_result"("account_id");

-- CreateIndex
CREATE INDEX "federation_result_expires_at_idx" ON "federation_result"("expires_at");

-- AddForeignKey
ALTER TABLE "federation_result" ADD CONSTRAINT "federation_result_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: CHECK constraints (not supported by Prisma schema)
ALTER TABLE "federation_attempt" ADD CONSTRAINT "federation_attempt_state_hash_sha256"
    CHECK (octet_length(state_hash) = 32);

-- Each outcome carries exactly what its next step needs
ALTER TABLE "federation_result" ADD CONSTRAINT "federation_result_outcome_fields"
    CHECK (
        (outcome = 'signed_in' AND account_id IS NOT NULL AND issuer IS NULL AND subject IS NULL)
        OR (outcome = 'link_required' AND account_id IS NOT NULL AND issuer IS NOT NULL AND subject IS NOT NULL)
        OR (outcome IN ('email_unverified', 'failed') AND account_id IS NULL AND issuer IS NULL AND subject IS NULL)
    );

-- No grant to identity_reader: both tables hold sign-ins in progress, nothing to inspect
