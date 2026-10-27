/**
 * Integration tests against a real, throwaway Postgres (Testcontainers).
 * Each run provisions the database with tools/db and applies the migrations, exactly
 * as a fresh environment would. Run with `nx run catalog:integration` (needs Docker).
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
};

let container: StartedPostgreSqlContainer;
let urls: { migrator: string; app: string };

/** Runs the Prisma CLI as catalog_migrator; throws on a non-zero exit code. */
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

beforeAll(async () => {
  container = await new PostgreSqlContainer(postgresImage())
    .withEnvironment({
      CATALOG_MIGRATOR_PASSWORD: passwords.migrator,
      CATALOG_APP_PASSWORD: passwords.app,
    })
    // An empty volume runs these on first start, like a fresh local or cloud setup
    .withCopyFilesToContainer(
      ['catalog.sh', 'catalog.psql'].map((file) => ({
        source: join(workspaceRoot, 'tools/db', file),
        target: `/docker-entrypoint-initdb.d/${file}`,
      })),
    )
    .start();

  const server = `${container.getHost()}:${container.getPort()}`;
  urls = {
    migrator: `postgresql://catalog_migrator:${passwords.migrator}@${server}/catalog`,
    app: `postgresql://catalog_app:${passwords.app}@${server}/catalog`,
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
    const client = new Client({ connectionString: urls.app });
    await client.connect();
    try {
      await expect(client.query('DROP TABLE food')).rejects.toThrow(
        /must be owner/,
      );
    } finally {
      await client.end();
    }
  });
});

describe('service', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Config is validated when AppModule is loaded, so set the env first
    process.env.DATABASE_URL = urls.app;
    const { AppModule } = await import('./app/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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
});
