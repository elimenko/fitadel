import { z } from 'zod';

/** Environment variables the service reads. Values arrive as strings and are parsed here. */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** Runtime connection, as the catalog_app role */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Live lookup of barcodes the catalog doesn't have, in the Open Food Facts API */
    OFF_LOOKUP: z.enum(['enabled', 'disabled']).default('enabled'),
    OFF_API_URL: z.url().default('https://world.openfoodfacts.org'),
    /** Open Food Facts asks apps to identify themselves */
    OFF_USER_AGENT: z
      .string()
      .min(1)
      .default('Fitadel/0.1 (+https://github.com/elimenko/fitadel)'),
    /** Give up and answer "not found" rather than keep a scanning user waiting */
    OFF_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
    /**
     * How requests identify their user until Phase 2 brings logins: "none" (everyone is
     * anonymous) or "dev-headers" (trusts X-Dev-User-Id, see DevHeaderAuthGuard)
     */
    AUTH_MODE: z.enum(['none', 'dev-headers']).default('none'),
  })
  // Anyone can send dev headers: refuse to start a production service that trusts them
  .refine(
    (env) =>
      !(env.NODE_ENV === 'production' && env.AUTH_MODE === 'dev-headers'),
    {
      path: ['AUTH_MODE'],
      message:
        'dev-headers lets anyone act as any user; not allowed in production',
    },
  );

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
