import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { OidcCleanup } from './oidc-cleanup';
import { createProvider } from './provider';

/** Injection token for the oidc-provider instance; main.ts mounts it at /oidc. */
export const OIDC_PROVIDER = Symbol('OIDC_PROVIDER');

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: OIDC_PROVIDER,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService) =>
        createProvider({
          env: {
            OIDC_ISSUER: config.get('OIDC_ISSUER', { infer: true }),
            OIDC_API_AUDIENCE: config.get('OIDC_API_AUDIENCE', { infer: true }),
            OIDC_JWKS: config.get('OIDC_JWKS', { infer: true }),
            OIDC_COOKIE_KEYS: config.get('OIDC_COOKIE_KEYS', { infer: true }),
          },
          prisma,
          logger: new Logger('OpenIdProvider'),
        }),
    },
    OidcCleanup,
  ],
  exports: [OIDC_PROVIDER],
})
export class OidcModule {}
