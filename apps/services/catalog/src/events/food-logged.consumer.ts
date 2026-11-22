import {
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Consumer, Message } from '@platformatic/kafka';
import { z } from 'zod';
import { FOOD_LOGGED_TOPIC, FoodLogged } from '@fitadel/diary-events';
import { PrismaService } from '../prisma/prisma.service';

/** Processed event ids are kept as long as Kafka keeps events (its default, 7 days) */
const KEEP_PROCESSED_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
/** Wait before reconnecting after the consumer failed */
const RESTART_DELAY_MS = 5_000;

export type Outcome = 'counted' | 'duplicate' | 'unknown-food' | 'undecodable';

const uuid = z.uuid();

/**
 * Counts logged foods from the diary's FoodLogged events (ADR-0012), in the consumer
 * group `catalog`. Each event is counted once: delivery is at least once, so its id is
 * recorded in the same transaction as the count, and an id seen before is skipped. The
 * offset is committed only after that transaction: a crash in between redelivers the
 * event, and the id check skips it.
 */
export class FoodLoggedConsumer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(FoodLoggedConsumer.name);
  private consumer?: Consumer;
  private cleanupTimer?: NodeJS.Timeout;
  private stopped = false;
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly createConsumer: () => Consumer,
  ) {}

  onApplicationBootstrap() {
    this.running = this.run();
    // unref: a pending cleanup never keeps the process alive on shutdown
    this.cleanupTimer = setInterval(
      () => void this.deleteProcessed(),
      CLEANUP_INTERVAL_MS,
    ).unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.cleanupTimer);
    // Leaves the group; the event in hand finishes, uncommitted ones come again
    await this.consumer?.close(true).catch(() => undefined);
    await this.running;
  }

  /**
   * Counts one event and says what happened. A message that isn't a FoodLogged, or an
   * event for a food the catalog doesn't have, is skipped with a warning: it can't
   * succeed later, and retrying it would stop the partition behind it.
   */
  async handle(value: Uint8Array | undefined): Promise<Outcome> {
    let event: FoodLogged;
    try {
      event = FoodLogged.decode(value ?? new Uint8Array());
      uuid.parse(event.eventId);
      uuid.parse(event.foodId);
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Skipped a message that is not a FoodLogged',
      );
      return 'undecodable';
    }

    const outcome = await this.prisma.$transaction(
      async (tx): Promise<Outcome> => {
        const first = await tx.$executeRaw`
        INSERT INTO processed_event (event_id) VALUES (${event.eventId}::uuid)
        ON CONFLICT DO NOTHING`;
        if (first === 0) return 'duplicate';
        const counted = await tx.$executeRaw`
        INSERT INTO food_log_count (food_id, count, updated_at)
        SELECT id, 1, now() FROM food WHERE id = ${event.foodId}::uuid
        ON CONFLICT (food_id)
        DO UPDATE SET count = food_log_count.count + 1, updated_at = now()`;
        return counted === 0 ? 'unknown-food' : 'counted';
      },
    );
    if (outcome === 'unknown-food') {
      this.logger.warn(
        { foodId: event.foodId },
        'Skipped FoodLogged for an unknown food',
      );
    }
    return outcome;
  }

  /** Deletes processed ids older than Kafka's retention; replicas may all run it */
  async deleteProcessed(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.processedEvent.deleteMany({
        where: {
          processedAt: { lt: new Date(now.getTime() - KEEP_PROCESSED_MS) },
        },
      });
      return count;
    } catch (error) {
      this.logger.warn({ err: error }, 'Cleanup of processed events failed');
      return 0;
    }
  }

  /** Consumes until the service stops; after a failure, starts over with a new consumer */
  private async run() {
    while (!this.stopped) {
      const consumer = (this.consumer = this.createConsumer());
      try {
        const stream = await consumer.consume({
          topics: [FOOD_LOGGED_TOPIC],
          // From the group's committed offsets; a new group starts at the beginning
          mode: 'committed',
          fallbackMode: 'earliest',
          autocommit: false,
        });
        for await (const message of stream as AsyncIterable<Message>) {
          await this.handle(message.value);
          await message.commit();
        }
      } catch (error) {
        if (this.stopped) return;
        this.logger.warn(
          { err: error, retryInMs: RESTART_DELAY_MS },
          'Consuming FoodLogged failed',
        );
        await consumer.close(true).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, RESTART_DELAY_MS));
      }
    }
  }
}
