import {
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Producer } from '@platformatic/kafka';
import { PrismaService } from '../prisma/prisma.service';

/** How often the relay looks for unsent events while there are none */
export const POLL_MS = 500;
/** The longest wait between attempts while Kafka keeps failing */
const MAX_BACKOFF_MS = 30_000;
/** How long one batch may take to reach Kafka */
export const SEND_DEADLINE_MS = 5_000;
/** Events per Kafka request (and per transaction) */
export const BATCH_SIZE = 100;
/** Sent events are kept this long, to look into, then deleted */
const KEEP_SENT_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

interface OutboxRow {
  id: string;
  topic: string;
  key: string;
  payload: Uint8Array;
}

/**
 * Publishes the outbox to Kafka: at least once, in batches, one food's events in the
 * order they were recorded. Logging never waits for it; while Kafka is down, events
 * wait in the outbox and the relay retries, backing off.
 *
 * A send to a broker that went away may never settle, whatever the client's own
 * timeouts, so every send has a deadline. A send that misses it or fails discards its
 * producer: closing it aborts the send, and the next attempt starts with a new one.
 */
export class OutboxRelay implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();
  private stopped = false;
  private failures = 0;
  private producer?: Producer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly createProducer: () => Producer,
  ) {}

  onApplicationBootstrap() {
    this.schedule(0);
    // unref: a pending cleanup never keeps the process alive on shutdown
    this.cleanupTimer = setInterval(
      () => void this.deleteSent(),
      CLEANUP_INTERVAL_MS,
    ).unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.cleanupTimer);
    // A batch in flight finishes (or fails) first; unsent rows wait for next time
    await this.running;
    await this.producer?.close();
  }

  /**
   * Publishes up to one batch of unsent events, oldest first, and returns how many.
   * The rows stay locked from the claim to the mark: another replica's relay skips
   * them instead of publishing them too. If the process dies after Kafka accepted
   * them but before the commit, they are published again: at least once.
   */
  async publishBatch(): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, topic, key, payload FROM outbox_event
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;

        await this.send(rows);
        await tx.outboxEvent.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { publishedAt: new Date() },
        });
        return rows.length;
      },
      // Kafka gets up to SEND_DEADLINE_MS; the rows stay locked meanwhile
      { maxWait: 2_000, timeout: 10_000 },
    );
  }

  /** Deletes events sent more than a day ago; every replica may run it, harmlessly */
  async deleteSent(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.outboxEvent.deleteMany({
        where: { publishedAt: { lt: new Date(now.getTime() - KEEP_SENT_MS) } },
      });
      return count;
    } catch (error) {
      this.logger.warn({ err: error }, 'Cleanup of sent outbox events failed');
      return 0;
    }
  }

  private async send(rows: OutboxRow[]): Promise<void> {
    const producer = (this.producer ??= this.createProducer());
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Kafka didn't accept the batch within ${SEND_DEADLINE_MS} ms`,
            ),
          ),
        SEND_DEADLINE_MS,
      );
    });
    try {
      await Promise.race([
        producer.send({
          messages: rows.map((row) => ({
            topic: row.topic,
            key: Buffer.from(row.key),
            value: Buffer.from(row.payload),
          })),
        }),
        deadline,
      ]);
    } catch (error) {
      // Aborts a send still in flight, so it can't land later or pile up
      this.producer = undefined;
      await producer.close(true).catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private schedule(delayMs: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, delayMs);
  }

  private async tick() {
    let next = POLL_MS;
    try {
      const sent = await this.publishBatch();
      this.failures = 0;
      // A full batch: there may be more waiting, so go on at once
      if (sent === BATCH_SIZE) next = 0;
    } catch (error) {
      this.failures += 1;
      next = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** this.failures);
      this.logger.warn(
        { err: error, retryInMs: next },
        'Publishing outbox events failed',
      );
    }
    this.schedule(next);
  }
}
