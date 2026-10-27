import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

/**
 * The database client, connected as the catalog_app role (rows only, no DDL).
 *
 * It connects lazily on the first query, so the service starts even while Postgres is
 * down; /health/ready reports that instead. Bad configuration still fails at startup.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        // Fail fast instead of hanging when Postgres is unreachable
        connectionTimeoutMillis: 5_000,
      }),
    });
  }

  // Runs on SIGTERM (enableShutdownHooks): close pooled connections cleanly
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
