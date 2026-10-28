import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import { Logger } from 'nestjs-pino';
import { Pool } from 'pg';
import { coreModules } from '../app/core';
import type { Env } from '../config/env';
import { importOffDump } from './off-import';

@Module({ imports: coreModules })
class ImportModule {}

/**
 * `node dist/main.js import-off <dump.jsonl.gz>`: a one-off admin process (12-factor),
 * run from the same build and configuration as the service.
 */
export async function importOffCommand(args: string[]): Promise<number> {
  const [file] = args;
  // A Nest context without HTTP: just the modules for config and logging
  const app = await NestFactory.createApplicationContext(ImportModule, {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  if (!file) {
    logger.error('Usage: import-off <openfoodfacts-products.jsonl.gz>');
    await app.close();
    return 2;
  }

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const pool = new Pool({
    connectionString: config.get('DATABASE_URL', { infer: true }),
  });
  const started = Date.now();
  try {
    // One trace per run; the import's own spans and its SQL queries nest under it
    const report = await trace
      .getTracer('catalog-import')
      .startActiveSpan('import-off', async (span) => {
        try {
          return await importOffDump(pool, file, {
            onProgress: (read) => logger.log({ read }, 'Import progress'),
          });
        } finally {
          span.end();
        }
      });
    logger.log(
      { ...report, durationMs: Date.now() - started },
      'Import finished',
    );
    return 0;
  } catch (error) {
    logger.error({ err: error }, 'Import failed');
    return 1;
  } finally {
    await pool.end();
    await app.close();
  }
}
