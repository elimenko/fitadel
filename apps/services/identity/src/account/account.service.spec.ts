import { hash } from '@node-rs/argon2';
import type { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';
import { PASSWORD_HASH_OPTIONS, PasswordHasher } from './password-hasher';

describe('AccountService.signIn', () => {
  const hasher = new PasswordHasher();
  const findUnique = jest.fn();
  const update = jest.fn();
  const prisma = {
    account: { findUnique },
    accountPassword: { update },
  } as unknown as PrismaService;
  const accounts = new AccountService(prisma, hasher);

  const withPassword = async (password: string, options = {}) => ({
    id: 'account-1',
    password: {
      hash: await hash(password, { ...PASSWORD_HASH_OPTIONS, ...options }),
    },
  });

  beforeEach(() => {
    findUnique.mockReset();
    update.mockReset();
  });

  it('returns the account id for the right password', async () => {
    findUnique.mockResolvedValue(await withPassword('correct horse'));

    expect(await accounts.signIn('dev@fitadel.local', 'correct horse')).toBe(
      'account-1',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('looks the email up normalized', async () => {
    findUnique.mockResolvedValue(null);

    await accounts.signIn('  Dev@Fitadel.LOCAL ', 'x');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'dev@fitadel.local' } }),
    );
  });

  it('fails the same way for a wrong password, an unknown email and no password', async () => {
    findUnique.mockResolvedValueOnce(await withPassword('correct horse'));
    expect(await accounts.signIn('a@b.c', 'wrong')).toBeUndefined();

    findUnique.mockResolvedValueOnce(null);
    expect(await accounts.signIn('nobody@b.c', 'wrong')).toBeUndefined();

    // Signs in with Google only (Step 5): an account without a password
    findUnique.mockResolvedValueOnce({ id: 'account-2', password: null });
    expect(await accounts.signIn('google@b.c', 'anything')).toBeUndefined();
  });

  it('upgrades a hash made with outdated parameters (WP-20)', async () => {
    findUnique.mockResolvedValue(
      await withPassword('correct horse', { memoryCost: 4096, timeCost: 1 }),
    );

    expect(await accounts.signIn('a@b.c', 'correct horse')).toBe('account-1');

    expect(update).toHaveBeenCalledWith({
      where: { accountId: 'account-1' },
      data: {
        hash: expect.stringMatching(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/),
      },
    });
  });

  it('never upgrades on a wrong password', async () => {
    findUnique.mockResolvedValue(
      await withPassword('correct horse', { memoryCost: 4096, timeCost: 1 }),
    );

    expect(await accounts.signIn('a@b.c', 'wrong')).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
