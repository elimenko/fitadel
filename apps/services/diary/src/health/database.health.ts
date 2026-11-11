import { Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Terminus's PrismaHealthIndicator first calls $runCommandRaw, a MongoDB-only method
 * that Prisma 7 SQL clients don't have, so we ping Postgres ourselves.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthIndicatorService,
  ) {}

  /** Up when Postgres answers within a second. */
  isReachable(key = 'database') {
    return this.health
      .check(key)
      .attempt(async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      })
      .withTimeout(1_000);
  }
}
