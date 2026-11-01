import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PublicUrl } from '../config/public-url';
import { enqueueEmail } from '../email/email-outbox';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './email';
import {
  REGISTRATION_LINK_HOURS,
  alreadyRegisteredEmail,
  verificationEmail,
} from './emails';
import { linkTokenHash, newLinkToken } from './link-token';
import { PasswordHasher } from './password-hasher';

export type ConfirmResult =
  | { status: 'confirmed'; accountId: string }
  | { status: 'invalid' }
  | { status: 'already_registered' };

const LINK_TTL_MS = REGISTRATION_LINK_HOURS * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registration in two steps: the form starts it, the emailed link finishes it. The
 * account is created only by the link, so every account's email is verified.
 */
@Injectable()
export class RegistrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RegistrationService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly urls: PublicUrl,
  ) {}

  /**
   * Queues a verification link, or an "already registered" email for a taken address.
   * Both paths hash the password and write the outbox in one transaction, so the
   * caller (and the response time) can't tell them apart. The caller has checked the
   * password against PasswordPolicy.
   */
  async start(
    input: { email: string; password: string; displayName?: string },
    now = new Date(),
  ): Promise<void> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.hasher.hash(input.password);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.account.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        await enqueueEmail(tx, alreadyRegisteredEmail({ to: email }));
        this.logger.log(
          { accountId: existing.id },
          'Registration attempted for an existing account',
        );
        return;
      }

      const { token, hash } = newLinkToken();
      await tx.pendingRegistration.create({
        data: {
          tokenHash: hash,
          email,
          displayName: input.displayName || null,
          passwordHash,
          expiresAt: new Date(now.getTime() + LINK_TTL_MS),
        },
      });
      await enqueueEmail(
        tx,
        verificationEmail({
          to: email,
          displayName: input.displayName || undefined,
          link: this.urls.link('verify-email', { token }),
        }),
      );
      this.logger.log('Registration started');
    });
  }

  /** Uses the link up and creates the account, verified */
  async confirm(token: string, now = new Date()): Promise<ConfirmResult> {
    const hash = linkTokenHash(token);
    return this.prisma.$transaction(async (tx) => {
      const pending = await tx.pendingRegistration.findUnique({
        where: { tokenHash: hash },
      });
      if (!pending || pending.expiresAt <= now) return { status: 'invalid' };

      // Locks every pending row of this email, always in the same order, before
      // changing anything. Two links for one email confirmed at once deadlocked
      // without it: each held its own row, then waited for the other's (the
      // integration test found it). Now the second waits here for the first.
      await tx.$queryRaw`
        SELECT 1 FROM pending_registration
        WHERE email = ${pending.email}
        ORDER BY token_hash
        FOR UPDATE`;

      // Two clicks at once both found the row; exactly one deletes it (the other
      // waited for the lock above, and finds nothing to delete)
      const { count } = await tx.pendingRegistration.deleteMany({
        where: { tokenHash: hash },
      });
      if (count === 0) return { status: 'invalid' };

      // ON CONFLICT DO NOTHING: two pending registrations of one email (two links)
      // confirmed at once create one account, without an error that would abort the
      // transaction
      const [account] = await tx.account.createManyAndReturn({
        data: [
          {
            email: pending.email,
            displayName: pending.displayName,
            emailVerifiedAt: now,
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });
      // Every other link for this email is moot now
      await tx.pendingRegistration.deleteMany({
        where: { email: pending.email },
      });
      if (!account) return { status: 'already_registered' };

      await tx.accountPassword.create({
        data: { accountId: account.id, hash: pending.passwordHash },
      });
      this.logger.log({ accountId: account.id }, 'Account registered');
      return { status: 'confirmed', accountId: account.id };
    });
  }

  onModuleInit() {
    // unref: a pending cleanup never keeps the process alive on shutdown
    this.timer = setInterval(
      () => void this.deleteExpired(),
      CLEANUP_INTERVAL_MS,
    ).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Every replica may run it, harmlessly */
  async deleteExpired(now = new Date()): Promise<number> {
    try {
      const { count } = await this.prisma.pendingRegistration.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      return count;
    } catch (error) {
      this.logger.warn(
        { err: error },
        'Cleanup of expired registrations failed',
      );
      return 0;
    }
  }
}
