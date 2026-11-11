/**
 * Integration tests against a real, throwaway Postgres (Testcontainers).
 * Each run provisions the database with tools/db and applies the migrations, exactly
 * as a fresh environment would. Run with `nx run diary:integration` (needs Docker).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { routesOpenWithoutToken } from '@fitadel/shared-auth/testing';
import { configureHttp } from '@fitadel/shared-http';

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

/** Runs the Prisma CLI as diary_migrator; throws on a non-zero exit code. */
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

/** Runs one query as the given role and returns its rows */
async function query(url: string, sql: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage())
    .withEnvironment({
      DIARY_MIGRATOR_PASSWORD: passwords.migrator,
      DIARY_APP_PASSWORD: passwords.app,
      DIARY_READER_PASSWORD: passwords.reader,
    })
    // An empty volume runs these on first start, like a fresh local or cloud setup
    .withCopyFilesToContainer(
      ['diary.sh', 'diary.psql'].map((file) => ({
        source: join(workspaceRoot, 'tools/db', file),
        target: `/docker-entrypoint-initdb.d/${file}`,
      })),
    )
    .start();

  const server = `${container.getHost()}:${container.getPort()}`;
  urls = {
    migrator: `postgresql://diary_migrator:${passwords.migrator}@${server}/diary`,
    app: `postgresql://diary_app:${passwords.app}@${server}/diary`,
    reader: `postgresql://diary_reader:${passwords.reader}@${server}/diary`,
  };
  prisma('migrate', 'deploy');
});

afterAll(async () => {
  await container?.stop();
});

describe('database', () => {
  it('denies schema changes to the runtime role', async () => {
    await expect(
      query(urls.app, 'CREATE TABLE intruder (id int)'),
    ).rejects.toThrow(/permission denied for schema public/);
  });

  it('gives the reader role read-only sessions', async () => {
    expect(
      await query(urls.reader, 'SHOW default_transaction_read_only'),
    ).toEqual([{ default_transaction_read_only: 'on' }]);
  });
});

describe('service', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Config is validated when AppModule is loaded, so set the env first
    process.env.DATABASE_URL = urls.app;
    // No route here verifies a token yet: the keys are never fetched
    process.env.AUTH_JWKS_URI = 'http://127.0.0.1:9/jwks';
    const { AppModule } = await import('./app/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app);
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('is ready with a real database', async () => {
    const response = await fetch(`${await app.getUrl()}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      info: { database: { status: 'up' } },
    });
  });

  it('answers errors with RFC 9457 problem details', async () => {
    const response = await fetch(`${await app.getUrl()}/v1/unknown`);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toMatch(
      /^application\/problem\+json/,
    );
  });

  it('refuses requests without a token on every route except the public ones', async () => {
    // Routes marked @Public(). The gateway has no public diary routes (envoy.yaml), so
    // a new one also needs an entry there.
    expect(await routesOpenWithoutToken(app)).toEqual([
      'GET /health/live',
      'GET /health/ready',
    ]);
  });
});
