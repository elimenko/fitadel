# ADR-0008: Use oidc-provider for the OpenID Provider

- **Status:** Accepted
- **Date:** 2026-10-30

## Context

Phase 2 replaces the catalog's development headers with real sign-in. Fitadel runs its
own OpenID Provider: the web and Android apps and the backend services trust only
Fitadel's issuer, and Google sign-in is added later as a federated identity behind it.

The provider must implement:

- the authorization code flow with PKCE
- ID tokens
- JWT access tokens (RFC 9068) that the gateway and services verify locally against a
  JWKS endpoint
- refresh token rotation with reuse detection
- signing key rotation and logout

Mistakes in any of these are security holes.

Beyond the protocol, the identity side needs:

- user accounts keyed by issuer and subject, never by email
- a `contributor` role carried as a token claim
- Fitadel's own login screens

The services are NestJS on Node ([ADR-0002](0002-nx-monorepo-with-pnpm-workspaces.md)),
backed by PostgreSQL ([ADR-0005](0005-postgresql-primary-database.md)) through Prisma
([ADR-0007](0007-prisma-database-access.md)). Learning how OAuth 2.0 and OpenID Connect
work inside is an explicit project goal. The identity service is the next thing to be
built, so the choice is needed now.

## Considered options

1. **oidc-provider (panva), embedded in a NestJS `identity` service.**
   - Pros:
     - OpenID Certified, MIT-licensed, actively maintained.
     - Implements the protocol and leaves accounts, storage and the login and consent
       screens to the application.
     - Same runtime and tooling as the other services.
     - Same author as `jose`, which the services will use to verify tokens.
   - Cons:
     - A Koa application mounted inside Nest's Express server.
     - ESM-only.
     - The documentation is mostly a configuration reference.
     - JWT access tokens need the resource indicators feature.
     - The storage adapter and the login screens are ours to get right.
     - Effectively one maintainer.
2. **Ory Hydra with a NestJS login and consent application.**
   - Pros:
     - OpenID Certified and proven in production.
     - A strict split between protocol and identity.
     - Hydra manages keys and token storage.
   - Cons:
     - A second runtime (Go) with its own database and migrations.
     - Its internals stay a black box.
     - Every login is an extra round trip through Hydra's admin API.
3. **Keycloak.**
   - Pros:
     - A complete identity system out of the box: login screens, roles, federation and
       an admin console.
     - Widely used in industry.
   - Cons:
     - We would configure an identity system, not build one.
     - A JVM process needing roughly 0.5–1 GB of memory.
     - Themes are written in FreeMarker.
4. **A provider written by hand on `jose`.**
   - Pros: the most direct learning.
   - Cons:
     - Every protocol edge case is hand-written and untested against the certification
       suite.
     - The highest security risk.

## Decision

We will run Fitadel's OpenID Provider on **oidc-provider 9**, mounted inside a NestJS
`identity` service. It implements a certified protocol engine, leaves accounts, storage
and the login screens to us, and fits the existing Node services.

The choice is deliberately made to learn how a provider works inside. Keycloak would
reach working sign-in sooner, and Hydra separates protocol and identity more strictly in
production.

## Consequences

**Positive**

- One runtime and shared tooling across services: Nx, Jest, Prisma, OpenTelemetry.
- Everything except the protocol engine is our code and can be explained end to end.
- `jose` on both sides: oidc-provider signs with it, and the services verify with it.

**Negative**

- Two HTTP frameworks share one process. Middleware, error handling and tracing must be
  checked across the Koa/Express boundary.
- An ESM-only package in a webpack-bundled Nest application (handled before for
  terminus).
- The storage adapter must make one-time codes and refresh token rotation atomic.
- Login screen security is ours: CSRF, brute-force limits, password hashing.
- A large configuration surface to keep correct across upgrades, and a single-maintainer
  dependency.

**Follow-ups**

- A spike before building on it:
  - mount oidc-provider in Nest;
  - issue JWT access tokens with an audience through resource indicators;
  - confirm the refresh rotation and reuse behaviour.
- Choose the adapter storage (PostgreSQL or Redis).
- Describe the components, clients and flows in `docs/architecture/authentication.md`.
