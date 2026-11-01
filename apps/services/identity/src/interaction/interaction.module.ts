import { Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { OidcModule } from '../oidc/oidc.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { InteractionController } from './interaction.controller';
import { ResetPasswordController } from './reset-password.controller';
import { VerifyEmailController } from './verify-email.controller';

@Module({
  imports: [AccountModule, OidcModule, RateLimitModule],
  controllers: [
    InteractionController,
    VerifyEmailController,
    ResetPasswordController,
  ],
})
export class InteractionModule {}
