-- CreateTable
CREATE TABLE "oidc_payload" (
    "model" TEXT NOT NULL,
    "id" BYTEA NOT NULL,
    "payload" JSONB NOT NULL,
    "grant_id" TEXT,
    "uid" TEXT,
    "user_code" TEXT,
    "expires_at" TIMESTAMPTZ,
    "consumed_at" TIMESTAMPTZ,

    CONSTRAINT "oidc_payload_pkey" PRIMARY KEY ("model","id")
);

-- CreateIndex
CREATE INDEX "oidc_payload_grant_id_idx" ON "oidc_payload"("grant_id");

-- CreateIndex
CREATE INDEX "oidc_payload_uid_idx" ON "oidc_payload"("uid");

-- CreateIndex
CREATE INDEX "oidc_payload_expires_at_idx" ON "oidc_payload"("expires_at");

-- Only SHA-256 digests, never the engine's raw ids (which are the secrets themselves).
ALTER TABLE "oidc_payload" ADD CONSTRAINT "oidc_payload_id_sha256" CHECK (octet_length(id) = 32);
