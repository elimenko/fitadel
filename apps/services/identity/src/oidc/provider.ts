import type { LoggerService } from '@nestjs/common';
import type { EventEmitter } from 'node:events';
import Provider, {
  type Account,
  type Configuration,
  type KoaContextWithOIDC,
  errors,
} from 'oidc-provider';
import type { Env } from '../config/env';
import type { PrismaClient } from '../generated/prisma/client';
import { oidcPayloadAdapterFactory } from './oidc-payload-adapter';

/** The scope that grants access to Fitadel's API; first-party clients request it. */
export const API_SCOPE = 'api';

const ACCESS_TOKEN_TTL = 10 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The engine's error events for the endpoints we use (names from its source) */
const ERROR_EVENTS = [
  'authorization.error',
  'grant.error',
  'end_session.error',
  'userinfo.error',
  'revocation.error',
  'introspection.error',
  'discovery.error',
  'jwks.error',
] as const;

export interface ProviderOptions {
  env: Pick<
    Env,
    | 'NODE_ENV'
    | 'OIDC_ISSUER'
    | 'OIDC_API_AUDIENCE'
    | 'OIDC_JWKS'
    | 'OIDC_COOKIE_KEYS'
  >;
  prisma: PrismaClient;
  logger: LoggerService;
}

export function createProvider({
  env,
  prisma,
  logger,
}: ProviderOptions): Provider {
  const development = env.NODE_ENV === 'development';

  const configuration: Configuration = {
    adapter: oidcPayloadAdapterFactory(
      prisma,
      // The argument is the internal detail (logged), not the client's message
      () =>
        new errors.InvalidGrant(
          'already consumed by a concurrent request; grant revoked',
        ),
    ),
    jwks: env.OIDC_JWKS,
    cookies: { keys: env.OIDC_COOKIE_KEYS },

    clients: [
      {
        // Local tools and manual testing: a public client (no secret) on a loopback
        // redirect, whose port may vary per run (RFC 8252)
        client_id: 'fitadel-dev',
        application_type: 'native',
        token_endpoint_auth_method: 'none',
        redirect_uris: ['http://127.0.0.1/'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        id_token_signed_response_alg: 'ES256',
      },
    ],
    // Authorization code flow only: no implicit or hybrid tokens in the redirect
    responseTypes: ['code'],
    // PKCE for every client, confidential ones included (OAuth 2.1)
    pkce: { required: () => true },

    scopes: ['openid', 'offline_access', 'email', 'profile', API_SCOPE],
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name'],
    },
    findAccount: async (_ctx, sub) => {
      // sub comes from our own sessions and tokens, but a malformed one must be "no
      // account", not a database error
      if (!UUID.test(sub)) return undefined;
      const account = await prisma.account.findUnique({ where: { id: sub } });
      if (!account) return undefined;
      return {
        accountId: account.id,
        claims: () => ({
          sub: account.id,
          email: account.email,
          email_verified: account.emailVerifiedAt !== null,
          name: account.displayName ?? undefined,
        }),
      } satisfies Account;
    },
    // Roles go into access tokens, read at issue time: a role change takes effect at
    // the next refresh (docs/architecture/authentication.md)
    extraTokenClaims: async (_ctx, token) => {
      if (token.kind !== 'AccessToken' || !token.accountId) return undefined;
      const roles = await prisma.accountRole.findMany({
        where: { accountId: token.accountId },
        select: { role: true },
      });
      return { roles: roles.map(({ role }) => role) };
    },

    ttl: {
      AccessToken: ACCESS_TOKEN_TTL,
      AuthorizationCode: 60,
      IdToken: 10 * 60,
      Interaction: 60 * 60,
      Session: 14 * 24 * 60 * 60,
      Grant: 14 * 24 * 60 * 60,
      RefreshToken: 14 * 24 * 60 * 60,
    },

    features: {
      // A bare-bones built-in sign-in page (type an account id), until Step 2d builds
      // the real screens. Never outside development.
      devInteractions: { enabled: development },
      // Access tokens are JWTs for our API, verified locally by the gateway and services
      resourceIndicators: {
        enabled: true,
        defaultResource: () => env.OIDC_API_AUDIENCE,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource) => {
          if (resource !== env.OIDC_API_AUDIENCE) {
            throw new errors.InvalidTarget();
          }
          return {
            scope: API_SCOPE,
            audience: env.OIDC_API_AUDIENCE,
            accessTokenFormat: 'jwt',
            accessTokenTTL: ACCESS_TOKEN_TTL,
            jwt: { sign: { alg: 'ES256' } },
          };
        },
      },
    },
  };

  const provider = new Provider(env.OIDC_ISSUER, configuration);

  // Every failure reaches the client as a generic error (e.g. invalid_grant), so the
  // real cause is only here. Log the error and its detail, never the request's
  // parameters: they hold codes, verifiers and tokens.
  // (EventEmitter: the type definitions don't list every event, e.g. authorization.error)
  for (const event of ERROR_EVENTS) {
    (provider as EventEmitter).on(
      event,
      (ctx: KoaContextWithOIDC, error: errors.OIDCProviderError) =>
        logger.warn(
          {
            event,
            error: error.error,
            detail: error.error_detail,
            client: ctx.oidc?.client?.clientId,
          },
          'OpenID Provider request failed',
        ),
    );
  }
  provider.on('server_error', (_ctx: KoaContextWithOIDC, error: Error) =>
    logger.error(error, 'OpenID Provider error'),
  );
  provider.on('grant.revoked', (_ctx: KoaContextWithOIDC, grantId: string) =>
    logger.warn({ grantId }, 'Grant revoked'),
  );

  return provider;
}
