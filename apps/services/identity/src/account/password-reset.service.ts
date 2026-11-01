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
  RESET_LINK_MINUTES,
  noAccountEmail,
  passwordChangedEmail,
  passwordResetEmail,
} from './emails';
import { linkTokenHash, newLinkToken } from './link-token';
import { PasswordHasher } from './password-hasher';

export type ResetResult =
  { status: 'changed'; accountId: string } | { status: 'invalid' };

const LINK_TTL_MS = RESET_LINK_MINUTES * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * "Forgot password": an emailed link proves the inbox, then a new password replaces the
 * old one and every session and refresh token of the account is revoked. A reset is
 * what people do when they think someone else got in, so it has to get them out.
 */
@Injectable()
export class PasswordResetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PasswordResetService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly urls: PublicUrl,
  ) {}

  /**
   * Queues a reset link, or a "no account for this address" email. Both paths run one
   * transaction that queues one email, so the page (and its timing) reveal nothing.
   */
  async request(input: string, now = new Date()): Promise<void> {
    const email = normalizeEmail(input);
    await this.prisma.$transaction(async (tx) => {
      const account = await tx.account.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!account) {
        await enqueueEmail(tx, noAccountEmail({ to: email }));
        this.logger.log('Password reset requested for an unknown address');
        return;
      }

      const { token, hash } = newLinkToken();
      await tx.passwordReset.create({
        data: {
          tokenHash: hash,
          accountId: account.id,
          expiresAt: new Date(now.getTime() + LINK_TTL_MS),
        },
      });
      await enqueueEmail(
        tx,
        passwordResetEmail({
          to: email,
          link: this.urls.link('reset-password', { token }),
        }),
      );
      this.logger.log({ accountId: account.id }, 'Password reset requested');
    });
  }

  /**
   * Whether a link is still usable. Checked before the breach check and the hash, so
   * a bad token costs one query; `reset()` checks again while using it up.
   */
  async isValid(token: string, now = new Date()): Promise<boolean> {
    const reset = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: linkTokenHash(token) },
      select: { expiresAt: true },
    });
    return reset !== null && reset.expiresAt > now;
  }

  /** Uses the link up, replaces the password and signs the account out everywhere */
  async reset(
    token: string,
    password: string,
    now = new Date(),
  ): Promise<ResetResult> {
    const hash = linkTokenHash(token);
    const passwordHash = await this.hasher.hash(password);

    return this.prisma.$transaction(async (tx) => {
      const reset = await tx.passwordReset.findUnique({
        where: { tokenHash: hash },
        select: { accountId: true, expiresAt: true },
      });
      if (!reset || reset.expiresAt <= now) return { status: 'invalid' };
      const { accountId } = reset;

      // One reset per account at a time: two links used at once take turns here
      // instead of each holding its own row and waiting for the other's (the deadlock
      // registration had)
      const [account] = await tx.$queryRaw<[{ email: string }]>`
        SELECT email FROM account WHERE id = ${accountId}::uuid FOR UPDATE`;
      const { count } = await tx.passwordReset.deleteMany({
        where: { tokenHash: hash },
      });
      if (count === 0) return { status: 'invalid' };

      // Upsert: an account that signs in only with Google gets its first password
      await tx.accountPassword.upsert({
        where: { accountId },
        create: { accountId, hash: passwordHash },
        update: { hash: passwordHash },
      });
      // The link proved the inbox
      await tx.account.updateMany({
        where: { id: accountId, emailVerifiedAt: null },
        data: { emailVerifiedAt: now },
      });
      await tx.passwordReset.deleteMany({ where: { accountId } });
      // Signed out everywhere: sessions, grants, and the refresh tokens and codes
      // issued under them. Access tokens already out keep working until they expire
      // (10 minutes): they're checked without asking identity.
      const revoked = await tx.$executeRaw`
        DELETE FROM oidc_payload WHERE payload->>'accountId' = ${accountId}`;
      await enqueueEmail(tx, passwordChangedEmail({ to: account.email }));

      this.logger.log({ accountId, revoked }, 'Password reset');
      return { status: 'changed', accountId };
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
      const { count } = await this.prisma.passwordReset.deleteMany({
        where: { expiresAt: { lte: now } },
      });
      return count;
    } catch (error) {
      this.logger.warn({ err: error }, 'Cleanup of expired resets failed');
      return 0;
    }
  }
}
