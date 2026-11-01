import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { type Env, validateEnv } from '../config/env';
import { SECRET_QUERY_PARAMS, redactUrl } from './secret-query-params';

/**
 * Modules every entry point needs (the HTTP service and the import command): validated
 * configuration and structured logging.
 */
export const coreModules = [
  // Reads process.env only. Locally, Nx loads the project's .env file into it.
  ConfigModule.forRoot({
    isGlobal: true,
    ignoreEnvFile: true,
    validate: validateEnv,
  }),
  // Structured JSON logs, plus one log line per HTTP request
  LoggerModule.forRootAsync({
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>) => ({
      pinoHttp: {
        level: config.get('LOG_LEVEL', { infer: true }),
        // Credentials never reach the logs: anyone who can read them could replay a
        // session cookie or an access token
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[redacted]',
        },
        // Link tokens in the query string, in both places the request log shows it.
        // pino-http hands this a copy of the request's fields, never the request
        // itself; query is replaced, not edited, as it's the live request's object.
        serializers: {
          req: (req: { url?: string; query?: Record<string, unknown> }) => {
            if (req.url) req.url = redactUrl(req.url);
            if (req.query) {
              req.query = Object.fromEntries(
                Object.entries(req.query).map(([name, value]) => [
                  name,
                  SECRET_QUERY_PARAMS.includes(name) ? '[redacted]' : value,
                ]),
              );
            }
            return req;
          },
        },
        autoLogging: {
          ignore: (request) => request.url?.startsWith('/health/') ?? false,
        },
        // Human-readable output for local development; JSON everywhere else
        transport:
          config.get('NODE_ENV', { infer: true }) === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
  }),
];
