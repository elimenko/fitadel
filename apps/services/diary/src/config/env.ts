import { z } from 'zod';
import { eventsEnvShape } from '@fitadel/diary-events';

/** Environment variables the service reads. Values arrive as strings and are parsed here. */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3020),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  /** Runtime connection, as the diary_app role */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Identity's issuer URL: access tokens must carry it as `iss` */
  AUTH_ISSUER: z.url().default('http://localhost:8080/oidc'),
  /** This API's identifier: tokens must carry it as `aud` (identity's OIDC_API_AUDIENCE) */
  AUTH_AUDIENCE: z.url().default('https://api.fitadel.local'),
  /**
   * Where identity publishes its public keys. Defaults to the issuer's /jwks; in a
   * cluster it can be identity's internal address instead of the public one.
   */
  AUTH_JWKS_URI: z.url().optional(),
  /** The catalog's gRPC address (host:port), for copying foods into entries (ADR-0011) */
  CATALOG_GRPC_URL: z
    .string()
    .regex(/^[\w.-]+:\d+$/, 'Use host:port, e.g. localhost:50051')
    .default('localhost:50051'),
  /**
   * Where the catalog's .proto files are. Defaults to the copy next to the bundle;
   * tests point it at libs/catalog/grpc/proto.
   */
  CATALOG_PROTO_DIR: z.string().min(1).optional(),
  /** FoodLogged events through the outbox to Kafka (ADR-0012), and where Kafka is */
  ...eventsEnvShape,
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
