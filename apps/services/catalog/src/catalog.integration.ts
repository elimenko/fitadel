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
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Client, Pool } from 'pg';
import { importOffDump } from './import/off-import';

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
      CATALOG_READER_PASSWORD: passwords.reader,
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
      // TRUNCATE is granted for the import's staging table only
      await expect(client.query('TRUNCATE food')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await client.end();
    }
  });
});

describe('Open Food Facts import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'off-dump-'));
  let pool: Pool;

  /** Writes a gzipped JSONL dump like the real one, with only the fields we read */
  function dump(name: string, products: object[]): string {
    const file = join(dir, name);
    const lines = products.map((product) => JSON.stringify(product)).join('\n');
    writeFileSync(file, gzipSync(lines));
    return file;
  }

  const nutrition = (kcal: number, per = '100g') => ({
    aggregated_set: {
      per,
      nutrients: {
        'energy-kcal': { value: kcal, unit: 'kcal', source: 'packaging' },
        proteins: { value: 18, unit: 'g', source: 'packaging' },
        fat: { value: 4, unit: 'g', source: 'packaging' },
        carbohydrates: { value: 3.5, unit: 'g', source: 'packaging' },
      },
    },
  });
  const twarog = {
    code: '5900512300108',
    countries_tags: ['en:poland'],
    lang: 'pl',
    product_name_pl: 'Twaróg półtłusty',
    serving_size: '1 porcja (50 g)',
    serving_quantity: '50',
    last_modified_t: 1770000000,
    nutrition: nutrition(133),
  };
  // Sold in Poland, but only named in French
  const boisson = {
    code: '5449000000996',
    countries_tags: ['en:poland', 'en:france'],
    lang: 'fr',
    product_name: 'Boisson gazeuse',
    last_modified_t: 1770000000,
    nutrition: {
      aggregated_set: {
        per: '100ml',
        nutrients: {
          'energy-kcal': { value: 42, unit: 'kcal', source: 'packaging' },
        },
      },
    },
  };
  const withoutNutrition = {
    code: '5901234123457',
    countries_tags: ['en:poland'],
    product_name_pl: 'Serek',
  };
  // Not tagged as sold in Poland (like Alpro or imported supplements): imported too
  const irish = {
    ...twarog,
    code: '3017620422003',
    countries_tags: ['en:ireland'],
  };

  const full = () =>
    dump('full.jsonl.gz', [twarog, boisson, withoutNutrition, irish]);
  const foods = async () =>
    (
      await pool.query<{
        source_ref: string;
        retired: boolean;
        servings: number;
      }>(
        `SELECT source_ref, retired_at IS NOT NULL AS retired,
           (SELECT count(*)::int FROM food_serving WHERE food_id = food.id) AS servings
         FROM food WHERE source = 'off' ORDER BY source_ref`,
      )
    ).rows;

  beforeAll(() => {
    pool = new Pool({ connectionString: urls.app });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('imports every clean product with nutrition data, from any country', async () => {
    const report = await importOffDump(pool, full());
    expect(report).toMatchObject({
      read: 4,
      // The product without nutrition data isn't even parsed
      parsed: 3,
      staged: 3,
      rejected: {},
      inserted: 3,
      updated: 0,
      retired: 0,
    });
    expect(await foods()).toEqual([
      { source_ref: '3017620422003', retired: false, servings: 1 },
      { source_ref: '5449000000996', retired: false, servings: 0 },
      { source_ref: '5900512300108', retired: false, servings: 1 },
    ]);
    const { rows } = await pool.query(
      "SELECT countries FROM food WHERE source_ref = '3017620422003'",
    );
    expect(rows).toEqual([{ countries: ['ireland'] }]);
    // Staging is emptied after a successful merge
    const staging = await pool.query(
      'SELECT count(*)::int AS rows FROM food_import',
    );
    expect(staging.rows).toEqual([{ rows: 0 }]);
  });

  it('finds a French-only product by text search', async () => {
    const { rows } = await pool.query(
      "SELECT source_ref FROM food WHERE f_norm('boisson') <% food_search_text(names, brand)",
    );
    expect(rows).toEqual([{ source_ref: '5449000000996' }]);
  });

  it('changes nothing when the same dump is imported again', async () => {
    expect(await importOffDump(pool, full())).toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 3,
    });
  });

  it('refuses to retire a large share of the catalog (truncated dump)', async () => {
    const truncated = dump('truncated.jsonl.gz', [twarog]);
    await expect(importOffDump(pool, truncated)).rejects.toThrow(
      /Refusing to retire 2 of 3/,
    );
    expect((await foods()).every((food) => !food.retired)).toBe(true);
  });

  it('retires products that are gone from Open Food Facts', async () => {
    const truncated = dump('truncated.jsonl.gz', [twarog]);
    expect(
      await importOffDump(pool, truncated, { maxRetiredShare: 1 }),
    ).toMatchObject({
      retired: 2,
    });
    expect(await foods()).toContainEqual({
      source_ref: '5449000000996',
      retired: true,
      servings: 0,
    });
  });

  it('allows only one import at a time', async () => {
    const other = await pool.connect();
    try {
      await other.query(
        "SELECT pg_advisory_lock(hashtext('catalog:off-import'))",
      );
      await expect(importOffDump(pool, full())).rejects.toThrow(
        /Another import is running/,
      );
    } finally {
      await other.query(
        "SELECT pg_advisory_unlock(hashtext('catalog:off-import'))",
      );
      other.release();
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

/** A port that is free right now (the OS picks it). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Windows has no real POSIX signals: Node can't deliver SIGTERM to another process
// there (it terminates it instead), so this runs on Linux only, e.g. in CI.
const onPosix = process.platform === 'win32' ? describe.skip : describe;

onPosix('shutdown', () => {
  it('exits cleanly on SIGTERM', async () => {
    const port = await freePort();
    // The built bundle, run as a real process: what a container would run
    const server = spawn(
      process.execPath,
      [join(projectRoot, 'dist/main.js')],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: String(port),
          DATABASE_URL: urls.app,
          OTEL_SDK_DISABLED: 'true',
        },
      },
    );
    let output = '';
    server.stdout.on('data', (chunk) => (output += chunk));
    server.stderr.on('data', (chunk) => (output += chunk));
    const exited = new Promise<number | null>((resolve) =>
      server.on('exit', resolve),
    );

    // Wait until the server answers
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health/live`)).ok) break;
      } catch {
        // not listening yet
      }
      if (attempt > 100) throw new Error(`Server didn't start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    server.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(output).toContain('Received SIGTERM, shutting down');
  });
});
