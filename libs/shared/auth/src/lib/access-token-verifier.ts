import {
  createRemoteJWKSet,
  errors,
  type JWTVerifyGetKey,
  jwtVerify,
} from 'jose';
import type { Viewer } from './viewer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenOptions {
  /** Identity's issuer URL: the `iss` every token must carry */
  issuer: string;
  /** This API's identifier: the `aud` every token must carry */
  audience: string;
  /** Where identity's public keys come from (see `remoteKeys`) */
  keys: JWTVerifyGetKey;
}

/**
 * Identity's public keys, fetched from its JWKS endpoint and cached. A token signed by
 * a key the cache doesn't know makes jose fetch again (at most every 30 s), which is
 * how a rotated-in key is picked up without restarts.
 */
export function remoteKeys(jwksUri: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUri));
}

/** Why a token was refused; `expired` lets clients know a refresh will help */
export type InvalidReason = 'expired' | 'invalid';

export class InvalidAccessToken extends Error {
  constructor(
    readonly reason: InvalidReason,
    /** For logs only: what exactly failed (never the token) */
    readonly detail: string,
  ) {
    super(`Access token ${reason}: ${detail}`);
  }
}

/**
 * Verifies access tokens locally, without asking identity: the signature against
 * identity's public keys, then the claims. Every check matters (WP-18):
 *   - alg only ES256: never "none", never HS256 (where a public key could be misused
 *     as a shared secret)
 *   - iss: issued by our identity service
 *   - aud: issued for this API, not for another one
 *   - typ at+jwt (RFC 9068): an access token, not an ID token from the same issuer
 *   - exp: not expired (a few seconds of tolerance for clock skew)
 */
export class AccessTokenVerifier {
  constructor(private readonly options: AccessTokenOptions) {}

  async verify(token: string): Promise<Viewer> {
    try {
      const { payload } = await jwtVerify(token, this.options.keys, {
        algorithms: ['ES256'],
        issuer: this.options.issuer,
        audience: this.options.audience,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'exp'],
        clockTolerance: 10,
      });
      if (!UUID.test(payload.sub ?? '')) {
        throw new InvalidAccessToken('invalid', 'sub is not an account id');
      }
      const roles = payload.roles ?? [];
      if (!Array.isArray(roles) || !roles.every((r) => typeof r === 'string')) {
        throw new InvalidAccessToken('invalid', 'roles is not a list of names');
      }
      return {
        id: (payload.sub as string).toLowerCase(),
        roles: new Set(roles),
      };
    } catch (error) {
      throw toInvalidToken(error);
    }
  }
}

/**
 * jose's errors, as reasons. Anything that isn't about the token (identity's keys
 * unreachable, a network error) is rethrown as is: the caller answers 503, not 401.
 */
function toInvalidToken(error: unknown): unknown {
  if (error instanceof InvalidAccessToken) return error;
  if (error instanceof errors.JWTExpired) {
    return new InvalidAccessToken('expired', 'exp is in the past');
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    return new InvalidAccessToken('invalid', `${error.claim}: ${error.reason}`);
  }
  if (
    error instanceof errors.JWKSTimeout ||
    error instanceof errors.JWKSInvalid
  ) {
    return error;
  }
  if (error instanceof errors.JOSEError) {
    // Bad signature, unknown key, disallowed alg, malformed token, ...
    return new InvalidAccessToken('invalid', error.code);
  }
  return error;
}
