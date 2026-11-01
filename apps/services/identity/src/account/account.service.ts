import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './email';
import { PasswordHasher } from './password-hasher';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  /**
   * Checks an email and password; returns the account id, or undefined for any failure.
   * Callers show one message for every failure, so it doesn't reveal which emails
   * have accounts, and unknown emails cost a real hash for the same reason.
   */
  async signIn(email: string, password: string): Promise<string | undefined> {
    const account = await this.prisma.account.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, password: { select: { hash: true } } },
    });
    const check = await this.hasher.verify(account?.password?.hash, password);
    if (!account || !check.ok) {
      // The account id when there is one, never the email (personal data)
      this.logger.log(
        { accountId: account?.id, reason: account ? 'password' : 'account' },
        'Sign-in failed',
      );
      return undefined;
    }
    if (check.needsRehash) {
      // The only moment the plain password is at hand: upgrade the stored hash (WP-20)
      await this.prisma.accountPassword.update({
        where: { accountId: account.id },
        data: { hash: await this.hasher.hash(password) },
      });
      this.logger.log({ accountId: account.id }, 'Password rehashed');
    }
    return account.id;
  }
}
