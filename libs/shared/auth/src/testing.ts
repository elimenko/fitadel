import type { INestApplication } from '@nestjs/common';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createServer, type Server } from 'node:http';

/**
 * Test helpers, imported from '@fitadel/shared-auth/testing'. Not for production code.
 */

/**
 * Calls every route of a listening app without a token and returns the ones that don't
 * answer 401, e.g. ['GET /health/live']. A service's integration test compares them with
 * its routes marked @Public(), so a new endpoint is covered without listing it.
 */
export async function routesOpenWithoutToken(
  app: INestApplication,
): Promise<string[]> {
  const routes = registeredRoutes(app);
  if (routes.length === 0) throw new Error('The app has no routes');
  const open: string[] = [];
  for (const { method, path } of routes) {
    // Guards run before validation, so any value reaches the token check
    const url = path.replace(/:\w+/g, '0');
    const response = await fetch(`${await app.getUrl()}${url}`, { method });
    if (response.status !== 401) open.push(`${method} ${path}`);
  }
  return open.sort();
}

/** Every route Nest registered with Express */
function registeredRoutes(app: INestApplication) {
  const express = app.getHttpAdapter().getInstance() as {
    router: {
      stack: { route?: { path: string; methods: Record<string, boolean> } }[];
    };
  };
  return express.router.stack.flatMap(({ route }) =>
    // Wildcard paths are middleware (request logging) mounted for every method
    route && !route.path.includes('*')
      ? Object.keys(route.methods).map((method) => ({
          method: method.toUpperCase(),
          path: route.path,
        }))
      : [],
  );
}

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

/**
 * Plays identity's key endpoint for a service under test: the service fetches the public
 * half of a key made here (point AUTH_JWKS_URI at jwksUri), and tests sign access tokens
 * with the private half, as identity does.
 */
export class FakeIdentity {
  readonly issuer = 'http://identity.test/oidc';
  readonly audience = 'https://api.fitadel.local';

  private constructor(
    private readonly keys: KeyPair,
    private readonly server: Server,
    readonly jwksUri: string,
  ) {}

  static async start(): Promise<FakeIdentity> {
    const keys = await generateKeyPair('ES256');
    const jwk = await exportJWK(keys.publicKey);
    const server = createServer((_request, response) => {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ keys: [{ ...jwk, kid: 'test', alg: 'ES256' }] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as { port: number };
    return new FakeIdentity(keys, server, `http://127.0.0.1:${port}/jwks`);
  }

  /** An access token like identity's; options break one thing at a time */
  token(
    user: string,
    options: {
      roles?: string[];
      key?: KeyPair['privateKey'];
      audience?: string;
      expiresAt?: number;
    } = {},
  ): Promise<string> {
    return new SignJWT({ roles: options.roles ?? [] })
      .setProtectedHeader({ alg: 'ES256', kid: 'test', typ: 'at+jwt' })
      .setIssuer(this.issuer)
      .setAudience(options.audience ?? this.audience)
      .setSubject(user)
      .setIssuedAt()
      .setExpirationTime(options.expiresAt ?? '10m')
      .sign(options.key ?? this.keys.privateKey);
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server.close(resolve));
  }
}
