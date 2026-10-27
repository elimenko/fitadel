import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { type Env, validateEnv } from '../config/env';
import { HealthModule } from '../health/health.module';

@Module({
  imports: [
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
    HealthModule,
  ],
})
export class AppModule {}
