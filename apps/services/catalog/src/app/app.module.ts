import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import {
  AccessTokenGuard,
  AccessTokenVerifier,
  remoteKeys,
} from '@fitadel/shared-auth';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { FoodModule } from '../food/food.module';
import { HealthModule } from '../health/health.module';
import { ProblemDetailsFilter } from '../http/problem-details.filter';
import { coreModules } from './core';

@Module({
  imports: [...coreModules, HealthModule, FoodModule],
  providers: [
    // Verifies identity's access tokens locally, with its published keys
    {
      provide: AccessTokenVerifier,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const issuer = config.get('AUTH_ISSUER', { infer: true });
        return new AccessTokenVerifier({
          issuer,
          audience: config.get('AUTH_AUDIENCE', { infer: true }),
          keys: remoteKeys(
            config.get('AUTH_JWKS_URI', { infer: true }) ?? `${issuer}/jwks`,
          ),
        });
      },
    },
    // Establishes the request's viewer; routes need a token unless marked @Public()
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    // Requests (params, query, body) are validated against their zod DTOs
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Responses are checked against their zod DTOs, so they can't drift from the docs
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    // Every error leaves as RFC 9457 problem details
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
