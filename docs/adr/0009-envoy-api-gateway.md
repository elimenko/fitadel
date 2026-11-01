# ADR-0009: Use Envoy as the API gateway

- **Status:** Accepted
- **Date:** 2026-11-01

## Context

Clients reach each service on its own port: identity on 3010, the catalog on 3000.
Phase 2 needs one entry point in front of them:

- one origin for browsers: identity's sign-in pages now, the web app's
  backend-for-frontend (BFF) in Phase 4, and the APIs
- token checks before traffic reaches a service, as a second layer next to the
  services' own checks (Phase 2 Step 3)
- a traffic ceiling, so floods stop before the services
- the real client IP for services: identity's per-IP rate limits otherwise see the
  proxy

The same component should run locally in Docker and later in Kubernetes (Phase 8), with
its configuration versioned in the repository. It is needed now: Phase 2 Step 4 builds
it, and the issuer URL that every token carries depends on it.

## Considered options

1. **Envoy.**
   - Pros:
     - CNCF graduated, widely used as an edge and service proxy.
     - Verifies JWTs against a remote key set (`jwt_authn`), with token-optional and
       token-required rules side by side per route.
     - Built-in local rate limiting; a global rate-limit service when needed.
     - Envoy Gateway implements the Kubernetes Gateway API for Phase 8.
     - Strong observability: OpenTelemetry tracing, detailed access logs.
   - Cons:
     - Verbose, low-level configuration with a steep learning curve.
     - No admin UI.
2. **NGINX (open source).**
   - Pros: familiar, simple routing, very fast.
   - Cons: JWT validation (`auth_jwt`) is only in the commercial NGINX Plus; otherwise
     custom scripting or a separate auth service.
3. **Traefik or Kong.**
   - Pros: friendlier configuration, route discovery from Docker and Kubernetes; Kong
     has a plugin ecosystem.
   - Cons: validating JWTs against an OpenID Provider's key set needs a plugin, a
     forward-auth service or a commercial edition (Kong's OpenID Connect plugin); Kong
     adds its own data store or declarative layer.
4. **AWS API Gateway (or a load balancer) as the gateway.**
   - Pros: managed; HTTP APIs have JWT authorizers.
   - Cons: cloud-only, so local development differs from production; billed per
     request; routing and auth rules tied to AWS.

## Decision

We will use **Envoy** as the single entry point for all external traffic, because it
verifies identity's tokens against its published key set with per-route rules, limits
traffic, and runs the same way in Docker and in Kubernetes (Envoy Gateway).

- **One origin, split by path.** Identity keeps its paths (`/oidc`, `/interaction`,
  `/verify-email`, `/reset-password`); APIs live under `/api/<service>/`, with the prefix
  stripped (`/api/catalog/v1/foods` reaches the catalog as `/v1/foods`); the web BFF
  (Phase 4) sits behind it too. The issuer becomes the gateway's URL.
- **Default-deny at the edge.** Everything under `/api/` needs a valid access token
  (signature, `iss`, `aud`, `exp`), except an explicit public list, currently the
  catalog's `GET` reads. A token that is sent is always verified. Services keep
  verifying tokens too: two independent layers, each failing closed, and calls between
  services don't pass through the gateway.
- **Rate limiting.** Envoy's local limit is a coarse per-route ceiling. Per-client
  limits stay in the services (identity's per-IP and per-email limits in Postgres)
  until a global rate-limit service with Redis is worth it.
- **Client IPs.** Services trust exactly one proxy hop for `X-Forwarded-For`; the
  gateway replaces any copy a client sends.
- **Locally,** a container in `compose.yaml` routes to the services running on the host
  through `host.docker.internal`.

## Consequences

**Positive**

- One address for browsers and apps; the BFF's session cookie stays first-party.
- A forgotten guard, a wrong `@Public()` or a whole service without the guard is still
  closed at the edge.
- Identity's per-IP limits see real client IPs.
- The route and auth configuration is versioned with the code and carries over to
  Kubernetes.

**Negative**

- A new public endpoint needs `@Public()` in the code and an entry in the gateway's
  list. A missing entry fails closed (401), which surfaces in the endpoint's first test.
- Envoy's configuration is verbose YAML to learn and review.
- Local sign-in goes through the gateway: tokens issued on the services' own ports carry
  a different issuer, and the services refuse them.
- One more component to run locally.

**Follow-ups**

- Phase 2 Step 4: routing, trusted `X-Forwarded-For`, the issuer on the gateway URL,
  `jwt_authn` with the public list, local rate limits.
- A per-service test that every route without `@Public()` refuses requests without a
  token.
- Phase 3: fully private prefixes such as `/api/diary/` need no public entries.
- Phase 8: Envoy Gateway and Gateway API resources replace the static configuration.
