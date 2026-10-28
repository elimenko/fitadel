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
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { Client, Pool } from 'pg';
import type { BarcodeLookupDto, SearchResultDto } from './food/food.dto';
import type { ProblemDetails } from './http/problem-details.filter';
import { importOffDump } from './import/off-import';
import { WHEY_BARCODE, wheyProtein } from './off/off-api-product.fixture';

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

/**
 * Plays the Open Food Facts API, so tests never call the real one: it knows the whey
 * protein, answers SLOW_BARCODE too late, and 404 for everything else.
 */
const SLOW_BARCODE = '4006381333931';
const fakeOff = {
  requests: [] as { code: string; userAgent?: string }[],
  server: createHttpServer((request, response) => {
    const code =
      /\/api\/v2\/product\/(\d+)\.json/.exec(request.url ?? '')?.[1] ?? '';
    fakeOff.requests.push({ code, userAgent: request.headers['user-agent'] });
    const answer = (status: number, body: object) =>
      response
        .writeHead(status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(body));
    if (code === WHEY_BARCODE) answer(200, { status: 1, product: wheyProtein });
    else if (code === SLOW_BARCODE)
      setTimeout(() => answer(200, { status: 0 }), 1500);
    else answer(404, { status: 0, status_verbose: 'product not found' });
  }),
  count: (code: string) =>
    fakeOff.requests.filter((r) => r.code === code).length,
};

describe('service', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      fakeOff.server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = fakeOff.server.address() as { port: number };
    // Config is validated when AppModule is loaded, so set the env first
    process.env.DATABASE_URL = urls.app;
    process.env.OFF_API_URL = `http://127.0.0.1:${port}`;
    process.env.OFF_TIMEOUT_MS = '300';
    const { AppModule } = await import('./app/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    const { configureHttp } = await import('./http/http-setup.js');
    configureHttp(app);
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((resolve) => fakeOff.server.close(resolve));
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
    expect(await response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      instance: '/v1/unknown',
    });
  });

  // Uses the foods the import tests left behind: Twaróg (active), Boisson (retired)
  describe('GET /v1/foods/barcode/:code', () => {
    const get = async (code: string, language?: string) => {
      const response = await fetch(
        `${await app.getUrl()}/v1/foods/barcode/${code}`,
        {
          headers: language ? { 'Accept-Language': language } : {},
        },
      );
      // Either a lookup (200) or problem details (4xx); the assertions check which
      const body = (await response.json()) as BarcodeLookupDto & ProblemDetails;
      return { response, body };
    };

    it('finds a food by its printed barcode, with a display-name fallback', async () => {
      const { response, body } = await get('5900512300108', 'ru-RU,ru;q=0.9');
      expect(response.status).toBe(200);
      expect(response.headers.get('vary')).toMatch(/Accept-Language/i);
      expect(body).toMatchObject({
        food: {
          source: 'off',
          barcode: '05900512300108',
          // No Russian name: falls back to Polish
          name: 'Twaróg półtłusty',
          names: { pl: 'Twaróg półtłusty' },
          basis: 'g',
          per100: { kcal: 133, protein: 18, fat: 4, carbs: 3.5, fiber: null },
          servings: [{ label: '1 porcja (50 g)', amount: 50 }],
          countries: ['poland'],
        },
        alternatives: [],
      });
    });

    it('prefers a community food and offers the import as an alternative', async () => {
      const client = new Client({ connectionString: urls.app });
      await client.connect();
      try {
        await client.query(
          `INSERT INTO food (source, barcode, names, kcal, updated_at)
           VALUES ('user', '05900512300108', '{"pl": "Twaróg", "ru": "Творог"}', 130, now())`,
        );
        const { body } = await get('5900512300108', 'ru');
        expect(body.food).toMatchObject({ source: 'user', name: 'Творог' });
        expect(body.alternatives).toMatchObject([
          { source: 'off', sourceRef: '5900512300108' },
        ]);
      } finally {
        await client.query("DELETE FROM food WHERE source = 'user'");
        await client.end();
      }
    });

    it("doesn't return retired foods", async () => {
      expect((await get('5449000000996')).response.status).toBe(404);
    });

    it('explains a mistyped barcode (check digit mismatch)', async () => {
      const { response, body } = await get('590012005947');
      expect(response.status).toBe(400);
      expect(body.detail).toMatch(/check digit/);
    });

    it('names the invalid field when the input is not a barcode', async () => {
      const { response, body } = await get('abc');
      expect(response.status).toBe(400);
      expect(body.errors).toEqual([
        { path: 'code', message: 'A barcode has 8 to 14 digits' },
      ]);
    });

    describe('live lookup in Open Food Facts (a fake server)', () => {
      it('fetches a barcode the catalog lacks, stores it, and asks only once', async () => {
        const first = await get(WHEY_BARCODE, 'en');
        expect(first.response.status).toBe(200);
        expect(first.body.food).toMatchObject({
          source: 'off',
          name: '100% WHEY PROTEIN DOUBLE RICH CHOCOLATE',
          per100: { kcal: 374, protein: 76, fiber: null },
          servings: [{ label: '1 serving (31 g)', amount: 31 }],
        });
        // The agreed identification, sent to Open Food Facts
        expect(fakeOff.requests.at(-1)?.userAgent).toBe(
          'Fitadel/0.1 (+https://github.com/elimenko/fitadel)',
        );

        // Stored: the next scan is a normal database hit
        expect((await get(WHEY_BARCODE)).response.status).toBe(200);
        expect(fakeOff.count(WHEY_BARCODE)).toBe(1);
      });

      it('remembers a barcode Open Food Facts does not know', async () => {
        const unknown = '96385074';
        expect((await get(unknown)).response.status).toBe(404);
        expect((await get(unknown)).response.status).toBe(404);
        expect(fakeOff.count(unknown)).toBe(1);
      });

      it('answers quickly when Open Food Facts is slow, and asks again later', async () => {
        const started = Date.now();
        expect((await get(SLOW_BARCODE)).response.status).toBe(404);
        // Timeout is 300 ms; the fake would answer after 1500 ms
        expect(Date.now() - started).toBeLessThan(1000);
        // A timeout says nothing about the product, so it isn't remembered
        await get(SLOW_BARCODE);
        expect(fakeOff.count(SLOW_BARCODE)).toBe(2);
      });

      it('keeps live-fetched foods when an export without them is imported', async () => {
        const pool = new Pool({ connectionString: urls.app });
        try {
          const file = join(
            mkdtempSync(join(tmpdir(), 'off-dump-')),
            'dump.jsonl.gz',
          );
          writeFileSync(
            file,
            gzipSync(
              JSON.stringify({
                code: '5900512300108',
                countries_tags: ['en:poland'],
                lang: 'pl',
                product_name_pl: 'Twaróg półtłusty',
                last_modified_t: 1770000000,
                nutrition: {
                  aggregated_set: {
                    per: '100g',
                    nutrients: {
                      'energy-kcal': {
                        value: 133,
                        unit: 'kcal',
                        source: 'packaging',
                      },
                    },
                  },
                },
              }),
            ),
          );
          await importOffDump(pool, file);
          const { rows } = await pool.query(
            'SELECT from_dump, retired_at FROM food WHERE source_ref = $1',
            [WHEY_BARCODE],
          );
          expect(rows).toEqual([{ from_dump: false, retired_at: null }]);
        } finally {
          await pool.end();
        }
      });
    });
  });

  describe('GET /v1/foods (search)', () => {
    const search = async (query: string) => {
      const response = await fetch(`${await app.getUrl()}/v1/foods?${query}`);
      const body = (await response.json()) as SearchResultDto & ProblemDetails;
      return { response, body };
    };
    const names = (body: SearchResultDto) =>
      body.items.map((food) => food.name);

    // A popular German food and two less popular Polish ones, all with the same name
    beforeAll(async () => {
      const client = new Client({ connectionString: urls.app });
      await client.connect();
      try {
        await client.query(`
          INSERT INTO food (source, source_ref, names, countries, popularity, kcal, updated_at) VALUES
            ('off', 'search-de', '{"de": "Mleko testowe DE"}', '{germany}', 100, 60, now()),
            ('off', 'search-pl', '{"pl": "Mleko testowe PL"}', '{poland}', 0, 60, now()),
            ('off', 'search-pl2', '{"pl": "Mleko testowe zwykłe"}', '{poland}', 5, 60, now())`);
      } finally {
        await client.end();
      }
    });

    it('ranks foods sold in Poland first, then by popularity', async () => {
      const { response, body } = await search('q=mleko%20testowe');
      expect(response.status).toBe(200);
      expect(names(body)).toEqual([
        'Mleko testowe zwykłe',
        'Mleko testowe PL',
        'Mleko testowe DE',
      ]);
      expect(body.nextOffset).toBeNull();
    });

    it('finds partly typed words and ignores Polish characters', async () => {
      expect(names((await search('q=testow%20zwykle')).body)).toEqual([
        'Mleko testowe zwykłe',
      ]);
    });

    it('pages through the results without overlap', async () => {
      const first = (await search('q=mleko%20testowe&limit=2')).body;
      expect(first.nextOffset).toBe(2);
      const second = (await search('q=mleko%20testowe&limit=2&offset=2')).body;
      expect(second.nextOffset).toBeNull();
      expect([...names(first), ...names(second)]).toEqual([
        'Mleko testowe zwykłe',
        'Mleko testowe PL',
        'Mleko testowe DE',
      ]);
    });

    it("doesn't return retired foods", async () => {
      expect((await search('q=boisson')).body.items).toEqual([]);
    });

    it('rejects queries that are too short or pages that are too large', async () => {
      const short = await search('q=a');
      expect(short.response.status).toBe(400);
      expect(short.body.errors).toEqual([
        { path: 'q', message: 'Type at least 2 characters' },
      ]);
      expect((await search('q=mleko&limit=500')).response.status).toBe(400);
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
