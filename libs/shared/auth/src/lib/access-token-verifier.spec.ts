import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  SignJWT,
  UnsecuredJWT,
} from 'jose';
import { createHmac } from 'node:crypto';
import {
  AccessTokenVerifier,
  InvalidAccessToken,
} from './access-token-verifier';

const ISSUER = 'http://localhost:3010/oidc';
const AUDIENCE = 'https://api.fitadel.local';
const ACCOUNT = '01A1924D-A9AB-7ADA-B342-9B6B18AAC278';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let identityKey: PrivateKey;
let otherKey: PrivateKey;
let verifier: AccessTokenVerifier;
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  const identity = await generateKeyPair('ES256');
  identityKey = identity.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  publicJwk = { ...(await exportJWK(identity.publicKey)), kid: 'k1' };
  verifier = new AccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    keys: createLocalJWKSet({ keys: [publicJwk] }),
  });
});

/** An access token as identity issues it; each test breaks one thing */
function token(
  overrides: {
    key?: PrivateKey;
    typ?: string;
    claims?: Record<string, unknown>;
    expiresIn?: string | number;
  } = {},
) {
  return new SignJWT({ roles: ['contributor'], ...overrides.claims })
    .setProtectedHeader({
      alg: 'ES256',
      kid: 'k1',
      typ: overrides.typ ?? 'at+jwt',
    })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(ACCOUNT)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? '10m')
    .sign(overrides.key ?? identityKey);
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InvalidAccessToken);
  return error as InvalidAccessToken;
}

describe('AccessTokenVerifier', () => {
  it('turns a valid token into the viewer', async () => {
    const viewer = await verifier.verify(await token());

    expect(viewer.id).toBe(ACCOUNT.toLowerCase());
    expect([...viewer.roles]).toEqual(['contributor']);
  });

  it('refuses a token signed by any other key (WP-22)', async () => {
    const error = await refusal(
      verifier.verify(await token({ key: otherKey })),
    );
    expect(error.reason).toBe('invalid');
    expect(error.detail).toBe('ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
  });

  it('refuses a token for another API or from another issuer', async () => {
    const forOtherApi = new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'at+jwt' })
      .setIssuer(ISSUER)
      .setAudience('https://api.other.example')
      .setSubject(ACCOUNT)
      .setExpirationTime('10m')
      .sign(identityKey);
    expect((await refusal(verifier.verify(await forOtherApi))).detail).toBe(
      'aud: check_failed',
    );

    const fromElsewhere = new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'at+jwt' })
      .setIssuer('https://evil.example')
      .setAudience(AUDIENCE)
      .setSubject(ACCOUNT)
      .setExpirationTime('10m')
      .sign(identityKey);
    expect((await refusal(verifier.verify(await fromElsewhere))).detail).toBe(
      'iss: check_failed',
    );
  });

  it('tells an expired token apart, so clients know to refresh', async () => {
    const expired = await token({
      expiresIn: Math.floor(Date.now() / 1000) - 60,
    });

    expect((await refusal(verifier.verify(expired))).reason).toBe('expired');
  });

  it('refuses an ID token from the same issuer', async () => {
    // Signed by identity, but an ID token says who signed in, not what may be called
    const idToken = await token({ typ: 'JWT' });

    expect((await refusal(verifier.verify(idToken))).detail).toBe(
      'typ: check_failed',
    );
  });

  it('refuses unsigned tokens and the HS256 public-key trick', async () => {
    const unsigned = new UnsecuredJWT({ roles: ['contributor'] })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(ACCOUNT)
      .setExpirationTime('10m')
      .encode();
    expect((await refusal(verifier.verify(unsigned))).reason).toBe('invalid');

    // "Sign" with HMAC, using the public key (which anyone can fetch) as the secret: a
    // verifier that trusted the token's alg header would accept it
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', kid: 'k1', typ: 'at+jwt' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: AUDIENCE,
        sub: ACCOUNT,
        exp: Math.floor(Date.now() / 1000) + 600,
        roles: ['contributor'],
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', JSON.stringify(publicJwk))
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(
      (await refusal(verifier.verify(`${header}.${payload}.${signature}`)))
        .detail,
    ).toBe('ERR_JOSE_ALG_NOT_ALLOWED');
  });

  it('refuses claims that are not what identity issues', async () => {
    const notAnAccount = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1', typ: 'at+jwt' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('admin')
      .setExpirationTime('10m')
      .sign(identityKey);
    expect((await refusal(verifier.verify(notAnAccount))).detail).toBe(
      'sub is not an account id',
    );

    const badRoles = await token({ claims: { roles: 'contributor' } });
    expect((await refusal(verifier.verify(badRoles))).detail).toBe(
      'roles is not a list of names',
    );
  });

  it('rethrows when the keys are unreachable: that is not the token’s fault', async () => {
    const unreachable: JWTVerifyGetKey = () => {
      throw new errors.JWKSTimeout();
    };
    const offline = new AccessTokenVerifier({
      issuer: ISSUER,
      audience: AUDIENCE,
      keys: unreachable,
    });

    await expect(offline.verify(await token())).rejects.toBeInstanceOf(
      errors.JWKSTimeout,
    );
  });
});
