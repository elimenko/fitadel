import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { InteractionModule } from '../interaction/interaction.module';
import { OidcModule } from '../oidc/oidc.module';
import { coreModules } from './core';

@Module({
  imports: [...coreModules, HealthModule, OidcModule, InteractionModule],
})
export class AppModule {}
