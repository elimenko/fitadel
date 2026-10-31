import { z } from 'zod';

/**
 * A private ES256 signing key (JWK). The provider publishes its public half at
 * /oidc/jwks; `kid` lets verifiers pick the right key while two are published.
 */
const signingKey = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  kid: z.string().min(1),
  x: z.string().min(1),
  y: z.string().min(1),
  d: z.string().min(1, 'must be a private key'),
  alg: z.literal('ES256').default('ES256'),
  use: z.literal('sig').default('sig'),
});

/** Parses a JSON string; the value never appears in the error (it's a secret). */
const json = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.issues.push({ code: 'custom', message: 'not valid JSON', input: '' });
    return z.NEVER;
  }
});

/** Environment variables the service reads. Values arrive as strings and are parsed here. */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  /** Runtime connection, as the identity_app role */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /**
   * Reject passwords found in data breaches (Have I Been Pwned). "disabled" is for
   * offline development; the check fails open when the API is unreachable anyway.
   */
  PASSWORD_BREACH_CHECK: z.enum(['enabled', 'disabled']).default('enabled'),
  HIBP_API_URL: z.url().default('https://api.pwnedpasswords.com'),
  /** Give up and allow the password rather than keep a registering user waiting */
  HIBP_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  /** How the service identifies itself to external APIs */
  OUTBOUND_USER_AGENT: z
    .string()
    .min(1)
    .default('Fitadel/0.1 (+https://github.com/elimenko/fitadel)'),
  /**
   * The provider's public URL, mount path included: the `iss` claim every verifier
   * checks, so it must match exactly what clients see (the gateway's URL behind one)
   */
  OIDC_ISSUER: z.url().default('http://localhost:3010/oidc'),
  /**
   * The audience of access tokens: the API that accepts them. Services reject tokens
   * whose `aud` isn't this.
   */
  OIDC_API_AUDIENCE: z.url().default('https://api.fitadel.local'),
  /**
   * Signing keys as a JWK set. The first key signs; all are published, so a new key is
   * added second, moved first once verifiers have cached it, and the old one removed
   * after its last token expires. Generate with `nx run identity:generate-keys`.
   */
  OIDC_JWKS: json.pipe(
    z.object({
      keys: z
        .array(signingKey)
        .min(1)
        .refine(
          (keys) => new Set(keys.map((key) => key.kid)).size === keys.length,
          'every kid must be unique',
        ),
    }),
  ),
  /**
   * Comma-separated keys that sign the provider's cookies (session, sign-in in
   * progress). The first signs; all verify, so they rotate like OIDC_JWKS.
   */
  OIDC_COOKIE_KEYS: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(z.string().min(32, 'each key needs at least 32 characters'))),
});

export type Env = z.infer<typeof envSchema>;

/** Fails fast: throws one error that lists every invalid variable. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
