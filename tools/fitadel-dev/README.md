# fitadel-dev

A command-line client for local development: signs in through the browser and hands out
access tokens for calling Fitadel's API, like `gh auth login` or `gcloud auth login`.

```sh
pnpm nx serve identity                     # the OpenID Provider, on :3010
pnpm nx run fitadel-dev:login              # opens the browser to sign in
pnpm nx run fitadel-dev:whoami             # the access token's claims
curl -H "Authorization: Bearer $(pnpm -s nx run fitadel-dev:token --output-style=static)" …
pnpm nx run fitadel-dev:logout             # deletes the stored tokens
```

## How it works

- **Sign-in** is the authorization code flow for native apps (RFC 8252): a one-off
  server on a random `127.0.0.1` port receives the redirect. Every sign-in uses a fresh
  PKCE verifier, `state` and `nonce`; [openid-client](https://github.com/panva/openid-client)
  checks them and validates the ID token.
- **Tokens** are stored in the user's config directory (`%APPDATA%\fitadel-dev` on
  Windows, `~/.config/fitadel-dev` elsewhere), readable by the user only.
- **`token`** prints the stored access token while it has more than a minute left, and
  refreshes it otherwise. Refresh tokens rotate: every refresh stores the new one,
  because using an old one again revokes the whole sign-in.
- **The `fitadel-dev` client exists only outside production** (identity's
  `NODE_ENV`): it's public and anyone can run it.

`FITADEL_ISSUER` points the tool at another issuer (default
`http://localhost:3010/oidc`).
