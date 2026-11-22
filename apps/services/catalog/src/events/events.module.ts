import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer } from '@platformatic/kafka';
import type { Env } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { FoodLoggedConsumer } from './food-logged.consumer';

/**
 * The catalog's side of the diary's events (ADR-0012). With EVENTS_ENABLED=false there
 * is no consumer and no Kafka client: counts stop growing, nothing else changes.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: FoodLoggedConsumer,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService) =>
        config.get('EVENTS_ENABLED', { infer: true })
          ? new FoodLoggedConsumer(
              prisma,
              () =>
                new Consumer({
                  clientId: 'catalog',
                  groupId: 'catalog',
                  bootstrapBrokers: config.get('KAFKA_BROKERS', {
                    infer: true,
                  }),
                }),
            )
          : null,
    },
  ],
})
export class EventsModule {}
