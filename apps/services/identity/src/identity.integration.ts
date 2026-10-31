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
import { PrismaClient } from './generated/prisma/client';
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
    for (const secret of ['account_password', 'oidc_payload']) {
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
