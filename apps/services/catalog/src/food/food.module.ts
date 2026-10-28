import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { OffClient } from '../off/off-client';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomFoodService } from './custom-food.service';
import { FoodSearch } from './food-search';
import { FoodController } from './food.controller';
import { FoodService } from './food.service';
import { OffLookupService } from './off-lookup.service';
import { PostgresFoodSearch } from './postgres-food-search';

@Module({
  imports: [PrismaModule],
  controllers: [FoodController],
  providers: [
    FoodService,
    CustomFoodService,
    OffLookupService,
    // The search implementation: swap here for a search engine (ADR-0006)
    { provide: FoodSearch, useClass: PostgresFoodSearch },
    {
      provide: OffClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new OffClient({
          baseUrl: config.get('OFF_API_URL', { infer: true }),
          userAgent: config.get('OFF_USER_AGENT', { infer: true }),
          timeoutMs: config.get('OFF_TIMEOUT_MS', { infer: true }),
        }),
    },
  ],
})
export class FoodModule {}
