# Identity service

Fitadel's OpenID Provider: user accounts, sign-in, and the tokens every other app and
service trusts. Built with NestJS and
[oidc-provider](https://github.com/panva/node-oidc-provider)
([ADR-0008](../../../docs/adr/0008-oidc-provider.md)), with Prisma
([ADR-0007](../../../docs/adr/0007-prisma-database-access.md)) on PostgreSQL. How it fits
with the other components: [docs/architecture/authentication.md](../../../docs/architecture/authentication.md).

> **Status:** Phase 2 in progress. The OpenID Provider runs at `/oidc` with a
> sign-in page; registration comes next.

## Running it

Prerequisites: the local infrastructure from the [root README](../../../README.md)
(`docker compose up -d`).

```sh
cp apps/services/identity/.env.example apps/services/identity/.env
pnpm nx run identity:generate-keys            # signing and cookie keys, into .env
pnpm nx run identity:prisma migrate deploy   # apply migrations
pnpm nx serve identity                       # http://localhost:3010
```

| Target                          | What it does                         |
| ------------------------------- | ------------------------------------ |
| `nx test identity`              | unit tests                           |
| `nx run identity:integration`   | tests against a throwaway Postgres   |
| `nx run identity:prisma <args>` | the Prisma CLI, as the migrator role |
| `nx run identity:generate-keys` | local signing and cookie keys        |

## OpenID Provider

[oidc-provider](https://github.com/panva/node-oidc-provider) is mounted at `/oidc`
([provider.ts](src/oidc/provider.ts)); discovery is at
`/oidc/.well-known/openid-configuration`.

- **Authorization code with PKCE only**, for every client. Access tokens are ES256 JWTs
  for the API (`aud` = `OIDC_API_AUDIENCE`) with the account's `roles`; refresh
  tokens rotate on every use.
- **Errors are generic for clients** (`invalid_grant`); the cause is logged as
  `detail`. Request parameters are never logged: they hold codes and tokens.
- **Request logs never contain credentials:** `Authorization`, `Cookie` and
  `Set-Cookie` are redacted.

### Sign-in screens

When the provider needs the user, it redirects the browser to `/interaction/<uid>`
([interaction.controller.tsx](src/interaction/interaction.controller.tsx)):

- **Pages are React components rendered to HTML on the server**, with no client
  JavaScript. React escapes every value, and the Content Security Policy allows no
  scripts and only the pages' own stylesheet (by its hash).
- **Sign-in** checks the password with `PasswordHasher` and shows one message for an
  unknown email and a wrong password. Outdated hashes are upgraded on success.
- **Consent is automatic**: every client is first-party, so the grant gets what the
  request asks for. A third-party client would need a consent page.
- **The interaction cookie ties a `uid` to the browser** that started it, so a form
  posted from elsewhere finds no interaction (CSRF protection).

### Storage

Codes, sessions, grants and refresh tokens live in `oidc_payload`
([oidc-payload-adapter.ts](src/oidc/oidc-payload-adapter.ts)):

- **Ids are stored as SHA-256 digests.** A code's or refresh token's id is the secret
  itself; a `CHECK` accepts only 32-byte digests.
- **Codes and refresh tokens are consumed atomically** (`UPDATE … WHERE consumed_at IS
NULL`). Of two concurrent requests with the same code, one gets tokens; the other
  gets `invalid_grant` and the whole grant is revoked, as on any reuse.
- Expired rows are invisible and deleted every 10 minutes.

### Keys

- `OIDC_JWKS`: private ES256 keys. The first signs; all are published at
  `/oidc/jwks`, so services can verify tokens without calling identity.
- `OIDC_COOKIE_KEYS`: HMAC keys for the provider's cookies.

Rotating a signing key: add the new key **second** (published, not signing yet), move it
**first** once verifiers have refreshed their cached key sets, and remove the old key
when its last token has expired (10 minutes for access and ID tokens).

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
this database holds secrets (password hashes, refresh tokens, sessions). A
migration grants each non-secret table explicitly; `account_password` is never granted.
