import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailOutboxSender } from './email-outbox';
import { Mailer, SmtpMailer } from './mailer';

/** Sends what `enqueueEmail()` queued; nothing else talks to the mail server */
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: Mailer,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new SmtpMailer({
          url: config.get('SMTP_URL', { infer: true }),
          from: config.get('MAIL_FROM', { infer: true }),
          requireTls: config.get('NODE_ENV', { infer: true }) === 'production',
        }),
    },
    EmailOutboxSender,
  ],
})
export class EmailModule {}
