import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { coreModules } from './core';

@Module({
  imports: [...coreModules, HealthModule],
})
export class AppModule {}
