import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { FoodModule } from '../food/food.module';
import { HealthModule } from '../health/health.module';
import { ProblemDetailsFilter } from '../http/problem-details.filter';
import { coreModules } from './core';

@Module({
  imports: [...coreModules, HealthModule, FoodModule],
  providers: [
    // Requests (params, query, body) are validated against their zod DTOs
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    // Responses are checked against their zod DTOs, so they can't drift from the docs
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    // Every error leaves as RFC 9457 problem details
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
