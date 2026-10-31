import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface Limit {
  /** Attempts allowed per window */
  max: number;
  windowMs: number;
}

export type Attempt =
  | { allowed: true; release: () => Promise<void> }
  | { allowed: false; retryAfterSeconds: number };

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * Fixed-window rate limits shared by every replica, counted in Postgres.
 *
 * `attempt()` counts first and decides second, in one atomic statement: of N
 * simultaneous attempts, exactly `max` are allowed, however they interleave. Reading
 * the count and incrementing it afterwards would let a burst through (WP-10).
 */
@Injectable()
export class RateLimiter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimiter.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async attempt(key: string, limit: Limit, now = new Date()): Promise<Attempt> {
    const windowStart = new Date(
      Math.floor(now.getTime() / limit.windowMs) * limit.windowMs,
    );
    const [{ count }] = await this.prisma.$queryRaw<[{ count: number }]>`
      INSERT INTO rate_limit (key, window_start, count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start)
        DO UPDATE SET count = rate_limit.count + 1
      RETURNING count`;

    if (count > limit.max) {
      const retryAfterMs =
        windowStart.getTime() + limit.windowMs - now.getTime();
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }
    return {
      allowed: true,
      // Gives the slot back, for limits that count only failures
      release: async () => {
        await this.prisma.$executeRaw`
          UPDATE rate_limit SET count = count - 1
          WHERE key = ${key} AND window_start = ${windowStart} AND count > 0`;
      },
    };
  }

  onModuleInit() {
    // unref: a pending cleanup never keeps the process alive on shutdown
    this.timer = setInterval(
      () => void this.deleteOld(),
      CLEANUP_INTERVAL_MS,
    ).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Deletes windows older than a day; every replica may run it, harmlessly. */
  async deleteOld(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.rateLimit.deleteMany({
        where: { windowStart: { lt: new Date(now.getTime() - KEEP_MS) } },
      });
      return count;
    } catch (error) {
      this.logger.warn({ err: error }, 'Cleanup of old rate limit rows failed');
      return 0;
    }
  }
}
