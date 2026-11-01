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
import { join } from 'node:path';
import { Client } from 'pg';
import { AccountService } from './account/account.service';
import { PasswordHasher } from './account/password-hasher';
import { EmailOutboxSender, enqueueEmail } from './email/email-outbox';
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

  beforeAll(() => {
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: urls.app }),
    });
    accounts = new AccountService(
      db as unknown as PrismaService,
      new PasswordHasher(),
    );
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('lets exactly one of two simultaneous registrations of an email win', async () => {
    const register = () =>
      accounts.register({
        email: 'Twin@Fitadel.local',
        password: 'river cat lantern',
      });

    const results = await Promise.all([register(), register()]);

    expect(results).toEqual(
      expect.arrayContaining([
        { accountId: expect.any(String) },
        { error: 'email_taken' },
      ]),
    );
    expect(
      await db.account.count({ where: { email: 'twin@fitadel.local' } }),
    ).toBe(1);
  });

  it('signs in with the registered password', async () => {
    const registered = await accounts.register({
      email: 'new@fitadel.local',
      password: 'river cat lantern',
      displayName: 'New User',
    });

    expect(
      await accounts.signIn('NEW@fitadel.local', 'river cat lantern'),
    ).toBe('accountId' in registered ? registered.accountId : '-');
    expect(
      await accounts.signIn('new@fitadel.local', 'river cat lanterns'),
    ).toBeUndefined();
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
