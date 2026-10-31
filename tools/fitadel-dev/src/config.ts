/** The local identity service; override for another environment's issuer. */
export const ISSUER =
  process.env.FITADEL_ISSUER ?? 'http://localhost:3010/oidc';
/** A public client: no secret, PKCE, loopback redirect on any port (RFC 8252) */
export const CLIENT_ID = 'fitadel-dev';
/** offline_access asks for a refresh token; api is the scope for Fitadel's API */
export const SCOPE = 'openid email profile offline_access api';
