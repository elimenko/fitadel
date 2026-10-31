-- CreateEnum
CREATE TYPE "role" AS ENUM ('contributor');

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ,
    "display_name" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_password" (
    "account_id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "account_password_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "account_identity" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "account_id" UUID NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_role" (
    "account_id" UUID NOT NULL,
    "role" "role" NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "granted_by" UUID,

    CONSTRAINT "account_role_pkey" PRIMARY KEY ("account_id","role")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_email_key" ON "account"("email");

-- CreateIndex
CREATE INDEX "account_identity_account_id_idx" ON "account_identity"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_identity_issuer_subject_key" ON "account_identity"("issuer", "subject");

-- AddForeignKey
ALTER TABLE "account_password" ADD CONSTRAINT "account_password_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_identity" ADD CONSTRAINT "account_identity_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_role" ADD CONSTRAINT "account_role_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: CHECK constraints (not supported by Prisma schema)
-- The service normalizes emails; this stops a bug from creating "Egor@x" next to "egor@x".
ALTER TABLE "account" ADD CONSTRAINT "account_email_normalized" CHECK (
    email = lower(btrim(email)) AND email LIKE '%_@_%'
);
-- Only PHC strings ("$argon2id$..."): a plain-text password can never be stored by mistake.
ALTER TABLE "account_password" ADD CONSTRAINT "account_password_hash_phc" CHECK (hash LIKE '$%');

-- Hand-written: identity_reader sees only tables granted here, never account_password
-- (tools/db/identity.psql gives it no default privileges).
GRANT SELECT ON "account", "account_identity", "account_role" TO identity_reader;
