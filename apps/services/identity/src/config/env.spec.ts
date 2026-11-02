import { generateKeyPairSync } from 'node:crypto';
import { validateEnv } from './env';

const DATABASE_URL = 'postgresql://identity_app:secret@localhost:5432/identity';

function privateJwk(kid: string) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { ...privateKey.export({ format: 'jwk' }), kid };
}

const key = privateJwk('key-1');
const OIDC_COOKIE_KEYS = 'a'.repeat(32);
const valid = {
  DATABASE_URL,
  OIDC_JWKS: JSON.stringify({ keys: [key] }),
  OIDC_COOKIE_KEYS,
};

describe('validateEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    expect(validateEnv(valid)).toEqual({
      NODE_ENV: 'development',
      PORT: 3010,
      LOG_LEVEL: 'info',
      DATABASE_URL,
      PASSWORD_BREACH_CHECK: 'enabled',
      HIBP_API_URL: 'https://api.pwnedpasswords.com',
      HIBP_TIMEOUT_MS: 2000,
      OUTBOUND_USER_AGENT: 'Fitadel/0.1 (+https://github.com/elimenko/fitadel)',
      SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'Fitadel <no-reply@fitadel.local>',
      OIDC_ISSUER: 'http://localhost:8080/oidc',
      TRUST_PROXY_HOPS: 0,
      OIDC_API_AUDIENCE: 'https://api.fitadel.local',
      OIDC_JWKS: { keys: [{ ...key, alg: 'ES256', use: 'sig' }] },
      OIDC_COOKIE_KEYS: [OIDC_COOKIE_KEYS],
    });
  });

  it('requires a Postgres DATABASE_URL', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: undefined })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      validateEnv({ ...valid, DATABASE_URL: 'http://localhost/identity' }),
    ).toThrow(/DATABASE_URL/);
  });

  it('requires an SMTP SMTP_URL', () => {
    expect(() =>
      validateEnv({ ...valid, SMTP_URL: 'http://localhost:1025' }),
    ).toThrow(/SMTP_URL/);
    expect(
      validateEnv({ ...valid, SMTP_URL: 'smtps://user:pass@mail:465' })
        .SMTP_URL,
    ).toBe('smtps://user:pass@mail:465');
  });

  it('requires signing and cookie keys', () => {
    expect(() =>
      validateEnv({ DATABASE_URL, OIDC_COOKIE_KEYS: valid.OIDC_COOKIE_KEYS }),
    ).toThrow(/OIDC_JWKS/);
    expect(() => validateEnv({ ...valid, OIDC_COOKIE_KEYS: 'short' })).toThrow(
      /OIDC_COOKIE_KEYS/,
    );
  });

  it('rejects a public key, which cannot sign', () => {
    const publicKey = { ...key, d: undefined };
    expect(() =>
      validateEnv({
        ...valid,
        OIDC_JWKS: JSON.stringify({ keys: [publicKey] }),
      }),
    ).toThrow(/OIDC_JWKS/);
  });

  it('rejects duplicate kids', () => {
    const twin = { ...privateJwk('key-1') };
    expect(() =>
      validateEnv({
        ...valid,
        OIDC_JWKS: JSON.stringify({ keys: [key, twin] }),
      }),
    ).toThrow(/unique/);
  });

  it('never repeats a malformed secret in the error', () => {
    const secret = '{"keys": [ this is not json but secret-ish';
    expect(() => validateEnv({ ...valid, OIDC_JWKS: secret })).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('secret-ish'),
      }),
    );
  });
});
