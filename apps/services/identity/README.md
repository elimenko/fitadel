# Identity service

Fitadel's OpenID Provider: user accounts, sign-in, and the tokens every other app and
service trusts. Built with NestJS and
[oidc-provider](https://github.com/panva/node-oidc-provider)
([ADR-0008](../../../docs/adr/0008-oidc-provider.md)), with Prisma
([ADR-0007](../../../docs/adr/0007-prisma-database-access.md)) on PostgreSQL. How it fits
with the other components: [docs/architecture/authentication.md](../../../docs/architecture/authentication.md).

> **Status:** Phase 2 in progress. Accounts and password hashing exist; the OpenID
> Provider endpoints and the sign-in screens come next.

## Running it

Prerequisites: the local infrastructure from the [root README](../../../README.md)
(`docker compose up -d`).

```sh
cp apps/services/identity/.env.example apps/services/identity/.env
pnpm nx run identity:prisma migrate deploy   # apply migrations
pnpm nx serve identity                       # http://localhost:3010
```

| Target                          | What it does                         |
| ------------------------------- | ------------------------------------ |
| `nx test identity`              | unit tests                           |
| `nx run identity:prisma <args>` | the Prisma CLI, as the migrator role |

## Accounts

| Table              | Holds                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| `account`          | one row per person; its `id` is the `sub` claim in tokens              |
| `account_password` | the password hash, for accounts that have a password                   |
| `account_identity` | sign-ins through external providers, keyed by their issuer and subject |
| `account_role`     | roles such as `contributor`, with who granted them and when            |

- **The email is a login name, not a key.** It's stored trimmed and lowercased, and is
  unique. Tokens and other services refer to accounts by `id` only.
- **External identities are keyed by `(issuer, subject)`, never by email.** An email
  that hasn't been verified never links an external identity to an existing account.

## Passwords

Hashed with **argon2id**, OWASP's baseline parameters: 19 MiB of memory, 2 passes,
1 lane ([password-hasher.ts](src/account/password-hasher.ts)).

- **Stored as PHC strings** (`$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`). Every hash
  carries its own random salt and parameters. A `CHECK` rejects anything else, so a
  plain-text password can't be stored by mistake.
- **Raising the parameters is safe.** Old hashes keep working; a successful sign-in
  reports `needsRehash`, and the hash is replaced while the password is at hand.
- **Unicode is normalized (NFKC) before hashing**, so a password typed on different
  keyboards matches.
- **Unknown accounts cost a real verification** against a dummy hash, so response times
  don't reveal which emails have accounts.
- **Hashing runs on libuv's thread pool:** it doesn't block the event loop, and at most
  4 hashes (76 MiB) run at once. Sign-in endpoints need rate limits all the same.

## Database access

Each role gets only what it needs ([tools/db/identity.psql](../../../tools/db/identity.psql)):

| Role                | Can                                                            | Used by                |
| ------------------- | -------------------------------------------------------------- | ---------------------- |
| `identity_migrator` | owns the database: create and alter tables                     | `prisma migrate`       |
| `identity_app`      | read and write rows in every table (no schema changes)         | the service            |
| `identity_reader`   | read rows in **explicitly granted** tables; read-only sessions | people, in SQL clients |

Unlike the catalog's reader, `identity_reader` gets no access to new tables by default:
this database holds secrets (password hashes, and later refresh tokens and sessions). A
migration grants each non-secret table explicitly; `account_password` is never granted.
