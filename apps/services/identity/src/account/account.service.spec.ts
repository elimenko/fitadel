import { hash } from '@node-rs/argon2';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';
import { PASSWORD_HASH_OPTIONS, PasswordHasher } from './password-hasher';

const hasher = new PasswordHasher();
const findUnique = jest.fn();
const update = jest.fn();
const create = jest.fn();
const prisma = {
  account: { findUnique, create },
  accountPassword: { update },
} as unknown as PrismaService;
const accounts = new AccountService(prisma, hasher);

beforeEach(() => {
  findUnique.mockReset();
  update.mockReset();
  create.mockReset();
});

describe('AccountService.signIn', () => {
  const withPassword = async (password: string, options = {}) => ({
    id: 'account-1',
    password: {
      hash: await hash(password, { ...PASSWORD_HASH_OPTIONS, ...options }),
    },
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

describe('AccountService.register', () => {
  it('stores the email normalized and the password hashed', async () => {
    create.mockResolvedValue({ id: 'account-1' });

    expect(
      await accounts.register({
        email: ' New@Fitadel.LOCAL',
        password: 'river cat lantern',
        displayName: '',
      }),
    ).toEqual({ accountId: 'account-1' });

    const { data } = create.mock.calls[0][0];
    expect(data.email).toBe('new@fitadel.local');
    expect(data.displayName).toBeNull();
    expect(data.password.create.hash).toMatch(/^\$argon2id\$/);
    expect(data.password.create.hash).not.toContain('river');
  });

  it('reports a taken email from the unique index', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    expect(
      await accounts.register({
        email: 'a@b.c',
        password: 'river cat lantern',
      }),
    ).toEqual({ error: 'email_taken' });
  });
});
