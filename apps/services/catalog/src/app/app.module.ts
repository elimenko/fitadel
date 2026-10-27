import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from '../config/env';
import { HealthModule } from '../health/health.module';

@Module({
  imports: [
    // Reads process.env only. Locally, Nx loads the project's .env file into it.
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnv,
    }),
    HealthModule,
  ],
})
export class AppModule {}
