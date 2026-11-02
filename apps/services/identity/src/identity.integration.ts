/**
 * Integration tests against a real, throwaway Postgres (Testcontainers).
 * Each run provisions the database with tools/db and applies the migrations, exactly
 * as a fresh environment would. Run with `nx run identity:integration` (needs Docker).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client } from 'pg';
import { AccountService } from './account/account.service';
import { PasswordHasher } from './account/password-hasher';
import { PasswordResetService } from './account/password-reset.service';
import { RegistrationService } from './account/registration.service';
import { PublicUrl } from './config/public-url';
import { EmailOutboxSender, enqueueEmail } from './email/email-outbox';
import {
  FEDERATION_TTL_MS,
  FederationService,
} from './federation/federation.service';
import { GoogleClient } from './federation/google-client';
import { type EmailMessage, Mailer } from './email/mailer';
import { PrismaClient } from './generated/prisma/client';
import type { PrismaService } from './prisma/prisma.service';
import { RateLimiter } from './rate-limit/rate-limiter';
import {
  deleteExpiredOidcPayloads,
  oidcPayloadAdapterFactory,
} from './oidc/oidc-payload-adapter';

const workspaceRoot = join(__dirname, '../../../..');
const projectRoot = join(__dirname, '..');

/** The same pinned image as local development (compose.yaml is the single source). */
function postgresImage(): string {
  const compose = readFileSync(join(workspaceRoot, 'compose.yaml'), 'utf8');
  const image = /image:\s*(postgres:\S+)/.exec(compose)?.[1];
  if (!image) throw new Error('No postgres image found in compose.yaml');
  return image;
}

const passwords = {
  migrator: randomBytes(16).toString('hex'),
  app: randomBytes(16).toString('hex'),
  reader: randomBytes(16).toString('hex'),
};

let container: StartedPostgreSqlContainer;
let urls: { migrator: string; app: string; reader: string };

/** Runs the Prisma CLI as identity_migrator; throws on a non-zero exit code. */
function prisma(...args: string[]): string {
  return execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), ...args],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: urls.migrator,
        CHECKPOINT_DISABLE: '1',
      },
      encoding: 'utf8',
    },
  );
}

/** Runs one query as the given role and closes the connection. */
async function queryAs(url: string, sql: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage())
    .withEnvironment({
      IDENTITY_MIGRATOR_PASSWORD: passwords.migrator,
      IDENTITY_APP_PASSWORD: passwords.app,
      IDENTITY_READER_PASSWORD: passwords.reader,
    })
    // An empty volume runs these on first start, like a fresh local or cloud setup
    .withCopyFilesToContainer(
      ['identity.sh', 'identity.psql'].map((file) => ({
        source: join(workspaceRoot, 'tools/db', file),
        target: `/docker-entrypoint-initdb.d/${file}`,
      })),
    )
    .start();

  const server = `${container.getHost()}:${container.getPort()}`;
  urls = {
    migrator: `postgresql://identity_migrator:${passwords.migrator}@${server}/identity`,
    app: `postgresql://identity_app:${passwords.app}@${server}/identity`,
    reader: `postgresql://identity_reader:${passwords.reader}@${server}/identity`,
  };
  prisma('migrate', 'deploy');
});

afterAll(async () => {
  await container?.stop();
});

describe('database', () => {
  it('matches schema.prisma after migrating (no drift)', () => {
    // --exit-code: 0 = no difference, 2 = drift (execFileSync throws)
    expect(() =>
      prisma(
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ),
    ).not.toThrow();
  });

  it('denies schema changes to the runtime role', async () => {
    await expect(queryAs(urls.app, 'DROP TABLE account')).rejects.toThrow(
      /must be owner/,
    );
  });

  it('shows the reader only the tables granted to it', async () => {
    await expect(
      queryAs(urls.reader, 'SELECT count(*) FROM account'),
    ).resolves.toBeDefined();
    for (const secret of [
      'account_password',
      'oidc_payload',
      'rate_limit',
      'email_outbox',
      'pending_registration',
      'password_reset',
    ]) {
      await expect(
        queryAs(urls.reader, `SELECT count(*) FROM ${secret}`),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('oidc-provider storage', () => {
  class AlreadyConsumed extends Error {}

  let db: PrismaClient;
  const adapterFor = (model: string) =>
    oidcPayloadAdapterFactory(db, () => new AlreadyConsumed())(model);
  const token = () => randomBytes(32).toString('base64url');

  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('stores only the SHA-256 of ids, never the ids themselves', async () => {
    const id = token();
    await adapterFor('RefreshToken').upsert(
      id,
      { accountId: 'a', grantId: 'g' },
      60,
    );

    const { rows } = await queryAs(
      urls.app,
      "SELECT id, payload::text FROM oidc_payload WHERE model = 'RefreshToken'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toEqual(createHash('sha256').update(id).digest());
    expect(rows[0].payload).not.toContain(id);
    expect(await adapterFor('RefreshToken').find(id)).toEqual({
      accountId: 'a',
      grantId: 'g',
    });
  });

  it('keeps models apart and finds sessions by uid', async () => {
    const id = token();
    await adapterFor('Session').upsert(
      id,
      { uid: 'uid-1', accountId: 'a' },
      60,
    );

    expect(await adapterFor('Interaction').find(id)).toBeUndefined();
    expect(await adapterFor('Session').findByUid('uid-1')).toMatchObject({
      accountId: 'a',
    });
  });

  it('treats expired rows as missing and deletes them in the cleanup', async () => {
    const expired = token();
    const live = token();
    const code = adapterFor('AuthorizationCode');
    await code.upsert(expired, { grantId: 'g-expired' }, 60);
    await code.upsert(live, { grantId: 'g-live' }, 60);
    await db.oidcPayload.updateMany({
      where: { grantId: 'g-expired' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(await code.find(expired)).toBeUndefined();
    expect(await deleteExpiredOidcPayloads(db)).toBe(1);
    expect(await code.find(live)).toBeDefined();
  });

  it('reports consumption through the payload', async () => {
    const id = token();
    const code = adapterFor('AuthorizationCode');
    await code.upsert(id, { grantId: 'g-once' }, 60);

    await code.consume(id);

    expect((await code.find(id))?.consumed).toEqual(expect.any(Number));
  });

  it('lets exactly one of two concurrent consumes win, and revokes the grant', async () => {
    const grantId = 'g-race';
    const code = token();
    const refresh = token();
    await adapterFor('Grant').upsert(grantId, { accountId: 'a' }, 60);
    await adapterFor('AuthorizationCode').upsert(code, { grantId }, 60);
    await adapterFor('RefreshToken').upsert(refresh, { grantId }, 60);

    // Two token requests with the same code, both past the engine's `consumed` check
    const results = await Promise.allSettled([
      adapterFor('AuthorizationCode').consume(code),
      adapterFor('AuthorizationCode').consume(code),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const loser = results.find((r) => r.status === 'rejected');
    expect(loser?.reason).toBeInstanceOf(AlreadyConsumed);
    // The winner's tokens die with the grant, like on a sequential reuse
    expect(await adapterFor('Grant').find(grantId)).toBeUndefined();
    expect(await adapterFor('RefreshToken').find(refresh)).toBeUndefined();
  });

  it('revokes one model of a grant at a time, as the engine asks', async () => {
    const code = token();
    const refresh = token();
    await adapterFor('AuthorizationCode').upsert(code, { grantId: 'g-r' }, 60);
    await adapterFor('RefreshToken').upsert(refresh, { grantId: 'g-r' }, 60);

    await adapterFor('RefreshToken').revokeByGrantId('g-r');

    expect(await adapterFor('RefreshToken').find(refresh)).toBeUndefined();
    expect(await adapterFor('AuthorizationCode').find(code)).toBeDefined();
  });
});

describe('registration', () => {
  let db: PrismaClient;
  let accounts: AccountService;
  let registrations: RegistrationService;
  const password = 'river cat lantern';

  /** The token from the newest email to this address, as the user would click it */
  async function linkTokenFor(email: string): Promise<string> {
    const { textBody } = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: email },
      orderBy: { createdAt: 'desc' },
    });
    const token = /verify-email#token=([\w-]+)/.exec(textBody)?.[1];
    if (!token) throw new Error(`No link in the email to ${email}`);
    return token;
  }

  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
    const prismaService = db as unknown as PrismaService;
    const hasher = new PasswordHasher();
    accounts = new AccountService(prismaService, hasher);
    registrations = new RegistrationService(
      prismaService,
      hasher,
      new PublicUrl('http://localhost:3010/oidc'),
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates the account only when the link is confirmed, verified', async () => {
    await registrations.start({
      email: ' New@Fitadel.LOCAL',
      password,
      displayName: 'New User',
    });
    expect(
      await db.account.count({ where: { email: 'new@fitadel.local' } }),
    ).toBe(0);
    const pending = await queryAs(
      urls.app,
      "SELECT token_hash, password_hash FROM pending_registration WHERE email = 'new@fitadel.local'",
    );
    const token = await linkTokenFor('new@fitadel.local');
    // Only hashes are stored: the token's and the password's
    expect(pending.rows[0].token_hash).toEqual(
      createHash('sha256').update(token).digest(),
    );
    expect(pending.rows[0].password_hash).toMatch(/^\$argon2id\$/);

    const result = await registrations.confirm(token);

    expect(result).toEqual({
      status: 'confirmed',
      accountId: expect.any(String),
    });
    const account = await db.account.findUniqueOrThrow({
      where: { email: 'new@fitadel.local' },
    });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(account.displayName).toBe('New User');
    expect(await accounts.signIn('NEW@fitadel.local', password)).toBe(
      account.id,
    );
    // The link works once
    expect(await registrations.confirm(token)).toEqual({ status: 'invalid' });
  });

  it('sends a taken address the other email and starts nothing', async () => {
    await registrations.start({ email: 'new@fitadel.local', password });

    const email = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: 'new@fitadel.local' },
      orderBy: { createdAt: 'desc' },
    });
    expect(email.subject).toBe('You already have a Fitadel account');
    expect(email.textBody).not.toContain('token=');
    expect(
      await db.pendingRegistration.count({
        where: { email: 'new@fitadel.local' },
      }),
    ).toBe(0);
  });

  it('refuses an expired link, and the cleanup deletes it', async () => {
    const dayAndAHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await registrations.start(
      { email: 'late@fitadel.local', password },
      dayAndAHourAgo,
    );
    const token = await linkTokenFor('late@fitadel.local');

    expect(await registrations.confirm(token)).toEqual({ status: 'invalid' });
    expect(await registrations.deleteExpired()).toBeGreaterThan(0);
    expect(
      await db.pendingRegistration.count({
        where: { email: 'late@fitadel.local' },
      }),
    ).toBe(0);
  });

  it('uses a link once when it is confirmed twice at once', async () => {
    await registrations.start({ email: 'double@fitadel.local', password });
    const token = await linkTokenFor('double@fitadel.local');

    const results = await Promise.all([
      registrations.confirm(token),
      registrations.confirm(token),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'confirmed',
      'invalid',
    ]);
    expect(
      await db.account.count({ where: { email: 'double@fitadel.local' } }),
    ).toBe(1);
  });

  it('creates one account when two links for one email are confirmed at once', async () => {
    await registrations.start({ email: 'twin@fitadel.local', password });
    const first = await linkTokenFor('twin@fitadel.local');
    await registrations.start({ email: 'twin@fitadel.local', password });
    const second = await linkTokenFor('twin@fitadel.local');
    expect(second).not.toBe(first);

    const results = await Promise.all([
      registrations.confirm(first),
      registrations.confirm(second),
    ]);

    // The loser finds the account taken, or its link already deleted by the winner
    expect(results.filter((r) => r.status === 'confirmed')).toHaveLength(1);
    expect(
      await db.account.count({ where: { email: 'twin@fitadel.local' } }),
    ).toBe(1);
    expect(
      await db.pendingRegistration.count({
        where: { email: 'twin@fitadel.local' },
      }),
    ).toBe(0);
  });
});

describe('password reset', () => {
  let db: PrismaClient;
  let accounts: AccountService;
  let resets: PasswordResetService;
  const hasher = new PasswordHasher();
  const oldPassword = 'old river cat';
  const newPassword = 'new lantern moss';

  async function createAccount(email: string, verified = true) {
    return db.account.create({
      data: {
        email,
        emailVerifiedAt: verified ? new Date() : null,
        password: { create: { hash: await hasher.hash(oldPassword) } },
      },
    });
  }

  async function resetTokenFor(email: string): Promise<string> {
    const { textBody } = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: email, subject: 'Reset your Fitadel password' },
      orderBy: { createdAt: 'desc' },
    });
    const token = /reset-password#token=([\w-]+)/.exec(textBody)?.[1];
    if (!token) throw new Error(`No link in the email to ${email}`);
    return token;
  }

  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
    const prismaService = db as unknown as PrismaService;
    accounts = new AccountService(prismaService, hasher);
    resets = new PasswordResetService(
      prismaService,
      hasher,
      new PublicUrl('http://localhost:3010/oidc'),
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('replaces the password, verifies the email and signs out everywhere', async () => {
    const account = await createAccount('reset@fitadel.local', false);
    const other = await createAccount('bystander@fitadel.local');
    const adapter = (model: string) =>
      oidcPayloadAdapterFactory(db, () => new Error('consumed'))(model);
    const id = () => randomBytes(32).toString('base64url');
    // What a signed-in browser and an app holding a refresh token leave behind
    await adapter('Session').upsert(
      id(),
      { uid: id(), accountId: account.id },
      60,
    );
    await adapter('Grant').upsert(id(), { accountId: account.id }, 60);
    await adapter('RefreshToken').upsert(
      id(),
      { accountId: account.id, grantId: 'g-reset' },
      60,
    );
    await adapter('Session').upsert(
      id(),
      { uid: id(), accountId: other.id },
      60,
    );

    await resets.request(' Reset@Fitadel.LOCAL');
    const token = await resetTokenFor('reset@fitadel.local');
    expect(await resets.isValid(token)).toBe(true);
    // Only the hash is stored
    const stored = await db.passwordReset.findFirstOrThrow({
      where: { accountId: account.id },
    });
    expect(Buffer.from(stored.tokenHash)).toEqual(
      createHash('sha256').update(token).digest(),
    );

    expect(await resets.reset(token, newPassword)).toEqual({
      status: 'changed',
      accountId: account.id,
    });

    expect(
      await accounts.signIn('reset@fitadel.local', oldPassword),
    ).toBeUndefined();
    expect(await accounts.signIn('reset@fitadel.local', newPassword)).toBe(
      account.id,
    );
    expect(
      (await db.account.findUniqueOrThrow({ where: { id: account.id } }))
        .emailVerifiedAt,
    ).not.toBeNull();
    const { rows } = await queryAs(
      urls.app,
      `SELECT payload->>'accountId' AS account FROM oidc_payload
       WHERE payload->>'accountId' IN ('${account.id}', '${other.id}')`,
    );
    expect(rows).toEqual([{ account: other.id }]);
    expect(
      await db.emailOutbox.count({
        where: {
          recipient: 'reset@fitadel.local',
          subject: 'Your Fitadel password was changed',
        },
      }),
    ).toBe(1);
    // The link works once
    expect(await resets.isValid(token)).toBe(false);
    expect(await resets.reset(token, 'third lantern moss')).toEqual({
      status: 'invalid',
    });
  });

  it('sends an unknown address the other email and stores no token', async () => {
    await resets.request('nobody-here@fitadel.local');

    const email = await db.emailOutbox.findFirstOrThrow({
      where: { recipient: 'nobody-here@fitadel.local' },
    });
    expect(email.subject).toBe('No Fitadel account for this address');
    expect(email.textBody).not.toContain('token=');
  });

  it('refuses a link after 30 minutes, and the cleanup deletes it', async () => {
    await createAccount('slow@fitadel.local');
    await resets.request(
      'slow@fitadel.local',
      new Date(Date.now() - 31 * 60 * 1000),
    );
    const token = await resetTokenFor('slow@fitadel.local');

    expect(await resets.isValid(token)).toBe(false);
    expect(await resets.reset(token, newPassword)).toEqual({
      status: 'invalid',
    });
    expect(await resets.deleteExpired()).toBeGreaterThan(0);
    expect(
      await accounts.signIn('slow@fitadel.local', oldPassword),
    ).toBeDefined();
  });

  it('lets one of two links of an account win when both are used at once', async () => {
    const account = await createAccount('two-links@fitadel.local');
    await resets.request('two-links@fitadel.local');
    const first = await resetTokenFor('two-links@fitadel.local');
    await resets.request('two-links@fitadel.local');
    const second = await resetTokenFor('two-links@fitadel.local');

    const results = await Promise.all([
      resets.reset(first, newPassword),
      resets.reset(second, 'other lantern moss'),
    ]);

    // One wins; the other finds its link deleted. (Each hashes its password first, so
    // they rarely overlap here; the next test pins down the lock that makes it safe.)
    expect(results.map((r) => r.status).sort()).toEqual(['changed', 'invalid']);
    expect(
      await db.passwordReset.count({ where: { accountId: account.id } }),
    ).toBe(0);
  });

  it('waits for a concurrent reset of the account before touching anything', async () => {
    const account = await createAccount('locked@fitadel.local');
    await resets.request('locked@fitadel.local');
    const token = await resetTokenFor('locked@fitadel.local');
    // Another reset of this account, caught after taking the account lock
    const other = new Client({ connectionString: urls.app });
    await other.connect();
    await other.query('BEGIN');
    await other.query('SELECT 1 FROM account WHERE id = $1 FOR UPDATE', [
      account.id,
    ]);

    const resetting = resets.reset(token, newPassword);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Still waiting: its link and the old password are untouched. Without the lock it
    // would go ahead, and two resets of one account could deadlock (each holding its
    // own link's row, then waiting for the other's)
    expect(
      await db.passwordReset.count({ where: { accountId: account.id } }),
    ).toBe(1);
    expect(await accounts.signIn('locked@fitadel.local', oldPassword)).toBe(
      account.id,
    );

    await other.query('COMMIT');
    await other.end();
    expect((await resetting).status).toBe('changed');
  });
});

describe('rate limits', () => {
  let db: PrismaClient;
  let limiter: RateLimiter;
  const limit = { max: 10, windowMs: 15 * 60 * 1000 };
  const now = new Date('2026-10-31T12:01:00Z');

  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
    limiter = new RateLimiter(db as unknown as PrismaService);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('allows exactly max of a simultaneous burst', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.attempt('burst', limit, now)),
    );

    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    const blocked = results.find((r) => !r.allowed);
    // 12:01 in the 12:00–12:15 window: 14 minutes left
    expect(blocked).toEqual({ allowed: false, retryAfterSeconds: 14 * 60 });
  });

  it('counts only failures when slots are given back', async () => {
    for (let i = 0; i < 30; i++) {
      const attempt = await limiter.attempt('successes', limit, now);
      expect(attempt.allowed).toBe(true);
      if (attempt.allowed) await attempt.release();
    }
  });

  it('starts over in the next window and deletes old windows', async () => {
    for (let i = 0; i < 10; i++) await limiter.attempt('window', limit, now);
    expect((await limiter.attempt('window', limit, now)).allowed).toBe(false);

    const later = new Date('2026-10-31T12:15:00Z');
    expect((await limiter.attempt('window', limit, later)).allowed).toBe(true);

    const tomorrow = new Date('2026-11-01T12:10:00Z');
    expect(await limiter.deleteOld(tomorrow)).toBeGreaterThan(0);
    expect(await db.rateLimit.count({ where: { key: 'window' } })).toBe(1);
  });
});

describe('email outbox', () => {
  let db: PrismaClient;
  const message = (to: string) => ({ to, subject: 'Hi', text: 'Hello' });

  /** Records what it sends, or throws `error` instead */
  class FakeMailer extends Mailer {
    sent: string[] = [];
    error?: object;
    async send({ to }: EmailMessage) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (this.error) throw this.error;
      this.sent.push(to);
    }
  }
  const senderWith = (mailer: Mailer) =>
    new EmailOutboxSender(db as unknown as PrismaService, mailer);

  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
  });

  beforeEach(async () => {
    await db.emailOutbox.deleteMany();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('queues the email with the transaction, or not at all', async () => {
    await expect(
      db.$transaction(async (tx) => {
        await enqueueEmail(tx, message('rolled-back@example.com'));
        throw new Error('the token insert failed');
      }),
    ).rejects.toThrow('the token insert failed');
    expect(await db.emailOutbox.count()).toBe(0);

    await db.$transaction((tx) =>
      enqueueEmail(tx, message('committed@example.com')),
    );
    expect(await db.emailOutbox.count()).toBe(1);
  });

  it('skips rows another sender is claiming, instead of waiting and taking them too', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueueEmail(db, message(`held${i}@example.com`));
    }
    // Another replica, caught in the middle of its claim: rows locked, not committed
    const other = new Client({ connectionString: urls.app });
    await other.connect();
    await other.query('BEGIN');
    await other.query(
      "UPDATE email_outbox SET attempts = attempts + 1, next_attempt_at = now() + interval '10 minutes'",
    );

    const mailer = new FakeMailer();
    const sending = senderWith(mailer).sendDue();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await other.query('COMMIT');
    await other.end();

    // Without SKIP LOCKED the claim waits for the lock, then takes the rows anyway
    // (its subquery already saw them as due), and every email goes out twice
    expect(await sending).toEqual({ sent: 0, retrying: 0, failed: 0 });
    expect(mailer.sent).toEqual([]);
  });

  it('splits a backlog between senders, sending each email once', async () => {
    for (let i = 0; i < 15; i++) {
      await enqueueEmail(db, message(`user${i}@example.com`));
    }
    const [a, b] = [new FakeMailer(), new FakeMailer()];

    await Promise.all([senderWith(a).sendDue(), senderWith(b).sendDue()]);
    await Promise.all([senderWith(a).sendDue(), senderWith(b).sendDue()]);

    const sent = [...a.sent, ...b.sent];
    expect(sent).toHaveLength(15);
    expect(new Set(sent).size).toBe(15);
    expect(a.sent.length).toBeGreaterThan(0);
    expect(b.sent.length).toBeGreaterThan(0);
    expect(await db.emailOutbox.count()).toBe(0);
  });

  it('retries a failed send with backoff, then gives up', async () => {
    await enqueueEmail(db, message('flaky@example.com'));
    const mailer = new FakeMailer();
    mailer.error = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNECTION',
    });
    const sender = senderWith(mailer);
    let now = new Date();

    expect(await sender.sendDue(now)).toEqual({
      sent: 0,
      retrying: 1,
      failed: 0,
    });
    const row = await db.emailOutbox.findFirstOrThrow();
    expect(row).toMatchObject({
      attempts: 1,
      nextAttemptAt: new Date(now.getTime() + 30_000),
      lastError: 'connect ECONNREFUSED',
    });
    // Not due before the backoff has passed
    expect((await sender.sendDue(now)).retrying).toBe(0);

    // Attempts 2–5 fail too; attempt 6 is the last
    for (let attempt = 2; attempt <= 6; attempt++) {
      now = (await db.emailOutbox.findFirstOrThrow()).nextAttemptAt;
      const result = await sender.sendDue(now);
      expect(result).toEqual(
        attempt < 6
          ? { sent: 0, retrying: 1, failed: 0 }
          : { sent: 0, retrying: 0, failed: 1 },
      );
    }
    expect(await db.emailOutbox.count()).toBe(0);
  });

  it('gives up at once when the server refuses the message for good', async () => {
    await enqueueEmail(db, message('nobody@example.com'));
    const mailer = new FakeMailer();
    mailer.error = Object.assign(new Error('550 mailbox unavailable'), {
      responseCode: 550,
    });

    expect((await senderWith(mailer).sendDue()).failed).toBe(1);
    expect(await db.emailOutbox.count()).toBe(0);
  });

  it('sends a retried email once the server is back', async () => {
    await enqueueEmail(db, message('later@example.com'));
    const mailer = new FakeMailer();
    mailer.error = { code: 'ETIMEDOUT' };
    const sender = senderWith(mailer);
    await sender.sendDue();

    mailer.error = undefined;
    const { nextAttemptAt } = await db.emailOutbox.findFirstOrThrow();
    expect((await sender.sendDue(nextAttemptAt)).sent).toBe(1);
    expect(mailer.sent).toEqual(['later@example.com']);
  });
});

describe('sign-in with Google (a fake Google)', () => {
  const CLIENT_ID = 'fitadel-test.apps.googleusercontent.com';
  const REDIRECT_URI = 'http://localhost:8080/interaction/google/callback';
  let db: PrismaClient;
  let federation: FederationService;
  const fakeGoogle = {
    issuer: '',
    server: createHttpServer(),
    keys: undefined as unknown as Awaited<ReturnType<typeof generateKeyPair>>,
    /** Codes Google has handed out, with what the token endpoint must check */
    codes: new Map<
      string,
      { challenge: string; nonce: string; claims: Record<string, unknown> }
    >(),
  };

  /** The user signs in at Google, which redirects back with a code */
  function googleSignsIn(
    authorizationUrl: URL,
    claims: Record<string, unknown>,
  ) {
    const code = randomBytes(16).toString('hex');
    fakeGoogle.codes.set(code, {
      challenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
      nonce: authorizationUrl.searchParams.get('nonce') ?? '',
      claims,
    });
    const callback = new URL(REDIRECT_URI);
    callback.searchParams.set('code', code);
    callback.searchParams.set(
      'state',
      authorizationUrl.searchParams.get('state') ?? '',
    );
    return callback;
  }

  const alice = (overrides: Record<string, unknown> = {}) => ({
    sub: '1000001',
    email: 'Alice@Gmail.com',
    email_verified: true,
    name: 'Alice',
    ...overrides,
  });

  /** One full round trip; returns the interaction uid the callback resolved to */
  async function signInWithGoogle(
    uid: string,
    claims: Record<string, unknown>,
  ) {
    const { url, state } = await federation.startGoogle(uid);
    return federation.finishGoogle(googleSignsIn(url, claims), state);
  }

  beforeAll(async () => {
    fakeGoogle.keys = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(fakeGoogle.keys.publicKey)), kid: 'k1' };
    fakeGoogle.server.on('request', async (req, res) => {
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const path = new URL(req.url ?? '/', fakeGoogle.issuer).pathname;
      if (path === '/.well-known/openid-configuration') {
        return json(200, {
          issuer: fakeGoogle.issuer,
          authorization_endpoint: `${fakeGoogle.issuer}/auth`,
          token_endpoint: `${fakeGoogle.issuer}/token`,
          jwks_uri: `${fakeGoogle.issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (path === '/jwks') return json(200, { keys: [jwk] });
      if (path === '/token' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const code = form.get('code') ?? '';
        const issued = fakeGoogle.codes.get(code);
        fakeGoogle.codes.delete(code);
        const challenge = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (
          !issued ||
          challenge !== issued.challenge ||
          form.get('redirect_uri') !== REDIRECT_URI
        ) {
          return json(400, { error: 'invalid_grant' });
        }
        const idToken = await new SignJWT({
          ...issued.claims,
          nonce: issued.nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(fakeGoogle.issuer)
          .setAudience(CLIENT_ID)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(fakeGoogle.keys.privateKey);
        return json(200, {
          access_token: 'google-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken,
        });
      }
      json(404, {});
    });
    await new Promise<void>((resolve) =>
      fakeGoogle.server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = fakeGoogle.server.address() as { port: number };
    fakeGoogle.issuer = `http://127.0.0.1:${port}`;

    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
    federation = new FederationService(
      db as unknown as PrismaService,
      new GoogleClient({
        issuer: fakeGoogle.issuer,
        clientId: CLIENT_ID,
        clientSecret: 'test-secret',
        redirectUri: REDIRECT_URI,
      }),
    );
  });

  afterAll(async () => {
    await db.$disconnect();
    await new Promise((resolve) => fakeGoogle.server.close(resolve));
  });

  it('creates a verified account for a new Google user, then signs them in again', async () => {
    expect(await signInWithGoogle('uid-new-1', alice())).toBe('uid-new-1');
    const first = await federation.resultFor('uid-new-1');
    expect(first).toMatchObject({ outcome: 'signed_in' });
    const accountId = (first as { accountId: string }).accountId;
    const account = await db.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { identities: true, password: true },
    });
    expect(account).toMatchObject({
      email: 'alice@gmail.com',
      displayName: 'Alice',
      password: null,
      identities: [{ issuer: fakeGoogle.issuer, subject: '1000001' }],
    });
    expect(account.emailVerifiedAt).not.toBeNull();
    // Used up: picking it up twice finds nothing
    expect(await federation.resultFor('uid-new-1')).toBeUndefined();

    // Another sign-in, even with a changed email at Google: the same account
    await signInWithGoogle('uid-new-2', alice({ email: 'alice@new.example' }));
    expect(await federation.resultFor('uid-new-2')).toEqual({
      outcome: 'signed_in',
      accountId,
    });
    expect(
      await db.account.count({ where: { email: 'alice@new.example' } }),
    ).toBe(0);
  });

  it('links an existing account only after its password sign-in', async () => {
    const owner = await db.account.create({
      data: { email: 'bob@gmail.com', emailVerifiedAt: new Date() },
    });
    const other = await db.account.create({
      data: { email: 'mallory@example.com', emailVerifiedAt: new Date() },
    });
    const bob = alice({ sub: '2000002', email: 'bob@gmail.com', name: 'Bob' });

    await signInWithGoogle('uid-link-1', bob);
    expect(await federation.resultFor('uid-link-1')).toEqual({
      outcome: 'link_required',
      email: 'bob@gmail.com',
    });
    expect(await federation.isLinkPending('uid-link-1')).toBe(true);
    // Signing in to another account in that interaction links nothing
    expect(await federation.linkAfterSignIn('uid-link-1', other.id)).toBe(
      false,
    );
    expect(await federation.isLinkPending('uid-link-1')).toBe(false);

    await signInWithGoogle('uid-link-2', bob);
    expect(await federation.linkAfterSignIn('uid-link-2', owner.id)).toBe(true);
    // A double submit of the password form links once
    expect(await federation.linkAfterSignIn('uid-link-2', owner.id)).toBe(
      false,
    );
    expect(
      await db.accountIdentity.findMany({ where: { accountId: owner.id } }),
    ).toMatchObject([{ subject: '2000002' }]);

    await signInWithGoogle('uid-link-3', bob);
    expect(await federation.resultFor('uid-link-3')).toEqual({
      outcome: 'signed_in',
      accountId: owner.id,
    });
  });

  it('refuses an email Google has not verified', async () => {
    await signInWithGoogle(
      'uid-unverified',
      alice({
        sub: '3000003',
        email: 'carol@example.com',
        email_verified: false,
      }),
    );
    expect(await federation.resultFor('uid-unverified')).toEqual({
      outcome: 'email_unverified',
    });
    expect(
      await db.account.count({ where: { email: 'carol@example.com' } }),
    ).toBe(0);
  });

  it('refuses a callback from another browser, a replay and an expired attempt', async () => {
    const { url, state } = await federation.startGoogle('uid-csrf');
    const callback = googleSignsIn(url, alice());
    // Another browser: no state cookie, or someone else's
    expect(await federation.finishGoogle(callback, undefined)).toBeUndefined();
    expect(
      await federation.finishGoogle(callback, 'x'.repeat(43)),
    ).toBeUndefined();
    // The right browser, once
    expect(await federation.finishGoogle(callback, state)).toBe('uid-csrf');
    expect(await federation.finishGoogle(callback, state)).toBeUndefined();

    const later = new Date(Date.now() + FEDERATION_TTL_MS + 1000);
    const expired = await federation.startGoogle('uid-expired');
    expect(
      await federation.finishGoogle(
        googleSignsIn(expired.url, alice()),
        expired.state,
        later,
      ),
    ).toBeUndefined();
  });

  it('reports a failure when Google returns an error or refuses the code', async () => {
    const { url, state } = await federation.startGoogle('uid-cancel');
    const cancelled = new URL(REDIRECT_URI);
    cancelled.searchParams.set('error', 'access_denied');
    cancelled.searchParams.set('state', url.searchParams.get('state') ?? '');
    expect(await federation.finishGoogle(cancelled, state)).toBe('uid-cancel');
    expect(await federation.resultFor('uid-cancel')).toEqual({
      outcome: 'failed',
    });

    // A code issued for another attempt: its PKCE challenge doesn't match
    const mine = await federation.startGoogle('uid-pkce');
    const theirs = await federation.startGoogle('uid-pkce-other');
    const stolen = googleSignsIn(theirs.url, alice());
    stolen.searchParams.set('state', mine.url.searchParams.get('state') ?? '');
    expect(await federation.finishGoogle(stolen, mine.state)).toBe('uid-pkce');
    expect(await federation.resultFor('uid-pkce')).toEqual({
      outcome: 'failed',
    });
  });
});
