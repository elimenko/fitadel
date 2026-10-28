// Must be the first import: see instrumentation.ts
import { shutdownTelemetry } from './instrumentation';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app/app.module';
import type { Env } from './config/env';
import {
  configureHttp,
  createOpenApiDocument,
  serveApiDocs,
} from './http/http-setup';
import { importOffCommand } from './import/import-command';

async function bootstrap() {
  // Buffer Nest's startup logs until the pino logger is ready
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureHttp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  // Interactive API docs for development; not exposed in production
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    serveApiDocs(app);
  }

  // SIGTERM (Kubernetes, docker stop) or SIGINT (Ctrl+C): stop accepting requests,
  // finish in-flight ones and close the database pool, then flush telemetry last,
  // so the shutdown itself is still traced and logged.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      logger.log(`Received ${signal}, shutting down`);
      await app.close();
      await shutdownTelemetry();
      process.exit(0);
    });
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  // Set when Nx waits for this server to be ready
  if (process.env.NX_READY_SIGNAL_SOCKET) {
    try {
      // Function keeps TypeScript and bundlers from rewriting or bundling the import
      const load = new Function('s', 'return import(s)') as (
        s: string,
      ) => Promise<{ emitReadySignal(server: unknown): boolean }>;
      (await load('@nx/js/ready-signal')).emitReadySignal(app.getHttpServer());
    } catch {
      // @nx/js isn't installed
    }
  }
  logger.log(`Catalog service is running on: http://localhost:${port}`);
}

/** Writes the OpenAPI document to a file, without starting the server */
async function openApiCommand([file]: string[]): Promise<number> {
  if (!file) {
    console.error('Usage: openapi <openapi.json>');
    return 2;
  }
  // Quiet, but startup errors (e.g. invalid config) are thrown to the caller, which
  // prints them; by default Nest would log them (silenced here) and exit
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureHttp(app);
  writeFileSync(
    file,
    JSON.stringify(createOpenApiDocument(app), null, 2) + '\n',
  );
  await app.close();
  return 0;
}

// `node main.js` starts the HTTP service; other commands run once and exit
const commands: Record<string, (args: string[]) => Promise<number>> = {
  'import-off': importOffCommand,
  openapi: openApiCommand,
};
const [command, ...args] = process.argv.slice(2);
const run = command && commands[command];
if (run) {
  run(args)
    .then((exitCode) => shutdownTelemetry().then(() => process.exit(exitCode)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
} else {
  bootstrap();
}
