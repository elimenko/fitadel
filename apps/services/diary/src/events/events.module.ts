import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProduceAcks, Producer } from '@platformatic/kafka';
import type { Env } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { DiaryEvents, NoEvents, OutboxEvents } from './diary-events';
import { OutboxRelay } from './outbox-relay';

/**
 * The diary's events (ADR-0012). With EVENTS_ENABLED=false, DiaryEvents records
 * nothing and there is no relay and no Kafka client: the service needs no Kafka.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: DiaryEvents,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('EVENTS_ENABLED', { infer: true })
          ? new OutboxEvents()
          : new NoEvents(),
    },
    {
      provide: OutboxRelay,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService<Env, true>, prisma: PrismaService) =>
        config.get('EVENTS_ENABLED', { infer: true })
          ? new OutboxRelay(
              prisma,
              () =>
                new Producer({
                  clientId: 'diary',
                  bootstrapBrokers: config.get('KAFKA_BROKERS', {
                    infer: true,
                  }),
                  // Kafka drops the producer's own retries as duplicates; needs all acks
                  idempotent: true,
                  acks: ProduceAcks.ALL,
                  // The relay retries, backing off, with a new producer
                  retries: 0,
                }),
            )
          : null,
    },
  ],
  exports: [DiaryEvents],
})
export class EventsModule {}
