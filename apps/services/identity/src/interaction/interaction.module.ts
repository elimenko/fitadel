import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { FederationModule } from '../federation/federation.module';
import { OidcModule } from '../oidc/oidc.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { GoogleController } from './google.controller';
import { InteractionController } from './interaction.controller';
import { ResetPasswordController } from './reset-password.controller';
import { VerifyEmailController } from './verify-email.controller';

@Module({
  imports: [AccountModule, FederationModule, OidcModule, RateLimitModule],
  controllers: [
    InteractionController,
    GoogleController,
    VerifyEmailController,
    ResetPasswordController,
  ],
})
export class InteractionModule {}
