import { createHash } from 'node:crypto';
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ProblemException } from '@fitadel/shared-http';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** How long a key is remembered: retries come within minutes, so a day is generous */
export const KEEP_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/** A database client: the service's own, or a transaction's */
export type Db = Prisma.TransactionClient;

/** A POST that may carry an Idempotency-Key */
export interface Keyed {
  userId: string;
  /** Without a key, the request is simply run */
  key: string | undefined;
  /** What makes the request this request: its route and validated input */
  request: unknown;
}

export interface Answer<T> {
  status: number;
  body: T;
  /** The stored answer of an earlier request with the same key */
  replayed: boolean;
}

/**
 * Runs a POST once per Idempotency-Key: a retry with the key gets the first answer,
 * and nothing is written again. Only successful answers are stored, so a retry after
 * a failure really runs again.
 */
@Injectable()
export class IdempotencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The stored answer for the key; null when the key is new or has expired. Ask before
   * any work, such as a catalog call: a retry needs none of it.
   */
  async replay<T>(keyed: Keyed, now = new Date()): Promise<Answer<T> | null> {
    if (keyed.key === undefined) return null;
    const stored = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId: keyed.userId, key: keyed.key } },
    });
    if (!stored || stored.createdAt < expiry(now)) return null;
    if (stored.fingerprint !== fingerprint(keyed.request)) {
      throw new ProblemException(
        422,
        'This Idempotency-Key was used for a different request',
      );
    }
    return { status: stored.status, body: stored.body as T, replayed: true };
  }

  /**
   * Writes, and stores the answer under the key, in one transaction: both or neither.
   * The key is inserted last. If a request with the same key got there first, this
   * insert waits until that one commits and then fails as a duplicate; the whole
   * transaction, entries included, rolls back, and the first answer is replayed.
   */
  async save<T>(
    keyed: Keyed,
    status: number,
    write: (db: Db) => Promise<T>,
  ): Promise<Answer<T>> {
    const { userId, key } = keyed;
    if (key === undefined) {
      return { status, body: await write(this.prisma), replayed: false };
    }
    // An expired key is a new one: make room for it
    await this.prisma.idempotencyKey.deleteMany({
      where: { userId, key, createdAt: { lt: expiry(new Date()) } },
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const body = await write(tx);
        await tx.idempotencyKey.create({
          data: {
            userId,
            key,
            fingerprint: fingerprint(keyed.request),
            status,
            body: body as Prisma.InputJsonValue,
          },
        });
        return { status, body, replayed: false };
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const first = await this.replay<T>(keyed);
      if (!first) throw error;
      return first;
    }
  }

  onModuleInit() {
    // unref: a pending cleanup never keeps the process alive on shutdown
    this.timer = setInterval(
      () => void this.deleteExpired(),
      CLEANUP_INTERVAL_MS,
    ).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Deletes expired keys; every replica may run it, harmlessly */
  async deleteExpired(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.idempotencyKey.deleteMany({
        where: { createdAt: { lt: expiry(now) } },
      });
      return count;
    } catch (error) {
      this.logger.warn({ err: error }, 'Cleanup of expired keys failed');
      return 0;
    }
  }
}

const expiry = (now: Date) => new Date(now.getTime() - KEEP_MS);

/** Zod output keeps the schema's key order, so the same input hashes the same */
const fingerprint = (request: unknown) =>
  createHash('sha256').update(JSON.stringify(request)).digest('hex');

const isDuplicateKey = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';
