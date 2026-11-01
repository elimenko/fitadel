# shared-auth

Access tokens for NestJS services: verifies the JWTs the `identity` service issues and
turns them into a `Viewer { id, roles }`
([authentication.md](../../../docs/architecture/authentication.md)).

```ts
// AppModule
providers: [
  {
    provide: AccessTokenVerifier,
    useFactory: () =>
      new AccessTokenVerifier({
        issuer: 'http://localhost:3010/oidc',
        audience: 'https://api.fitadel.local',
        keys: remoteKeys('http://localhost:3010/oidc/jwks'),
      }),
  },
  { provide: APP_GUARD, useClass: AccessTokenGuard },
],

// A controller
@Public() // no token needed (the viewer is null without one)
@Get()
search(@CurrentViewer() viewer: Viewer | null) { … }
```

- **Every route needs a token unless it's `@Public()`**: a route nobody marked is
  closed, not open.
- **Checked locally**, without calling identity: the ES256 signature against identity's
  published keys (cached, refetched for an unknown `kid`), then `iss`, `aud`, `exp` and
  `typ: at+jwt`. An unsigned token, an HS256 one, an ID token or one for another API is
  refused.
- **Answers:** `401` with `WWW-Authenticate: Bearer …` (RFC 6750) for a missing or
  invalid token, with "The access token expired" when a refresh would help; `503` when
  identity's keys can't be fetched.

Run `nx test shared-auth` for the unit tests.
