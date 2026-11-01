import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PublicUrl } from '../config/public-url';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountService } from './account.service';
import { PasswordHasher } from './password-hasher';
import { PasswordResetService } from './password-reset.service';
import { PasswordPolicy } from './password-policy';
import { PwnedPasswords } from './pwned-passwords';
import { RegistrationService } from './registration.service';

@Module({
  imports: [PrismaModule],
  providers: [
    AccountService,
    RegistrationService,
    PasswordResetService,
    PasswordHasher,
    {
      provide: PublicUrl,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PublicUrl(config.get('OIDC_ISSUER', { infer: true })),
    },
    {
      provide: PasswordPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new PasswordPolicy(
          config.get('PASSWORD_BREACH_CHECK', { infer: true }) === 'enabled'
            ? new PwnedPasswords({
                baseUrl: config.get('HIBP_API_URL', { infer: true }),
                userAgent: config.get('OUTBOUND_USER_AGENT', { infer: true }),
                timeoutMs: config.get('HIBP_TIMEOUT_MS', { infer: true }),
              })
            : undefined,
        ),
    },
  ],
  exports: [
    AccountService,
    RegistrationService,
    PasswordResetService,
    PasswordPolicy,
  ],
})
export class AccountModule {}
