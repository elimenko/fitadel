# Identity service

Fitadel's OpenID Provider: user accounts, sign-in, and the tokens every other app and
service trusts. Built with NestJS and
[oidc-provider](https://github.com/panva/node-oidc-provider)
([ADR-0008](../../../docs/adr/0008-oidc-provider.md)), with Prisma
([ADR-0007](../../../docs/adr/0007-prisma-database-access.md)) on PostgreSQL. How it fits
with the other components: [docs/architecture/authentication.md](../../../docs/architecture/authentication.md).

> **Status:** Phase 2 in progress. The OpenID Provider runs at `/oidc` with sign-in,
> registration confirmed by email, password reset, and sign-in with Google.

## Running it

Prerequisites: the local infrastructure from the [root README](../../../README.md)
(`docker compose up -d`).

```sh
cp apps/services/identity/.env.example apps/services/identity/.env
pnpm nx run identity:generate-keys            # signing and cookie keys, into .env
pnpm nx run identity:prisma migrate deploy   # apply migrations
pnpm nx serve identity                       # on :3010, used through the gateway
```

Clients use identity through the gateway at `http://localhost:8080`
([ADR-0009](../../../docs/adr/0009-envoy-api-gateway.md)): the issuer is the gateway's URL,
so tokens issued on `:3010` directly carry a different `iss` and services refuse them.
The service trusts the gateway's `X-Forwarded-For` entry as the client IP
(`TRUST_PROXY_HOPS=1`); with no gateway in front, set it to 0.

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
  scripts and only the pages' own stylesheet (by its hash). The one exception is the
  email confirmation page (see Registration), which allows its own script by hash.
- **Sign-in** checks the password with `PasswordHasher` and shows one message for an
  unknown email and a wrong password. Outdated hashes are upgraded on success.
- **Registration** shows "check your email" whether the address is new or taken, and
  stays in the sign-in flow: after confirming, the user signs in there and continues
  to the app (see Registration).
- **Consent is automatic**: every client is first-party, so the grant gets what the
  request asks for. A third-party client would need a consent page.
- **The interaction cookie ties a `uid` to the browser** that started it, so a form
  posted from elsewhere finds no interaction (CSRF protection).

### Rate limits

Counted in Postgres (`rate_limit`, [rate-limiter.ts](src/rate-limit/rate-limiter.ts)), so
every replica shares them; 15-minute windows (emails: 1 hour), checked
before any password is hashed:

| Limit               | Max | Counts                                   |
| ------------------- | --- | ---------------------------------------- |
| Sign-in per email   | 10  | failures (a success gives its slot back) |
| Sign-in per IP      | 50  | every attempt                            |
| Registration per IP | 10  | every attempt                            |
| Registration emails | 3   | per address and hour; over it, no email  |
| Reset requests      | 10  | per IP, every attempt                    |
| Reset emails        | 3   | per address and hour; over it, no email  |

- **Slowed down, never locked out:** a blocked email works again in the next window.
  Unknown emails are limited the same way, so the limit reveals nothing.
- **Counting is atomic** (`INSERT … ON CONFLICT DO UPDATE … RETURNING count`): of a
  burst of simultaneous attempts, exactly the maximum get through.
- Emails are stored as SHA-256 in the keys. Behind the gateway (Phase 2 Step 4) the
  client IP must come from a trusted `X-Forwarded-For`.

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

Registrations waiting for their email link live in `pending_registration` (see
Registration), not in `account`.

- **The email is a login name, not a key.** It's stored trimmed and lowercased, and is
  unique. Tokens and other services refer to accounts by `id` only.
- **External identities are keyed by `(issuer, subject)`, never by email.** A Google
  identity is linked to an existing account only after signing in to that account,
  never automatically because the emails match, verified or not. A verified email
  proves someone could read the inbox, not that they registered the account: an
  attacker can register your address with their password and hope you click the link
  (pre-account takeover).

### Registration

Two steps ([registration.service.ts](src/account/registration.service.ts)): the form
starts it, the emailed link finishes it.

- **The form** checks the password, hashes it, and in one transaction either stores a
  `pending_registration` and queues a verification email, or, for a taken address,
  queues an "already registered" email instead. Same page, same work, same time
  either way, so the form reveals nothing about which addresses have accounts.
- **The account is created only by the link**, already verified. Nobody can claim an
  address they can't read, and unconfirmed registrations expire after 24 hours
  (deleted hourly).
- **The link's token** is 32 random bytes, stored as SHA-256 only, works once.
- **It travels in the fragment** (`/verify-email#token=…`), which browsers never send:
  no access log, trace, gateway or load balancer can record it. The confirmation page
  has one script, allowed by its hash on that page alone, that copies it into the form
  and removes it from the address bar.
- **Opening the link uses nothing up;** pressing "Confirm email" (a POST) does. Mail
  scanners open every link in an email, but don't press buttons.
- **Confirming twice, or two links for one email at once,** creates one account: the
  pending rows of an email are locked in a fixed order first (without it, two
  confirmations deadlocked).

### Password reset

"Forgot your password?" on the sign-in page
([password-reset.service.ts](src/account/password-reset.service.ts)):

- **The request page always says "check your email".** An address with an account
  gets a reset link, one without gets "there's no account for this address": one
  transaction and one email either way, so the page and its timing reveal nothing.
- **The link works once, for 30 minutes**: a leaked reset token takes over the
  account, unlike a verification token. Same token handling as registration (stored as
  SHA-256, in the fragment, one hashed script on the page).
- **The new password passes the same rules** (length, breach check). After a rejected
  one the token comes back in the page body, so the user can try again.
- **A reset signs the account out everywhere:** its sessions, grants, refresh tokens
  and codes are deleted (every `oidc_payload` row with its `accountId`). Access tokens
  already issued work until they expire, within 10 minutes. People reset when they
  think someone got in; this gets them out.
- **The owner is told** by a "your password was changed" email, and the email counts
  as verified.
- **Two links of one account used at once** take turns: each locks the account row
  first.

### Sign-in with Google

"Continue with Google" on the sign-in page makes identity a client of Google: the
authorization code flow with PKCE, `state` and `nonce`
([google-client.ts](src/federation/google-client.ts), openid-client). Google's ID token is
validated (signature, `iss`, `aud`, `exp`, `nonce`) and mapped to an account
([federation.service.ts](src/federation/federation.service.ts)):

| Google identity `(iss, sub)` | Account with Google's email | Result                                                     |
| ---------------------------- | --------------------------- | ---------------------------------------------------------- |
| linked                       | —                           | signed in                                                  |
| not linked                   | none                        | new account, email verified, no password; then linked      |
| not linked                   | exists                      | "Connect Google": the account's password once, then linked |

- **Google must vouch for the email** (`email_verified`), or it can't become a login
  name: nobody signs in.
- **Linking needs the password of the account with that email**, never matching
  emails alone (see Accounts). Signing in to another account in the same interaction
  links nothing.
- **Three requests:** `POST /interaction/<uid>/google` stores the attempt and redirects to
  Google; Google redirects back to the fixed `GET /interaction/google/callback`; that
  sends the browser on to `GET /interaction/<uid>/google`, where the interaction
  finishes. The middle hop exists because the interaction cookie only reaches
  `/interaction/<uid>` ([google.controller.tsx](src/interaction/google.controller.tsx)).
- **Each attempt works once, in one browser:** `federation_attempt` stores the `state`
  as SHA-256 with the PKCE verifier and nonce, and the callback deletes it as it reads
  it (two callbacks at once: one wins). A `state` cookie scoped to the callback path
  must match, so a callback URL carrying someone else's code is refused (login CSRF).
  The result waits in `federation_result` for the interaction. Both expire after
  10 minutes.
- **A Google-only account can add a password** through "Forgot your password?".
- **Off unless configured:** without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` the
  button is hidden and the routes refuse.

Setting up a Google client (free, no billing account):

1. Google Cloud Console → a new project → **Google Auth Platform**.
2. **Branding** and **Audience:** External, Testing mode; add the Google accounts that
   may sign in as test users (up to 100).
3. **Clients → Create client → Web application**, with the authorized redirect URI
   `http://localhost:8080/interaction/google/callback` (the gateway's URL).
4. Put the client id and secret in `.env` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, then restart the service.

The basic scopes (`openid email profile`) need no declaration and no verification by
Google. Before a public launch the button must follow Google's branding guidelines.

## Passwords

Hashed with **argon2id**, OWASP's baseline parameters: 19 MiB of memory, 2 passes,
1 lane ([password-hasher.ts](src/account/password-hasher.ts)).

- **New passwords** ([password-policy.ts](src/account/password-policy.ts)): at least 8
  characters, at most 256, no composition rules (OWASP ASVS 5.0), and not found in a
  data breach. The breach check uses Have I Been Pwned's range API: only the first 5
  characters of the password's SHA-1 leave the service (k-anonymity). It fails open:
  when the API is unreachable, the password is allowed and a warning logged.
- **Checked again at every sign-in.** A password can appear in a breach after it was
  chosen. A correct but breached password doesn't sign in: the page says why, and a
  reset link goes to the inbox (choosing a new password on the spot would let whoever
  has the leaked one take the account). Fails open like registration; bounded by the
  reset email limit.
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

## Email

Emails go through an outbox ([email-outbox.ts](src/email/email-outbox.ts)) rather than
straight to the mail server:

- **Queued in the same transaction** as what they're about (`enqueueEmail(tx, …)`): a
  verification token and its email are saved together or not at all. The request
  doesn't wait for the mail server, so it takes the same time whether an email was
  queued or not, and it works while the mail server is down.
- **Sent by a background loop** every 2 seconds, in every replica. A claim takes a
  10-minute lease in one statement with `FOR UPDATE SKIP LOCKED`, so replicas skip each
  other's rows instead of sending them twice.
- **Retried** after 30 s, 1, 2, 4 and 8 minutes, then dropped with an error in the log.
  A 5xx answer (e.g. no such mailbox) drops it at once.
- **At least once:** a crash between sending and deleting the row sends it again.
- **Deleted once sent or dropped.** Rows hold verification and reset links until then,
  so `identity_reader` can't read the table. Logs carry the row id, never the address.

Locally, [Mailpit](https://mailpit.axllent.org) (`docker compose up -d`) catches every
email: open http://localhost:8025. In production `SMTP_URL` points at Amazon SES
(`smtps://…`), and TLS is required.

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
