import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as client from 'openid-client';
import { CLIENT_ID, ISSUER, SCOPE } from './config';
import type { Credentials } from './credentials';

async function configuration(): Promise<client.Configuration> {
  const issuer = new URL(ISSUER);
  return client.discovery(issuer, CLIENT_ID, undefined, client.None(), {
    // The local issuer is plain http; anything else must be https
    execute:
      issuer.hostname === 'localhost' ? [client.allowInsecureRequests] : [],
  });
}

/**
 * The authorization code flow for a native app (RFC 8252): a one-off server on a random
 * loopback port receives the redirect, the browser does the signing in. A fresh PKCE
 * verifier, state and nonce every time: the server can't detect reuse, so it's on us.
 */
export async function login(): Promise<Credentials> {
  const config = await configuration();
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${port}/`;

  try {
    const callback = new Promise<URL>((resolve) => {
      server.on('request', (req, res) => {
        const url = new URL(req.url ?? '/', redirectUri);
        if (url.pathname !== '/') {
          res.writeHead(404).end();
          return;
        }
        res
          .writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end('fitadel-dev: done, you can close this tab.');
        resolve(url);
      });
    });

    const authUrl = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: SCOPE,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      // offline_access (a refresh token) needs a consent prompt; ours is automatic
      prompt: 'consent',
    });
    console.error(`Opening the browser to sign in:\n${authUrl.href}\n`);
    openBrowser(authUrl.href);

    // Checks state, exchanges the code with the verifier, validates the ID token
    // (iss, aud, nonce, expiry); throws if anything doesn't match
    const tokens = await client.authorizationCodeGrant(config, await callback, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
      idTokenExpected: true,
    });
    return toCredentials(tokens);
  } finally {
    server.close();
  }
}

/**
 * Trades the refresh token for new tokens. Refresh tokens rotate: the response holds a
 * new one and the old one is dead, so the caller must store the result; using the old
 * token again would revoke the whole grant.
 */
export async function refresh(refreshToken: string): Promise<Credentials> {
  return toCredentials(
    await client.refreshTokenGrant(await configuration(), refreshToken),
  );
}

function toCredentials(
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
): Credentials {
  if (!tokens.refresh_token) {
    throw new Error('No refresh token issued (was offline_access granted?)');
  }
  return {
    issuer: ISSUER,
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt:
      Math.floor(Date.now() / 1000) + (tokens.expiresIn() ?? 0),
  };
}

function openBrowser(url: string) {
  // cmd's start takes the first quoted argument as a window title (hence the empty
  // one) and needs & escaped
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}
