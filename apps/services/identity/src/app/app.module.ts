import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { OidcModule } from '../oidc/oidc.module';
import { coreModules } from './core';

@Module({
  imports: [...coreModules, HealthModule, OidcModule],
})
export class AppModule {}
