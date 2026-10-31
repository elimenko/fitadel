// Must be the first import: see instrumentation.ts
import { shutdownTelemetry } from './instrumentation';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import type { Env } from './config/env';
import { OIDC_PROVIDER } from './oidc/oidc.module';
import type Provider from 'oidc-provider';

async function bootstrap() {
  // Buffer Nest's startup logs until the pino logger is ready
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // The OpenID Provider is a Koa app; Express strips the /oidc prefix before handing
  // requests over, and the issuer URL (OIDC_ISSUER) tells it where it lives.
  app.use('/oidc', app.get<Provider>(OIDC_PROVIDER).callback());

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
  logger.log(`Identity service is running on: http://localhost:${port}`);
}

bootstrap();
